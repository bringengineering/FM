import { buildStagingPath } from "./capture-policy";
import type {
  OfflineQueuePort,
  QueuedMediaRecord,
} from "./offline-queue";
import type { MediaZone, UploadState } from "./types";

export interface StoredMediaObject {
  path: string;
  generation: string;
  sizeBytes: number;
  contentType: string;
  timeCreated: string;
  md5Hash?: string;
  crc32c?: string;
  customMetadata: Record<string, string>;
}

export interface FinalizeFieldMediaInput {
  requestId: string;
  mediaId: string;
  captureSessionId: string;
  objectGeneration: string;
  stagingPath: string;
  buildingId: string;
  unitId?: string;
  listingId?: string;
  visitId: string;
  kind: "photo" | "video";
  zone: MediaZone;
  slotId: string;
  required: boolean;
  originalFileName: string;
  capturedAt: string;
  replacesMediaId?: string;
  videoMetadata?: {
    durationSeconds: number;
    width: number;
    height: number;
  };
}

export interface FinalizeFieldMediaResult {
  mediaId: string;
  uploadState: "finalized";
  storagePath: string;
  driveSyncState: "queued";
  finalizedAt: string;
}

export interface MediaUploadPort {
  inspect(path: string): Promise<StoredMediaObject | null>;
  upload(
    item: QueuedMediaRecord,
    onProgress: (percent: number) => void,
  ): Promise<StoredMediaObject>;
  finalize(input: FinalizeFieldMediaInput): Promise<FinalizeFieldMediaResult>;
}

interface OnlineEventTarget {
  addEventListener(type: "online", listener: EventListener): void;
  removeEventListener(type: "online", listener: EventListener): void;
}

export interface MediaUploadEnvironment {
  isOnline(): boolean;
  now?(): string;
  createId?(): string;
  onlineTarget?: OnlineEventTarget;
}

type UploadFailureCode =
  | "network_retry"
  | "field_claim_required"
  | "storage_upload_failed"
  | "storage_object_conflict";

type ActiveCheck = () => boolean;

const EXPECTED_CUSTOM_METADATA = [
  "captureSessionId",
  "capturedBy",
  "mediaId",
] as const;

const REPLAY_STATES = new Set<UploadState>(["objectStored", "finalizing"]);

function defaultIsOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

function defaultNow(): string {
  return new Date().toISOString();
}

function defaultCreateId(): string {
  return crypto.randomUUID();
}

function defaultOnlineTarget(): OnlineEventTarget | undefined {
  return typeof window === "undefined" ? undefined : window;
}

function redactedFailureCode(error: unknown): Exclude<UploadFailureCode, "storage_object_conflict"> {
  const record = error && typeof error === "object"
    ? error as { code?: unknown; name?: unknown }
    : undefined;
  const signal = [record?.code, record?.name]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  if (/network|offline|timeout|unavailable|retry-limit|cancelled|canceled/u.test(signal)) {
    return "network_retry";
  }
  if (/unauth|permission|forbidden|claim|assignment|denied/u.test(signal)) {
    return "field_claim_required";
  }
  return "storage_upload_failed";
}

function exactStoredObjectMatch(
  item: QueuedMediaRecord,
  expectedPath: string,
  object: StoredMediaObject,
): boolean {
  const metadataKeys = Object.keys(object.customMetadata).sort();
  return object.path === expectedPath
    && object.generation.length > 0
    && object.sizeBytes === item.descriptor.sizeBytes
    && object.contentType === item.descriptor.mimeType
    && metadataKeys.length === EXPECTED_CUSTOM_METADATA.length
    && EXPECTED_CUSTOM_METADATA.every((key, index) => metadataKeys[index] === key)
    && object.customMetadata.capturedBy === item.uid
    && object.customMetadata.captureSessionId === item.captureSessionId
    && object.customMetadata.mediaId === item.mediaId;
}

function progressPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function processingPriority(item: QueuedMediaRecord): number {
  return REPLAY_STATES.has(item.descriptor.uploadState) && item.objectGeneration ? 0 : 1;
}

function finalizeInput(
  item: QueuedMediaRecord,
  stagingPath: string,
  objectGeneration: string,
): FinalizeFieldMediaInput {
  const { buildingId, unitId, listingId, visitId } = item.binding;
  if (!buildingId || !visitId) {
    throw new Error("capture_registration_binding_missing");
  }

  return {
    requestId: item.requestId,
    mediaId: item.mediaId,
    captureSessionId: item.captureSessionId,
    objectGeneration,
    stagingPath,
    buildingId,
    unitId,
    listingId,
    visitId,
    kind: item.descriptor.kind,
    zone: item.descriptor.zone,
    slotId: item.descriptor.slotId,
    required: item.descriptor.required,
    originalFileName: item.descriptor.originalFileName,
    capturedAt: item.descriptor.capturedAt,
    replacesMediaId: item.descriptor.replacesMediaId,
    videoMetadata: item.descriptor.videoMetadata,
  };
}

export class MediaUploadCoordinator {
  private readonly isOnline: () => boolean;
  private readonly now: () => string;
  private readonly createId: () => string;
  private readonly onlineTarget: OnlineEventTarget | undefined;
  private work = Promise.resolve();
  private startGeneration = 0;

  constructor(
    private readonly queue: OfflineQueuePort,
    private readonly port: MediaUploadPort,
    environment: MediaUploadEnvironment = { isOnline: defaultIsOnline },
  ) {
    this.isOnline = environment.isOnline;
    this.now = environment.now ?? defaultNow;
    this.createId = environment.createId ?? defaultCreateId;
    this.onlineTarget = environment.onlineTarget ?? defaultOnlineTarget();
  }

  start(uid: string): () => void {
    const generation = ++this.startGeneration;
    let active = true;
    const isActive = () => active && generation === this.startGeneration;
    const trigger = () => {
      if (!isActive()) return;
      void this.serialize(() => this.resumePass(uid, isActive));
    };
    const onlineListener: EventListener = () => trigger();

    trigger();
    this.onlineTarget?.addEventListener("online", onlineListener);

    return () => {
      if (!active) return;
      active = false;
      if (generation === this.startGeneration) this.startGeneration += 1;
      this.onlineTarget?.removeEventListener("online", onlineListener);
    };
  }

  resume(uid: string): Promise<void> {
    return this.serialize(() => this.resumePass(uid, () => true));
  }

  retry(uid: string, mediaId: string): Promise<void> {
    return this.serialize(async () => {
      const item = await this.queue.get(uid, mediaId);
      if (!item) throw new Error("capture_queue_item_missing");

      if (item.lastError === "storage_object_conflict") {
        if (!item.blob) throw new Error("capture_blob_missing");
        const replacementMediaId = this.createId();
        const replacementRequestId = this.createId();
        await this.queue.enqueue({
          uid,
          mediaId: replacementMediaId,
          requestId: replacementRequestId,
          captureSessionId: item.captureSessionId,
          descriptor: {
            ...item.descriptor,
            mediaId: replacementMediaId,
            uploadState: "queued",
            uploadProgress: 0,
            failureCode: undefined,
            replacesMediaId: item.mediaId,
          },
          binding: item.binding,
          blob: item.blob,
        });
        await this.queue.patch(uid, mediaId, {
          blob: undefined,
          lastError: "storage_object_replaced",
          descriptor: {
            ...item.descriptor,
            uploadState: "finalized",
            failureCode: "storage_object_replaced",
          },
        });
      } else {
        const replayable = REPLAY_STATES.has(item.descriptor.uploadState)
          && Boolean(item.objectGeneration);
        await this.queue.patch(uid, mediaId, {
          lastError: undefined,
          descriptor: {
            ...item.descriptor,
            uploadState: replayable ? item.descriptor.uploadState : "queued",
            uploadProgress: replayable ? item.descriptor.uploadProgress : 0,
            failureCode: undefined,
          },
        });
      }

      await this.resumePass(uid, () => true);
    });
  }

