import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_REDIRECT_URI,
  DEFAULT_ROOT_FOLDER_ID,
  APP_CREATED_ROOT_APP_PROPERTIES,
  DRIVE_FULL_SCOPE,
  DRIVE_FILE_SCOPE,
  EXISTING_ROOT_CONSENT_PHRASE,
  OAuthSetupError,
  formatFirebaseSecretInstructions,
  parseAuthorizationInput,
  runCli,
  runOAuthSetup,
} from "../scripts/google-drive-oauth.mjs";

function createSuccessfulFlow(overrides: {
  tokenResponse?: unknown;
  answers?: string[];
  rootFiles?: unknown[];
  createdRootId?: string;
} = {}) {
  const generateAuthUrl = vi.fn(() => "https://accounts.google.com/o/oauth2/v2/auth?safe=1");
  const getToken = vi.fn(async () => overrides.tokenResponse ?? ({
    tokens: {
      refresh_token: "refresh-token-visible-once",
      access_token: "access-token-must-never-print",
      id_token: "id-token-must-never-print",
    },
  }));
  const setCredentials = vi.fn();
  const createOAuthClient = vi.fn(() => ({ generateAuthUrl, getToken, setCredentials }));
  const list = vi.fn(async () => ({
    data: { files: overrides.rootFiles ?? [{ id: "app-root-existing" }] },
  }));
  const create = vi.fn(async () => ({
    data: { id: overrides.createdRootId ?? "app-root-created" },
  }));
  const createDriveClient = vi.fn(() => ({ files: { list, create } }));
  const answers = [...(overrides.answers ?? [
    "client-id.apps.googleusercontent.com",
    "client-secret-must-never-print",
    "",
    "http://127.0.0.1:53682/oauth2callback?code=authorization-code-must-never-print&state=fixed-state",
  ])];
  const askHidden = vi.fn(async () => answers.shift() ?? "");
  const lines: string[] = [];
  const writeLine = (line: string) => lines.push(line);

  return {
    askHidden,
    createOAuthClient,
    createDriveClient,
    create,
    generateAuthUrl,
    getToken,
    list,
    setCredentials,
    lines,
    writeLine,
  };
}

