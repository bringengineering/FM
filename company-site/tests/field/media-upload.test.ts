import "fake-indexeddb/auto";

import { Blob as NodeBlob } from "node:buffer";
import { deleteDB } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildStagingPath } from "../../app/field/lib/capture-policy";
import {
  MediaUploadCoordinator,
  type FinalizeFieldMediaResult,
  type MediaUploadPort,
  type StoredMediaObject,
} from "../../app/field/lib/media-upload";
import {
  openOfflineQueue,
  type OfflineQueuePort,
  type QueuedMediaRecord,
  type UploadState,
} from "../../app/field/lib/offline-queue";

const NOW = "2026-08-09T00:00:10.000Z";
const SESSION = "11111111-1111-4111-8111-111111111111";
const MEDIA_1 = "22222222-2222-4222-8222-222222222222";
const MEDIA_2 = "33333333-3333-4333-8333-333333333333";
const REQUEST_1 = "44444444-4444-4444-8444-444444444444";
const REQUEST_2 = "55555555-5555-4555-8555-555555555555";
const REPLACEMENT_MEDIA = "66666666-6666-4666-8666-666666666666";
const REPLACEMENT_REQUEST = "77777777-7777-4777-8777-777777777777";

let dbName = "";
let queues: OfflineQueuePort[] = [];

beforeEach(() => {
  dbName = `media-upload-${crypto.randomUUID()}`;
  queues = [];
});

afterEach(async () => {
  for (const queue of queues) queue.close();
  await deleteDB(dbName);
  vi.restoreAllMocks();
});

function jpegBlob(contents = "photo"): Blob {
  return new NodeBlob([contents], { type: "image/jpeg" }) as unknown as Blob;
}

async function createQueue(): Promise<OfflineQueuePort> {
  const queue = await openOfflineQueue(dbName);
  queues.push(queue);
  return queue;
}

async function enqueuePhoto(
  queue: OfflineQueuePort,
  overrides: {
    uid?: string;
    mediaId?: string;
    requestId?: string;
    uploadState?: UploadState;
    objectGeneration?: string;
    blob?: Blob;
  } = {},
): Promise<QueuedMediaRecord> {
  const uid = overrides.uid ?? "u1";
  const mediaId = overrides.mediaId ?? MEDIA_1;
  const requestId = overrides.requestId ?? REQUEST_1;
  const descriptor = {
    mediaId,
    captureSessionId: SESSION,
    kind: "photo" as const,
    zone: "exterior" as const,
    slotId: `exterior-${mediaId === MEDIA_1 ? "1" : "2"}`,
    required: true,
    originalFileName: `${mediaId}.jpg`,
    mimeType: "image/jpeg",
    sizeBytes: 5,
    lastModified: 1,
    capturedAt: "2026-08-09T00:00:00.000Z",
    uploadState: overrides.uploadState ?? "queued",
    uploadProgress: 0,
  };
  const stagingPath = buildStagingPath(uid, descriptor);

  await queue.enqueue({
    uid,
    mediaId,
    requestId,
    captureSessionId: SESSION,
    descriptor,
    binding: {
      buildingId: "building-1",
      unitId: "unit-1",
      listingId: "listing-1",
      visitId: "visit-1",
    },
    blob: overrides.blob ?? jpegBlob(),
    stagingPath,
    objectGeneration: overrides.objectGeneration,
  });

  return (await queue.get(uid, mediaId)) as QueuedMediaRecord;
}

function matchingObject(
  item: QueuedMediaRecord,
  overrides: Partial<StoredMediaObject> = {},
): StoredMediaObject {
  return {
    path: item.stagingPath as string,
    generation: "7",
    sizeBytes: item.descriptor.sizeBytes,
    contentType: item.descriptor.mimeType,
    timeCreated: "2026-08-09T00:00:05.000Z",
    md5Hash: "server-md5",
    crc32c: "server-crc",
    customMetadata: {
      capturedBy: item.uid,
      captureSessionId: item.captureSessionId,
      mediaId: item.mediaId,
    },
    ...overrides,
  };
}

function finalizedResult(
  item: QueuedMediaRecord,
  overrides: Partial<FinalizeFieldMediaResult> = {},
): FinalizeFieldMediaResult {
  return {
    mediaId: item.mediaId,
    uploadState: "finalized",
    storagePath: `field-media-finalized/building-1/${item.mediaId}.jpg`,
    driveSyncState: "queued",
    finalizedAt: NOW,
    ...overrides,
  };
}

