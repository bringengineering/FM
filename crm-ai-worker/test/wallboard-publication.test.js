import test from 'node:test';import assert from 'node:assert/strict';
import {validatePublication} from '../src/wallboard-publication.js';
import {createPairingService} from '../src/wallboard-pairing.js';
const snapshot=()=>({model:{counts:{assigned:1,doing:0,submitted:0,returned:0,done:0},total:1,overdue:0,unknown:0,people:[{name:'직원',total:1,done:0,overdue:0}],roadmap:{range:{from:'2026-08-24',to:'2026-10-18',todayOffset:49,weeks:[{start:'2026-08-24',end:'2026-08-30',label:'8월 4주'}]},lanes:[{assigneeName:'직원',projectCount:1,progress:30,assignments:[{projectName:'CRM',startDate:'2026-09-01',endDate:'2026-09-30',progress:30,health:'normal',layout:{left:14,width:53,clippedStart:false,clippedEnd:false}}]}]},portfolio:{overallProgress:30,healthCounts:{normal:1,check:0,risk:0,done:0},projects:[{name:'CRM',owner:'직원',progress:30,health:'normal',open:1}],weeklyDone:[{label:'8/24',count:0}],milestones:[]},schedule:{available:true,entries:[],today:[],week:[]}},playlist:[{key:'roadmap',enabled:true,seconds:40}],notice:'이번 주 업무 확인',dataDate:'2026-09-20'});
test('publication accepts only safe consistent display fields',()=>{
 assert.deepEqual(validatePublication(snapshot()),snapshot());
 const bad=snapshot();bad.model.phone='secret';assert.throws(()=>validatePublication(bad),/INVALID_INPUT/);
 const wrong=snapshot();wrong.model.total=3;assert.throws(()=>validatePublication(wrong),/INVALID_INPUT/);
 const time=snapshot();time.playlist[0].seconds=1;assert.throws(()=>validatePublication(time),/INVALID_INPUT/);
});
test('manual TV publication rejects phone and email contact details in public text',()=>{
 const notice=snapshot();notice.notice='고객 연락처 010-1234-5678';
 assert.throws(()=>validatePublication(notice),/INVALID_INPUT/);
 const project=snapshot();project.model.portfolio.projects[0].name='홍길동 hong@example.com';
 assert.throws(()=>validatePublication(project),/INVALID_INPUT/);
 const lane=snapshot();lane.model.roadmap.lanes[0].assignments[0].projectName='홍길동 01012345678';
 assert.throws(()=>validatePublication(lane),/INVALID_INPUT/);
});
test('new project review counts are optional for old TV snapshots and bounded for new ones',()=>{
 const legacy=snapshot();
 assert.deepEqual(validatePublication(legacy),legacy);
 const next=snapshot();
 Object.assign(next.model.portfolio.projects[0],{reviewedDone:0,reviewedTotal:1});
 assert.deepEqual(validatePublication(next),next);
 const impossible=structuredClone(next);
 impossible.model.portfolio.projects[0].reviewedDone=2;
 assert.throws(()=>validatePublication(impossible),/INVALID_INPUT/);
 const partial=structuredClone(next);
 delete partial.model.portfolio.projects[0].reviewedTotal;
 assert.throws(()=>validatePublication(partial),/INVALID_INPUT/);
});
test('legacy undated completed-work count is optional for old snapshots and bounded for new ones',()=>{
 const old=snapshot();assert.deepEqual(validatePublication(old),old);
 const next=snapshot();next.model.counts.assigned=0;next.model.counts.done=1;next.model.people[0].done=1;next.model.portfolio.unattributedDone=1;
 assert.deepEqual(validatePublication(next),next);
 next.model.portfolio.unattributedDone=2;
 assert.throws(()=>validatePublication(next),/INVALID_INPUT/);
 next.model.portfolio.unattributedDone=-1;
 assert.throws(()=>validatePublication(next),/INVALID_INPUT/);
});
test('approved weekly report projection is optional, bounded, and contains no narrative',()=>{
 const old=snapshot();assert.deepEqual(validatePublication(old),old);
 const next=snapshot();next.dataDate='2026-09-24';next.model.weeklyReports={available:true,periodStart:'2026-09-21',periodEnd:'2026-09-27',approvedReports:2,approvedTotal:3,approvedDone:1};
 assert.deepEqual(validatePublication(next),next);
 const impossible=structuredClone(next);impossible.model.weeklyReports.approvedDone=4;
 assert.throws(()=>validatePublication(impossible),/INVALID_INPUT/);
 const privateText=structuredClone(next);privateText.model.weeklyReports.summary='고객 상담 내용';
 assert.throws(()=>validatePublication(privateText),/INVALID_INPUT/);
});
test('approved weekly-report period must be the publication week',()=>{
 const board=snapshot();board.dataDate='2026-09-24';
 board.model.weeklyReports={available:true,periodStart:'2026-09-14',periodEnd:'2026-09-20',approvedReports:1,approvedTotal:1,approvedDone:1};
 assert.throws(()=>validatePublication(board),/INVALID_INPUT/);
 board.model.weeklyReports.periodStart='2026-09-21';board.model.weeklyReports.periodEnd='2026-09-27';
 assert.deepEqual(validatePublication(board),board);
});
test('published board uses optimistic revision and requires unrevoked device on every read',async()=>{
 let state={};let queue=Promise.resolve();const repository={transaction:fn=>{const p=queue.then(()=>fn(state));queue=p.catch(()=>{});return p;}};
 const service=createPairingService({repository,now:()=>1000}),admin={uid:'a',isAdmin:true};
 const p=await service.begin();await service.approve(p.code,'TV',admin);const d=await service.poll(p.pendingToken);
 assert.equal((await service.readBoard(d.deviceToken)).board,null);
 await assert.rejects(service.publish(snapshot(),0,{uid:'s',isAdmin:false}),/FORBIDDEN/);
 assert.equal((await service.publish(snapshot(),0,admin)).version,1);
 await assert.rejects(service.publish(snapshot(),0,admin),/VERSION_CONFLICT/);
 const read=await service.readBoard(d.deviceToken);assert.equal(read.board.version,1);assert.equal(read.board.publishedAt,1000);
 assert.ok(!JSON.stringify(read).includes(d.deviceToken));
 await service.revoke(d.deviceId,admin);await assert.rejects(service.readBoard(d.deviceToken),/INVALID_TOKEN/);
});
test('administrator list returns presentation settings without the CRM model',async()=>{
 let state={};let queue=Promise.resolve();const repository={transaction:fn=>{const p=queue.then(()=>fn(state));queue=p.catch(()=>{});return p;}};
 const service=createPairingService({repository,now:()=>1000}),admin={uid:'a',isAdmin:true};
 const publication=snapshot();await service.publish(publication,0,admin);
 const result=await service.list(admin);
 assert.deepEqual(result.presentation,{playlist:publication.playlist,notice:publication.notice});
 assert.equal('model' in result,false);
 assert.equal(JSON.stringify(result).includes('직원'),false);
});
