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
export interface RecordingPhoto {id: string; itemKey: string; phase: 'before'|'during'|'after'; caption: string; included: boolean; capturedAt: string; mime: 'image/jpeg'; bytes: number; sha256: string; width: number; height: number}
export interface RecordingInput {customerId: string; kind: 'common'|'moveIn'; workDate: string; revision: number; draft: {summary: string; followUp: string; statuses: Record<string,string>; notes: Record<string,string>; confirmedRevision?: number}; photos: RecordingPhoto[]}
export interface Recording extends RecordingInput {id: string; ownerUid: string; site: CustomerSite; contentHash: string; createdAt: string; updatedAt: string}
export interface UploadRecord {id: string; ownerUid: string; visitId: string; photo: RecordingPhoto; receivedBytes: number; state: 'uploading'|'ready'; driveFileId?: string; folderId?: string; createdAt: string}
export interface ArchiveRecord {id: string; visitId: string; revision: number; ownerUid: string; contentHash: string; driveFileId?: string; folderId?: string; ready?: boolean; archivedAt?: string; reportId: string}
export function photoInput(v: unknown, kind: string): RecordingPhoto {
  assert(object(v));
  assert(siteId(v.id) && reportCore.itemCatalogFor(kind).some(i => i.key === v.itemKey));
  assert(['before','during','after'].includes(v.phase) && bounded(v.caption,120) && typeof v.included === 'boolean');
  assert(typeof v.capturedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v.capturedAt) && v.capturedAt.length <= 40 && Number.isFinite(Date.parse(v.capturedAt)));
  assert(v.mime === 'image/jpeg' && Number.isSafeInteger(v.bytes) && v.bytes >= 4 && v.bytes <= RECORD_LIMITS.bytes);
  assert(typeof v.sha256 === 'string' && /^[a-f0-9]{64}$/.test(v.sha256));
  assert(Number.isSafeInteger(v.width) && Number.isSafeInteger(v.height) && v.width > 0 && v.height > 0 && v.width <= 2400 && v.height <= 2400);
  return {id:v.id,itemKey:v.itemKey,phase:v.phase,caption:v.caption,included:v.included,capturedAt:v.capturedAt,mime:v.mime,bytes:v.bytes,sha256:v.sha256,width:v.width,height:v.height};
}
export function recordingInput(v: unknown): RecordingInput {
  assert(object(v) && siteId(v.customerId) && ['common','moveIn'].includes(v.kind));
  assert(typeof v.workDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.workDate) && Number.isFinite(Date.parse(v.workDate)) && new Date(v.workDate).toISOString().slice(0,10) === v.workDate);
  assert(Number.isSafeInteger(v.revision) && v.revision >= 1 && v.revision <= 1_000_000 && object(v.draft));
  const d=v.draft, keys=new Set(reportCore.itemCatalogFor(v.kind).map(i=>i.key));
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
export function photoBinding(p:RecordingPhoto){const {caption,included,...fixed}=p;return JSON.stringify(fixed);}
export function uploadStatus(u:UploadRecord) { return {uploadId:u.id,photoId:u.photo.id,sha256:u.photo.sha256,totalBytes:u.photo.bytes,receivedBytes:u.receivedBytes,state:u.state,driveVerified:u.state==='ready',crmLinked:u.state==='ready'}; }
export function reportFor(v:Recording, uploads:UploadRecord[], reportId:string) {
  return reportCore.normalizeReport({id:reportId,customerId:v.customerId,buildingId:'',buildingName:v.site.name,siteAddress:v.site.address,kind:v.kind,workDate:v.workDate,summary:v.draft.summary,followUp:v.draft.followUp,createdAt:v.createdAt,updatedAt:v.updatedAt,updatedBy:v.ownerUid,
    items:reportCore.itemCatalogFor(v.kind).map(item=>({...item,status:v.draft.statuses[item.key]||'recorded',note:v.draft.notes[item.key]||'',...Object.fromEntries(['before','during','after'].map(phase=>[phase,v.photos.filter(p=>p.included&&p.itemKey===item.key&&p.phase===phase).map(p=>({id:p.id,caption:p.caption,driveFileId:uploads.find(u=>u.photo.id===p.id)?.driveFileId||''}))]))}))});
}
