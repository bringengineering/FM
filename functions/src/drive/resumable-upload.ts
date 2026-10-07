import { Buffer } from "node:buffer";

type UnknownRecord = Record<string, unknown>;

const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/u;
const MEDIA_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const GENERATION_PATTERN = /^[1-9][0-9]{0,30}$/u;
const MIME_TYPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/u;
const SESSION_URI_MAX_LENGTH = 2_048;
const SESSION_HOSTS = new Set(["www.googleapis.com", "content.googleapis.com"]);
const SESSION_PATH = "/upload/drive/v3/files";
const DRIVE_MEDIA_FIELDS =
  "id,name,mimeType,parents,trashed,size,md5Checksum,appProperties" as const;

export const MAX_DRIVE_UPLOAD_BYTES = 500 * 1024 * 1024;
export const DRIVE_RESUMABLE_CHUNK_BYTES = 8 * 1024 * 1024;
const DRIVE_CHUNK_ALIGNMENT_BYTES = 256 * 1024;

function safeError(code: string): Error {
  return new Error(code);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validSize(value: unknown): value is number {
  return Number.isSafeInteger(value)
    && (value as number) > 0
    && (value as number) <= MAX_DRIVE_UPLOAD_BYTES;
}

function validMimeType(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 128
    && MIME_TYPE_PATTERN.test(value);
}

function validName(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value === value.trim()
    && Buffer.byteLength(value, "utf8") <= 255
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validAccessToken(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 8_192
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

export interface DriveResumableStartInput {
  parentId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  appProperties: {
    bringMediaId: string;
    bringObjectGeneration: string;
  };
}

export interface DriveResumableSessionInput {
  sessionUri: string;
  totalSizeBytes: number;
}

export interface DriveResumableChunkInput extends DriveResumableSessionInput {
  mimeType: string;
  startOffset: number;
  endOffsetInclusive: number;
  body: unknown;
}

export type DriveResumableProgress =
  | { status: "active"; nextOffset: number }
  | { status: "complete"; file: UnknownRecord };

export interface DriveResumableUploadClient {
  start(input: DriveResumableStartInput): Promise<{
    sessionUri: string;
    nextOffset: 0;
  }>;
  probe(input: DriveResumableSessionInput): Promise<DriveResumableProgress>;
  uploadChunk(input: DriveResumableChunkInput): Promise<DriveResumableProgress>;
}

export interface DriveResumableFetchResponse {
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

export interface DriveResumableFetchInit {
  method: "POST" | "PUT";
  headers: Record<string, string>;
  body?: unknown;
  duplex?: "half";
}

export type DriveResumableFetch = (
  input: string,
  init: DriveResumableFetchInit,
) => Promise<DriveResumableFetchResponse>;

export interface DriveResumableUploadDependencies {
  getAccessToken(): Promise<unknown>;
  fetch: DriveResumableFetch;
}

function validateStartInput(
  input: DriveResumableStartInput,
): asserts input is DriveResumableStartInput {
  if (
    !isRecord(input)
    || !DRIVE_ID_PATTERN.test(input.parentId)
    || !validName(input.name)
    || !validMimeType(input.mimeType)
    || !validSize(input.sizeBytes)
    || !isRecord(input.appProperties)
    || !MEDIA_ID_PATTERN.test(input.appProperties.bringMediaId)
    || !GENERATION_PATTERN.test(input.appProperties.bringObjectGeneration)
    || Object.keys(input.appProperties).length !== 2
  ) {
    throw safeError("drive_upload_request_invalid");
  }
}

function validateSessionInput(
  input: DriveResumableSessionInput,
): asserts input is DriveResumableSessionInput {
  if (!isRecord(input) || !validSize(input.totalSizeBytes)) {
    throw safeError("drive_upload_request_invalid");
  }
  validateDriveResumableSessionUri(input.sessionUri);
}

function validateChunkInput(
  input: DriveResumableChunkInput,
): asserts input is DriveResumableChunkInput {
  validateSessionInput(input);
  const chunkLength = input.endOffsetInclusive - input.startOffset + 1;
  const isFinalChunk = input.endOffsetInclusive === input.totalSizeBytes - 1;
  if (
    !validMimeType(input.mimeType)
    || !Number.isSafeInteger(input.startOffset)
    || !Number.isSafeInteger(input.endOffsetInclusive)
    || input.startOffset < 0
    || input.endOffsetInclusive < input.startOffset
    || input.endOffsetInclusive >= input.totalSizeBytes
    || chunkLength > DRIVE_RESUMABLE_CHUNK_BYTES
    || input.startOffset % DRIVE_CHUNK_ALIGNMENT_BYTES !== 0
    || (!isFinalChunk && chunkLength % DRIVE_CHUNK_ALIGNMENT_BYTES !== 0)
    || input.body === undefined
    || input.body === null
  ) {
    throw safeError("drive_upload_request_invalid");
  }
}

export function validateDriveResumableSessionUri(value: unknown): string {
  if (typeof value !== "string" || value.length === 0
    || value.length > SESSION_URI_MAX_LENGTH) {
    throw safeError("drive_resumable_response_invalid");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw safeError("drive_resumable_response_invalid");
  }
  const uploadId = parsed.searchParams.get("upload_id");
  if (
    parsed.protocol !== "https:"
    || !SESSION_HOSTS.has(parsed.hostname)
    || parsed.port !== ""
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.pathname !== SESSION_PATH
    || parsed.hash !== ""
    || typeof uploadId !== "string"
    || uploadId.length === 0
    || uploadId.length > 1_024
    || /[\u0000-\u001f\u007f]/u.test(uploadId)
  ) {
    throw safeError("drive_resumable_response_invalid");
  }
  return value;
}

export function nextDriveUploadChunk(
  nextOffset: number,
  totalSizeBytes: number,
): { startOffset: number; endOffsetInclusive: number } {
  if (
    !validSize(totalSizeBytes)
    || !Number.isSafeInteger(nextOffset)
    || nextOffset < 0
    || nextOffset >= totalSizeBytes
  ) {
    throw safeError("drive_upload_request_invalid");
  }
  return {
    startOffset: nextOffset,
    endOffsetInclusive: Math.min(
      totalSizeBytes - 1,
      nextOffset + DRIVE_RESUMABLE_CHUNK_BYTES - 1,
    ),
  };
}

function initiationUrl(): string {
  const url = new URL("https://www.googleapis.com/upload/drive/v3/files");
  url.searchParams.set("uploadType", "resumable");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("fields", DRIVE_MEDIA_FIELDS);
  return url.toString();
}

async function accessToken(
  dependencies: DriveResumableUploadDependencies,
): Promise<string> {
  let value: unknown;
  try {
    value = await dependencies.getAccessToken();
  } catch {
    throw safeError("drive_oauth_token_failed");
  }
  if (!validAccessToken(value)) {
    throw safeError("drive_oauth_token_failed");
  }
  return value;
}

async function send(
  dependencies: DriveResumableUploadDependencies,
  input: string,
  init: DriveResumableFetchInit,
): Promise<DriveResumableFetchResponse> {
  try {
    return await dependencies.fetch(input, init);
  } catch {
    throw safeError("drive_upload_failed");
  }
}

async function completedFile(
  response: DriveResumableFetchResponse,
): Promise<UnknownRecord> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw safeError("drive_resumable_response_invalid");
  }
  if (!isRecord(value)) {
    throw safeError("drive_resumable_response_invalid");
  }
  return value;
}

function acknowledgedOffset(
  response: DriveResumableFetchResponse,
  totalSizeBytes: number,
): number {
  const range = response.headers.get("Range");
  if (range === null) return 0;
  const match = /^bytes=0-([0-9]{1,18})$/u.exec(range);
  if (match === null) {
    throw safeError("drive_resumable_response_invalid");
  }
  const lastByte = Number(match[1]);
  if (!Number.isSafeInteger(lastByte) || lastByte < 0
    || lastByte >= totalSizeBytes) {
    throw safeError("drive_resumable_response_invalid");
  }
  return lastByte + 1;
}

async function progressResponse(
  response: DriveResumableFetchResponse,
  totalSizeBytes: number,
): Promise<DriveResumableProgress> {
  if (response.status === 200 || response.status === 201) {
    return { status: "complete", file: await completedFile(response) };
  }
  if (response.status === 308) {
    return {
      status: "active",
      nextOffset: acknowledgedOffset(response, totalSizeBytes),
    };
  }
  if (response.status === 404 || response.status === 410) {
    throw safeError("drive_upload_session_expired");
  }
  throw safeError("drive_upload_failed");
}

export function createDriveResumableUploadClient(
  dependencies: DriveResumableUploadDependencies,
): DriveResumableUploadClient {
  return {
    async start(input) {
      validateStartInput(input);
      const token = await accessToken(dependencies);
      const response = await send(dependencies, initiationUrl(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Length": String(input.sizeBytes),
          "X-Upload-Content-Type": input.mimeType,
        },
        body: JSON.stringify({
          name: input.name,
          parents: [input.parentId],
          appProperties: { ...input.appProperties },
        }),
      });
      if (response.status !== 200 && response.status !== 201) {
        throw safeError("drive_upload_failed");
      }
      return {
        sessionUri: validateDriveResumableSessionUri(
          response.headers.get("Location"),
        ),
        nextOffset: 0,
      };
    },
    async probe(input) {
      validateSessionInput(input);
      const token = await accessToken(dependencies);
      const response = await send(dependencies, input.sessionUri, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Length": "0",
          "Content-Range": `bytes */${input.totalSizeBytes}`,
        },
      });
      return progressResponse(response, input.totalSizeBytes);
    },
    async uploadChunk(input) {
      validateChunkInput(input);
      const token = await accessToken(dependencies);
      const response = await send(dependencies, input.sessionUri, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Length": String(
            input.endOffsetInclusive - input.startOffset + 1,
          ),
          "Content-Range": `bytes ${input.startOffset}-${
            input.endOffsetInclusive
          }/${input.totalSizeBytes}`,
          "Content-Type": input.mimeType,
        },
        body: input.body,
        duplex: "half",
      });
      const result = await progressResponse(response, input.totalSizeBytes);
      if (
        result.status === "active"
        && (result.nextOffset <= input.startOffset
          || result.nextOffset > input.endOffsetInclusive + 1)
      ) {
        throw safeError("drive_resumable_response_invalid");
      }
      return result;
    },
  };
}
