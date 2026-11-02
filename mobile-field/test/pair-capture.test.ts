import { expect, it } from 'vitest';
import { beforeChoices, defaultReference } from '../src/domain/capture-guide';
import { assertPhoto, type Photo } from '../src/domain/model';
import { makeVault, photo, visit, jpeg } from './helpers';

const at = async (id: string, phase: Photo['phase'], capturedAt: string, extra: Partial<Photo> = {}): Promise<Photo> => ({ ...(await photo()), id, phase, capturedAt, ...extra });

it('overlays the first before photo of the area that no after photo is lined up with yet', async () => {
  const b1 = await at('b1', 'before', '2026-10-26T00:01:00Z'), b2 = await at('b2', 'before', '2026-10-26T00:02:00Z');
  const other = await at('b9', 'before', '2026-10-26T00:00:00Z', { itemKey: 'corridor' });
  expect(beforeChoices([b2, other, b1], 'entrance').map(p => p.id)).toEqual(['b1', 'b2']);
  expect(defaultReference([b2, b1], 'entrance')).toBe('b1');
  const a1 = await at('a1', 'after', '2026-10-26T01:00:00Z', { pairWith: 'b1' });
  expect(defaultReference([b1, b2, a1], 'entrance')).toBe('b2');
  const a2 = await at('a2', 'after', '2026-10-26T01:01:00Z', { pairWith: 'b2' });
  expect(defaultReference([b1, b2, a1, a2], 'entrance')).toBe('b1');
  expect(defaultReference([a1], 'entrance')).toBe('');
});

it('accepts a pair only on an after photo pointing at another photo id', async () => {
  expect(() => assertPhoto({ ...(basePhoto()), phase: 'after', pairWith: 'b1' })).not.toThrow();
  expect(() => assertPhoto({ ...(basePhoto()), phase: 'before', pairWith: 'b1' })).toThrow('PHOTO_INVALID');
  expect(() => assertPhoto({ ...(basePhoto()), phase: 'after', pairWith: 'photo-a' })).toThrow('PHOTO_INVALID');
  expect(() => assertPhoto({ ...(basePhoto()), phase: 'after', pairWith: 'bad id/../' })).toThrow('PHOTO_INVALID');
});
function basePhoto(): Photo { return { id: 'photo-a', visitId: 'visit-a', ownerUid: 'staff-a', itemKey: 'entrance', phase: 'before', caption: '', included: true, capturedAt: '2026-10-26T00:01:00Z', mime: 'image/jpeg', bytes: jpeg.length, sha256: 'a'.repeat(64), width: 10, height: 10, state: 'queued', receivedBytes: 0 }; }

it('keeps the pair through caption edits and drops it when the photo moves area', async () => {
  const { vault } = await makeVault();
  await vault.saveVisit(visit(), null);
  const after = { ...(await photo()), id: 'after-1', phase: 'after' as const, pairWith: 'photo-a' };
  await vault.savePhoto(after, jpeg, 1);
  let saved = (await vault.load()).photos[0]!;
  expect(saved.pairWith).toBe('photo-a');
  await vault.editPhoto({ ...saved, caption: '설명' }, 2);
  saved = (await vault.load()).photos[0]!;
  expect(saved.pairWith).toBe('photo-a');
  await vault.editPhoto({ ...saved, itemKey: 'corridor' }, 3);
  expect((await vault.load()).photos[0]!.pairWith).toBeUndefined();
  await vault.close();
});
