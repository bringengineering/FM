const assert = require("node:assert/strict");
const test = require("node:test");

const {
  FIELD_MAX_MESSAGE_BYTES,
  FIELD_ORIGIN,
  coordinateFieldExit,
  coordinateFieldLogout,
  createFieldExitCoordinator,
  createFieldEnvelope,
  createFieldRequestCoordinator,
  createFieldSessionRecoveryCoordinator,
  externalFieldLinkDecision,
  isAllowedFieldBootstrapNavigation,
  isAllowedFieldNavigation,
  isAllowedFieldPermission,
  isMatchingFieldAuthSignoutAck,
  sanitizeFieldTeamProfiles,
  validateFieldCommandResult,
  validateFieldMessage,
} = require("../src/field-view-policy");

const requestId = suffix => `550e8400-e29b-41d4-a716-44665544${suffix}`;
const fieldSender = overrides => ({
  webContentsId: 41,
  expectedWebContentsId: 41,
  frameUrl: `${FIELD_ORIGIN}/field?embedded=crm`,
  isMainFrame: true,
  ...overrides,
});
const crmSender = overrides => ({
  webContentsId: 7,
  expectedWebContentsId: 7,
  frameUrl: "file:///C:/Bring/desktop-crm/src/index.html",
  expectedFrameUrl: "file:///C:/Bring/desktop-crm/src/index.html",
  isMainFrame: true,
  ...overrides,
});

const persistedWorkItem = overrides => ({
  id: "job_1",
  visitId: "visit_1",
  jobType: "vacancy_capture",
  jobPolicyVersion: "2.0.0",
  checklistId: "vacancy_capture_v2",
  crmBuildingId: "building_1",
  assignedOperatorId: "operator_kim",
  dueDate: "2026-08-14",
  priority: "normal",
  workflowStatus: "assigned",
  uploadStatus: "none",
  sourceSnapshot: {
    parentType: "building",
    parentId: "building_1",
    parentName: "햇빛빌라",
    address: "강원 원주시 우산동 1",
  },
  sourceVersion: { parentUpdatedAt: "2026-08-14T01:02:03.000Z" },
  sourceHash: "a".repeat(64),
  mediaCount: 0,
  uploadFailureCount: 0,
  adminActionRequired: false,
  createdAt: "2026-08-14T01:02:03.000Z",
  createdByAuthUid: "auth_uid_1",
  createdByOperatorId: "operator_kim",
  updatedAt: "2026-08-14T01:02:03.000Z",
  updatedByAuthUid: "auth_uid_1",
  updatedByOperatorId: "operator_kim",
  archivedAt: null,
  ...overrides,
});

