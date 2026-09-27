const test = require('node:test');
const assert = require('node:assert/strict');
const { FirebaseRemoteClient } = require('../src/remote');

const draft = { year:'2026', vision:'공간 운영을 투명하게', organization:[], goals:[{ id:'g1', period:'annual', title:'건물 데이터', unit:'count', baseline:0, target:3, current:null, source:'CRM 건물 ID' }] };
function client(role='admin') {
  const remote = new FirebaseRemoteClient({ Core:{}, fs:{}, safeStorage:{}, shell:{}, sessionFile:'', pendingFile:'' });
  remote.session = { uid:`user-${role}`, role, mustChangePassword:false };
  return remote;
}

test('member loads only published strategy, while draft is admin-only', async () => {
  const remote=client('member'); const locations=[];
  remote.dbRequest=async location=>{ locations.push(location); return location.includes('Publications') ? { year:'2026',content:JSON.stringify({year:'2026',vision:draft.vision,goals:{g1:draft.goals[0]}}),revision:1 } : null; };
  const result=await remote.loadCompanyStrategy({year:'2026'});
  assert.deepEqual(locations,['companyStrategyPublications/2026']);
  assert.equal(result.published.vision,draft.vision);
  assert.equal(result.draft,null);
});

test('member does not render malformed published strategy content', async () => {
  const remote=client('member');
  remote.dbRequest=async()=>({year:'2026',content:'{"year":"2026","vision":"게시 문구","goals":{}}',revision:1});
  await assert.rejects(remote.loadCompanyStrategy({year:'2026'}),{code:'INVALID_DATA'});
});

test('admin reads content-only draft as editable fields', async () => {
  const remote=client();
  remote.dbRequest=async location=>location.includes('Drafts')
    ? {year:'2026',content:JSON.stringify({year:'2026',vision:draft.vision,goals:{g1:{id:'g1',period:'annual',title:'건물 데이터',unit:'count',baseline:0,target:3,source:'CRM 건물 ID'}}}),revision:3}
    : null;
  const result=await remote.loadCompanyStrategy({year:'2026'});
  assert.equal(result.draft.vision,draft.vision);
  assert.equal(result.draft.goals.g1.title,'건물 데이터');
  assert.equal(result.draft.revision,3);
});

test('admin saves only a validated next draft revision with conditional write', async () => {
  const remote=client(); let written;
  remote.dbReadWithEtag=async()=>({value:null,etag:'"empty"'});
  remote.dbConditionalPut=async(location,value,etag)=>{written={location,value,etag};return true;};
  const result=await remote.saveCompanyStrategyDraft({ ...draft, expectedRevision:0 });
  assert.equal(written.location,'companyStrategyDrafts/2026');
  assert.equal(written.value.revision,1);
  assert.equal(Object.hasOwn(written.value,'vision'),false,'content is the only stored draft source');
  assert.equal(Object.hasOwn(written.value,'goals'),false,'structured fields cannot diverge from approved content');
  assert.equal(Object.hasOwn(written.value,'organization'),false,'structured fields cannot diverge from approved content');
  assert.equal(JSON.parse(written.value.content).goals.g1.title,'건물 데이터');
  assert.equal(result.goals.g1.title,'건물 데이터','admin still receives parsed draft fields');
  assert.equal(result.revision,1);
  await assert.rejects(remote.saveCompanyStrategyDraft({ ...draft, expectedRevision:1 }),{code:'CONFLICT'});
  await assert.rejects(client('member').saveCompanyStrategyDraft({ ...draft, expectedRevision:0 }),{code:'ACCESS_DENIED'});
});

test('admin draft serialization preserves monthly, quarterly and milestone goal fields',async()=>{
 const remote=client();let written;
 remote.dbReadWithEtag=async()=>({value:null,etag:'"empty"'});
 remote.dbConditionalPut=async(location,value)=>{written={location,value};return true;};
 const goals=[...draft.goals,{id:'q3',period:'Q3',title:'분기 영업 목표',unit:'count',baseline:0,target:6,current:2,source:'CRM 계약'},
  {id:'m09',period:'M09',title:'월간 자동화 단계',unit:'milestone',baseline:null,target:null,current:null,source:'운영 보고',milestoneStatus:'in_progress'}];
 const saved=await remote.saveCompanyStrategyDraft({...draft,goals,expectedRevision:0});
 const content=JSON.parse(written.value.content);
 assert.equal(content.goals.q3.period,'Q3');
 assert.equal(content.goals.m09.period,'M09');
 assert.equal(content.goals.m09.milestoneStatus,'in_progress');
 assert.equal(saved.goals.m09.milestoneStatus,'in_progress');
});

