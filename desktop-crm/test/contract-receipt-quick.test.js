"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), crypto = require("node:crypto");
const Core = require("../src/core"), Receipt = require("../src/contract-receipt-commit");
const { FirebaseRemoteClient } = require("../src/remote");
const source = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
const fixture = changes => Core.normalizeContract({ id: "contract_a", name: "공용부청소", customerId: "customer_a", buildingId: "building_a", billingCycle: "월 정기", status: "진행 중", amount: 60000, paymentDueDate: "2026-10-25", memo: "기존 메모", updatedAt: "2026-10-15T00:00:00.000Z", cleaningSchedule: { mode: "weekly", weekday: 4 }, ...changes });
const actor = { uid: "member_a", role: "member" };
const input = (record, changes) => ({ requestId: crypto.randomUUID(), contractId: record.id, dueDate: "2026-11-25", base: Core.contractPaymentQuickBase(record, "2026-11-25"), collectionStatus: "입금 완료", memo: "입금 확인", ...changes });
const clone = value => JSON.parse(JSON.stringify(value));

test("quick edits merge only date-scoped receipts, memo and commit metadata; other business values survive", () => {
  const original = fixture({ collectionStatus: "입금 완료", paymentCollections: { "2026-12-25": "입금 완료" }, custom: { retained: true } });
  const before = clone(original), request = input(original);
  const saved = Receipt.plan(request, { existing: original, actor }).record;
  assert.deepEqual(original, before);
  assert.equal(Core.contractPaymentCollectionStatus(saved, "2026-10-25"), "입금 완료");
  assert.equal(Core.contractPaymentCollectionStatus(saved, "2026-11-25"), "입금 완료");
  assert.equal(Core.contractPaymentCollectionStatus(saved, "2027-01-25"), "입금 예정");
  assert.equal(saved.paymentCollections["2026-12-25"], "입금 완료");
  for (const key of ["amount", "billingCycle", "paymentDueDate", "cleaningSchedule", "custom", "customerId", "buildingId"]) assert.deepEqual(saved[key], before[key]);
  assert.equal(saved.receiptQuickVersion, 1);
  assert.equal(saved.memo, "입금 확인");
  assert.equal(Receipt.plan(request, { existing: saved, actor }).repeated, true);
  assert.throws(() => Receipt.plan({ ...request, memo: "changed replay" }, { existing: saved, actor }), { code: "RECEIPT_CONFLICT" });
  const oneoff = fixture({ billingCycle: "건별", vendorCost: 20000, vendorPaymentStatus: "지급 예정" });
  const paid = Receipt.plan(input(oneoff, { dueDate: "2026-10-25", base: Core.contractPaymentQuickBase(oneoff, "2026-10-25") }), { existing: oneoff, actor }).record;
  assert.equal(paid.collectionStatus, "입금 완료");
  assert.equal(paid.vendorPaymentStatus, "지급 예정");
  assert.equal(paid.vendorCost, 20000);
  assert.equal(paid.grossProfit, 40000);
  assert.deepEqual(Core.sanitizeSharedStore({ contracts: [paid] }).contracts[0], paid);
});

test("closed requests, roles, date changes, stale bases and deleted contracts fail closed", () => {
  const record = fixture(), request = input(record);
  for (const change of [{ contractId: "../x" }, { dueDate: "2026-02-30" }, { collectionStatus: "paid" }, { memo: "x".repeat(2001) }, { amount: 0 }, { base: { ...request.base, extra: true } }]) assert.throws(() => Receipt.validate({ ...request, ...change }));
  for (const user of [null, { uid: "viewer", role: "viewer" }, { uid: "market", role: "member", marketingRole: "marketing" }, { ...actor, mustChangePassword: true }]) assert.throws(() => Receipt.plan(request, { existing: record, actor: user }));
  for (const changes of [{ archivedAt: "2026-10-15" }, { deleted: true }, { status: "취소" }, { paymentDueDate: "2026-10-26" }]) assert.throws(() => Receipt.plan(request, { existing: { ...record, ...changes }, actor }), { code: "RECEIPT_NOT_FOUND" });
  for (const changes of [{ amount: 80000 }, { memo: "another user" }, { updatedAt: "2026-10-15T01:00:00Z" }, { receiptQuickVersion: 1 }]) assert.throws(() => Receipt.plan(request, { existing: { ...record, ...changes }, actor }), { code: "RECEIPT_CONFLICT" });
  const error = Receipt.envelope(Object.assign(new Error("sensitive server response"), { code: "DATABASE_ERROR" }));
  assert.equal(error.code, "RECEIPT_FAILED"); assert.doesNotMatch(error.error, /sensitive/);
});

