import { describe, it, expect, vi } from 'vitest';
import { SyncRunner } from '../src/domain/sync';
import { FieldError } from '../src/domain/model';
import type { UploadApi, UploadStatus } from '../src/api/client';
import { jpeg, makeVault, photo, visit } from './helpers';
async function setup() {
  const { vault } = await makeVault(); const p = await photo(); await vault.saveVisit(visit(), null); await vault.savePhoto(p, jpeg, 1);
  let state: UploadStatus = { uploadId: 'upload-a', photoId: p.id, sha256: p.sha256, totalBytes: jpeg.length, receivedBytes: 0, state: 'uploading', crmLinked: false, driveVerified: false };
  const api: UploadApi = {
    reserve: vi.fn(async () => ({ ...state })), status: vi.fn(async () => ({ ...state })),
    chunk: vi.fn(async (_id, offset, _total, bytes) => { state = { ...state, receivedBytes: offset + bytes.length }; return { ...state }; }),
    complete: vi.fn(async (): Promise<UploadStatus> => ({ ...state, state: 'drive_pending' })),
  };
  return { vault, api, get: () => state, set: (s: Partial<UploadStatus>) => { state = { ...state, ...s }; } };
}
describe('resumable transfer', () => {
  it('coalesces simultaneous sync taps and never calls Drive completion ready prematurely', async () => {
    const { vault, api } = await setup(); const runner = new SyncRunner(vault, api); await Promise.all([runner.run(), runner.run()]);
    expect(api.reserve).toHaveBeenCalledTimes(1); expect(api.complete).toHaveBeenCalledTimes(1); expect((await vault.load()).photos[0]?.state).toBe('drive_pending'); await vault.close();
  });
  it('recovers a lost chunk response by asking the server offset without sending bytes twice', async () => {
    const { vault, api, set, get } = await setup(); api.chunk = vi.fn(async () => { set({ receivedBytes: jpeg.length }); throw new FieldError('NETWORK_UNCERTAIN'); });
    await new SyncRunner(vault, api).run(); expect((await vault.load()).photos[0]?.state).toBe('failed');
    await new SyncRunner(vault, api).run(); expect(api.status).toHaveBeenCalledTimes(1); expect(api.chunk).toHaveBeenCalledTimes(1); expect(api.complete).toHaveBeenCalledTimes(1); expect(get().receivedBytes).toBe(jpeg.length); await vault.close();
  });
  it('reuses the same reserve identity if the reservation response is lost', async () => {
    const { vault, api, get } = await setup(); api.reserve = vi.fn().mockRejectedValueOnce(new FieldError('NETWORK_UNCERTAIN')).mockImplementation(async () => get());
    await new SyncRunner(vault, api).run(); await new SyncRunner(vault, api).run();
    expect(vi.mocked(api.reserve).mock.calls[0]?.[1]).toBe(vi.mocked(api.reserve).mock.calls[1]?.[1]); await vault.close();
  });
  it('accepts ready only after both Drive integrity and CRM binding are confirmed', async () => {
    const { vault, api, set } = await setup(); await new SyncRunner(vault, api).run(); set({ state: 'ready', driveVerified: true, crmLinked: true });
    await new SyncRunner(vault, api).run(); expect((await vault.load()).photos[0]?.state).toBe('ready'); expect(api.chunk).toHaveBeenCalledTimes(1); await vault.close();
  });
  it('rejects another photograph in a valid-looking status response', async () => {
    const { vault, api, set } = await setup(); set({ photoId: 'another-photo' }); await new SyncRunner(vault, api).run();
    expect(api.chunk).not.toHaveBeenCalled(); expect((await vault.load()).photos[0]?.errorCode).toBe('UPLOAD_BINDING_INVALID'); await vault.close();
  });
  it.each(['AUTH_REQUIRED', 'APP_ATTESTATION_FAILED'])('stops after %s and retains originals', async code => {
    const { vault, api } = await setup(); api.reserve = vi.fn(async () => { throw new FieldError(code); });
    const runner = new SyncRunner(vault, api); await runner.run(); expect((await vault.load()).photos[0]?.state).toBe('auth_blocked'); expect(await vault.readBytes('photo-a')).toEqual(jpeg); await expect(runner.run()).rejects.toThrow('SYNC_CANCELLED'); await vault.close();
  });
  it('ignores an in-flight result after account/session cancellation', async () => {
    const { vault, api, get } = await setup(); let resume!: (value: UploadStatus) => void;
    api.reserve = vi.fn(() => new Promise<UploadStatus>(resolve => { resume = resolve; }));
    const runner = new SyncRunner(vault, api); const pending = runner.run();
    await vi.waitFor(() => expect(api.reserve).toHaveBeenCalledOnce()); runner.stop(); resume(get()); await pending;
    expect(api.chunk).not.toHaveBeenCalled(); expect((await vault.load()).photos[0]?.state).toBe('uploading'); await vault.close();
  });
  it('freezes photo metadata before a reservation leaves the device', async () => {
    const { vault, api, get } = await setup(); let resume!: (value: UploadStatus) => void;
    api.reserve = vi.fn(() => new Promise<UploadStatus>(resolve => { resume = resolve; }));
    const runner = new SyncRunner(vault, api); const pending = runner.run();
    await vi.waitFor(() => expect(api.reserve).toHaveBeenCalledOnce());
    const workspace = await vault.load();
    await expect(vault.editPhoto({ ...workspace.photos[0]!, phase: 'after' }, workspace.visits[0]!.revision)).rejects.toThrow('PHOTO_EDIT_REQUIRES_SERVER');
    resume(get()); await pending; expect((await vault.load()).photos[0]?.phase).toBe('before'); await vault.close();
  });
  it('resumes several chunks from the last server acknowledgement', async () => {
    const { vault } = await makeVault(); const bytes = new Uint8Array(2 * 1024 * 1024 + 20); bytes.set(jpeg); const p = await photo('staff-a', bytes);
    await vault.saveVisit(visit(), null); await vault.savePhoto(p, bytes, 1);
    let offset = 0;
    const status = (): UploadStatus => ({ uploadId: 'u', photoId: p.id, sha256: p.sha256, totalBytes: p.bytes, receivedBytes: offset, state: 'uploading', driveVerified: false, crmLinked: false });
    const api: UploadApi = { reserve: vi.fn(async () => status()), status: vi.fn(async () => status()),
      chunk: vi.fn(async (_id, start, _total, data) => { expect(start).toBe(offset); offset += data.length; if (offset === 2 * 1024 * 1024) throw new Error('response lost'); return status(); }),
      complete: vi.fn(async () => ({ ...status(), state: 'validating' as const })) };
    await new SyncRunner(vault, api).run(); await new SyncRunner(vault, api).run();
    expect(api.chunk).toHaveBeenCalledTimes(3); expect(api.complete).toHaveBeenCalledOnce(); expect(offset).toBe(p.bytes); await vault.close();
  });
});
