import { describe, expect, it, vi } from "vitest";

import { DRIVE_FOLDER_MIME_TYPE } from "../src/drive/folders.js";

import {
  DRIVE_FILE_SCOPE,
  DRIVE_FULL_SCOPE,
  base64Md5ToHex,
  createFinalizedMediaStorageAdapter,
  createGoogleDriveMediaAdapter,
  createGoogleDriveMediaAdapterFromOAuth,
  type GoogleDriveClientLike,
} from "../src/drive/google-drive-adapter.js";

const MEDIA_ID = "22222222-2222-4222-8222-222222222222";
const GENERATION = "1740000000000001";
const STORAGE_PATH = `field-media-finalized/building-1/${MEDIA_ID}.jpg`;
const SOURCE_MD5_BASE64 = "XUFAKrxLKna5cZ2REBfFkg==";
const SOURCE_MD5_HEX = "5d41402abc4b2a76b9719d911017c592";
const SESSION_URI =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=safe-id";

function driveClient(overrides: Partial<GoogleDriveClientLike["files"]> = {}) {
  return {
    files: {
      list: vi.fn(async () => ({ data: { files: [] } })),
      create: vi.fn(async () => ({ data: {} })),
      copy: vi.fn(async () => ({ data: {} })),
      get: vi.fn(async () => ({ data: {} })),
      ...overrides,
    },
  } satisfies GoogleDriveClientLike;
}

