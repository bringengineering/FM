import { Buffer } from "node:buffer";

import { google } from "googleapis";

import type { DriveOAuthConfig, DriveRootMode } from "./google-auth.js";
import { DRIVE_FOLDER_MIME_TYPE } from "./folders.js";
import type {
  DriveFolderCreateRequest,
  DriveFolderListRequest,
} from "./folders.js";
import {
  MAX_DRIVE_UPLOAD_BYTES,
  createDriveResumableUploadClient,
  type DriveResumableChunkInput,
  type DriveResumableProgress,
  type DriveResumableSessionInput,
  type DriveResumableStartInput,
  type DriveResumableUploadClient,
} from "./resumable-upload.js";
import type {
  DriveMediaAdapter,
  DriveMediaFileListRequest,
  DriveMediaUploadRequest,
  FinalizedMediaStorageAdapter,
} from "./sync-media.js";
import type {
  AdPackageArtifactListRequest,
  AdPackageDriveAdapter,
  AdPackageMediaCopyRequest,
  AdPackageTextUploadRequest,
} from "../packages/generate-ad-package.js";

type UnknownRecord = Record<string, unknown>;

const GENERATION_PATTERN = /^[1-9][0-9]{0,30}$/u;
const STORAGE_PATH_PATTERN = /^field-media-finalized\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}\.[a-z0-9]{1,10}$/u;
const CANONICAL_SIZE_PATTERN = /^(?:0|[1-9][0-9]{0,18})$/u;
const MD5_HEX_PATTERN = /^[a-f0-9]{32}$/u;

const FOLDER_FIELDS = "files(id,name,mimeType,parents,trashed)" as const;
const MEDIA_FIELDS =
  "files(id,name,mimeType,parents,trashed,size,md5Checksum,appProperties)" as const;
const CREATED_FOLDER_FIELDS = "id,name,mimeType,parents,trashed" as const;

export const DRIVE_FILE_SCOPE =
  "https://www.googleapis.com/auth/drive.file" as const;
export const DRIVE_FULL_SCOPE =
  "https://www.googleapis.com/auth/drive" as const;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeInternalError(code: string): Error {
  return new Error(code);
}

export function base64Md5ToHex(value: unknown): string {
  if (typeof value !== "string" || value.length > 64) {
    throw safeInternalError("drive_source_invalid");
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(value, "base64");
  } catch {
    throw safeInternalError("drive_source_invalid");
  }
  if (bytes.length !== 16 || bytes.toString("base64") !== value) {
    throw safeInternalError("drive_source_invalid");
  }
  return bytes.toString("hex");
}

export interface GenerationPinnedStorageFileLike {
  getMetadata(): Promise<[unknown]>;
  createReadStream(options:
    | { validation: "md5" }
    | { validation: false; start: number; end: number }): unknown;
}

export interface FinalizedMediaBucketLike {
  file(
    path: string,
    options: { generation: string },
  ): GenerationPinnedStorageFileLike;
}

function safeStorageMetadata(
  value: unknown,
  expectedPath: string,
  expectedGeneration: string,
): {
  sizeBytes: number;
  mimeType: string;
  md5Hash: string;
  crc32c?: string;
} {
  if (
    !isRecord(value)
    || value.name !== expectedPath
    || value.generation !== expectedGeneration
    || typeof value.size !== "string"
    || !CANONICAL_SIZE_PATTERN.test(value.size)
    || !Number.isSafeInteger(Number(value.size))
    || Number(value.size) <= 0
    || Number(value.size) > MAX_DRIVE_UPLOAD_BYTES
    || typeof value.contentType !== "string"
    || value.contentType.length < 3
    || value.contentType.length > 128
    || typeof value.md5Hash !== "string"
    || (value.crc32c !== undefined
      && (typeof value.crc32c !== "string" || value.crc32c.length > 128))
  ) {
    throw safeInternalError("drive_source_invalid");
  }
  return {
    sizeBytes: Number(value.size),
    mimeType: value.contentType,
    md5Hash: base64Md5ToHex(value.md5Hash),
    ...(value.crc32c === undefined ? {} : { crc32c: value.crc32c }),
  };
}

