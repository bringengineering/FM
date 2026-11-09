import {expect,it,vi} from 'vitest';
import sharp from 'sharp';
import {createRecordingService,type RecordingDependencies,type RecordingStore} from '../src/field-mobile/recording-service.js';
import {hash,RecordingError,type RecordingPhoto} from '../src/field-mobile/recording-model.js';
import {handleRecording,type RecordingRequest} from '../src/field-mobile/recording-http.js';
import {archiveDocumentId} from '../../mobile-field/src/domain/archive-lookup.js';
import type {Visit} from '../../mobile-field/src/domain/model.js';

async function setup(){
  const data=new Map<string,any>(),blobs=new Map<string,Buffer>(),files=new Map<string,Buffer>(),commits=new Map<string,any>();
  let next=0,active=true,lostUpload=false,lostCommit=false;
  const bytes=await sharp({create:{width:64,height:48,channels:3,background:'#215b90'}}).jpeg().toBuffer();
  const photo:RecordingPhoto={id:'photo-a',itemKey:'entrance',phase:'before',caption:'합성 시험',included:true,capturedAt:'2026-10-27T02:00:00.000Z',mime:'image/jpeg',bytes:bytes.length,sha256:hash(bytes),width:64,height:48};
  const input={customerId:'customer-a',kind:'common',workDate:'2026-10-27',revision:3,draft:{summary:'[TEST] 실제 현장 작업 아님',followUp:'연동 시험',statuses:{},notes:{},confirmedRevision:3},photos:[photo]};
  const store:RecordingStore={async get(path){return structuredClone(data.get(path)||null);},async change(path,change){const value=change(structuredClone(data.get(path)||null));data.set(path,structuredClone(value));return value;},async commit(report,doc){commits.set(String(report.id),report);if(lostCommit){lostCommit=false;throw Error('synthetic response loss');}commits.set(String(doc.id),doc);}};
  const deps:RecordingDependencies={store,blobs:{async putOnce(path,bytes){if(!blobs.has(path))blobs.set(path,Buffer.from(bytes));return blobs.get(path)!;},async read(path){if(!blobs.has(path))throw Error('missing');return blobs.get(path)!;}},
    sites:{async listCustomers(){return[];},async readCustomer(id){return active?{id,name:'[TEST] 합성 고객',address:'가상 현장 · 실제 주소 아님',phone:'01000000000'}:null;}},recheck:vi.fn(async()=>{}),
    drive:{checkRoots:vi.fn(async()=>{}),generateId:vi.fn(async()=>`drive-file-${++next}`),folder:vi.fn(async()=> 'folder-test'),upload:vi.fn(async(id,parent,name,mime,b,binding)=>{if(files.has(id))expect(hash(files.get(id)!)).toBe(hash(b));else files.set(id,Buffer.from(b));if(lostUpload){lostUpload=false;throw Error('synthetic response loss');}}),download:vi.fn(async(id,expected)=>{const b=files.get(id)!;expect(hash(b)).toBe(expected.sha256);return b;})},
    validateJpeg:async(b,p)=>{const image=sharp(b,{failOn:'warning',limitInputPixels:2400*2400});const m=await image.metadata();if(m.width!==p.width||m.height!==p.height)throw new RecordingError('PHOTO_INVALID',422);await image.raw().toBuffer();},pdf:vi.fn(async()=>Buffer.from('%PDF-1.7\nsynthetic test artifact only'))};
  const service=createRecordingService('staff-a',deps);
  async function reserve(){await service.save('visit-a',input);return service.reserve('visit-a',{expectedRevision:input.revision,photoId:photo.id,itemKey:photo.itemKey,phase:photo.phase,claimedCapturedAt:photo.capturedAt,mime:photo.mime,bytes:photo.bytes,sha256:photo.sha256,width:photo.width,height:photo.height,included:photo.included,caption:photo.caption},'photo_photo-a');}
  async function uploaded(){const u=await reserve();await service.chunk(u.uploadId,`bytes 0-${bytes.length-1}/${bytes.length}`,bytes);return u;}
  return{deps,service,input,photo,bytes,data,blobs,files,commits,reserve,uploaded,setDeleted:()=>{active=false;},loseUpload:()=>{lostUpload=true;},loseCommit:()=>{lostCommit=true;}};
}
it('saves customer-only visits, verifies images, archives once, and binds CRM to the selected customer',async()=>{
  const t=await setup(),u=await t.uploaded();expect((await t.service.complete(u.uploadId,'complete_photo-a')).state).toBe('ready');
  expect(t.deps.drive.folder).toHaveBeenCalledWith('photos',expect.arrayContaining([{key:'before',name:'작업 전'},{key:'entrance',name:'출입구'}]));
  const a=await t.service.archive('visit-a',{revision:3}),again=await t.service.archive('visit-a',{revision:3});expect(again).toEqual(a);expect(t.files.size).toBe(2);expect(t.commits.size).toBe(2);
  const doc=t.commits.get(a.documentId);expect(doc.buildingId).toBe('');expect(doc.customerId).toBe('customer-a');expect(doc.savedCustomerDocument.customerId).toBe('customer-a');expect(t.deps.pdf).toHaveBeenCalledTimes(1);
});
it('archives only the selected areas, reuses its identity, and retains legacy archives',async()=>{
  const t=await setup(),u=await t.uploaded();await t.service.complete(u.uploadId,'complete_photo-a');
  await expect(t.service.archive('visit-a',{revision:3,captureAreas:['corridor']})).rejects.toThrow('REPORT_INVALID');
  const scoped=await t.service.archive('visit-a',{revision:3,captureAreas:['entrance']});
  const local:Visit={id:'visit-a',ownerUid:'staff-a',job:{id:'customer-a_common',customerId:'customer-a',buildingId:'',title:'합성 고객',address:'가상 주소',kind:'common',workDate:t.input.workDate},revision:3,draft:t.input.draft,updatedAt:'2026-10-27T02:00:00.000Z',captureAreas:['entrance']};
  expect(await archiveDocumentId(local,'staff-a',async value=>hash(value))).toBe(scoped.documentId);
  expect(await t.service.archive('visit-a',{revision:3,captureAreas:['entrance']})).toEqual(scoped);
  expect(vi.mocked(t.deps.pdf).mock.calls[0][0].captureAreas).toEqual(['entrance']);
  const document=t.commits.get(scoped.documentId),report=t.commits.get(document.savedCustomerDocument.reportId);
  expect(report.items.map((item:{key:string})=>item.key)).toEqual(['entrance']);
  const legacy=await t.service.archive('visit-a',{revision:3});expect(legacy.documentId).not.toBe(scoped.documentId);
});
it('recovers lost Drive and CRM responses with the same file and document identifiers',async()=>{
  const t=await setup(),u=await t.uploaded();t.loseUpload();await expect(t.service.complete(u.uploadId,'complete_photo-a')).rejects.toThrow();await t.service.complete(u.uploadId,'complete_photo-a');expect(t.files.size).toBe(1);
  t.loseCommit();await expect(t.service.archive('visit-a',{revision:3})).rejects.toThrow();await t.service.archive('visit-a',{revision:3});expect(t.files.size).toBe(2);expect(t.commits.size).toBe(2);
});
it('archives up to 100 classified photos without dropping any from the report',async()=>{
  const t=await setup(),photos=Array.from({length:100},(_,i)=>({...t.photo,id:`photo-${i}`}));await t.service.save('visit-a',{...t.input,photos});
  for(const p of photos){const u=await t.service.reserve('visit-a',{expectedRevision:t.input.revision,photoId:p.id,itemKey:p.itemKey,phase:p.phase,claimedCapturedAt:p.capturedAt,mime:p.mime,bytes:p.bytes,sha256:p.sha256,width:p.width,height:p.height,included:p.included,caption:p.caption},`photo_${p.id}`);await t.service.chunk(u.uploadId,`bytes 0-${t.bytes.length-1}/${t.bytes.length}`,t.bytes);await t.service.complete(u.uploadId,`complete_${p.id}`);}
  await t.service.archive('visit-a',{revision:t.input.revision});expect(vi.mocked(t.deps.pdf).mock.calls[0][1]).toHaveLength(100);expect(t.files.size).toBe(101);
});
it('rejects a changed chunk without replacing the first accepted bytes',async()=>{
  const t=await setup(),u=await t.uploaded();const altered=Buffer.from(t.bytes);altered[5]^=1;await expect(t.service.chunk(u.uploadId,`bytes 0-${altered.length-1}/${altered.length}`,altered)).rejects.toThrow('UPLOAD_CHUNK_CONFLICT');
  expect((await t.service.complete(u.uploadId,'complete_photo-a')).state).toBe('ready');
});
it('rejects corrupt bytes before writing to Drive',async()=>{
  const t=await setup(),u=await t.reserve(),altered=Buffer.from(t.bytes);altered[5]^=1;await t.service.chunk(u.uploadId,`bytes 0-${altered.length-1}/${altered.length}`,altered);await expect(t.service.complete(u.uploadId,'complete_photo-a')).rejects.toThrow('PHOTO_INTEGRITY_FAILED');expect(t.files.size).toBe(0);
});
it('rejects another employee, deleted customer, and revoked access before Drive writes',async()=>{
  const t=await setup(),u=await t.uploaded();await expect(createRecordingService('staff-b',t.deps).status(u.uploadId)).rejects.toThrow('UPLOAD_NOT_FOUND');
  vi.mocked(t.deps.recheck).mockRejectedValueOnce(new RecordingError('MOBILE_AUTH_REQUIRED',401));await expect(t.service.complete(u.uploadId,'complete_photo-a')).rejects.toThrow('MOBILE_AUTH_REQUIRED');expect(t.files.size).toBe(0);
  t.setDeleted();await expect(t.service.complete(u.uploadId,'complete_photo-a')).rejects.toThrow('SITE_NOT_FOUND');expect(t.files.size).toBe(0);
});
it('permits caption and inclusion edits while refusing byte or customer replacement',async()=>{
  const t=await setup(),u=await t.uploaded();await t.service.complete(u.uploadId,'complete_photo-a');
  const edited={...t.input,revision:4,draft:{...t.input.draft,confirmedRevision:4},photos:[{...t.photo,caption:'수정한 설명'}]};await t.service.save('visit-a',edited);await t.service.archive('visit-a',{revision:4});expect(vi.mocked(t.deps.pdf).mock.calls[0][1][0].photo.caption).toBe('수정한 설명');
  await expect(t.service.save('visit-a',{...edited,revision:5,draft:{...edited.draft,confirmedRevision:5},photos:[{...t.photo,sha256:'a'.repeat(64)}]})).rejects.toThrow('PHOTO_ALREADY_LINKED');
  await expect(t.service.save('visit-a',{...edited,customerId:'customer-b'})).rejects.toThrow('REVISION_CONFLICT');
});
it('rejects stale revisions and unreviewed drafts before PDF creation',async()=>{
  const t=await setup(),u=await t.uploaded();await t.service.complete(u.uploadId,'complete_photo-a');await expect(t.service.archive('visit-a',{revision:2})).rejects.toThrow('REPORT_REVIEW_REQUIRED');
  await t.service.save('visit-a',{...t.input,revision:4,draft:{...t.input.draft,confirmedRevision:undefined}});await expect(t.service.archive('visit-a',{revision:4})).rejects.toThrow('REPORT_REVIEW_REQUIRED');expect(t.deps.pdf).not.toHaveBeenCalled();
});
it('does not commit an archive if the draft changes during PDF rendering',async()=>{
  const t=await setup(),u=await t.uploaded();await t.service.complete(u.uploadId,'complete_photo-a');vi.mocked(t.deps.pdf).mockImplementationOnce(async()=>{await t.service.save('visit-a',{...t.input,revision:4,draft:{...t.input.draft,summary:'later',confirmedRevision:4}});return Buffer.from('%PDF-1.7\ntest');});
  await expect(t.service.archive('visit-a',{revision:3})).rejects.toThrow('REVISION_CONFLICT');expect(t.commits.size).toBe(0);
});
it('denies unauthenticated, malformed, oversized and unsupported HTTP requests without storage access',async()=>{
  const t=await setup(),factory=vi.fn(()=>t.deps),auth={projectId:'test',allowedNativeAppIds:['test'],verifyIdentity:vi.fn(),verifyAppCheck:vi.fn(),readAccess:vi.fn()};
  const request:RecordingRequest={method:'PUT',url:'/v1/field-app/visits/v',authorization:'',appCheck:'',contentType:'application/json',range:'',idempotencyKey:'',body:Buffer.from('{}')};
  expect((await handleRecording(request,{auth,allowRequest:()=>true,recording:factory})).status).toBe(401);
  expect((await handleRecording({...request,url:request.url+'?uid=other'},{auth,allowRequest:()=>true,recording:factory})).status).toBe(400);
  expect((await handleRecording({...request,body:Buffer.alloc(256*1024+1)},{auth,allowRequest:()=>true,recording:factory})).status).toBe(413);
  expect((await handleRecording({...request,method:'DELETE'},{auth,allowRequest:()=>true,recording:factory})).status).toBe(405);expect(factory).not.toHaveBeenCalled();
});