  private serialize(operation: () => Promise<void>): Promise<void> {
    const result = this.work.then(operation);
    this.work = result.catch(() => undefined);
    return result;
  }

  private async resumePass(uid: string, isActive: ActiveCheck): Promise<void> {
    if (!isActive()) return;
    const lastAttemptAt = this.now();
    const previous = await this.queue.getSyncState(uid);
    const pendingBefore = await this.queue.countPending(uid);
    if (!isActive()) return;

    const online = this.isOnline();
    await this.queue.putSyncState(uid, {
      lastAttemptAt,
      lastSuccessAt: previous?.lastSuccessAt,
      pendingCount: pendingBefore,
      lastError: online ? undefined : "network_retry",
    });
    if (!online || !isActive()) return;

    const failures: UploadFailureCode[] = [];
    let items: QueuedMediaRecord[] = [];
    try {
      items = await this.queue.listPending(uid);
      items.sort((left, right) => (
        processingPriority(left) - processingPriority(right)
        || left.descriptor.capturedAt.localeCompare(right.descriptor.capturedAt)
        || left.mediaId.localeCompare(right.mediaId)
      ));
      for (const item of items) {
        if (!isActive()) return;
        const failure = await this.processItem(item, isActive);
        if (failure) failures.push(failure);
      }
    } catch (error) {
      failures.push(redactedFailureCode(error));
    }

    if (!isActive()) return;
    const pendingCount = await this.queue.countPending(uid);
    if (!isActive()) return;
    await this.queue.putSyncState(uid, {
      lastAttemptAt,
      lastSuccessAt: failures.length === 0 ? this.now() : previous?.lastSuccessAt,
      pendingCount,
      lastError: failures[0],
    });
  }

  private async processItem(
    item: QueuedMediaRecord,
    isActive: ActiveCheck,
  ): Promise<UploadFailureCode | undefined> {
    let stagingPath: string;
    try {
      stagingPath = buildStagingPath(item.uid, item.descriptor);
    } catch (error) {
      return this.failItem(item, redactedFailureCode(error), "failed", isActive);
    }
    if (item.stagingPath && item.stagingPath !== stagingPath) {
      return this.failItem(item, "storage_object_conflict", "failed", isActive);
    }

    if (
      REPLAY_STATES.has(item.descriptor.uploadState)
      && item.objectGeneration
    ) {
      return this.finalizeItem(
        { ...item, stagingPath },
        stagingPath,
        item.objectGeneration,
        isActive,
      );
    }

    let storedObject: StoredMediaObject | null;
    try {
      storedObject = await this.port.inspect(stagingPath);
    } catch (error) {
      return this.failItem(item, redactedFailureCode(error), "failed", isActive);
    }
    if (!isActive()) return undefined;

    if (storedObject) {
      if (!exactStoredObjectMatch(item, stagingPath, storedObject)) {
        return this.failItem(item, "storage_object_conflict", "failed", isActive);
      }
      const objectStored = await this.persistStoredObject(
        item,
        stagingPath,
        storedObject,
        isActive,
      );
      if (!objectStored) return undefined;
      return this.finalizeItem(
        objectStored,
        stagingPath,
        storedObject.generation,
        isActive,
      );
    }

    if (!item.blob) {
      return this.failItem(item, "storage_upload_failed", "failed", isActive);
    }

    const uploading: QueuedMediaRecord = {
      ...item,
      stagingPath,
      lastError: undefined,
      descriptor: {
        ...item.descriptor,
        uploadState: "uploading",
        failureCode: undefined,
      },
    };
    if (!isActive()) return undefined;
    await this.queue.patch(item.uid, item.mediaId, {
      stagingPath,
      lastError: undefined,
      descriptor: uploading.descriptor,
    });
    if (!isActive()) return undefined;

    let progressDescriptor = uploading.descriptor;
    let progressWrites = Promise.resolve();
    let uploadedObject: StoredMediaObject;
    try {
      uploadedObject = await this.port.upload(uploading, (percent) => {
        progressDescriptor = {
          ...progressDescriptor,
          uploadProgress: progressPercent(percent),
        };
        progressWrites = progressWrites.then(async () => {
          if (!isActive()) return;
          await this.queue.patch(item.uid, item.mediaId, {
            descriptor: progressDescriptor,
          });
        });
      });
      await progressWrites;
    } catch (error) {
      return this.failItem(item, redactedFailureCode(error), "failed", isActive);
    }
    if (!isActive()) return undefined;

    if (!exactStoredObjectMatch(item, stagingPath, uploadedObject)) {
      return this.failItem(item, "storage_object_conflict", "failed", isActive);
    }
    const objectStored = await this.persistStoredObject(
      item,
      stagingPath,
      uploadedObject,
      isActive,
    );
    if (!objectStored) return undefined;
    return this.finalizeItem(
      objectStored,
      stagingPath,
      uploadedObject.generation,
      isActive,
    );
  }

