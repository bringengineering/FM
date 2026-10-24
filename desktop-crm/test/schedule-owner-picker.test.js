"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
const pickerSource = source.slice(source.indexOf("  function scheduleOwnerField("), source.indexOf("  function buildingScheduleEditor("));

function harness() {
  let resolve;
  const input = { value: "기존 담당자", disabled: false, style: {}, focus() {} };
  const hint = {};
  const options = [];
  const select = { value: "existing", querySelector: () => ({}), addEventListener() {}, insertBefore: option => options.push(option) };
  const picker = { querySelector: tag => ({ select, input, small: hint })[tag] };
  const form = { isConnected: true, querySelector: () => picker };
  const context = vm.createContext({
    authGeneration: 1, uid: "member-a", writable: true, modalOpen: true,
    currentAuthUid: () => context.uid, canWriteCRM: () => context.writable,
    modal: { classList: { contains: () => context.modalOpen } },
    document: { createElement: () => ({ dataset: {} }) },
    api: { loadWorkOrders: () => new Promise(done => { resolve = done; }) },
  });
  vm.runInContext(pickerSource, context);
  context.bindScheduleOwnerPicker(form);
  return { context, form, input, hint, options, resolve: data => resolve(data) };
}

test("일정 담당자 목록은 닫힌 창·다른 계정·조회 권한 변경 후 반영하지 않는다", async () => {
  const changes = [
    h => { h.form.isConnected = false; },
    h => { h.context.authGeneration++; },
    h => { h.context.uid = "member-b"; },
    h => { h.context.writable = false; },
    h => { h.context.modalOpen = false; },
    h => { h.input.disabled = true; },
  ];
  for (const change of changes) {
    const h = harness();
    change(h);
    h.resolve({ members: [{ uid: "staff", displayName: "직원" }] });
    await new Promise(done => setImmediate(done));
    assert.equal(h.options.length, 0);
    assert.equal(h.input.value, "기존 담당자");
    assert.equal(h.hint.textContent, undefined);
  }
});

test("유효한 직원만 표시하며 테스트용 목록과 잘못된 응답은 직접 입력으로 안내한다", async () => {
  for (const data of [{}, { localOnly: true, members: [{ uid: "demo", displayName: "데모" }] }]) {
    const h = harness(); h.resolve(data);
    await new Promise(done => setImmediate(done));
    assert.equal(h.options.length, 0);
    assert.match(h.hint.textContent, /직접 입력/);
  }
  const h = harness(); h.resolve({ members: [null, { uid: "a", displayName: "직원" }, { uid: "b", displayName: "직원" }, { uid: "c", displayName: "잠김", mustChangePassword: true }, { uid: "d", displayName: "긴".repeat(121) }] });
  await new Promise(done => setImmediate(done));
  assert.equal(h.options.length, 1);
  assert.equal(h.options[0].textContent, "직원");
  assert.equal(h.input.value, "기존 담당자");
});
