const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Core = require('../src/marketing-core');
const UI = require('../src/marketing-ui');
const Persistence = require('../src/marketing-persistence');
const Bridge = require('../src/marketing-crm-bridge');

const now = new Date('2026-08-31T03:00:00Z'); // 2026-08-31 12:00 KST
const baseSnapshot = Object.freeze({
  period: Object.freeze({ start: '2026-08-25', end: '2026-08-31', previousStart: '2026-08-18', previousEnd: '2026-08-24' }),
  totals: Object.freeze({ spend: 100, inquiries: 4, validLeads: 2, quotes: 1, contracts: 1, contractAmount: 1000, expectedCost: 300, profit: 600 }),
  metrics: Object.freeze({ expectedMarketingProfit: 600 }), funnel: Object.freeze([]),
  channels: Object.freeze({ naver_blog: Object.freeze({ spend: 100, validLeads: 2, contracts: 1, contractAmount: 1000, profit: 600, rating: 'maintain', ratingLabel: '유지', rationale: Object.freeze(['근거']) , metrics: Object.freeze({ cpl: 50, cpa: 100, roas: 1000 }) }) }),
  filteredFacts: Object.freeze([]), comparison: Object.freeze({ totals: Object.freeze({}), metrics: Object.freeze({}), deltas: Object.freeze({}) }), exclusions: Object.freeze({})
});

test('buildAlerts observes exact KST time boundaries, dedupes, sorts and excludes private evidence', () => {
  const facts = [
    { caseId: 'case-inquiry', customerId: 'c1', inquiryAt: '2026-08-31T02:30:00Z', validLeads: 0, phone: '010-secret', privateNote: 'hide' },
    { caseId: 'case-lead', customerId: 'c2', inquiryAt: '2026-08-31T02:29:59Z', validLeads: 1, owner: '', nextContactAt: '2026-08-31', keyword: 'safe' },
    { caseId: 'case-quote', customerId: 'c3', quotes: 1, quoteSentAt: '2026-08-30T03:00:00Z', nextContactAt: '2026-08-30' },
    { caseId: 'case-contract', customerId: 'c4', contractStatus: 'needs_review', contractReviewAt: '2026-08-28T03:00:00Z', contracts: 1, contractAmount: 0, expectedCost: 0 },
    { caseId: 'case-lead', customerId: 'c2', validLeads: 1, owner: '' }
  ];
  const alerts = Core.buildAlerts({ snapshot: {...baseSnapshot,filteredFacts:facts}, facts, daily: [], sourceUpdatedAtMs: now.getTime() - 72 * 3600000 }, now);
  assert.ok(Object.isFrozen(alerts) && alerts.every(Object.isFrozen));
  for (const alert of alerts) assert.deepEqual(Object.keys(alert), ['id','code','severity','title','reason','targetType','targetId','occurredAt','dueAt','requiresAdminDecision','evidence']);
  assert.equal(alerts.filter(a => a.code === 'lead_missing_owner' && a.targetId === 'case-lead').length, 1);
  for (const code of ['inquiry_unanswered','lead_missing_owner','missing_next_contact','followup_today','followup_overdue','quote_no_response_24h','contract_review_3d','channel_stale_72h','missing_contract_amount','missing_expected_cost']) assert.ok(alerts.some(a => a.code === code), code);
  assert.ok(alerts.some(a => a.code === 'inquiry_unanswered' && a.targetId === 'case-inquiry'));
  assert.equal(alerts.find(a => a.code === 'channel_stale_72h').severity, 'urgent');
  assert.deepEqual(alerts.map(a => a.severity), alerts.map(a => a.severity).sort((a,b) => ({urgent:0,warning:1,info:2}[a]-({urgent:0,warning:1,info:2}[b]))));
  assert.doesNotMatch(JSON.stringify(alerts), /010-secret|hide|receipt|token/i);
});