function createPort(
  item: QueuedMediaRecord,
  overrides: Partial<MediaUploadPort> = {},
): MediaUploadPort {
  return {
    inspect: vi.fn(async () => null),
    upload: vi.fn(async (_record, progress) => {
      progress(50);
      progress(100);
      return matchingObject(item);
    }),
    finalize: vi.fn(async () => finalizedResult(item)),
    ...overrides,
  };
}

describe("MediaUploadCoordinator reconciliation", () => {
  it("inspects, uploads a missing object, finalizes it, and drops the local Blob", async () => {
    const queue = await createQueue();
    const item = await enqueuePhoto(queue);
    const order: string[] = [];
    const port = createPort(item, {
      inspect: vi.fn(async () => {
        order.push("inspect");
        return null;
      }),
      upload: vi.fn(async (_record, progress) => {
        order.push("upload");
        progress(50);
        progress(100);
        return matchingObject(item, { generation: "7" });
      }),
      finalize: vi.fn(async (input) => {
        order.push("finalize");
        expect(input.objectGeneration).toBe("7");
        return finalizedResult(item);
      }),
    });

    await new MediaUploadCoordinator(queue, port, {
      isOnline: () => true,
      now: () => NOW,
    }).resume("u1");

    expect(order).toEqual(["inspect", "upload", "finalize"]);
    expect(port.upload).toHaveBeenCalledOnce();
    expect(port.finalize).toHaveBeenCalledWith(expect.objectContaining({
      mediaId: MEDIA_1,
      captureSessionId: SESSION,
      objectGeneration: "7",
      buildingId: "building-1",
      visitId: "visit-1",
    }));
    const finalized = await queue.get("u1", MEDIA_1);
    expect(finalized?.descriptor.uploadState).toBe("finalized");
    expect(finalized?.blob).toBeUndefined();
    expect(await queue.getSyncState("u1")).toEqual(expect.objectContaining({
      pendingCount: 0,
      lastAttemptAt: NOW,
      lastSuccessAt: NOW,
    }));
    expect(await queue.getSyncState("u2")).toBeUndefined();
  });

  it("finalizes a matching completed staging object without uploading", async () => {
    const queue = await createQueue();
    const item = await enqueuePhoto(queue);
    const port = createPort(item, {
      inspect: vi.fn(async () => matchingObject(item, { generation: "8" })),
      upload: vi.fn(),
    });

    await new MediaUploadCoordinator(queue, port, { isOnline: () => true })
      .resume("u1");

    expect(port.upload).not.toHaveBeenCalled();
    expect(port.finalize).toHaveBeenCalledWith(expect.objectContaining({
      objectGeneration: "8",
    }));
    expect((await queue.get("u1", MEDIA_1))?.blob).toBeUndefined();
  });

  it("replays finalization before inspection after an ACK loss", async () => {
    const queue = await createQueue();
    const item = await enqueuePhoto(queue, {
      uploadState: "finalizing",
      objectGeneration: "8",
    });
    const port = createPort(item, {
      inspect: vi.fn(),
      upload: vi.fn(),
    });

    await new MediaUploadCoordinator(queue, port, { isOnline: () => true })
      .resume("u1");

    expect(port.finalize).toHaveBeenCalledWith(expect.objectContaining({
      objectGeneration: "8",
    }));
    expect(port.inspect).not.toHaveBeenCalled();
    expect(port.upload).not.toHaveBeenCalled();
  });

  it("rejects any metadata mismatch and never processes another UID", async () => {
    const queue = await createQueue();
    const item = await enqueuePhoto(queue);
    await enqueuePhoto(queue, { uid: "u2", mediaId: MEDIA_2, requestId: REQUEST_2 });
    const port = createPort(item, {
      inspect: vi.fn(async () => matchingObject(item, {
        customMetadata: {
          capturedBy: "u1",
          captureSessionId: SESSION,
          mediaId: MEDIA_1,
          accessCode: "must-conflict",
        },
      })),
      upload: vi.fn(),
      finalize: vi.fn(),
    });

    await new MediaUploadCoordinator(queue, port, { isOnline: () => true })
      .resume("u1");

    expect((await queue.get("u1", MEDIA_1))?.lastError)
      .toBe("storage_object_conflict");
    expect((await queue.get("u1", MEDIA_1))?.blob).toBeInstanceOf(NodeBlob);
    expect(port.upload).not.toHaveBeenCalled();
    expect(port.finalize).not.toHaveBeenCalled();
    expect(await queue.get("u2", MEDIA_2)).toEqual(expect.objectContaining({
      descriptor: expect.objectContaining({ uploadState: "queued" }),
      retryCount: 0,
    }));
  });

  it("processes large files one at a time", async () => {
    const queue = await createQueue();
    const first = await enqueuePhoto(queue);
    const second = await enqueuePhoto(queue, { mediaId: MEDIA_2, requestId: REQUEST_2 });
    let activeUploads = 0;
    let maximumActiveUploads = 0;
    const uploadOrder: string[] = [];
    const port: MediaUploadPort = {
      inspect: vi.fn(async () => null),
      upload: vi.fn(async (record) => {
        activeUploads += 1;
        maximumActiveUploads = Math.max(maximumActiveUploads, activeUploads);
        uploadOrder.push(record.mediaId);
        await Promise.resolve();
        activeUploads -= 1;
        return matchingObject(record);
      }),
      finalize: vi.fn(async (input) => finalizedResult(
        input.mediaId === first.mediaId ? first : second,
      )),
    };

    await new MediaUploadCoordinator(queue, port, { isOnline: () => true })
      .resume("u1");

    expect(maximumActiveUploads).toBe(1);
    expect(uploadOrder).toEqual([MEDIA_1, MEDIA_2]);
  });
});

