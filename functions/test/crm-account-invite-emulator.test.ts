import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cert, deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";

const PROJECT_ID = "demo-bring-fm-account-setup";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "";
const DATABASE_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || "";
const FUNCTIONS_HOST = process.env.CRM_ACCOUNT_SETUP_FUNCTIONS_EMULATOR_HOST || "127.0.0.1:5001";
const ENABLED = Boolean(AUTH_HOST && DATABASE_HOST);
const TEST_PASSWORD = "EmulatorOnly-Strong-2026!";

type EmulatorUser = { uid: string; email: string; idToken: string };
type AuthResponse = {
  localId: string;
  idToken: string;
  emailVerified?: boolean;
};

function emulatorUrl(host: string, pathname: string): URL {
  const url = new URL(`http://${host}${pathname}`);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)
    || !url.port || url.username || url.password) {
    throw new Error("CRM account setup emulator tests may use only loopback services.");
  }
  return url;
}

async function authRequest(method: string, body?: unknown): Promise<Record<string, unknown>> {
  const url = emulatorUrl(AUTH_HOST, `/identitytoolkit.googleapis.com/v1/${method}?key=demo-api-key`);
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined ? {} : {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`Auth emulator request failed (${method}, ${response.status}).`);
  return payload;
}

async function authEmulatorControlRequest(pathname: string): Promise<Record<string, unknown>> {
  const url = emulatorUrl(AUTH_HOST, pathname);
  const response = await fetch(url);
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`Auth emulator control request failed (${response.status}).`);
  return payload;
}

async function createPasswordUser(
  email: string,
  auth: ReturnType<typeof getAdminAuth>,
  { verified = true } = {},
): Promise<EmulatorUser> {
  const created = await authRequest("accounts:signUp", {
    email,
    password: TEST_PASSWORD,
    returnSecureToken: true,
  }) as unknown as AuthResponse;
  if (verified) {
    await auth.updateUser(created.localId, { emailVerified: true });
  }
  const signedIn = await authRequest("accounts:signInWithPassword", {
    email,
    password: TEST_PASSWORD,
    returnSecureToken: true,
  }) as unknown as AuthResponse;
  if (signedIn.localId !== created.localId || !signedIn.idToken) {
    throw new Error("Auth emulator did not return the expected password identity.");
  }
  return { uid: signedIn.localId, email, idToken: signedIn.idToken };
}

async function setCrmAccess(
  user: EmulatorUser,
  { role, enabled = true, mustChangePassword = false }: {
    role: "admin" | "member" | "viewer";
    enabled?: boolean;
    mustChangePassword?: boolean;
  },
): Promise<void> {
  const url = emulatorUrl(DATABASE_HOST, `/crmCompany/access/${encodeURIComponent(user.uid)}.json`);
  url.searchParams.set("ns", PROJECT_ID);
  url.searchParams.set("auth", "owner");
  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: user.email,
      role,
      enabled,
      mustChangePassword,
      officeAdmin: false,
    }),
  });
  if (!response.ok) throw new Error(`Database emulator seeding failed (${response.status}).`);
}

