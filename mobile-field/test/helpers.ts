import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { SqlVault, type SqlDatabase } from '../src/storage/sql-vault';
import type { Photo, Visit } from '../src/domain/model';
export const jpeg = Uint8Array.from([255, 216, 255, 224, 1, 2, 255, 217]);
export const hash = async (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const visit = (uid = 'staff-a'): Visit => ({ id: 'visit-a', ownerUid: uid, job: { id: 'job-a', buildingId: 'building-a', title: '가상 현장', address: '가상 주소', kind: 'common', workDate: '2026-10-26' }, revision: 1, draft: { summary: '', followUp: '', statuses: {}, notes: {} }, updatedAt: '2026-10-26T00:00:00Z' });
export const photo = async (uid = 'staff-a', bytes = jpeg): Promise<Photo> => ({ id: 'photo-a', visitId: 'visit-a', ownerUid: uid, itemKey: 'entrance', phase: 'before', caption: '', included: true, capturedAt: '2026-10-26T00:01:00Z', mime: 'image/jpeg', bytes: bytes.length, sha256: await hash(bytes), width: 2, height: 2, state: 'queued', receivedBytes: 0 });
export async function makeVault(path = ':memory:', uid = 'staff-a') {
  const db = new DatabaseSync(path);
  const adapter: SqlDatabase = {
    async getFirstAsync<T>(sql: string, ...params: (string | number | Uint8Array | null)[]) { return (db.prepare(sql).get(...params) as T) ?? null; },
    async getAllAsync<T>(sql: string, ...params: (string | number | Uint8Array | null)[]) { return db.prepare(sql).all(...params) as T[]; },
    async runAsync(sql, ...params) { return db.prepare(sql).run(...params); },
    async execAsync(sql) { db.exec(sql); },
    async withExclusiveTransactionAsync(task) {
      db.exec('BEGIN IMMEDIATE'); try { await task(adapter); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    async closeAsync() { db.close(); },
  };
  const vault = new SqlVault(uid, adapter, hash); await vault.initialize(); return { vault, db };
}
