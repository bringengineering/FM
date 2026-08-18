import "fake-indexeddb/auto";

import { Blob as NodeBlob } from "node:buffer";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { deleteDB, openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ensureCaptureCapacity,
  openOfflineQueue,
  requestPersistentCaptureStorage,
  type CaptureBinding,
  type OfflineQueuePort,
  type QueuedMediaRecord,
} from "../../app/field/lib/offline-queue";

const FIVE_MEBIBYTES = 5 * 1_024 * 1_024;

let dbName = "";
let openQueues: OfflineQueuePort[] = [];

beforeEach(() => {
  dbName = `capture-${crypto.randomUUID()}`;
  openQueues = [];
});

afterEach(async () => {
  for (const queue of openQueues) queue.close();
  await deleteDB(dbName);
  vi.restoreAllMocks();
});

async function createQueue(): Promise<OfflineQueuePort> {
  const queue = await openOfflineQueue(dbName);
  openQueues.push(queue);
  return queue;
}

function jpegBlob(contents: string): Blob {
  return new NodeBlob([contents], { type: "image/jpeg" }) as unknown as Blob;
}

async function enqueueQueuedPhoto(
  queue: OfflineQueuePort,
  input: {
    uid?: string;
    mediaId?: string;
    captureSessionId?: string;
    requestId?: string;
    binding?: CaptureBinding;
    blob?: Blob;
  } = {},
): Promise<void> {
  const uid = input.uid ?? "u1";
  const mediaId = input.mediaId ?? "m1";
  const captureSessionId = input.captureSessionId ?? "s1";
  const blob = input.blob ?? jpegBlob("x");

  await queue.enqueue({
    uid,
    mediaId,
    captureSessionId,
    requestId: input.requestId ?? "r1",
    descriptor: {
      mediaId,
      captureSessionId,
      kind: "photo",
      zone: "exterior",
      slotId: "exterior-1",
      required: true,
      originalFileName: "a.jpg",
      mimeType: "image/jpeg",
      sizeBytes: blob.size,
      lastModified: 1,
      capturedAt: "2026-08-09T00:00:00.000Z",
      uploadState: "queued",
      uploadProgress: 0,
    },
    blob,
    binding: input.binding ?? { draftId: "d1" },
  });
}

