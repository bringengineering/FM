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
  const uid = "authUser_123";
  const setupToken = "A".repeat(43);
  const continueUrl = new URL("https://bring-fm.web.app/crm-account-setup/");
  continueUrl.searchParams.set("uid", uid);
  continueUrl.searchParams.set("invite", setupToken);
  const actionUrl = new URL("https://bring-fm.firebaseapp.com/__/auth/action");
  actionUrl.searchParams.set("mode", "signIn");
  actionUrl.searchParams.set("oobCode", "one-time-code-123");
  actionUrl.searchParams.set("continueUrl", continueUrl.href);
  const direct = setupCore.parseSignInActionLink(
    actionUrl.href,
  );
  assert.equal(direct && direct.mode, "signIn");
  assert.equal(direct && direct.actionCode, "one-time-code-123");
  assert.equal(direct && direct.uid, uid);
  assert.equal(direct && direct.setupToken, setupToken);

  const canonicalContinueUrl = new URL(continueUrl.href);
  canonicalContinueUrl.pathname = "/crm-account-setup";
  actionUrl.searchParams.set("continueUrl", canonicalContinueUrl.href);
  const canonical = setupCore.parseSignInActionLink(actionUrl.href);
  assert.equal(canonical && canonical.mode, "signIn");
  assert.equal(canonical && canonical.actionCode, "one-time-code-123");
  assert.equal(canonical && canonical.uid, uid);
  assert.equal(canonical && canonical.setupToken, setupToken);
  actionUrl.searchParams.set("continueUrl", continueUrl.href);

  const innerUrl = new URL("https://bring-fm.web.app/crm-account-setup/");
  innerUrl.searchParams.set("mode", "signIn");
  innerUrl.searchParams.set("oobCode", "one-time-code-456");
  innerUrl.searchParams.set("uid", uid);
  innerUrl.searchParams.set("invite", setupToken);
  const inner = innerUrl.href;
  const wrapped = `https://bring-fm.firebaseapp.com/__/auth/action?link=${encodeURIComponent(inner)}`;
  const nested = setupCore.parseSignInActionLink(wrapped);
  assert.equal(nested && nested.mode, "signIn");
  assert.equal(nested && nested.actionCode, "one-time-code-456");
  assert.equal(nested && nested.uid, uid);
  assert.equal(nested && nested.setupToken, setupToken);
});

test("Firebase email-link setup rejects reset links, untrusted hosts, insecure URLs, and oversized codes", () => {
  assert.equal(setupCore.parseSignInActionLink("https://bring-fm.web.app/?mode=resetPassword&oobCode=code-123"), null);
  assert.equal(setupCore.parseSignInActionLink("https://attacker.example/?mode=signIn&oobCode=code-123"), null);
  assert.equal(setupCore.parseSignInActionLink("https://user:pass@bring-fm.web.app/?mode=signIn&oobCode=code-123"), null);
  assert.equal(setupCore.parseSignInActionLink("https://bring-fm.web.app:8443/?mode=signIn&oobCode=code-123"), null);
  assert.equal(setupCore.parseSignInActionLink("http://bring-fm.web.app/?mode=signIn&oobCode=code-123"), null);
  assert.equal(setupCore.parseSignInActionLink(`https://bring-fm.web.app/?mode=signIn&oobCode=${"x".repeat(4097)}`), null);
});

test("account setup page requires a display name and keeps its invalid-link form hidden", () => {
  const sourcePage = fs.readFileSync(path.join(root, "company-site/public/crm-account-setup/index.html"), "utf8");
  const sourceScript = fs.readFileSync(path.join(root, "company-site/public/crm-account-setup/setup.js"), "utf8");
  const sourceStyle = fs.readFileSync(path.join(root, "company-site/public/crm-account-setup/setup.css"), "utf8");
  const exportedPage = fs.readFileSync(path.join(root, "company-site/firebase-public/crm-account-setup/index.html"), "utf8");
  const exportedScript = fs.readFileSync(path.join(root, "company-site/firebase-public/crm-account-setup/setup.js"), "utf8");
  const exportedStyle = fs.readFileSync(path.join(root, "company-site/firebase-public/crm-account-setup/setup.css"), "utf8");

  for (const page of [sourcePage, exportedPage]) {
    assert.match(page, /id="setupForm" hidden/);
    assert.match(page, /id="setupDisplayName" name="displayName" type="text" autocomplete="name" maxlength="80" required/);
    assert.match(page, /id="setupEmail" class="setup-email-value"/);
    assert.doesNotMatch(page, /<input[^>]+id="setupEmail"/);
    assert.match(page, /name="password" type="password"[^>]*autocomplete="new-password"/);
    assert.match(page, /이메일 인증 및 비밀번호 설정/);
    assert.match(page, /Firebase 인증에서 안전하게 관리됩니다/);
  }
  for (const script of [sourceScript, exportedScript]) {
    assert.match(script, /displayName: displayName\.value/);
    assert.match(script, /credentials: "omit"/);
    assert.match(script, /redirect: "error"/);
    assert.match(script, /history\.replaceState\(null, "", window\.location\.pathname\)/);
    assert.match(script, /FUNCTION_BASE = "https:\/\/asia-northeast3-bring-fm\.cloudfunctions\.net"/);
    assert.match(script, /callSetupFunction\("getCrmAccountSetupInvite"/);
    assert.match(script, /callSetupFunction\("completeCrmAccountSetup"/);
    assert.match(script, /params\.get\("link"\)\s*\|\|\s*params\.get\("deep_link_id"\)\s*\|\|\s*params\.get\("continueUrl"\)/);
    assert.match(script, /email\.textContent = invite\.maskedEmail/);
    assert.match(script, /uid: inviteUid/);
    assert.match(script, /setupToken: inviteToken/);
    assert.doesNotMatch(script, /email:\s*email\.value/);
    assert.doesNotMatch(script, /localStorage|sessionStorage/);
  }
  for (const style of [sourceStyle, exportedStyle]) assert.match(style, /#setupForm\[hidden\]\{display:none!important\}/);

  const firebase = JSON.parse(fs.readFileSync(path.join(root, "firebase.json"), "utf8"));
  const headers = firebase.hosting.headers.find(rule => rule.source === "/crm-account-setup/**");
  assert.ok(headers);
  assert.ok(headers.headers.some(header => header.key === "Cache-Control" && header.value.includes("no-store")));
  assert.ok(headers.headers.some(header => header.key === "Referrer-Policy" && header.value === "no-referrer"));
  assert.ok(headers.headers.some(header => header.key === "Content-Security-Policy" && header.value.includes("frame-ancestors 'none'")));
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
