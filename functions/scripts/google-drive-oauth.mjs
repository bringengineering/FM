#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

import { google } from "googleapis";

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const DRIVE_FULL_SCOPE = "https://www.googleapis.com/auth/drive";
export const DEFAULT_ROOT_MODE = "appCreated";
export const APP_CREATED_ROOT_APP_PROPERTIES = Object.freeze({
  bringRoot: "field-platform-v1",
});
export const EXISTING_ROOT_CONSENT_PHRASE =
  "기존 폴더 사용을 위해 Google Drive 전체 접근 권한 요청에 동의합니다";
export const DEFAULT_REDIRECT_URI = "http://127.0.0.1:53682/oauth2callback";
export const DEFAULT_ROOT_FOLDER_ID = "1A7JZQLNkuSWMrpAbVcse6EoUeUAKoN3S";

const DEFAULT_INPUT_TIMEOUT_MS = 5 * 60 * 1_000;
const MAX_INPUT_LENGTH = 8_192;
const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/u;
const APP_CREATED_ROOT_FIELDS = "id,name,mimeType,trashed,appProperties";
const APP_CREATED_ROOT_QUERY =
  "mimeType = 'application/vnd.google-apps.folder' and trashed = false and appProperties has { key='bringRoot' and value='field-platform-v1' }";

export class OAuthSetupError extends Error {
  constructor(code) {
    super(code);
    this.name = "OAuthSetupError";
    this.code = code;
  }
}

function requireInput(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > MAX_INPUT_LENGTH) {
    throw new OAuthSetupError("input_required");
  }
  return normalized;
}

function validateRedirectUri(value) {
  const normalized = requireInput(value);
  try {
    const redirect = new URL(normalized);
    if (redirect.protocol !== "https:" && redirect.protocol !== "http:") {
      throw new Error("unsupported protocol");
    }
    return redirect.toString();
  } catch {
    throw new OAuthSetupError("redirect_uri_invalid");
  }
}

function requireDriveId(value) {
  if (typeof value !== "string" || !DRIVE_ID_PATTERN.test(value)) {
    throw new OAuthSetupError("drive_root_setup_failed");
  }
  return value;
}

export function parseDriveRootMode(value) {
  if (value === undefined) return DEFAULT_ROOT_MODE;
  if (value === "appCreated" || value === "existingRoot") return value;
  throw new OAuthSetupError("root_mode_invalid");
}

export function createPkceValues() {
  const codeVerifier = randomBytes(64).toString("base64url");
  return {
    state: randomBytes(32).toString("base64url"),
    codeVerifier,
    codeChallenge: createHash("sha256").update(codeVerifier).digest("base64url"),
  };
}

