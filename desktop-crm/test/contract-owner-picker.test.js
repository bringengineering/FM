"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
const pickerSource = source.slice(source.indexOf("  function contractOwnerField("), source.indexOf("  function contractTypeChecklist("));
const esc = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
function harness(owner = "기존 담당자") {
  let resolve, reject, calls = 0;
  const select = { value: owner, disabled: false, options: [{ value: "", textContent: "담당자를 선택하세요" }, ...(owner ? [{ value: owner, textContent: owner + " (기존 담당자)" }] : [])], appendChild(option) { this.options.push(option); } };
  const hint = {}, picker = { querySelector: tag => ({ select, small: hint })[tag] };
  const form = { isConnected: true, querySelector: () => picker };
  const context = vm.createContext({ esc, attr: esc, authGeneration: 1, uid: "member_a", writable: true, modalOpen: true,
    currentAuthUid: () => context.uid, canWriteCRM: () => context.writable,
    modal: { classList: { contains: () => context.modalOpen } }, document: { createElement: () => ({}) },
    api: { loadWorkOrders: () => { calls++; return new Promise((done, fail) => { resolve = done; reject = fail; }); } },
  });
  vm.runInContext(pickerSource, context);
  return { context, form, select, hint, load: () => context.bindContractOwnerPicker(form), resolve: data => resolve(data), reject: error => reject(error), calls: () => calls };
}

test("contract assignee is a named select, not free text, and preserves encoded legacy values", () => {
  const h = harness();
  const html = h.context.contractOwnerField('<img src=x onerror="bad">');
  assert.match(html, /<select id="contractOwnerSelect" name="owner"/);
  assert.doesNotMatch(html, /<input|직접 입력|value="manual"|<img/);
  assert.match(html, /&lt;img src=x onerror=&quot;bad&quot;&gt; \(기존 담당자\)/);
  assert.match(h.context.contractOwnerField(""), /<option value="" selected>/);
  const editor = source.match(/  function contractEditor\([\s\S]*?^  \}/m)[0];
  assert.match(editor, /contractOwnerField\(item.owner/);
  assert.match(editor, /bindContractOwnerPicker\(document.getElementById\("contractForm"\)\)/);
  assert.doesNotMatch(editor, /field\("담당자", "owner"/);
});

test("authorized staff are sorted and deduplicated; inactive, nameless and password-reset accounts are excluded", async () => {
  const h = harness("가 직원"), loading = h.load();
  const hostile = '<img src=x onerror="bad">';
  h.resolve({ members: [null, { uid: "b", displayName: " 나 직원 " }, { uid: "a", displayName: "가 직원" }, { uid: "duplicate", displayName: "가 직원" }, { uid: "disabled", displayName: "비활성", enabled: false }, { uid: "locked", displayName: "비밀번호 변경", mustChangePassword: true }, { displayName: "UID 없음" }, { uid: "long", displayName: "가".repeat(121) }, { uid: "empty", displayName: " " }, { uid: "unsafe", displayName: hostile }] });
  await loading;
  assert.equal(h.calls(), 1);
  assert.deepEqual(h.select.options.map(option => option.value), ["", "가 직원", hostile, "나 직원"]);
  assert.equal(h.select.options[1].textContent, "가 직원");
  assert.equal(h.select.value, "가 직원");
  assert.equal(h.select.options[2].textContent, hostile, "untrusted names are assigned as text, never HTML");
  assert.match(h.hint.textContent, /등록된 직원/);
});

test("loading never chooses the first employee, clears a legacy owner, or resets a choice made in flight", async () => {
  for (const owner of ["", "퇴사 전 담당자"]) {
    const h = harness(owner), loading = h.load();
    h.resolve({ members: [{ uid: "staff", displayName: "현재 직원" }] }); await loading;
    assert.equal(h.select.value, owner);
    assert.ok(h.select.options.some(option => option.value === owner));
  }
  const h = harness(), loading = h.load();
  h.select.value = "";
  h.resolve({ members: [{ uid: "staff", displayName: "기존 담당자" }] }); await loading;
  assert.equal(h.select.value, "");
});

test("empty, malformed, local-only and failed responses keep the existing owner with a generic message", async () => {
  for (const data of [{}, { members: [] }, { members: {} }, { members: [{ uid: "fixture", displayName: "가상 직원" }], localOnly: true }]) {
    const h = harness(), loading = h.load();h.resolve(data);await loading;
    assert.equal(h.select.value, "기존 담당자");assert.equal(h.select.options.length, 2);
    assert.match(h.hint.textContent, /기존 담당자는 유지/);
  }
  const h = harness(), loading = h.load();h.reject(Error("secret provider response"));await loading;
  assert.equal(h.select.value, "기존 담당자");
  assert.doesNotMatch(h.hint.textContent, /secret|provider/);
});

test("late employee responses cannot update closed forms, changed accounts, revoked permissions or submitting forms", async () => {
  for (const change of [h => { h.form.isConnected = false; }, h => { h.context.authGeneration++; }, h => { h.context.uid = "other"; }, h => { h.context.writable = false; }, h => { h.context.modalOpen = false; }, h => { h.select.disabled = true; }]) {
    const h = harness(), loading = h.load();change(h);
    h.resolve({ members: [{ uid: "staff", displayName: "새 담당자" }] });await loading;
    assert.equal(h.select.options.length, 2);assert.equal(h.select.value, "기존 담당자");assert.equal(h.hint.textContent, undefined);
  }
  const viewer = harness();viewer.context.writable = false;await viewer.load();assert.equal(viewer.calls(), 0);
});
