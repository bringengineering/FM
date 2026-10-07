#!/usr/bin/env node

// 현장앱 계정을 준비하는 1회성 도구입니다.
//
// provisionFieldUser 함수는 fieldPlatformAllowedEmails 에 등록된 이메일만 통과시키는데,
// 그 목록에 값을 넣는 경로가 코드 어디에도 없습니다(규칙상 클라이언트도 못 씁니다).
// 그래서 사람이 한 번 등록해 주어야 하고, 이 스크립트가 그 일을 합니다.
//
// 모드
//   allowlist  허용 목록만 등록합니다. 함수를 배포해서 쓰는 경우 이것만 하면 됩니다.
//   provision  허용 목록 + 커스텀 클레임 + fieldPlatform/users 레코드까지 직접 씁니다.
//              provisionFieldUser 가 하는 일과 같습니다. 함수를 배포하지 않고
//              v1 현장앱을 쓸 때 필요합니다.
//   revoke     접근 권한을 회수합니다(퇴사·기기 분실 등).
//
// 기본값은 --dry-run 입니다. 실제로 쓰려면 --yes 를 붙이세요.

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export const DEFAULT_DATABASE_URL =
  "https://bring-fm-default-rtdb.asia-southeast1.firebasedatabase.app";
export const DEFAULT_PROJECT_ID = "bring-fm";
export const FIELD_ROLES = Object.freeze(["admin", "staff", "reviewer"]);
export const MODES = Object.freeze(["allowlist", "provision", "revoke"]);
export const DEFAULT_MODE = "allowlist";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const MAX_EMAIL_LENGTH = 254;

export class FieldAccountSetupError extends Error {
  constructor(code) {
    super(code);
    this.name = "FieldAccountSetupError";
    this.code = code;
  }
}

// provision-field-user.ts 의 normalizeEmail/hashAllowedEmail 과 반드시 같은 결과여야 합니다.
// bootstrap-field-account.test.ts 가 두 구현을 맞대어 검사합니다.
export function normalizeEmail(email) {
  return String(email).trim().toLocaleLowerCase("en-US");
}

export function hashAllowedEmail(email) {
  return createHash("sha256").update(normalizeEmail(email)).digest("hex");
}

export function requireEmail(value) {
  const normalized = normalizeEmail(value ?? "");
  if (!normalized || normalized.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(normalized)) {
    throw new FieldAccountSetupError("email_invalid");
  }
  return normalized;
}

export function requireRole(value) {
  if (value === undefined) return "admin";
  if (!FIELD_ROLES.includes(value)) {
    throw new FieldAccountSetupError("role_invalid");
  }
  return value;
}

export function requireMode(value) {
  if (value === undefined) return DEFAULT_MODE;
  if (!MODES.includes(value)) {
    throw new FieldAccountSetupError("mode_invalid");
  }
  return value;
}

export function parseArgs(argv) {
  const flags = new Map();
  let confirmed = false;

  for (const raw of argv) {
    if (raw === "--yes") {
      confirmed = true;
      continue;
    }
    if (raw === "--dry-run") continue;
    if (!raw.startsWith("--")) {
      throw new FieldAccountSetupError("argument_unexpected");
    }
    const separator = raw.indexOf("=");
    if (separator < 0) {
      throw new FieldAccountSetupError("argument_unexpected");
    }
    const key = raw.slice(2, separator);
    if (flags.has(key)) {
      throw new FieldAccountSetupError("argument_duplicated");
    }
    flags.set(key, raw.slice(separator + 1));
  }

  const known = new Set(["email", "role", "mode", "database-url", "project"]);
  for (const key of flags.keys()) {
    if (!known.has(key)) {
      throw new FieldAccountSetupError("argument_unexpected");
    }
  }

  return {
    email: requireEmail(flags.get("email")),
    role: requireRole(flags.get("role")),
    mode: requireMode(flags.get("mode")),
    databaseURL: flags.get("database-url") ?? DEFAULT_DATABASE_URL,
    projectId: flags.get("project") ?? DEFAULT_PROJECT_ID,
    confirmed,
  };
}

