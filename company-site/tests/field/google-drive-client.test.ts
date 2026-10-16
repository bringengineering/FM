import { describe, expect, it, vi } from "vitest";

import {
  GoogleDriveClient,
  type DriveFetch,
} from "../../app/field/lib/google-drive.client";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("GoogleDriveClient", () => {
  it("finds an exact child using escaped Drive query values", async () => {
    const fetch = vi.fn<DriveFetch>(async () => jsonResponse({
      files: [{ id: "folder-1", name: "건물 owner's", mimeType: "application/vnd.google-apps.folder" }],
    }));
    const client = new GoogleDriveClient({ getAccessToken: () => "token", fetch });

    await expect(client.findExactChild("root-1", "건물 owner's", "folder")).resolves.toEqual({
      id: "folder-1",
      name: "건물 owner's",
      mimeType: "application/vnd.google-apps.folder",
    });
    const url = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(url.searchParams.get("q")).toContain("name = '건물 owner\\'s'");
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer token" },
    });
  });

  it("creates only missing folders while walking the hierarchy", async () => {
    const client = new GoogleDriveClient({
      getAccessToken: () => "token",
      fetch: vi.fn(),
    });
    vi.spyOn(client, "findExactChild")
      .mockResolvedValueOnce({ id: "area", name: "원주시-단계동", mimeType: "application/vnd.google-apps.folder" })
      .mockResolvedValueOnce(null);
    vi.spyOn(client, "createFolder").mockResolvedValue({
      id: "building",
      name: "건물",
      mimeType: "application/vnd.google-apps.folder",
    });

    await expect(client.ensureFolderPath("root", ["원주시-단계동", "건물"]))
      .resolves.toBe("building");
    expect(client.createFolder).toHaveBeenCalledTimes(1);
    expect(client.createFolder).toHaveBeenCalledWith("area", "건물");
  });

  it("uploads small files with multipart metadata and app properties", async () => {
    const fetch = vi.fn<DriveFetch>(async () => jsonResponse({
      id: "drive-file-1",
      name: "01_외관_22222222.jpg",
      mimeType: "image/jpeg",
      size: "3",
    }));
    const client = new GoogleDriveClient({ getAccessToken: () => "token", fetch });

    await expect(client.uploadSmallFile({
      parentId: "folder-1",
      name: "01_외관_22222222.jpg",
      mimeType: "image/jpeg",
      blob: new Blob(["abc"], { type: "image/jpeg" }),
      appProperties: { bringMediaId: "media-1" },
    })).resolves.toMatchObject({ id: "drive-file-1", size: "3" });
    expect(String(fetch.mock.calls[0]?.[0])).toContain("upload/drive/v3/files?uploadType=multipart");
    const request = fetch.mock.calls[0]?.[1];
    expect(request?.method).toBe("POST");
    expect(request?.body).toBeInstanceOf(FormData);
  });

  it("resumes large uploads from Drive's acknowledged byte offset", async () => {
    const fetch = vi.fn<DriveFetch>()
      .mockResolvedValueOnce(new Response(null, {
        status: 200,
        headers: { location: "https://upload.example/session-1" },
      }))
      .mockResolvedValueOnce(new Response(null, {
        status: 308,
        headers: { range: "bytes=0-3" },
      }))
      .mockResolvedValueOnce(jsonResponse({
        id: "video-1",
        name: "14_세로영상_22222222.mp4",
        mimeType: "video/mp4",
        size: "7",
      }));
    const client = new GoogleDriveClient({ getAccessToken: () => "token", fetch });
    const blob = new Blob(["abcdefg"], { type: "video/mp4" });

    const sessionUrl = await client.startResumableUpload({
      parentId: "folder-1",
      name: "14_세로영상_22222222.mp4",
      mimeType: "video/mp4",
      sizeBytes: blob.size,
      appProperties: { bringMediaId: "media-1" },
    });
    await expect(client.uploadResumable({
      sessionUrl,
      blob,
      mimeType: "video/mp4",
      chunkSize: 4,
    })).resolves.toMatchObject({ id: "video-1", size: "7" });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[1]?.[1]?.headers).toMatchObject({
      "Content-Range": "bytes 0-3/7",
    });
    expect(fetch.mock.calls[2]?.[1]?.headers).toMatchObject({
      "Content-Range": "bytes 4-6/7",
    });
  });

  it("maps 401 and 403 to actionable safe errors", async () => {
    const unauthorized = new GoogleDriveClient({
      getAccessToken: () => "token",
      fetch: vi.fn(async () => jsonResponse({ error: { message: "secret raw message" } }, 401)),
    });
    await expect(unauthorized.getFile("file-1")).rejects.toThrow("drive_authorization_required");

    const forbidden = new GoogleDriveClient({
      getAccessToken: () => "token",
      fetch: vi.fn(async () => jsonResponse({ error: { message: "secret raw message" } }, 403)),
    });
    await expect(forbidden.getFile("file-1")).rejects.toThrow("drive_root_access_denied");
  });
});
