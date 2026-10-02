"use client";

import { get, ref, update } from "firebase/database";

import { buildStagingPath, CAPTURE_ZONES } from "./capture-policy";
import { driveTokenManager } from "./drive-auth.client";
import {
  buildDriveFolderPlan,
  buildDriveMediaFileName,
  DRIVE_ROOT_FOLDER_ID,
} from "./drive-folders";
import { database } from "./firebase.client";
import { GoogleDriveClient } from "./google-drive.client";
import type {
  FinalizeFieldMediaInput,
  FinalizeFieldMediaResult,
  MediaUploadPort,
  StoredMediaObject,
} from "./media-upload";
import type { OfflineQueuePort } from "./offline-queue";
import type { MediaRecord } from "./types";

const RESUMABLE_THRESHOLD = 8 * 1024 * 1024;

export interface DirectDriveMediaDependencies {
  drive: GoogleDriveClient;
  queue: OfflineQueuePort;
  rootFolderId: string;
  now(): string;
  read(path: string): Promise<unknown>;
  update(patch: Record<string, unknown>): Promise<void>;
}

function asRecordMap<T>(value: unknown): Record<string, T> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, T>;
}

function storedObject(
  path: string,
  file: { id: string; size?: string; mimeType: string; appProperties?: Record<string, string> },
): StoredMediaObject {
  const properties = file.appProperties ?? {};
  const size = Number(file.size ?? properties.bringSizeBytes);
  return {
    path,
    generation: file.id,
    sizeBytes: Number.isFinite(size) ? size : -1,
    contentType: file.mimeType,
    timeCreated: properties.bringCapturedAt ?? new Date(0).toISOString(),
    customMetadata: {
      captureSessionId: properties.bringCaptureSessionId ?? "",
      capturedBy: properties.bringCapturedBy ?? "",
      mediaId: properties.bringMediaId ?? "",
    },
  };
}

function requiredPolicyComplete(media: MediaRecord[], captureSessionId: string): boolean {
  const eligible = media.filter((item) => item.captureSessionId === captureSessionId
    && item.uploadState === "finalized"
    && !item.excludedAt);
  return CAPTURE_ZONES.filter((zone) => zone.required).every((zone) => (
    eligible.filter((item) => item.zone === zone.id && item.kind === zone.kind).length >= zone.minimum
  ));
}

function mediaIdFromStagingPath(path: string): string | null {
  const match = /\/([0-9a-f-]{36})\.[a-z0-9]+$/i.exec(path);
  return match?.[1] ?? null;
}