describe("Google Drive OAuth setup script", () => {
  it("defaults to appCreated mode and requests only drive.file with offline consent, state, and PKCE", async () => {
    const flow = createSuccessfulFlow();

    await runOAuthSetup({
      env: { DRIVE_ROOT_FOLDER_ID: DEFAULT_ROOT_FOLDER_ID },
      askHidden: flow.askHidden,
      writeLine: flow.writeLine,
      createOAuthClient: flow.createOAuthClient,
      createDriveClient: flow.createDriveClient,
      createPkce: () => ({
        state: "fixed-state",
        codeVerifier: "fixed-code-verifier",
        codeChallenge: "fixed-code-challenge",
      }),
    });

    expect(flow.createOAuthClient).toHaveBeenCalledWith(
      "client-id.apps.googleusercontent.com",
      "client-secret-must-never-print",
      DEFAULT_REDIRECT_URI,
    );
    expect(flow.generateAuthUrl).toHaveBeenCalledWith({
      access_type: "offline",
      prompt: "consent",
      scope: DRIVE_FILE_SCOPE,
      state: "fixed-state",
      code_challenge: "fixed-code-challenge",
      code_challenge_method: "S256",
    });
    expect(flow.getToken).toHaveBeenCalledWith({
      code: "authorization-code-must-never-print",
      codeVerifier: "fixed-code-verifier",
    });

    const output = flow.lines.join("\n");
    expect(output).toContain("https://accounts.google.com/o/oauth2/v2/auth?safe=1");
    expect(output.match(/refresh-token-visible-once/g)).toHaveLength(1);
    expect(output).not.toContain("access-token-must-never-print");
    expect(output).not.toContain("id-token-must-never-print");
    expect(output).not.toContain("client-secret-must-never-print");
    expect(output).not.toContain("authorization-code-must-never-print");
    expect(output).toContain("appCreated");
    expect(flow.setCredentials).toHaveBeenCalledWith(expect.objectContaining({
      refresh_token: "refresh-token-visible-once",
    }));
    expect(flow.list).toHaveBeenCalledWith({
      q: "mimeType = 'application/vnd.google-apps.folder' and trashed = false and appProperties has { key='bringRoot' and value='field-platform-v1' }",
      fields: "files(id,name,mimeType,trashed,appProperties)",
      pageSize: 2,
    });
    expect(flow.create).not.toHaveBeenCalled();
    expect(output).toContain("app-root-existing");
    expect(output).not.toContain(DEFAULT_ROOT_FOLDER_ID);
  });

  it("creates a dedicated tagged folder when appCreated mode has no reusable root", async () => {
    const flow = createSuccessfulFlow({ rootFiles: [], createdRootId: "app-root-created" });

    await runOAuthSetup({
      env: {},
      askHidden: flow.askHidden,
      writeLine: flow.writeLine,
      createOAuthClient: flow.createOAuthClient,
      createDriveClient: flow.createDriveClient,
      createPkce: () => ({
        state: "fixed-state",
        codeVerifier: "fixed-code-verifier",
        codeChallenge: "fixed-code-challenge",
      }),
    });

    expect(flow.create).toHaveBeenCalledWith({
      requestBody: {
        name: "BRING 광고 자료",
        mimeType: "application/vnd.google-apps.folder",
        appProperties: APP_CREATED_ROOT_APP_PROPERTIES,
      },
      fields: "id,name,mimeType,trashed,appProperties",
    });
    expect(flow.lines.join("\n")).toContain("app-root-created");
    expect(flow.lines.join("\n")).not.toContain(DEFAULT_ROOT_FOLDER_ID);
  });

  it("uses full Drive scope for an existing root only after the exact risk consent phrase", async () => {
    const flow = createSuccessfulFlow({
      answers: [
        "client-id.apps.googleusercontent.com",
        "client-secret-must-never-print",
        "",
        EXISTING_ROOT_CONSENT_PHRASE,
        "http://127.0.0.1:53682/oauth2callback?code=authorization-code-must-never-print&state=fixed-state",
      ],
    });

    await runOAuthSetup({
      env: {
        DRIVE_ROOT_MODE: "existingRoot",
        DRIVE_ROOT_FOLDER_ID: DEFAULT_ROOT_FOLDER_ID,
      },
      askHidden: flow.askHidden,
      writeLine: flow.writeLine,
      createOAuthClient: flow.createOAuthClient,
      createDriveClient: vi.fn(() => {
        throw new Error("existingRoot must not create or discover an app root");
      }),
      createPkce: () => ({
        state: "fixed-state",
        codeVerifier: "fixed-code-verifier",
        codeChallenge: "fixed-code-challenge",
      }),
    });

    expect(flow.generateAuthUrl).toHaveBeenCalledWith(expect.objectContaining({
      scope: DRIVE_FULL_SCOPE,
    }));
    expect(flow.lines.join("\n")).toContain("전체 Google Drive");
    expect(flow.lines.join("\n")).toContain(EXISTING_ROOT_CONSENT_PHRASE);
    expect(flow.lines.join("\n")).toContain(DEFAULT_ROOT_FOLDER_ID);
  });

  it("aborts existingRoot mode before authorization when the consent phrase is not exact", async () => {
    const flow = createSuccessfulFlow({
      answers: [
        "client-id.apps.googleusercontent.com",
        "client-secret-must-never-print",
        "",
        "동의합니다",
      ],
    });

    await expect(runOAuthSetup({
      env: {
        DRIVE_ROOT_MODE: "existingRoot",
        DRIVE_ROOT_FOLDER_ID: DEFAULT_ROOT_FOLDER_ID,
      },
      askHidden: flow.askHidden,
      writeLine: flow.writeLine,
      createOAuthClient: flow.createOAuthClient,
      createDriveClient: flow.createDriveClient,
      createPkce: () => ({
        state: "fixed-state",
        codeVerifier: "fixed-code-verifier",
        codeChallenge: "fixed-code-challenge",
      }),
    })).rejects.toMatchObject({ code: "existing_root_consent_required" });

    expect(flow.generateAuthUrl).not.toHaveBeenCalled();
    expect(flow.getToken).not.toHaveBeenCalled();
  });

  it("rejects an unknown root mode before requesting authorization", async () => {
    const flow = createSuccessfulFlow();

    await expect(runOAuthSetup({
      env: { DRIVE_ROOT_MODE: "unsafe-mode" },
      askHidden: flow.askHidden,
      writeLine: flow.writeLine,
      createOAuthClient: flow.createOAuthClient,
    })).rejects.toMatchObject({ code: "root_mode_invalid" });

    expect(flow.generateAuthUrl).not.toHaveBeenCalled();
    expect(flow.getToken).not.toHaveBeenCalled();
  });

  it("uses environment credentials and validates callback state", async () => {
    const flow = createSuccessfulFlow({
      answers: [
        "",
        "http://127.0.0.1:53682/oauth2callback?code=code-from-callback&state=fixed-state",
      ],
    });

    await runOAuthSetup({
      env: {
        GOOGLE_DRIVE_OAUTH_CLIENT_ID: "env-client-id",
        GOOGLE_DRIVE_OAUTH_CLIENT_SECRET: "env-client-secret",
      },
      askHidden: flow.askHidden,
      writeLine: flow.writeLine,
      createOAuthClient: flow.createOAuthClient,
      createDriveClient: flow.createDriveClient,
      createPkce: () => ({
        state: "fixed-state",
        codeVerifier: "fixed-code-verifier",
        codeChallenge: "fixed-code-challenge",
      }),
    });

    expect(flow.createOAuthClient).toHaveBeenCalledWith(
      "env-client-id",
      "env-client-secret",
      DEFAULT_REDIRECT_URI,
    );
    expect(flow.askHidden).toHaveBeenCalledTimes(2);
  });

  it("rejects empty input before exchanging a token", async () => {
    const flow = createSuccessfulFlow({ answers: ["", ""] });

    await expect(runOAuthSetup({
      env: {
        GOOGLE_DRIVE_OAUTH_CLIENT_ID: "env-client-id",
        GOOGLE_DRIVE_OAUTH_CLIENT_SECRET: "env-client-secret",
      },
      askHidden: flow.askHidden,
      writeLine: flow.writeLine,
      createOAuthClient: flow.createOAuthClient,
      createPkce: () => ({
        state: "fixed-state",
        codeVerifier: "fixed-code-verifier",
        codeChallenge: "fixed-code-challenge",
      }),
    })).rejects.toMatchObject({ code: "input_required" });

    expect(flow.getToken).not.toHaveBeenCalled();
  });

  it("rejects a callback with a mismatched state without leaking the code", () => {
    const sensitiveCode = "sensitive-authorization-code";

    expect(() => parseAuthorizationInput(
      `http://127.0.0.1:53682/oauth2callback?code=${sensitiveCode}&state=wrong-state`,
      "expected-state",
    )).toThrowError(new OAuthSetupError("state_mismatch"));

    try {
      parseAuthorizationInput(
        `http://127.0.0.1:53682/oauth2callback?code=${sensitiveCode}&state=wrong-state`,
        "expected-state",
      );
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(sensitiveCode);
    }
  });

  it("gives a safe re-consent error when Google omits refresh_token", async () => {
    const flow = createSuccessfulFlow({
      tokenResponse: {
        tokens: {
          access_token: "access-token-must-never-print",
          id_token: "id-token-must-never-print",
        },
      },
    });
    const errors: string[] = [];

    const exitCode = await runCli({
      env: {},
      askHidden: flow.askHidden,
      writeLine: flow.writeLine,
      writeError: (line: string) => errors.push(line),
      createOAuthClient: flow.createOAuthClient,
      createPkce: () => ({
        state: "fixed-state",
        codeVerifier: "fixed-code-verifier",
        codeChallenge: "fixed-code-challenge",
      }),
    });

    expect(exitCode).toBe(1);
    const output = [...flow.lines, ...errors].join("\n");
    expect(output).toContain("refresh token");
    expect(output).toContain("재동의");
    expect(output).not.toContain("access-token-must-never-print");
    expect(output).not.toContain("id-token-must-never-print");
  });

  it("maps raw OAuth and timeout failures to secret-free Korean messages", async () => {
    const oauthSecret = "oauth-error-secret-value";
    const oauthFlow = createSuccessfulFlow();
    oauthFlow.getToken.mockRejectedValueOnce(new Error(`401 invalid_grant ${oauthSecret}`));
    const oauthErrors: string[] = [];

    await expect(runCli({
      env: {},
      askHidden: oauthFlow.askHidden,
      writeLine: oauthFlow.writeLine,
      writeError: (line: string) => oauthErrors.push(line),
      createOAuthClient: oauthFlow.createOAuthClient,
      createPkce: () => ({
        state: "fixed-state",
        codeVerifier: "fixed-code-verifier",
        codeChallenge: "fixed-code-challenge",
      }),
    })).resolves.toBe(1);

    const timeoutErrors: string[] = [];
    await expect(runCli({
      env: {},
      askHidden: vi.fn(async () => {
        throw new OAuthSetupError("input_timeout");
      }),
      writeLine: vi.fn(),
      writeError: (line: string) => timeoutErrors.push(line),
      createOAuthClient: oauthFlow.createOAuthClient,
    })).resolves.toBe(1);

    expect(oauthErrors.join("\n")).not.toContain(oauthSecret);
    expect(oauthErrors.join("\n")).toContain("인증 코드 교환에 실패");
    expect(timeoutErrors.join("\n")).toContain("시간이 초과");
  });

  it("prints both root-mode secret commands and the resolved root ID without embedding OAuth secrets", () => {
    const resolvedRootFolderId = "app-root-created";
    const instructions = formatFirebaseSecretInstructions(resolvedRootFolderId);

    expect(instructions).toContain("firebase functions:secrets:set DRIVE_CLIENT_ID");
    expect(instructions).toContain("firebase functions:secrets:set DRIVE_CLIENT_SECRET");
    expect(instructions).toContain("firebase functions:secrets:set DRIVE_REFRESH_TOKEN");
    expect(instructions).toContain("firebase functions:secrets:set DRIVE_ROOT_FOLDER_ID");
    expect(instructions).toContain("firebase functions:secrets:set DRIVE_ROOT_MODE");
    expect(instructions).toContain("appCreated");
    expect(instructions).toContain("existingRoot");
    expect(instructions).toContain(resolvedRootFolderId);
    expect(instructions).not.toMatch(/secrets:set\s+DRIVE_[A-Z_]+=/);
    expect(instructions).not.toContain("echo ");
  });

  it("contains no direct access-token or id-token logging path", async () => {
    const scriptPath = fileURLToPath(new URL("../scripts/google-drive-oauth.mjs", import.meta.url));
    const source = await readFile(scriptPath, "utf8");

    expect(source).not.toContain("access_token");
    expect(source).not.toContain("id_token");
    expect(source).not.toMatch(/console\.(?:log|error)\s*\(\s*(?:tokens?|response|error)/);
    expect(source).not.toMatch(/--code(?:=|\s)/);
  });
});
