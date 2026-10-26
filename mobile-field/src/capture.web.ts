import type { Phase, Vault, Visit } from './domain/model';
import { FieldError } from './domain/model';
import { sha256 } from './storage/open-vault.web';
export async function persistCapture(vault: Vault, visit: Visit, source: { uri: string; width: number; height: number }, itemKey: string, phase: Phase): Promise<void> {
  // Web build is only for synthetic UI review. Native camera/storage is separate.
  if (vault.uid !== 'development-sample' || !source.uri.startsWith('data:image/jpeg;base64,')) throw new FieldError('NATIVE_BUILD_REQUIRED');
  const raw = atob(source.uri.split(',')[1] ?? ''); const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
  await vault.savePhoto({ id: crypto.randomUUID(), visitId: visit.id, ownerUid: vault.uid, itemKey, phase, caption: '개발 검증용 합성 사진', included: true,
    capturedAt: new Date().toISOString(), mime: 'image/jpeg', bytes: bytes.length, sha256: await sha256(bytes), width: source.width, height: source.height, state: 'queued', receivedBytes: 0 }, bytes, visit.revision);
}
