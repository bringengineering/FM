const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createCrmCommandBridge } = require("../src/crm-command-bridge");

const future = Date.parse("2026-10-01T00:00:00.000Z");
const order = (patch = {}) => ({
  title: "사업계획서 자료 인수인계",
  assigneeUid: "kim-hyunjin",
  assigneeName: "김현진",
  why: "사업계획 업무 공백 없이 다음 일정을 이어가기 위해",
  what: "현재 자료와 공식 마감일을 확인하고 인수인계 표를 작성한다.",
  doneWhen: "확인된 원본 링크, 마감일, 다음 행동이 인수인계 기록에 정리되어 있다.",
  hours: 4,
  dueDate: "2026-10-05",
  deliverableKind: "doc",
  deliverable: "사업계획 인수인계서",
  deliverableCount: 1,
  ...patch,
});

async function setup(overrides = {}) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "bring-crm-bridge-"));
  const savedProjects = [];
  const savedOrders = [];
  const bridge = createCrmCommandBridge({
    userDataPath,
    getAuthState: () => ({ user: { uid: "chairman-1", email: "bringengineering1008@gmail.com", role: "admin" } }),
    saveProject: async value => { savedProjects.push(value); return value; },
    saveWorkOrder: async value => { savedOrders.push(value); return value; },
    now: () => future,
    ...overrides,
  });
  await bridge.start();
  return { bridge, userDataPath, savedProjects, savedOrders };
}

async function request(bridge, pathname, body, token = bridge.token) {
  const response = await fetch(`http://127.0.0.1:${bridge.port}${pathname}`, {
    method: ["/v1/status", "/v1/context"].includes(pathname) ? "GET" : "POST",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

test("context exposes only staff identities and active order summaries to an admin", async t => {
  const context = await setup({ loadWorkOrders: async () => ({
    members: [{ uid: "u1", displayName: "김현진", department: "운영", email: "private@example.com" }],
    orders: [
      { id: "a", title: "제출 준비", assigneeUid: "u1", status: "assigned", dueDate: "2026-09-29", why: "private" },
      { id: "b", title: "완료 업무", status: "done" },
    ],
  }) });
  t.after(async () => { await context.bridge.close(); await fs.rm(context.userDataPath, { recursive: true, force: true }); });
  const result = await request(context.bridge, "/v1/context");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.members, [{ uid: "u1", displayName: "김현진", department: "운영" }]);
  assert.deepEqual(result.body.orders, [{ id: "a", title: "제출 준비", assigneeUid: "u1", status: "assigned", dueDate: "2026-09-29", createdAt: "", projectId: "" }]);
  assert.equal(JSON.stringify(result.body).includes("private"), false);
});

test("context rejects a non-admin without reading staff or orders", async t => {
  let reads = 0;
  const context = await setup({
    getAuthState: () => ({ user: { uid: "staff", role: "member" } }),
    loadWorkOrders: async () => { reads += 1; return { members: [], orders: [] }; },
  });
  t.after(async () => { await context.bridge.close(); await fs.rm(context.userDataPath, { recursive: true, force: true }); });
  const result = await request(context.bridge, "/v1/context");
  assert.equal(result.status, 403);
  assert.equal(reads, 0);
});

test("CRM status returns only the current authenticated identity and role", async t => {
  const context = await setup();
  t.after(async () => { await context.bridge.close(); await fs.rm(context.userDataPath, { recursive: true, force: true }); });
  const result = await request(context.bridge, "/v1/status");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    connected: true,
    email: "bringengineering1008@gmail.com",
    role: "admin",
    admin: true,
  });
  assert.equal(JSON.stringify(result.body).includes("token"), false);
});

test("preview validates a batch without writing to CRM", async t => {
  const context = await setup();
  t.after(async () => { await context.bridge.close(); await fs.rm(context.userDataPath, { recursive: true, force: true }); });
  const result = await request(context.bridge, "/v1/preview", { workOrders: [order()] });
  assert.equal(result.status, 200);
  assert.equal(result.body.valid, true);
  assert.ok(result.body.previewId);
  assert.ok(result.body.workOrders[0].id);
  assert.equal(context.savedProjects.length, 0);
  assert.equal(context.savedOrders.length, 0);
});