// 배포 전(구역 16개 시절)에 서버에 저장된 공용부 방문: 저장값은 예전 구역 이름 그대로다.
it('keeps pre-deploy common visits with legacy zones syncable, uploadable and archivable',async()=>{
  const t=await setup(),legacyPhoto={...t.photo,itemKey:'handrail',phase:'after' as const};
  const legacy={...t.input,draft:{...t.input.draft,statuses:{handrail:'done'},notes:{handrail:'난간 닦음'}},photos:[legacyPhoto]};
  await t.service.save('visit-a',legacy);
  const path='crmCompany/fieldMobile/visits/staff-a/visit-a',stored=t.data.get(path);
  // 예전 서버가 저장했던 모양으로 되돌린다(예전 구역 이름 + 그때의 contentHash).
  const old={customerId:legacy.customerId,kind:legacy.kind,workDate:legacy.workDate,revision:legacy.revision,draft:{summary:legacy.draft.summary,followUp:legacy.draft.followUp,statuses:{handrail:'done'},notes:{handrail:'난간 닦음'},confirmedRevision:3},photos:[{id:legacyPhoto.id,itemKey:'handrail',phase:'after',caption:legacyPhoto.caption,included:true,capturedAt:legacyPhoto.capturedAt,mime:legacyPhoto.mime,bytes:legacyPhoto.bytes,sha256:legacyPhoto.sha256,width:legacyPhoto.width,height:legacyPhoto.height}]};
  t.data.set(path,{...stored,draft:old.draft,photos:old.photos,contentHash:hash(JSON.stringify(old))});
  const mapped={...legacy,draft:{...legacy.draft,statuses:{stairs:'done'},notes:{stairs:'난간 닦음'}},photos:[{...legacyPhoto,itemKey:'stairs'}]};
  // 같은 판 재동기화: 0.1.16(지금 구역)도 0.1.15(예전 구역)도 통과한다.
  await expect(t.service.save('visit-a',mapped)).resolves.toMatchObject({revision:3});
  await expect(t.service.save('visit-a',legacy)).resolves.toMatchObject({revision:3});
  // 업로드: 지금 구역 이름으로 예약하고, Drive 폴더는 지금 구역 이름이다.
  const u=await t.service.reserve('visit-a',{expectedRevision:3,photoId:legacyPhoto.id,itemKey:'stairs',phase:'after',claimedCapturedAt:legacyPhoto.capturedAt,mime:legacyPhoto.mime,bytes:legacyPhoto.bytes,sha256:legacyPhoto.sha256,width:legacyPhoto.width,height:legacyPhoto.height,included:true,caption:legacyPhoto.caption},`photo_${legacyPhoto.id}`);
  await t.service.chunk(u.uploadId,`bytes 0-${t.bytes.length-1}/${t.bytes.length}`,t.bytes);
  expect((await t.service.complete(u.uploadId,`complete_${legacyPhoto.id}`)).state).toBe('ready');
  expect(t.deps.drive.folder).toHaveBeenCalledWith('photos',expect.arrayContaining([{key:'stairs',name:'계단'}]));
  // 보관: 0.1.15 가 보내는 예전 촬영 구역도 받는다.
  await expect(t.service.archive('visit-a',{revision:3,captureAreas:['handrail']})).resolves.toMatchObject({revision:3});
  // 다음 판 저장: 예전 사진이 지금 구역으로 와도 '이미 연결된 사진' 으로 막지 않는다.
  await expect(t.service.save('visit-a',{...mapped,revision:4,draft:{...mapped.draft,confirmedRevision:undefined}})).resolves.toMatchObject({revision:4});
});