// 무엇을 쓸지 먼저 값으로 만들어 둡니다. --dry-run 이 그대로 출력하고,
// 실제 실행도 이 계획만 따릅니다. 둘이 어긋날 수 없습니다.
export function buildPlan({ email, role, mode, uid }) {
  const hash = hashAllowedEmail(email);
  const allowlistPath = `fieldPlatformAllowedEmails/${hash}`;

  if (mode === "allowlist") {
    return {
      needsUid: false,
      writes: [{ path: allowlistPath, value: { active: true, role } }],
      claims: null,
    };
  }

  if (mode === "provision") {
    if (!uid) throw new FieldAccountSetupError("uid_required");
    return {
      needsUid: true,
      writes: [
        { path: allowlistPath, value: { active: true, role } },
        { path: `fieldPlatform/users/${uid}`, value: { role, enabled: true } },
      ],
      claims: { uid, value: { fieldPlatform: true, fieldRole: role } },
    };
  }

  if (!uid) throw new FieldAccountSetupError("uid_required");
  return {
    needsUid: true,
    writes: [
      { path: allowlistPath, value: { active: false, role } },
      { path: `fieldPlatform/users/${uid}`, value: { role, enabled: false } },
    ],
    // 클레임은 지웁니다. 토큰이 만료되기 전까지는 남으므로 아래 안내에서 재로그인을 요구합니다.
    claims: { uid, value: { fieldPlatform: null, fieldRole: null } },
  };
}

export function describePlan({ email, role, mode, plan, projectId }) {
  const lines = [
    `프로젝트   : ${projectId}`,
    `이메일     : ${email}`,
    `역할       : ${role}`,
    `모드       : ${mode}`,
    "",
    "다음 위치에 씁니다.",
  ];
  for (const write of plan.writes) {
    lines.push(`  ${write.path}`);
    lines.push(`      ${JSON.stringify(write.value)}`);
  }
  if (plan.claims) {
    lines.push(`  커스텀 클레임 (uid ${plan.claims.uid})`);
    lines.push(`      ${JSON.stringify(plan.claims.value)}`);
  }
  return lines.join("\n");
}

export async function runBootstrap(options) {
  const {
    email,
    role,
    mode,
    projectId,
    confirmed,
    lookupUid,
    setCustomClaims,
    write,
    verify,
    now = () => Date.now(),
    writeLine = (line) => process.stdout.write(`${line}\n`),
  } = options;

  if (confirmed && verify) {
    // 자격증명이 없으면 RTDB 클라이언트가 조용히 재시도만 반복합니다.
    // 쓰기 전에 토큰을 한 번 받아 보고, 안 되면 이유를 말해 줍니다.
    await verify();
  }

  const uid = mode === "allowlist" ? null : await lookupUid(email);
  if (mode !== "allowlist" && !uid) {
    // 구글 로그인을 한 번도 하지 않은 계정입니다. 계정이 있어야 클레임을 붙일 수 있습니다.
    throw new FieldAccountSetupError("auth_user_not_found");
  }

  const plan = buildPlan({ email, role, mode, uid });
  writeLine(describePlan({ email, role, mode, plan, projectId }));

  if (!confirmed) {
    writeLine("");
    writeLine("확인만 했습니다. 실제로 쓰려면 같은 명령에 --yes 를 붙이세요.");
    return { applied: false, plan };
  }

  const updatedAt = now();
  for (const entry of plan.writes) {
    await write(entry.path, { ...entry.value, updatedAt });
  }
  if (plan.claims) {
    await setCustomClaims(plan.claims.uid, plan.claims.value);
  }

  writeLine("");
  writeLine("완료했습니다.");
  if (mode === "provision") {
    writeLine("현장앱에서 로그아웃했다가 다시 로그인하면 새 권한이 적용됩니다.");
  }
  if (mode === "revoke") {
    writeLine("이미 발급된 토큰은 최대 1시간 남아 있습니다. 즉시 끊으려면");
    writeLine("Firebase 콘솔 > Authentication 에서 해당 계정을 사용 중지하세요.");
  }
  return { applied: true, plan };
}