test("bridge validates exact direction, sender, origin, version, route, and entity IDs", () => {
  const ready = createFieldEnvelope("field.ready", {
    buildVersion: "2.0.0",
    route: "/field?embedded=crm&tab=today",
    session: "authenticated",
    operatorId: "operator_kim",
  }, requestId("0000"));
  assert.equal(validateFieldMessage(ready, { direction: "fieldToCrm", sender: fieldSender() }).ok, true);
  assert.equal(validateFieldMessage(ready, { direction: "crmToField", sender: fieldSender() }).ok, false);
  assert.equal(validateFieldMessage(ready, { direction: "fieldToCrm", sender: fieldSender({ webContentsId: 42 }) }).ok, false);
  assert.equal(validateFieldMessage(ready, { direction: "fieldToCrm", sender: fieldSender({ frameUrl: "https://evil.test/field" }) }).ok, false);
  assert.equal(validateFieldMessage(ready, { direction: "fieldToCrm", sender: fieldSender({ frameUrl: `${FIELD_ORIGIN}/not-field` }) }).ok, false);
  assert.equal(validateFieldMessage(ready, { direction: "fieldToCrm", sender: fieldSender({ isMainFrame: false }) }).ok, false);
  assert.equal(validateFieldMessage({ ...ready, protocolVersion: 1 }, { direction: "fieldToCrm", sender: fieldSender() }).ok, false);
  assert.equal(validateFieldMessage({ ...ready, payload: { ...ready.payload, buildVersion: "abc" } }, { direction: "fieldToCrm", sender: fieldSender() }).ok, false);
  assert.equal(validateFieldMessage({ ...ready, payload: { ...ready.payload, buildVersion: "01.0.0" } }, { direction: "fieldToCrm", sender: fieldSender() }).ok, false);
  assert.equal(validateFieldMessage({ ...ready, payload: { ...ready.payload, buildVersion: "1.0.0-beta" } }, { direction: "fieldToCrm", sender: fieldSender() }).ok, false);

  const navigate = createFieldEnvelope("field.navigate", { route: "/field?embedded=crm&tab=jobs&jobId=job_1", operatorId: "operator_kim" }, requestId("0001"));
  assert.equal(validateFieldMessage(navigate, { direction: "crmToField", sender: crmSender() }).ok, true);
  assert.equal(validateFieldMessage({ ...navigate, payload: { route: "javascript:alert(1)" } }, { direction: "crmToField", sender: crmSender() }).ok, false);

  const openEntity = createFieldEnvelope("field.openCrmEntity", { entityType: "salesUnits", entityId: "unit_1" }, requestId("0002"));
  assert.equal(validateFieldMessage(openEntity, { direction: "fieldToCrm", sender: fieldSender() }).ok, true);
  assert.equal(validateFieldMessage({ ...openEntity, payload: { entityType: "secrets", entityId: "unit_1" } }, { direction: "fieldToCrm", sender: fieldSender() }).ok, false);
  assert.equal(validateFieldMessage({ ...openEntity, payload: { entityType: "salesUnits", entityId: "__proto__" } }, { direction: "fieldToCrm", sender: fieldSender() }).ok, false);
  assert.equal(validateFieldMessage({ ...openEntity, payload: { entityType: "salesUnits", entityId: `a${"b".repeat(127)}` } }, { direction: "fieldToCrm", sender: fieldSender() }).ok, true);
  assert.equal(validateFieldMessage({ ...openEntity, payload: { entityType: "salesUnits", entityId: `a${"b".repeat(128)}` } }, { direction: "fieldToCrm", sender: fieldSender() }).ok, false);

  const incompatibleRoute = createFieldEnvelope("field.ready", {
    buildVersion: "2.0.0",
    route: "/field?embedded=crm&search=private",
    session: "authenticated",
  }, requestId("0011"));
  assert.equal(validateFieldMessage(incompatibleRoute, { direction: "fieldToCrm", sender: fieldSender() }).ok, false);
});

test("bridge rejects prototype keys, secret-shaped fields, oversized UTF-8, and non-HTTPS links", () => {
  const maliciousPayload = Object.create({ polluted: true });
  maliciousPayload.route = "/field";
  const malicious = {
    protocolVersion: 2,
    type: "field.routeChanged",
    requestId: requestId("0003"),
    payload: maliciousPayload,
  };
  assert.equal(validateFieldMessage(malicious, { direction: "fieldToCrm", sender: fieldSender() }).ok, false);

  const secret = createFieldEnvelope("field.command", {
    command: "createJob",
    operatorId: "operator_kim",
    args: { accessPassword: "never-cross-this-bridge" },
  }, requestId("0004"));
  assert.equal(validateFieldMessage(secret, { direction: "crmToField", sender: crmSender() }).ok, false);

  const huge = createFieldEnvelope("field.command", {
    command: "createJob",
    operatorId: "operator_kim",
    args: { memo: "가".repeat(FIELD_MAX_MESSAGE_BYTES) },
  }, requestId("0005"));
  assert.equal(validateFieldMessage(huge, { direction: "crmToField", sender: crmSender() }).ok, false);

  const external = createFieldEnvelope("field.openExternal", { url: "http://drive.google.com/file/1" }, requestId("0006"));
  assert.equal(validateFieldMessage(external, { direction: "fieldToCrm", sender: fieldSender() }).ok, false);
});

