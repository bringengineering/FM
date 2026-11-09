import { FieldError, type Visit } from './model';
import { catalog } from './report';

// The server names immutable archives from the owner, visit, revision and the
// same normalized capture plan. Deriving the identifier does not assert that a
// PDF exists: the authenticated server must confirm it before enabling sending.
export function archiveIdentity(visit:Visit,uid:string):string {
  if(visit.ownerUid!==uid)throw new FieldError('OWNER_MISMATCH');
  if(visit.draft.confirmedRevision!==visit.revision)throw new FieldError('REPORT_REVIEW_REQUIRED');
  if(!visit.captureAreas?.length)return JSON.stringify([uid,visit.id,visit.revision]);
  const items=catalog(visit.job.kind),valid=new Set(items.map(item=>item.key));
  if(visit.captureAreas.some(key=>!valid.has(key))||new Set(visit.captureAreas).size!==visit.captureAreas.length)throw new FieldError('CAPTURE_AREAS_INVALID');
  const selected=new Set(visit.captureAreas);
  for(const item of items)if((visit.draft.statuses[item.key]&&visit.draft.statuses[item.key]!=='recorded')||visit.draft.notes[item.key]?.trim())selected.add(item.key);
  return JSON.stringify([uid,visit.id,visit.revision,items.filter(item=>selected.has(item.key)).map(item=>item.key)]);
}
export async function archiveDocumentId(visit:Visit,uid:string,digest:(input:string)=>Promise<string>):Promise<string>{
  const value=await digest(archiveIdentity(visit,uid));
  if(!/^[a-f0-9]{64}$/.test(value))throw new FieldError('SERVER_RESPONSE_INVALID');
  return 'saved_wr_'+value.slice(0,40);
}
// 9개 구역으로 바뀌기 전에 이 판을 보관했다면 그때의 구역 목록으로 만든 ID가 먼저다. 없으면 지금 ID.
export async function archiveDocumentIds(visit:Visit,uid:string,digest:(input:string)=>Promise<string>):Promise<string[]>{
  const current=await archiveDocumentId(visit,uid,digest);
  if(visit.legacyArchive?.revision!==visit.revision||!visit.legacyArchive.plan.length)return [current];
  const value=await digest(JSON.stringify([uid,visit.id,visit.revision,visit.legacyArchive.plan]));
  if(!/^[a-f0-9]{64}$/.test(value))throw new FieldError('SERVER_RESPONSE_INVALID');
  const legacy='saved_wr_'+value.slice(0,40);
  return legacy===current?[current]:[legacy,current];
}
