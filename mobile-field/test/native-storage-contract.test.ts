import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { beforeEach, it, expect, vi } from 'vitest';
import { jpeg, photo, visit } from './helpers';

// Models Expo's connection contract, not the SQLCipher cipher itself. In Expo
// 58 exclusive transactions open an independent, initially unkeyed connection.
const native = vi.hoisted(() => ({ db: undefined as any, cipher: { cipher_version: '4-contract-test' } as unknown, keyPresent: true, filePresent: false }));
vi.mock('expo-sqlite', () => ({ defaultDatabaseDirectory: 'test-vault', openDatabaseAsync: vi.fn(async () => native.db) }));
vi.mock('expo-secure-store', () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1, getItemAsync: vi.fn(async () => native.keyPresent ? 'a'.repeat(64) : null), setItemAsync: vi.fn() }));
vi.mock('expo-file-system', () => ({ File: class { get exists() { return native.filePresent; } } }));
vi.mock('expo-crypto', async () => {
  const crypto = await import('node:crypto');
  return { CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digestStringAsync: async (_: unknown, value: string) => crypto.createHash('sha256').update(value).digest('hex'),
    digest: async (_: unknown, bytes: Uint8Array) => Uint8Array.from(crypto.createHash('sha256').update(bytes).digest()).buffer,
    getRandomBytesAsync: async (n: number) => crypto.randomBytes(n) };
});
import { openVault } from '../src/storage/open-vault';
import { openDatabaseAsync } from 'expo-sqlite';
import { setItemAsync } from 'expo-secure-store';

beforeEach(() => { vi.clearAllMocks(); native.cipher = { cipher_version: '4-contract-test' }; native.keyPresent = true; native.filePresent = false; });
function connection() {
  const raw = new DatabaseSync(':memory:'); let keyed = false;
  const checkKey = () => { if (!keyed) throw new Error('database connection has no key'); };
  native.db = {
    async getFirstAsync(sql: string, ...params: any[]) { if (sql === 'PRAGMA cipher_version') return native.cipher; checkKey(); return raw.prepare(sql).get(...params) ?? null; },
    async getAllAsync(sql: string, ...params: any[]) { checkKey(); return raw.prepare(sql).all(...params); },
    async runAsync(sql: string, ...params: any[]) { checkKey(); return raw.prepare(sql).run(...params); },
    async execAsync(sql: string) { if (sql.startsWith('PRAGMA key =')) { keyed = true; return; } checkKey(); raw.exec(sql); },
    async withExclusiveTransactionAsync() { throw new Error('new native transaction connection has no key'); },
    closeAsync: vi.fn(async () => raw.close()),
  };
  return native.db;
}
it('commits and re-reads photos using the same keyed connection', async () => {
  const db = connection(); const vault = await openVault('staff-a');
  expect(openDatabaseAsync).toHaveBeenCalledWith(expect.any(String), { useNewConnection: true });
  await vault.saveVisit(visit(), null); await vault.savePhoto(await photo(), jpeg, 1);
  expect(createHash('sha256').update(await vault.readBytes('photo-a')).digest('hex')).toBe((await photo()).sha256);
  await Promise.all([vault.close(), vault.close()]); expect(db.closeAsync).toHaveBeenCalledOnce();
});
it.each([null, {}, { cipher_version: '' }])('refuses an unsupported or empty cipher response %j before writing', async cipher => {
  const db = connection(); native.cipher = cipher;
  await expect(openVault('staff-a')).rejects.toThrow('ENCRYPTED_BUILD_REQUIRED'); expect(db.closeAsync).toHaveBeenCalledOnce();
});
it('never replaces a lost key when a saved database exists', async () => {
  native.keyPresent = false; native.filePresent = true;
  await expect(openVault('staff-a')).rejects.toThrow('VAULT_KEY_MISSING');
  expect(setItemAsync).not.toHaveBeenCalled(); expect(openDatabaseAsync).not.toHaveBeenCalled();
});