test("create opens only the local composer and mutation commands use exact argument schemas", () => {
  const context = { direction: "crmToField", sender: crmSender() };
  const command = (name, args, suffix) => validateFieldMessage(createFieldEnvelope("field.command", {
    command: name,
    operatorId: "operator_kim",
    args,
  }, requestId(suffix)), context).ok;

  assert.equal(command("openCreateJob", {}, "0015"), true);
  assert.equal(command("openCreateJob", { route: "/field?embedded=crm" }, "0016"), false);
  assert.equal(command("createJob", { route: "/field?embedded=crm" }, "0017"), false);
  assert.equal(command("switchOperator", { nextOperatorId: "operator_hwang" }, "0018"), false);
  assert.equal(command("claimJob", { jobId: "job_1" }, "0019"), true);
  assert.equal(command("claimJob", { jobId: "job_1", operatorId: "operator_other" }, "0020"), false);
  assert.equal(command("assignJob", {
    jobId: "job_1",
    assignedOperatorId: "operator_hwang",
    reason: "현장 일정 조정",
  }, "0021"), true);
  assert.equal(command("assignJob", { jobId: "job_1" }, "0022"), false);
  assert.equal(command("changeVisit", {
    visitId: "visit_1",
    dueDate: "2026-08-15",
    reason: "방문일 변경",
  }, "0023"), true);
  assert.equal(command("changeVisit", { visitId: "visit_1", reason: "변경 없음" }, "0024"), false);
  assert.equal(command("transitionStatus", { jobId: "job_1", toStatus: "accepted" }, "0025"), true);
  assert.equal(command("transitionStatus", { jobId: "job_1", toStatus: "made_up" }, "0026"), false);
  assert.equal(command("reviewJob", { jobId: "job_1", decision: "approved" }, "0027"), true);
  assert.equal(command("reviewJob", { jobId: "job_1", decision: "skip_review" }, "0028"), false);
});

test("acknowledgements and command results use closed success and error schemas", () => {
  const context = { direction: "fieldToCrm", sender: fieldSender() };
  const valid = (type, payload, suffix) => validateFieldMessage(
    createFieldEnvelope(type, payload, requestId(suffix)),
    context,
  ).ok;
  const item = persistedWorkItem();

  assert.equal(valid("field.ack", { ok: true }, "0033"), true);
  assert.equal(valid("field.ack", { ok: true, error: { code: "NO" } }, "0034"), false);
  assert.equal(valid("field.ack", { ok: false, error: { code: "FIELD_NAVIGATION_FAILED" } }, "0035"), true);
  assert.equal(valid("field.ack", { ok: false }, "0036"), false);
  assert.equal(valid("field.ack", { ok: false, error: { code: "NO", extra: true } }, "0037"), false);

  assert.equal(valid("field.commandResult", { ok: true, result: item }, "0038"), true);
  assert.equal(valid("field.commandResult", { ok: true, result: { unexpected: "accepted" } }, "0039"), false);
  assert.equal(valid("field.commandResult", { ok: false, error: { code: "FIELD_REQUEST_FAILED" } }, "0040"), true);
  assert.equal(valid("field.commandResult", { ok: false, error: { code: "ANY", extra: "accepted" } }, "0041"), false);
  assert.equal(valid("field.commandResult", { ok: false, error: { code: "ANY", token: "secret" } }, "0042"), false);
  assert.equal(valid("field.commandResult", { ok: true, result: item, error: { code: "NO" } }, "0043"), false);
});

