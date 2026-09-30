"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../..");
const setupCoreContext = { URL, Set, Object, String };
setupCoreContext.globalThis = setupCoreContext;
vm.runInNewContext(
  fs.readFileSync(path.join(root, "company-site/firebase-public/crm-account-setup/setup-core.js"), "utf8"),
  setupCoreContext,
);
const setupCore = setupCoreContext.BringCrmAccountSetup;

test("Firebase email-link setup accepts only trusted sign-in action links", () => {
  const direct = setupCore.parseSignInActionLink(
    "https://bring-fm.firebaseapp.com/__/auth/action?mode=signIn&oobCode=one-time-code-123",
  );
  assert.equal(direct && direct.mode, "signIn");
  assert.equal(direct && direct.actionCode, "one-time-code-123");

  const inner = "https://bring-fm.web.app/crm-account-setup/?mode=signIn&oobCode=one-time-code-456";
  const wrapped = `https://bring-fm.firebaseapp.com/__/auth/action?link=${encodeURIComponent(inner)}`;
  const nested = setupCore.parseSignInActionLink(wrapped);
  assert.equal(nested && nested.mode, "signIn");
  assert.equal(nested && nested.actionCode, "one-time-code-456");
});

test("Firebase email-link setup rejects reset links, untrusted hosts, insecure URLs, and oversized codes", () => {
  assert.equal(setupCore.parseSignInActionLink("https://bring-fm.web.app/?mode=resetPassword&oobCode=code-123"), null);
  assert.equal(setupCore.parseSignInActionLink("https://attacker.example/?mode=signIn&oobCode=code-123"), null);
  assert.equal(setupCore.parseSignInActionLink("https://user:pass@bring-fm.web.app/?mode=signIn&oobCode=code-123"), null);
  assert.equal(setupCore.parseSignInActionLink("https://bring-fm.web.app:8443/?mode=signIn&oobCode=code-123"), null);
  assert.equal(setupCore.parseSignInActionLink("http://bring-fm.web.app/?mode=signIn&oobCode=code-123"), null);
  assert.equal(setupCore.parseSignInActionLink(`https://bring-fm.web.app/?mode=signIn&oobCode=${"x".repeat(4097)}`), null);
});

test("account invitation IPC is classified and its server bridge enforces an admin role", async () => {
  const policy = require("../src/mutation-policy");
  const { FirebaseRemoteClient } = require("../src/remote");
  assert.equal(policy.classification("crm:account-invites-load"), "control");
  assert.equal(policy.classification("crm:account-invite-register"), "mutation");
  assert.equal(policy.classification("crm:account-invite-resend"), "mutation");

  const nonAdmin = { requireOfficeSession: () => ({ uid: "member-1", role: "member" }) };
  await assert.rejects(
    FirebaseRemoteClient.prototype.callCrmAccountSetupFunction.call(nonAdmin, "registerCrmAccount", { email: "x@example.com" }),
    error => error.code === "ACCESS_DENIED",
  );

  const adminSession = {
    requireOfficeSession: () => ({ uid: "admin-1", role: "admin" }),
    captureSessionGuard: () => ({}),
    ensureIdToken: async () => "admin-id-token",
    assertSessionGuardActive: () => true,
    fetch: async () => Response.json({ error: { status: "FAILED_PRECONDITION", message: "crm_account_email_link_not_enabled" } }, { status: 400 }),
  };
  await assert.rejects(
    FirebaseRemoteClient.prototype.callCrmAccountSetupFunction.call(adminSession, "resendCrmAccountInvite", { uid: "invite-1" }),
    error => error.code === "ACCOUNT_SETUP_EMAIL_LINK_DISABLED" && error.message.includes("이메일 링크 로그인이 꺼져"),
  );

  const rateLimitedAdmin = {
    ...adminSession,
    fetch: async () => Response.json({ error: { status: "RESOURCE_EXHAUSTED", message: "crm_account_setup_rate_limited" } }, { status: 429 }),
  };
  await assert.rejects(
    FirebaseRemoteClient.prototype.callCrmAccountSetupFunction.call(rateLimitedAdmin, "resendCrmAccountInvite", { uid: "invite-1" }),
    error => error.code === "ACCOUNT_SETUP_RATE_LIMITED" && error.message.includes("잠시 후"),
  );
});
