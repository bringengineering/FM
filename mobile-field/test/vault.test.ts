import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { confirmVisit, editVisit, readyToArchive } from '../src/domain/model';
import { reviewIssues } from '../src/domain/report';
import { makeVault, visit, photo, jpeg } from './helpers';

describe('persistent vault and report integrity', () => {
  it('reopens the same committed photo bytes and draft after process restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'field-vault-')); const path = join(dir, 'test.db');
    try {
      let { vault } = await makeVault(path); await vault.saveVisit(visit(), null); await vault.savePhoto(await photo(), jpeg, 1);
      const saved = (await vault.load()).visits[0]!; await vault.saveVisit(editVisit(saved, { summary: '직접 확인한 기록' }, 'now'), saved.revision); await vault.close();
      ({ vault } = await makeVault(path)); expect((await vault.load()).visits[0]?.draft.summary).toBe('직접 확인한 기록'); expect(await vault.readBytes('photo-a')).toEqual(jpeg); await vault.close();
    } finally { for (const name of ['test.db', 'test.db-wal', 'test.db-shm']) rmSync(join(dir, name), { force: true }); rmdirSync(dir); }
  });
  it('does not commit photo bytes when the visit revision is stale', async () => {
    const { vault } = await makeVault(); await vault.saveVisit(visit(), null);
    await expect(vault.savePhoto(await photo(), jpeg, 9)).rejects.toThrow('REVISION_CONFLICT');
    expect((await vault.load()).photos).toHaveLength(0); expect((await vault.load()).visits[0]?.revision).toBe(1); await vault.close();
  });
  it('rolls back both photo and revision when the database rejects a write', async () => {
    const { vault, db } = await makeVault(); await vault.saveVisit(visit(), null);
    db.exec("CREATE TRIGGER reject_visit BEFORE UPDATE ON visits BEGIN SELECT RAISE(ABORT, 'storage unavailable'); END;");
    await expect(vault.savePhoto(await photo(), jpeg, 1)).rejects.toThrow(); expect((await vault.load()).photos).toHaveLength(0); await vault.close();
  });
  it('rejects other staff records and manipulated bytes', async () => {
    const { vault } = await makeVault(); await vault.saveVisit(visit(), null);
    await expect(vault.savePhoto(await photo('staff-b'), jpeg, 1)).rejects.toThrow('OWNER_MISMATCH');
    const tampered = jpeg.slice(); tampered[4] = 88;
    await expect(vault.savePhoto(await photo(), tampered, 1)).rejects.toThrow('PHOTO_INVALID'); await vault.close();
  });
  it('allows only one concurrent edit of the same revision', async () => {
    const { vault } = await makeVault(); const v = visit(); await vault.saveVisit(v, null);
    const outcomes = await Promise.allSettled([vault.saveVisit(editVisit(v, { summary: 'first' }, 'now'), 1), vault.saveVisit(editVisit(v, { summary: 'second' }, 'now'), 1)]);
    expect(outcomes.filter(x => x.status === 'fulfilled')).toHaveLength(1); expect((await vault.load()).visits[0]?.draft.summary).toBe('first'); await vault.close();
  });
  it('invalidates human confirmation when a photo is reclassified', async () => {
    const { vault } = await makeVault(); await vault.saveVisit(visit(), null); const p = await photo(); await vault.savePhoto(p, jpeg, 1);
    let v = (await vault.load()).visits[0]!; await vault.saveVisit(confirmVisit(v), v.revision); v = (await vault.load()).visits[0]!;
    await vault.editPhoto({ ...p, phase: 'after' }, v.revision); expect((await vault.load()).visits[0]?.draft.confirmedRevision).toBeUndefined(); await vault.close();
  });
  it('rejects silent transfer rewinds or claiming ready before all bytes', async () => {
    const { vault } = await makeVault(); await vault.saveVisit(visit(), null); await vault.savePhoto(await photo(), jpeg, 1);
    await vault.updateTransfer('photo-a', { state: 'uploading', receivedBytes: 4, uploadId: 'upload-a', errorCode: undefined });
    await expect(vault.updateTransfer('photo-a', { state: 'uploading', receivedBytes: 0, uploadId: 'upload-a', errorCode: undefined })).rejects.toThrow('UPLOAD_STATE_INVALID');
    await expect(vault.updateTransfer('photo-a', { state: 'ready', receivedBytes: 4, uploadId: 'upload-a', errorCode: undefined })).rejects.toThrow('UPLOAD_STATE_INVALID'); await vault.close();
  });
  it('uses canonical CRM report rules without treating a photograph as completion', async () => {
    const v = visit(), p = await photo(); expect(reviewIssues(v, [])).toContain('분류된 작업 사진을 한 장 이상 등록해 주세요.');
    expect(reviewIssues(v, [p])).toEqual([]); expect(v.draft.statuses).toEqual({});
    const invalid = editVisit(v, { statuses: { entrance: 'skipped' } }, 'now'); expect(reviewIssues(invalid, [p]).join()).toContain('못 한 이유');
    const confirmed = confirmVisit(v); expect(readyToArchive(confirmed, [p])).toBe(false);
    expect(readyToArchive(confirmed, [{ ...p, state: 'ready' }])).toBe(true);
  });
  it('preserves report confirmation on transfer updates but rejects editing uploaded metadata', async () => {
    const { vault } = await makeVault(); await vault.saveVisit(visit(), null); const p = await photo(); await vault.savePhoto(p, jpeg, 1);
    let v = (await vault.load()).visits[0]!; await vault.saveVisit(confirmVisit(v), v.revision); v = (await vault.load()).visits[0]!;
    await vault.updateTransfer(p.id, { state: 'uploading', uploadId: 'upload-a', receivedBytes: 0, errorCode: undefined });
    expect((await vault.load()).visits[0]?.draft.confirmedRevision).toBe(v.revision);
    await expect(vault.editPhoto({ ...p, phase: 'after' }, v.revision)).rejects.toThrow('PHOTO_EDIT_REQUIRES_SERVER'); await vault.close();
  });
});