  private async persistStoredObject(
    item: QueuedMediaRecord,
    stagingPath: string,
    object: StoredMediaObject,
    isActive: ActiveCheck,
  ): Promise<QueuedMediaRecord | undefined> {
    if (!isActive()) return undefined;
    const objectStored: QueuedMediaRecord = {
      ...item,
      stagingPath,
      objectGeneration: object.generation,
      objectMd5Hash: object.md5Hash,
      lastError: undefined,
      descriptor: {
        ...item.descriptor,
        uploadState: "objectStored",
        uploadProgress: 100,
        failureCode: undefined,
      },
    };
    await this.queue.patch(item.uid, item.mediaId, {
      stagingPath,
      objectGeneration: object.generation,
      objectMd5Hash: object.md5Hash,
      lastError: undefined,
      descriptor: objectStored.descriptor,
    });
    return objectStored;
  }

  private async finalizeItem(
    item: QueuedMediaRecord,
    stagingPath: string,
    objectGeneration: string,
    isActive: ActiveCheck,
  ): Promise<UploadFailureCode | undefined> {
    if (!isActive()) return undefined;
    const finalizingDescriptor = {
      ...item.descriptor,
      uploadState: "finalizing" as const,
      uploadProgress: 100,
      failureCode: undefined,
    };
    await this.queue.patch(item.uid, item.mediaId, {
      stagingPath,
      objectGeneration,
      lastError: undefined,
      descriptor: finalizingDescriptor,
    });
    if (!isActive()) return undefined;

    let result: FinalizeFieldMediaResult;
    try {
      result = await this.port.finalize(finalizeInput(
        { ...item, stagingPath, objectGeneration, descriptor: finalizingDescriptor },
        stagingPath,
        objectGeneration,
      ));
    } catch (error) {
      return this.failItem(item, redactedFailureCode(error), "finalizing", isActive);
    }
    if (!isActive()) return undefined;
    if (
      result.mediaId !== item.mediaId
      || result.uploadState !== "finalized"
      || result.driveSyncState !== "queued"
    ) {
      return this.failItem(item, "storage_upload_failed", "finalizing", isActive);
    }

    await this.queue.markFinalized(item.uid, item.mediaId, {
      storagePath: result.storagePath,
      driveSyncState: result.driveSyncState,
    });
    return undefined;
  }

  private async failItem(
    item: QueuedMediaRecord,
    code: UploadFailureCode,
    state: "failed" | "finalizing",
    isActive: ActiveCheck,
  ): Promise<UploadFailureCode | undefined> {
    if (!isActive()) return undefined;
    await this.queue.patch(item.uid, item.mediaId, {
      retryCount: item.retryCount + 1,
      lastError: code,
      descriptor: {
        ...item.descriptor,
        uploadState: state,
        failureCode: code,
      },
    });
    return code;
  }
}