test("command result validation is correlated to the original command and server result shape", async () => {
  const item = persistedWorkItem();
  const createResult = { visitId: "visit_1", jobIds: ["job_1", "job_2"], repeated: false };
  const changedItem = persistedWorkItem({ id: "job_2", visitId: "visit_2" });
  const changeResult = {
    visitId: "visit_1",
    newVisitId: "visit_2",
    updatedJobIds: ["job_2"],
    workItems: [changedItem],
  };

  assert.equal(validateFieldCommandResult("openCreateJob", { ok: true, result: createResult }), true);
  assert.equal(validateFieldCommandResult("openCreateJob", { ok: true, result: { ...createResult, extra: true } }), false);
  assert.equal(validateFieldCommandResult("claimJob", { ok: true, result: item }), true);
  assert.equal(validateFieldCommandResult("assignJob", { ok: true, result: item }), true);
  assert.equal(validateFieldCommandResult("transitionStatus", { ok: true, result: item }), true);
  assert.equal(validateFieldCommandResult("changeVisit", { ok: true, result: changeResult }), true);
  assert.equal(validateFieldCommandResult("changeVisit", { ok: true, result: { ...changeResult, updatedJobIds: ["job_wrong"] } }), false);
  assert.equal(validateFieldCommandResult("reviewJob", { ok: true, result: item }), false);
  assert.equal(validateFieldCommandResult("claimJob", { ok: false, error: { code: "FIELD_REQUEST_FAILED" } }), true);
  assert.equal(validateFieldCommandResult("claimJob", { ok: false, error: { code: "FIELD_REQUEST_FAILED", detail: "secret" } }), false);

  const coordinator = createFieldRequestCoordinator({
    send: () => undefined,
    setTimer: () => 1,
    clearTimer: () => undefined,
  });
  coordinator.setSession("session-a");
  const command = createFieldEnvelope("field.command", {
    command: "assignJob",
    operatorId: "operator_kim",
    args: { jobId: "job_1", assignedOperatorId: "operator_kim", reason: "담당 배정" },
  }, requestId("0044"));
  const pending = coordinator.request(command);
  const mismatched = createFieldEnvelope("field.commandResult", { ok: true, result: createResult }, command.requestId);
  assert.equal(coordinator.handleResponse(mismatched, "session-a"), false);
  await assert.rejects(pending, error => error && error.code === "FIELD_BRIDGE_RESPONSE_INVALID");
});

test("approved external hosts open directly while other HTTPS hosts require confirmation", () => {
  assert.deepEqual(externalFieldLinkDecision("https://drive.google.com/file/d/1"), {
    ok: true,
    url: "https://drive.google.com/file/d/1",
    host: "drive.google.com",
    requiresConfirmation: false,
  });
  assert.deepEqual(externalFieldLinkDecision("https://example.com/path"), {
    ok: true,
    url: "https://example.com/path",
    host: "example.com",
    requiresConfirmation: true,
  });
  assert.equal(externalFieldLinkDecision("http://example.com").ok, false);
  assert.equal(externalFieldLinkDecision("file:///etc/passwd").ok, false);
  assert.equal(externalFieldLinkDecision("https://user:pass@example.com").ok, false);
});