export function createDirectDriveMediaUploadPort(
  dependencies: DirectDriveMediaDependencies,
): MediaUploadPort {
  return {
    async inspect(path) {
      const mediaId = mediaIdFromStagingPath(path);
      if (!mediaId) return null;
      const file = await dependencies.drive.findByAppProperty("bringMediaId", mediaId);
      return file ? storedObject(path, file) : null;
    },

    async upload(item, onProgress) {
      const { buildingId, unitId } = item.binding;
      if (!buildingId || !item.blob) throw new Error("capture_registration_binding_missing");
      const expectedPath = buildStagingPath(item.uid, item.descriptor);
      const existing = await dependencies.drive.findByAppProperty("bringMediaId", item.mediaId);
      if (existing) {
        onProgress(100);
        return storedObject(expectedPath, existing);
      }
      const [rawBuilding, rawUnit] = await Promise.all([
        dependencies.read(`fieldPlatform/buildings/${buildingId}`),
        unitId ? dependencies.read(`fieldPlatform/units/${unitId}`) : null,
      ]);
      const building = rawBuilding as { managementNumber?: unknown; name?: unknown; roadAddress?: unknown } | null;
      const unit = rawUnit as { unitLabel?: unknown } | null;
      if (!building || typeof building.managementNumber !== "string" || typeof building.name !== "string" || typeof building.roadAddress !== "string") {
        throw new Error("capture_registration_binding_missing");
      }
      const folderId = await dependencies.drive.ensureFolderPath(
        dependencies.rootFolderId,
        buildDriveFolderPlan({
          managementNumber: building.managementNumber,
          buildingName: building.name,
          roadAddress: building.roadAddress,
          unitLabel: typeof unit?.unitLabel === "string" ? unit.unitLabel : undefined,
          capturedAt: item.descriptor.capturedAt,
          captureSessionId: item.captureSessionId,
          zone: item.descriptor.zone,
        }),
      );
      const name = buildDriveMediaFileName(item.descriptor);
      const appProperties = {
        bringMediaId: item.mediaId,
        bringCapturedBy: item.uid,
        bringCaptureSessionId: item.captureSessionId,
        bringBuildingId: buildingId,
        bringSizeBytes: String(item.descriptor.sizeBytes),
        bringCapturedAt: item.descriptor.capturedAt,
      };
      let file;
      if (item.blob.size >= RESUMABLE_THRESHOLD) {
        const sessionUrl = item.driveResumableUri ?? await dependencies.drive.startResumableUpload({
          parentId: folderId,
          name,
          mimeType: item.descriptor.mimeType,
          sizeBytes: item.blob.size,
          appProperties,
        });
        if (!item.driveResumableUri) {
          await dependencies.queue.patch(item.uid, item.mediaId, {
            driveFolderId: folderId,
            driveResumableUri: sessionUrl,
            driveUploadedBytes: 0,
          });
        }
        file = await dependencies.drive.uploadResumable({
          sessionUrl,
          blob: item.blob,
          mimeType: item.descriptor.mimeType,
          startOffset: item.driveUploadedBytes,
          onProgress: async (uploadedBytes) => {
            await dependencies.queue.patch(item.uid, item.mediaId, { driveUploadedBytes: uploadedBytes });
            onProgress((uploadedBytes / item.blob!.size) * 100);
          },
        });
      } else {
        file = await dependencies.drive.uploadSmallFile({
          parentId: folderId,
          name,
          mimeType: item.descriptor.mimeType,
          blob: item.blob,
          appProperties,
        });
        onProgress(100);
      }
      file.appProperties = { ...appProperties, ...(file.appProperties ?? {}) };
      await dependencies.queue.patch(item.uid, item.mediaId, {
        driveFileId: file.id,
        driveFolderId: folderId,
        driveResumableUri: undefined,
        driveUploadedBytes: item.blob.size,
      });
      return storedObject(expectedPath, file);
    },

    async finalize(input: FinalizeFieldMediaInput): Promise<FinalizeFieldMediaResult> {
      const [sessionValue, file, rawMedia, buildingValue] = await Promise.all([
        dependencies.read(`fieldPlatform/captureSessions/${input.captureSessionId}`),
        dependencies.drive.getFile(input.objectGeneration),
        dependencies.read("fieldPlatform/media"),
        dependencies.read(`fieldPlatform/buildings/${input.buildingId}`),
      ]);
      const session = sessionValue as {
        createdBy?: unknown;
        buildingId?: unknown;
        unitId?: unknown;
        listingId?: unknown;
        visitId?: unknown;
      } | null;
      const building = buildingValue as {
        managementContract?: { status?: unknown };
      } | null;
      if (!session
        || typeof session.createdBy !== "string"
        || session.buildingId !== input.buildingId
        || (session.unitId ?? null) !== (input.unitId ?? null)
        || (session.listingId ?? null) !== (input.listingId ?? null)
        || session.visitId !== input.visitId) {
        throw new Error("field_capture_session_mismatch");
      }
      const now = dependencies.now();
      const mediaRecord: MediaRecord = {
        id: input.mediaId,
        requestId: input.requestId,
        buildingId: input.buildingId,
        ...(input.unitId ? { unitId: input.unitId } : {}),
        ...(input.listingId ? { listingId: input.listingId } : {}),
        visitId: input.visitId,
        captureSessionId: input.captureSessionId,
        capturedBy: session.createdBy,
        kind: input.kind,
        zone: input.zone,
        slotId: input.slotId,
        required: input.required,
        originalFileName: input.originalFileName,
        mimeType: file.mimeType,
        sizeBytes: Number(file.size ?? 0),
        capturedAt: input.capturedAt,
        storagePath: `drive:${file.id}`,
        uploadState: "finalized",
        uploadProgress: 100,
        driveSyncState: "complete",
        driveFileId: file.id,
        advertisingApproved: false,
        captureQualityState: input.kind === "video" && input.videoMetadata
          && (input.videoMetadata.height <= input.videoMetadata.width
            || input.videoMetadata.durationSeconds < 8
            || input.videoMetadata.durationSeconds > 30)
          ? "warning"
          : "valid",
        objectGeneration: file.id,
        ...(input.replacesMediaId ? { replacesMediaId: input.replacesMediaId } : {}),
      };
      const media = Object.values(asRecordMap<MediaRecord>(rawMedia));
      const policyMedia = [...media.filter((item) => item.id !== input.mediaId), mediaRecord];
      const complete = requiredPolicyComplete(policyMedia, input.captureSessionId);
      const patch: Record<string, unknown> = {
        [`fieldPlatform/media/${input.mediaId}`]: mediaRecord,
        [`fieldPlatform/captureSessions/${input.captureSessionId}/updatedAt`]: now,
        [`fieldPlatform/captureSessions/${input.captureSessionId}/status`]: complete ? "complete" : "open",
      };
      if (building?.managementContract?.status === "active") {
        patch[`fieldPlatform/mapProjections/${input.buildingId}/captureStatus`] = complete
          ? "complete"
          : "inProgress";
        patch[`fieldPlatform/mapProjections/${input.buildingId}/updatedAt`] = now;
      }
      if (complete && input.listingId) {
        patch[`fieldPlatform/listings/${input.listingId}/status`] = "ready";
        patch[`fieldPlatform/listings/${input.listingId}/advertisingApproved`] = true;
        patch[`fieldPlatform/listings/${input.listingId}/reviewerId`] = session.createdBy;
        patch[`fieldPlatform/listings/${input.listingId}/reviewedAt`] = now;
        patch[`fieldPlatform/listings/${input.listingId}/updatedAt`] = now;
        patch[`fieldPlatform/listings/${input.listingId}/updatedBy`] = session.createdBy;
      }
      if (input.replacesMediaId) {
        patch[`fieldPlatform/media/${input.replacesMediaId}/excludedAt`] = now;
        patch[`fieldPlatform/media/${input.replacesMediaId}/excludedBy`] = session.createdBy;
        patch[`fieldPlatform/media/${input.replacesMediaId}/advertisingApproved`] = false;
      }
      await dependencies.update(patch);
      return {
        mediaId: input.mediaId,
        uploadState: "finalized",
        storagePath: `drive:${file.id}`,
        driveSyncState: "complete",
        finalizedAt: now,
      };
    },

    async exclude(input) {
      const existing = await dependencies.read(`fieldPlatform/media/${input.mediaId}`) as MediaRecord | null;
      if (!existing) throw new Error("field_media_not_found");
      const now = dependencies.now();
      await dependencies.update({
        [`fieldPlatform/media/${input.mediaId}/excludedAt`]: now,
        [`fieldPlatform/media/${input.mediaId}/excludedBy`]: existing.capturedBy,
        [`fieldPlatform/media/${input.mediaId}/advertisingApproved`]: false,
        [`fieldPlatform/media/${input.mediaId}/advertisingOrder`]: null,
      });
    },
  };
}

export function createFirebaseDirectDriveMediaUploadPort(
  queue: OfflineQueuePort,
): MediaUploadPort {
  return createDirectDriveMediaUploadPort({
    drive: new GoogleDriveClient({ getAccessToken: driveTokenManager.getAccessToken }),
    queue,
    rootFolderId: DRIVE_ROOT_FOLDER_ID,
    now: () => new Date().toISOString(),
    read: async (path) => (await get(ref(database, path))).val(),
    update: async (patch) => update(ref(database), patch),
  });
}
