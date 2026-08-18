import { describe, expect, it, vi } from "vitest";

import {
  createFirebaseMediaUploadPort,
  type FirebaseMediaUploadDependencies,
  type FirebaseStorageMetadata,
  type FirebaseUploadTask,
} from "../../app/field/lib/firebase-media-upload";
import type {
  FinalizeFieldMediaInput,
  FinalizeFieldMediaResult,
} from "../../app/field/lib/media-upload";
import type { QueuedMediaRecord } from "../../app/field/lib/offline-queue";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const MEDIA_ID = "22222222-2222-4222-8222-222222222222";
const STAGING_PATH = `field-media/staff-1/${SESSION_ID}/photos/${MEDIA_ID}.jpg`;

function metadata(
  overrides: Partial<FirebaseStorageMetadata> = {},
): FirebaseStorageMetadata {
  return {
    fullPath: STAGING_PATH,
    generation: "generation-7",
    size: 3,
    contentType: "image/jpeg",
    timeCreated: "2026-08-10T00:00:00.000Z",
    md5Hash: "md5-value",
    customMetadata: {
      captureSessionId: SESSION_ID,
      capturedBy: "staff-1",
      mediaId: MEDIA_ID,
    },
    ...overrides,
  };
}

function queuedPhoto(): QueuedMediaRecord {
  return {
    key: `staff-1:${MEDIA_ID}`,
    uid: "staff-1",
    mediaId: MEDIA_ID,
    requestId: "33333333-3333-4333-8333-333333333333",
    captureSessionId: SESSION_ID,
    descriptor: {
      mediaId: MEDIA_ID,
      captureSessionId: SESSION_ID,
      kind: "photo",
      zone: "exterior",
      slotId: "exterior-1",
      required: true,
      originalFileName: "outside.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 3,
      lastModified: 1,
      capturedAt: "2026-08-10T00:00:00.000Z",
      uploadState: "uploading",
      uploadProgress: 0,
    },
    binding: {
      buildingId: "building-1",
      unitId: "unit-1",
      listingId: "listing-1",
      visitId: "visit-1",
    },
    blob: new Blob(["abc"], { type: "image/jpeg" }),
    stagingPath: STAGING_PATH,
    driveSyncState: "notRequested",
    retryCount: 0,
  };
}

