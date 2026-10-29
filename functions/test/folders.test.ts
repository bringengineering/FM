import { describe, expect, it, vi } from "vitest";

import {
  DRIVE_FOLDER_MIME_TYPE,
  buildExactFolderQuery,
  ensureDriveStructure,
  normalizeDriveName,
  type DriveFolderAdapter,
} from "../src/drive/folders.js";

function folder(id: string, name: string, parentId: string) {
  return {
    id,
    name,
    mimeType: DRIVE_FOLDER_MIME_TYPE,
    parents: [parentId],
    trashed: false,
  };
}

function memoryAdapter(seed: Record<string, string> = {}) {
  const folderIds = new Map(Object.entries(seed));
  let nextId = folderIds.size + 1;
  const key = (parentId: string, name: string) => `${parentId}\n${name}`;

  const adapter: DriveFolderAdapter = {
    listExactFolders: vi.fn(async ({ parentId, name, query }) => {
      expect(query).toBe(buildExactFolderQuery(parentId, name));
      const id = folderIds.get(key(parentId, name));
      return id ? [folder(id, name, parentId)] : [];
    }),
    createFolder: vi.fn(async ({ parentId, name }) => {
      const id = `folder-${nextId++}`;
      folderIds.set(key(parentId, name), id);
      return folder(id, name, parentId);
    }),
  };
  return { adapter, folderIds, key };
}

describe("Drive folder naming", () => {
  it("removes Windows and Drive forbidden characters, controls, trailing dots, and bounds names", () => {
    const normalized = normalizeDriveName(
      `  원주<>:"/\\|?*\u0000 건물...  ${"가".repeat(200)}`,
      "미지정",
      80,
    );

    expect(normalized).not.toMatch(/[<>:"/\\|?*\u0000-\u001f\u007f]/u);
    expect(normalized).not.toMatch(/[. ]$/u);
    expect([...normalized]).toHaveLength(80);
    expect(normalizeDriveName("<>... ", "미지정", 80)).toBe("미지정");
  });

  it("builds an exact escaped parent/name folder query", () => {
    expect(buildExactFolderQuery("root-1", "사장님's \\ 건물")).toBe(
      "'root-1' in parents and name = '사장님\\'s \\\\ 건물' "
      + "and mimeType = 'application/vnd.google-apps.folder' "
      + "and trashed = false",
    );
  });
});

describe("ensureDriveStructure", () => {
  const request = {
    rootFolderId: "root-1",
    managementNumber: "BR-001",
    neighborhood: "무실동",
    buildingName: "브링빌",
    unitLabel: "301호",
    captureDate: "2026-08-10",
    sessionSequence: 2,
  };

  it("creates the canonical building/unit/session and three category folders", async () => {
    const { adapter } = memoryAdapter();

    const result = await ensureDriveStructure(request, adapter);

    expect(result.names).toEqual({
      building: "BR-001_무실동_브링빌",
      unit: "301호",
      session: "2026-08-10_02_공실촬영",
      representativePhotos: "01_광고용_대표사진",
      originalPhotos: "02_전체원본사진",
      verticalVideos: "03_세로영상",
    });
    expect(result.ids).toMatchObject({
      root: "root-1",
      building: "folder-1",
      unit: "folder-2",
      session: "folder-3",
      representativePhotos: "folder-4",
      originalPhotos: "folder-5",
      verticalVideos: "folder-6",
    });
    expect(adapter.createFolder).toHaveBeenCalledTimes(6);
  });

  it("reuses exact existing folder IDs on duplicate delivery", async () => {
    const { adapter } = memoryAdapter();

    const first = await ensureDriveStructure(request, adapter);
    const second = await ensureDriveStructure(request, adapter);

    expect(second).toEqual(first);
    expect(adapter.createFolder).toHaveBeenCalledTimes(6);
  });

  it("fails deterministically when the exact query returns duplicate folders", async () => {
    const adapter: DriveFolderAdapter = {
      listExactFolders: vi.fn(async ({ parentId, name }) => [
        folder("folder-a", name, parentId),
        folder("folder-b", name, parentId),
      ]),
      createFolder: vi.fn(),
    };

    await expect(ensureDriveStructure(request, adapter)).rejects.toThrow(
      "drive_folder_duplicate",
    );
    expect(adapter.createFolder).not.toHaveBeenCalled();
  });

  it("fails closed on malformed or mismatched Drive folder responses", async () => {
    const adapter: DriveFolderAdapter = {
      listExactFolders: vi.fn(async ({ parentId, name }) => [{
        ...folder("folder-a", name, parentId),
        parents: ["other-parent"],
        secret: "must-not-be-projected",
      }]),
      createFolder: vi.fn(),
    };

    await expect(ensureDriveStructure(request, adapter)).rejects.toThrow(
      "drive_folder_response_invalid",
    );
  });
});
