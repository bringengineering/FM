import { Buffer } from "node:buffer";

export interface FieldMediaAccessDependencies {
  isEnabled(uid: string): Promise<boolean>;
  readMedia(mediaId: string): Promise<unknown | null>;
  isAssigned(buildingId: string, uid: string): Promise<boolean>;
  signReadUrl(path: string, expiresAt: number): Promise<string>;
  nowMs(): number;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value === value.trim()
    && Buffer.byteLength(value, "utf8") <= 128
    && value !== "."
    && value !== ".."
    && !/[\\/.#$\[\]\u0000-\u001f\u007f]/u.test(value);
}

function validFinalizedPath(
  value: unknown,
  buildingId: string,
  mediaId: string,
): value is string {
  if (typeof value !== "string") return false;
  const segments = value.split("/");
  if (
    segments.length !== 3
    || segments[0] !== "field-media-finalized"
    || segments[1] !== buildingId
  ) {
    return false;
  }
  const match = /^(.+)\.([a-z0-9]+)$/.exec(segments[2] ?? "");
  return Boolean(
    match
    && match[1] === mediaId
    && new Set(["jpg", "png", "webp", "heic", "heif", "mp4", "mov", "webm"])
      .has(match[2]),
  );
}

function forbidden(): never {
  throw new Error("field_media_access_forbidden");
}

export async function getFieldMediaAccessCore(
  input: { mediaId: string },
  actor: { uid: string; role: "admin" | "staff" | "reviewer" },
  dependencies: FieldMediaAccessDependencies,
): Promise<{ url: string; expiresAt: string }> {
  if (!isRecord(input) || !isSafeId(input.mediaId)) {
    throw new Error("field_media_access_invalid");
  }
  if (
    !isRecord(actor)
    || !isSafeId(actor.uid)
    || !["admin", "staff", "reviewer"].includes(actor.role)
    || await dependencies.isEnabled(actor.uid) !== true
  ) {
    forbidden();
  }
  const media = await dependencies.readMedia(input.mediaId);
  if (!isRecord(media) || media.id !== input.mediaId) {
    throw new Error("field_media_not_found");
  }
  if (media.uploadState !== "finalized") {
    throw new Error("field_media_not_finalized");
  }
  if (!isSafeId(media.buildingId)) {
    throw new Error("field_media_path_invalid");
  }
  if (!validFinalizedPath(media.storagePath, media.buildingId, input.mediaId)) {
    throw new Error("field_media_path_invalid");
  }
  if (
    actor.role === "staff"
    && await dependencies.isAssigned(media.buildingId, actor.uid) !== true
  ) {
    forbidden();
  }
  const nowMs = dependencies.nowMs();
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error("field_media_access_state_invalid");
  }
  const expiresAtMs = nowMs + 300_000;
  if (!Number.isSafeInteger(expiresAtMs)) {
    throw new Error("field_media_access_state_invalid");
  }
  const url = await dependencies.signReadUrl(media.storagePath, expiresAtMs);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("field_media_access_state_invalid");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("field_media_access_state_invalid");
  }
  return {
    url,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}