test("FIELD navigation and camera permission use the same exact-origin policy", () => {
  assert.equal(isAllowedFieldNavigation(`${FIELD_ORIGIN}/field?embedded=crm&tab=today`), true);
  assert.equal(isAllowedFieldNavigation(`${FIELD_ORIGIN}/field?embedded=crm&tab=jobs&jobId=job_1&scope=mine&filter=assigned&date=2026-08-14`), true);
  assert.equal(isAllowedFieldNavigation(`${FIELD_ORIGIN}/field`), false);
  assert.equal(isAllowedFieldNavigation(`${FIELD_ORIGIN}/field?tab=jobs`), false);
  assert.equal(isAllowedFieldNavigation(`${FIELD_ORIGIN}/field/capture?embedded=crm`), false);
  assert.equal(isAllowedFieldNavigation(`${FIELD_ORIGIN}/field/anything?embedded=crm`), false);
  assert.equal(isAllowedFieldNavigation(`${FIELD_ORIGIN}/field?embedded=other`), false);
  assert.equal(isAllowedFieldNavigation(`${FIELD_ORIGIN}/field?embedded=crm&embedded=crm`), false);
  assert.equal(isAllowedFieldNavigation(`${FIELD_ORIGIN}/field?tab=../../admin`), false);
  assert.equal(isAllowedFieldNavigation(`${FIELD_ORIGIN}/field?scope=everyone`), false);
  assert.equal(isAllowedFieldNavigation(`${FIELD_ORIGIN}/field?filter=password%3D1234`), false);
  assert.equal(isAllowedFieldNavigation(`${FIELD_ORIGIN}/field?jobId=__proto__`), false);
  assert.equal(isAllowedFieldNavigation(`${FIELD_ORIGIN}/field?date=2026-02-31`), false);
  assert.equal(isAllowedFieldNavigation(`${FIELD_ORIGIN}/field?search=door%20code`), false);
  assert.equal(isAllowedFieldNavigation(`${FIELD_ORIGIN}/field?unexpected=1`), false);
  assert.equal(isAllowedFieldNavigation(`${FIELD_ORIGIN}/field?token=secret`), false);
  const handoffCode = "A".repeat(43);
  assert.equal(isAllowedFieldNavigation(`${FIELD_ORIGIN}/field?embedded=crm&desktop_handoff=${handoffCode}`), false);
  assert.equal(isAllowedFieldBootstrapNavigation(`${FIELD_ORIGIN}/field?embedded=crm&desktop_handoff=${handoffCode}`), true);
  assert.equal(isAllowedFieldBootstrapNavigation(`${FIELD_ORIGIN}/field?desktop_handoff=${handoffCode}&embedded=crm`), true);
  assert.equal(isAllowedFieldBootstrapNavigation(`${FIELD_ORIGIN}/field?embedded=crm&desktop_handoff=short`), false);
  assert.equal(isAllowedFieldBootstrapNavigation(`${FIELD_ORIGIN}/field?embedded=crm&desktop_handoff=${handoffCode}&tab=today`), false);
  assert.equal(isAllowedFieldBootstrapNavigation(`https://evil.test/field?embedded=crm&desktop_handoff=${handoffCode}`), false);
  assert.equal(isAllowedFieldNavigation(`${FIELD_ORIGIN}/field#capture`), false);
  assert.equal(isAllowedFieldPermission("media", `${FIELD_ORIGIN}/field?embedded=crm&tab=jobs`, ["video"]), true);
  assert.equal(isAllowedFieldPermission("media", `${FIELD_ORIGIN}/field?embedded=crm&tab=jobs`, ["audio"]), false);
  assert.equal(isAllowedFieldPermission("media", "https://evil.test/field/capture", ["video"]), false);
  assert.equal(isAllowedFieldPermission("geolocation", `${FIELD_ORIGIN}/field`, []), false);
});

test("team profiles are bounded, minimally shaped, sorted, and never trust a role", () => {
  const source = JSON.parse(`{
    "operator_b": {"displayName":" 김현진 ","active":true,"sortOrder":20,"role":"admin"},
    "operator_a": {"displayName":"황우중","active":true,"sortOrder":10},
    "operator_c": {"displayName":"대표","active":true,"sortOrder":30},
    "operator_default": {"displayName":"순서누락","active":true},
    "operator_inactive": {"displayName":"퇴사자","active":false,"sortOrder":1},
    "operator_control": {"displayName":"이름\\n변조","active":true,"sortOrder":2},
    "__proto__": {"displayName":"오염","active":true,"sortOrder":0}
  }`);
  source.operator_too_long = { displayName: "가".repeat(81), active: true, sortOrder: 3 };
  source.operator_bad_profile = Object.create({ displayName: "상속 이름", active: true, sortOrder: 4 });

  assert.deepEqual(sanitizeFieldTeamProfiles(source), [
    { id: "operator_a", displayName: "황우중", active: true, sortOrder: 10 },
    { id: "operator_c", displayName: "대표", active: true, sortOrder: 30 },
  ]);
  assert.deepEqual(sanitizeFieldTeamProfiles([]), []);
});