describe("MediaUploadCoordinator failure and retry", () => {
  it("serializes exclusion behind an in-flight finalization and excludes the server result", async () => {
    const queue = await createQueue();
    const item = await enqueuePhoto(queue);
    const order: string[] = [];
    let releaseFinalize!: () => void;
    const finalizeGate = new Promise<void>((resolve) => {
      releaseFinalize = resolve;
    });
    const port = createPort(item, {
      finalize: vi.fn(async () => {
        order.push("finalize-start");
        await finalizeGate;
        order.push("finalize-end");
        return finalizedResult(item);
      }),
      exclude: vi.fn(async (input) => {
        order.push("exclude");
        expect(input).toEqual({
          mediaId: MEDIA_1,
          requestId: REPLACEMENT_REQUEST,
        });
      }),
    });
    const coordinator = new MediaUploadCoordinator(queue, port, {
      isOnline: () => true,
      createId: () => REPLACEMENT_REQUEST,
      now: () => NOW,
    });

    const resume = coordinator.resume("u1");
    await vi.waitFor(() => expect(order).toEqual(["finalize-start"]));
    const exclusion = coordinator.exclude("u1", MEDIA_1, true);
    releaseFinalize();
    await Promise.all([resume, exclusion]);

    expect(order).toEqual(["finalize-start", "finalize-end", "exclude"]);
    expect(port.exclude).toHaveBeenCalledOnce();
    expect(await queue.get("u1", MEDIA_1)).toEqual(expect.objectContaining({
      blob: undefined,
      lastError: "capture_excluded",
      descriptor: expect.objectContaining({
        uploadState: "finalized",
        uploadProgress: 100,
        failureCode: "capture_excluded",
      }),
    }));
  });

  it("retains the Blob, increments retry state, and redacts raw failures", async () => {
    const queue = await createQueue();
    const item = await enqueuePhoto(queue);
    const secretError = Object.assign(new Error("owner access code 1234"), {
      code: "storage/retry-limit-exceeded",
    });
    const port = createPort(item, {
      inspect: vi.fn(async () => { throw secretError; }),
    });

    await new MediaUploadCoordinator(queue, port, {
      isOnline: () => true,
      now: () => NOW,
    }).resume("u1");

    const failed = await queue.get("u1", MEDIA_1);
    expect(failed).toEqual(expect.objectContaining({
      retryCount: 1,
      lastError: "network_retry",
      blob: expect.any(NodeBlob),
    }));
    expect(failed?.descriptor).toEqual(expect.objectContaining({
      uploadState: "failed",
      failureCode: "network_retry",
    }));
    expect(await queue.getSyncState("u1")).toEqual(expect.objectContaining({
      pendingCount: 1,
      lastError: "network_retry",
    }));
    expect(JSON.stringify({ failed, sync: await queue.getSyncState("u1") }))
      .not.toContain("access code");
  });

  it("maps permission failures to the stable claim error", async () => {
    const queue = await createQueue();
    const item = await enqueuePhoto(queue);
    const port = createPort(item, {
      inspect: vi.fn(async () => {
        throw Object.assign(new Error("raw firebase details"), {
          code: "storage/unauthorized",
        });
      }),
    });

    await new MediaUploadCoordinator(queue, port, { isOnline: () => true })
      .resume("u1");

    expect((await queue.get("u1", MEDIA_1))?.lastError)
      .toBe("field_claim_required");
  });

  it("shows finalization failures as retryable and replays only finalization", async () => {
    const queue = await createQueue();
    const item = await enqueuePhoto(queue);
    const finalize = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("denied"), {
        code: "functions/permission-denied",
      }))
      .mockResolvedValueOnce(finalizedResult(item));
    const port = createPort(item, { finalize });
    const coordinator = new MediaUploadCoordinator(queue, port, {
      isOnline: () => true,
      now: () => NOW,
    });

    await coordinator.resume("u1");

    expect(await queue.get("u1", MEDIA_1)).toEqual(expect.objectContaining({
      objectGeneration: "7",
      lastError: "field_claim_required",
      descriptor: expect.objectContaining({
        uploadState: "failed",
        failureCode: "field_claim_required",
      }),
    }));

    await coordinator.retry("u1", MEDIA_1);

    expect(finalize).toHaveBeenCalledTimes(2);
    expect(port.inspect).toHaveBeenCalledOnce();
    expect(port.upload).toHaveBeenCalledOnce();
    expect((await queue.get("u1", MEDIA_1))?.descriptor.uploadState)
      .toBe("finalized");
  });

  it("retries a conflict under fresh stable IDs without overwriting the old path", async () => {
    const queue = await createQueue();
    const item = await enqueuePhoto(queue);
    let online = true;
    const ids = [REPLACEMENT_MEDIA, REPLACEMENT_REQUEST];
    const port = createPort(item, {
      inspect: vi.fn(async () => matchingObject(item, { sizeBytes: 999 })),
      upload: vi.fn(),
      finalize: vi.fn(),
    });
    const coordinator = new MediaUploadCoordinator(queue, port, {
      isOnline: () => online,
      createId: () => ids.shift() as string,
      now: () => NOW,
    });

    await coordinator.resume("u1");
    online = false;
    await coordinator.retry("u1", MEDIA_1);

    const oldItem = await queue.get("u1", MEDIA_1);
    const replacement = await queue.get("u1", REPLACEMENT_MEDIA);
    expect(oldItem).toEqual(expect.objectContaining({
      blob: undefined,
      lastError: "storage_object_replaced",
      descriptor: expect.objectContaining({
        uploadState: "finalized",
        failureCode: "storage_object_replaced",
      }),
    }));
    expect(replacement).toEqual(expect.objectContaining({
      requestId: REPLACEMENT_REQUEST,
      blob: expect.any(NodeBlob),
      descriptor: expect.objectContaining({
        mediaId: REPLACEMENT_MEDIA,
        uploadState: "queued",
      }),
    }));
    expect(replacement?.descriptor).not.toHaveProperty("replacesMediaId");
    expect(replacement?.stagingPath).toBeUndefined();
    expect(port.upload).not.toHaveBeenCalled();
  });
});

