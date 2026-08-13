import {
  openDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
} from "idb";

import type { SaveFieldRegistrationResult } from "./registration-draft";
import type {
  CaptureAttachmentDescriptor,
  CaptureBinding,
  DriveSyncState,
  UploadState,
} from "./types";
export type {
  CaptureAttachmentDescriptor,
  CaptureBinding,
  DriveSyncState,
  UploadState,
} from "./types";

const DEFAULT_DATABASE_NAME = "bring-field-offline";
const DATABASE_VERSION = 1;
const FIVE_MEBIBYTES = 5 * 1_024 * 1_024;

export interface QueuedMediaRecord {
  key: string;
  uid: string;
  mediaId: string;
  requestId: string;
  captureSessionId: string;
  descriptor: CaptureAttachmentDescriptor;
  binding: CaptureBinding;
  blob?: Blob;
  stagingPath?: string;
  objectGeneration?: string;
  objectMd5Hash?: string;
  storagePath?: string;
  driveFileId?: string;
  driveFolderId?: string;
  driveResumableUri?: string;
  driveUploadedBytes?: number;
  driveSyncState: DriveSyncState;
  retryCount: number;
  lastError?: string;
}

export interface OfflineDraftRecord {
  key: string;
  ownerUid: string;
  draftId: string;
  draftVersion: number;
  value: Record<string, unknown>;
  updatedAt: string;
}

export interface CaptureSyncState {
  uid: string;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  pendingCount: number;
  lastError?: string;
}

export interface FieldOfflineDatabase extends DBSchema {
  drafts: {
    key: string;
    value: OfflineDraftRecord;
    indexes: { "by-uid": string };
  };
  mediaQueue: {
    key: string;
    value: QueuedMediaRecord;
    indexes: {
      "by-uid": string;
      "by-session": [string, string];
      "by-state": [string, UploadState];
    };
  };
  syncState: {
    key: string;
    value: CaptureSyncState;
  };
}

export interface OfflineQueuePort {
  putDraft(
    uid: string,
    draftId: string,
    draftVersion: number,
    value: Record<string, unknown>,
  ): Promise<void>;
  getDraft(uid: string, draftId: string): Promise<OfflineDraftRecord | undefined>;
  removeDraft(uid: string, draftId: string): Promise<void>;
  putSyncState(uid: string, state: Omit<CaptureSyncState, "uid">): Promise<void>;
  getSyncState(uid: string): Promise<CaptureSyncState | undefined>;
  enqueue(
    input: Omit<QueuedMediaRecord, "key" | "retryCount" | "driveSyncState">,
  ): Promise<void>;
  get(uid: string, mediaId: string): Promise<QueuedMediaRecord | undefined>;
  list(uid: string, captureSessionId?: string): Promise<QueuedMediaRecord[]>;
  listPending(uid: string): Promise<QueuedMediaRecord[]>;
  patch(uid: string, mediaId: string, patch: Partial<QueuedMediaRecord>): Promise<void>;
  markFinalized(
    uid: string,
    mediaId: string,
    result: { storagePath: string; driveSyncState: DriveSyncState },
  ): Promise<void>;
  bindRegistration(
    uid: string,
    captureSessionId: string,
    ids: SaveFieldRegistrationResult,
  ): Promise<void>;
  countPending(uid: string): Promise<number>;
  deleteCompleted(uid: string, mediaId: string): Promise<void>;
  close(): void;
}

type CaptureStorageEstimate = {
  usage?: number;
  quota?: number;
};

type CaptureStorageEstimator = () => Promise<CaptureStorageEstimate>;

function ownerKey(uid: string, id: string): string {
  return `${uid}:${id}`;
}

function isOwnedDraft(
  record: OfflineDraftRecord | undefined,
  uid: string,
  draftId: string,
): record is OfflineDraftRecord {
  return Boolean(
    record
    && record.ownerUid === uid
    && record.draftId === draftId
    && record.key === ownerKey(uid, draftId),
  );
}

function isOwnedMedia(
  record: QueuedMediaRecord | undefined,
  uid: string,
  mediaId?: string,
): record is QueuedMediaRecord {
  return Boolean(
    record
    && record.uid === uid
    && (mediaId === undefined || record.mediaId === mediaId)
    && record.key === ownerKey(uid, record.mediaId),
  );
}

function captureError(code: string): Error {
  return new Error(code);
}

