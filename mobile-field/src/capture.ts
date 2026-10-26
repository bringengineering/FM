import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { sha256 } from './storage/open-vault';
import { FieldError, LIMITS, type Phase, type Vault, type Visit } from './domain/model';

export async function persistCapture(vault: Vault, visit: Visit, source: { uri: string; width: number; height: number }, itemKey: string, phase: Phase): Promise<void> {
  if (!source.width || !source.height || source.width * source.height > LIMITS.pixels) throw new FieldError('PHOTO_DIMENSIONS');
  const manipulator = ImageManipulator.manipulate(source.uri);
  if (source.width > 2400 || source.height > 2400) manipulator.resize(source.width >= source.height ? { width: 2400 } : { height: 2400 });
  const image = await manipulator.renderAsync();
  const output = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.88 });
  try {
    const bytes = await new File(output.uri).bytes();
    const id = Crypto.randomUUID();
    await vault.savePhoto({ id, visitId: visit.id, ownerUid: vault.uid, itemKey, phase, caption: '', included: true,
      capturedAt: new Date().toISOString(), mime: 'image/jpeg', bytes: bytes.length, sha256: await sha256(bytes),
      width: output.width, height: output.height, state: 'queued', receivedBytes: 0 }, bytes, visit.revision);
    // Only remove app-owned cache copies after the encrypted transaction commits.
    for (const uri of new Set([source.uri, output.uri])) {
      if (uri.startsWith(Paths.cache.uri)) { try { const f = new File(uri); if (f.exists) f.delete(); } catch { /* cleanup can be retried by the OS */ } }
    }
  } finally { image.release(); manipulator.release(); }
}
