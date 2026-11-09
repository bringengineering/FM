import { expect, it } from 'vitest';
import { areaPhotoCount,capturePhases,captureProgress,changeCaptureAreas,firstUncapturedArea,hasBeforePhase,initialCaptureAreas,nextUncapturedArea,startPhase } from '../src/domain/capture-guide';
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

it('공용부는 작업 전 사진을 찍지 않는다: 작업 후부터 시작하고 작업 전 단계가 없다', () => {
  expect(capturePhases('common')).toEqual(['after', 'during']);
  expect(startPhase('common')).toBe('after');
  expect(hasBeforePhase('common')).toBe(false);
  expect(capturePhases('moveIn')).toEqual(['before', 'after', 'during']);
  expect(startPhase('moveIn')).toBe('before');
});

it('예전 공용부 구역으로 저장된 방문은 불러올 때 지금 구역으로 읽는다', async () => {
  const { withCurrentZones } = await import('../src/domain/report');
  const job = (kind: 'common' | 'moveIn') => ({ id: 'j', kind, title: 't', address: 'a', workDate: '2026-11-09', customerId: 'c' });
  const visit = (id: string, kind: 'common' | 'moveIn') => ({ id, ownerUid: 'u', job: job(kind), revision: 1, updatedAt: '', captureAreas: ['entrance', 'handrail', 'stairs', 'lighting'], draft: { summary: '', followUp: '', statuses: { handrail: 'done', stairs: 'recorded' }, notes: { handrail: '난간', stairs: '계단' } } });
  const photo = (visitId: string) => ({ id: `${visitId}-p`, visitId, ownerUid: 'u', itemKey: 'glass', phase: 'after', caption: '', included: true }) as never;
  const out = withCurrentZones({ visits: [visit('c1', 'common'), visit('m1', 'moveIn')] as never, photos: [photo('c1'), photo('m1')] });
  expect(out.visits[0]!.captureAreas).toEqual(['entrance', 'stairs', 'fixtures']);
  expect(out.visits[0]!.draft.statuses).toEqual({ stairs: 'done' });
  expect(out.visits[0]!.draft.notes).toEqual({ stairs: '난간 / 계단' });
  expect(out.photos.map(p => p.itemKey)).toEqual(['windows', 'glass']);
  expect(out.visits[1]!.captureAreas).toEqual(['entrance', 'handrail', 'stairs', 'lighting']);
});
