"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/office.js"), "utf8");
const controller = source.slice(source.indexOf("  function confirmCrmAccountInviteArchive("), source.indexOf("  function chooseDefaultUser("));

function harness({ role = "admin", request } = {}) {
  const calls = [];
  const notices = [];
  const dialogs = [];
  const memberLabel = { textContent: "" };
  const state = {
    generation: 1, busy: false, crmAccountInvitesLoading: false,
    crmAccountInvites: [{ uid: "complete-1", displayName: '<img src=x onerror="bad()">', status: "complete" }, { uid: "pending-1", status: "pending" }],
    context: { uid: "admin-1", role, api: { archiveCrmAccountInvite: async input => {
      calls.push(input);
      return request ? request(input) : { uid: input.uid, archived: true };
    } } },
  };
  const context = {
    state,
    isCrmAdmin: () => state.context.role === "admin",
    currentUserId: () => state.context.uid,
    captureContextGuard: () => ({ generation: state.generation, uid: state.context.uid, context: state.context }),
    contextGuardActive: guard => guard.generation === state.generation && guard.context === state.context,
    renderCurrent: () => {},
    notify: (message, kind) => notices.push({ message, kind }),
    document: {
      body: { append: dialog => dialogs.push(dialog) },
      createElement: () => ({
        returnValue: "", handlers: {}, setAttribute() {}, querySelector: () => memberLabel,
        addEventListener(type, callback) { this.handlers[type] = callback; },
        showModal() {}, remove() { this.removed = true; },
        close(value) { this.returnValue = value; this.handlers.close(); },
      }),
    },
  };
  vm.runInNewContext(controller + "\nthis.archive = archiveCrmAccountInvite;", context);
  return { ...context, calls, notices, dialogs, memberLabel };
}

test("cancel and non-admin/pending targets never call the archive API", async () => {
  for (const role of ["member", "viewer"]) {
    const h = harness({ role });
    await h.archive("complete-1");
    assert.equal(h.dialogs.length, 0);
    assert.equal(h.calls.length, 0);
  }
  const h = harness();
  await h.archive("pending-1");
  await h.archive("unknown");
  assert.equal(h.dialogs.length, 0);
  const action = h.archive("complete-1");
  assert.equal(h.memberLabel.textContent, h.state.crmAccountInvites[0].displayName);
  h.dialogs[0].close("cancel");
  await action;
  assert.equal(h.calls.length, 0);
  assert.equal(h.state.crmAccountInvites.length, 2);
  assert.equal(h.dialogs[0].removed, true);
});

test("only an acknowledged archive removes the completed row; server errors preserve it", async () => {
  for (const request of [async () => { throw new Error("offline"); }, async () => ({ uid: "other", archived: true })]) {
    const h = harness({ request });
    const action = h.archive("complete-1"); h.dialogs[0].close("archive"); await action;
    assert.equal(h.state.crmAccountInvites.length, 2);
    assert.equal(h.state.busy, false);
    assert.equal(h.notices[0].kind, "error");
  }
  const h = harness();
  const action = h.archive("complete-1"); h.dialogs[0].close("archive"); await action;
  assert.deepEqual(h.state.crmAccountInvites.map(row => row.uid), ["pending-1"]);
  assert.equal(h.calls.length, 1);
  assert.equal(h.state.busy, false);
  assert.equal(h.notices[0].kind, "success");
});

test("changing the session while confirming cancels the mutation", async () => {
  const h = harness();
  const action = h.archive("complete-1");
  h.state.generation += 1;
  h.dialogs[0].close("archive"); await action;
  assert.equal(h.calls.length, 0);
});

test("same-user navigation releases the busy state, while a different session ignores old responses", async () => {
  for (const changeSession of [false, true]) {
    let resolve;
    const h = harness({ request: () => new Promise(done => { resolve = done; }) });
    const action = h.archive("complete-1"); h.dialogs[0].close("archive");
    await new Promise(done => setImmediate(done));
    h.state.context = { ...h.state.context };
    if (changeSession) { h.state.generation += 1; h.state.busy = false; }
    resolve({ uid: "complete-1", archived: true }); await action;
    assert.equal(h.state.busy, false);
    assert.equal(h.state.crmAccountInvites.length, changeSession ? 2 : 1);
  }
});
