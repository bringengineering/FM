import { expect, it, vi } from 'vitest';
import { saveGroupedReport } from '../src/domain/save-report';
import type { Visit } from '../src/domain/model';
import { toReport } from '../src/domain/report';
import { makeVault, visit, photo, jpeg } from './helpers';

it('saves edited text and the chosen area photos, then uploads and archives the confirmed revision',async()=>{
  const {vault}=await makeVault();try{
    const v=visit();v.job.customerId='customer-a';v.job.buildingId='';await vault.saveVisit(v,null);await vault.savePhoto(await photo(),jpeg,1);
    await vault.savePhoto({...await photo(),id:'photo-b',itemKey:'corridor',phase:'after'},jpeg,2);
    const state=await vault.load(),sync=vi.fn(async()=>{}),archive=vi.fn(async()=>({id:'synthetic-document'}));
    const result=await saveGroupedReport({vault,visit:state.visits[0]!,photos:state.photos,summary:'테스트 작업 기록',followUp:'',notes:{},onLocalSave:async()=>{},sync,archive});
    expect(result.ok).toBe(true);const saved=(await vault.load()).visits[0]!;
    expect(saved.draft.summary).toBe('테스트 작업 기록');expect(saved.draft.confirmedRevision).toBe(saved.revision);
    expect(sync).toHaveBeenCalledWith(saved,state.photos);expect(archive).toHaveBeenCalledWith(saved);
    const grouped=toReport(saved,state.photos).items;expect(grouped.find(item=>item.key==='entrance')?.before).toHaveLength(1);expect(grouped.find(item=>item.key==='corridor')?.after).toHaveLength(1);
    expect(saved.draft.statuses).toEqual({}); // Merely recording photos must not claim completion.
  }finally{await vault.close();}
});
it('retains a confirmed local draft and never archives after an upload error; retry uses the same revision',async()=>{
  const {vault}=await makeVault();try{
    await vault.saveVisit(visit(),null);await vault.savePhoto(await photo(),jpeg,1);let state=await vault.load();
    const sync=vi.fn().mockRejectedValueOnce(new Error('synthetic upload failure')).mockResolvedValue(undefined),archive=vi.fn(async(_visit:Visit)=>({id:'synthetic'}));
    const base={vault,photos:state.photos,summary:'보존할 초안',followUp:'',notes:{},onLocalSave:async()=>{},sync,archive};
    await expect(saveGroupedReport({...base,visit:state.visits[0]!})).rejects.toThrow('synthetic upload failure');expect(archive).not.toHaveBeenCalled();
    state=await vault.load();const revision=state.visits[0]!.revision;expect(state.visits[0]!.draft.confirmedRevision).toBe(revision);
    expect((await saveGroupedReport({...base,visit:state.visits[0]!})).ok).toBe(true);expect(archive.mock.calls[0]![0].revision).toBe(revision);
  }finally{await vault.close();}
});