test("request coordinator correlates once, deduplicates, times out, cancels, and isolates sessions", async () => {
  const sent = [];
  const timers = [];
  const coordinator = createFieldRequestCoordinator({
    send: envelope => { sent.push(envelope); },
    setTimer: callback => { timers.push(callback); return callback; },
    clearTimer: () => undefined,
  });
  coordinator.setSession("session-a");

  const envelope = createFieldEnvelope("field.navigate", { route: "/field/today" }, requestId("0007"));
  const first = coordinator.request(envelope);
  const duplicate = coordinator.request(envelope);
  assert.equal(first, duplicate);
  assert.equal(sent.length, 1);

  const response = createFieldEnvelope("field.ack", { ok: true }, envelope.requestId);
  assert.equal(coordinator.handleResponse(response, "session-a"), true);
  assert.equal(coordinator.handleResponse(response, "session-a"), false);
  assert.deepEqual(await first, response);
  assert.deepEqual(await coordinator.request(envelope), response);
  assert.equal(sent.length, 1);

  const timeoutEnvelope = createFieldEnvelope("crm.logoutCheck", { reason: "logout" }, requestId("0008"));
  const timedOut = coordinator.request(timeoutEnvelope);
  timers.at(-1)();
  await assert.rejects(timedOut, error => error && error.code === "FIELD_BRIDGE_TIMEOUT");
  assert.equal(sent.at(-1).type, "field.cancel");

  const oldEnvelope = createFieldEnvelope("field.command", { command: "assignJob", operatorId: "operator_kim", args: { jobId: "job_1" } }, requestId("0009"));
  const oldRequest = coordinator.request(oldEnvelope);
  coordinator.setSession("session-b");
  await assert.rejects(oldRequest, error => error && error.code === "FIELD_SESSION_CHANGED");
  const oldResponse = createFieldEnvelope("field.commandResult", { ok: true, result: { jobId: "job_1" } }, oldEnvelope.requestId);
  assert.equal(coordinator.handleResponse(oldResponse, "session-a"), false);
});

test("first session assignment cancels requests created in the unbound session", async () => {
  const sent = [];
  const coordinator = createFieldRequestCoordinator({
    send: envelope => { sent.push(envelope); },
    setTimer: () => 1,
    clearTimer: () => undefined,
  });
  const envelope = createFieldEnvelope("field.navigate", { route: "/field/today" }, requestId("0010"));
  const pending = coordinator.request(envelope);
  coordinator.setSession("session-a");
  await assert.rejects(pending, error => error && error.code === "FIELD_SESSION_CHANGED");
  assert.equal(sent.at(-1).type, "field.cancel");
});

test("cancelled requests do not retain a cached success or accept a late response", async () => {
  const sent = [];
  const coordinator = createFieldRequestCoordinator({
    send: envelope => { sent.push(envelope); },
    setTimer: () => 1,
    clearTimer: () => undefined,
  });
  coordinator.setSession("session-a");
  const envelope = createFieldEnvelope("field.navigate", { route: "/field/today" }, requestId("0012"));
  const pending = coordinator.request(envelope);
  assert.equal(coordinator.cancel(envelope.requestId), true);
  await assert.rejects(pending, error => error && error.code === "FIELD_BRIDGE_CANCELLED");
  assert.equal(coordinator.handleResponse(createFieldEnvelope("field.ack", { ok: true }, envelope.requestId), "session-a"), false);
  const retried = coordinator.request(envelope);
  assert.equal(sent.filter(item => item.requestId === envelope.requestId && item.type === "field.navigate").length, 2);
  assert.equal(coordinator.handleResponse(createFieldEnvelope("field.ack", { ok: true }, envelope.requestId), "session-a"), true);
  await retried;
});

