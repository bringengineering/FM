"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
function harness() {
  const input = { value: "변경한 설명", addEventListener() {}, focus() {} };
  const count = {}, error = {}, events = {};
  const form = { querySelector: selector => selector === "textarea" ? input : selector.includes("count") ? count : error, addEventListener: (name, handler) => { events[name] = handler; } };
  const calls = { opened: 0, closed: 0, rendered: 0 };
  const context = vm.createContext({ Map, String, Object, authGeneration: 1, currentView: "buildingMonthlyReports", customerDocumentSaving: false,
    currentAuthUid: () => "synthetic", canWriteCRM: () => true,
    modalContent: { innerHTML: "", querySelector: () => form },
    esc: text => String(text).replace(/[&<>"']/gu, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]),
    openModal: () => { calls.opened++; }, closeModal: () => { calls.closed++; },
    renderBuildingMonthlyReports: () => { calls.rendered++; }, showToast: () => {},
    buildingMonthlyReportRequestKey: () => `${context.buildingMonthlyReportState.buildingId}:${context.buildingMonthlyReportState.month}`,
  });
  vm.runInContext(source.slice(source.indexOf("  function createBuildingMonthlyReportState("), source.indexOf("  let buildingMonthlyReportState =")), context);
  vm.runInContext(source.slice(source.indexOf("  function applyBuildingMonthlyPhotoCaptions("), source.indexOf("  function monthlyDrivePathFor(")), context);
  context.buildingMonthlyReportState = context.createBuildingMonthlyReportState({ buildingId: "b1", month: "2026-09", photos: [{ id: "photo-1", date: "2026-09-14", activityName: "폐기물처리", caption: "기존 설명" }], narrative: { summary: "수정 전 요약 유지" } });
  return { context, input, error, calls, submit: () => events.submit({ preventDefault() {} }) };
}

test("설명 저장은 선택한 사진만 바꾸고 수동 요약·날짜·활동명은 유지한다", () => {
  const h = harness();h.context.openBuildingMonthlyPhotoCaption("photo-1");h.submit();
  const state = h.context.buildingMonthlyReportState;
  assert.equal(state.photos[0].caption, "변경한 설명");
  assert.equal(state.photos[0].date, "2026-09-14");
  assert.equal(state.photos[0].activityName, "폐기물처리");
  assert.equal(state.narrative.summary, "수정 전 요약 유지");
  assert.equal(h.calls.rendered, 1);
  const rescan = h.context.applyBuildingMonthlyPhotoCaptions([{ id: "photo-1", caption: "새 AI 설명" }, { id: "photo-2", caption: "다른 사진" }]);
  assert.equal(rescan[0].caption, "변경한 설명");assert.equal(rescan[1].caption, "다른 사진");
  const otherMonth = h.context.createBuildingMonthlyReportState({ month: "2026-08" });
  assert.equal(h.context.applyBuildingMonthlyPhotoCaptions(rescan, otherMonth)[0], rescan[0]);
  assert.equal(otherMonth.photoCaptionEdits.size, 0);
});

test("빈 설명과 초과 길이를 거부하고 취소·닫기 전에 입력만으로 상태를 바꾸지 않는다", () => {
  const h = harness();h.context.openBuildingMonthlyPhotoCaption("photo-1");
  assert.equal(h.context.buildingMonthlyReportState.photos[0].caption, "기존 설명");
  for (const invalid of ["  \n", "가".repeat(141)]) {
    h.input.value = invalid;h.submit();
    assert.equal(h.error.hidden, false);assert.equal(h.calls.closed, 0);
    assert.equal(h.context.buildingMonthlyReportState.photos[0].caption, "기존 설명");
  }
});

test("모달을 연 뒤 계정·권한·보고서·사진 또는 작업 중 상태가 바뀌면 저장하지 않는다", () => {
  const changes = [
    h => { h.context.authGeneration++; }, h => { h.context.currentAuthUid = () => "other"; },
    h => { h.context.canWriteCRM = () => false; }, h => { h.context.currentView = "dashboard"; },
    h => { h.context.buildingMonthlyReportState.month = "2026-08"; },
    h => { h.context.buildingMonthlyReportState = h.context.createBuildingMonthlyReportState(); },
    h => { h.context.buildingMonthlyReportState.photos = []; },
    h => { h.context.buildingMonthlyReportState.autoBusy = true; },
  ];
  for (const change of changes) {
    const h = harness();const old = h.context.buildingMonthlyReportState;
    h.context.openBuildingMonthlyPhotoCaption("photo-1");change(h);h.submit();
    assert.equal(old.photoCaptionEdits.size, 0);assert.equal(h.calls.rendered, 0);
  }
});

test("모달 텍스트는 이스케이프하고 조회 전용·사진 재검토 중에는 열지 않는다", () => {
  const h = harness();h.context.buildingMonthlyReportState.photos[0].caption = '</textarea><script>alert(1)</script>';
  h.context.openBuildingMonthlyPhotoCaption("photo-1");
  assert.doesNotMatch(h.context.modalContent.innerHTML, /<script>/u);
  assert.match(h.context.modalContent.innerHTML, /&lt;script&gt;/u);
  h.context.canWriteCRM = () => false;h.context.openBuildingMonthlyPhotoCaption("photo-1");
  assert.equal(h.calls.opened, 1);
  h.context.canWriteCRM = () => true;h.context.buildingMonthlyReportState.photoSelectBusy = true;
  h.context.openBuildingMonthlyPhotoCaption("photo-1");assert.equal(h.calls.opened, 1);
});
