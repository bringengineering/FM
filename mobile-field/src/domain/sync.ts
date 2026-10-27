import { assertUpload, type UploadApi, type UploadStatus } from '../api/client';
import { FieldError, LIMITS, type Photo, type Vault } from './model';

// One runner per account. Calling run twice shares the same promise. A stopped
// runner can never be reused for another account/session.
export class SyncRunner {
  private active?: Promise<void>;
  private controller = new AbortController();
  constructor(private vault: Vault, private api: UploadApi) {}
  stop(): void { this.controller.abort(); }
  run(): Promise<void> {
    if (this.active) return this.active;
    this.active = this.drain().finally(() => { this.active = undefined; }); return this.active;
  }
  private live(): void { if (this.controller.signal.aborted) throw new FieldError('SYNC_CANCELLED'); }
  private verify(photo: Photo, status: UploadStatus): void {
    assertUpload(status);
    if (photo.ownerUid !== this.vault.uid || status.photoId !== photo.id || status.sha256 !== photo.sha256 || status.totalBytes !== photo.bytes
      || (photo.uploadId && status.uploadId !== photo.uploadId) || status.receivedBytes < photo.receivedBytes) throw new FieldError('UPLOAD_BINDING_INVALID');
  }
  private async remember(photo: Photo, status: UploadStatus): Promise<Photo> {
    this.live(); this.verify(photo, status);
    const patch = { state: status.state, receivedBytes: status.receivedBytes, uploadId: status.uploadId, errorCode: undefined };
    await this.vault.updateTransfer(photo.id, patch); return { ...photo, ...patch };
  }
  private async upload(initial: Photo): Promise<void> {
    let photo = await this.vault.prepareTransfer(initial.id); const signal = this.controller.signal; this.live();
    if (photo.ownerUid !== this.vault.uid) throw new FieldError('OWNER_MISMATCH');
    if (photo.state === 'ready' || photo.state === 'auth_blocked') return;
    try {
      // Reserve and complete keys survive process death; timeout never creates a
      // new photo/session. Chunk recovery starts with the server's offset.
      const status = photo.uploadId ? await this.api.status(photo.uploadId, signal) : await this.api.reserve(photo, `photo_${photo.id}`, signal);
      photo = await this.remember(photo, status);
      if (['ready', 'validating', 'drive_pending', 'crm_link_pending', 'failed', 'auth_blocked'].includes(photo.state)) return;
      const bytes = await this.vault.readBytes(photo.id); this.live();
      while (photo.receivedBytes < photo.bytes) {
        const offset = photo.receivedBytes;
        const next = await this.api.chunk(photo.uploadId!, offset, photo.bytes, bytes.slice(offset, offset + LIMITS.chunk), signal);
        if (next.receivedBytes !== Math.min(offset + LIMITS.chunk, photo.bytes)) throw new FieldError('UPLOAD_OFFSET_INVALID');
        photo = await this.remember(photo, next);
      }
      await this.remember(photo, await this.api.complete(photo.uploadId!, `complete_${photo.id}`, signal));
    } catch (error) {
      if (signal.aborted) return;
      const code = error instanceof FieldError ? error.code : 'SYNC_FAILED';
      const authBlocked = code === 'AUTH_REQUIRED' || code === 'APP_ATTESTATION_FAILED';
      await this.vault.updateTransfer(photo.id, { state: authBlocked ? 'auth_blocked' : 'failed', receivedBytes: photo.receivedBytes, uploadId: photo.uploadId, errorCode: code });
      if (authBlocked) this.stop();
    }
  }
  private async drain(): Promise<void> {
    this.live(); const { photos } = await this.vault.load();
    // Sequential first release keeps memory bounded to one decoded photograph.
    for (const photo of photos) { if (this.controller.signal.aborted) return; if (photo.state !== 'ready' && photo.state !== 'auth_blocked') await this.upload(photo); }
  }
}