test("logout coordinator preserves upload data and fails closed until FIELD auth signout is acknowledged", async () => {
  const uploadQueue = [{ id: "upload_1", blob: "untouched" }];
  const snapshot = JSON.stringify(uploadQueue);
  const order = [];
  const callbacks = {
    ensureReady: async () => { order.push("ready"); return { id: "field-view" }; },
    checkPending: async handle => {
      assert.equal(handle.id, "field-view");
      order.push("pending");
      return { count: 0, risk: "none" };
    },
    signOutFieldAuthentication: async handle => {
      assert.equal(handle.id, "field-view");
      order.push("field-signout-ack");
    },
    finishCrmLogout: async () => { order.push("crm-logout"); },
  };

  assert.deepEqual(await coordinateFieldLogout({ confirmed: false, ...callbacks }), { ok: true });
  assert.deepEqual(order, ["ready", "pending", "field-signout-ack", "crm-logout"]);
  assert.equal(JSON.stringify(uploadQueue), snapshot);

  order.length = 0;
  const pending = await coordinateFieldLogout({
    confirmed: false,
    ...callbacks,
    checkPending: async () => { order.push("pending"); return { count: 2, risk: "high" }; },
  });
  assert.equal(pending.code, "FIELD_LOGOUT_PENDING");
  assert.deepEqual(order, ["ready", "pending"]);

  order.length = 0;
  const failed = await coordinateFieldLogout({
    confirmed: true,
    ...callbacks,
    checkPending: async () => { order.push("pending"); return { count: 2, risk: "high" }; },
    signOutFieldAuthentication: async () => {
      order.push("field-signout-failed");
      throw new Error("no acknowledgement");
    },
  });
  assert.equal(failed.code, "FIELD_SESSION_CLEAR_FAILED");
  assert.deepEqual(order, ["ready", "pending", "field-signout-failed"]);
});

test("application exit checks pending uploads, fails closed on unknown state, and requires explicit confirmation", async () => {
  const queue = [{ id: "upload_1", blob: "untouched" }];
  const snapshot = JSON.stringify(queue);
  const order = [];
  const base = {
    reason: "window",
    ensureReady: async () => { order.push("ready"); return { id: "field-view" }; },
    checkPending: async handle => {
      assert.equal(handle.id, "field-view");
      order.push("pending");
      return { count: 2, risk: "high" };
    },
    finishApplicationExit: async reason => { order.push(`finish:${reason}`); },
  };

  const cancelled = await coordinateFieldExit({
    ...base,
    confirmPending: async pending => { order.push(`confirm:${pending.count}`); return false; },
  });
  assert.equal(cancelled.code, "FIELD_EXIT_CANCELLED");
  assert.deepEqual(order, ["ready", "pending", "confirm:2"]);
  assert.equal(JSON.stringify(queue), snapshot);

  order.length = 0;
  const confirmed = await coordinateFieldExit({
    ...base,
    reason: "update",
    confirmPending: async pending => { order.push(`confirm:${pending.count}`); return true; },
  });
  assert.deepEqual(confirmed, { ok: true });
  assert.deepEqual(order, ["ready", "pending", "confirm:2", "finish:update"]);

  order.length = 0;
  const unknown = await coordinateFieldExit({
    ...base,
    checkPending: async () => { throw new Error("renderer unavailable"); },
    confirmPending: async () => true,
  });
  assert.equal(unknown.code, "FIELD_EXIT_CHECK_FAILED");
  assert.deepEqual(order, ["ready"]);
});

test("application exit coordinator collapses close re-entry and runs update install only once", async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const order = [];
  const coordinator = createFieldExitCoordinator({
    ensureReady: async () => { order.push("ready"); await waiting; return { id: "field-view" }; },
    checkPending: async () => ({ count: 0, risk: "none" }),
    confirmPending: async () => true,
    finishApplicationExit: async reason => { order.push(`finish:${reason}`); },
  });

  const first = coordinator.request("update");
  const reentered = coordinator.request("update");
  assert.equal(first, reentered);
  release();
  assert.deepEqual(await first, { ok: true });
  assert.deepEqual(await reentered, { ok: true });
  assert.deepEqual(order, ["ready", "finish:update"]);
  assert.deepEqual(await coordinator.request("update"), { ok: true, alreadyApproved: true, reason: "update" });
  assert.deepEqual(order, ["ready", "finish:update"]);
});

