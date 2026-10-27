import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { sha256 } from './storage/open-vault';
import { FieldError, LIMITS, type Phase, type Vault, type Visit } from './domain/model';
import { captureCleanupUris } from './domain/capture-cleanup';

export async function persistCapture(vault: Vault, visit: Visit, source: { uri: string; width: number; height: number }, itemKey: string, phase: Phase): Promise<void> {
  if (!Number.isSafeInteger(source.width) || !Number.isSafeInteger(source.height) || source.width < 1 || source.height < 1 || source.width * source.height > LIMITS.pixels) throw new FieldError('PHOTO_DIMENSIONS');
  const manipulator = ImageManipulator.manipulate(source.uri);
  let image: Awaited<ReturnType<typeof manipulator.renderAsync>> | undefined;
  let outputUri:string|undefined,committed=false;
  try {
    if (source.width > 2400 || source.height > 2400) manipulator.resize(source.width >= source.height ? { width: 2400 } : { height: 2400 });
    image = await manipulator.renderAsync();
    const output = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.88 });
    outputUri=output.uri;
    const file = new File(output.uri);
    if (!file.exists || file.size > LIMITS.photoBytes) throw new FieldError('PHOTO_INVALID');
    const bytes = await file.bytes();
    const id = Crypto.randomUUID();
    await vault.savePhoto({ id, visitId: visit.id, ownerUid: vault.uid, itemKey, phase, caption: '', included: true,
      capturedAt: new Date().toISOString(), mime: 'image/jpeg', bytes: bytes.length, sha256: await sha256(bytes),
      width: output.width, height: output.height, state: 'queued', receivedBytes: 0 }, bytes, visit.revision);
    committed=true;
  } finally {
    for(const uri of captureCleanupUris(source.uri,outputUri,Paths.cache.uri,committed))try{const f=new File(uri);if(f.exists)f.delete();}catch{/* OS may clear temporary cache later */}
    image?.release(); manipulator.release();
  }
}
