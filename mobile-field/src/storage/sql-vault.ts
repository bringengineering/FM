import { assertOwner, assertPhoto, FieldError, invalidateVisit, LIMITS, type Photo, type Vault, type Visit, type Workspace } from '../domain/model';
import { catalog } from '../domain/report';

type Bind = string | number | Uint8Array | null;
export interface SqlConnection {
  getFirstAsync<T>(sql: string, ...params: Bind[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: Bind[]): Promise<T[]>;
  runAsync(sql: string, ...params: Bind[]): Promise<unknown>;
}
export interface SqlDatabase extends SqlConnection {
  execAsync(sql: string): Promise<void>;
  closeAsync(): Promise<void>;
}
export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS vault_meta (version INTEGER NOT NULL);
  INSERT INTO vault_meta SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM vault_meta);
  CREATE TABLE IF NOT EXISTS visits (id TEXT PRIMARY KEY, body TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, visit_id TEXT NOT NULL REFERENCES visits(id), body TEXT NOT NULL, bytes BLOB NOT NULL);
  CREATE INDEX IF NOT EXISTS photos_visit ON photos(visit_id);
`;

// Serializing also prevents close/account switch while a transaction is pending.
export class SqlVault implements Vault {
  private chain: Promise<unknown> = Promise.resolve();
  private closed = false;
  private closePromise?: Promise<void>;
  constructor(readonly uid: string, private db: SqlDatabase, private hash: (bytes: Uint8Array) => Promise<string>) {}
  private run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new FieldError('VAULT_CLOSED'));
    const next = this.chain.then(fn); this.chain = next.catch(() => undefined); return next;
  }
  private async transaction(task: (tx: SqlConnection) => Promise<void>): Promise<void> {
    // Expo's exclusive helper opens a second connection without the SQLCipher
    // key. Every operation here is serialized by run(), so use the private,
    // already-keyed connection for BEGIN, queries, COMMIT and ROLLBACK.
    await this.db.execAsync('BEGIN IMMEDIATE');
    try { await task(this.db); await this.db.execAsync('COMMIT'); }
    catch (error) {
      try { await this.db.execAsync('ROLLBACK'); } catch { /* preserve the original failure */ }
      throw error;
    }
  }
  async initialize(): Promise<void> {
    await this.db.execAsync('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    await this.db.execAsync(SCHEMA);
    const version = await this.db.getFirstAsync<{ version: number }>('SELECT version FROM vault_meta');
    if (version?.version !== 1) throw new FieldError('VAULT_VERSION_UNSUPPORTED');
  }
  private async visit(tx: SqlConnection, id: string, expected?: number): Promise<Visit> {
    const row = await tx.getFirstAsync<{ body: string }>('SELECT body FROM visits WHERE id = ?', id);
    if (!row) throw new FieldError('VISIT_NOT_FOUND');
    const visit: Visit = JSON.parse(row.body); assertOwner(visit.ownerUid, this.uid);
    if (expected !== undefined && visit.revision !== expected) throw new FieldError('REVISION_CONFLICT');
    return visit;
  }
  load(): Promise<Workspace> { return this.run(async () => {
    const visits = (await this.db.getAllAsync<{ body: string }>('SELECT body FROM visits ORDER BY id')).map(row => JSON.parse(row.body) as Visit);
    const photos = (await this.db.getAllAsync<{ body: string }>('SELECT body FROM photos ORDER BY id')).map(row => JSON.parse(row.body) as Photo);
    [...visits, ...photos].forEach(row => assertOwner(row.ownerUid, this.uid));
    return { visits, photos };
  }); }
  saveVisit(visit: Visit, expected: number | null): Promise<void> { return this.run(async () => {
    assertOwner(visit.ownerUid, this.uid);
    if (visit.draft.summary.length > LIMITS.text || visit.draft.followUp.length > LIMITS.text) throw new FieldError('TEXT_TOO_LONG');
    await this.transaction(async tx => {
      if (expected === null) {
        if (visit.revision !== 1) throw new FieldError('REVISION_CONFLICT');
        if (await tx.getFirstAsync('SELECT id FROM visits WHERE id = ?', visit.id)) throw new FieldError('VISIT_EXISTS');
        await tx.runAsync('INSERT INTO visits(id, body) VALUES (?, ?)', visit.id, JSON.stringify(visit));
      } else {
        const previous = await this.visit(tx, visit.id, expected);
        if (visit.revision !== expected + 1 || JSON.stringify(visit.job) !== JSON.stringify(previous.job)) throw new FieldError('REVISION_CONFLICT');
        await tx.runAsync('UPDATE visits SET body = ? WHERE id = ?', JSON.stringify(visit), visit.id);
      }
    });
  }); }
  savePhoto(photo: Photo, bytes: Uint8Array, expected: number): Promise<void> { return this.run(async () => {
    assertOwner(photo.ownerUid, this.uid); assertPhoto(photo, bytes);
    if (await this.hash(bytes) !== photo.sha256 || photo.state !== 'queued' || photo.receivedBytes !== 0 || photo.uploadId) throw new FieldError('PHOTO_INVALID');
    await this.transaction(async tx => {
      const visit = await this.visit(tx, photo.visitId, expected);
      if (!catalog(visit.job.kind).some(item => item.key === photo.itemKey)) throw new FieldError('PHOTO_INVALID');
      const count = await tx.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM photos WHERE visit_id = ?', visit.id);
      if ((count?.n ?? 0) >= LIMITS.photos) throw new FieldError('PHOTO_LIMIT');
      await tx.runAsync('INSERT INTO photos(id, visit_id, body, bytes) VALUES (?, ?, ?, ?)', photo.id, visit.id, JSON.stringify(photo), bytes);
      await tx.runAsync('UPDATE visits SET body = ? WHERE id = ?', JSON.stringify(invalidateVisit(visit)), visit.id);
    });
  }); }
  editPhoto(photo: Photo, expected: number): Promise<void> { return this.run(async () => {
    assertOwner(photo.ownerUid, this.uid); assertPhoto(photo);
    await this.transaction(async tx => {
      const row = await tx.getFirstAsync<{ body: string }>('SELECT body FROM photos WHERE id = ?', photo.id);
      if (!row) throw new FieldError('PHOTO_NOT_FOUND');
      const previous: Photo = JSON.parse(row.body); assertOwner(previous.ownerUid, this.uid);
      const visit = await this.visit(tx, previous.visitId, expected);
      // Transfer metadata and original bytes cannot be edited through the UI.
      if (photo.visitId !== previous.visitId || !catalog(visit.job.kind).some(item => item.key === photo.itemKey)) throw new FieldError('PHOTO_INVALID');
      if (previous.uploadId || previous.state !== 'queued') throw new FieldError('PHOTO_EDIT_REQUIRES_SERVER');
      const updated = { ...previous, itemKey: photo.itemKey, phase: photo.phase, included: photo.included, caption: photo.caption };
      await tx.runAsync('UPDATE photos SET body = ? WHERE id = ?', JSON.stringify(updated), photo.id);
      await tx.runAsync('UPDATE visits SET body = ? WHERE id = ?', JSON.stringify(invalidateVisit(visit)), visit.id);
    });
  }); }
  prepareTransfer(id: string): Promise<Photo> { return this.run(async () => {
    let photo!: Photo;
    await this.transaction(async tx => {
      const row = await tx.getFirstAsync<{ body: string }>('SELECT body FROM photos WHERE id = ?', id);
      if (!row) throw new FieldError('PHOTO_NOT_FOUND');
      photo = JSON.parse(row.body); assertOwner(photo.ownerUid, this.uid);
      if (photo.state === 'queued' || photo.state === 'failed') {
        photo = { ...photo, state: 'uploading', errorCode: undefined };
        await tx.runAsync('UPDATE photos SET body = ? WHERE id = ?', JSON.stringify(photo), id);
      }
    });
    return photo;
  }); }
  updateTransfer(id: string, patch: Pick<Photo, 'state' | 'receivedBytes' | 'uploadId' | 'errorCode'>): Promise<void> { return this.run(async () => {
    await this.transaction(async tx => {
      const row = await tx.getFirstAsync<{ body: string }>('SELECT body FROM photos WHERE id = ?', id);
      if (!row) throw new FieldError('PHOTO_NOT_FOUND');
      const previous: Photo = JSON.parse(row.body); assertOwner(previous.ownerUid, this.uid);
      if (!Number.isSafeInteger(patch.receivedBytes) || patch.receivedBytes < previous.receivedBytes || patch.receivedBytes > previous.bytes
        || (previous.uploadId && patch.uploadId !== previous.uploadId)
        || (previous.state === 'ready' && patch.state !== 'ready')
        || (patch.state === 'ready' && patch.receivedBytes !== previous.bytes)) throw new FieldError('UPLOAD_STATE_INVALID');
      await tx.runAsync('UPDATE photos SET body = ? WHERE id = ?', JSON.stringify({ ...previous, ...patch }), id);
    });
  }); }
  readBytes(id: string): Promise<Uint8Array> { return this.run(async () => {
    const row = await this.db.getFirstAsync<{ body: string; bytes: Uint8Array }>('SELECT body, bytes FROM photos WHERE id = ?', id);
    if (!row) throw new FieldError('PHOTO_NOT_FOUND');
    const photo: Photo = JSON.parse(row.body); assertOwner(photo.ownerUid, this.uid);
    if (await this.hash(row.bytes) !== photo.sha256) throw new FieldError('PHOTO_INTEGRITY_FAILED');
    return row.bytes;
  }); }
  close(): Promise<void> {
    this.closed = true;
    return this.closePromise ??= this.chain.then(() => this.db.closeAsync());
  }
}
