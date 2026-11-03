"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Summary = require("../src/contract-customer-summary");
const contract = {id:"c1",customerId:"owner",buildingId:"b1",name:"예시",type:"청소",billingCycle:"건별",status:"진행 중",startDate:"2026-10-06",workDate:"2026-10-06",paymentDueDate:"2026-10-15",cleaningSchedule:{mode:"once"}};
const moved = {id:"r1",sourceContractId:"c1",sourceContractDate:"2026-10-06",sourceContractBuildingId:"b1",buildingId:"b1",scheduledDate:"2026-10-08",status:"planned"};
test("변경한 날짜를 캘린더 원본과 같이 보여주고 원래 날짜는 되살리지 않는다", () => {
  const summary = Summary.calendarSummary(contract, {serviceRecords:[moved]}, "2026-10");
  assert.deepEqual(summary.items, [{date:"2026-10-08",status:"planned",source:"record"}]);
  assert.equal(summary.movedToOtherBuilding, false);
});
test("삭제·취소·다른 건물 변경은 예전 날짜를 새 일정인 것처럼 표시하지 않는다", () => {
  assert.deepEqual(Summary.calendarSummary(contract,{serviceRecords:[{...moved,archivedAt:"2026-10-07"}]},"2026-10").items, []);
  const canceled=Summary.calendarSummary(contract,{serviceRecords:[{...moved,status:"cancelled"}]},"2026-10");
  assert.deepEqual(canceled.items.map(x=>[x.date,x.status]),[["2026-10-08","cancelled"]]);
  const transferred=Summary.calendarSummary(contract,{serviceRecords:[{...moved,buildingId:"b2"}]},"2026-10");
  assert.equal(transferred.movedToOtherBuilding,true); assert.deepEqual(transferred.items,[]);
  const relinked=Summary.calendarSummary(contract,{serviceRecords:[{...moved,contractId:"c2"}]},"2026-10");
  assert.equal(relinked.movedToOtherBuilding,true); assert.deepEqual(relinked.items,[]);
});
test("정기 계약 일정은 해당 월만 투영하고 계약하지 않은 다른 일정은 섞지 않는다", () => {
  const recurring={...contract,billingCycle:"월 정기",startDate:"2026-09-01",cleaningSchedule:{mode:"twice_monthly",weekday:4,weekPattern:"first_third"}};
  const result=Summary.calendarSummary(recurring,{serviceRecords:[{...moved,sourceContractId:"other"}]},"2026-10");
  assert.deepEqual(result.items.map(x=>x.date),["2026-10-01","2026-10-15"]);
  assert.deepEqual(Summary.calendarSummary(recurring,{serviceRecords:[]},"invalid").items,[]);
});
test("입금일은 해당 월과 등록된 입금 상태를 그대로 사용한다", () => {
  assert.deepEqual(Summary.paymentSummary(contract,"2026-10","2026-10-16"),{status:"overdue",date:"2026-10-15"});
  assert.deepEqual(Summary.paymentSummary({...contract,collectionStatus:"입금 완료"},"2026-10","2026-10-16"),{status:"paid",date:"2026-10-15"});
  assert.equal(Summary.paymentSummary({...contract,paymentDueDate:""},"2026-10","2026-10-16").status,"missing");
  assert.equal(Summary.paymentSummary(contract,"2026-11","2026-11-01").status,"none");
});
