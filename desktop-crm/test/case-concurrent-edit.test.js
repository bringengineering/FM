const test = require("node:test");
const assert = require("node:assert/strict");
const { FirebaseRemoteClient } = require("../src/remote");
const Core = require("../src/core");

function fixture(initial) {
  let record=initial && structuredClone(initial), version=1, writes=0, race=false;
  const client=new FirebaseRemoteClient({Core,fs:{},safeStorage:{},shell:{},sessionFile:"",pendingFile:""});
  client.session={uid:"u1",role:"member",email:"member@example.test",mustChangePassword:false};
  client.dbReadWithEtag=async location=>{assert.equal(location,"cases/case1");return {value:record && structuredClone(record),etag:String(version)};};
  client.dbConditionalPut=async (location,next,etag)=>{
    assert.equal(location,"cases/case1");
    if(race){record={...record,externalUpdate:"새 변경"};version++;}
    if(String(version)!==etag)throw Object.assign(new Error("conflict"),{code:"BUILDING_SCHEDULE_CONFLICT"});
    record=structuredClone(next);version++;writes++;
  };
  return {client,get:()=>record,writes:()=>writes,race:()=>{race=true;}};
}

test("완료된 다음 단계는 자동 진행으로 되돌리지 않는다",async()=>{
  const f=fixture({id:"case1",status:{c5:"doing",c6:"done"},note:{c3:"기록"},external:{important:"유지"}});
  await f.client.saveWorkflowCase({caseKey:"case1",stepKey:"c5",stepStatus:"done",expectedStepStatus:"doing"});
  assert.equal(f.get().status.c5,"done");assert.equal(f.get().status.c6,"done");assert.equal(f.get().note.c3,"기록");assert.equal(f.get().external.important,"유지");
});

test("대기 중인 다음 단계만 자동으로 시작한다",async()=>{
  const f=fixture({id:"case1",status:{c5:"doing",c6:"wait"}});
  await f.client.saveWorkflowCase({caseKey:"case1",stepKey:"c5",stepStatus:"done",expectedStepStatus:"doing"});
  assert.equal(f.get().status.c6,"doing");
});

test("상태와 메모가 화면을 연 뒤 바뀌면 저장하지 않는다",async()=>{
  const f=fixture({id:"case1",status:{c3:"done"},note:{c3:"다른 사람의 메모"}});
  await assert.rejects(f.client.saveWorkflowCase({caseKey:"case1",stepKey:"c3",stepStatus:"doing",expectedStepStatus:"wait"}),{code:"CASE_CONFLICT"});
  await assert.rejects(f.client.saveWorkflowCase({caseKey:"case1",stepKey:"c3",stepNote:"내 메모",expectedStepNote:"이전 메모"}),{code:"CASE_CONFLICT"});
  assert.equal(f.writes(),0);assert.equal(f.get().note.c3,"다른 사람의 메모");
});

test("기본 정보의 오래된 값과 삭제된 민원은 덮어쓰거나 복구하지 않는다",async()=>{
  const f=fixture({id:"case1",name:"새 이름",summary:"보존"});
  await assert.rejects(f.client.saveWorkflowCase({caseKey:"case1",fields:{name:"내 이름"},expectedFields:{name:"이전 이름"}}),{code:"CASE_CONFLICT"});
  assert.equal(f.writes(),0);assert.equal(f.get().name,"새 이름");
  const missing=fixture(null);
  await assert.rejects(missing.client.saveWorkflowCase({caseKey:"case1",stepKey:"c1",stepNote:"메모",expectedStepNote:""}),{code:"CASE_CONFLICT"});
  assert.equal(missing.writes(),0);
});

test("읽은 뒤 다른 기록이 바뀐 경우 원자적 저장을 거절한다",async()=>{
  const f=fixture({id:"case1",name:"이름"});f.race();
  await assert.rejects(f.client.saveWorkflowCase({caseKey:"case1",fields:{name:"수정"},expectedFields:{name:"이름"}}),{code:"CASE_CONFLICT"});
  assert.equal(f.writes(),0);assert.equal(f.get().externalUpdate,"새 변경");
});

test("완료 개수가 아니라 실제 진행 중인 단계와 전체 완료를 표시한다",()=>{
  assert.equal(Core.workflowProgress({status:{c5:"done"}}).current,"진행 중인 단계 없음");
  assert.equal(Core.workflowProgress({status:{c1:"done",c3:"done",c4:"doing"}}).current,Core.WORKFLOW_STEPS[3]);
  assert.equal(Core.workflowProgress({status:Object.fromEntries(Core.WORKFLOW_STEPS.map((_,i)=>[`c${i+1}`,"done"]))}).current,"민원 처리 완료");
});