export interface RangedFinalizedMediaStorageAdapter
  extends FinalizedMediaStorageAdapter {
  readFinalizedObjectMetadata(input: {
    path: string;
    expectedGeneration: string;
  }): Promise<unknown>;
  readFinalizedObjectRange(input: {
    path: string;
    expectedGeneration: string;
    startOffset: number;
    endOffsetInclusive: number;
  }): Promise<unknown>;
}

function validateStorageIdentity(path: string, expectedGeneration: string): void {
  if (
    !STORAGE_PATH_PATTERN.test(path)
    || !GENERATION_PATTERN.test(expectedGeneration)
  ) {
    throw safeInternalError("drive_source_invalid");
  }
}

async function pinnedObject(
  bucket: FinalizedMediaBucketLike,
  path: string,
  expectedGeneration: string,
): Promise<{
  file: GenerationPinnedStorageFileLike;
  metadata: ReturnType<typeof safeStorageMetadata>;
}> {
  validateStorageIdentity(path, expectedGeneration);
  const file = bucket.file(path, { generation: expectedGeneration });
  let rawMetadata: unknown;
  try {
    [rawMetadata] = await file.getMetadata();
  } catch {
    throw safeInternalError("drive_storage_failed");
  }
  return {
    file,
    metadata: safeStorageMetadata(rawMetadata, path, expectedGeneration),
  };
}

export function createFinalizedMediaStorageAdapter(
  bucket: FinalizedMediaBucketLike,
): RangedFinalizedMediaStorageAdapter {
  return {
    async readFinalizedObjectMetadata({ path, expectedGeneration }) {
      const { metadata } = await pinnedObject(
        bucket,
        path,
        expectedGeneration,
      );
      return {
        path,
        generation: expectedGeneration,
        sizeBytes: metadata.sizeBytes,
        mimeType: metadata.mimeType,
        md5Hash: metadata.md5Hash,
        ...(metadata.crc32c === undefined
          ? {}
          : { crc32c: metadata.crc32c }),
      };
    },
    async readFinalizedObject({ path, expectedGeneration }) {
      const { file, metadata } = await pinnedObject(
        bucket,
        path,
        expectedGeneration,
      );
      let body: unknown;
      try {
        body = file.createReadStream({ validation: "md5" });
      } catch {
        throw safeInternalError("drive_storage_failed");
      }
      return {
        path,
        generation: expectedGeneration,
        sizeBytes: metadata.sizeBytes,
        mimeType: metadata.mimeType,
        md5Hash: metadata.md5Hash,
        ...(metadata.crc32c === undefined
          ? {}
          : { crc32c: metadata.crc32c }),
        body,
      };
    },
    async readFinalizedObjectRange({
      path,
      expectedGeneration,
      startOffset,
      endOffsetInclusive,
    }) {
      validateStorageIdentity(path, expectedGeneration);
      if (
        !Number.isSafeInteger(startOffset)
        || !Number.isSafeInteger(endOffsetInclusive)
        || startOffset < 0
        || endOffsetInclusive < startOffset
      ) {
        throw safeInternalError("drive_source_invalid");
      }
      const { file, metadata } = await pinnedObject(
        bucket,
        path,
        expectedGeneration,
      );
      if (endOffsetInclusive >= metadata.sizeBytes) {
        throw safeInternalError("drive_source_invalid");
      }
      let body: unknown;
      try {
        body = file.createReadStream({
          validation: false,
          start: startOffset,
          end: endOffsetInclusive,
        });
      } catch {
        throw safeInternalError("drive_storage_failed");
      }
      return {
        path,
        generation: expectedGeneration,
        sizeBytes: metadata.sizeBytes,
        mimeType: metadata.mimeType,
        md5Hash: metadata.md5Hash,
        ...(metadata.crc32c === undefined
          ? {}
          : { crc32c: metadata.crc32c }),
        rangeStart: startOffset,
        rangeEndInclusive: endOffsetInclusive,
        body,
      };
    },
  };
}

