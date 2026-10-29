import {createRequire} from 'node:module';
import {assert, hash, object, RecordingError, type ArchiveRecord, type Recording} from './recording-model.js';
import {getCustomerSite, siteId, type CustomerSiteReads} from './sites.js';

const message = createRequire(import.meta.url)('../../../desktop-crm/src/work-report-message.js') as {details(report:unknown,building:unknown):{buildingAddress:string;workName:string};documentName(details:unknown):string};
type Row = Record<string, any>;
export interface DeliveryDeps {
  archive(uid:string,id:string):Promise<ArchiveRecord|null>; visit(uid:string,id:string):Promise<Recording|null>;
  document(id:string):Promise<Row|null>; report(id:string):Promise<Row|null>; sites:CustomerSiteReads;
  claim(id:string, expected:{sha256:string;updatedAt:string},uid:string):Promise<void>;
  finish(id:string,uid:string, patch:Row):Promise<void>;
  download(id:string,expected:{sha256:string;bytes:number}):Promise<Buffer>;
  bridge(method:'GET'|'POST',path:string,input?:unknown):Promise<Row>;
  recheck():Promise<void>;
}
const base = '/v1/field-report-delivery';
const live = (v:unknown):v is Row => object(v) && !v.deletedAt && !v.archivedAt && v.deleted!==true && v.archived!==true;
const phone = (value:unknown) => String(value||'').replace(/\D/g,'');
function mask(value:string){return `${value.slice(0,3)}-****-${value.slice(-4)}`;}
export function createDeliveryService(uid:string,d:DeliveryDeps){
  async function binding(id:string){
    assert(siteId(uid) && /^saved_wr_[a-f0-9]{40}$/.test(id));
    const a=await d.archive(uid,id);assert(a?.ready && a.ownerUid===uid && a.id===id,'DELIVERY_NOT_FOUND',404);
    const v=await d.visit(uid,a.visitId);assert(v && v.ownerUid===uid && v.id===a.visitId && v.revision===a.revision && v.contentHash===a.contentHash,'DELIVERY_CHANGED',409);
    const doc=await d.document(id);assert(live(doc) && doc.id===id && doc.customerId===v.customerId && doc.driveFileId===a.driveFileId,'DELIVERY_CHANGED',409);
    const saved=doc.savedCustomerDocument;assert(object(saved) && saved.kind==='workReport' && saved.customerId===v.customerId && saved.reportId===a.reportId && /^[a-f0-9]{64}$/.test(saved.sha256) && Number.isSafeInteger(saved.size) && saved.size>0 && saved.size<=12*1024*1024,'DELIVERY_CHANGED',409);
    const report=await d.report(saved.reportId);assert(live(report) && report.id===saved.reportId && report.customerId===v.customerId && report.updatedAt===saved.reportUpdatedAt,'DELIVERY_CHANGED',409);
    const site=await getCustomerSite(v.customerId,d.sites), customer=await d.sites.readCustomer(v.customerId);assert(live(customer) && customer.id===v.customerId,'DELIVERY_CHANGED',409);
    const recipient=phone(customer.phone);assert(/^01\d{8,9}$/.test(recipient) && recipient===saved.recipientPhone,'DELIVERY_RECIPIENT_CHANGED',409);
    let details;try{details=message.details(report,{});}catch{throw new RecordingError('SITE_ADDRESS_REQUIRED',422);}
    const fingerprint=hash(JSON.stringify([id,doc.updatedAt,saved.sha256,recipient,details]));
    return {a,v,doc,saved,report,site,customer,recipient,details,fingerprint};
  }
  const presentation=(b:Awaited<ReturnType<typeof binding>>)=>({documentId:b.doc.id,customer:b.site.name,address:b.details.buildingAddress,workName:b.details.workName,recipient:mask(b.recipient),fingerprint:b.fingerprint,status:b.doc.workReportDelivery?.status||'ready'});
  async function preview(id:string){const b=await binding(id);return presentation(b);}
  async function send(id:string,input:unknown){
    assert(object(input) && Object.keys(input).length===1 && typeof input.fingerprint==='string' && /^[a-f0-9]{64}$/.test(input.fingerprint));
    let b=await binding(id);assert(input.fingerprint===b.fingerprint,'DELIVERY_CHANGED',409);
    assert(!b.doc.workReportDelivery || b.doc.workReportDelivery.status==='failed','DELIVERY_ALREADY_REQUESTED',409);
    const bytes=await d.download(b.doc.driveFileId,{sha256:b.saved.sha256,bytes:b.saved.size});
    assert(bytes.length===b.saved.size && hash(bytes)===b.saved.sha256 && bytes.subarray(0,5).toString()==='%PDF-','DRIVE_FILE_MISMATCH',409);
    await d.recheck(); await d.claim(id,{sha256:b.saved.sha256,updatedAt:b.doc.updatedAt},uid);
    let started=false;
    try{
      const fresh=await binding(id);assert(fresh.fingerprint===input.fingerprint,'DELIVERY_CHANGED',409);await d.recheck();b=fresh;
      const payload={documentId:id,customerId:'wr_'+hash(id).slice(0,40),documentType:'completion_report',documentName:message.documentName(b.details),completionReport:b.details,
        expiresAt:new Date(Date.now()+7*86400000).toISOString(),mimeType:'application/pdf',bytes:bytes.toString('base64'),
        delivery:{channel:'kakao',idempotencyKey:'wr_'+hash(id+b.saved.sha256).slice(0,48),customerName:String(b.customer.name||b.customer.company||'건물주').slice(0,160),phone:b.recipient}};
      started=true;const response=await d.bridge('POST',`${base}/send`,payload);
      const safeStatus=response.status==='requested'?'requested':response.status==='delivered'?'delivered':'unknown';
      assert(response.ok===true && /^[A-Za-z0-9_-]{1,120}$/.test(response.messageId||''),'DELIVERY_STATUS_UNKNOWN',503);
      await d.finish(id,uid,{status:safeStatus,messageId:response.messageId});return {...presentation(b),status:safeStatus};
    }catch(error){const rejected=error instanceof RecordingError && error.code==='DELIVERY_REJECTED';await d.finish(id,uid,{status:started&&!rejected?'unknown':'failed',messageId:''}).catch(()=>undefined);throw started&&!rejected?new RecordingError('DELIVERY_STATUS_UNKNOWN',503):error;}
  }
  async function status(id:string){
    const b=await binding(id),existing=b.doc.workReportDelivery;
    if(existing && ['sending','requested','unknown'].includes(existing.status)){
      try{
        let messageId=existing.messageId;
        if(!messageId){const found=await d.bridge('GET',`${base}/lookup/wr_${hash(id+b.saved.sha256).slice(0,48)}`);if(found.ok===true && /^[A-Za-z0-9_-]{1,120}$/.test(found.messageId||''))messageId=found.messageId;}
        if(messageId){const response=await d.bridge('GET',`${base}/status/${messageId}`);if((response.ok===true||response.ok===false&&response.status==='failed') && ['requested','delivered','failed','unknown'].includes(response.status)){await d.finish(id,existing.requestedBy||uid,{status:response.status,messageId});return {...presentation(b),status:response.status};}}
      }catch{/* preserve uncertain state */}
    }
    return presentation(b);
  }
  return {preview,send,status};
}

