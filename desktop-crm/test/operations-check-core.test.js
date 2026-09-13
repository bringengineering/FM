const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const modulePath = path.join(__dirname, '../src/operations-check-core.js');
const Core = fs.existsSync(modulePath) ? require(modulePath) : {};
const options = { today:'2026-09-13', availability:{buildings:true,customers:true,contracts:true,serviceContracts:true,serviceRecords:true} };
function fixture() { return {buildings:[{id:'b1',name:'A',ownerCustomerId:'u1'},{id:'b2',name:'B'},{id:'b3',name:'C'},{id:'b4',archivedAt:'2026-01-01'}],customers:[{id:'u1'}],contracts:[],serviceContracts:[],serviceRecords:[]}; }
function contract(extra={}) { return {id:'c1',buildingId:'b1',types:['건물관리'],billingCycle:'월 정기',status:'진행 중',startDate:'2026-09-01',...extra}; }
function build(data, extra={}) { assert.equal(typeof Core.buildOperationsCheck,'function','read-only aggregation must be implemented'); return Core.buildOperationsCheck(data,{...options,...extra}); }
test('counts unique active buildings, management and exclusive cleaning',()=>{
 const data=fixture();data.contracts=[contract(),contract({id:'c2',types:['청소']}),contract({id:'c3',buildingId:'b2',types:['청소'],status:'종료 예정',endDate:'2026-09-13'}),contract({id:'c4',buildingId:'b3',billingCycle:'건별'})];
 const before=JSON.stringify(data);const result=build(data);
 assert.equal(result.metrics.registeredBuildings,3);assert.equal(result.metrics.managedBuildings,1);assert.equal(result.metrics.cleaningOnlyBuildings,1);assert.equal(JSON.stringify(data),before);
});
test('date boundaries, cancellation and future contracts do not count as current',()=>{
 for(const extra of [{startDate:'2026-09-14'},{endDate:'2026-09-12'},{status:'종료'},{status:'취소'},{buildingId:'b4'}]) {const data=fixture();data.contracts=[contract(extra)];assert.equal(build(data).metrics.managedBuildings,0);}
 const data=fixture();data.contracts=[contract({startDate:'2026-09-13',endDate:'2026-09-13'})];assert.equal(build(data).metrics.managedBuildings,1);
});
test('unknown or inconsistent contract fields are held rather than guessed',()=>{
 for(const extra of [{startDate:''},{startDate:'2026-02-30'},{startDate:'2026-09-20',endDate:'2026-09-01'},{status:'mystery'},{types:['unknown']},{buildingId:'missing'},{billingCycle:'unknown'}]) {const data=fixture();data.contracts=[contract(extra)];const r=build(data);assert.equal(r.metrics.managedBuildings,0);assert.equal(r.metrics.heldContracts,1);assert.ok(r.issues.some(x=>x.category==='contracts'));}
});
test('both contract sources normalize without merging same IDs or names',()=>{
 const data=fixture();data.contracts=[contract()];data.serviceContracts={c1:{buildingId:'b2',serviceType:'stair_cleaning',status:'active',cadence:'weekly',startDate:'2026-09-01'}};
 const r=build(data);assert.equal(r.metrics.managedBuildings,1);assert.equal(r.metrics.cleaningOnlyBuildings,1);
 data.serviceContracts.c1.status='planned';data.serviceContracts.c1.startDate='';assert.equal(build(data).metrics.cleaningOnlyBuildings,0);assert.equal(build(data).metrics.heldContracts,1);
});
test('work missing direct customer is not assigned the building owner',()=>{
 const data=fixture();data.serviceRecords=[{id:'s1',buildingId:'b1',status:'completed',completedAt:'2026-09-12'}];const before=JSON.stringify(data);const r=build(data);
 assert.equal(r.metrics.evidenceTasks,1);assert.equal(r.issues.filter(x=>x.id==='s1').length,3);assert.ok(r.issues.some(x=>x.reason.includes('건물주 간접 연결')));assert.ok(r.issues.some(x=>x.reason.includes('단건이면 정상')));assert.equal(JSON.stringify(data),before);
});
test('evidence references and conflicting completion states are distinguished',()=>{
 const data=fixture();data.serviceRecords=[{id:'s1',buildingId:'b1',status:'completed',evidenceUrl:'https://drive.google.com/file/d/test'},{id:'s2',buildingId:'b1',status:'completed',driveFileId:'file1'},{id:'s3',buildingId:'b1',status:'planned',completedAt:'2026-09-12'}];
 const r=build(data);assert.equal(r.metrics.evidenceTasks,1);assert.ok(r.issues.some(x=>x.id==='s3'&&x.category==='status'));
});
test('failed and partial reads are not represented as zero',()=>{
 const data=fixture();const r=build(data,{availability:{buildings:true}});assert.equal(r.metrics.registeredBuildings,3);assert.equal(r.metrics.managedBuildings,null);assert.equal(r.metrics.evidenceTasks,null);
 const unknown=build(data,{availability:{}});assert.equal(unknown.metrics.registeredBuildings,null);
 const empty=build({buildings:[],customers:[],contracts:[],serviceContracts:[],serviceRecords:[]});assert.equal(empty.metrics.registeredBuildings,0);assert.equal(empty.metrics.managedBuildings,0);
});
test('unavailable customer source does not imply a broken customer reference',()=>{
 const data=fixture();data.serviceRecords=[{id:'s1',buildingId:'b1',customerId:'u2',contractId:'c1',status:'planned'}];data.contracts=[contract()];
 const r=build(data,{availability:{...options.availability,customers:false}});assert.ok(!r.issues.some(x=>x.reason.includes('고객을 찾을')));
});
test('object collections keep key identity and duplicate building IDs count once',()=>{
 const data=fixture();data.buildings={b1:{name:'A'},b2:{name:'B'}};data.contracts={c1:{...contract(),id:undefined}};assert.equal(build(data).metrics.managedBuildings,1);
 data.buildings=[{id:'b1'},{id:'b1'}];assert.equal(build(data).metrics.registeredBuildings,1);
});
test('invalid today fails closed rather than comparing malformed dates',()=>{assert.throws(()=>build(fixture(),{today:'invalid'}),/today/);});