test('advertising alerts require evidence-backed denominators and deterministic CPC samples', () => {
  const daily = [
    { id:'d1', date:'2026-08-30', channel:'naver_blog', keyword:'zero', spend:50, clicks:2, validLeads:0, dailyBudget:100, budgetValidatedAtMs:now.getTime()-3600000 },
    { id:'d2', date:'2026-08-31', channel:'naver_blog', keyword:'zero', spend:50, clicks:8, validLeads:0 }
  ];
  const zeroSnapshot = { ...baseSnapshot, totals:{ ...baseSnapshot.totals, clicks:10, validLeads:0 } };
  const alerts = Core.buildAlerts({ snapshot: zeroSnapshot, daily, budgets:{ daily:1 }, previousSnapshot:{ totals:{spend:40,clicks:20} } }, now);
  assert.equal(alerts.some(a => a.code === 'budget_80_percent'),false);
  assert.ok(alerts.some(a => a.code === 'spend_zero_valid_leads'));
  assert.ok(alerts.some(a => a.code === 'persistent_zero_leads'));
  assert.ok(alerts.some(a => a.code === 'cpc_sharp_increase'));
  assert.equal(Core.buildAlerts({ snapshot:zeroSnapshot, daily, previousSnapshot:{ totals:{spend:40,clicks:2} } }, now).some(a => a.code === 'budget_80_percent'), false);
  assert.equal(Core.buildAlerts({ snapshot:zeroSnapshot, daily:daily.slice(0,1), previousSnapshot:{ totals:{spend:40,clicks:2} } }, now).some(a => a.code === 'persistent_zero_leads'), false);
});

test('daily budget compares only the validated record day, never weekly or monthly totals', () => {
  const daily=[{id:'budget-day',date:'2026-08-30',channel:'naver_blog',spend:80,dailyBudget:100,budgetValidatedAtMs:now.getTime()-3600000},{id:'other-day',date:'2026-08-31',channel:'naver_blog',spend:900}];
  const alerts=Core.buildAlerts({snapshot:{...baseSnapshot,filteredDaily:daily,totals:{...baseSnapshot.totals,spend:980}},daily,budgets:{daily:100}},now);
  const budget=alerts.find(a=>a.code==='budget_80_percent');
  assert.equal(budget.targetType,'ad'); assert.equal(budget.targetId,'budget-day');
  assert.deepEqual(budget.evidence,{date:'2026-08-30',spend:80,budget:100,usagePercent:80});
});

test('real CRM bridge vocabulary drives quote review and lost-reason alerts with matching targets', () => {
  const cases=[
    {id:'case-quote',crmCustomerId:'customer-q',createdAt:'2026-08-20T00:00:00Z',quoteFiles:{q1:{id:'q1',uploadedAt:'2026-08-29T02:00:00Z',amount:10}}},
    {id:'case-lost',crmCustomerId:'customer-l',createdAt:'2026-08-20T00:00:00Z'}
  ];
  const store={customers:[{id:'customer-q'},{id:'customer-l',stage:'보류·거절'}],contracts:[{id:'contract-review',customerId:'customer-q',workflowCaseId:'case-quote',status:'계약 준비',updatedAt:'2026-08-27T02:00:00Z'}]};
  const facts=Bridge.projectFacts(store,{cases}), alerts=Core.buildAlerts({snapshot:{totals:{},filteredFacts:facts,filteredDaily:[]},facts},now);
  assert.ok(alerts.some(a=>a.code==='quote_no_response_24h'&&a.targetType==='case'&&a.targetId==='case-quote'));
  assert.ok(alerts.some(a=>a.code==='contract_review_3d'&&a.targetType==='contract'&&a.targetId==='contract-review'));
  assert.ok(alerts.some(a=>a.code==='missing_lost_reason'&&a.targetType==='case'&&a.targetId==='case-lost'));
});

test('latest quote revision binds one ID and time while only post-quote consultation suppresses no-response', () => {
  const workflowCase={id:'case-revisions',crmCustomerId:'customer-r',createdAt:'2026-08-20T00:00:00Z',quoteFiles:{old:{id:'quote-old',uploadedAt:'2026-08-27T01:00:00Z',amount:5},current:{id:'quote-current',uploadedAt:'2026-08-29T01:00:00Z',amount:10}}};
  const project=occurredAt=>Bridge.projectFacts({customers:[{id:'customer-r'}],activities:[{id:'consult',customerId:'customer-r',workflowCaseId:'case-revisions',context:'consultation',occurredAt}]},{cases:[workflowCase]})[0];
  const before=project('2026-08-28T01:00:00Z');
  assert.equal(before.quoteId,'quote-current'); assert.equal(before.quoteSentAt,'2026-08-29T01:00:00Z'); assert.equal(before.lastContactAt,'2026-08-28T01:00:00Z');
  assert.ok(Core.buildAlerts({snapshot:{totals:{},filteredFacts:[before],filteredDaily:[]}},now).some(a=>a.code==='quote_no_response_24h'));
  const after=project('2026-08-30T01:00:00Z');
  assert.equal(Core.buildAlerts({snapshot:{totals:{},filteredFacts:[after],filteredDaily:[]}},now).some(a=>a.code==='quote_no_response_24h'),false);
});