function isQuotaExceeded(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "name" in error
    && error.name === "QuotaExceededError",
  );
}

function abortQuietly(
  transaction: IDBPTransaction<FieldOfflineDatabase, ["mediaQueue"], "readwrite">,
): void {
  try {
    transaction.abort();
  } catch {
    // The failed request may already have aborted the transaction.
  }
}

function defaultStorageEstimator(): CaptureStorageEstimator | undefined {
  if (typeof navigator === "undefined") return undefined;
  const estimate = navigator.storage?.estimate;
  if (typeof estimate !== "function") return undefined;
  return () => estimate.call(navigator.storage);
}

export async function ensureCaptureCapacity(
  fileBytes: number,
  estimate: CaptureStorageEstimator | undefined = defaultStorageEstimator(),
): Promise<void> {
  if (!estimate) return;

  let storage: CaptureStorageEstimate;
  try {
    storage = await estimate();
  } catch {
    return;
  }

  if (
    typeof storage.usage !== "number"
    || !Number.isFinite(storage.usage)
    || typeof storage.quota !== "number"
    || !Number.isFinite(storage.quota)
  ) {
    return;
  }

  const reserve = fileBytes + Math.max(FIVE_MEBIBYTES, Math.ceil(fileBytes * 0.05));
  if (storage.usage + reserve > storage.quota) {
    throw captureError("capture_storage_quota");
  }
}

export async function requestPersistentCaptureStorage(): Promise<boolean> {
  if (typeof navigator === "undefined") return false;
  const persist = navigator.storage?.persist;
  if (typeof persist !== "function") return false;

  try {
    return await persist.call(navigator.storage);
  } catch {
    return false;
  }
}

