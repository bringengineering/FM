const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createCrmCommandBridge } = require("../src/crm-command-bridge");
const { createMcpServer } = require("../src/crm-mcp-server");
const Core = require("../src/tenant-payment-draft-core");

const future = Date.parse("2026-11-13T00:00:00.000Z");
const source = () => ({
  buildings: {
    b_sun: { name: "햇빛빌라", address: "원주시 단계동 1-2" },
    b_other: { name: "달빛빌라", address: "원주시 무실동" },
    b_old: { name: "햇빛빌라 구관", archivedAt: "2025-01-01" },
  },
  buildingUnits: {
    u1: { crmBuildingId: "b_sun", label: "201호", floorLabel: "2층", status: "occupied" },
    u2: { crmBuildingId: "b_sun", label: "202호", floorLabel: "2층", status: "occupied" },
  },
  schedules: {
    s1: { buildingId: "b_sun", unit: "201호", tenantName: "박세입", tenantPhone: "010-1111-2222", amount: 300000, dueDay: 5, startMonth: "2026-01", active: true },
  },
});
const draft = (patch = {}) => ({ buildingId: "b_sun", unit: "202호", tenantName: "김세은", tenantPhone: "01071669108", amount: 330000, dueDay: 11, startMonth: "2026-11", endMonth: "2027-10", ...patch });

test("context finds buildings by name and never returns tenant phone numbers", () => {
  const result = Core.buildTenantContext(source(), "햇빛 빌라");
  assert.equal(result.ok, true);
  assert.deepEqual(result.buildings.map(item => item.id), ["b_sun"]);
  assert.deepEqual(result.buildings[0].units.map(item => item.label), ["201호", "202호"]);
  assert.equal(result.buildings[0].tenants[0].tenantName, "박세입");
  assert.equal(result.buildings[0].tenants[0].hasPhone, true);
  assert.equal(JSON.stringify(result).includes("1111"), false);
});

test("draft becomes the same schedule the CRM form saves, with formatted phone and month count", () => {
  const result = Core.normalizeTenantDraft(draft(), source());
  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.months, 12);
  assert.deepEqual(result.schedule, {
    buildingId: "b_sun", buildingName: "햇빛빌라", buildingAddress: "원주시 단계동 1-2", unit: "202호",
    tenantName: "김세은", tenantPhone: "010-7166-9108", payerName: "김세은",
    amount: 330000, dueDay: 11, startMonth: "2026-11", endMonth: "2027-10", active: true,
  });
});

test("draft rejects bad values instead of guessing", () => {
  const cases = [
    [{ buildingId: "nope" }, /건물/],
    [{ unit: "" }, /호실/],
    [{ tenantName: " " }, /세입자 이름/],
    [{ tenantPhone: "12345" }, /연락처/],
    [{ amount: 0 }, /금액/],
    [{ amount: 330000.5 }, /금액/],
    [{ dueDay: 32 }, /납부일/],
    [{ startMonth: "2026-13" }, /시작 월/],
    [{ endMonth: "2026-10" }, /앞섭니다/],
    [{ memo: "x" }, /지원하지 않는/],
  ];
  for (const [patch, pattern] of cases) {
    const result = Core.normalizeTenantDraft(draft(patch), source());
    assert.equal(result.ok, false, JSON.stringify(patch));
    assert.match(result.error, pattern);
  }
});

test("draft warns about an unknown unit and an existing tenant in the same unit", () => {
  const unknown = Core.normalizeTenantDraft(draft({ unit: "303호" }), source());
  assert.equal(unknown.ok, true);
  assert.match(unknown.warnings.join(" "), /303호.*등록되어 있지 않습니다/);
  const sameUnit = Core.normalizeTenantDraft(draft({ unit: "201" }), source());
  assert.match(sameUnit.warnings.join(" "), /박세입/);
});

async function setup(overrides = {}) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "bring-crm-tenant-"));
  const saved = [];
  const bridge = createCrmCommandBridge({
    userDataPath,
    getAuthState: () => ({ user: { uid: "chairman-1", email: "owner@example.com", role: "admin" } }),
    loadTenantSource: async () => source(),
    savePaymentSchedule: async value => { saved.push(value); return { ok: true, schedule: value }; },
    now: () => future,
    ...overrides,
  });
  await bridge.start();
  return { bridge, userDataPath, saved };
}