interface GoogleResponseLike {
  data?: unknown;
}

export interface GoogleDriveClientLike {
  files: {
    get(options: {
      fileId: string;
      fields: string;
      supportsAllDrives: true;
    }): Promise<GoogleResponseLike>;
    list(options: {
      q: string;
      pageSize: number;
      fields: string;
      spaces: "drive";
      supportsAllDrives: true;
      includeItemsFromAllDrives: true;
    }): Promise<GoogleResponseLike>;
    create(options: {
      requestBody: UnknownRecord;
      fields: string;
      supportsAllDrives: true;
      media?: {
        mimeType: string;
        body: Buffer;
      };
    }): Promise<GoogleResponseLike>;
    copy(options: {
      fileId: string;
      requestBody: UnknownRecord;
      fields: string;
      supportsAllDrives: true;
    }): Promise<GoogleResponseLike>;
  };
}

export interface ValidatedDriveMediaAdapter
  extends DriveMediaAdapter, AdPackageDriveAdapter {
  validateRootFolder(input: {
    rootFolderId: string;
    rootMode: DriveRootMode;
  }): Promise<void>;
  startResumableMediaUpload(input: DriveResumableStartInput): Promise<{
    sessionUri: string;
    nextOffset: 0;
  }>;
  probeResumableMediaUpload(
    input: DriveResumableSessionInput,
  ): Promise<DriveResumableProgress>;
  uploadResumableMediaChunk(
    input: DriveResumableChunkInput,
  ): Promise<DriveResumableProgress>;
}

function responseFiles(response: GoogleResponseLike): unknown[] {
  if (!isRecord(response.data)) {
    throw safeInternalError("drive_api_response_invalid");
  }
  const files = response.data.files;
  if (files === undefined || files === null) return [];
  if (!Array.isArray(files)) {
    throw safeInternalError("drive_api_response_invalid");
  }
  return files;
}

function responseFile(response: GoogleResponseLike): unknown {
  if (!isRecord(response.data)) {
    throw safeInternalError("drive_api_response_invalid");
  }
  return response.data;
}

function allowlistedArtifactFile(value: unknown): UnknownRecord {
  if (!isRecord(value)) throw safeInternalError("drive_api_response_invalid");
  return {
    id: value.id,
    name: value.name,
    mimeType: value.mimeType,
    parents: value.parents,
    trashed: value.trashed,
    size: value.size,
    md5Checksum: value.md5Checksum,
    appProperties: value.appProperties,
  };
}

function allowlistedArtifactFiles(response: GoogleResponseLike): UnknownRecord[] {
  return responseFiles(response).map(allowlistedArtifactFile);
}

type DriveRequestContext = "ordinary" | "rootValidation";

function safeProperty(value: unknown, key: string): unknown {
  if (!isRecord(value)) return undefined;
  try {
    return value[key];
  } catch {
    return undefined;
  }
}

function httpStatus(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return value >= 400 && value <= 599 ? value : undefined;
  }
  if (typeof value === "string" && /^[4-5][0-9]{2}$/u.test(value)) {
    return Number(value);
  }
  return undefined;
}

function structuredGoogleFailure(error: unknown): {
  status?: number;
  markers: Set<string>;
} {
  const response = safeProperty(error, "response");
  const data = safeProperty(response, "data");
  const nestedError = safeProperty(data, "error");
  const status = httpStatus(safeProperty(response, "status"))
    ?? httpStatus(safeProperty(error, "status"))
    ?? httpStatus(safeProperty(error, "code"));
  const markers = new Set<string>();
  for (const value of [
    safeProperty(error, "code"),
    safeProperty(error, "reason"),
    safeProperty(data, "error"),
    safeProperty(data, "reason"),
    safeProperty(nestedError, "status"),
    safeProperty(nestedError, "reason"),
  ]) {
    if (typeof value === "string" && value.length <= 64) markers.add(value);
  }
  for (const list of [
    safeProperty(nestedError, "errors"),
    safeProperty(data, "errors"),
  ]) {
    if (!Array.isArray(list)) continue;
    for (const item of list.slice(0, 20)) {
      const reason = safeProperty(item, "reason");
      if (typeof reason === "string" && reason.length <= 64) markers.add(reason);
    }
  }
  return { ...(status === undefined ? {} : { status }), markers };
}

