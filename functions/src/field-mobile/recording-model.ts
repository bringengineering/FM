import { createHash } from 'node:crypto';
import { reportCore } from './report-core.js';
import { siteId, type CustomerSite } from './sites.js';

export const RECORD_LIMITS = {bytes: 20 * 1024 * 1024, chunk: 1024 * 1024, photos: 100, pdfBytes: 12 * 1024 * 1024, pdfPhotos: 100, pdfSourceBytes: 64 * 1024 * 1024};
export class RecordingError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}
export function assert(condition: unknown, code = 'REQUEST_INVALID', status = 400): asserts condition { if (!condition) throw new RecordingError(code, status); }
export const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
export const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
export const nowIso = () => new Date().toISOString();
const bounded = (v: unknown, max: number, multiline = false): v is string => typeof v === 'string' && v.length <= max && !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(v);
export interface RecordingPhoto {id: string; itemKey: string; phase: 'before'|'during'|'after'; caption: string; included: boolean; capturedAt: string; mime: 'image/jpeg'; bytes: number; sha256: string; width: number; height: number; pairWith?: string}
export interface RecordingInput {customerId: string; kind: 'common'|'moveIn'; workDate: string; revision: number; draft: {summary: string; followUp: string; statuses: Record<string,string>; notes: Record<string,string>; confirmedRevision?: number}; photos: RecordingPhoto[]}
export interface Recording extends RecordingInput {id: string; ownerUid: string; site: CustomerSite; contentHash: string; createdAt: string; updatedAt: string; captureAreas?:string[]}
export interface UploadRecord {id: string; ownerUid: string; visitId: string; photo: RecordingPhoto; receivedBytes: number; state: 'uploading'|'ready'; driveFileId?: string; folderId?: string; createdAt: string}
export interface ArchiveRecord {id: string; visitId: string; revision: number; ownerUid: string; contentHash: string; driveFileId?: string; folderId?: string; ready?: boolean; archivedAt?: string; reportId: string}
// 공용부 구역을 양식의 9개로 줄이기 전(앱 0.1.15 이하)의 구역 이름은 지금 구역으로 받는다.
export const zoneFor = (kind: string, key: unknown): unknown => kind === 'common' && typeof key === 'string' ? reportCore.commonZoneFor(key) : key;
function zoneRecord(kind: string, record: Record<string, unknown>, merge: (a: string, b: string) => string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const zone = String(zoneFor(kind, key));
    out[zone] = zone in out && typeof out[zone] === 'string' && typeof value === 'string' ? merge(out[zone] as string, value) : value;
  }
  return out;
}
// 합친 구역의 상태: 실제로 한 기록(완료·일부)이 '못 함'·'기록'보다 앞선다.
const STATUS_RANK: Record<string, number> = { done: 3, partial: 2, skipped: 1, recorded: 0 };
const strongerStatus = (a: string, b: string) => (STATUS_RANK[b] ?? -1) > (STATUS_RANK[a] ?? -1) ? b : a;
// 배포 전에 저장된 방문·업로드 기록은 예전 구역 이름을 그대로 갖고 있다. 읽을 때 지금 구역으로 본다.
export function currentPhoto<T extends RecordingPhoto>(kind: string, p: T): T {
  const itemKey = String(zoneFor(kind, p.itemKey));
  return itemKey === p.itemKey ? p : { ...p, itemKey };
}
export function currentRecording(v: Recording): Recording {
  if (v.kind !== 'common') return v;
  const sorted = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b))) as Record<string, string>;
  return { ...v, photos: v.photos.map(p => currentPhoto(v.kind, p)),
    draft: { ...v.draft, statuses: sorted(zoneRecord(v.kind, v.draft.statuses, strongerStatus)), notes: sorted(zoneRecord(v.kind, v.draft.notes, (a, b) => [a, b].filter(Boolean).join(' / ').slice(0, 500))) },
    ...(v.captureAreas ? { captureAreas: [...new Set(v.captureAreas.map(key => String(zoneFor(v.kind, key))))] } : {}) };
}
// 같은 판을 다시 보냈는지 볼 때 쓴다. 저장값을 지금 구역으로 옮겨 입력과 같은 모양으로 다시 계산한다.
export function currentContentHash(v: Recording): string {
  try { return hash(JSON.stringify(recordingInput({ customerId: v.customerId, kind: v.kind, workDate: v.workDate, revision: v.revision, draft: v.draft, photos: v.photos }))); }
  catch { return ''; }
}
export function photoInput(v: unknown, kind: string): RecordingPhoto {
  assert(object(v));
  v = { ...v, itemKey: zoneFor(kind, v.itemKey) };
  assert(object(v));
  assert(siteId(v.id) && reportCore.itemCatalogFor(kind).some(i => i.key === v.itemKey));
  assert(['before','during','after'].includes(v.phase) && bounded(v.caption,120) && typeof v.included === 'boolean');
  assert(typeof v.capturedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v.capturedAt) && v.capturedAt.length <= 40 && Number.isFinite(Date.parse(v.capturedAt)));
  assert(v.mime === 'image/jpeg' && Number.isSafeInteger(v.bytes) && v.bytes >= 4 && v.bytes <= RECORD_LIMITS.bytes);
  assert(typeof v.sha256 === 'string' && /^[a-f0-9]{64}$/.test(v.sha256));
  assert(Number.isSafeInteger(v.width) && Number.isSafeInteger(v.height) && v.width > 0 && v.height > 0 && v.width <= 2400 && v.height <= 2400);
  assert(v.pairWith === undefined || (siteId(v.pairWith) && v.phase === 'after' && v.pairWith !== v.id));
  return {id:v.id,itemKey:v.itemKey,phase:v.phase,caption:v.caption,included:v.included,capturedAt:v.capturedAt,mime:v.mime,bytes:v.bytes,sha256:v.sha256,width:v.width,height:v.height,...(v.pairWith===undefined?{}:{pairWith:v.pairWith})};
}
export function recordingInput(v: unknown): RecordingInput {
  assert(object(v) && siteId(v.customerId) && ['common','moveIn'].includes(v.kind));
  assert(typeof v.workDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.workDate) && Number.isFinite(Date.parse(v.workDate)) && new Date(v.workDate).toISOString().slice(0,10) === v.workDate);
  assert(Number.isSafeInteger(v.revision) && v.revision >= 1 && v.revision <= 1_000_000 && object(v.draft));
  const keys=new Set(reportCore.itemCatalogFor(v.kind).map(i=>i.key));
  const d:Record<string,any>={...v.draft, ...(object(v.draft.statuses)?{statuses:zoneRecord(v.kind,v.draft.statuses,strongerStatus)}:{}), ...(object(v.draft.notes)?{notes:zoneRecord(v.kind,v.draft.notes,(a,b)=>[a,b].filter(Boolean).join(' / ').slice(0,500))}:{})};
  assert(bounded(d.summary,2000,true) && bounded(d.followUp,2000,true) && object(d.statuses) && object(d.notes));
  assert(Object.entries(d.statuses).every(([key,value])=>keys.has(key)&&['recorded','done','partial','skipped'].includes(String(value))));
  assert(Object.entries(d.notes).every(([key,value])=>keys.has(key)&&bounded(value,500,true)));
  assert(d.confirmedRevision === undefined || d.confirmedRevision === v.revision);
  assert(Array.isArray(v.photos) && v.photos.length <= RECORD_LIMITS.photos);
  const photos=v.photos.map(p=>photoInput(p,v.kind)).sort((a,b)=>a.id.localeCompare(b.id));
  assert(new Set(photos.map(p=>p.id)).size === photos.length);
  const sorted=(r:Record<string,string>)=>Object.fromEntries(Object.entries(r).sort(([a],[b])=>a.localeCompare(b)));
  return {customerId:v.customerId,kind:v.kind,workDate:v.workDate,revision:v.revision,draft:{summary:d.summary,followUp:d.followUp,statuses:sorted(d.statuses),notes:sorted(d.notes),...(d.confirmedRevision===undefined?{}:{confirmedRevision:d.confirmedRevision})},photos};
}
export const uploadKey = (uid:string,visitId:string,photoId:string) => 'up_'+hash(JSON.stringify([uid,visitId,photoId])).slice(0,48);
// Caption, inclusion and the before/after pairing stay editable after upload.
export function photoBinding(p:RecordingPhoto){const {caption,included,pairWith,...fixed}=p;return JSON.stringify(fixed);}
// Pairs captured on site: an included "after" photo lined up with an included
// "before" photo of the same area. Each before photo pairs once (earliest after
// wins); a pairing broken by a later area/phase edit is dropped.
export function capturedPairIds(photos:RecordingPhoto[]):Map<string,string>{
  const byId=new Map(photos.map(p=>[p.id,p])),ids=new Map<string,string>();
  const afters=photos.filter(p=>p.included&&p.phase==='after'&&p.pairWith).sort((a,b)=>Date.parse(a.capturedAt)-Date.parse(b.capturedAt)||a.id.localeCompare(b.id));
  for(const after of afters){
    const before=byId.get(after.pairWith!);
    if(!before||!before.included||before.phase!=='before'||before.itemKey!==after.itemKey||ids.has(before.id))continue;
    const id=`field:${before.id}|${after.id}`;ids.set(before.id,id);ids.set(after.id,id);
  }
  return ids;
}
export function uploadStatus(u:UploadRecord) { return {uploadId:u.id,photoId:u.photo.id,sha256:u.photo.sha256,totalBytes:u.photo.bytes,receivedBytes:u.receivedBytes,state:u.state,driveVerified:u.state==='ready',crmLinked:u.state==='ready'}; }
export function reportFor(v:Recording, uploads:UploadRecord[], reportId:string) {
  const pairIds=capturedPairIds(v.photos);
  const report=reportCore.normalizeReport({id:reportId,customerId:v.customerId,buildingId:'',buildingName:v.site.name,siteAddress:v.site.address,kind:v.kind,workDate:v.workDate,summary:v.draft.summary,followUp:v.draft.followUp,createdAt:v.createdAt,updatedAt:v.updatedAt,updatedBy:v.ownerUid,
    items:reportCore.itemCatalogFor(v.kind).map(item=>({...item,status:v.draft.statuses[item.key]||'recorded',note:v.draft.notes[item.key]||'',...Object.fromEntries(['before','during','after'].map(phase=>[phase,v.photos.filter(p=>p.included&&p.itemKey===item.key&&p.phase===phase).map(p=>({id:p.id,caption:p.caption,driveFileId:uploads.find(u=>u.photo.id===p.id)?.driveFileId||'',...(pairIds.has(p.id)?{pairId:pairIds.get(p.id)}:{})}))]))}))});
  if(v.captureAreas)report.items=report.items.filter((item:{key:string})=>v.captureAreas!.includes(item.key));
  return report;
}
