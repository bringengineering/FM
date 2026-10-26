import { FieldError, assertOwner, assertPhoto, invalidateVisit, LIMITS, type Photo, type Vault, type Visit, type Workspace } from '../domain/model';

// Browser review uses ephemeral synthetic data only. It never writes company
// photos to localStorage/IndexedDB or substitutes for encrypted native storage.
export async function sha256(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes))), b => b.toString(16).padStart(2, '0')).join('');
}
export async function openVault(uid: string): Promise<Vault> {
  if (uid !== 'development-sample') throw new FieldError('NATIVE_BUILD_REQUIRED');
  let data: Workspace = { visits: [], photos: [] }; const files = new Map<string, Uint8Array>(); let closed = false;
  const check = () => { if (closed) throw new FieldError('VAULT_CLOSED'); };
  const visitAt = (id: string, expected: number) => { const v = data.visits.find(v => v.id === id); if (!v || v.revision !== expected) throw new FieldError('REVISION_CONFLICT'); return v; };
  return {
    uid,
    async load() { check(); return structuredClone(data); },
    async saveVisit(visit: Visit, expected: number | null) { check(); assertOwner(visit.ownerUid, uid);
      if (expected === null ? data.visits.some(v => v.id === visit.id) : !visitAt(visit.id, expected)) throw new FieldError('REVISION_CONFLICT');
      data.visits = [...data.visits.filter(v => v.id !== visit.id), structuredClone(visit)];
    },
    async savePhoto(photo: Photo, bytes: Uint8Array, expected: number) {
      check(); assertOwner(photo.ownerUid, uid); assertPhoto(photo, bytes);
      const digest = await sha256(bytes); check();
      if (digest !== photo.sha256) throw new FieldError('PHOTO_INTEGRITY_FAILED');
      const v = visitAt(photo.visitId, expected);
      if (data.photos.filter(p => p.visitId === v.id).length >= LIMITS.photos) throw new FieldError('PHOTO_LIMIT');
      if (files.has(photo.id)) throw new FieldError('PHOTO_EXISTS');
      data.photos.push(structuredClone(photo)); files.set(photo.id, bytes.slice());
      data.visits = data.visits.map(row => row.id === v.id ? invalidateVisit(row) : row);
    },
    async editPhoto(photo, expected) { check(); assertOwner(photo.ownerUid, uid); const v = visitAt(photo.visitId, expected);
      data.photos = data.photos.map(p => p.id === photo.id ? { ...p, itemKey: photo.itemKey, phase: photo.phase, caption: photo.caption, included: photo.included } : p);
      data.visits = data.visits.map(row => row.id === v.id ? invalidateVisit(row) : row);
    },
    async updateTransfer() { throw new FieldError('SERVER_NOT_CONNECTED'); },
    async prepareTransfer() { throw new FieldError('SERVER_NOT_CONNECTED'); },
    async readBytes(id) { check(); const bytes = files.get(id); if (!bytes) throw new FieldError('PHOTO_NOT_FOUND'); return bytes.slice(); },
    async close() { closed = true; data = { visits: [], photos: [] }; files.clear(); },
  };
}