function safeDriveFailureCode(
  error: unknown,
  context: DriveRequestContext,
): "drive_api_failed" | "drive_oauth_config_invalid" | "drive_root_folder_invalid" {
  let failure: ReturnType<typeof structuredGoogleFailure>;
  try {
    failure = structuredGoogleFailure(error);
  } catch {
    return "drive_api_failed";
  }
  if (
    failure.status === 401
    || failure.markers.has("invalid_grant")
    || failure.markers.has("UNAUTHENTICATED")
    || failure.markers.has("authError")
  ) return "drive_oauth_config_invalid";
  if (context === "rootValidation" && (
    failure.status === 403
    || failure.status === 404
    || failure.markers.has("forbidden")
    || failure.markers.has("notFound")
  )) return "drive_root_folder_invalid";
  if (
    failure.markers.has("insufficientPermissions")
    || failure.markers.has("insufficientAuthenticationScopes")
    || failure.markers.has("ACCESS_TOKEN_SCOPE_INSUFFICIENT")
  ) return "drive_oauth_config_invalid";
  return "drive_api_failed";
}

async function safeDriveRequest<T>(
  request: () => Promise<T>,
  context: DriveRequestContext = "ordinary",
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (
      error instanceof Error
      && (error.message === "drive_api_response_invalid"
        || error.message === "drive_source_invalid"
        || error.message === "drive_oauth_config_invalid"
        || error.message === "drive_root_folder_invalid")
    ) {
      throw error;
    }
    throw safeInternalError(safeDriveFailureCode(error, context));
  }
}

