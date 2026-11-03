"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");

function part(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + 1);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
}

test("대표OS 조회 실패는 한 번만 표시되고 명시적인 재시도 후 복구된다", async () => {
  let calls = 0, redraws = 0;
  const context = {
    ownerOsState: { view: null, loaded: false, loading: false, error: "", loadError: "" },
    api: { loadOwnerOsSettings: async () => { calls++; if (calls === 1) throw new Error("sensitive internal detail"); return { configured: true }; } },
    currentView: "settings", renderSettings: () => { redraws++; }, renderOperationsIntelligence: () => {},
  };
  vm.createContext(context);
  vm.runInContext(part("  async function loadOwnerOsSettingsView()", "  function ownerOsCard()"), context);
  await context.loadOwnerOsSettingsView();
  assert.equal(calls, 1);
  assert.equal(redraws, 1);
  assert.equal(context.ownerOsState.loaded, true);
  assert.match(context.ownerOsState.loadError, /읽지 못했습니다/);
  assert.doesNotMatch(context.ownerOsState.loadError, /sensitive/);
  await context.loadOwnerOsSettingsView();
  assert.equal(calls, 2);
  assert.equal(context.ownerOsState.loadError, "");
  assert.equal(context.ownerOsState.view.configured, true);
});

test("대표OS 저장 여부는 통신 성공과 구분하고 조회 실패 시 수정을 막는다", () => {
  const context = {
    ownerOsState: { loaded: true, loading: false, loadError: "", view: { configured: true, endpoint: "https://example.invalid", secretHint: "1234" } },
    canAdministerSecurity: () => true, esc: String, attr: String,
  };
  vm.createContext(context);
  vm.runInContext(part("  function ownerOsCard()", "  // --- 주간업무보고서 ---"), context);
  const html = context.ownerOsCard();
  assert.match(html, /이 PC에 설정 저장됨/);
  assert.match(html, /실제 연결 상태는 별도 확인/);
  assert.doesNotMatch(html, /<b>연결됨<\/b>/);
  context.ownerOsState.loadError = "설정을 읽지 못했습니다";
  const failed = context.ownerOsCard();
  assert.match(failed, /owner-os-settings-retry/);
  assert.doesNotMatch(failed, /id="ownerOsForm"/);
});

test("상태 갱신 시 편집 중인 폼은 현재 계정에서만 유지한다", () => {
  let identity = "admin-a", restored = 0, focused = 0;
  const button = { disabled: false, textContent: "저장" };
  const input = { selectionStart: 1, selectionEnd: 2, selectionDirection: "forward", isConnected: true, focus: () => focused++, setSelectionRange: (...range) => assert.deepEqual(range, [1, 2, "forward"]) };
  const form = { id: "ownerOsForm", contains: node => node === input, querySelector: () => button };
  const oldGrid = { dataset: { settingsIdentity: "admin-a" }, querySelectorAll: () => [form] };
  const newGrid = { dataset: {} };
  const replacement = { querySelector: () => ({ disabled: true, textContent: "저장 중…" }), replaceWith: saved => { assert.equal(saved, form); restored++; } };
  const main = { querySelector: selector => selector === ".settings-grid" ? (main.updated ? newGrid : oldGrid) : selector === "#ownerOsForm" ? replacement : null, set innerHTML(value) { this.updated = true; } };
  const context = { main, currentAuth: { user: { uid: identity, role: "admin" }, required: true }, store: { settings: {}, company: {} }, dataPath: "", document: { activeElement: input }, ownerOsState: { loaded: true }, telegramState: { loaded: true, checkedAt: Date.now() }, canAdministerSecurity: () => true, telegramCard: () => "", ownerOsCard: () => "", attr: String, esc: String, loadOwnerOsSettingsView: () => {}, loadTelegramServerStatus: () => {} };
  vm.createContext(context);
  vm.runInContext(part("  function renderSettings()", "  function aiConsultationIntakeEditor("), context);
  context.renderSettings();
  assert.equal(restored, 1);
  assert.equal(focused, 1);
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, "저장 중…");
  main.updated = false;
  context.currentAuth.user.uid = "admin-b";
  context.renderSettings();
  assert.equal(restored, 1, "다른 계정에 이전 입력을 넘기지 않는다");
});