test('current contract review binds ID status and timestamp from the same deterministic record', () => {
  const fact=Bridge.projectFacts({customers:[{id:'customer-c'}],contracts:[
    {id:'a-old',customerId:'customer-c',workflowCaseId:'case-contracts',status:'계약 준비',updatedAt:'2026-08-20T01:00:00Z'},
    {id:'z-current',customerId:'customer-c',workflowCaseId:'case-contracts',status:'계약 준비',updatedAt:'2026-08-27T01:00:00Z'}
  ]},{cases:[{id:'case-contracts',crmCustomerId:'customer-c',createdAt:'2026-08-20T00:00:00Z'}]})[0];
  assert.equal(fact.contractId,'z-current'); assert.equal(fact.contractReviewAt,'2026-08-27T01:00:00Z'); assert.equal(fact.contractStatus,'needs_review');
  assert.ok(Core.buildAlerts({snapshot:{totals:{},filteredFacts:[fact],filteredDaily:[]}},now).some(a=>a.code==='contract_review_3d'&&a.targetId==='z-current'));
});

test('customer-only alert targets never enter the case route', () => {
  const alerts=Core.buildAlerts({snapshot:{totals:{},filteredFacts:[{customerId:'customer-only',validLeads:1,owner:'',occurredAt:'2026-08-31'}],filteredDaily:[]}},now);
  const owner=alerts.find(a=>a.code==='lead_missing_owner'); assert.equal(owner.targetType,'customer'); assert.equal(owner.targetId,'customer-only');
});

test('buildWeeklyReport reuses snapshot values, is immutable, honest, and deterministic', () => {
  const alerts = Core.buildAlerts({ snapshot: baseSnapshot, facts: [] }, now);
  const report = Core.buildWeeklyReport(baseSnapshot, alerts, now);
  assert.ok(Object.isFrozen(report) && Object.isFrozen(report.metrics));
  assert.deepEqual(report.metrics, { spend:100, inquiries:4, validLeads:2, quotes:1, contracts:1, contractAmount:1000, expectedProfit:600 });
  assert.equal(report.period.start, baseSnapshot.period.start);
  assert.equal(report.channels[0].spend, baseSnapshot.channels.naver_blog.spend);
  assert.equal(report.topService, '-');
  assert.equal(report.goodKeywords, '데이터 부족');
  assert.ok(report.nextWeekSuggestions.length <= 3);
  assert.equal(Object.isFrozen(report.metrics), true);
});

test('alerts and weekly routes render evidence, exact copy text, print controls, and overview reuses alerts', () => {
  const alertFacts=[{caseId:'c1',validLeads:1,owner:''}];
  const alerts = Core.buildAlerts({ snapshot:{...baseSnapshot,filteredFacts:alertFacts}, facts:alertFacts }, now);
  const report = Core.buildWeeklyReport(baseSnapshot, alerts, now);
  const alertHtml = UI.renderWorkspace({ view:'marketingAlerts', snapshot:baseSnapshot, filters:UI.defaultFilters(), alerts });
  assert.match(alertHtml, /긴급|주의|안내/);
  assert.match(alertHtml, /data-marketing-alert-target="c1"/);
  assert.match(alertHtml, /data-marketing-alert-type="case"/);
  assert.match(alertHtml, /근거/);
  const weekly = UI.renderWorkspace({ view:'marketingWeekly', snapshot:baseSnapshot, filters:UI.defaultFilters(), report });
  for (const label of ['총마케팅비','문의','유효문의','견적','계약','계약금액','예상이익','채널 성과','잘된 채널','문의 서비스','비용만 발생','실패 이유','다음 주 예산 의견','대표 결정']) assert.match(weekly, new RegExp(label));
  assert.match(weekly, /data-marketing-report-copy/);
  assert.match(weekly, /data-marketing-report-print/);
  assert.equal(UI.weeklyReportText(report).includes('총마케팅비: 100원'), true);
  const overview = UI.renderWorkspace({ view:'marketingOverview', snapshot:baseSnapshot, filters:UI.defaultFilters(), alerts });
  assert.match(overview, new RegExp(alerts[0].title));
});