describe("Drive runtime checksum and Storage adapter", () => {
  it("reads generation-pinned metadata without opening a full-object stream", async () => {
    const createReadStream = vi.fn();
    const adapter = createFinalizedMediaStorageAdapter({
      file: vi.fn(() => ({
        getMetadata: vi.fn(async () => [{
          name: STORAGE_PATH,
          generation: GENERATION,
          size: "5",
          contentType: "image/jpeg",
          md5Hash: SOURCE_MD5_BASE64,
        }]),
        createReadStream,
      })),
    });

    await expect(adapter.readFinalizedObjectMetadata({
      path: STORAGE_PATH,
      expectedGeneration: GENERATION,
    })).resolves.toEqual({
      path: STORAGE_PATH,
      generation: GENERATION,
      sizeBytes: 5,
      mimeType: "image/jpeg",
      md5Hash: SOURCE_MD5_HEX,
    });
    expect(createReadStream).not.toHaveBeenCalled();
  });

  it("converts canonical GCS base64 MD5 bytes to Drive lowercase hex", () => {
    expect(base64Md5ToHex(SOURCE_MD5_BASE64)).toBe(SOURCE_MD5_HEX);
  });

  it("rejects malformed MD5 without echoing the supplied value", () => {
    const malformed = "oauth-secret-not-base64";
    let caught: unknown;
    try {
      base64Md5ToHex(malformed);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("drive_source_invalid");
    expect(JSON.stringify(caught)).not.toContain(malformed);
  });

  it("reads only the generation-pinned GCS object and never mutates it", async () => {
    const createReadStream = vi.fn(() => ({ opaque: "stream" }));
    const getMetadata = vi.fn(async () => [{
      name: STORAGE_PATH,
      generation: GENERATION,
      size: "5",
      contentType: "image/jpeg",
      md5Hash: SOURCE_MD5_BASE64,
      crc32c: "NhCmhg==",
    }]);
    const deleteObject = vi.fn();
    const copyObject = vi.fn();
    const file = vi.fn(() => ({
      getMetadata,
      createReadStream,
      delete: deleteObject,
      copy: copyObject,
    }));
    const adapter = createFinalizedMediaStorageAdapter({ file });

    await expect(adapter.readFinalizedObject({
      path: STORAGE_PATH,
      expectedGeneration: GENERATION,
    })).resolves.toEqual({
      path: STORAGE_PATH,
      generation: GENERATION,
      sizeBytes: 5,
      mimeType: "image/jpeg",
      md5Hash: SOURCE_MD5_HEX,
      crc32c: "NhCmhg==",
      body: { opaque: "stream" },
    });

    expect(file).toHaveBeenCalledWith(STORAGE_PATH, { generation: GENERATION });
    expect(getMetadata).toHaveBeenCalledTimes(1);
    expect(createReadStream).toHaveBeenCalledWith({ validation: "md5" });
    expect(deleteObject).not.toHaveBeenCalled();
    expect(copyObject).not.toHaveBeenCalled();
  });

  it("rejects a GCS generation mismatch before opening a stream", async () => {
    const createReadStream = vi.fn();
    const adapter = createFinalizedMediaStorageAdapter({
      file: vi.fn(() => ({
        getMetadata: vi.fn(async () => [{
          name: STORAGE_PATH,
          generation: "1740000000000002",
          size: "5",
          contentType: "image/jpeg",
          md5Hash: SOURCE_MD5_BASE64,
        }]),
        createReadStream,
      })),
    });

    await expect(adapter.readFinalizedObject({
      path: STORAGE_PATH,
      expectedGeneration: GENERATION,
    })).rejects.toThrow("drive_source_invalid");
    expect(createReadStream).not.toHaveBeenCalled();
  });

  it("opens only the requested generation-pinned inclusive byte range", async () => {
    const createReadStream = vi.fn(() => ({ opaque: "range-stream" }));
    const file = vi.fn(() => ({
      getMetadata: vi.fn(async () => [{
        name: STORAGE_PATH,
        generation: GENERATION,
        size: "1000000",
        contentType: "video/mp4",
        md5Hash: SOURCE_MD5_BASE64,
      }]),
      createReadStream,
    }));
    const adapter = createFinalizedMediaStorageAdapter({ file });

    await expect(adapter.readFinalizedObjectRange({
      path: STORAGE_PATH,
      expectedGeneration: GENERATION,
      startOffset: 262_144,
      endOffsetInclusive: 524_287,
    })).resolves.toEqual(expect.objectContaining({
      path: STORAGE_PATH,
      generation: GENERATION,
      sizeBytes: 1_000_000,
      rangeStart: 262_144,
      rangeEndInclusive: 524_287,
      body: { opaque: "range-stream" },
    }));

    expect(file).toHaveBeenCalledWith(STORAGE_PATH, { generation: GENERATION });
    expect(createReadStream).toHaveBeenCalledWith({
      validation: false,
      start: 262_144,
      end: 524_287,
    });
  });

  it("rejects invalid ranges and objects larger than 500 MiB before streaming", async () => {
    const createReadStream = vi.fn();
    const adapter = createFinalizedMediaStorageAdapter({
      file: vi.fn(() => ({
        getMetadata: vi.fn(async () => [{
          name: STORAGE_PATH,
          generation: GENERATION,
          size: String(500 * 1024 * 1024 + 1),
          contentType: "video/mp4",
          md5Hash: SOURCE_MD5_BASE64,
        }]),
        createReadStream,
      })),
    });

    await expect(adapter.readFinalizedObjectRange({
      path: STORAGE_PATH,
      expectedGeneration: GENERATION,
      startOffset: 2,
      endOffsetInclusive: 1,
    })).rejects.toThrow("drive_source_invalid");
    await expect(adapter.readFinalizedObject({
      path: STORAGE_PATH,
      expectedGeneration: GENERATION,
    })).rejects.toThrow("drive_source_invalid");
    expect(createReadStream).not.toHaveBeenCalled();
  });
});

describe("Google Drive v3 adapter", () => {
  it.each(["appCreated", "existingRoot"] as const)(
    "validates a %s root by exact id, folder type, trash, and add-child capability",
    async (rootMode) => {
      const get = vi.fn(async () => ({ data: {
        id: "root-1",
        mimeType: DRIVE_FOLDER_MIME_TYPE,
        trashed: false,
        capabilities: { canAddChildren: true },
      } }));
      const adapter = createGoogleDriveMediaAdapter(driveClient({ get }));

      await expect(adapter.validateRootFolder({
        rootFolderId: "root-1",
        rootMode,
      })).resolves.toBeUndefined();

      expect(get).toHaveBeenCalledWith({
        fileId: "root-1",
        fields: "id,mimeType,trashed,capabilities(canAddChildren)",
        supportsAllDrives: true,
      });
    },
  );

  it.each([
    { mimeType: "image/jpeg", trashed: false, canAddChildren: true },
    { mimeType: DRIVE_FOLDER_MIME_TYPE, trashed: true, canAddChildren: true },
    { mimeType: DRIVE_FOLDER_MIME_TYPE, trashed: false, canAddChildren: false },
  ])("rejects an unusable configured root without exposing API data", async (root) => {
    const adapter = createGoogleDriveMediaAdapter(driveClient({
      get: vi.fn(async () => ({ data: {
        id: "root-1",
        mimeType: root.mimeType,
        trashed: root.trashed,
        capabilities: { canAddChildren: root.canAddChildren },
        name: "sensitive-company-folder-name",
      } })),
    }));

    await expect(adapter.validateRootFolder({
      rootFolderId: "root-1",
      rootMode: "existingRoot",
    })).rejects.toThrow("drive_root_folder_invalid");
  });

  it("uses the exact folder query, bounded fields, and shared-drive-safe flags", async () => {
    const list = vi.fn(async () => ({ data: { files: [{ id: "folder-1" }] } }));
    const adapter = createGoogleDriveMediaAdapter(driveClient({ list }));
    const query = "'root-1' in parents and name = 'A' and trashed = false";

    await expect(adapter.listExactFolders({
      parentId: "root-1",
      name: "A",
      query,
      pageSize: 3,
      fields: "files(id,name,mimeType,parents,trashed)",
    })).resolves.toEqual([{ id: "folder-1" }]);

    expect(list).toHaveBeenCalledWith({
      q: query,
      pageSize: 3,
      fields: "files(id,name,mimeType,parents,trashed)",
      spaces: "drive",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
  });

  it("uses resumable upload methods and never sends multipart media", async () => {
    const body = { opaque: "stream" };
    const create = vi.fn(async () => ({ data: {} }));
    const start = vi.fn(async () => ({ sessionUri: SESSION_URI, nextOffset: 0 }));
    const uploadChunk = vi.fn(async () => ({ status: "complete" as const, file: {
      id: "drive-file-1",
      name: "room.jpg",
      mimeType: "image/jpeg",
      parents: ["folder-1"],
      trashed: false,
      size: "5",
      md5Checksum: SOURCE_MD5_HEX,
      appProperties: {
        bringMediaId: MEDIA_ID,
        bringObjectGeneration: GENERATION,
      },
    } }));
    const probe = vi.fn();
    const adapter = createGoogleDriveMediaAdapter(
      driveClient({ create }),
      { start, probe, uploadChunk },
    );

    await adapter.uploadMediaFile({
      parentId: "folder-1",
      name: "room.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 5,
      body,
      appProperties: {
        bringMediaId: MEDIA_ID,
        bringObjectGeneration: GENERATION,
      },
      fields: "id,name,mimeType,parents,trashed,size,md5Checksum,appProperties",
    });

    expect(start).toHaveBeenCalledWith({
      parentId: "folder-1",
      name: "room.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 5,
      appProperties: {
        bringMediaId: MEDIA_ID,
        bringObjectGeneration: GENERATION,
      },
    });
    expect(uploadChunk).toHaveBeenCalledWith({
      sessionUri: SESSION_URI,
      mimeType: "image/jpeg",
      totalSizeBytes: 5,
      startOffset: 0,
      endOffsetInclusive: 4,
      body,
    });
    expect(create).not.toHaveBeenCalledWith(expect.objectContaining({
      requestBody: {
        name: "room.jpg",
      },
      media: expect.anything(),
    }));
  });

  it("lists, copies, and uploads package artifacts with exact Drive v3 requests", async () => {
    const properties = {
      bringPackageId: "ad-package-11111111-1111-4111-8111-111111111111",
      bringPackageVersion: "3",
      bringArtifactKey: "original:001:33333333-3333-4333-8333-000000000331",
      bringSourceId: "33333333-3333-4333-8333-000000000331",
      bringSourceGeneration: "1001",
    };
    const fields = "id,name,mimeType,parents,trashed,size,md5Checksum,appProperties" as const;
    const raw = {
      id: "artifact-1",
      name: "001_photo.jpg",
      mimeType: "image/jpeg",
      parents: ["folder-1"],
      trashed: false,
      size: "5",
      md5Checksum: SOURCE_MD5_HEX,
      appProperties: properties,
      owners: [{ emailAddress: "must-not-leak@example.com" }],
    };
    const list = vi.fn(async () => ({ data: { files: [raw] } }));
    const copy = vi.fn(async () => ({ data: raw }));
    const create = vi.fn(async () => ({ data: {
      ...raw,
      id: "text-1",
      name: "04_text.txt",
      mimeType: "text/plain",
      size: "6",
    } }));
    const adapter = createGoogleDriveMediaAdapter(driveClient({
      list,
      copy,
      create,
    } as any));
    const query = "'folder-1' in parents and trashed = false and exact-app-properties";

    await expect(adapter.listExactArtifactFiles({
      parentId: "folder-1",
      appProperties: properties,
      query,
      pageSize: 3,
      fields: `files(${fields})`,
    })).resolves.toEqual([{ ...raw, owners: undefined }].map(({ owners: _owners, ...safe }) => safe));
    expect(list).toHaveBeenCalledWith({
      q: query,
      pageSize: 3,
      fields: `files(${fields})`,
      spaces: "drive",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    await expect(adapter.copyExistingFile({
      sourceFileId: "source-file-1",
      parentId: "folder-1",
      name: raw.name,
      mimeType: raw.mimeType,
      sizeBytes: 5,
      md5Checksum: SOURCE_MD5_HEX,
      appProperties: properties,
      fields,
    })).resolves.toEqual(expect.objectContaining({ id: "artifact-1" }));
    expect(copy).toHaveBeenCalledWith({
      fileId: "source-file-1",
      requestBody: {
        name: raw.name,
        parents: ["folder-1"],
        appProperties: properties,
      },
      fields,
      supportsAllDrives: true,
    });

    const bytes = new TextEncoder().encode("브링\r\n");
    await expect(adapter.uploadUtf8File({
      parentId: "folder-1",
      name: "04_text.txt",
      mimeType: "text/plain",
      bytes,
      md5Checksum: SOURCE_MD5_HEX,
      appProperties: properties,
      fields,
    })).resolves.toEqual(expect.objectContaining({ id: "text-1" }));
    expect(create).toHaveBeenCalledWith({
      requestBody: {
        name: "04_text.txt",
        parents: ["folder-1"],
        appProperties: properties,
      },
      media: {
        mimeType: "text/plain",
        body: expect.any(Buffer),
      },
      fields,
      supportsAllDrives: true,
    });
    const mediaBody = create.mock.calls[0][0].media.body as Buffer;
    expect(mediaBody.equals(Buffer.from(bytes))).toBe(true);
    expect(JSON.stringify(await adapter.listExactArtifactFiles({
      parentId: "folder-1",
      appProperties: properties,
      query,
      pageSize: 3,
      fields: `files(${fields})`,
    }))).not.toContain("must-not-leak@example.com");
    expect((adapter as Record<string, unknown>).deleteFile).toBeUndefined();
    expect((adapter as Record<string, unknown>).moveFile).toBeUndefined();
  });

  it("maps raw Google API failures to a secret-free internal code", async () => {
    const leaked = "oauth-refresh-token-value";
    const adapter = createGoogleDriveMediaAdapter(driveClient({
      list: vi.fn(async () => {
        throw new Error(`401 ${leaked}`);
      }),
    }));
    let caught: unknown;
    try {
      await adapter.listExactMediaFiles({
        parentId: "folder-1",
        mediaId: MEDIA_ID,
        objectGeneration: GENERATION,
        query: "exact query",
        pageSize: 3,
        fields: "files(id,name,mimeType,parents,trashed,size,md5Checksum,appProperties)",
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("drive_api_failed");
    expect(JSON.stringify(caught)).not.toContain(leaked);
  });

  it.each([
    {
      name: "invalid_grant",
      failure: {
        response: {
          status: 400,
          data: {
            error: "invalid_grant",
            error_description: "revoked oauth-refresh-token-value",
          },
        },
      },
    },
    {
      name: "HTTP 401",
      failure: {
        response: {
          status: 401,
          data: { error: { code: 401, message: "oauth-refresh-token-value" } },
        },
      },
    },
    {
      name: "insufficient OAuth scope",
      failure: {
        response: {
          status: 403,
          data: {
            error: {
              code: 403,
              errors: [{ reason: "insufficientPermissions" }],
              message: "oauth-refresh-token-value",
            },
          },
        },
      },
    },
  ])("classifies structured $name as secret-free OAuth configuration invalid", async ({ failure }) => {
    const adapter = createGoogleDriveMediaAdapter(driveClient({
      list: vi.fn(async () => {
        throw Object.assign(new Error("oauth-refresh-token-value"), failure);
      }),
    }));

    let caught: unknown;
    try {
      await adapter.listExactMediaFiles({
        parentId: "folder-1",
        mediaId: MEDIA_ID,
        objectGeneration: GENERATION,
        query: "exact query",
        pageSize: 3,
        fields: "files(id,name,mimeType,parents,trashed,size,md5Checksum,appProperties)",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("drive_oauth_config_invalid");
    expect(JSON.stringify(caught)).not.toContain("oauth-refresh-token-value");
  });

  it.each([403, 404])(
    "classifies configured-root HTTP %s as secret-free root configuration invalid",
    async (status) => {
      const adapter = createGoogleDriveMediaAdapter(driveClient({
        get: vi.fn(async () => {
          throw Object.assign(new Error("sensitive-company-root"), {
            response: {
              status,
              data: {
                error: {
                  code: status,
                  errors: [{ reason: status === 403 ? "forbidden" : "notFound" }],
                  message: "sensitive-company-root",
                },
              },
            },
          });
        }),
      }));

      let caught: unknown;
      try {
        await adapter.validateRootFolder({
          rootFolderId: "root-1",
          rootMode: "existingRoot",
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe("drive_root_folder_invalid");
      expect(JSON.stringify(caught)).not.toContain("sensitive-company-root");
    },
  );

  it.each([429, 500, 503])(
    "keeps structured HTTP %s Drive failures transient",
    async (status) => {
      const adapter = createGoogleDriveMediaAdapter(driveClient({
        list: vi.fn(async () => {
          throw Object.assign(new Error("oauth-refresh-token-value"), {
            response: { status, data: { error: { code: status } } },
          });
        }),
      }));

      await expect(adapter.listExactMediaFiles({
        parentId: "folder-1",
        mediaId: MEDIA_ID,
        objectGeneration: GENERATION,
        query: "exact query",
        pageSize: 3,
        fields: "files(id,name,mimeType,parents,trashed,size,md5Checksum,appProperties)",
      })).rejects.toThrow("drive_api_failed");
    },
  );

  it("binds the refresh token to OAuth2 and documents the drive.file grant", () => {
    const setCredentials = vi.fn();
    const oauth2Client = { setCredentials };
    const OAuth2 = vi.fn(() => oauth2Client);
    const client = driveClient();
    const drive = vi.fn(() => client);

    const adapter = createGoogleDriveMediaAdapterFromOAuth({
      clientId: "client-id.apps.googleusercontent.com",
      clientSecret: "client-secret",
      refreshToken: "refresh-token",
      rootFolderId: "root-1",
      rootMode: "appCreated",
    }, { OAuth2, drive });

    expect(adapter).toBeDefined();
    expect(OAuth2).toHaveBeenCalledWith(
      "client-id.apps.googleusercontent.com",
      "client-secret",
    );
    expect(setCredentials).toHaveBeenCalledWith({ refresh_token: "refresh-token" });
    expect(drive).toHaveBeenCalledWith({ version: "v3", auth: oauth2Client });
    expect(DRIVE_FILE_SCOPE).toBe("https://www.googleapis.com/auth/drive.file");
    expect(DRIVE_FULL_SCOPE).toBe("https://www.googleapis.com/auth/drive");
  });
});
