import { CompanySiteApi } from './sites';
import { FieldError, type Photo, type Visit } from '../domain/model';
export interface ArchiveReceipt {documentId:string;revision:number;archivedAt:string;driveVerified:true;crmLinked:true}
export class CompanyRecordingApi extends CompanySiteApi {
  async recordingContext(signal:AbortSignal):Promise<void>{const v=await this.request('/recording/context','GET',undefined,signal) as any;if(v?.schemaVersion!==2||v?.actor?.uid!==this.uid||v?.capabilities?.capture!==true||v?.capabilities?.archiveReport!==true||v?.capabilities?.sendCustomerReport!==false)throw new FieldError('SERVER_RESPONSE_INVALID');}
  async storageStatus(signal:AbortSignal):Promise<void>{const v=await this.request('/recording/storage','GET',undefined,signal) as any;if(v?.photos!==true||v?.reports!==true)throw new FieldError('SERVER_RESPONSE_INVALID');}
  async reconcile(visit:Visit,photos:Photo[],signal:AbortSignal):Promise<{revision:number;photoIds:string[]}>{
    if(visit.ownerUid!==this.uid||!visit.job.customerId||photos.some(p=>p.visitId!==visit.id||p.ownerUid!==this.uid))throw new FieldError('OWNER_MISMATCH');
    const body={customerId:visit.job.customerId,kind:visit.job.kind,workDate:visit.job.workDate,revision:visit.revision,draft:visit.draft,photos:photos.map(({id,itemKey,phase,caption,included,capturedAt,mime,bytes,sha256,width,height})=>({id,itemKey,phase,caption,included,capturedAt,mime,bytes,sha256,width,height}))};
    const v=await this.request(`/visits/${visit.id}`,'PUT',JSON.stringify(body),signal) as any;
    if(v?.visitId!==visit.id||v?.revision!==visit.revision||!Array.isArray(v.photoIds)||v.photoIds.length!==photos.length||new Set(v.photoIds).size!==photos.length||photos.some(p=>!v.photoIds.includes(p.id)))throw new FieldError('SERVER_RESPONSE_INVALID');
    return{revision:v.revision,photoIds:v.photoIds};
  }
  async archive(visit:Visit,signal:AbortSignal):Promise<ArchiveReceipt>{
    const v=await this.request(`/visits/${visit.id}/archive`,'POST',JSON.stringify({revision:visit.revision}),signal) as any;
    if(!/^saved_wr_[a-f0-9]{40}$/.test(v?.documentId||'')||v?.revision!==visit.revision||typeof v.archivedAt!=='string'||!Number.isFinite(Date.parse(v.archivedAt))||v.driveVerified!==true||v.crmLinked!==true)throw new FieldError('SERVER_RESPONSE_INVALID');return v;
  }
}
