import { expect,it,vi } from 'vitest';
import { CompanyRecordingApi } from '../src/api/recording';
import { reportFacts } from '../src/domain/ai-report';
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
