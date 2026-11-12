"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
function between(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, start);
  return source.slice(a, b);
}
const esc = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function setup({ modalOpen = true, profiles = [{ id: "op_kim", name: "김현진", active: true }] } = {}) {
  const inserted = [];
  let select = null;
  const form = {
    insertAdjacentHTML: (where, html) => { inserted.push({ where, html }); select = { value: "", focused: false, focus() { this.focused = true; } }; },
    querySelector: selector => selector === "[data-inline-field-operator]" ? select : null,
  };
  const toasts = [], storage = {};
  const ctx = vm.createContext({
    canWriteCRM: () => true, fieldProfilesAvailable: true, fieldProfilesError: "", fieldTeamProfiles: profiles, selectedFieldOperatorId: "",
    modal: { classList: { contains: name => name === "open" && modalOpen } },
    modalContent: { querySelector: selector => selector === "form" ? form : null },
    fieldOperatorSelect: { focused: false, focus() { this.focused = true; } }, fieldOperatorControl: { hidden: true },
    renderFieldOperatorControl: () => {}, fieldOperatorStorageKey: () => "bring-crm:field-operator:uid",
    localStorage: { setItem: (k, v) => { storage[k] = v; }, removeItem: k => { delete storage[k]; } },
    showToast: (message, tone) => toasts.push({ message, tone }), esc, attr: esc,
  });
  vm.runInContext(between("  function activeFieldOperator()", "  function readStoredFieldOperatorId()"), ctx);
  vm.runInContext(between("  function fieldOperatorOptionsMarkup()", "  async function loadFieldTeamProfiles()"), ctx);
  vm.runInContext(between("  function deferCanonicalMutation(", "  function buildCanonicalBuildingPatch("), ctx);
  return { ctx, inserted, toasts, storage, getSelect: () => select };
}

test("계약 창처럼 모달이 열려 있으면 창 안에 현재 작업자 선택 칸을 넣고 저장을 멈춘다", () => {
  const { ctx, inserted, toasts, getSelect } = setup();
  assert.equal(ctx.deferCanonicalMutation("건물"), true);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].where, "afterbegin");
  assert.match(inserted[0].html, /data-inline-field-operator/);
  assert.match(inserted[0].html, /<option value="op_kim" >김현진<\/option>/);
  assert.doesNotMatch(inserted[0].html, /name=/, "작업자 선택 값이 계약 저장 값에 섞이지 않는다");
  assert.equal(getSelect().focused, true);
  assert.match(toasts.at(-1).message, /이 창 맨 위 '현재 작업자'/);
  ctx.deferCanonicalMutation("건물");
  assert.equal(inserted.length, 1, "다시 저장해도 선택 칸을 한 번만 넣는다");
});

test("창 안에서 작업자를 고르면 기억하고 다음 저장은 통과한다", () => {
  const { ctx, storage } = setup();
  assert.equal(ctx.applyFieldOperatorSelection("op_kim"), true);
  assert.match(storage["bring-crm:field-operator:uid"], /"operatorId":"op_kim"/);
  assert.equal(ctx.deferCanonicalMutation("건물"), false);
  assert.equal(ctx.applyFieldOperatorSelection("op_unknown"), false, "명단에 없는 작업자는 고를 수 없다");
  assert.equal(ctx.selectedFieldOperatorId, "op_kim");
});

test("모달이 없거나 작업자 명단이 없으면 예전처럼 위쪽 선택 칸을 안내한다", () => {
  const closed = setup({ modalOpen: false });
  assert.equal(closed.ctx.deferCanonicalMutation("건물"), true);
  assert.equal(closed.inserted.length, 0);
  assert.equal(closed.ctx.fieldOperatorSelect.focused, true);
  const empty = setup({ profiles: [] });
  assert.equal(empty.ctx.deferCanonicalMutation("건물"), true);
  assert.equal(empty.inserted.length, 0);
});