function clientHarness(options = {}) {
  let record = fixture(), writes = 0, reads = 0;
  const client = new FirebaseRemoteClient({ Core, fetchImpl: async () => { throw Error("No external network"); }, fs: {}, safeStorage: {}, shell: {}, readLocalStore: async () => Core.blankSharedStore(), writeLocalStore: async value => value });
  client.session = { ...actor };
  client.remotePayload = { contracts: { contract_a: clone(record) } };
  client.verifyAccess = async () => { if (options.downgrade) client.session.role = "viewer"; return {}; };
  client.dbReadWithEtag = async location => { assert.equal(location, "crmShared/data/contracts/contract_a"); reads++; if (options.sessionChange) client.session = { uid: "other", role: "admin" }; return { value: clone(record), etag: '"revision-1"' }; };
  client.dbConditionalPut = async (location, value, etag) => {
    assert.equal(location, "crmShared/data/contracts/contract_a"); assert.equal(etag, '"revision-1"'); writes++;
    if (options.conflict) throw Object.assign(Error(), { code: "BUILDING_SCHEDULE_CONFLICT" });
    if (!options.unconfirmedNoWrite) record = clone(value);
    if (options.unconfirmed || options.unconfirmedNoWrite) throw Object.assign(Error(), { code: "BUILDING_SCHEDULE_WRITE_UNCONFIRMED" });
  };
  return { client, request: input(record), record: () => record, writes: () => writes, reads: () => reads };
}
test("real remote receipt path uses record ETag CAS and replays one confirmed intent without double writes", async () => {
  const h = clientHarness();
  assert.equal((await h.client.commitContractReceipt(h.request)).repeated, false);
  assert.equal(h.writes(), 1);
  assert.equal((await h.client.commitContractReceipt(h.request)).repeated, true);
  assert.equal(h.writes(), 1);
  assert.equal(h.client.remotePayload.contracts.contract_a.memo, "입금 확인");
});
test("remote conflicts, unconfirmed writes, revoked roles and changed sessions never pretend success", async () => {
  for (const options of [{ conflict: true }, { unconfirmedNoWrite: true }, { sessionChange: true }, { downgrade: true }]) {
    const h = clientHarness(options);
    await assert.rejects(h.client.commitContractReceipt(h.request));
    assert.equal(h.record().memo, "기존 메모");
    if (options.sessionChange || options.downgrade) assert.equal(h.writes(), 0);
  }
  const confirmed = clientHarness({ unconfirmed: true });
  assert.equal((await confirmed.client.commitContractReceipt(confirmed.request)).record.memo, "입금 확인");
  assert.equal(confirmed.writes(), 1); assert.equal(confirmed.reads(), 2);
});

