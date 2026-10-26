export const LIMITS = Object.freeze({ photoBytes: 20 * 1024 * 1024, pixels: 40_000_000, photos: 100, chunk: 1024 * 1024, text: 2000 });
export type Phase = 'before' | 'during' | 'after';
export type PhotoState = 'queued' | 'uploading' | 'validating' | 'drive_pending' | 'crm_link_pending' | 'ready' | 'failed' | 'auth_blocked';
export type ItemStatus = 'recorded' | 'done' | 'partial' | 'skipped';
export interface Job { id: string; buildingId: string; title: string; address: string; kind: 'common' | 'moveIn'; workDate: string }
export interface Photo {
  id: string; visitId: string; ownerUid: string; itemKey: string; phase: Phase; caption: string; included: boolean;
  capturedAt: string; mime: 'image/jpeg'; bytes: number; sha256: string; width: number; height: number;
  state: PhotoState; uploadId?: string; receivedBytes: number; errorCode?: string;
  // Set by the server visit/revision reconciliation layer before enabling sync.
  // Local edit revisions must never be substituted for a CRM server revision.
  reservationRevision?: number;
}
export interface Draft { summary: string; followUp: string; statuses: Record<string, ItemStatus>; notes: Record<string, string>; confirmedRevision?: number }
export interface Visit { id: string; ownerUid: string; job: Job; revision: number; draft: Draft; updatedAt: string }
export interface Workspace { visits: Visit[]; photos: Photo[] }
export interface Vault {
  readonly uid: string;
  load(): Promise<Workspace>;
  saveVisit(visit: Visit, expectedRevision: number | null): Promise<void>;
  savePhoto(photo: Photo, bytes: Uint8Array, expectedVisitRevision: number): Promise<void>;
  editPhoto(photo: Photo, expectedVisitRevision: number): Promise<void>;
  updateTransfer(photoId: string, patch: Pick<Photo, 'state' | 'receivedBytes' | 'uploadId' | 'errorCode'>): Promise<void>;
  readBytes(photoId: string): Promise<Uint8Array>;
  close(): Promise<void>;
}
export class FieldError extends Error {
  constructor(readonly code: string) { super(code); }
}
export function assertOwner(owner: string, uid: string): void { if (owner !== uid) throw new FieldError('OWNER_MISMATCH'); }
export function assertPhoto(photo: Photo, bytes?: Uint8Array): void {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(photo.id) || !/^[a-f0-9]{64}$/.test(photo.sha256)
    || !['before', 'during', 'after'].includes(photo.phase) || photo.mime !== 'image/jpeg'
    || !Number.isSafeInteger(photo.bytes) || photo.bytes < 4 || photo.bytes > LIMITS.photoBytes
    || !Number.isSafeInteger(photo.width) || !Number.isSafeInteger(photo.height)
    || photo.width <= 0 || photo.height <= 0 || photo.width * photo.height > LIMITS.pixels
    || photo.caption.length > 120 || photo.itemKey.length > 40) throw new FieldError('PHOTO_INVALID');
  if (bytes && (bytes.byteLength !== photo.bytes || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255)) throw new FieldError('PHOTO_INVALID');
}
export function editVisit(visit: Visit, patch: Partial<Draft>, now: string): Visit {
  const draft = { ...visit.draft, ...patch, confirmedRevision: undefined };
  if (draft.summary.length > LIMITS.text || draft.followUp.length > LIMITS.text) throw new FieldError('TEXT_TOO_LONG');
  return { ...visit, revision: visit.revision + 1, draft, updatedAt: now };
}
export function invalidateVisit(visit: Visit): Visit { return editVisit(visit, {}, new Date().toISOString()); }
export function confirmVisit(visit: Visit): Visit {
  return { ...visit, revision: visit.revision + 1, draft: { ...visit.draft, confirmedRevision: visit.revision + 1 } };
}
export function readyToArchive(visit: Visit, photos: Photo[]): boolean {
  const selected = photos.filter(p => p.visitId === visit.id && p.included);
  return visit.draft.confirmedRevision === visit.revision && selected.length > 0 && selected.every(p => p.state === 'ready');
}
export const phaseLabel: Record<Phase, string> = { before: '작업 전', during: '작업 중', after: '작업 후' };
export const stateLabel: Record<PhotoState, string> = { queued: '기기 보관 · 전송 대기', uploading: '전송 중', validating: '파일 확인 중', drive_pending: 'Drive 보관 중', crm_link_pending: 'CRM 연결 중', ready: 'Drive·CRM 보관 완료', failed: '확인 필요', auth_blocked: '회사 권한 확인 필요' };
