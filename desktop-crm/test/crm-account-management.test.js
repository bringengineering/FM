"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { FirebaseRemoteClient } = require("../src/remote");
const row = uid => ({ uid, email: `${uid}@example.com`, displayName: uid, role: "member", status: "active", canChangeRole: true, canDelete: true });

test("complete account listing follows pages and rejects duplicate/non-advancing responses", async () => {
  const calls = [];
  const client = { captureSessionGuard: () => ({}), assertSessionGuardActive() {}, callCrmAccountSetupFunction: async (name, input) => {
    calls.push({ name, input }); return input.cursor ? { accounts: [row("b")], nextCursor: "" } : { accounts: [row("a")], nextCursor: "a" };
  } };
  assert.deepEqual((await FirebaseRemoteClient.prototype.loadCrmAccounts.call(client)).map(account => account.uid), ["a", "b"]);
  assert.deepEqual(calls.map(call => call.input), [{}, { cursor: "a" }]);
  client.callCrmAccountSetupFunction = async () => ({ accounts: [row("a")], nextCursor: "a" });
  await assert.rejects(FirebaseRemoteClient.prototype.loadCrmAccounts.call(client));
});

test("member/viewer sessions cannot query or mutate accounts", async () => {
  for (const role of ["member", "viewer"]) for (const name of ["listCrmAccounts", "setCrmAccountRole", "deleteCrmAccount"]) {
    await assert.rejects(FirebaseRemoteClient.prototype.callCrmAccountSetupFunction.call({ requireOfficeSession: () => ({ role }) }, name, {}), error => error.code === "ACCESS_DENIED");
  }
});

test("account mutations require confirmation and the exact target/role acknowledgement", async () => {
  const calls = []; const client = { callCrmAccountSetupFunction: async (name, input) => { calls.push({ name, input }); return { uid: input.uid, role: input.role, updated: true, deleted: true }; } };
  await assert.rejects(FirebaseRemoteClient.prototype.manageCrmAccount.call(client, { uid: "member", expectedRole: "member" }, "delete"));
  await FirebaseRemoteClient.prototype.manageCrmAccount.call(client, { uid: "member", expectedRole: "member", confirmDelete: true }, "delete");
  assert.deepEqual(calls[0], { name: "deleteCrmAccount", input: { uid: "member", expectedRole: "member", confirmDelete: true } });
  client.callCrmAccountSetupFunction = async () => ({ uid: "other", deleted: true });
  await assert.rejects(FirebaseRemoteClient.prototype.manageCrmAccount.call(client, { uid: "member", expectedRole: "member", confirmDelete: true }, "delete"));
});

test("new account channels are classified and the screen exposes management instead of archive-only deletion", () => {
  const policy = require("../src/mutation-policy");
  assert.equal(policy.classification("crm:accounts-load"), "control");
  for (const channel of ["crm:account-role-save", "crm:account-delete"]) assert.equal(policy.classification(channel), "mutation");
  const source = fs.readFileSync(path.join(__dirname, "../src/office.js"), "utf8");
  const view = source.slice(source.indexOf("  function crmAccountSetupView()"), source.indexOf("  function dateBounds("));
  assert.match(view, /if \(!isCrmAdmin\(\)\)/);
  assert.match(view, /전체 등록 계정/); assert.match(view, /data-crm-account-role/); assert.match(view, /data-crm-account-delete/);
  assert.doesNotMatch(view, /data-crm-account-archive=/);
  assert.match(source, /loadCrmAccounts\(\)/);
});
