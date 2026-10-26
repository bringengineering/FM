import { beforeEach, it, expect, vi } from 'vitest';
import { jpeg, visit } from './helpers';
import type { Vault } from '../src/domain/model';
const capture = vi.hoisted(() => ({ context: undefined as any, image: undefined as any, deleted: [] as string[], read: vi.fn(), size: 8 }));
vi.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: () => capture.context }, SaveFormat: { JPEG: 'jpeg' } }));
vi.mock('expo-file-system', () => ({ Paths: { cache: { uri: 'file:///cache/' } }, File: class {
  constructor(private uri: string) {} get exists() { return true; } get size() { return capture.size; }
  bytes() { return capture.read(); } delete() { capture.deleted.push(this.uri); }
} }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'photo-test' }));
vi.mock('../src/storage/open-vault', () => ({ sha256: async () => 'a'.repeat(64) }));
import { persistCapture } from '../src/capture';
const source = { uri: 'file:///cache/source.jpg', width: 2000, height: 1000 };
beforeEach(() => {
  capture.deleted = []; capture.size = 8; capture.read = vi.fn(async () => jpeg);
  capture.image = { saveAsync: vi.fn(async () => ({ uri: 'file:///cache/converted.jpg', width: 2000, height: 1000 })), release: vi.fn() };
  capture.context = { resize: vi.fn(), renderAsync: vi.fn(async () => capture.image), release: vi.fn() };
});
it('keeps the captured source when durable storage fails and releases decoder resources', async () => {
  const vault = { uid: 'staff-a', savePhoto: vi.fn(async () => { throw new Error('storage full'); }) } as unknown as Vault;
  await expect(persistCapture(vault, visit(), source, 'entrance', 'before')).rejects.toThrow('storage full');
  expect(capture.deleted).toEqual([]); expect(capture.image.release).toHaveBeenCalledOnce(); expect(capture.context.release).toHaveBeenCalledOnce();
});
it('releases the decoder when rendering or JPEG conversion fails', async () => {
  capture.context.renderAsync.mockRejectedValueOnce(new Error('decode'));
  await expect(persistCapture({} as Vault, visit(), source, 'entrance', 'before')).rejects.toThrow('decode');
  expect(capture.context.release).toHaveBeenCalledOnce();
  capture.image.saveAsync.mockRejectedValueOnce(new Error('encode'));
  await expect(persistCapture({} as Vault, visit(), source, 'entrance', 'before')).rejects.toThrow('encode');
  expect(capture.image.release).toHaveBeenCalledOnce(); expect(capture.deleted).toEqual([]);
});
it('checks output size before allocating the photograph and never removes a non-cache original', async () => {
  capture.size = 21 * 1024 * 1024;
  const vault = { uid: 'staff-a', savePhoto: vi.fn(async () => undefined) } as unknown as Vault;
  await expect(persistCapture(vault, visit(), source, 'entrance', 'before')).rejects.toThrow('PHOTO_INVALID'); expect(capture.read).not.toHaveBeenCalled();
  capture.size = 8; await persistCapture(vault, visit(), { ...source, uri: 'file:///documents/original.jpg' }, 'entrance', 'before');
  expect(capture.deleted).toEqual(['file:///cache/converted.jpg']);
});