function createQueue(database: IDBPDatabase<FieldOfflineDatabase>): OfflineQueuePort {
  return {
    async putDraft(uid, draftId, draftVersion, value) {
      const key = ownerKey(uid, draftId);
      await database.put("drafts", {
        key,
        ownerUid: uid,
        draftId,
        draftVersion,
        value,
        updatedAt: new Date().toISOString(),
      });
    },

    async getDraft(uid, draftId) {
      const record = await database.get("drafts", ownerKey(uid, draftId));
      return isOwnedDraft(record, uid, draftId) ? record : undefined;
    },

    async removeDraft(uid, draftId) {
      const transaction = database.transaction("drafts", "readwrite");
      const key = ownerKey(uid, draftId);
      const record = await transaction.store.get(key);
      if (isOwnedDraft(record, uid, draftId)) {
        await transaction.store.delete(key);
      }
      await transaction.done;
    },

    async putSyncState(uid, state) {
      await database.put("syncState", { ...state, uid });
    },

    async getSyncState(uid) {
      const record = await database.get("syncState", uid);
      return record?.uid === uid ? record : undefined;
    },

    async enqueue(input) {
      const transaction = database.transaction("mediaQueue", "readwrite");
      const record: QueuedMediaRecord = {
        ...input,
        key: ownerKey(input.uid, input.mediaId),
        driveSyncState: "notRequested",
        retryCount: 0,
      };

      try {
        await transaction.store.put(record);
        await transaction.done;
      } catch (error) {
        abortQuietly(transaction);
        await transaction.done.catch(() => undefined);
        if (isQuotaExceeded(error)) {
          throw captureError("capture_storage_quota");
        }
        throw error;
      }
    },

    async get(uid, mediaId) {
      const record = await database.get("mediaQueue", ownerKey(uid, mediaId));
      return isOwnedMedia(record, uid, mediaId) ? record : undefined;
    },

    async list(uid, captureSessionId) {
      const transaction = database.transaction("mediaQueue", "readonly");
      const records = captureSessionId === undefined
        ? await transaction.store.index("by-uid").getAll(uid)
        : await transaction.store.index("by-session").getAll([uid, captureSessionId]);
      await transaction.done;

      return records.filter((record) => (
        isOwnedMedia(record, uid)
        && (captureSessionId === undefined || record.captureSessionId === captureSessionId)
      ));
    },

    async listPending(uid) {
      const pendingStates: UploadState[] = [
        "queued",
        "uploading",
        "objectStored",
        "finalizing",
        "failed",
      ];
      const transaction = database.transaction("mediaQueue", "readonly");
      const index = transaction.store.index("by-state");
      const requests = pendingStates.map((state) => index.getAll([uid, state]));
      const records = (await Promise.all(requests)).flat();
      await transaction.done;

      return records.filter((record) => (
        isOwnedMedia(record, uid) && record.descriptor.uploadState !== "finalized"
      ));
    },

    async patch(uid, mediaId, patch) {
      const transaction = database.transaction("mediaQueue", "readwrite");
      const key = ownerKey(uid, mediaId);
      const record = await transaction.store.get(key);
      if (!isOwnedMedia(record, uid, mediaId)) {
        await transaction.done;
        throw captureError("capture_queue_item_missing");
      }

      const next: QueuedMediaRecord = {
        ...record,
        ...patch,
        key: record.key,
        uid: record.uid,
        mediaId: record.mediaId,
        captureSessionId: record.captureSessionId,
        descriptor: patch.descriptor
          ? {
              ...patch.descriptor,
              mediaId: record.mediaId,
              captureSessionId: record.captureSessionId,
            }
          : record.descriptor,
      };
      await transaction.store.put(next);
      await transaction.done;
    },

    async markFinalized(uid, mediaId, result) {
      const transaction = database.transaction("mediaQueue", "readwrite");
      const key = ownerKey(uid, mediaId);
      const record = await transaction.store.get(key);
      if (!isOwnedMedia(record, uid, mediaId)) {
        await transaction.done;
        throw captureError("capture_queue_item_missing");
      }

      const finalized: QueuedMediaRecord = {
        ...record,
        descriptor: {
          ...record.descriptor,
          uploadState: "finalized",
          uploadProgress: 100,
        },
        storagePath: result.storagePath,
        driveSyncState: result.driveSyncState,
      };
      delete finalized.blob;

      await transaction.store.put(finalized);
      await transaction.done;
    },

    async bindRegistration(uid, captureSessionId, ids) {
      const transaction = database.transaction("mediaQueue", "readwrite");
      const records = await transaction.store.index("by-session")
        .getAll([uid, captureSessionId]);
      const owned = records.filter((record) => (
        isOwnedMedia(record, uid) && record.captureSessionId === captureSessionId
      ));

      for (const record of owned) {
        const unitLocalId = record.binding.unitLocalId;
        if (
          unitLocalId !== undefined
          && !Object.prototype.hasOwnProperty.call(ids.unitIds, unitLocalId)
        ) {
          throw captureError("capture_unit_binding_missing");
        }
      }

      for (const record of owned) {
        const unitLocalId = record.binding.unitLocalId;
        await transaction.store.put({
          ...record,
          binding: {
            ...record.binding,
            buildingId: ids.buildingId,
            unitId: unitLocalId === undefined ? undefined : ids.unitIds[unitLocalId],
            listingId: ids.listingId,
            visitId: ids.visitId,
          },
        });
      }
      await transaction.done;
    },

    async countPending(uid) {
      return (await this.listPending(uid)).length;
    },

    async deleteCompleted(uid, mediaId) {
      const transaction = database.transaction("mediaQueue", "readwrite");
      const key = ownerKey(uid, mediaId);
      const record = await transaction.store.get(key);
      if (!isOwnedMedia(record, uid, mediaId)) {
        await transaction.done;
        return;
      }
      if (
        record.descriptor.uploadState !== "finalized"
        || record.driveSyncState !== "complete"
      ) {
        throw captureError("capture_delete_not_complete");
      }

      await transaction.store.delete(key);
      await transaction.done;
    },

    close() {
      database.close();
    },
  };
}

export async function openOfflineQueue(
  databaseName = DEFAULT_DATABASE_NAME,
): Promise<OfflineQueuePort> {
  const database = await openDB<FieldOfflineDatabase>(databaseName, DATABASE_VERSION, {
    upgrade(upgradeDatabase) {
      const drafts = upgradeDatabase.createObjectStore("drafts", { keyPath: "key" });
      drafts.createIndex("by-uid", "ownerUid");

      const mediaQueue = upgradeDatabase.createObjectStore("mediaQueue", { keyPath: "key" });
      mediaQueue.createIndex("by-uid", "uid");
      mediaQueue.createIndex("by-session", ["uid", "captureSessionId"]);
      mediaQueue.createIndex("by-state", ["uid", "descriptor.uploadState"]);

      upgradeDatabase.createObjectStore("syncState", { keyPath: "uid" });
    },
  });

  return createQueue(database);
}