function ui() {
  const esc = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const ctx = vm.createContext({ Core, crypto, structuredClone, store: { contracts: [fixture(), fixture({ id: "contract_b", name: "폐기물 처리" })], buildings: [] }, synchronizedStore: { contracts: [] }, queuedSave: null, pendingRemoteStore: null, saveInFlight: false,
    contractCalendarMonth: "2026-11", contractCalendarBuildingId: "all", contractCalendarQuery: "", contractReceiptSelection: "", contractReceiptDrafts: new Map(),
    authGeneration: 1, currentAuthUid: () => "member_a", currentView: "buildingCalendar", unifiedCalendarTab: "contract", canWriteCRM: () => true,
    esc, attr: esc, krw: value => `${value}원`, customerById: () => ({ name: "Fixture customer" }), buildingById: () => ({ name: "Fixture building" }), todayKey: () => "2026-11-01", paymentMonthLabel: v => v, paymentCalendarDays: () => ["2026-11-25"], empty: () => "", renderContractWorkManagementPanel: () => "", main: { querySelector: () => null }, showToast() {}, window: { confirm: () => false }, api: {}, renderBuildingCalendar() {},
  });
  vm.runInContext(source.slice(source.indexOf("  function contractCalendarBuildings("), source.indexOf("  function renderPayments(")), ctx);
  ctx.form = () => { const state = ctx.contractReceiptDrafts.get(ctx.contractReceiptSelection); return { dataset: { receiptKey: ctx.contractReceiptSelection }, elements: { memo: { value: state.memo }, collectionStatus: { value: state.collectionStatus } } }; };
  return ctx;
}
test("actual renderer opens one reusable right panel, preserves drafts across switches and escapes memo", () => {
  const ctx = ui();
  assert.doesNotMatch(ctx.renderOneOffContractCalendar(), /<aside/);
  ctx.openContractReceiptQuickPanel("contract_a", "2026-11-25");
  const form = ctx.form(); form.elements.memo.value = '<img src=x onerror="bad">'; form.elements.collectionStatus.value = "입금 완료";
  ctx.captureContractReceiptDraft(form);
  ctx.openContractReceiptQuickPanel("contract_b", "2026-11-25");
  assert.equal((ctx.renderOneOffContractCalendar().match(/<aside/g) || []).length, 1);
  ctx.openContractReceiptQuickPanel("contract_a", "2026-11-25");
  const html = ctx.renderOneOffContractCalendar();
  assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img/);
  assert.match(html, /60000원 · 입금 예정/, "calendar stays unpaid before save");
  assert.match(html, /<option value="입금 완료" selected/);
  ctx.canWriteCRM = () => false;
  assert.doesNotMatch(ctx.renderOneOffContractCalendar(), /<aside|data-contract-receipt-open/);
});
test("actual quick save locks duplicate clicks, leaves calendar unchanged on failure and only adopts acknowledged records", async () => {
  const ctx = ui(); ctx.openContractReceiptQuickPanel("contract_a", "2026-11-25");
  const form = ctx.form(); form.elements.collectionStatus.value = "입금 완료";
  let resolve, calls = 0;
  ctx.api.commitContractReceipt = request => { calls++; return new Promise(done => { resolve = () => done({ ok: true, record: Receipt.plan(clone(request), { existing: ctx.store.contracts[0], actor }).record }); }); };
  const saving = ctx.saveContractReceiptQuickPanel(form);
  assert.equal(Core.contractPaymentCollectionStatus(ctx.store.contracts[0], "2026-11-25"), "입금 예정");
  await ctx.saveContractReceiptQuickPanel(form); assert.equal(calls, 1);
  resolve(); await saving;
  assert.equal(Core.contractPaymentCollectionStatus(ctx.store.contracts[0], "2026-11-25"), "입금 완료");
  const state = ctx.contractReceiptDrafts.get(ctx.contractReceiptSelection);
  ctx.api.commitContractReceipt = async () => ({ ok: false, error: "다른 곳에서 변경됨" });
  const retry = ctx.form(); retry.elements.collectionStatus.value = "입금 예정";
  await ctx.saveContractReceiptQuickPanel(retry);
  assert.equal(Core.contractPaymentCollectionStatus(ctx.store.contracts[0], "2026-11-25"), "입금 완료");
  assert.equal(state.collectionStatus, "입금 예정"); assert.equal(state.error, "다른 곳에서 변경됨"); assert.ok(state.request);
});
test("same-session draft clearing prevents a late write acknowledgement from reviving another role's state", async () => {
  const ctx = ui(); ctx.openContractReceiptQuickPanel("contract_a", "2026-11-25");
  let resolve; ctx.api.commitContractReceipt = () => new Promise(done => { resolve = done; });
  const saving = ctx.saveContractReceiptQuickPanel(ctx.form());
  ctx.contractReceiptDrafts.clear(); ctx.contractReceiptSelection = "";
  resolve({ ok: true, record: fixture({ memo: "late" }) }); await saving;
  assert.equal(ctx.store.contracts[0].memo, "기존 메모");
});
