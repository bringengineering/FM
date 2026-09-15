export type DriveRootMode = "appCreated" | "existingRoot";

export interface DriveOAuthConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  rootFolderId: string;
  rootMode: DriveRootMode;
}

export type DriveOAuthEnvironment = Readonly<Record<string, string | undefined>>;

const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/u;

function boundedSecret(value: unknown, maxBytes: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && value === value.trim()
    && Buffer.byteLength(value, "utf8") <= maxBytes
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

/**
 * Converts an injected environment map into the exact OAuth values required by
 * the future trigger adapter. It intentionally does not read process.env and
 * never includes a rejected value in its error message.
 */
export function readDriveOAuthConfig(
  environment: DriveOAuthEnvironment,
): DriveOAuthConfig {
  const clientId = environment.DRIVE_CLIENT_ID;
  const clientSecret = environment.DRIVE_CLIENT_SECRET;
  const refreshToken = environment.DRIVE_REFRESH_TOKEN;
  const rootFolderId = environment.DRIVE_ROOT_FOLDER_ID;
  const rootMode = environment.DRIVE_ROOT_MODE ?? "appCreated";
  if (
    !boundedSecret(clientId, 512)
    || !boundedSecret(clientSecret, 1_024)
    || !boundedSecret(refreshToken, 4_096)
    || typeof rootFolderId !== "string"
    || !DRIVE_ID_PATTERN.test(rootFolderId)
    || (rootMode !== "appCreated" && rootMode !== "existingRoot")
  ) {
    throw new Error("drive_oauth_config_invalid");
  }
  return { clientId, clientSecret, refreshToken, rootFolderId, rootMode };
}
