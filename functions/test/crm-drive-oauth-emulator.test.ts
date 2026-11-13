import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cert, deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { handleCrmDriveOAuth, type DriveOAuthDependencies } from "../src/auth/crm-drive-oauth.js";

const PROJECT = "demo-bring-fm-drive-oauth";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "";
const DATABASE_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || "";
const clientId = "864976295990-test.apps.googleusercontent.com";
function url(host: string, path: string): URL {
  const result = new URL(`http://${host}${path}`);
  if (!["localhost", "127.0.0.1"].includes(result.hostname) || !result.port
    || result.username || result.password) throw new Error("Loopback emulator required");
  return result;
}
async function authPost(action: string, body: unknown) {
  const response = await fetch(url(AUTH_HOST, `/identitytoolkit.googleapis.com/v1/${action}?key=demo-api-key`), {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("Emulator authentication failed");
  return await response.json() as { idToken: string; localId: string };
}
async function database(uid: string, body?: unknown) {
  const target = url(DATABASE_HOST, `/crmCompany/access/${uid}.json`);
  target.searchParams.set("ns", PROJECT); target.searchParams.set("auth", "owner");
  const response = await fetch(target, body === undefined ? {} : {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("Emulator database request failed");
  return response.json();
}

describe.runIf(Boolean(AUTH_HOST && DATABASE_HOST))("Drive broker authorization with real Firebase emulators", () => {
  let app: App;
  let deps: DriveOAuthDependencies;
  beforeAll(() => {
    url(AUTH_HOST, "/"); url(DATABASE_HOST, "/");
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
    app = initializeApp({ projectId: PROJECT, credential: cert({ projectId: PROJECT,
      clientEmail: `emulator@${PROJECT}.iam.gserviceaccount.com`, privateKey: pair.privateKey }) }, "drive-oauth-emulator");
    deps = { verifyToken: token => getAuth(app).verifyIdToken(token, true), readAccess: database,
      rateLimit: async () => {}, config: () => ({ clientId, clientSecret: "test-only" }),
      fetchImpl: async () => { throw new Error("Real Google requests are forbidden in emulator tests"); } };
  });
  afterAll(async () => { if (app) await deleteApp(app); });
  const call = (token = "") => handleCrmDriveOAuth({ method: "POST", authorization: token ? `Bearer ${token}` : "",
    contentType: "application/json", ip: "127.0.0.1", rawBody: Buffer.from(JSON.stringify({ action: "check", clientId })) }, deps);

  it("denies anonymous and invalid tokens", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("invalid")).status).toBe(401);
  });
  it.each([
    { label: "admin", role: "admin", expected: 200 },
    { label: "member", role: "member", expected: 200 },
    { label: "viewer", role: "viewer", expected: 403 },
    { label: "disabled", role: "admin", enabled: false, expected: 403 },
    { label: "password-change", role: "admin", mustChangePassword: true, expected: 403 },
    { label: "unverified", role: "admin", verified: false, expected: 401 },
    { label: "wrong-provider", role: "admin", custom: true, expected: 401 },
    { label: "auth-disabled", role: "admin", authDisabled: true, expected: 401 },
  ])("verifies $label against canonical access and revocation", async scenario => {
    const email = `${scenario.label}-${Date.now()}@emulator.test`;
    const password = "EmulatorOnly-Test-2026!";
    const created = await authPost("accounts:signUp", { email, password, returnSecureToken: true });
    await getAuth(app).updateUser(created.localId, { emailVerified: scenario.verified !== false });
    const signedIn = await authPost("accounts:signInWithPassword", { email, password, returnSecureToken: true });
    await database(created.localId, { role: scenario.role, email, enabled: scenario.enabled !== false,
      mustChangePassword: scenario.mustChangePassword === true });
    let idToken = signedIn.idToken;
    if (scenario.custom) {
      const custom = await getAuth(app).createCustomToken(created.localId);
      idToken = (await authPost("accounts:signInWithCustomToken", { token: custom, returnSecureToken: true })).idToken;
    }
    if (scenario.authDisabled) await getAuth(app).updateUser(created.localId, { disabled: true });
    expect((await call(idToken)).status).toBe(scenario.expected);
  }, 15000);
});