function failureMessage(error) {
  const codes = {
    email_invalid: "이메일 주소가 올바르지 않습니다. --email=이름@example.com 형태로 적어 주세요.",
    role_invalid: `역할은 ${FIELD_ROLES.join(", ")} 중 하나여야 합니다.`,
    mode_invalid: `모드는 ${MODES.join(", ")} 중 하나여야 합니다.`,
    argument_unexpected: "알 수 없는 인자입니다. --email=... --role=... --mode=... 형태로 적어 주세요.",
    argument_duplicated: "같은 인자를 두 번 적었습니다.",
    uid_required: "계정을 찾지 못했습니다.",
    auth_user_not_found:
      "해당 이메일로 로그인한 기록이 없습니다. 현장앱에서 구글 로그인을 한 번 시도한 뒤 다시 실행해 주세요.",
    credentials_missing:
      "구글 자격증명을 찾지 못했습니다. gcloud auth application-default login 을 먼저 실행하거나, "
      + "GOOGLE_APPLICATION_CREDENTIALS 환경변수에 서비스 계정 키 경로를 지정해 주세요.",
  };
  if (error instanceof FieldAccountSetupError) {
    return codes[error.code] ?? error.code;
  }
  return "실패했습니다. 위 메시지를 확인해 주세요.";
}

async function createFirebaseDependencies({ projectId, databaseURL }) {
  let adminApp;
  let adminAuth;
  let adminDatabase;
  try {
    const [{ initializeApp, applicationDefault }, { getAuth }, { getDatabase }] = await Promise.all([
      import("firebase-admin/app"),
      import("firebase-admin/auth"),
      import("firebase-admin/database"),
    ]);
    adminApp = initializeApp({
      credential: applicationDefault(),
      projectId,
      databaseURL,
    });
    adminAuth = getAuth(adminApp);
    adminDatabase = getDatabase(adminApp);
  } catch {
    throw new FieldAccountSetupError("credentials_missing");
  }

  return {
    async verify() {
      try {
        const token = await adminApp.options.credential.getAccessToken();
        if (!token?.access_token) throw new Error("no token");
      } catch {
        throw new FieldAccountSetupError("credentials_missing");
      }
    },
    async dispose() {
      await adminDatabase.goOffline();
      await adminApp.delete();
    },
    async lookupUid(email) {
      try {
        const user = await adminAuth.getUserByEmail(email);
        return user.uid;
      } catch {
        return null;
      }
    },
    async setCustomClaims(uid, value) {
      const user = await adminAuth.getUser(uid);
      const merged = { ...user.customClaims, ...value };
      for (const [key, entry] of Object.entries(merged)) {
        if (entry === null) delete merged[key];
      }
      await adminAuth.setCustomUserClaims(uid, merged);
    },
    async write(path, value) {
      await adminDatabase.ref(path).update(value);
    },
  };
}

export async function runCli(options = {}) {
  const writeLine = options.writeLine ?? ((line) => process.stdout.write(`${line}\n`));
  const writeError = options.writeError ?? ((line) => process.stderr.write(`${line}\n`));
  try {
    const parsed = parseArgs(options.argv ?? process.argv.slice(2));
    const dependencies = options.dependencies
      ?? (await createFirebaseDependencies(parsed));
    try {
      await runBootstrap({ ...parsed, ...dependencies, writeLine });
    } finally {
      // 열린 RTDB 소켓이 남으면 프로세스가 끝나지 않습니다.
      await dependencies.dispose?.().catch(() => undefined);
    }
    return 0;
  } catch (error) {
    writeError(`오류: ${failureMessage(error)}`);
    return 1;
  }
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  process.exitCode = await runCli();
}