export function createGoogleDriveMediaAdapter(
  client: GoogleDriveClientLike,
  resumable: DriveResumableUploadClient = {
    async start() {
      throw safeInternalError("drive_oauth_config_invalid");
    },
    async probe() {
      throw safeInternalError("drive_oauth_config_invalid");
    },
    async uploadChunk() {
      throw safeInternalError("drive_oauth_config_invalid");
    },
  },
): ValidatedDriveMediaAdapter {
  return {
    async validateRootFolder({ rootFolderId, rootMode }) {
      if (
        !/^[A-Za-z0-9_-]{1,200}$/u.test(rootFolderId)
        || (rootMode !== "appCreated" && rootMode !== "existingRoot")
      ) {
        throw safeInternalError("drive_root_folder_invalid");
      }
      const value = await safeDriveRequest(async () => responseFile(
        await client.files.get({
          fileId: rootFolderId,
          fields: "id,mimeType,trashed,capabilities(canAddChildren)",
          supportsAllDrives: true,
        }),
      ), "rootValidation");
      if (
        !isRecord(value)
        || value.id !== rootFolderId
        || value.mimeType !== DRIVE_FOLDER_MIME_TYPE
        || value.trashed !== false
        || !isRecord(value.capabilities)
        || value.capabilities.canAddChildren !== true
      ) {
        throw safeInternalError("drive_root_folder_invalid");
      }
    },
    async listExactFolders(input: DriveFolderListRequest) {
      return safeDriveRequest(async () => responseFiles(await client.files.list({
        q: input.query,
        pageSize: input.pageSize,
        fields: FOLDER_FIELDS,
        spaces: "drive",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      })));
    },
    async createFolder(input: DriveFolderCreateRequest) {
      return safeDriveRequest(async () => responseFile(await client.files.create({
        requestBody: {
          name: input.name,
          mimeType: input.mimeType,
          parents: [input.parentId],
        },
        fields: CREATED_FOLDER_FIELDS,
        supportsAllDrives: true,
      })));
    },
    async listExactMediaFiles(input: DriveMediaFileListRequest) {
      return safeDriveRequest(async () => responseFiles(await client.files.list({
        q: input.query,
        pageSize: input.pageSize,
        fields: MEDIA_FIELDS,
        spaces: "drive",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      })));
    },
    async listExactArtifactFiles(input: AdPackageArtifactListRequest) {
      return safeDriveRequest(async () => allowlistedArtifactFiles(
        await client.files.list({
          q: input.query,
          pageSize: input.pageSize,
          fields: input.fields,
          spaces: "drive",
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        }),
      ));
    },
    async copyExistingFile(input: AdPackageMediaCopyRequest) {
      return safeDriveRequest(async () => allowlistedArtifactFile(responseFile(
        await client.files.copy({
          fileId: input.sourceFileId,
          requestBody: {
            name: input.name,
            parents: [input.parentId],
            appProperties: { ...input.appProperties },
          },
          fields: input.fields,
          supportsAllDrives: true,
        }),
      )));
    },
    async uploadUtf8File(input: AdPackageTextUploadRequest) {
      return safeDriveRequest(async () => allowlistedArtifactFile(responseFile(
        await client.files.create({
          requestBody: {
            name: input.name,
            parents: [input.parentId],
            appProperties: { ...input.appProperties },
          },
          media: {
            mimeType: input.mimeType,
            body: Buffer.from(input.bytes),
          },
          fields: input.fields,
          supportsAllDrives: true,
        }),
      )));
    },
    async startResumableMediaUpload(input) {
      return resumable.start(input);
    },
    async probeResumableMediaUpload(input) {
      return resumable.probe(input);
    },
    async uploadResumableMediaChunk(input) {
      return resumable.uploadChunk(input);
    },
    async uploadMediaFile(input: DriveMediaUploadRequest) {
      const started = await resumable.start({
        parentId: input.parentId,
        name: input.name,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        appProperties: { ...input.appProperties },
      });
      const result = await resumable.uploadChunk({
        sessionUri: started.sessionUri,
        mimeType: input.mimeType,
        totalSizeBytes: input.sizeBytes,
        startOffset: 0,
        endOffsetInclusive: input.sizeBytes - 1,
        body: input.body,
      });
      if (result.status !== "complete") {
        throw safeInternalError("drive_upload_incomplete");
      }
      return result.file;
    },
  };
}

export interface GoogleOAuthRuntimeFactory {
  OAuth2(clientId: string, clientSecret: string): {
    setCredentials(credentials: { refresh_token: string }): void;
    getAccessToken(): Promise<
      string | null | { token?: string | null }
    >;
  };
  drive(options: { version: "v3"; auth: unknown }): GoogleDriveClientLike;
}

const googleOAuthRuntimeFactory: GoogleOAuthRuntimeFactory = {
  OAuth2(clientId, clientSecret) {
    return new google.auth.OAuth2(clientId, clientSecret);
  },
  drive(options) {
    return google.drive({
      version: options.version,
      auth: options.auth as InstanceType<typeof google.auth.OAuth2>,
    }) as unknown as GoogleDriveClientLike;
  },
};

export function createGoogleDriveMediaAdapterFromOAuth(
  config: DriveOAuthConfig,
  factory: GoogleOAuthRuntimeFactory = googleOAuthRuntimeFactory,
): ValidatedDriveMediaAdapter {
  const oauth2Client = factory.OAuth2(config.clientId, config.clientSecret);
  oauth2Client.setCredentials({ refresh_token: config.refreshToken });
  const resumable = createDriveResumableUploadClient({
    async getAccessToken() {
      const response = await oauth2Client.getAccessToken();
      return typeof response === "string" ? response : response?.token;
    },
    async fetch(input, init) {
      return globalThis.fetch(
        input,
        init as unknown as RequestInit,
      );
    },
  });
  return createGoogleDriveMediaAdapter(
    factory.drive({ version: "v3", auth: oauth2Client }),
    resumable,
  );
}

export function isDriveMd5Hex(value: unknown): value is string {
  return typeof value === "string" && MD5_HEX_PATTERN.test(value);
}
