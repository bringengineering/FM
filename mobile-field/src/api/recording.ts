import { CompanySiteApi } from './sites';
import { FieldError, type Photo, type Visit } from '../domain/model';
import { readJsonBounded } from './client';
import { reportFacts } from '../domain/ai-report';
export interface ArchiveReceipt {documentId:string;revision:number;archivedAt:string;driveVerified:true;crmLinked:true}
export interface DeliveryPreview {documentId:string;customer:string;address:string;workName:string;recipient:string;fingerprint:string;status:'ready'|'sending'|'requested'|'delivered'|'failed'|'unknown'}
export class CompanyRecordingApi extends CompanySiteApi {
  private deliveryResult(value:any,id:string):DeliveryPreview{
    if(value?.documentId!==id || typeof value.customer!=='string' || typeof value.address!=='string' || typeof value.workName!=='string' || !/^01\d-\*\*\*\*-\d{4}$/.test(value.recipient||'') || !/^[a-f0-9]{64}$/.test(value.fingerprint||'') || !['ready','sending','requested','delivered','failed','unknown'].includes(value.status))throw new FieldError('SERVER_RESPONSE_INVALID');
    return value as DeliveryPreview;
  }
  async deliveryStatus(id:string,signal:AbortSignal):Promise<DeliveryPreview>{if(!/^saved_wr_[a-f0-9]{40}$/.test(id))throw new FieldError('REQUEST_INVALID');return this.deliveryResult(await this.request(`/deliveries/${id}`,'GET',undefined,signal),id);}
  async sendReport(preview:DeliveryPreview,signal:AbortSignal):Promise<DeliveryPreview>{if(preview.status!=='ready'&&preview.status!=='failed')throw new FieldError('DELIVERY_ALREADY_REQUESTED');return this.deliveryResult(await this.request(`/deliveries/${preview.documentId}`,'POST',JSON.stringify({fingerprint:preview.fingerprint}),signal),preview.documentId);}
  async aiReport(visit:Visit,photos:Photo[],signal:AbortSignal):Promise<string>{
    if(visit.ownerUid!==this.uid)throw new FieldError('OWNER_MISMATCH');
    const content=reportFacts(visit,photos),credentials=await this.credentials();
    if(credentials.uid!==this.uid||!credentials.idToken||!credentials.appCheckToken)throw new FieldError('AUTH_REQUIRED');
    const controller=new AbortController(),abort=()=>controller.abort();
    if(signal.aborted)throw new FieldError('SYNC_CANCELLED');
    signal.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,60_000);
    try{
      const response=await this.fetcher('https://bring-crm-ai-gateway.bringengineering1008.workers.dev/v1/field-report-draft',{
        method:'POST',redirect:'error',signal:controller.signal,headers:{authorization:`Bearer ${credentials.idToken}`,'x-firebase-appcheck':credentials.appCheckToken,'content-type':'application/json',accept:'application/json'},
        body:JSON.stringify(content),
      });
      if(response.status===401)throw new FieldError('AUTH_REQUIRED');
      if(response.status===403)throw new FieldError('AI_ACCESS_REQUIRED');
      if(!response.ok)throw new FieldError('AI_UNAVAILABLE');
      const result=await readJsonBounded(response) as {ok?:unknown;result?:{text?:unknown}};
      const text=typeof result?.result?.text==='string'?result.result.text.trim():'';
      if(result?.ok!==true||!text||text.length>2000)throw new FieldError('AI_UNAVAILABLE');
      return text;
    }catch(error){if(error instanceof FieldError)throw error;throw new FieldError('AI_UNAVAILABLE');}
    finally{clearTimeout(timer);signal.removeEventListener('abort',abort);controller.abort();}
  }
  async recordingContext(signal:AbortSignal):Promise<void>{const v=await this.request('/recording/context','GET',undefined,signal) as any;if(v?.schemaVersion!==2||v?.actor?.uid!==this.uid||v?.capabilities?.capture!==true||v?.capabilities?.archiveReport!==true||v?.capabilities?.sendCustomerReport!==false)throw new FieldError('SERVER_RESPONSE_INVALID');}
  async storageStatus(signal:AbortSignal):Promise<void>{const v=await this.request('/recording/storage','GET',undefined,signal) as any;if(v?.photos!==true||v?.reports!==true)throw new FieldError('SERVER_RESPONSE_INVALID');}
  async reconcile(visit:Visit,photos:Photo[],signal:AbortSignal):Promise<{revision:number;photoIds:string[]}>{
    if(visit.ownerUid!==this.uid||!visit.job.customerId||photos.some(p=>p.visitId!==visit.id||p.ownerUid!==this.uid))throw new FieldError('OWNER_MISMATCH');
    const body={customerId:visit.job.customerId,kind:visit.job.kind,workDate:visit.job.workDate,revision:visit.revision,draft:visit.draft,photos:photos.map(({id,itemKey,phase,caption,included,capturedAt,mime,bytes,sha256,width,height,pairWith})=>({id,itemKey,phase,caption,included,capturedAt,mime,bytes,sha256,width,height,...(pairWith?{pairWith}:{})}))};
    const v=await this.request(`/visits/${visit.id}`,'PUT',JSON.stringify(body),signal) as any;
    if(v?.visitId!==visit.id||v?.revision!==visit.revision||!Array.isArray(v.photoIds)||v.photoIds.length!==photos.length||new Set(v.photoIds).size!==photos.length||photos.some(p=>!v.photoIds.includes(p.id)))throw new FieldError('SERVER_RESPONSE_INVALID');
    return{revision:v.revision,photoIds:v.photoIds};
  }
  async archive(visit:Visit,signal:AbortSignal):Promise<ArchiveReceipt>{
    const v=await this.request(`/visits/${visit.id}/archive`,'POST',JSON.stringify({revision:visit.revision,...(visit.captureAreas?.length?{captureAreas:visit.captureAreas}:{}),...(visit.legacyArchive?.revision===visit.revision&&visit.legacyArchive.plan.length?{legacyPlan:visit.legacyArchive.plan}:{})}),signal) as any;
    if(!/^saved_wr_[a-f0-9]{40}$/.test(v?.documentId||'')||v?.revision!==visit.revision||typeof v.archivedAt!=='string'||!Number.isFinite(Date.parse(v.archivedAt))||v.driveVerified!==true||v.crmLinked!==true)throw new FieldError('SERVER_RESPONSE_INVALID');return v;
  }
  // 건물주 안내(퇴실 → 입주 5단계) 알림톡. 서버가 호실 → 건물 → 건물주를 다시 찾고 관리자만 허용한다.
  async ownerNoticeUnits(signal:AbortSignal):Promise<{units:OwnerNoticeUnit[];truncated:boolean}>{
    const v=await this.request('/owner-notices/units','GET',undefined,signal) as any;
    if(!v||!Array.isArray(v.units)||v.units.length>250||typeof v.truncated!=='boolean'||!v.units.every(ownerNoticeUnit))throw new FieldError('SERVER_RESPONSE_INVALID');
    return {units:v.units,truncated:v.truncated};
  }
  async sendOwnerNotice(input:{requestId:string;unitId:string;templateId:string;input:Record<string,string>;preview:string},signal:AbortSignal):Promise<OwnerNoticeReceipt>{
    if(!UUID.test(input.requestId)||!/^[A-Za-z0-9_-]{1,160}$/.test(input.unitId))throw new FieldError('REQUEST_INVALID');
    return ownerNoticeReceipt(await this.request('/owner-notices/send','POST',JSON.stringify(input),signal),input.requestId);
  }
  async ownerNoticeStatus(requestId:string,signal:AbortSignal):Promise<OwnerNoticeReceipt>{
    if(!UUID.test(requestId))throw new FieldError('REQUEST_INVALID');
    return ownerNoticeReceipt(await this.request(`/owner-notices/deliveries/${requestId}`,'GET',undefined,signal),requestId);
  }
}
export interface OwnerNoticeUnit {id:string;buildingId:string;building:string;address:string;unit:string;owner:string;recipient:string;nextStage:string;progress:{id:string;count:number;lastSentAt:string}[]}
export interface OwnerNoticeReceipt {requestId:string;status:'accepted'|'delivered'|'failed'|'unknown';recipient?:string}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const short=(v:unknown,max:number)=>typeof v==='string'&&v.length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
function ownerNoticeUnit(v:any):v is OwnerNoticeUnit{
  return !!v&&/^[A-Za-z0-9_-]{1,160}$/.test(v.id||'')&&/^[A-Za-z0-9_-]{1,160}$/.test(v.buildingId||'')&&short(v.building,60)&&short(v.address,80)&&short(v.unit,30)&&short(v.owner,60)&&/^01\d-\*\*\*\*-\d{4}$/.test(v.recipient||'')
    &&short(v.nextStage,60)&&Array.isArray(v.progress)&&v.progress.length<=10&&v.progress.every((p:any)=>short(p?.id,60)&&Number.isSafeInteger(p.count)&&p.count>=0&&short(p.lastSentAt,40));
}
function ownerNoticeReceipt(v:any,requestId:string):OwnerNoticeReceipt{
  if(v?.requestId!==requestId||!['accepted','delivered','failed','unknown'].includes(v.status)||(v.recipient!==undefined&&!/^01\d-\*\*\*\*-\d{4}$/.test(v.recipient)))throw new FieldError('SERVER_RESPONSE_INVALID');
  return {requestId,status:v.status,...(v.recipient?{recipient:v.recipient}:{})};
}
