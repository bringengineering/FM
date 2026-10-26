import { assertOwner, assertPhoto, FieldError, LIMITS, type Photo, type PhotoState } from '../domain/model';

export interface Credentials { uid: string; idToken: string; appCheckToken: string }
export interface UploadStatus { uploadId: string; photoId: string; sha256: string; totalBytes: number; receivedBytes: number; state: PhotoState; driveVerified: boolean; crmLinked: boolean }
export interface UploadApi {
  reserve(photo: Photo, key: string, signal: AbortSignal): Promise<UploadStatus>;
  status(uploadId: string, signal: AbortSignal): Promise<UploadStatus>;
  chunk(uploadId: string, offset: number, total: number, bytes: Uint8Array, signal: AbortSignal): Promise<UploadStatus>;
  complete(uploadId: string, key: string, signal: AbortSignal): Promise<UploadStatus>;
}
const isId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value);
const MAX_RESPONSE_BYTES = 128 * 1024;
async function readJsonBounded(response: Response): Promise<unknown> {
  if (!/^application\/json(?:\s*;.*)?$/i.test(response.headers.get('content-type') ?? '')) throw new FieldError('SERVER_RESPONSE_INVALID');
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) throw new FieldError('SERVER_RESPONSE_INVALID');
  // Native composition must provide a streaming transport (expo/fetch).
  // A text() fallback can allocate an unbounded response before checking size.
  if (!response.body?.getReader) throw new FieldError('SERVER_RESPONSE_INVALID');
  const reader = response.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new FieldError('SERVER_RESPONSE_INVALID'); }
      parts.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new FieldError('SERVER_RESPONSE_INVALID'); }
}
export function assertUpload(value: unknown): UploadStatus {
  if (!value || typeof value !== 'object') throw new FieldError('SERVER_RESPONSE_INVALID');
  const v = value as UploadStatus;
  if (!isId(v.uploadId) || !isId(v.photoId) || typeof v.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(v.sha256)
    || !Number.isSafeInteger(v.totalBytes) || v.totalBytes < 4 || v.totalBytes > LIMITS.photoBytes
    || !Number.isSafeInteger(v.receivedBytes) || v.receivedBytes < 0 || v.receivedBytes > v.totalBytes
    || !['queued', 'uploading', 'validating', 'drive_pending', 'crm_link_pending', 'ready', 'failed', 'auth_blocked'].includes(v.state)
    || typeof v.driveVerified !== 'boolean' || typeof v.crmLinked !== 'boolean'
    || (v.state === 'ready' && (!v.driveVerified || !v.crmLinked || v.receivedBytes !== v.totalBytes))) throw new FieldError('SERVER_RESPONSE_INVALID');
  return v;
}
export class FieldApiClient implements UploadApi {
  constructor(private base: string, private uid: string, private credentials: () => Promise<Credentials>, private fetcher: typeof fetch = fetch) {
    const url = new URL(base);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/v1/field-app')) throw new FieldError('API_CONFIGURATION_INVALID');
  }
  private async request(path: string, method: string, body: string | Uint8Array | undefined, signal: AbortSignal, headers: Record<string, string> = {}): Promise<unknown> {
    if (signal.aborted) throw new FieldError('SYNC_CANCELLED');
    let credentials: Credentials;
    try { credentials = await this.credentials(); } catch { throw new FieldError('AUTH_REQUIRED'); }
    if (signal.aborted) throw new FieldError('SYNC_CANCELLED');
    if (credentials.uid !== this.uid || !credentials.idToken || !credentials.appCheckToken) throw new FieldError('AUTH_REQUIRED');
    const controller = new AbortController(); const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 25_000);
    try {
      const response = await this.fetcher(this.base + path, {
        method, redirect: 'error', signal: controller.signal,
        headers: { 'Authorization': `Bearer ${credentials.idToken}`, 'X-Firebase-AppCheck': credentials.appCheckToken,
          'Accept': 'application/json', 'Content-Type': body instanceof Uint8Array ? 'application/octet-stream' : 'application/json', ...headers },
        body: body instanceof Uint8Array ? Uint8Array.from(body) : body,
      });
      if (!response.ok) {
        const code = response.status === 401 || response.status === 403 ? 'AUTH_REQUIRED'
          : response.status === 409 ? 'REVISION_CONFLICT' : response.status === 429 ? 'RATE_LIMITED' : 'SERVER_UNAVAILABLE';
        throw new FieldError(code);
      }
      // Do not log/reflect server bodies, which may contain sensitive URLs.
      return await readJsonBounded(response);
    } catch (error) {
      if (error instanceof FieldError) throw error;
      throw new FieldError(signal.aborted ? 'SYNC_CANCELLED' : 'NETWORK_UNCERTAIN');
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); controller.abort(); }
  }
  async reserve(photo: Photo, key: string, signal: AbortSignal): Promise<UploadStatus> {
    assertOwner(photo.ownerUid, this.uid); assertPhoto(photo);
    if (!isId(photo.visitId) || !isId(key)) throw new FieldError('REQUEST_INVALID');
    if (!Number.isSafeInteger(photo.reservationRevision) || photo.reservationRevision! < 1) throw new FieldError('VISIT_NOT_LINKED');
    const { id: photoId, itemKey, phase, capturedAt: claimedCapturedAt, mime, bytes, sha256, width, height, included, caption } = photo;
    return assertUpload(await this.request(`/visits/${photo.visitId}/photos`, 'POST', JSON.stringify({ expectedRevision: photo.reservationRevision, photoId, itemKey, phase, claimedCapturedAt, mime, bytes, sha256, width, height, included, caption }), signal, { 'Idempotency-Key': key }));
  }
  async status(uploadId: string, signal: AbortSignal): Promise<UploadStatus> {
    if (!isId(uploadId)) throw new FieldError('REQUEST_INVALID');
    return assertUpload(await this.request(`/uploads/${uploadId}`, 'GET', undefined, signal));
  }
  async chunk(uploadId: string, offset: number, total: number, bytes: Uint8Array, signal: AbortSignal): Promise<UploadStatus> {
    if (!isId(uploadId) || !Number.isSafeInteger(total) || total < 4 || total > LIMITS.photoBytes || !Number.isSafeInteger(offset) || offset < 0 || bytes.length < 1 || bytes.length > LIMITS.chunk || offset + bytes.length > total) throw new FieldError('REQUEST_INVALID');
    return assertUpload(await this.request(`/uploads/${uploadId}/chunks`, 'PUT', bytes, signal, { 'Content-Range': `bytes ${offset}-${offset + bytes.length - 1}/${total}` }));
  }
  async complete(uploadId: string, key: string, signal: AbortSignal): Promise<UploadStatus> {
    if (!isId(uploadId) || !isId(key)) throw new FieldError('REQUEST_INVALID');
    return assertUpload(await this.request(`/uploads/${uploadId}/complete`, 'POST', '{}', signal, { 'Idempotency-Key': key }));
  }
}
