import { describe, expect, it } from "vitest";

import {
  readDriveOAuthConfig,
} from "../src/drive/google-auth.js";

const requiredEnvironment = {
  DRIVE_CLIENT_ID: "client-id.apps.googleusercontent.com",
  DRIVE_CLIENT_SECRET: "test-secret",
  DRIVE_REFRESH_TOKEN: "test-refresh-token",
  DRIVE_ROOT_FOLDER_ID: "root-1",
} as const;

describe("Drive OAuth root mode configuration", () => {
  it("uses the least-privilege appCreated mode when DRIVE_ROOT_MODE is omitted", () => {
    expect(readDriveOAuthConfig(requiredEnvironment)).toEqual({
      clientId: "client-id.apps.googleusercontent.com",
      clientSecret: "test-secret",
      refreshToken: "test-refresh-token",
      rootFolderId: "root-1",
      rootMode: "appCreated",
    });
  });

  it.each(["appCreated", "existingRoot"] as const)(
    "accepts the exact supported DRIVE_ROOT_MODE value %s",
    (rootMode) => {
      expect(readDriveOAuthConfig({
        ...requiredEnvironment,
        DRIVE_ROOT_MODE: rootMode,
      }).rootMode).toBe(rootMode);
    },
  );

  it.each([
    "",
    "appcreated",
    "existingroot",
    " existingRoot",
    "existingRoot ",
    "drive",
  ])("rejects malformed DRIVE_ROOT_MODE without echoing it: %j", (rootMode) => {
    let caught: unknown;
    try {
      readDriveOAuthConfig({
        ...requiredEnvironment,
        DRIVE_ROOT_MODE: rootMode,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("drive_oauth_config_invalid");
    expect(JSON.stringify(caught)).not.toContain(rootMode || "never-match-empty");
  });
});