describe("MediaUploadCoordinator online lifecycle", () => {
  it("starts immediately, listens for online, and cleanup prevents stale commits", async () => {
    const queue = await createQueue();
    const item = await enqueuePhoto(queue);
    const onlineTarget = new EventTarget();
    let finishInspect!: (object: StoredMediaObject | null) => void;
    const inspectPending = new Promise<StoredMediaObject | null>((resolve) => {
      finishInspect = resolve;
    });
    const port = createPort(item, {
      inspect: vi.fn(() => inspectPending),
      upload: vi.fn(),
      finalize: vi.fn(),
    });
    const coordinator = new MediaUploadCoordinator(queue, port, {
      isOnline: () => true,
      onlineTarget,
      now: () => NOW,
    });

    const stop = coordinator.start("u1");
    await vi.waitFor(() => expect(port.inspect).toHaveBeenCalledOnce());
    stop();
    finishInspect(matchingObject(item));
    await vi.waitFor(() => {
      expect(port.finalize).not.toHaveBeenCalled();
      expect(port.upload).not.toHaveBeenCalled();
    });

    onlineTarget.dispatchEvent(new Event("online"));
    await Promise.resolve();
    expect(port.inspect).toHaveBeenCalledOnce();
    expect((await queue.get("u1", MEDIA_1))?.descriptor.uploadState).toBe("queued");
  });
});