export function deliveryBridge(fetcher:typeof fetch=fetch){
  return async(method:'GET'|'POST',path:string,input?:unknown):Promise<Row>=>{
    const body=method==='POST'?JSON.stringify(input):'',bodyHash=hash(body);
    const audience=`https://bring-crm-ai-gateway.bringengineering1008.workers.dev${path}?method=${method}&sha256=${bodyHash}`;
    const metadata=new URL('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity');
    metadata.searchParams.set('audience',audience);metadata.searchParams.set('format','full');
    const credential=await fetcher(metadata.href,{headers:{'Metadata-Flavor':'Google'},redirect:'error',signal:AbortSignal.timeout(10000)});
    assert(credential.ok,'DELIVERY_UNAVAILABLE',503);const token=await credential.text();assert(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)&&token.length<=12000,'DELIVERY_UNAVAILABLE',503);
    const response=await fetcher(`https://bring-crm-ai-gateway.bringengineering1008.workers.dev${path}`,{method,redirect:'error',signal:AbortSignal.timeout(60000),headers:{'content-type':'application/json','authorization':`Bearer ${token}`,'x-field-body-sha256':bodyHash},...(method==='POST'?{body}:{})});
    const value=await response.json() as Row;
    if(!response.ok||!object(value)){
      const rejected=['DELIVERY_UNAVAILABLE','DELIVERY_CONFIGURATION_ERROR','DELIVERY_PROVIDER_AUTH_FAILED','DELIVERY_PROVIDER_SERVICE_NOT_FOUND','DELIVERY_PROVIDER_LIMITED','DELIVERY_PROVIDER_REJECTED'];
      if(object(value)&&value.ok===false&&rejected.includes(value.code))throw new RecordingError('DELIVERY_REJECTED',409);
      throw new RecordingError('DELIVERY_STATUS_UNKNOWN',503);
    }
    return value;
  };
}
