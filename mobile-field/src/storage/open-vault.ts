import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { FieldError } from '../domain/model';
import { SqlVault } from './sql-vault';

export async function sha256(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, Uint8Array.from(bytes))), b => b.toString(16).padStart(2, '0')).join('');
}
// Expo SQLite exposes a native absolute path on Android and iOS; Expo FileSystem
// expects a file URI. Passing the raw path to Android's java.io.File(URI) fails.
export function databaseDirectoryUri(directory: string): string {
  if (directory.startsWith('file:///')) return directory;
  if (directory.startsWith('/')) return `file://${directory}`;
  throw new FieldError('VAULT_FILE_CHECK_FAILED');
}
export async function openVault(uid: string): Promise<SqlVault> {
  const suffix = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, uid);
  const name = `field-v1-${suffix}.db`;
  const keyName = `field-vault-${suffix}`;
  let key: string | null;
  try { key = await SecureStore.getItemAsync(keyName); } catch { throw new FieldError('VAULT_KEY_ACCESS_FAILED'); }
  if (!key) {
    let exists: boolean;
    try { exists = new File(databaseDirectoryUri(SQLite.defaultDatabaseDirectory), name).exists; }
    catch { throw new FieldError('VAULT_FILE_CHECK_FAILED'); }
    if (exists) throw new FieldError('VAULT_KEY_MISSING');
    key = Array.from(await Crypto.getRandomBytesAsync(32), b => b.toString(16).padStart(2, '0')).join('');
    try { await SecureStore.setItemAsync(keyName, key, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }); }
    catch { throw new FieldError('VAULT_KEY_ACCESS_FAILED'); }
  }
  if (!/^[a-f0-9]{64}$/.test(key)) throw new FieldError('VAULT_KEY_INVALID');
  let db: Awaited<ReturnType<typeof SQLite.openDatabaseAsync>>;
  try { db = await SQLite.openDatabaseAsync(name, { useNewConnection: true }); }
  catch { throw new FieldError('VAULT_DATABASE_OPEN_FAILED'); }
  try {
    // SQLite silently ignores unsupported PRAGMAs. Verify the cipher first.
    const cipher = await db.getFirstAsync<{ cipher_version?: unknown }>('PRAGMA cipher_version');
    if (typeof cipher?.cipher_version !== 'string' || !cipher.cipher_version.trim()) throw new FieldError('ENCRYPTED_BUILD_REQUIRED');
    await db.execAsync(`PRAGMA key = "x'${key}'";`);
    const vault = new SqlVault(uid, db, sha256); await vault.initialize(); return vault;
  } catch (error) { await db.closeAsync().catch(() => undefined); throw error instanceof FieldError ? error : new FieldError('VAULT_INITIALIZE_FAILED'); }
}
