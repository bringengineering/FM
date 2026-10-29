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
  expect(t.deps.drive.folder).toHaveBeenCalledWith('photos',expect.arrayContaining([{key:'before',name:'작업 전'},{key:'entrance',name:'출입구·현관'}]));
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
