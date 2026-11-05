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

test("preview links new work to a verified existing project", async t => {
  const projectId = "existing-project";
  const context = await setup({ loadWorkOrders: async () => ({ members: [], orders: [], projects: [{ id: projectId, name: "콘텐츠 마케팅" }] }) });
  t.after(async () => { await context.bridge.close(); await fs.rm(context.userDataPath, { recursive: true, force: true }); });
  const missing = await request(context.bridge, "/v1/preview", { projectId: "missing", workOrders: [order()] });
  assert.equal(missing.body.valid, false);
  assert.equal(missing.body.projectError.code, "PROJECT_NOT_FOUND");
  const preview = await request(context.bridge, "/v1/preview", { projectId, workOrders: [order()] });
  assert.equal(preview.body.valid, true);
  assert.equal(preview.body.workOrders[0].projectId, projectId);
  const published = await request(context.bridge, "/v1/publish", { previewId: preview.body.previewId, approvalPhrase: preview.body.approvalPhrase });
  assert.equal(published.body.complete, true);
  assert.equal(context.savedProjects.length, 0);
  assert.equal(context.savedOrders[0].projectId, projectId);
});

test("approved project groups preview before linking the existing fifteen orders", async t => {
  const orders=Array.from({length:15},(_,index)=>({id:`o${index}`,title:`업무 ${index}`,status:'assigned',projectId:'',dueDate:'2026-10-02'}));
  const projects=[];
  const context=await setup({loadWorkOrders:async()=>({orders,projects}),saveProject:async value=>{projects.push(value);return value;},linkWorkOrderProject:async(id,projectId)=>{const found=orders.find(item=>item.id===id);found.projectId=projectId;return found;}});
  t.after(async()=>{await context.bridge.close();await fs.rm(context.userDataPath,{recursive:true,force:true});});
  const groups=Array.from({length:5},(_,index)=>({name:`프로젝트 ${index}`,orderIds:orders.slice(index*3,index*3+3).map(item=>item.id)}));
  const preview=await request(context.bridge,'/v1/link-project-groups',{groups,dryRun:true});
  assert.equal(preview.status,200);assert.equal(preview.body.writesPerformed,false);assert.equal(projects.length,0);
  const result=await request(context.bridge,'/v1/link-project-groups',{groups,dryRun:false});
  assert.equal(result.status,200);assert.equal(result.body.complete,true);assert.equal(projects.length,5);
  assert.equal(orders.filter(item=>item.projectId).length,15);
  const repeated=await request(context.bridge,'/v1/link-project-groups',{groups,dryRun:false});
  assert.equal(repeated.status,200);assert.equal(projects.length,5);
});

test("September service revenue stays in draft and retries do not duplicate invoices", async t => {
  const invoices=[];
  const context=await setup({loadBillingLedger:async()=>({invoices,receipts:[]}),saveBillingInvoice:async input=>{invoices.push({...input.record,revision:1});return input.record;}});
  t.after(async()=>{await context.bridge.close();await fs.rm(context.userDataPath,{recursive:true,force:true});});
  const preview=await request(context.bridge,'/v1/september-service-revenue',{dryRun:true});
  assert.equal(preview.status,200);assert.equal(preview.body.total,690000);assert.equal(invoices.length,0);
  const published=await request(context.bridge,'/v1/september-service-revenue',{dryRun:false});
  assert.equal(published.status,200);assert.equal(invoices.length,4);assert.ok(invoices.every(item=>item.status==='draft'));
  const repeated=await request(context.bridge,'/v1/september-service-revenue',{dryRun:false});
  assert.equal(repeated.status,200);assert.equal(invoices.length,4);
});
test("TV pairing requires admin bridge token and an exact eight-character code", async t => {
  const calls = [];
  const context = await setup({ wallboardAdmin: async input => { calls.push(input); return input.action === "list" ? { version: 2, devices: [] } : { ok: true, status: "approved" }; } });
  t.after(async () => { await context.bridge.close(); await fs.rm(context.userDataPath, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${context.bridge.port}`;
  const denied = await fetch(`${base}/v1/wallboard-devices`);
  assert.equal(denied.status, 401);
  const listed = await fetch(`${base}/v1/wallboard-devices`, { headers: { authorization: `Bearer ${context.bridge.token}` } });
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).version, 2);
  const invalid = await request(context.bridge, "/v1/wallboard-approve", { code: "1234567", name: "사무실 TV" });
  assert.equal(invalid.status, 422);
  const approved = await request(context.bridge, "/v1/wallboard-approve", { code: "48DC7842", name: "회사 운영 TV" });
  assert.equal(approved.status, 200);
  assert.deepEqual(calls, [{ action: "list" }, { action: "approve", code: "48DC7842", name: "회사 운영 TV" }]);
});

test("shorter TV rotation is available only through the authenticated admin bridge", async t => {
  const calls=[];
  const context=await setup({wallboardAdmin:async input=>{calls.push(input);return {ok:true,version:8,playlist:[]};}});
  t.after(async()=>{await context.bridge.close();await fs.rm(context.userDataPath,{recursive:true,force:true});});
  const denied=await request(context.bridge,'/v1/wallboard-shorten',null,'wrong-token');
  assert.equal(denied.status,401);assert.equal(calls.length,0);
  const result=await request(context.bridge,'/v1/wallboard-shorten');
  assert.equal(result.status,200);assert.equal(result.body.version,8);
  assert.deepEqual(calls,[{action:'shorten'}]);
});
test("issues can be removed from the TV playlist through the authenticated admin bridge", async t => {
  const calls=[];
  const context=await setup({wallboardAdmin:async input=>{calls.push(input);return {ok:true,version:9,playlist:[{key:'issues',enabled:false,seconds:15}]};}});
  t.after(async()=>{await context.bridge.close();await fs.rm(context.userDataPath,{recursive:true,force:true});});
  const denied=await request(context.bridge,'/v1/wallboard-hide-issues',null,'wrong-token');
  assert.equal(denied.status,401);assert.equal(calls.length,0);
  const result=await request(context.bridge,'/v1/wallboard-hide-issues');
  assert.equal(result.status,200);assert.equal(result.body.playlist[0].enabled,false);
  assert.deepEqual(calls,[{action:'hide-issues'}]);
});
