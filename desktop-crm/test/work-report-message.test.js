"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const Message = require("../src/work-report-message");

test("short report addresses retain locality and the correct road/lot number, without unit/reference details", () => {
  for (const [input, expected] of [
    ["강원특별자치도 예시시 예시로 123, 201호 (예시동, 예시빌라)", "예시시 예시로 123"],
    ["서울특별시 예시구 예시대로77길 12-3 101동 1201호", "서울 예시구 예시대로77길 12-3"],
    ["서울 예시구 예시로 12", "서울 예시구 예시로 12"],
    ["경기도 예시시 예시구 예시읍 예시길 1 (예시리)", "예시시 예시구 예시읍 예시길 1"],
    ["세종특별자치시 예시로 12", "세종시 예시로 12"],
    ["제주특별자치도 제주시 예시읍 예시리 산 12-3, 2층", "제주시 예시읍 예시리 산 12-3"],
    ["예시시 예시동 123-4 201호", "예시시 예시동 123-4"],
    ["  예시시\n예시로   12  ", "예시시 예시로 12"],
  ]) assert.equal(Message.shortAddress(input), expected);
  assert.throws(() => Message.shortAddress(""), /현장 주소/);
  assert.throws(() => Message.shortAddress("가".repeat(81)), /도로명/);
});

test("report message uses the work title or service kind, never the recipient/customer nickname", () => {
  const report = {siteAddress:"강원특별자치도 예시시 예시로 123, 201호", title:"공용부 청소 결과보고서", ownerName:"내부 별칭", kind:"moveIn"};
  const before = JSON.stringify(report), info = Message.details(report);
  assert.deepEqual(info, {buildingAddress:"예시시 예시로 123", workName:"공용부 청소"});
  assert.equal(Message.documentName(info), "예시시 예시로 123 공용부 청소 결과보고서");
  assert.equal(JSON.stringify(report), before);
  assert.equal(Message.details({...report, title:""}).workName, "입주청소");
  assert.equal(Message.details({...report, title:"설비작업 결과 보고서"}).workName, "설비작업");
  assert.equal(Message.details({...report, siteAddress:""}, {roadAddress:"예시시 예시로 1"}).buildingAddress, "예시시 예시로 1");
  assert.equal(Message.details({...report, title:"가".repeat(200)}).workName.length, 200);
  assert.throws(() => Message.details({...report, title:"가".repeat(201)}), /200자/);
  assert.doesNotMatch(JSON.stringify(info), /내부 별칭/);
});