test("preview reports every missing publication field and keeps the draft unpublishable", async t => {
  const context = await setup();
  t.after(async () => { await context.bridge.close(); await fs.rm(context.userDataPath, { recursive: true, force: true }); });
  const result = await request(context.bridge, "/v1/preview", { workOrders: [order({ dueDate: "", doneWhen: "" })] });
  assert.equal(result.status, 422);
  assert.equal(result.body.valid, false);
  assert.match(result.body.items[0].error, /완료 기준|마감일/u);
  assert.equal(context.savedOrders.length, 0);
});

test("publish requires a live admin session, the exact preview, and explicit approval", async t => {
  let role = "member";
  const context = await setup({ getAuthState: () => ({ user: { uid: "staff-1", email: "staff@example.com", role } }) });
  t.after(async () => { await context.bridge.close(); await fs.rm(context.userDataPath, { recursive: true, force: true }); });
  const preview = await request(context.bridge, "/v1/preview", { workOrders: [order()] });
  assert.equal(preview.status, 403);
  role = "admin";
  const adminPreview = await request(context.bridge, "/v1/preview", { workOrders: [order()] });
  assert.equal(adminPreview.status, 200);
  const denied = await request(context.bridge, "/v1/publish", {
    previewId: adminPreview.body.previewId,
    approvalPhrase: "",
  });
  assert.equal(denied.status, 403);
  assert.equal(context.savedOrders.length, 0);
});

test("approved publish reuses generated IDs and retry does not create duplicate orders", async t => {
  const context = await setup();
  t.after(async () => { await context.bridge.close(); await fs.rm(context.userDataPath, { recursive: true, force: true }); });
  const preview = await request(context.bridge, "/v1/preview", { workOrders: [order()] });
  const payload = { previewId: preview.body.previewId, approvalPhrase: "CRM 발행 승인" };
  const published = await request(context.bridge, "/v1/publish", payload);
  const retried = await request(context.bridge, "/v1/publish", payload);
  assert.equal(published.status, 200);
  assert.equal(published.body.results[0].ok, true);
  assert.equal(retried.status, 200);
  assert.equal(retried.body.repeated, true);
  assert.equal(context.savedOrders.length, 1);
  assert.equal(context.savedOrders[0].id, preview.body.workOrders[0].id);
});

test("batch publish records partial failures without claiming overall success", async t => {
  const context = await setup({
    saveWorkOrder: async value => {
      if (value.title === "두 번째 업무") throw Object.assign(new Error("저장 실패"), { code: "REMOTE_ERROR" });
      context.savedOrders.push(value);
      return value;
    },
  });
  t.after(async () => { await context.bridge.close(); await fs.rm(context.userDataPath, { recursive: true, force: true }); });
  const preview = await request(context.bridge, "/v1/preview", {
    workOrders: [order(), order({ title: "두 번째 업무" })],
  });
  const result = await request(context.bridge, "/v1/publish", {
    previewId: preview.body.previewId,
    approvalPhrase: "CRM 발행 승인",
  });
  assert.equal(result.status, 207);
  assert.equal(result.body.complete, false);
  assert.deepEqual(result.body.results.map(item => item.ok), [true, false]);
  assert.equal(context.savedOrders.length, 1);
});

test("unauthorized requests and oversized bodies are rejected", async t => {
  const context = await setup();
  t.after(async () => { await context.bridge.close(); await fs.rm(context.userDataPath, { recursive: true, force: true }); });
  const unauthorized = await request(context.bridge, "/v1/status", null, "wrong-token");
  assert.equal(unauthorized.status, 401);
  const response = await fetch(`http://127.0.0.1:${context.bridge.port}/v1/preview`, {
    method: "POST",
    headers: { authorization: `Bearer ${context.bridge.token}`, "content-type": "application/json" },
    body: JSON.stringify({ workOrders: [order({ what: "가".repeat(300_000) })] }),
  });
  assert.equal(response.status, 413);
});

test("bridge rendezvous file is removed only when this bridge closes", async t => {
  const context = await setup();
  const manifestPath = path.join(context.userDataPath, "codex-crm-bridge.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(manifest.port, context.bridge.port);
  assert.equal(manifest.token, context.bridge.token);
  await context.bridge.close();
  await assert.rejects(fs.access(manifestPath), { code: "ENOENT" });
  await fs.rm(context.userDataPath, { recursive: true, force: true });
  t.after(async () => { await fs.rm(context.userDataPath, { recursive: true, force: true }); });
});