test('strategy document round-trips optional goals, themes and values without changing legacy records',async()=>{
 const remote=client();let written;
 remote.dbReadWithEtag=async()=>({value:null,etag:'"empty"'});
 remote.dbConditionalPut=async(location,value)=>{written={location,value};return true;};
 const expanded={...draft,strategicThemes:[{id:'ops',title:'운영 고도화',description:'표준 실행'}],coreValues:[{id:'execute',title:'실행',description:'작게 시작'}],goals:[{...draft.goals[0],ownerUid:'u2',businessUnit:'Cleaning Center',themeId:'ops',startDate:'2026-01-01',dueDate:'2026-12-31'}],expectedRevision:0};
 const saved=await remote.saveCompanyStrategyDraft(expanded);
 const fields=JSON.parse(written.value.content);
 assert.deepEqual(fields.strategicThemes,expanded.strategicThemes);
 assert.deepEqual(fields.coreValues,expanded.coreValues);
 assert.equal(fields.goals.g1.ownerUid,'u2');
 assert.equal(fields.goals.g1.businessUnit,'Cleaning Center');
 assert.equal(fields.goals.g1.themeId,'ops');
 assert.equal(fields.goals.g1.dueDate,'2026-12-31');
 assert.deepEqual(saved.strategicThemes,expanded.strategicThemes);
 assert.deepEqual(saved.coreValues,expanded.coreValues);
 assert.equal(saved.goals.g1.ownerUid,'u2');

 const oldContent={year:'2026',vision:draft.vision,goals:{g1:{...draft.goals[0]}}};
 const legacy=await (async()=>{
  remote.dbRequest=async()=>({year:'2026',content:JSON.stringify(oldContent),revision:1});
  return remote.loadCompanyStrategy({year:'2026'});
 })();
 assert.equal(legacy.draft.goals.g1.title,'건물 데이터');
 assert.equal(legacy.draft.strategicThemes,undefined,'legacy documents do not gain fabricated strategy fields');
});

test('publication copies the current validated draft and rejects stale approval', async () => {
  const remote=client(); let written;
  const stored={...draft,organization:{},goals:{g1:draft.goals[0]},content:JSON.stringify({year:'2026',vision:draft.vision,goals:{g1:{id:'g1',period:'annual',title:'건물 데이터',unit:'count',baseline:0,target:3,source:'CRM 건물 ID'}}}),revision:2,updatedAt:'2026-09-24T00:00:00.000Z',updatedBy:'user-admin'};
  remote.dbRequest=async location=>location==='companyStrategyDrafts/2026'?stored:null;
  remote.dbReadWithEtag=async()=>({value:null,etag:'"empty"'});
  remote.dbConditionalPut=async(location,value)=>{written={location,value};return true;};
  await assert.rejects(remote.publishCompanyStrategy({year:'2026',expectedDraftRevision:1}),{code:'CONFLICT'});
  const result=await remote.publishCompanyStrategy({year:'2026',expectedDraftRevision:2,expectedPublicationRevision:0});
  assert.equal(written.location,'companyStrategyPublications/2026');
  assert.equal(written.value.sourceRevision,2);
  assert.equal(written.value.revision,1);
  assert.equal(written.value.content,stored.content);
  assert.equal(Object.hasOwn(written.value,'goals'),false,'publication stores only the exact approved content');
  assert.equal(result.goals.g1.title,'건물 데이터','the CRM still receives the approved fields');
  assert.equal(result.publishedBy,'user-admin');
  await assert.rejects(client('member').publishCompanyStrategy({year:'2026',expectedDraftRevision:2}),{code:'ACCESS_DENIED'});
});

test('publication refuses a draft whose approved content differs from its editable fields', async () => {
  const remote=client();
  remote.dbRequest=async()=>({year:'2026',vision:draft.vision,goals:{g1:draft.goals[0]},revision:1,content:JSON.stringify({year:'2026',vision:'다른 내용',goals:{g1:{id:'g1',period:'annual',title:'건물 데이터',unit:'count',baseline:0,target:3,source:'CRM 건물 ID'}}})});
  await assert.rejects(remote.publishCompanyStrategy({year:'2026',expectedDraftRevision:1,expectedPublicationRevision:0}),{code:'CONFLICT'});
});

test('publication preserves optional approved strategy fields in the existing content document',async()=>{
 const remote=client();let written;
 const fields={year:'2026',vision:draft.vision,goals:{g1:{...draft.goals[0],ownerUid:'u2',businessUnit:'Cleaning Center',themeId:'ops',startDate:'2026-01-01',dueDate:'2026-12-31'}},strategicThemes:[{id:'ops',title:'운영 고도화',description:'표준 실행'}],coreValues:[{id:'execute',title:'실행',description:'작게 시작'}]};
 delete fields.goals.g1.current;
 const stored={year:'2026',revision:2,content:JSON.stringify(fields)};
 remote.dbRequest=async()=>stored;
 remote.dbReadWithEtag=async()=>({value:null,etag:'"empty"'});
 remote.dbConditionalPut=async(location,value)=>{written={location,value};return true;};
 const result=await remote.publishCompanyStrategy({year:'2026',expectedDraftRevision:2,expectedPublicationRevision:0});
 assert.equal(written.location,'companyStrategyPublications/2026');
 assert.deepEqual(JSON.parse(written.value.content).strategicThemes,fields.strategicThemes);
 assert.deepEqual(JSON.parse(written.value.content).coreValues,fields.coreValues);
 assert.equal(result.goals.g1.ownerUid,'u2');
});

test('organization members with dotted Firebase auth UIDs use safe child keys',async()=>{
 const remote=client();let written;
 remote.dbReadWithEtag=async()=>({value:null,etag:'"empty"'});
 remote.dbConditionalPut=async(_location,value)=>{written=value;return true;};
 await remote.saveCompanyStrategyDraft({...draft,organization:[{uid:'member.with.dot',role:'현장 담당',reportsToUid:''}],expectedRevision:0});
 const organization=JSON.parse(written.content).organization;
 assert.deepEqual(Object.keys(organization),[`m_${Buffer.from('member.with.dot').toString('base64url')}`]);
 assert.equal(Object.values(organization)[0].uid,'member.with.dot');
});