test('weekly copy includes every displayed section from the exact report and clipboard failures stay local', () => {
  const report=Core.buildWeeklyReport(baseSnapshot,Core.buildAlerts({snapshot:baseSnapshot,facts:baseSnapshot.filteredFacts},now),now);
  const text=UI.weeklyReportText(report), screen=UI.renderWorkspace({view:'marketingWeekly',snapshot:baseSnapshot,filters:UI.defaultFilters(),report});
  for (const heading of ['채널 성과','잘된 채널 / 키워드·콘텐츠','문의 서비스','비용만 발생','실패 이유','다음 주 예산 의견','대표 결정','원천 갱신']) assert.ok(text.includes(heading),heading);
  for (const value of [report.sourceUpdatedState,...report.channels.map(item=>item.channel),...report.decisionItems.map(item=>item.title)]) assert.ok(text.includes(String(value))||screen.includes(String(value)));
  const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
  assert.match(app,/data-marketing-report-copy[\s\S]{0,500}try \{[\s\S]{0,300}weeklyReportText\(marketingController\.state\.report\)[\s\S]{0,400}catch[\s\S]{0,220}주간 보고를 복사하지 못했습니다/);
});

test('unavailable aggregate renders no fabricated alert/report and app provides local copy print navigation only', () => {
  assert.match(UI.renderWorkspace({ view:'marketingAlerts', unavailable:true, filters:UI.defaultFilters() }), /집계 데이터가 아직 준비되지 않았습니다/);
  assert.doesNotMatch(UI.renderWorkspace({ view:'marketingAlerts', unavailable:true, filters:UI.defaultFilters() }), /data-marketing-alert-target=/);
  const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  assert.match(app, /data-marketing-report-copy/);
  assert.match(app, /navigator\.clipboard\.writeText\(MarketingUI\.weeklyReportText/);
  assert.match(app, /data-marketing-report-print/);
  assert.match(app, /window\.print\(\)/);
  assert.match(app, /data-marketing-alert-target/);
  assert.doesNotMatch(app, /marketing-report[^\n]{0,100}(email|sms|fetch\()/i);
});

test('evidence recursively redacts sensitive keys and sensitive string patterns', () => {
  const alerts = Core.buildAlerts({ snapshot:{totals:{}}, facts:[{caseId:'safe',validLeads:1,owner:'담당자 이름',duplicateIdentityKey:'person@example.com',duplicateCount:2, nested:{phone:'010-1234-5678'}}] }, now);
  const text=JSON.stringify(alerts);
  assert.doesNotMatch(text,/010[- ]?1234|person@example\.com|담당자 이름/);
});

test('contracted or completed work without payment evidence creates a stable payment alert', () => {
  const alerts=Core.buildAlerts({snapshot:{totals:{}},facts:[{caseId:'case-pay',contractIds:['contract-9'],contracts:1,payments:0,workStage:true}]},now);
  const alert=alerts.find(item=>item.code==='payment_missing');
  assert.equal(alert.targetType,'contract');
  assert.equal(alert.targetId,'contract-9');
});

test('alerts and weekly report are equal under fact daily channel and alert permutations', () => {
  const facts=[{caseId:'b',validLeads:1,owner:''},{caseId:'a',validLeads:1,owner:''}];
  const daily=[{id:'2',date:'2026-08-31',channel:'naver_blog',keyword:'x',spend:1},{id:'1',date:'2026-08-30',channel:'naver_blog',keyword:'x',spend:1}];
  const snapshot={...baseSnapshot,filteredFacts:facts,channels:{soomgo:{spend:5,validLeads:0,contracts:0,profit:-5,rating:'stop_review'},naver_blog:baseSnapshot.channels.naver_blog}};
  const a=Core.buildAlerts({snapshot,facts,daily},now), b=Core.buildAlerts({snapshot:{...snapshot,filteredFacts:[...facts].reverse()},facts:[...facts].reverse(),daily:[...daily].reverse()},now);
  assert.deepEqual(a,b);
  assert.deepEqual(Core.buildWeeklyReport(snapshot,a,now),Core.buildWeeklyReport({...snapshot,channels:{naver_blog:baseSnapshot.channels.naver_blog,soomgo:snapshot.channels.soomgo},filteredFacts:[...facts].reverse()},[...a].reverse(),now));
});

test('staleness is emitted per channel and quote response evidence suppresses no-response', () => {
  const alerts=Core.buildAlerts({snapshot:{totals:{}},facts:[{caseId:'q',quotes:1,quoteSentAt:'2026-08-30T03:00:00Z',lastContactAt:'2026-08-30T04:00:00Z'}],sourceUpdatedAtMsByChannel:{naver_blog:now.getTime()-72*3600000,soomgo:now.getTime()-24*3600000},designStateUsed:true},now);
  assert.equal(alerts.some(a=>a.code==='quote_no_response_24h'),false);
  assert.ok(alerts.some(a=>a.code==='channel_stale_72h'&&a.targetId==='naver_blog'));
  assert.ok(alerts.some(a=>a.code==='channel_stale_warning'&&a.targetId==='soomgo'));
});

test('controller derives exact displayed report from wired raw metadata and app copies stored report', async () => {
  const controller=UI.createController({core:Core,bridge:{projectFacts:()=>[],sourceRevision:()=>''},now:()=>now,readRaw:async()=>({daily:[{id:'budget-day',date:'2026-08-31',channel:'naver_blog',spend:80,clicks:10,dailyBudget:100,budgetValidatedAtMs:now.getTime()-3600000}],budgets:{daily:100},sourceUpdatedAtMsByChannel:{naver_blog:now.getTime()-73*3600000}})});
  await controller.load({accessRole:'admin'},{});
  const derived=controller.derive([]);
  assert.equal(derived.report,controller.state.report);
  assert.ok(derived.alerts.some(a=>a.code==='budget_80_percent'));
  assert.ok(derived.alerts.some(a=>a.code==='channel_stale_72h'));
  const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
  assert.match(app,/marketingController\.derive\(facts\)/);
  assert.match(app,/weeklyReportText\(marketingController\.state\.report\)/);
  assert.doesNotMatch(app,/data-marketing-report-copy[\s\S]{0,700}buildWeeklyReport/);
  for(const type of ['case','contract','customer','ad','channel','budget','source']) assert.match(app,new RegExp(`targetType === "${type}"`));
});

test('alerts cannot escape snapshot period and shared filters', () => {
  const snapshot=Core.buildSnapshot({daily:[{id:'in',date:'2026-08-31',channel:'naver_blog',spend:1,updatedAtMs:now.getTime()}],facts:[{caseId:'in',date:'2026-08-31',channel:'naver_blog',service:'design',owner:'Kim',validLeads:1}]},{period:{type:'custom',start:'2026-08-31',end:'2026-08-31'},channel:'naver_blog',service:'design',owner:'Kim'},now);
  const alerts=Core.buildAlerts({snapshot,facts:[...snapshot.filteredFacts,{caseId:'out',date:'2026-07-01',channel:'soomgo',validLeads:1}],daily:[...snapshot.filteredDaily,{id:'out-ad',date:'2026-07-01',channel:'soomgo',keyword:'secret',spend:99}],sourceUpdatedAtMsByChannel:{soomgo:0,naver_blog:now.getTime()}},now);
  assert.doesNotMatch(JSON.stringify(alerts),/out|soomgo|secret/);
});

test('validated stored budget metadata flows through persistence envelope into real controller read path', async () => {
  const envelope=Persistence.readEnvelope({r1:{id:'r1',date:'2026-08-31',channel:'naver_blog',spend:80,dailyBudget:100,budgetValidatedAtMs:now.getTime(),updatedAtMs:now.getTime()}});
  assert.deepEqual(envelope.budgets,{daily:100});
  const controller=UI.createController({core:Core,bridge:{projectFacts:()=>[],sourceRevision:()=>''},now:()=>now,readRaw:async()=>envelope});
  await controller.load({accessRole:'admin'},{});
  assert.ok(controller.state.alerts.some(a=>a.code==='budget_80_percent'));
  const rules=fs.readFileSync(path.join(__dirname,'../../database.rules.json'),'utf8');
  assert.match(rules,/"dailyBudget"\s*:\s*\{\s*"\.validate"\s*:\s*"newData\.isNumber\(\) && newData\.val\(\) > 0/);
  assert.match(rules,/"budgetValidatedAtMs"\s*:\s*\{\s*"\.validate"\s*:\s*"newData\.isNumber\(\) && newData\.val\(\) > 0/);
});

test('ad targets use stable record IDs or non-sensitive aggregate fallback', () => {
  const snapshot={totals:{spend:2,validLeads:0},filteredFacts:[],filteredDaily:[{date:'2026-08-30',channel:'naver_blog',keyword:'private keyword',spend:1},{date:'2026-08-31',channel:'naver_blog',keyword:'private keyword',spend:1}]};
  const alert=Core.buildAlerts({snapshot},now).find(a=>a.code==='persistent_zero_leads');
  assert.equal(alert.targetId,'aggregate-ad-performance');
  assert.doesNotMatch(alert.targetId,/private keyword/);
  const stable={...snapshot,filteredDaily:snapshot.filteredDaily.map((row,index)=>({...row,id:`record-${index}`}))};
  assert.equal(Core.buildAlerts({snapshot:stable},now).find(a=>a.code==='persistent_zero_leads').targetId,'record-0');
});

test('CPC rise rejects zero previous CPC and reports only with positive sampled baseline', () => {
  const snapshot={totals:{spend:100,clicks:10},comparison:{totals:{spend:0,clicks:10}},filteredFacts:[],filteredDaily:[]};
  assert.equal(Core.buildAlerts({snapshot},now).some(a=>a.code==='cpc_sharp_increase'),false);
  assert.equal(Core.buildAlerts({snapshot:{...snapshot,comparison:{totals:{spend:10,clicks:10}}}},now).some(a=>a.code==='cpc_sharp_increase'),true);
});

test('weekly report clones inputs without freezing or mutating them', () => {
  const snapshot=structuredClone(baseSnapshot), alerts=[{id:'z',requiresAdminDecision:true,title:'z',reason:'z'}];
  const before=structuredClone(snapshot), report=Core.buildWeeklyReport(snapshot,alerts,now);
  assert.equal(Object.isFrozen(snapshot),false);
  assert.equal(Object.isFrozen(snapshot.totals),false);
  assert.deepEqual(snapshot,before);
  assert.notEqual(report.totals,snapshot.totals);
});

test('navigation identifies exact ad records and applies exact channel/source filter', () => {
  const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
  const ui=fs.readFileSync(path.join(__dirname,'../src/marketing-ui.js'),'utf8');
  assert.match(ui,/data-marketing-entry-id/);
  assert.match(app,/querySelector\(`\[data-marketing-entry-id=/);
  assert.match(app,/targetType === "channel"[\s\S]{0,220}setFilter\("channel", targetId\)/);
  assert.match(app,/targetType === "source"[\s\S]{0,220}setFilter\("channel", targetId\)/);
});

test('duplicate alert without stable entity IDs uses a constant target and leaks no identity into DOM', () => {
  const fact={id:'person@example.com',duplicateIdentityKey:'010-1234-5678 person@example.com',duplicateCount:2,name:'Secret Person'};
  const alerts=Core.buildAlerts({snapshot:{totals:{},filteredFacts:[fact],filteredDaily:[]},facts:[fact]},now);
  const duplicate=alerts.find(a=>a.code==='duplicate_customer_risk');
  assert.equal(duplicate.targetId,'aggregate-duplicate-customers');
  const html=UI.renderWorkspace({view:'marketingAlerts',snapshot:{totals:{}},filters:UI.defaultFilters(),alerts});
  assert.doesNotMatch(JSON.stringify(duplicate)+html,/010-1234|person@example|Secret Person/);
});

test('manual validated budget pair roundtrips UI normalize persistence controller and alert', async () => {
  const input=UI.renderMarketingInput({canWrite:true,draft:{date:'2026-08-31',channel:'naver_blog'}});
  assert.match(input,/name="dailyBudget"/); assert.match(input,/name="budgetValidatedAt"/); assert.match(input,/검증된 일예산/); assert.match(input,/근거 확인 후 입력/);
  const normalized=Core.normalizeManualRecord({date:'2026-08-31',channel:'naver_blog',spend:80,dailyBudget:100,budgetValidatedAt:'2026-08-31T11:00'});
  assert.equal(normalized.dailyBudget,100); assert.equal(normalized.budgetValidatedAtMs,Date.parse('2026-08-31T11:00:00+09:00'));
  assert.throws(()=>Core.normalizeManualRecord({date:'2026-08-31',channel:'naver_blog',dailyBudget:100}),/budget/i);
  assert.throws(()=>Core.normalizeManualRecord({date:'2026-08-31',channel:'naver_blog',dailyBudget:100,budgetValidatedAt:'2026-02-30T11:00'}),/timestamp/i);
  assert.throws(()=>Core.normalizeManualRecord({date:'2026-08-31',channel:'naver_blog',dailyBudget:100,budgetValidatedAt:'2026-08-31T11:00Z'}),/timestamp/i);
  const state={daily:{},audits:{},receipts:{}}, persistence=Persistence.createLocalPersistence({state,clock:()=>now.getTime(),getSession:()=>({uid:'u',email:'u@x',role:'admin',marketingRole:''}),resolveActor:()=>({authUid:'u',operatorId:'op',email:'u@x',accessRole:'admin',marketingRole:'',active:true})});
  await persistence.commit({id:'budget_record',requestId:'123e4567-e89b-42d3-a456-426614174000',expectedVersion:0,action:'create',values:normalized});
  const envelope=persistence.read(), controller=UI.createController({core:Core,bridge:{projectFacts:()=>[],sourceRevision:()=>''},now:()=>now,readRaw:async()=>envelope});
  await controller.load({accessRole:'admin'},{});
  assert.ok(controller.state.alerts.some(a=>a.code==='budget_80_percent'));
});

test('datetime-local budget validation has the same KST epoch under different OS timezones', () => {
  const modulePath=path.join(__dirname,'../src/marketing-core.js');
  const script=`const core=require(${JSON.stringify(modulePath)}); process.stdout.write(String(core.normalizeManualRecord({date:'2026-08-31',channel:'naver_blog',dailyBudget:100,budgetValidatedAt:'2026-08-31T11:00'}).budgetValidatedAtMs))`;
  const run=timezone=>execFileSync(process.execPath,['-e',script],{env:{...process.env,TZ:timezone},encoding:'utf8'});
  assert.equal(run('UTC'),String(Date.parse('2026-08-31T11:00:00+09:00')));
  assert.equal(run('America/New_York'),run('Asia/Seoul'));
});

test('Today stale alert uses selected channel history outside period and excludes unrelated channels', async () => {
  const controller=UI.createController({core:Core,bridge:{projectFacts:()=>[],sourceRevision:()=>''},now:()=>now,readRaw:async()=>({daily:[{id:'old',date:'2026-08-20',channel:'naver_blog',updatedAtMs:now.getTime()-73*3600000},{id:'other',date:'2026-08-20',channel:'soomgo',updatedAtMs:now.getTime()-80*3600000}]})});
  await controller.load({accessRole:'admin'},{}); controller.setFilter('channel','naver_blog'); controller.setPeriod('today');
  assert.ok(controller.state.alerts.some(a=>a.code==='channel_stale_72h'&&a.targetId==='naver_blog'));
  assert.equal(controller.state.alerts.some(a=>a.targetId==='soomgo'),false);
});

test('Today all-channel stale checks include stable channel history outside the selected period', async () => {
  const controller=UI.createController({core:Core,bridge:{projectFacts:()=>[],sourceRevision:()=>''},now:()=>now,readRaw:async()=>({daily:[{id:'old',date:'2026-08-20',channel:'naver_blog',updatedAtMs:now.getTime()-73*3600000},{id:'fresh',date:'2026-08-31',channel:'soomgo',updatedAtMs:now.getTime()-2*3600000}]})});
  await controller.load({accessRole:'admin'},{}); controller.setPeriod('today');
  assert.ok(controller.state.alerts.some(a=>a.code==='channel_stale_72h'&&a.targetId==='naver_blog'));
  assert.equal(controller.state.alerts.some(a=>a.code==='channel_stale_72h'&&a.targetId==='soomgo'),false);
});

test('pending evidence target survives async entry refresh and focuses after rerender', () => {
  const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
  assert.match(app,/let pendingMarketingEvidenceTarget = ""/);
  assert.match(app,/pendingMarketingEvidenceTarget = targetId/);
  assert.match(app,/marketingEntryController\.refresh\(\)\.then\(\(\) => \{ if \(currentWorkspace === "marketing" && currentMarketingView === "marketingInput"\) renderMarketingWorkspace\(\)/);
  assert.match(app,/pendingMarketingEvidenceTarget[\s\S]{0,500}data-marketing-entry-id[\s\S]{0,300}pendingMarketingEvidenceTarget = ""/);
});
