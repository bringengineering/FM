import { getCustomerSite, siteId, type CustomerSiteReads } from './sites.js';
import { reportCore } from './report-core.js';
import { assert, hash, nowIso, object, photoBinding, RECORD_LIMITS, recordingInput, RecordingError, reportFor, uploadKey, uploadStatus, type ArchiveRecord, type Recording, type RecordingPhoto, type UploadRecord } from './recording-model.js';

export interface RecordingStore {
  get<T>(path:string):Promise<T|null>;
  change<T>(path:string, update:(old:T|null)=>T):Promise<T>;
  commit(report:Record<string,unknown>,document:Record<string,unknown>):Promise<void>;
}
export interface RecordingBlobs {putOnce(path:string,bytes:Buffer):Promise<Buffer>; read(path:string):Promise<Buffer>; remove?(path:string):Promise<void>}
export interface RecordingDrive {
  checkRoots():Promise<void>;
  generateId():Promise<string>;
  folder(root:'photos'|'reports',segments:{key:string;name:string}[]):Promise<string>;
  upload(id:string,parent:string,name:string,mime:string,bytes:Buffer,binding:string):Promise<void>;
  download(id:string,expected:{sha256:string;bytes:number}):Promise<Buffer>;
}
export interface RecordingDependencies {store:RecordingStore;blobs:RecordingBlobs;drive:RecordingDrive;sites:CustomerSiteReads;validateJpeg(bytes:Buffer,photo:RecordingPhoto):Promise<void>;pdf(visit:Recording,photos:{photo:RecordingPhoto;bytes:Buffer}[]):Promise<Buffer>;recheck():Promise<void>}
const base='crmCompany/fieldMobile';
export function createRecordingService(uid:string,d:RecordingDependencies) {
  assert(siteId(uid),'MOBILE_AUTH_REQUIRED',401);
  const visitPath=(id:string)=>`${base}/visits/${uid}/${id}`;
  const uploadPath=(id:string)=>`${base}/uploads/${uid}/${id}`;
  const blobPath=(u:UploadRecord,offset:number)=>`field-mobile-staging/${uid}/${u.id}/${offset}`;
  async function visit(id:string) {
    assert(siteId(id)); const v=await d.store.get<Recording>(visitPath(id));
    assert(v&&v.ownerUid===uid&&v.id===id,'VISIT_NOT_FOUND',404);
    await getCustomerSite(v.customerId,d.sites); return v;
  }
  async function upload(id:string) {
    assert(siteId(id));const u=await d.store.get<UploadRecord>(uploadPath(id));
    assert(u&&u.id===id&&u.ownerUid===uid,'UPLOAD_NOT_FOUND',404);
    const v=await visit(u.visitId); const p=v.photos.find(p=>p.id===u.photo.id);
    assert(p&&photoBinding(p)===photoBinding(u.photo),'REVISION_CONFLICT',409); return u;
  }
  async function save(id:string,input:unknown) {
    assert(siteId(id));const value=recordingInput(input),site=await getCustomerSite(value.customerId,d.sites),contentHash=hash(JSON.stringify(value));
    const timestamp=nowIso();
    const saved=await d.store.change<Recording>(visitPath(id),old=>{
      if(old) {
        assert(old.ownerUid===uid&&old.customerId===value.customerId&&old.kind===value.kind&&old.workDate===value.workDate,'REVISION_CONFLICT',409);
        assert(value.revision>=old.revision,'REVISION_CONFLICT',409);
        if(value.revision===old.revision) {assert(old.contentHash===contentHash,'REVISION_CONFLICT',409);return old;}
        // Photos are append-only after reconciliation. A new visit is required
        // for a different site/date; a later draft cannot substitute image bytes.
        for(const p of old.photos) assert(value.photos.some(n=>n.id===p.id&&photoBinding(n)===photoBinding(p)),'PHOTO_ALREADY_LINKED',409);
      }
      return {...value,id,ownerUid:uid,site:old?.site.address?old.site:site,contentHash,createdAt:old?.createdAt||timestamp,updatedAt:timestamp};
    });
    return {visitId:saved.id,revision:saved.revision,photoIds:saved.photos.map(p=>p.id)};
  }
  async function reserve(visitId:string,input:unknown,key:string) {
    assert(object(input)); const v=await visit(visitId),p=v.photos.find(p=>p.id===input.photoId);
    assert(p&&key===`photo_${p.id}`&&input.expectedRevision===v.revision,'REVISION_CONFLICT',409);
    const expected={expectedRevision:v.revision,photoId:p.id,itemKey:p.itemKey,phase:p.phase,claimedCapturedAt:p.capturedAt,mime:p.mime,bytes:p.bytes,sha256:p.sha256,width:p.width,height:p.height,included:p.included,caption:p.caption};
    assert(Object.keys(input).length===Object.keys(expected).length&&Object.entries(expected).every(([k,val])=>input[k]===val));
    const id=uploadKey(uid,visitId,p.id);
    const u=await d.store.change<UploadRecord>(uploadPath(id),old=>{
      if(old) {assert(old.visitId===visitId&&old.ownerUid===uid&&photoBinding(old.photo)===photoBinding(p),'REVISION_CONFLICT',409);return old;}
      return{id,ownerUid:uid,visitId,photo:p,receivedBytes:0,state:'uploading',createdAt:nowIso()};
    });return uploadStatus(u);
  }
  async function chunk(id:string,range:string,bytes:Buffer) {
    const u=await upload(id),match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);assert(match);
    const offset=Number(match[1]),end=Number(match[2]),total=Number(match[3]);
    assert(total===u.photo.bytes&&Number.isSafeInteger(offset)&&offset>=0&&offset%RECORD_LIMITS.chunk===0&&end===offset+bytes.length-1&&end<total&&bytes.length===Math.min(RECORD_LIMITS.chunk,total-offset));
    assert(offset<=u.receivedBytes,'UPLOAD_OFFSET_INVALID',409);
    if(u.state==='ready')return uploadStatus(u);
    const persisted=await d.blobs.putOnce(blobPath(u,offset),bytes);assert(hash(persisted)===hash(bytes),'UPLOAD_CHUNK_CONFLICT',409);
    const updated=await d.store.change<UploadRecord>(uploadPath(id),old=>{assert(old&&old.ownerUid===uid,'UPLOAD_NOT_FOUND',404);assert(offset<=old.receivedBytes,'UPLOAD_OFFSET_INVALID',409);return{...old,receivedBytes:Math.max(old.receivedBytes,end+1)};});
    return uploadStatus(updated);
  }
  async function complete(id:string,key:string) {
    let u=await upload(id);assert(key===`complete_${u.photo.id}`);if(u.state==='ready')return uploadStatus(u);
    assert(u.receivedBytes===u.photo.bytes,'UPLOAD_INCOMPLETE',409);
    const chunks:Buffer[]=[];for(let offset=0;offset<u.photo.bytes;offset+=RECORD_LIMITS.chunk)chunks.push(await d.blobs.read(blobPath(u,offset)));
    const bytes=Buffer.concat(chunks);assert(bytes.length===u.photo.bytes&&hash(bytes)===u.photo.sha256,'PHOTO_INTEGRITY_FAILED',422);
    await d.validateJpeg(bytes,u.photo);const v=await visit(u.visitId);await d.recheck();
    const phaseName=({before:'작업 전',during:'작업 중',after:'작업 후'})[u.photo.phase];
    const areaName=reportCore.itemCatalogFor(v.kind).find(item=>item.key===u.photo.itemKey)?.label;assert(areaName,'PHOTO_INVALID',422);
    const folderId=u.folderId||await d.drive.folder('photos',[{key:v.customerId,name:[v.site.name.slice(0,50),v.site.address.slice(0,65)].filter(Boolean).join(' - ')},{key:v.workDate,name:v.workDate},{key:u.photo.phase,name:phaseName},{key:u.photo.itemKey,name:areaName}]);
    const candidate=u.driveFileId||await d.drive.generateId();
    u=await d.store.change<UploadRecord>(uploadPath(id),old=>{assert(old&&old.ownerUid===uid,'UPLOAD_NOT_FOUND',404);return{...old,driveFileId:old.driveFileId||candidate,folderId:old.folderId||folderId};});
    await d.drive.upload(u.driveFileId!,u.folderId!,`${v.workDate}_${areaName.replace(/[\u0000-\u001f/\\]/g,' ')}_${phaseName}_${u.photo.id.slice(0,8)}.jpg`,'image/jpeg',bytes,u.id);
    await d.recheck(); await visit(u.visitId);
    const ready=await d.store.change<UploadRecord>(uploadPath(id),old=>{assert(old&&old.driveFileId===u.driveFileId,'REVISION_CONFLICT',409);return{...old,state:'ready'};});
    for(let offset=0;offset<u.photo.bytes;offset+=RECORD_LIMITS.chunk)await d.blobs.remove?.(blobPath(u,offset)).catch(()=>undefined);
    return uploadStatus(ready);
  }
  async function archive(visitId:string,input:unknown) {
    let stage='validate';
    try{
    assert(object(input)&&Object.keys(input).every(k=>['revision','captureAreas'].includes(k))&&Number.isSafeInteger(input.revision));
    const v=await visit(visitId);assert(v.revision===input.revision&&v.draft.confirmedRevision===v.revision,'REPORT_REVIEW_REQUIRED',409);
    assert(v.site.address.trim(),'SITE_ADDRESS_REQUIRED',422);
    const selected=v.photos.filter(p=>p.included);assert(selected.length>0&&selected.length<=RECORD_LIMITS.pdfPhotos,'REPORT_PHOTO_LIMIT',422);
    let plan:string[]|undefined;
    if(input.captureAreas!==undefined){
      const catalog=reportCore.itemCatalogFor(v.kind),keys=new Set(catalog.map(item=>item.key));
      assert(Array.isArray(input.captureAreas)&&input.captureAreas.length>0&&input.captureAreas.length<=catalog.length&&input.captureAreas.every((key:unknown)=>typeof key==='string'&&keys.has(key))&&new Set(input.captureAreas).size===input.captureAreas.length);
      assert(selected.every(p=>input.captureAreas.includes(p.itemKey)),'REPORT_INVALID',422);
      const chosen=new Set<string>(input.captureAreas);
      for(const item of catalog)if((v.draft.statuses[item.key]&&v.draft.statuses[item.key]!=='recorded')||v.draft.notes[item.key]?.trim())chosen.add(item.key);
      plan=catalog.filter(item=>chosen.has(item.key)).map(item=>item.key);
    }
    assert(selected.reduce((n,p)=>n+p.bytes,0)<=RECORD_LIMITS.pdfSourceBytes,'REPORT_PHOTO_BYTES_LIMIT',422);
    const uploads:UploadRecord[]=[];for(const p of selected){const u=await upload(uploadKey(uid,v.id,p.id));assert(u.state==='ready'&&u.driveFileId,'PHOTOS_NOT_READY',409);uploads.push(u);}
    const identity=plan?[uid,v.id,v.revision,plan]:[uid,v.id,v.revision];
    const recordId='saved_wr_'+hash(JSON.stringify(identity)).slice(0,40),reportId='fm_'+hash(JSON.stringify(identity)).slice(0,40),path=`${base}/archives/${uid}/${recordId}`;
    let a=await d.store.change<ArchiveRecord>(path,old=>{if(old){assert(old.contentHash===v.contentHash,'REVISION_CONFLICT',409);return old;}return{id:recordId,visitId:v.id,revision:v.revision,ownerUid:uid,contentHash:v.contentHash,reportId};});
    if(a.ready)return{documentId:a.id,revision:a.revision,archivedAt:a.archivedAt,driveVerified:true,crmLinked:true};
    const scoped=plan?{...v,captureAreas:plan}:v;
    const report=reportFor(scoped,uploads,reportId);assert(reportCore.validateReport(report).ok,'REPORT_INVALID',422);
    stage='download-photos';const imageBytes:{photo:RecordingPhoto;bytes:Buffer}[]=[];
    for(let i=0;i<selected.length;i+=4){const batch=selected.slice(i,i+4);imageBytes.push(...await Promise.all(batch.map(async p=>({photo:p,bytes:await d.drive.download(uploads.find(u=>u.photo.id===p.id)!.driveFileId!,p)}))));}
    stage='render-pdf';const rendered=await d.pdf(scoped,imageBytes);
    stage='stage-pdf';const pdf=await d.blobs.putOnce(`field-mobile-staging/${uid}/reports/${recordId}.pdf`,rendered);
    assert(pdf.length<=RECORD_LIMITS.pdfBytes&&pdf.subarray(0,5).toString()==='%PDF-','REPORT_PDF_INVALID',422);
    stage='drive-folder';const folderId=a.folderId||await d.drive.folder('reports',[{key:'field-work-reports',name:'현장노트 작업보고서'},{key:v.workDate.slice(0,4),name:v.workDate.slice(0,4)}]);
    const candidate=a.driveFileId||await d.drive.generateId();
    a=await d.store.change<ArchiveRecord>(path,old=>{assert(old&&old.contentHash===v.contentHash,'REVISION_CONFLICT',409);return{...old,driveFileId:old.driveFileId||candidate,folderId:old.folderId||folderId};});
    stage='drive-upload';await d.recheck();await d.drive.upload(a.driveFileId!,a.folderId!,`${recordId}.pdf`,'application/pdf',pdf,recordId);
    await d.recheck();const latest=await visit(v.id);assert(latest.contentHash===v.contentHash,'REVISION_CONFLICT',409);
    const customer=await d.sites.readCustomer(v.customerId);assert(object(customer),'SITE_NOT_FOUND',404);
    const phone=String(customer.phone||'').replace(/\D/g,'');const recipientPhone=/^01\d{8,9}$/.test(phone)?phone:'';
    const document={id:recordId,title:`${v.site.name} ${v.workDate} 작업 결과보고서`.slice(0,160),buildingId:'',customerId:v.customerId,docType:'etc',driveFileId:a.driveFileId,updatedAt:v.updatedAt,updatedBy:uid,
      savedCustomerDocument:{version:1,kind:'workReport',customerId:v.customerId,recipientPhone,reportId,reportUpdatedAt:v.updatedAt,sha256:hash(pdf),size:pdf.length,month:''}};
    stage='crm-link';await d.store.commit({...report,customerId:v.customerId},document);
    a=await d.store.change<ArchiveRecord>(path,old=>{assert(old&&old.contentHash===v.contentHash,'REVISION_CONFLICT',409);return{...old,ready:true,archivedAt:old.archivedAt||nowIso()};});
    await d.blobs.remove?.(`field-mobile-staging/${uid}/reports/${recordId}.pdf`).catch(()=>undefined);
    return{documentId:a.id,revision:a.revision,archivedAt:a.archivedAt,driveVerified:true,crmLinked:true};
    }catch(error){
      const e=error as {code?:unknown};const safeCodes=['DRIVE_NOT_CONFIGURED','DRIVE_RECONNECT_REQUIRED','DRIVE_STORAGE_FULL','DRIVE_FOLDER_ACCESS_REQUIRED','DRIVE_UNAVAILABLE','DRIVE_FILE_MISMATCH','PHOTO_INTEGRITY_FAILED','REPORT_PDF_INVALID','REPORT_PHOTO_BYTES_LIMIT','UPLOAD_STORAGE_UNAVAILABLE','CRM_RECORD_CHANGED'];
      console.warn(JSON.stringify({event:'field_archive_failure',stage,...(typeof e?.code==='string'&&safeCodes.includes(e.code)?{code:e.code}:{})}));throw error;
    }
  }
  return {save,reserve,chunk,complete,archive,status:async(id:string)=>uploadStatus(await upload(id)),storageStatus:async()=>{await d.drive.checkRoots();return{photos:true,reports:true};}};
}