export function parseAuthorizationInput(input, expectedState) {
  const normalized = requireInput(input);

  if (!/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  let callback;
  try {
    callback = new URL(normalized);
  } catch {
    throw new OAuthSetupError("authorization_input_invalid");
  }

  if (callback.searchParams.has("error")) {
    throw new OAuthSetupError("authorization_denied");
  }

  if (callback.searchParams.get("state") !== expectedState) {
    throw new OAuthSetupError("state_mismatch");
  }

  return requireInput(callback.searchParams.get("code"));
}

export function formatFirebaseSecretInstructions(rootFolderId = DEFAULT_ROOT_FOLDER_ID) {
  const safeRootFolderId = requireDriveId(rootFolderId);
  return [
    "",
    "Firebase Functions 시크릿 등록 안내",
    "아래 명령을 하나씩 실행한 뒤, Firebase가 표시하는 입력 창에 값을 붙여넣으세요.",
    "시크릿 값을 명령어 인수로 붙이거나 echo로 연결하지 마세요. 쉘 기록에 남을 수 있습니다.",
    "",
    "firebase functions:secrets:set DRIVE_CLIENT_ID",
    "firebase functions:secrets:set DRIVE_CLIENT_SECRET",
    "firebase functions:secrets:set DRIVE_REFRESH_TOKEN",
    "firebase functions:secrets:set DRIVE_ROOT_FOLDER_ID",
    "firebase functions:secrets:set DRIVE_ROOT_MODE",
    "",
    "DRIVE_ROOT_MODE에는 appCreated 또는 existingRoot 중 하나를 입력하세요.",
    `DRIVE_ROOT_FOLDER_ID 입력값: ${safeRootFolderId}`,
  ].join("\n");
}

function safeFailureMessage(error) {
  const code = error instanceof OAuthSetupError ? error.code : "setup_failed";
  const messages = {
    input_required: "필수 입력값이 비어 있거나 올바르지 않아 설정을 중단했습니다.",
    input_timeout: "입력 대기 시간이 초과되어 설정을 중단했습니다. 스크립트를 다시 실행해 주세요.",
    input_cancelled: "입력이 취소되어 설정을 중단했습니다.",
    root_mode_invalid: "DRIVE_ROOT_MODE는 appCreated 또는 existingRoot만 사용할 수 있어 설정을 중단했습니다.",
    existing_root_consent_required: "기존 Google Drive 폴더 사용에 필요한 전체 접근 권한 동의 문구가 일치하지 않아 설정을 중단했습니다.",
    drive_root_setup_failed: "앱 전용 Google Drive 루트 폴더를 확인하거나 생성하지 못해 설정을 중단했습니다.",
    redirect_uri_invalid: "Redirect URI가 올바른 http(s) 주소가 아닙니다.",
    authorization_input_invalid: "Google 인증 결과 입력을 확인할 수 없습니다. code 값 또는 전체 callback URL을 다시 입력해 주세요.",
    authorization_denied: "Google 권한 동의가 취소되거나 거부되었습니다.",
    state_mismatch: "OAuth state 검증에 실패했습니다. 현재 실행에서 새로 생성된 권한 URL로 다시 시도해 주세요.",
    token_exchange_failed: "Google 인증 코드 교환에 실패했습니다. 코드가 만료되었거나 Redirect URI가 다를 수 있으니 새 권한 URL로 다시 시도해 주세요.",
    refresh_token_missing: "Google이 refresh token을 발급하지 않았습니다. Google 계정의 앱 권한을 철회한 뒤 스크립트를 다시 실행하고, 재동의 화면에서 허용해 주세요.",
    setup_failed: "Google Drive OAuth 설정에 실패했습니다. 민감한 정보 보호를 위해 상세 응답은 표시하지 않습니다.",
  };
  return messages[code] ?? messages.setup_failed;
}

export async function promptHidden(
  prompt,
  {
    input = process.stdin,
    output = process.stdout,
    timeoutMs = DEFAULT_INPUT_TIMEOUT_MS,
  } = {},
) {
  output.write(`${prompt} (입력 내용은 화면에 표시되지 않습니다): `);

  if (!input.isTTY || typeof input.setRawMode !== "function") {
    const reader = createInterface({ input, terminal: false });
    return await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reader.close();
        callback();
      };
      const timer = setTimeout(() => {
        finish(() => reject(new OAuthSetupError("input_timeout")));
      }, timeoutMs);
      reader.once("line", (line) => finish(() => resolve(line)));
      reader.once("close", () => finish(() => resolve("")));
    });
  }

  return await new Promise((resolve, reject) => {
    let value = "";
    const wasRaw = Boolean(input.isRaw);
    const finish = (callback) => {
      clearTimeout(timer);
      input.off("data", onData);
      input.setRawMode(wasRaw);
      output.write("\n");
      callback();
    };
    const onData = (chunk) => {
      const text = String(chunk);
      for (const character of text) {
        if (character === "\u0003") {
          finish(() => reject(new OAuthSetupError("input_cancelled")));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish(() => resolve(value));
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= " " && value.length < MAX_INPUT_LENGTH) {
          value += character;
        }
      }
    };
    const timer = setTimeout(() => {
      finish(() => reject(new OAuthSetupError("input_timeout")));
    }, timeoutMs);

    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

function defaultCreateOAuthClient(clientId, clientSecret, redirectUri) {
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function defaultCreateDriveClient(oauth2Client) {
  return google.drive({ version: "v3", auth: oauth2Client });
}

async function ensureAppCreatedRoot(oauth2Client, tokens, createDriveClient) {
  oauth2Client.setCredentials(tokens);
  const drive = createDriveClient(oauth2Client);
  try {
    const result = await drive.files.list({
      q: APP_CREATED_ROOT_QUERY,
      fields: `files(${APP_CREATED_ROOT_FIELDS})`,
      pageSize: 2,
    });
    const files = Array.isArray(result?.data?.files) ? result.data.files : [];
    if (files.length > 1) {
      throw new OAuthSetupError("drive_root_setup_failed");
    }
    if (files.length === 1) {
      return requireDriveId(files[0]?.id);
    }

    const created = await drive.files.create({
      requestBody: {
        name: "BRING 광고 자료",
        mimeType: DRIVE_FOLDER_MIME_TYPE,
        appProperties: APP_CREATED_ROOT_APP_PROPERTIES,
      },
      fields: APP_CREATED_ROOT_FIELDS,
    });
    return requireDriveId(created?.data?.id);
  } catch (error) {
    if (error instanceof OAuthSetupError) throw error;
    throw new OAuthSetupError("drive_root_setup_failed");
  }
}

export async function runOAuthSetup({
  env = process.env,
  askHidden = promptHidden,
  writeLine = (line) => process.stdout.write(`${line}\n`),
  createOAuthClient = defaultCreateOAuthClient,
  createDriveClient = defaultCreateDriveClient,
  createPkce = createPkceValues,
} = {}) {
  writeLine("BRING Google Drive OAuth 1회 설정을 시작합니다.");
  writeLine("민감한 입력값과 토큰은 최종 refresh token 1회 표시를 제외하고 기록하지 않습니다.");

  const rootMode = parseDriveRootMode(env.DRIVE_ROOT_MODE);
  const providedRootFolderId = rootMode === "existingRoot"
    ? requireDriveId(env.DRIVE_ROOT_FOLDER_ID)
    : undefined;

  const clientId = requireInput(
    env.GOOGLE_DRIVE_OAUTH_CLIENT_ID
      ?? await askHidden("Google OAuth Client ID를 입력하세요"),
  );
  const clientSecret = requireInput(
    env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET
      ?? await askHidden("Google OAuth Client Secret을 입력하세요"),
  );

  const redirectInput = env.GOOGLE_DRIVE_OAUTH_REDIRECT_URI
    ?? await askHidden(
      `Redirect URI를 입력하세요. Enter를 누르면 기본값 ${DEFAULT_REDIRECT_URI}`,
    );
  const redirectUri = validateRedirectUri(redirectInput?.trim() || DEFAULT_REDIRECT_URI);

  let scope = DRIVE_FILE_SCOPE;
  if (rootMode === "existingRoot") {
    writeLine("");
    writeLine("위험 경고: existingRoot 모드는 사용자가 제공한 기존 폴더를 사용하기 위해 전체 Google Drive 접근 권한을 요청합니다.");
    writeLine("이 권한은 선택한 폴더뿐 아니라 해당 계정의 다른 Drive 파일에도 접근할 수 있습니다.");
    writeLine(`계속하려면 아래 문구를 정확히 입력하세요: ${EXISTING_ROOT_CONSENT_PHRASE}`);
    const consent = await askHidden("위험 동의 문구를 입력하세요");
    if (consent !== EXISTING_ROOT_CONSENT_PHRASE) {
      throw new OAuthSetupError("existing_root_consent_required");
    }
    scope = DRIVE_FULL_SCOPE;
  } else {
    writeLine("권한 모드: appCreated (앱이 생성한 파일과 폴더만 접근)");
  }

  const oauth2Client = createOAuthClient(clientId, clientSecret, redirectUri);
  const { state, codeVerifier, codeChallenge } = createPkce();
  const authorizationUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  writeLine("");
  writeLine("1. Google Cloud Console OAuth 클라이언트에 아래 Redirect URI가 등록되어 있는지 확인하세요.");
  writeLine(`   ${redirectUri}`);
  writeLine("2. 아래 권한 URL을 브라우저에서 열고 회사 Google 계정으로 동의하세요.");
  writeLine(authorizationUrl);
  writeLine("3. localhost 페이지가 열리지 않아도 정상입니다. 주소창의 전체 callback URL(권장) 또는 code 값을 복사하세요.");

  const authorizationInput = await askHidden("Google callback URL 또는 code 값을 입력하세요");
  const code = parseAuthorizationInput(authorizationInput, state);

  let tokenResult;
  try {
    tokenResult = await oauth2Client.getToken({ code, codeVerifier });
  } catch {
    throw new OAuthSetupError("token_exchange_failed");
  }

  const refreshToken = tokenResult?.tokens?.refresh_token;
  if (typeof refreshToken !== "string" || !refreshToken.trim()) {
    throw new OAuthSetupError("refresh_token_missing");
  }

  const rootFolderId = rootMode === "appCreated"
    ? await ensureAppCreatedRoot(oauth2Client, tokenResult.tokens, createDriveClient)
    : providedRootFolderId;

  writeLine("");
  writeLine("아래 refresh token은 지금 1회만 표시합니다. 공유된 문서나 채팅에 붙이지 마세요.");
  writeLine(`DRIVE_REFRESH_TOKEN: ${refreshToken.trim()}`);
  writeLine(formatFirebaseSecretInstructions(rootFolderId));
}

export async function runCli(options = {}) {
  const writeError = options.writeError
    ?? ((line) => process.stderr.write(`${line}\n`));
  try {
    await runOAuthSetup(options);
    return 0;
  } catch (error) {
    writeError(`오류: ${safeFailureMessage(error)}`);
    return 1;
  }
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  process.exitCode = await runCli();
}