async function readCrmAccess(user: EmulatorUser): Promise<Record<string, unknown>> {
  const url = emulatorUrl(DATABASE_HOST, `/crmCompany/access/${encodeURIComponent(user.uid)}.json`);
  url.searchParams.set("ns", PROJECT_ID);
  url.searchParams.set("auth", "owner");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Database emulator access check failed (${response.status}).`);
  return await response.json() as Record<string, unknown>;
}

async function callFunction(name: string, data: Record<string, unknown>, idToken = "") {
  const url = emulatorUrl(FUNCTIONS_HOST, `/${PROJECT_ID}/asia-northeast3/${name}`);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ data }),
  });
  return { status: response.status, payload: await response.json() as Record<string, unknown> };
}

describe.runIf(ENABLED)("CRM account setup callable flow in isolated Firebase emulators", () => {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let admin: EmulatorUser;
  let member: EmulatorUser;
  let viewer: EmulatorUser;
  let disabledAdmin: EmulatorUser;
  let unverifiedAdmin: EmulatorUser;
  let passwordChangeAdmin: EmulatorUser;
  let customTokenAdmin = "";
  let adminApp: App | null = null;

  beforeAll(async () => {
    if (!PROJECT_ID.startsWith("demo-")) throw new Error("Emulator test project must use the demo- prefix.");
    const pair = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    adminApp = initializeApp({
      projectId: PROJECT_ID,
      credential: cert({
        projectId: PROJECT_ID,
        clientEmail: `firebase-adminsdk-emulator@${PROJECT_ID}.iam.gserviceaccount.com`,
        privateKey: pair.privateKey,
      }),
    }, `crm-account-setup-emulator-${unique}`);
    const emulatorAuth = getAdminAuth(adminApp);

    admin = await createPasswordUser(`admin-${unique}@bring.test`, emulatorAuth);
    member = await createPasswordUser(`member-${unique}@bring.test`, emulatorAuth);
    viewer = await createPasswordUser(`viewer-${unique}@bring.test`, emulatorAuth);
    disabledAdmin = await createPasswordUser(`disabled-${unique}@bring.test`, emulatorAuth);
    unverifiedAdmin = await createPasswordUser(`unverified-${unique}@bring.test`, emulatorAuth, { verified: false });
    passwordChangeAdmin = await createPasswordUser(`change-${unique}@bring.test`, emulatorAuth);

    await Promise.all([
      setCrmAccess(admin, { role: "admin" }),
      setCrmAccess(member, { role: "member" }),
      setCrmAccess(viewer, { role: "viewer" }),
      setCrmAccess(disabledAdmin, { role: "admin", enabled: false }),
      setCrmAccess(unverifiedAdmin, { role: "admin" }),
      setCrmAccess(passwordChangeAdmin, { role: "admin", mustChangePassword: true }),
    ]);

    const customToken = await emulatorAuth.createCustomToken(admin.uid);
    const customSignIn = await authRequest("accounts:signInWithCustomToken", {
      token: customToken,
      returnSecureToken: true,
    }) as unknown as AuthResponse;
    customTokenAdmin = customSignIn.idToken;
  }, 30_000);

  afterAll(async () => {
    if (adminApp) await deleteApp(adminApp);
  });

  it("denies anonymous, non-admin, disabled, unverified, wrong-provider, and must-change-password callers", async () => {
    const anonymous = await callFunction("registerCrmAccount", { email: `denied-${unique}@bring.test` });
    expect(anonymous.payload.error).toBeDefined();
    expect(["UNAUTHENTICATED", "PERMISSION_DENIED"]).toContain((anonymous.payload.error as { status?: string }).status);

    for (const user of [member, viewer, disabledAdmin, passwordChangeAdmin]) {
      const result = await callFunction("registerCrmAccount", { email: `denied-${unique}@bring.test` }, user.idToken);
      expect(result.payload.error).toBeDefined();
      expect(["UNAUTHENTICATED", "PERMISSION_DENIED"]).toContain((result.payload.error as { status?: string }).status);
    }

    for (const idToken of [unverifiedAdmin.idToken, customTokenAdmin]) {
      const result = await callFunction("registerCrmAccount", { email: `denied-${unique}@bring.test` }, idToken);
      expect(result.payload.error).toBeDefined();
      expect(["UNAUTHENTICATED", "PERMISSION_DENIED"]).toContain((result.payload.error as { status?: string }).status);
    }

    const invalidAnonymousCompletion = await callFunction("completeCrmAccountSetup", {
      email: `nobody-${unique}@bring.test`,
      password: "EmulatorOnly-Strong-2026!",
      oobCode: "invalid-oob-code",
    });
    expect(invalidAnonymousCompletion.payload.error).toBeDefined();
    expect((invalidAnonymousCompletion.payload.error as { status?: string }).status).toBe("FAILED_PRECONDITION");
  }, 30_000);

  it("lets only an admin send an email link that verifies the email and sets the first password", async () => {
    expect(admin.idToken.length).toBeGreaterThan(20);
    const adminClaims = JSON.parse(Buffer.from(admin.idToken.split(".")[1] || "", "base64url").toString("utf8")) as {
      email_verified?: unknown;
      firebase?: { sign_in_provider?: unknown };
    };
    expect(adminClaims.email_verified).toBe(true);
    expect(adminClaims.firebase?.sign_in_provider).toBe("password");
    expect(await readCrmAccess(admin)).toMatchObject({ enabled: true, role: "admin", mustChangePassword: false });
    const invitedEmail = `invite-${unique}@bring.test`;
    const registered = await callFunction("registerCrmAccount", { email: invitedEmail }, admin.idToken);
    const registrationError = registered.payload.error as { status?: unknown; message?: unknown } | undefined;
    expect(registered.status, `${String(registrationError?.status || "unknown")}: ${String(registrationError?.message || "")}`).toBe(200);
    expect(registered.payload.result).toMatchObject({ email: invitedEmail, status: "pending", emailSent: true });
    const registrationResult = registered.payload.result as { uid: string };

    const listed = await callFunction("listCrmAccountInvites", {}, admin.idToken);
    expect((listed.payload.result as { accounts: Array<{ uid: string; email: string; status: string }> }).accounts)
      .toContainEqual(expect.objectContaining({ uid: registrationResult.uid, email: invitedEmail, status: "pending" }));

    const codeResponse = await authEmulatorControlRequest(`/emulator/v1/projects/${PROJECT_ID}/oobCodes`) as {
      oobCodes?: Array<{ email: string; oobCode: string; requestType: string }>;
    };
    const actionCode = codeResponse.oobCodes?.find(code =>
      code.email === invitedEmail && code.requestType === "EMAIL_SIGNIN")?.oobCode;
    expect(actionCode).toBeTruthy();

    const password = "FirstPassword-OnlyInEmulator-2026!";
    const completed = await callFunction("completeCrmAccountSetup", {
      email: invitedEmail,
      password,
      oobCode: actionCode,
    });
    expect(completed.status).toBe(200);
    expect(completed.payload.result).toEqual({ ok: true });

    const login = await authRequest("accounts:signInWithPassword", {
      email: invitedEmail,
      password,
      returnSecureToken: true,
    }) as unknown as AuthResponse;
    const profile = await authRequest("accounts:lookup", { idToken: login.idToken }) as {
      users?: Array<{ emailVerified?: unknown }>;
    };
    expect(profile.users?.[0]?.emailVerified).toBe(true);

    const accessUrl = emulatorUrl(DATABASE_HOST, `/crmCompany/access/${encodeURIComponent(registrationResult.uid)}.json`);
    accessUrl.searchParams.set("ns", PROJECT_ID);
    accessUrl.searchParams.set("auth", "owner");
    const access = await fetch(accessUrl).then(response => response.json()) as Record<string, unknown>;
    expect(access).toMatchObject({ enabled: true, role: "member", accountSetupPending: false, mustChangePassword: false });
    expect(access).not.toHaveProperty("password");

    const inviteUrl = emulatorUrl(DATABASE_HOST, `/crmCompany/accountInvites/${encodeURIComponent(registrationResult.uid)}.json`);
    inviteUrl.searchParams.set("ns", PROJECT_ID);
    inviteUrl.searchParams.set("auth", "owner");
    const invite = await fetch(inviteUrl).then(response => response.json()) as Record<string, unknown>;
    expect(invite.status).toBe("complete");

    const replayed = await callFunction("completeCrmAccountSetup", {
      email: invitedEmail,
      password: "SecondPassword-OnlyInEmulator-2026!",
      oobCode: actionCode,
    });
    expect(replayed.payload.error).toBeDefined();
  }, 30_000);
});
