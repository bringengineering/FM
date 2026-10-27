import { expect,it,vi } from 'vitest';
import { CompanyRecordingApi } from '../src/api/recording';
import { aiDraftState,reportFacts } from '../src/domain/ai-report';
import { visit,photo } from './helpers';

it('sends only fixed area labels and included photo counts to the existing AI gateway',async()=>{
  const v=visit();v.job.title='PRIVATE CUSTOMER';v.job.address='PRIVATE ADDRESS';
  const p={...await photo(),caption:'PRIVATE CAPTION'};
  const fetcher=vi.fn(async (_url:RequestInfo|URL,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));
    expect(body.kind).toBe(v.job.kind);expect(body.areas).toEqual([{key:p.itemKey,before:1,during:0,after:0}]);
    for(const secret of ['PRIVATE CUSTOMER','PRIVATE ADDRESS','PRIVATE CAPTION',p.sha256,p.id])expect(JSON.stringify(body)).not.toContain(secret);
    expect(JSON.stringify(body)).not.toContain('data:image');
    return Response.json({ok:true,result:{text:'구역별 현장 사진을 정리하여 전달드립니다.'}});
  });
  const api=new CompanyRecordingApi('https://field-test.invalid/v1/field-app',v.ownerUid,async()=>({uid:v.ownerUid,idToken:'test-token',appCheckToken:'test-check'}),fetcher as typeof fetch);
  expect(await api.aiReport(v,[p],new AbortController().signal)).toContain('현장 사진');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('does not send excluded photos or other employees records',async()=>{
  const v=visit(),p=await photo();
  expect(()=>reportFacts(v,[{...p,included:false},{...p,ownerUid:'other'}])).toThrow('AI_PHOTOS_REQUIRED');
});
it('does not hide provider authorization failures as successful drafts',async()=>{
  const v=visit(),api=new CompanyRecordingApi('https://field-test.invalid/v1/field-app',v.ownerUid,async()=>({uid:v.ownerUid,idToken:'test-token',appCheckToken:'test-check'}),async()=>Response.json({error:'private detail'},{status:403}));
  await expect(api.aiReport(v,[await photo()],new AbortController().signal)).rejects.toThrow('AI_ACCESS_REQUIRED');
});
it('detects changed capture counts and distinguishes manually edited text',async()=>{
  const v=visit(),p=await photo();v.draft.summary='AI 초안';v.aiDraft={summary:'AI 초안',facts:JSON.stringify(reportFacts(v,[p]))};
  expect(aiDraftState(v,[p])).toBe('current');
  const after={...p,id:'photo-b',phase:'after' as const};
  expect(aiDraftState(v,[p,after])).toBe('stale');
  v.draft.summary='직접 수정한 내용';expect(aiDraftState(v,[p,after])).toBe('edited_stale');
  expect(aiDraftState(v,[p])).toBe('edited');
});