describe("offline capture queue schema", () => {
  it("re-exports the canonical capture contracts without redeclaring them", async () => {
    const source = await readFile(resolve(
      process.cwd(),
      "app/field/lib/offline-queue.ts",
    ), "utf8");

    expect(source).toContain('from "./types"');
    expect(source).not.toMatch(/export type UploadState\s*=/);
    expect(source).not.toMatch(/export interface CaptureBinding\s*\{/);
    expect(source).not.toMatch(/export interface CaptureAttachmentDescriptor\s*\{/);
  });

  it("creates only the approved version-one stores and indexes", async () => {
    const queue = await createQueue();
    const database = await openDB(dbName, 1);

    expect(Array.from(database.objectStoreNames)).toEqual([
      "drafts",
      "mediaQueue",
      "syncState",
    ]);

    const transaction = database.transaction(["drafts", "mediaQueue"], "readonly");
    expect(Array.from(transaction.objectStore("drafts").indexNames).sort())
      .toEqual(["by-uid"]);
    expect(Array.from(transaction.objectStore("mediaQueue").indexNames).sort())
      .toEqual(["by-session", "by-state", "by-uid"]);
    await transaction.done;

    database.close();
    queue.close();
  });
});

describe("offline capture queue ownership", () => {
  it("stores the Blob only for the owning UID and removes it atomically after finalization", async () => {
    const queue = await createQueue();
    await enqueueQueuedPhoto(queue, {
      blob: jpegBlob("abc"),
    });

    const owned = (await queue.list("u1"))[0];
    expect(owned.blob).toBeInstanceOf(NodeBlob);
    expect(owned.descriptor).not.toHaveProperty("blob");
    expect(await queue.list("u2")).toEqual([]);

    await queue.markFinalized("u1", "m1", {
      storagePath: "field-media-finalized/b1/m1.jpg",
      driveSyncState: "queued",
    });

    const finalized = (await queue.list("u1"))[0];
    expect(finalized.descriptor.uploadState).toBe("finalized");
    expect(finalized.storagePath).toBe("field-media-finalized/b1/m1.jpg");
    expect(finalized.driveSyncState).toBe("queued");
    expect(finalized.blob).toBeUndefined();
  });

  it("rechecks record ownership even when a forged owner key exists", async () => {
    const queue = await createQueue();
    const database = await openDB(dbName, 1);
    const forgedMedia: QueuedMediaRecord = {
      key: "u2:m1",
      uid: "u1",
      mediaId: "m1",
      requestId: "r1",
      captureSessionId: "s1",
      descriptor: {
        mediaId: "m1",
        captureSessionId: "s1",
        kind: "photo",
        zone: "exterior",
        slotId: "exterior-1",
        required: true,
        originalFileName: "a.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 1,
        lastModified: 1,
        capturedAt: "2026-08-09T00:00:00.000Z",
        uploadState: "queued",
        uploadProgress: 0,
      },
      binding: { draftId: "d1" },
      blob: jpegBlob("x"),
      driveSyncState: "notRequested",
      retryCount: 0,
    };

    await database.put("mediaQueue", forgedMedia);
    await database.put("drafts", {
      key: "u2:d1",
      ownerUid: "u1",
      draftId: "d1",
      draftVersion: 4,
      value: {},
      updatedAt: "2026-08-09T00:00:00.000Z",
    });

    expect(await queue.get("u2", "m1")).toBeUndefined();
    expect(await queue.getDraft("u2", "d1")).toBeUndefined();
    await expect(queue.patch("u2", "m1", { retryCount: 99 }))
      .rejects.toThrow("capture_queue_item_missing");
    expect((await database.get("mediaQueue", "u2:m1"))?.retryCount).toBe(0);
    database.close();
  });

  it("keeps draft and sync records isolated by UID and restores them after reopening", async () => {
    const queue = await createQueue();
    await queue.putDraft("u1", "d1", 4, {
      captureSessionId: "s1",
      captureAttachments: [],
    });
    await queue.putSyncState("u1", {
      lastAttemptAt: "2026-08-09T00:00:00.000Z",
      pendingCount: 1,
    });
    queue.close();

    const restored = await createQueue();
    expect(await restored.getDraft("u1", "d1")).toEqual(expect.objectContaining({
      ownerUid: "u1",
      draftVersion: 4,
    }));
    expect(await restored.getDraft("u2", "d1")).toBeUndefined();
    expect(await restored.getSyncState("u1")).toEqual(expect.objectContaining({
      uid: "u1",
      pendingCount: 1,
    }));
    expect(await restored.getSyncState("u2")).toBeUndefined();

    await restored.removeDraft("u1", "d1");
    expect(await restored.getDraft("u1", "d1")).toBeUndefined();
  });
});

describe("offline capture queue registration binding", () => {
  it("binds draft media through the registration unit-id map", async () => {
    const queue = await createQueue();
    await enqueueQueuedPhoto(queue, {
      binding: { draftId: "d1", unitLocalId: "unit-1" },
    });

    await queue.bindRegistration("u1", "s1", {
      buildingId: "b1",
      unitIds: { "unit-1": "u-101" },
      listingId: "l1",
      visitId: "v1",
    });

    expect((await queue.get("u1", "m1"))?.binding).toEqual({
      buildingId: "b1",
      unitId: "u-101",
      listingId: "l1",
      visitId: "v1",
      draftId: "d1",
      unitLocalId: "unit-1",
    });
  });

  it("rejects a missing unit mapping without partially binding the session", async () => {
    const queue = await createQueue();
    await enqueueQueuedPhoto(queue, {
      mediaId: "m1",
      binding: { draftId: "d1", unitLocalId: "unit-1" },
    });
    await enqueueQueuedPhoto(queue, {
      mediaId: "m2",
      binding: { draftId: "d1", unitLocalId: "unit-2" },
    });

    await expect(queue.bindRegistration("u1", "s1", {
      buildingId: "b1",
      unitIds: { "unit-1": "u-101" },
      listingId: "l1",
      visitId: "v1",
    })).rejects.toThrow("capture_unit_binding_missing");

    const records = await queue.list("u1", "s1");
    expect(records).toHaveLength(2);
    expect(records.every((record) => record.binding.buildingId === undefined)).toBe(true);
  });

  it("requires an own unit-map entry instead of accepting prototype properties", async () => {
    const queue = await createQueue();
    await enqueueQueuedPhoto(queue, {
      binding: { draftId: "d1", unitLocalId: "toString" },
    });

    await expect(queue.bindRegistration("u1", "s1", {
      buildingId: "b1",
      unitIds: {},
      listingId: "l1",
      visitId: "v1",
    })).rejects.toThrow("capture_unit_binding_missing");
  });
});

describe("offline capture queue completion rules", () => {
  it("lists and counts only records that still require upload finalization", async () => {
    const queue = await createQueue();
    await enqueueQueuedPhoto(queue, { mediaId: "m1" });
    await enqueueQueuedPhoto(queue, { mediaId: "m2" });

    await queue.markFinalized("u1", "m2", {
      storagePath: "field-media-finalized/b1/m2.jpg",
      driveSyncState: "queued",
    });

    expect((await queue.listPending("u1")).map((record) => record.mediaId))
      .toEqual(["m1"]);
    expect(await queue.countPending("u1")).toBe(1);
    expect(await queue.countPending("u2")).toBe(0);
  });

  it("deletes metadata only after Firebase finalization and Drive completion", async () => {
    const queue = await createQueue();
    await enqueueQueuedPhoto(queue);

    await expect(queue.deleteCompleted("u1", "m1"))
      .rejects.toThrow("capture_delete_not_complete");
    expect(await queue.get("u1", "m1")).toBeDefined();

    await queue.markFinalized("u1", "m1", {
      storagePath: "field-media-finalized/b1/m1.jpg",
      driveSyncState: "queued",
    });
    await expect(queue.deleteCompleted("u1", "m1"))
      .rejects.toThrow("capture_delete_not_complete");

    await queue.patch("u1", "m1", { driveSyncState: "complete" });
    await queue.deleteCompleted("u1", "m1");
    expect(await queue.get("u1", "m1")).toBeUndefined();
  });
});

describe("capture storage quota guard", () => {
  it("reserves the file plus five MiB for small files", async () => {
    await expect(ensureCaptureCapacity(1, async () => ({
      usage: 0,
      quota: FIVE_MEBIBYTES,
    }))).rejects.toThrow("capture_storage_quota");

    await expect(ensureCaptureCapacity(1, async () => ({
      usage: 0,
      quota: FIVE_MEBIBYTES + 1,
    }))).resolves.toBeUndefined();
  });

  it("reserves the file plus five percent for large files", async () => {
    const fileBytes = 200 * 1_024 * 1_024;
    const fivePercent = Math.ceil(fileBytes * 0.05);

    await expect(ensureCaptureCapacity(fileBytes, async () => ({
      usage: 1,
      quota: fileBytes + fivePercent,
    }))).rejects.toThrow("capture_storage_quota");
    await expect(ensureCaptureCapacity(fileBytes, async () => ({
      usage: 0,
      quota: fileBytes + fivePercent,
    }))).resolves.toBeUndefined();
  });

  it("permits the IndexedDB attempt when estimate data is unavailable", async () => {
    await expect(ensureCaptureCapacity(10_000_000, async () => ({})))
      .resolves.toBeUndefined();
    await expect(ensureCaptureCapacity(10_000_000, async () => {
      throw new Error("estimate unavailable");
    })).resolves.toBeUndefined();
  });

  it("maps QuotaExceededError without leaving a descriptor", async () => {
    const queue = await createQueue();
    const originalPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (this.name === "mediaQueue") {
        throw new DOMException("full", "QuotaExceededError");
      }
      return key === undefined
        ? originalPut.call(this, value)
        : originalPut.call(this, value, key);
    });

    await expect(enqueueQueuedPhoto(queue)).rejects.toThrow("capture_storage_quota");
    expect(await queue.get("u1", "m1")).toBeUndefined();
  });
});

describe("persistent capture storage", () => {
  it("calls persist only through the exported user-click helper", async () => {
    const persist = vi.fn().mockResolvedValue(true);
    const estimate = vi.fn().mockResolvedValue({ usage: 0, quota: 100_000_000 });
    const originalStorage = Object.getOwnPropertyDescriptor(navigator, "storage");
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { estimate, persist },
    });

    try {
      const queue = await createQueue();
      await ensureCaptureCapacity(1);
      await enqueueQueuedPhoto(queue);
      expect(persist).not.toHaveBeenCalled();

      await expect(requestPersistentCaptureStorage()).resolves.toBe(true);
      expect(persist).toHaveBeenCalledTimes(1);
    } finally {
      if (originalStorage) {
        Object.defineProperty(navigator, "storage", originalStorage);
      } else {
        Reflect.deleteProperty(navigator, "storage");
      }
    }
  });
});
