import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createWorker} from '../src/index.js';

const worker=createWorker();
const env={};

test('web TV shell and same-origin assets are served with strict security headers',async()=>{
 const html=await worker.fetch(new Request('https://gateway.test/tv'),env);
 assert.equal(html.status,200);assert.match(html.headers.get('content-type'),/text\/html/);
 assert.match(html.headers.get('content-security-policy'),/default-src 'none'/);
 assert.match(html.headers.get('content-security-policy'),/script-src 'self'/);
 assert.equal(html.headers.get('x-frame-options'),'DENY');
 const source=await html.text();assert.match(source,/BRING/);assert.match(source,/업무지시/);assert.doesNotMatch(source,/010-\d{3,4}-\d{4}|Bearer |api[_-]?key/i);
 const css=await worker.fetch(new Request('https://gateway.test/tv/app.css'),env);assert.match(css.headers.get('content-type'),/text\/css/);
 const js=await worker.fetch(new Request('https://gateway.test/tv/app.js'),env);assert.match(js.headers.get('content-type'),/javascript/);
 assert.equal(html.headers.get('cache-control'),'no-store');assert.equal(css.headers.get('cache-control'),'no-store');assert.equal(js.headers.get('cache-control'),'no-store');
});

test('web TV exposes an uncached application version for zero-touch refresh',async()=>{
 const response=await worker.fetch(new Request('https://gateway.test/tv/version'),env);
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.match(response.headers.get('content-type'),/application\/json/);
 const value=await response.json();assert.deepEqual(Object.keys(value),['version']);assert.match(value.version,/^tv-web-\d{4}-\d{2}-\d{2}-\d+$/);
});
test('changed TV presentation assets advance the client application version',async()=>{
 const response=await worker.fetch(new Request('https://gateway.test/tv/version'),env);
 assert.deepEqual(await response.json(),{version:'tv-web-2026-09-28-11'});
});
test('web TV uses the supplied Bring Care logo and hides the issues scene',async()=>{
 const logo=await worker.fetch(new Request('https://gateway.test/tv/brand.png'),env);
 assert.equal(logo.status,200);
 assert.equal(logo.headers.get('content-type'),'image/png');
 assert.deepEqual([...new Uint8Array(await logo.arrayBuffer()).slice(0,8)],[137,80,78,71,13,10,26,10]);
 const html=await (await worker.fetch(new Request('https://gateway.test/tv'),env)).text();
 assert.match(html,/Bring Care 로고/);
 assert.match(html,/tv-rail/);
 const source=await (await worker.fetch(new Request('https://gateway.test/tv/app.js'),env)).text();
 assert.match(source,/item\.key!=='issues'/);
 assert.match(source,/roadmap-tasks/);
 const css=await (await worker.fetch(new Request('https://gateway.test/tv/app.css'),env)).text();
 assert.match(css,/\.tv-rail/);
 assert.match(css,/\.roadmap-task/);
});
test('web TV separately labels approved project weekly reports',async()=>{
 const source=await (await worker.fetch(new Request('https://gateway.test/tv/app.js'),env)).text();
 assert.match(source,/승인된 프로젝트 주간 보고/);
 assert.match(source,/weeklyReports\.approvedDone/);
 assert.match(source,/집계 대기/);
});
test('web TV rotates an approved strategy scene and skips it when unavailable',async()=>{
 const source=await (await worker.fetch(new Request('https://gateway.test/tv/app.js'),env)).text();
 assert.match(source,/strategy:'회사 방향'/);
 assert.match(source,/function renderStrategy\(/);
 assert.match(source,/strategy\.goals/);
 assert.match(source,/집계 대기/);
 assert.match(source,/model\.strategy/);
 assert.match(source,/function validStrategy\(/);
 assert.match(source,/validStrategy\(m\.strategy/);
 const css=await (await worker.fetch(new Request('https://gateway.test/tv/app.css'),env)).text();
 assert.match(css,/\.strategy-layout/);
});
test('web TV cached direction expires at the Korea new year',async()=>{
 const source=await (await worker.fetch(new Request('https://gateway.test/tv/app.js'),env)).text();
 const helper=source.match(/function currentStrategy\(strategy,instant=new Date\(\)\)\{.*?\}(?=\s*function active\()/s)?.[0];
 assert.ok(helper,'client must expose an explicit current-year strategy guard');
 const currentStrategy=vm.runInNewContext(`${helper};currentStrategy`);
 assert.equal(currentStrategy({year:'2026'},new Date('2026-12-31T14:59:59Z')),true);
 assert.equal(currentStrategy({year:'2026'},new Date('2026-12-31T15:00:00Z')),false);
 assert.match(source,/currentStrategy\(board\?\.model\?\.strategy\)/);
 assert.match(source,/displayedKey==='strategy'&&!currentStrategy\(board\.model\.strategy\)/);
});
test('web TV leaves a cached old-year direction after a failed refresh without losing other scenes',async()=>{
 const source=await (await worker.fetch(new Request('https://gateway.test/tv/app.js'),env)).text();
 let instant='2026-12-31T14:59:59.000Z';
 class ClockDate extends Date{constructor(...args){super(...(args.length?args:[instant]));}}
 class Element{
  constructor(){this.children=[];this.textContent='';this.style={};this.hidden=false;}
  append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=[...items];}
  addEventListener(){}
 }
 const elements=new Map(),getElement=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 const snapshot={version:1,publishedAt:Date.parse('2026-12-31T14:50:00Z'),dataDate:'2026-12-31',notice:'회사 공지',playlist:[{key:'strategy',enabled:true,seconds:30},{key:'notice',enabled:true,seconds:30}],model:{total:0,overdue:0,unknown:0,counts:{assigned:0,doing:0,submitted:0,returned:0,done:0},people:[],schedule:{available:true,entries:[],today:[],week:[]},roadmap:{range:{weeks:[]},lanes:[]},portfolio:{overallProgress:0,healthCounts:{normal:0,check:0,risk:0,done:0},projects:[],weeklyDone:[],milestones:[]},strategy:{year:'2026',vision:'지난해 승인 비전',organization:[],goals:[]}}};
 const intervals=[];
 const context={Date:ClockDate,document:{visibilityState:'visible',getElementById:getElement,createElement:()=>new Element()},localStorage:{getItem:key=>key==='bring-public-wallboard'?JSON.stringify(snapshot):null,setItem(){},removeItem(){}},fetch:async()=>{throw Error('offline');},setInterval:(fn,ms)=>{intervals.push({fn,ms});},setTimeout:()=>{},location:{href:'https://gateway.test/tv',replace(){}},URL};
 vm.runInNewContext(source,context);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(getElement('scene-title').textContent,'회사 방향');
 assert.equal(getElement('connection').textContent,'연결 확인 중 · 최근 게시자료 유지');
 instant='2026-12-31T15:00:00.000Z';
 intervals.find(item=>item.ms===1000).fn();
 assert.equal(getElement('scene-title').textContent,'회사 공지');
 assert.equal(getElement('content').children[0].children[0].textContent,'회사 공지');
});
test('web TV pages the organization instead of rendering all 30 people at once',async()=>{
 const source=await (await worker.fetch(new Request('https://gateway.test/tv/app.js'),env)).text();
 assert.match(source,/strategy\.organization\.slice\(page\*6,page\*6\+6\)/);
 assert.match(source,/Math\.ceil\(\(model\.strategy\?\.organization\.length\|\|0\)\/6\)/);
});
test('web TV shows at most three strategy goals per screen at 720p',async()=>{
 const source=await (await worker.fetch(new Request('https://gateway.test/tv/app.js'),env)).text();
 assert.match(source,/ordered\.slice\(page\*3,page\*3\+3\)/);
 assert.match(source,/Math\.ceil\(\(model\.strategy\?\.goals\.length\|\|0\)\/3\)/);
});

test('web TV accepts and displays approved monthly and quarterly strategy goals',async()=>{
 const source=await (await worker.fetch(new Request('https://gateway.test/tv/app.js'),env)).text();
 assert.match(source,/Q1','Q2','Q3','Q4'/);
 assert.match(source,/length:12/);
 assert.match(source,/goals\.length>40/);
 assert.match(source,/· 현재/);
 assert.match(source,/진척률 미산정/);
});

test('web TV only rotates five concise scenes, including legacy publications',async()=>{
 const source=await (await worker.fetch(new Request('https://gateway.test/tv/app.js'),env)).text();
 const helper=source.match(/active=(function\(\)\{[\s\S]*?\});/)?.[1];
 assert.ok(helper,'TV client must define its automatic scene selection');
 const rotationKeys=['overview','portfolio','notice','strategy','companyRevenue'];
 assert.match(source,/const rotationKeys=\['overview','portfolio','notice','strategy','companyRevenue'\]/);
 const sceneKeys=['overview','roadmap','portfolio','weeklyTrend','health','milestones','scheduleToday','scheduleWeek','people','issues','notice','strategy','companyRevenue'];
 const durations=Object.fromEntries(sceneKeys.map(key=>[key,30]));
 const legacy={playlist:sceneKeys.map(key=>({key,enabled:true,seconds:30})),model:{strategy:{year:'2026'}}};
 const active=vm.runInNewContext(`(${helper})`,{board:legacy,sceneKeys,rotationKeys,durations,currentStrategy:()=>true});
 assert.deepEqual(active().map(item=>item.key),rotationKeys);
 assert.deepEqual(active().map(item=>item.seconds),rotationKeys.map(()=>30));
 assert.match(source,/if\(scene\.key==='overview'\)return 1/);
});

test('web TV exposes shared typography tokens for consistent TV readability',async()=>{
 const css=await (await worker.fetch(new Request('https://gateway.test/tv/app.css'),env)).text();
 assert.match(css,/--tv-font-small/);
 assert.match(css,/--tv-font-body/);
 assert.match(css,/--tv-font-heading/);
 assert.match(css,/font-family:"Pretendard","Noto Sans KR",system-ui,sans-serif/);
 assert.match(css,/\.content[^}]*font-size:var\(--tv-font-body\)/);
 assert.match(css,/\.overview-roadmap,\.overview-agenda\{display:none!important\}/);
 assert.match(css,/grid-template-areas:"clean trend"/);
});

test('web TV client rotates roadmap performance and schedule scenes safely',async()=>{
 const source=await (await worker.fetch(new Request('https://gateway.test/tv/app.js'),env)).text();
 assert.doesNotThrow(()=>new vm.Script(source), 'served TV client must be valid JavaScript');
 for(const key of ['roadmap','portfolio','weeklyTrend','health','milestones','scheduleToday','scheduleWeek','people','issues','notice'])assert.match(source,new RegExp(`['"]${key}['"]`));
 assert.match(source,/setInterval\(\(\)=>\{if\(!pendingToken\)void refresh\(\);\},2000\)/);assert.doesNotMatch(source,/15000/);assert.match(source,/textContent/);assert.doesNotMatch(source,/\.innerHTML\s*=/);
 assert.match(source,/localStorage/);assert.match(source,/visibilityState/);assert.match(source,/AUTH_REQUIRED/);
 assert.match(source,/bring-public-wallboard-pairing/);assert.match(source,/restorePairing/);assert.match(source,/clearPairing/);
 assert.match(source,/INVALID_TOKEN/);assert.match(source,/begin\(\)/);assert.match(source,/Array\.isArray\(value\.model\.people\)/);
 assert.match(source,/page/);assert.match(source,/slice\(page\*6,page\*6\+6\)/);
 assert.match(source,/\/tv\/version/);assert.match(source,/60000/);assert.match(source,/location\.replace/);
 assert.match(source,/cache:\s*['"]no-store['"]/);
 assert.doesNotMatch(source,/\b(phone|consultation|password|detailedAddress)\b/i);
});

test('web TV overview keeps cleaning and weekly summary while hiding duplicate roadmap and schedule panels',async()=>{
 const source=await (await worker.fetch(new Request('https://gateway.test/tv/app.js'),env)).text();
 assert.match(source,/overview:'회사 운영 요약'/);
 assert.match(source,/function renderOverview\(/);
 for(const label of ['전체 업무 완료율','전체 업무','완료','기한 초과','검수 대기'])assert.ok(source.includes(label),`missing ${label}`);
 assert.match(source,/scene\.key==='overview'\)return 1/);
 assert.match(source,/!board\.playlist\.some\(item=>item\.key==='overview'\)\)enabled\.push/);
 const css=await (await worker.fetch(new Request('https://gateway.test/tv/app.css'),env)).text();
 assert.match(css,/\.summary-view/);
});
test('web TV shows the current Monday-to-Sunday roadmap from the same publication',async()=>{
 const source=await (await worker.fetch(new Request('https://gateway.test/tv/app.js'),env)).text();
 assert.doesNotMatch(source,/roadmapMode|8주 요약|8일 상세/);
 assert.match(source,/function roadmapView\(model\)/);
 assert.match(source,/이번 주/);
 assert.match(source,/board\.dataDate/);
 const helpers=source.match(/function addDays\(value,amount\)[\s\S]*?(?=function emptyRoadmap\()/)?.[0];
 assert.ok(helpers,'served TV client must contain the roadmap projection');
 const {roadmapView}=vm.runInNewContext(`${helpers};({roadmapView})`,{board:{dataDate:'2026-09-24'}});
 const model={roadmap:{range:{from:'2026-08-31'},lanes:[{assignments:[{startDate:'2026-09-20',endDate:'2026-10-02',progress:42}]}]}};
 const daily=roadmapView(model);
 assert.equal(daily.range.from,'2026-09-21');
 assert.equal(daily.range.to,'2026-09-27');
 assert.equal(daily.range.weeks.length,7);
 assert.equal(daily.range.weeks[0].label,'9/21 월');
 assert.equal(daily.range.weeks[6].label,'9/27 일');
 assert.equal(daily.lanes[0].assignments[0].layout.width,100);
 assert.equal(model.roadmap.range.from,'2026-08-31','source is not mutated');
 assert.match(source,/assignment-row/);
 assert.doesNotMatch(source,/position%3/);
 const css=await (await worker.fetch(new Request('https://gateway.test/tv/app.css'),env)).text();
 assert.match(css,/\.week-grid\{[^}]*repeat\(7,1fr\)/);
 assert.match(css,/\.content>\.roadmap-layout \.week-grid span\.is-today/);
 assert.match(css,/\.content>\.roadmap-layout \.person b/);
});
test('TV roadmap groups every assignee under one project row',async()=>{
 const source=await (await worker.fetch(new Request('https://gateway.test/tv/app.js'),env)).text();
 const helper=source.match(/function projectRoadmapRows\(model,roadmap\)[\s\S]*?(?=function renderRoadmap\()/)?.[0];
 assert.ok(helper);
 const projectRoadmapRows=vm.runInNewContext(`${helper};projectRoadmapRows`,{betweenDays:(a,b)=>Math.round((Date.parse(b)-Date.parse(a))/86400000)});
 const model={portfolio:{projects:[{name:'네이버 광고',progress:20,health:'check',open:2,owner:''}]},roadmap:{lanes:[
  {assigneeName:'김현진',assignments:[{projectName:'네이버 광고',startDate:'2026-09-28',endDate:'2026-10-02',progress:20}]},
  {assigneeName:'황우중',assignments:[{projectName:'네이버 광고',startDate:'2026-09-29',endDate:'2026-10-03',progress:0},{projectName:'미연결 업무',startDate:'2026-09-30',endDate:'2026-10-01',progress:0}]}
 ]}};
 const rows=projectRoadmapRows(model,{range:{from:'2026-09-28',to:'2026-10-04'}});
 assert.equal(rows.length,2);
 assert.equal(rows[0].name,'네이버 광고');
 assert.deepEqual(Array.from(rows[0].owners),['김현진','황우중']);
 assert.equal(rows[0].open,2);
 assert.equal(rows[1].name,'프로젝트 미지정 업무');
 assert.equal(rows[1].open,1);
 const css=await (await worker.fetch(new Request('https://gateway.test/tv/app.css'),env)).text();
 assert.match(css,/\.project-roadmap/);
});
test('web TV stylesheet compacts content for common TV heights',async()=>{
 const source=await (await worker.fetch(new Request('https://gateway.test/tv/app.css'),env)).text();
 assert.match(source,/@media\(max-height:1100px\)/);assert.match(source,/\.timeline \.row/);
 assert.match(source,/\.roadmap-layout/);assert.match(source,/\.overall-progress/);
 assert.match(source,/\.roadmap-performance/);assert.match(source,/\.progress-ring/);assert.match(source,/conic-gradient/);
});

test('web TV roadmap separates input progress and reviewed work without new publication fields',async()=>{
 const source=await (await worker.fetch(new Request('https://gateway.test/tv/app.js'),env)).text();
 assert.match(source,/model\.counts\.done\/model\.total/);
 assert.match(source,/업무 검수 완료율/);
 assert.match(source,/입력 진도 평균/);
 assert.match(source,/집계 대기/);
 assert.match(source,/건수 기준/);
 const css=await (await worker.fetch(new Request('https://gateway.test/tv/app.css'),env)).text();
 assert.match(css,/\.review-metric/);
});
test('web TV distinguishes no projects from measured zero progress',async()=>{
 const source=await (await worker.fetch(new Request('https://gateway.test/tv/app.js'),env)).text();
 assert.match(source,/model\.total\+'건 업무지시'/);
 assert.match(source,/model\.total\?completion\+'%'\:'—'/);
});
test('web TV portfolio labels each project input progress and reviewed completion with a legacy fallback',async()=>{
 const source=await (await worker.fetch(new Request('https://gateway.test/tv/app.js'),env)).text();
 assert.match(source,/item\.reviewedDone/);
 assert.match(source,/item\.reviewedTotal/);
 assert.match(source,/업무 검수/);
 assert.match(source,/집계 대기/);
 assert.match(source,/입력 진도/);
 assert.match(source,/reviewed-progress/);
 const css=await (await worker.fetch(new Request('https://gateway.test/tv/app.css'),env)).text();
 assert.match(css,/\.portfolio-row \.reviewed-progress/);
});

test('unknown TV asset paths fail closed',async()=>{
 const response=await worker.fetch(new Request('https://gateway.test/tv/private.json'),env);
 assert.equal(response.status,404);assert.equal(response.headers.get('cache-control'),'no-store');
});
