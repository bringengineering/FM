import { FieldError, LIMITS, type Photo, type PhotoState } from '../domain/model';

export interface Credentials { uid: string; idToken: string; appCheckToken: string }
export interface UploadStatus { uploadId: string; photoId: string; sha256: string; totalBytes: number; receivedBytes: number; state: PhotoState; driveVerified: boolean; crmLinked: boolean }
export interface UploadApi {
  reserve(photo: Photo, key: string, signal: AbortSignal): Promise<UploadStatus>;
  status(uploadId: string, signal: AbortSignal): Promise<UploadStatus>;
  chunk(uploadId: string, offset: number, total: number, bytes: Uint8Array, signal: AbortSignal): Promise<UploadStatus>;
  complete(uploadId: string, key: string, signal: AbortSignal): Promise<UploadStatus>;
}
const ID = /^[A-Za-z0-9_-]{1,120}$/;
export function assertUpload(value: unknown): UploadStatus {
  if (!value || typeof value !== 'object') throw new FieldError('SERVER_RESPONSE_INVALID');
  const v = value as UploadStatus;
  if (!ID.test(v.uploadId) || !ID.test(v.photoId) || !/^[a-f0-9]{64}$/.test(v.sha256)
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
    const credentials = await this.credentials();
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
      const declared = Number(response.headers.get('content-length'));
      if (declared > 128 * 1024) throw new FieldError('SERVER_RESPONSE_INVALID');
      const text = await response.text();
      if (text.length > 128 * 1024) throw new FieldError('SERVER_RESPONSE_INVALID');
      try { return JSON.parse(text); } catch { throw new FieldError('SERVER_RESPONSE_INVALID'); }
    } catch (error) {
      if (error instanceof FieldError) throw error;
      throw new FieldError(signal.aborted ? 'SYNC_CANCELLED' : 'NETWORK_UNCERTAIN');
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
  }
  async reserve(photo: Photo, key: string, signal: AbortSignal): Promise<UploadStatus> {
    if (!ID.test(photo.visitId) || !ID.test(key)) throw new FieldError('REQUEST_INVALID');
    if (!Number.isSafeInteger(photo.reservationRevision) || photo.reservationRevision! < 1) throw new FieldError('VISIT_NOT_LINKED');
    const { id: photoId, itemKey, phase, capturedAt: claimedCapturedAt, mime, bytes, sha256, width, height, included, caption } = photo;
    return assertUpload(await this.request(`/visits/${photo.visitId}/photos`, 'POST', JSON.stringify({ expectedRevision: photo.reservationRevision, photoId, itemKey, phase, claimedCapturedAt, mime, bytes, sha256, width, height, included, caption }), signal, { 'Idempotency-Key': key }));
  }
  async status(uploadId: string, signal: AbortSignal): Promise<UploadStatus> {
    if (!ID.test(uploadId)) throw new FieldError('REQUEST_INVALID');
    return assertUpload(await this.request(`/uploads/${uploadId}`, 'GET', undefined, signal));
  }
  async chunk(uploadId: string, offset: number, total: number, bytes: Uint8Array, signal: AbortSignal): Promise<UploadStatus> {
    if (!ID.test(uploadId) || !Number.isSafeInteger(offset) || offset < 0 || bytes.length < 1 || bytes.length > LIMITS.chunk || offset + bytes.length > total) throw new FieldError('REQUEST_INVALID');
    return assertUpload(await this.request(`/uploads/${uploadId}/chunks`, 'PUT', bytes, signal, { 'Content-Range': `bytes ${offset}-${offset + bytes.length - 1}/${total}` }));
  }
  async complete(uploadId: string, key: string, signal: AbortSignal): Promise<UploadStatus> {
    if (!ID.test(uploadId) || !ID.test(key)) throw new FieldError('REQUEST_INVALID');
    return assertUpload(await this.request(`/uploads/${uploadId}/complete`, 'POST', '{}', signal, { 'Idempotency-Key': key }));
  }
}
