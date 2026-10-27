import {expect,it} from 'vitest';
import {captureCleanupUris} from '../src/domain/capture-cleanup';
it('cleans only app cache derivatives on failure and retains the original for recovery',()=>{
  expect(captureCleanupUris('file:///app/cache/source.jpg','file:///app/cache/output.jpg','file:///app/cache',false)).toEqual(['file:///app/cache/output.jpg']);
  expect(captureCleanupUris('file:///app/cache/source.jpg','file:///app/cache/source.jpg','file:///app/cache',false)).toEqual([]);
  expect(captureCleanupUris('file:///gallery/source.jpg','file:///app/cache/output.jpg','file:///app/cache',true)).toEqual(['file:///app/cache/output.jpg']);
  expect(captureCleanupUris('file:///app/cache2/source.jpg','file:///app/cache/output.jpg','file:///app/cache',true)).toEqual(['file:///app/cache/output.jpg']);
});