it('reuses an archive made before the zone change instead of creating a second PDF',async()=>{
  const t=await setup(),legacyPhoto={...t.photo,itemKey:'handrail',phase:'after' as const};
  await t.service.save('visit-a',{...t.input,photos:[legacyPhoto]});
  const u=await t.service.reserve('visit-a',{expectedRevision:3,photoId:legacyPhoto.id,itemKey:'stairs',phase:'after',claimedCapturedAt:legacyPhoto.capturedAt,mime:legacyPhoto.mime,bytes:legacyPhoto.bytes,sha256:legacyPhoto.sha256,width:legacyPhoto.width,height:legacyPhoto.height,included:true,caption:legacyPhoto.caption},`photo_${legacyPhoto.id}`);
  await t.service.chunk(u.uploadId,`bytes 0-${t.bytes.length-1}/${t.bytes.length}`,t.bytes);await t.service.complete(u.uploadId,`complete_${legacyPhoto.id}`);
  const legacyId='saved_wr_'+hash(JSON.stringify(['staff-a','visit-a',3,['handrail']])).slice(0,40),v=t.data.get('crmCompany/fieldMobile/visits/staff-a/visit-a');
  t.data.set(`crmCompany/fieldMobile/archives/staff-a/${legacyId}`,{id:legacyId,visitId:'visit-a',revision:3,ownerUid:'staff-a',contentHash:v.contentHash,reportId:'fm_legacy',ready:true,archivedAt:'2026-11-01T00:00:00.000Z'});
  const viaApp=await t.service.archive('visit-a',{revision:3,captureAreas:['stairs'],legacyPlan:['handrail']});
  expect(viaApp.documentId).toBe(legacyId);
  const viaOldApp=await t.service.archive('visit-a',{revision:3,captureAreas:['handrail']});
  expect(viaOldApp.documentId).toBe(legacyId);
  expect(t.files.size).toBe(1);
});
