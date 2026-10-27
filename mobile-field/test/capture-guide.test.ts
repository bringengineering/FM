import { expect, it } from 'vitest';
import { areaPhotoCount,captureProgress,changeCaptureAreas,firstUncapturedArea,initialCaptureAreas,nextUncapturedArea } from '../src/domain/capture-guide';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeVault,photo,visit,jpeg } from './helpers';

it('guides selected areas independently for before and after while allowing multiple shots',async()=>{
  const v=visit(),before=await photo(),more={...before,id:'photo-2'},after={...before,id:'photo-3',phase:'after' as const,itemKey:'corridor'},photos=[before,more,after],areas=['entrance','corridor'];
  expect(areaPhotoCount(photos,'entrance','before')).toBe(2);
  expect(captureProgress(areas,photos,'before')).toEqual({done:1,total:2});
  expect(captureProgress(areas,photos,'after')).toEqual({done:1,total:2});
  expect(firstUncapturedArea(areas,photos,'before')).toBe('corridor');expect(firstUncapturedArea(areas,photos,'after')).toBe('entrance');
  expect(nextUncapturedArea(areas,photos,'before','entrance')).toBe('corridor');expect(nextUncapturedArea(areas,photos,'after','entrance')).toBe('');
  expect(changeCaptureAreas(v,photos,areas,'now').draft.confirmedRevision).toBeUndefined();
});
it('reopens the selected areas and before photos after an app restart',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'field-guide-')),path=join(dir,'test.db');
  try{
    let {vault}=await makeVault(path);await vault.saveVisit(visit(),null);await vault.savePhoto(await photo(),jpeg,1);
    let state=await vault.load();await vault.saveVisit(changeCaptureAreas(state.visits[0]!,state.photos,['entrance','corridor'],'now'),state.visits[0]!.revision);await vault.close();
    ({vault}=await makeVault(path));state=await vault.load();expect(state.visits[0]!.captureAreas).toEqual(['entrance','corridor']);expect(captureProgress(state.visits[0]!.captureAreas!,state.photos,'before').done).toBe(1);expect(firstUncapturedArea(state.visits[0]!.captureAreas!,state.photos,'after')).toBe('entrance');await vault.close();
  }finally{for(const name of ['test.db','test.db-wal','test.db-shm'])rmSync(join(dir,name),{force:true});rmdirSync(dir);}
});
it('keeps existing photos in the guide and prevents silently dropping a photographed area',async()=>{
  const v=visit(),p={...await photo(),itemKey:'parking'};
  expect(initialCaptureAreas(v,[p])).toContain('parking');
  expect(()=>changeCaptureAreas(v,[p],['entrance'],'now')).toThrow('CAPTURE_AREAS_INVALID');
  expect(()=>changeCaptureAreas(v,[],['not-real'],'now')).toThrow('CAPTURE_AREAS_INVALID');
  const next=changeCaptureAreas(v,[p],['entrance','parking'],'now');expect(next.captureAreas).toEqual(['entrance','parking']);expect(next.revision).toBe(v.revision+1);
});