test("session recovery issues one 60-second one-use handoff per view session and rejects stale recovery", async () => {
  let now = 1_000;
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const loaded = [];
  let createCalls = 0;
  const recovery = createFieldSessionRecoveryCoordinator({
    now: () => now,
    createHandoff: async () => {
      createCalls += 1;
      await waiting;
      return { code: "H".repeat(43), expiresAt: now + 60_000 };
    },
    loadHandoff: async code => { loaded.push(code); },
  });
  let current = true;
  const first = recovery.recover("crm-session-a:view-41", () => current);
  const duplicate = recovery.recover("crm-session-a:view-41", () => current);
  assert.equal(first, duplicate);
  release();
  assert.deepEqual(await first, { ok: true });
  assert.equal(createCalls, 1);
  assert.deepEqual(loaded, ["H".repeat(43)]);
  assert.deepEqual(await recovery.recover("crm-session-a:view-41", () => current), {
    ok: false,
    code: "FIELD_HANDOFF_ALREADY_ATTEMPTED",
  });

  recovery.reset();
  current = false;
  assert.deepEqual(await recovery.recover("crm-session-b:view-42", () => current), {
    ok: false,
    code: "FIELD_SESSION_CHANGED",
  });
  assert.equal(loaded.length, 1);

  recovery.reset();
  current = true;
  now = 100_000;
  const expired = createFieldSessionRecoveryCoordinator({
    now: () => now,
    createHandoff: async () => ({ code: "E".repeat(43), expiresAt: now }),
    loadHandoff: async code => { loaded.push(code); },
  });
  assert.deepEqual(await expired.recover("crm-session-c:view-43", () => true), {
    ok: false,
    code: "FIELD_HANDOFF_INVALID",
  });
  assert.equal(loaded.length, 1);
});

test("FIELD auth signout acknowledgements require the same request, renderer, and session", () => {
  const expected = {
    requestId: requestId("0013"),
    webContentsId: 41,
    sessionKey: "session-a",
  };
  assert.equal(isMatchingFieldAuthSignoutAck(
    { requestId: requestId("0013") },
    expected,
    { webContentsId: 41, sessionKey: "session-a" },
  ), true);
  assert.equal(isMatchingFieldAuthSignoutAck(
    { requestId: requestId("0014") },
    expected,
    { webContentsId: 41, sessionKey: "session-a" },
  ), false);
  assert.equal(isMatchingFieldAuthSignoutAck(
    { requestId: requestId("0013") },
    expected,
    { webContentsId: 42, sessionKey: "session-a" },
  ), false);
  assert.equal(isMatchingFieldAuthSignoutAck(
    { requestId: requestId("0013") },
    expected,
    { webContentsId: 41, sessionKey: "session-b" },
  ), false);
  assert.equal(isMatchingFieldAuthSignoutAck(
    { requestId: requestId("0013"), extra: true },
    expected,
    { webContentsId: 41, sessionKey: "session-a" },
  ), false);
  const inherited = Object.create({ requestId: requestId("0013") });
  assert.equal(isMatchingFieldAuthSignoutAck(
    inherited,
    expected,
    { webContentsId: 41, sessionKey: "session-a" },
  ), false);
});

test("logout decision pending flag must exactly match the bounded upload count", () => {
  const context = { direction: "fieldToCrm", sender: fieldSender() };
  const decision = (pending, count, risk, suffix) => validateFieldMessage(createFieldEnvelope(
    "field.logoutDecision",
    { pending, count, risk },
    requestId(suffix),
  ), context).ok;

  assert.equal(decision(false, 0, "none", "0029"), true);
  assert.equal(decision(true, 2, "high", "0030"), true);
  assert.equal(decision(false, 2, "high", "0031"), false);
  assert.equal(decision(true, 0, "none", "0032"), false);
});
