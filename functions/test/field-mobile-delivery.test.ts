import {expect,it,vi} from 'vitest';
import {createDeliveryService,type DeliveryDeps} from '../src/field-mobile/delivery.js';
import {hash,RecordingError} from '../src/field-mobile/recording-model.js';

function setup(){
  const id='saved_wr_'+ 'a'.repeat(40),bytes=Buffer.from('%PDF-1.7\nsynthetic only'),sha=hash(bytes),uid='staff-a';
  const visit:any={id:'visit-a',ownerUid:uid,customerId:'customer-a',revision:1,contentHash:'content',site:{id:'customer-a',name:'시험',address:'서울 강남구 테스트로 12'}};
  const archive:any={id,visitId:visit.id,revision:1,ownerUid:uid,contentHash:'content',ready:true,driveFileId:'drive-file',reportId:'report-a'};
  let doc:any={id,customerId:'customer-a',driveFileId:'drive-file',updatedAt:'2026-10-29T00:00:00Z',savedCustomerDocument:{kind:'workReport',customerId:'customer-a',reportId:'report-a',reportUpdatedAt:'2026-10-29T00:00:00Z',recipientPhone:'01000000000',sha256:sha,size:bytes.length}};
  let customer:any={id:'customer-a',name:'합성 고객',address:'서울 강남구 테스트로 12',phone:'01000000000'};
  const report:any={id:'report-a',customerId:'customer-a',siteAddress:'서울 강남구 테스트로 12',kind:'common',updatedAt:'2026-10-29T00:00:00Z'};
  const d:DeliveryDeps={archive:async(u,i)=>u===uid&&i===id?structuredClone(archive):null,visit:async(u)=>u===uid?structuredClone(visit):null,document:async()=>structuredClone(doc),report:async()=>structuredClone(report),
    sites:{listCustomers:async()=>[],readCustomer:async()=>structuredClone(customer)},download:vi.fn(async()=>bytes),recheck:vi.fn(async()=>{}),
    claim:vi.fn(async(_id,expected,actor)=>{if(doc.workReportDelivery&&doc.workReportDelivery.status!=='failed')throw Error('already');if(doc.savedCustomerDocument.sha256!==expected.sha256)throw Error('changed');doc.workReportDelivery={status:'sending',requestedBy:actor};}),
    finish:vi.fn(async(_id,actor,patch)=>{if(doc.workReportDelivery.requestedBy!==actor)throw Error('owner');doc.workReportDelivery={...doc.workReportDelivery,...patch};}),
    bridge:vi.fn(async(method)=>method==='POST'?{ok:true,status:'requested',messageId:'message-test'}:{ok:true,status:'delivered',messageId:'message-test'})};
  return{id,bytes,d,service:createDeliveryService(uid,d),setPhone:(p:string)=>{customer.phone=p;},getDoc:()=>doc};
}
it('sends only the selected stored PDF to its current CRM recipient and checks delivery',async()=>{
  const t=setup(),p=await t.service.preview(t.id);expect(p.recipient).toBe('010-****-0000');
  expect((await t.service.send(t.id,{fingerprint:p.fingerprint})).status).toBe('requested');
  expect(vi.mocked(t.d.bridge).mock.calls[0][2]).toMatchObject({documentId:t.id,documentType:'completion_report',delivery:{phone:'01000000000',channel:'kakao'}});
  expect((await t.service.status(t.id)).status).toBe('delivered');
  await expect(t.service.send(t.id,{fingerprint:p.fingerprint})).rejects.toThrow('DELIVERY_ALREADY_REQUESTED');
  expect(vi.mocked(t.d.bridge).mock.calls.filter(c=>c[0]==='POST')).toHaveLength(1);
});
it('does not allow another employee, changed recipient, altered confirmation, or arbitrary request fields',async()=>{
  const t=setup(),p=await t.service.preview(t.id);
  await expect(createDeliveryService('staff-b',t.d).preview(t.id)).rejects.toThrow('DELIVERY_NOT_FOUND');
  await expect(t.service.send(t.id,{fingerprint:p.fingerprint,phone:'01011111111'})).rejects.toThrow('REQUEST_INVALID');
  t.setPhone('01011111111');await expect(t.service.send(t.id,{fingerprint:p.fingerprint})).rejects.toThrow('DELIVERY_RECIPIENT_CHANGED');
  expect(t.d.bridge).not.toHaveBeenCalled();
});
it('preserves unknown state after a lost response and never retries the provider automatically',async()=>{
  const t=setup(),p=await t.service.preview(t.id);vi.mocked(t.d.bridge).mockRejectedValueOnce(Error('response lost'));
  await expect(t.service.send(t.id,{fingerprint:p.fingerprint})).rejects.toThrow('DELIVERY_STATUS_UNKNOWN');
  expect(t.getDoc().workReportDelivery.status).toBe('unknown');
  await expect(t.service.send(t.id,{fingerprint:p.fingerprint})).rejects.toThrow('DELIVERY_ALREADY_REQUESTED');
  expect(vi.mocked(t.d.bridge).mock.calls.filter(c=>c[0]==='POST')).toHaveLength(1);
});
it('rejects corrupted PDF before claiming or sending',async()=>{
  const t=setup(),p=await t.service.preview(t.id);vi.mocked(t.d.download).mockResolvedValueOnce(Buffer.from('%PDF-wrong'));
  await expect(t.service.send(t.id,{fingerprint:p.fingerprint})).rejects.toThrow('DRIVE_FILE_MISMATCH');expect(t.d.claim).not.toHaveBeenCalled();expect(t.d.bridge).not.toHaveBeenCalled();
});
it('allows a deliberate retry only when the provider definitively rejected the request',async()=>{
  const t=setup(),p=await t.service.preview(t.id);vi.mocked(t.d.bridge).mockRejectedValueOnce(new RecordingError('DELIVERY_REJECTED',409));
  await expect(t.service.send(t.id,{fingerprint:p.fingerprint})).rejects.toThrow('DELIVERY_REJECTED');
  expect(t.getDoc().workReportDelivery.status).toBe('failed');
  expect((await t.service.send(t.id,{fingerprint:p.fingerprint})).status).toBe('requested');
});