async function post(bridge, pathname, body) {
  const response = await fetch(`http://127.0.0.1:${bridge.port}${pathname}`, {
    method: "POST",
    headers: { authorization: `Bearer ${bridge.token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test("bridge previews without saving and saves once only after the approval phrase", async t => {
  const context = await setup();
  t.after(async () => { await context.bridge.close(); await fs.rm(context.userDataPath, { recursive: true, force: true }); });

  const found = await post(context.bridge, "/v1/tenant-context", { buildingQuery: "햇빛빌라" });
  assert.equal(found.status, 200);
  assert.equal(found.body.buildings[0].id, "b_sun");

  const preview = await post(context.bridge, "/v1/tenant-preview", draft());
  assert.equal(preview.status, 200);
  assert.equal(preview.body.writesPerformed, false);
  assert.match(preview.body.schedule.scheduleId, /^crm_ai_[a-f0-9]{16}$/);
  assert.equal(context.saved.length, 0);

  const denied = await post(context.bridge, "/v1/tenant-publish", { previewId: preview.body.previewId, approvalPhrase: "네" });
  assert.equal(denied.status, 403);
  assert.equal(context.saved.length, 0);

  const published = await post(context.bridge, "/v1/tenant-publish", { previewId: preview.body.previewId, approvalPhrase: "CRM 발행 승인" });
  assert.equal(published.status, 200);
  assert.equal(published.body.complete, true);
  assert.equal(context.saved.length, 1);
  assert.equal(context.saved[0].scheduleId, preview.body.schedule.scheduleId);
  assert.equal(context.saved[0].tenantPhone, "010-7166-9108");

  const repeated = await post(context.bridge, "/v1/tenant-publish", { previewId: preview.body.previewId, approvalPhrase: "CRM 발행 승인" });
  assert.equal(repeated.body.repeated, true);
  assert.equal(context.saved.length, 1);
});

test("bridge refuses tenant tools for non-admin sessions and reports invalid drafts", async t => {
  const member = await setup({ getAuthState: () => ({ user: { uid: "m1", role: "member" } }) });
  t.after(async () => { await member.bridge.close(); await fs.rm(member.userDataPath, { recursive: true, force: true }); });
  const refused = await post(member.bridge, "/v1/tenant-preview", draft());
  assert.equal(refused.status, 403);

  const admin = await setup();
  t.after(async () => { await admin.bridge.close(); await fs.rm(admin.userDataPath, { recursive: true, force: true }); });
  const invalid = await post(admin.bridge, "/v1/tenant-preview", draft({ amount: "삼십만" }));
  assert.equal(invalid.status, 422);
  assert.equal(invalid.body.valid, false);
});

test("failed save keeps the preview so a retry reuses the same schedule id", async t => {
  let attempts = 0;
  const saved = [];
  const context = await setup({ savePaymentSchedule: async value => { attempts += 1; if (attempts === 1) return { ok: false, error: "네트워크 오류" }; saved.push(value); return { ok: true }; } });
  t.after(async () => { await context.bridge.close(); await fs.rm(context.userDataPath, { recursive: true, force: true }); });
  const preview = await post(context.bridge, "/v1/tenant-preview", draft());
  const first = await post(context.bridge, "/v1/tenant-publish", { previewId: preview.body.previewId, approvalPhrase: "CRM 발행 승인" });
  assert.equal(first.status, 207);
  assert.equal(first.body.complete, false);
  const second = await post(context.bridge, "/v1/tenant-publish", { previewId: preview.body.previewId, approvalPhrase: "CRM 발행 승인" });
  assert.equal(second.body.complete, true);
  assert.equal(saved[0].scheduleId, preview.body.schedule.scheduleId);
});

test("MCP server routes the three tenant tools to the bridge", async () => {
  const calls = [];
  const server = createMcpServer({ requestBridge: async (method, pathname, body) => { calls.push([method, pathname, body]); return { ok: true }; } });
  const list = await server.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const names = list.result.tools.map(tool => tool.name);
  for (const name of ["crm_tenant_context", "crm_preview_tenant", "crm_publish_tenant"]) assert.ok(names.includes(name), name);
  await server.handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "crm_tenant_context", arguments: { buildingQuery: "햇빛" } } });
  await server.handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "crm_preview_tenant", arguments: draft() } });
  await server.handle({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "crm_publish_tenant", arguments: { previewId: "p", approvalPhrase: "CRM 발행 승인" } } });
  assert.deepEqual(calls.map(call => call[1]), ["/v1/tenant-context", "/v1/tenant-preview", "/v1/tenant-publish"]);
});

test("building unit list shows the tenant and opens the payment schedule editor preset to that unit", async () => {
  const source = await fs.readFile(path.join(__dirname, "../src/app.js"), "utf8");
  assert.match(source, /function paymentScheduleEditor\(scheduleId, preset = \{\}\)/);
  assert.match(source, /data-unit-tenant-add="\$\{attr\(building\.id\)\}" data-unit-label=/);
  assert.match(source, /paymentScheduleEditor\(unitTenantEdit\.dataset\.unitTenantEdit, \{ returnView: "buildings" \}\)/);
  assert.match(source, /unit: unitTenantAdd\.dataset\.unitLabel \|\| "", returnView: "buildings"/);
  // 세입자 칩은 '현재 작업자' 확인이 걸린 호실 창을 거치지 않는다 — 납부 일정은 건물 정본 변경이 아니다.
  const editorStart = source.indexOf("function paymentScheduleEditor(");
  assert.equal(source.slice(editorStart, editorStart + 600).includes("deferCanonicalMutation"), false);
  assert.equal(Core.unitKey("202 호"), Core.unitKey("202"));
});
