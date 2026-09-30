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

test("account setup page keeps one-time code in memory and submits only to the fixed setup endpoint", () => {
  const page = fs.readFileSync(path.join(root, "company-site/firebase-public/crm-account-setup/index.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "company-site/firebase-public/crm-account-setup/setup.js"), "utf8");
  const firebase = JSON.parse(fs.readFileSync(path.join(root, "firebase.json"), "utf8"));

  assert.match(page, /name="password" type="password"[^>]*autocomplete="new-password"/);
  assert.match(page, /이메일 인증 및 비밀번호 설정/);
  assert.match(page, /Firebase 인증에서 안전하게 관리됩니다/);
  assert.match(script, /history\.replaceState\(null, "", window\.location\.pathname\)/);
  assert.match(script, /credentials: "omit"/);
  assert.match(script, /redirect: "error"/);
  assert.match(script, /https:\/\/asia-northeast3-bring-fm\.cloudfunctions\.net\/completeCrmAccountSetup/);
  assert.doesNotMatch(script, /localStorage|sessionStorage/);

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
});