function dependencies(
  overrides: Partial<FirebaseMediaUploadDependencies> = {},
): FirebaseMediaUploadDependencies {
  return {
    storage: { name: "test-storage" },
    ref: vi.fn((_storage, path) => ({ fullPath: path })),
    getMetadata: vi.fn(async () => metadata()),
    uploadBytesResumable: vi.fn(() => ({
      on: vi.fn(),
      snapshot: { metadata: metadata() },
    })),
    finalizeFieldMedia: vi.fn(async (
      input: FinalizeFieldMediaInput,
    ): Promise<FinalizeFieldMediaResult> => ({
      mediaId: input.mediaId,
      uploadState: "finalized",
      storagePath: `field-media-finalized/${input.buildingId}/${input.mediaId}.jpg`,
      driveSyncState: "queued",
      finalizedAt: "2026-08-10T00:01:00.000Z",
    })),
    excludeFieldMedia: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("Firebase media upload port", () => {
  it("inspects a storage object and maps only durable metadata", async () => {
    const injected = dependencies({
      getMetadata: vi.fn(async () => metadata({ crc32c: "crc-value" })),
    });
    const port = createFirebaseMediaUploadPort(injected);

    await expect(port.inspect(STAGING_PATH)).resolves.toEqual({
      path: STAGING_PATH,
      generation: "generation-7",
      sizeBytes: 3,
      contentType: "image/jpeg",
      timeCreated: "2026-08-10T00:00:00.000Z",
      md5Hash: "md5-value",
      crc32c: "crc-value",
      customMetadata: {
        captureSessionId: SESSION_ID,
        capturedBy: "staff-1",
        mediaId: MEDIA_ID,
      },
    });
    expect(injected.ref).toHaveBeenCalledWith(injected.storage, STAGING_PATH);
    expect(injected.getMetadata).toHaveBeenCalledWith({ fullPath: STAGING_PATH });
  });

  it("returns null only for storage/object-not-found", async () => {
    const missing = dependencies({
      getMetadata: vi.fn(async () => {
        throw { code: "storage/object-not-found" };
      }),
    });
    await expect(createFirebaseMediaUploadPort(missing).inspect(STAGING_PATH))
      .resolves.toBeNull();

    const denied = { code: "storage/unauthorized" };
    const unauthorized = dependencies({
      getMetadata: vi.fn(async () => {
        throw denied;
      }),
    });
    await expect(createFirebaseMediaUploadPort(unauthorized).inspect(STAGING_PATH))
      .rejects.toBe(denied);
  });

  it("uploads the Blob with exact identity metadata and reports resumable progress", async () => {
    let next: ((snapshot: { bytesTransferred: number; totalBytes: number }) => void) | undefined;
    let complete: (() => void) | undefined;
    const task: FirebaseUploadTask = {
      snapshot: { metadata: metadata() },
      on: vi.fn((_event, onNext, _onError, onComplete) => {
        next = onNext;
        complete = onComplete;
        queueMicrotask(() => {
          next?.({ bytesTransferred: 1, totalBytes: 4 });
          next?.({ bytesTransferred: 4, totalBytes: 4 });
          complete?.();
        });
        return () => undefined;
      }),
    };
    const injected = dependencies({
      uploadBytesResumable: vi.fn(() => task),
    });
    const progress: number[] = [];

    const stored = await createFirebaseMediaUploadPort(injected)
      .upload(queuedPhoto(), (percent) => progress.push(percent));

    expect(injected.uploadBytesResumable).toHaveBeenCalledWith(
      { fullPath: STAGING_PATH },
      expect.any(Blob),
      {
        contentType: "image/jpeg",
        customMetadata: {
          captureSessionId: SESSION_ID,
          capturedBy: "staff-1",
          mediaId: MEDIA_ID,
        },
      },
    );
    expect(progress).toEqual([25, 100]);
    expect(stored).toEqual(expect.objectContaining({
      path: STAGING_PATH,
      generation: "generation-7",
      sizeBytes: 3,
    }));
  });

  it("delegates finalization without changing the callable payload", async () => {
    const finalizeFieldMedia = vi.fn(async (
      input: FinalizeFieldMediaInput,
    ): Promise<FinalizeFieldMediaResult> => ({
      mediaId: input.mediaId,
      uploadState: "finalized",
      storagePath: `field-media-finalized/${input.buildingId}/${input.mediaId}.jpg`,
      driveSyncState: "queued",
      finalizedAt: "2026-08-10T00:01:00.000Z",
    }));
    const injected = dependencies({ finalizeFieldMedia });
    const input: FinalizeFieldMediaInput = {
      requestId: "33333333-3333-4333-8333-333333333333",
      mediaId: MEDIA_ID,
      captureSessionId: SESSION_ID,
      objectGeneration: "generation-7",
      stagingPath: STAGING_PATH,
      buildingId: "building-1",
      unitId: "unit-1",
      listingId: "listing-1",
      visitId: "visit-1",
      kind: "photo",
      zone: "exterior",
      slotId: "exterior-1",
      required: true,
      originalFileName: "outside.jpg",
      capturedAt: "2026-08-10T00:00:00.000Z",
    };

    const result = await createFirebaseMediaUploadPort(injected).finalize(input);

    expect(finalizeFieldMedia).toHaveBeenCalledOnce();
    expect(finalizeFieldMedia).toHaveBeenCalledWith(input);
    expect(result).toEqual(expect.objectContaining({
      mediaId: MEDIA_ID,
      uploadState: "finalized",
      driveSyncState: "queued",
    }));
  });

  it("delegates exclusion without changing the callable payload", async () => {
    const excludeFieldMedia = vi.fn(async () => undefined);
    const port = createFirebaseMediaUploadPort(dependencies({ excludeFieldMedia }));
    const input = {
      mediaId: MEDIA_ID,
      requestId: "44444444-4444-4444-8444-444444444444",
    };

    await port.exclude?.(input);

    expect(excludeFieldMedia).toHaveBeenCalledOnce();
    expect(excludeFieldMedia).toHaveBeenCalledWith(input);
  });
});
