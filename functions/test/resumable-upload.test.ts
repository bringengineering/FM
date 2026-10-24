import { describe, expect, it, vi } from "vitest";

import {
  DRIVE_RESUMABLE_CHUNK_BYTES,
  MAX_DRIVE_UPLOAD_BYTES,
  createDriveResumableUploadClient,
  nextDriveUploadChunk,
  validateDriveResumableSessionUri,
} from "../src/drive/resumable-upload.js";

const MEDIA_ID = "22222222-2222-4222-8222-222222222222";
const GENERATION = "1740000000000001";
const ACCESS_TOKEN = "ya29.safe-access-token";
const SESSION_URI =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=safe-id";

function uploadClient(fetchImplementation: (input: string, init: {
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}) => Promise<Response>) {
  const fetch = vi.fn(fetchImplementation);
  return {
    fetch,
    client: createDriveResumableUploadClient({
      getAccessToken: vi.fn(async () => ACCESS_TOKEN),
      fetch,
    }),
  };
}

describe("Drive resumable upload protocol", () => {
  it("initiates only uploadType=resumable with exact metadata, fields, and shared-drive flags", async () => {
    const { client, fetch } = uploadClient(async () => new Response(null, {
      status: 200,
      headers: { Location: SESSION_URI },
    }));

    await expect(client.start({
      parentId: "folder-1",
      name: "room.jpg",
      mimeType: "image/jpeg",
      sizeBytes: MAX_DRIVE_UPLOAD_BYTES,
      appProperties: {
        bringMediaId: MEDIA_ID,
        bringObjectGeneration: GENERATION,
      },
    })).resolves.toEqual({ sessionUri: SESSION_URI, nextOffset: 0 });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [rawUrl, init] = fetch.mock.calls[0] as unknown as [string, {
      method: string;
      headers: Record<string, string>;
      body: string;
    }];
    const url = new URL(rawUrl);
    expect(url.origin + url.pathname).toBe(
      "https://www.googleapis.com/upload/drive/v3/files",
    );
    expect(url.searchParams.get("uploadType")).toBe("resumable");
    expect(url.searchParams.get("supportsAllDrives")).toBe("true");
    expect(url.searchParams.get("fields")).toBe(
      "id,name,mimeType,parents,trashed,size,md5Checksum,appProperties",
    );
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(MAX_DRIVE_UPLOAD_BYTES),
        "X-Upload-Content-Type": "image/jpeg",
      },
    });
    expect(JSON.parse(init.body)).toEqual({
      name: "room.jpg",
      parents: ["folder-1"],
      appProperties: {
        bringMediaId: MEDIA_ID,
        bringObjectGeneration: GENERATION,
      },
    });
  });

  it("probes an existing session and derives the next offset from a 308 Range", async () => {
    const { client, fetch } = uploadClient(async () => new Response(null, {
      status: 308,
      headers: { Range: "bytes=0-262143" },
    }));

    await expect(client.probe({
      sessionUri: SESSION_URI,
      totalSizeBytes: 1_000_000,
    })).resolves.toEqual({ status: "active", nextOffset: 262_144 });

    expect(fetch).toHaveBeenCalledWith(SESSION_URI, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Length": "0",
        "Content-Range": "bytes */1000000",
      },
    });
  });

  it("treats 200 and 201 responses as a completed upload", async () => {
    const driveFile = { id: "drive-file-1", size: "5" };
    for (const status of [200, 201]) {
      const { client } = uploadClient(async () => new Response(
        JSON.stringify(driveFile),
        { status, headers: { "Content-Type": "application/json" } },
      ));
      await expect(client.probe({
        sessionUri: SESSION_URI,
        totalSizeBytes: 5,
      })).resolves.toEqual({ status: "complete", file: driveFile });
    }
  });

  it("uploads one exact byte range and returns the acknowledged next offset", async () => {
    const body = { opaque: "range-stream" };
    const { client, fetch } = uploadClient(async () => new Response(null, {
      status: 308,
      headers: { Range: "bytes=0-524287" },
    }));

    await expect(client.uploadChunk({
      sessionUri: SESSION_URI,
      mimeType: "video/mp4",
      totalSizeBytes: 1_000_000,
      startOffset: 262_144,
      endOffsetInclusive: 524_287,
      body,
    })).resolves.toEqual({ status: "active", nextOffset: 524_288 });

    expect(fetch).toHaveBeenCalledWith(SESSION_URI, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Length": "262144",
        "Content-Range": "bytes 262144-524287/1000000",
        "Content-Type": "video/mp4",
      },
      body,
      duplex: "half",
    });
  });

  it("plans bounded 8 MiB chunks without crossing the declared object size", () => {
    expect(DRIVE_RESUMABLE_CHUNK_BYTES % (256 * 1024)).toBe(0);
    expect(nextDriveUploadChunk(0, DRIVE_RESUMABLE_CHUNK_BYTES + 7)).toEqual({
      startOffset: 0,
      endOffsetInclusive: DRIVE_RESUMABLE_CHUNK_BYTES - 1,
    });
    expect(nextDriveUploadChunk(DRIVE_RESUMABLE_CHUNK_BYTES,
      DRIVE_RESUMABLE_CHUNK_BYTES + 7)).toEqual({
      startOffset: DRIVE_RESUMABLE_CHUNK_BYTES,
      endOffsetInclusive: DRIVE_RESUMABLE_CHUNK_BYTES + 6,
    });
  });

  it("rejects a non-final chunk that is not aligned to Drive's 256 KiB protocol", async () => {
    const fetch = vi.fn();
    const getAccessToken = vi.fn();
    const client = createDriveResumableUploadClient({ fetch, getAccessToken });

    await expect(client.uploadChunk({
      sessionUri: SESSION_URI,
      mimeType: "video/mp4",
      totalSizeBytes: 1_000_000,
      startOffset: 0,
      endOffsetInclusive: 4,
      body: { opaque: "short-non-final-stream" },
    })).rejects.toThrow("drive_upload_request_invalid");
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects oversized media before sending any OAuth or HTTP request", async () => {
    const fetch = vi.fn();
    const getAccessToken = vi.fn();
    const client = createDriveResumableUploadClient({ fetch, getAccessToken });

    await expect(client.start({
      parentId: "folder-1",
      name: "too-large.mp4",
      mimeType: "video/mp4",
      sizeBytes: MAX_DRIVE_UPLOAD_BYTES + 1,
      appProperties: {
        bringMediaId: MEDIA_ID,
        bringObjectGeneration: GENERATION,
      },
    })).rejects.toThrow("drive_upload_request_invalid");
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts only bounded HTTPS Google API session URIs", () => {
    expect(validateDriveResumableSessionUri(SESSION_URI)).toBe(SESSION_URI);
    for (const unsafe of [
      "http://www.googleapis.com/upload/drive/v3/files?upload_id=x",
      "https://evil.example/upload/drive/v3/files?upload_id=x",
      "https://token@www.googleapis.com/upload/drive/v3/files?upload_id=x",
      `https://www.googleapis.com/${"a".repeat(4_096)}`,
    ]) {
      let caught: unknown;
      try {
        validateDriveResumableSessionUri(unsafe);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe("drive_resumable_response_invalid");
      expect(JSON.stringify(caught)).not.toContain(unsafe);
    }
  });

  it("redacts raw OAuth, API, and session response failures", async () => {
    const oauthSecret = "refresh-token-secret";
    const oauthClient = createDriveResumableUploadClient({
      getAccessToken: vi.fn(async () => {
        throw new Error(oauthSecret);
      }),
      fetch: vi.fn(),
    });
    let oauthError: unknown;
    try {
      await oauthClient.probe({ sessionUri: SESSION_URI, totalSizeBytes: 5 });
    } catch (error) {
      oauthError = error;
    }
    expect((oauthError as Error).message).toBe("drive_oauth_token_failed");
    expect(JSON.stringify(oauthError)).not.toContain(oauthSecret);

    const apiSecret = "raw-google-api-response-secret";
    const { client } = uploadClient(async () => new Response(apiSecret, {
      status: 503,
    }));
    let apiError: unknown;
    try {
      await client.probe({ sessionUri: SESSION_URI, totalSizeBytes: 5 });
    } catch (error) {
      apiError = error;
    }
    expect((apiError as Error).message).toBe("drive_upload_failed");
    expect(JSON.stringify(apiError)).not.toContain(apiSecret);
  });
});
