"use client";

import {
  analyzeAdPackageReadiness,
  buildAdPackagePreview,
  loadAdPackageReviewCandidates,
  type AdPackageReviewCandidate,
  type AdPackageReviewWorkspacePage,
  type AdvertisingPathReader,
} from "./ad-package";
import { adPackageFolderName, buildDriveFolderPlan } from "./drive-folders";
import type {
  CreateAdPackageInput,
  CreateAdPackageResult,
  ExcludeFieldMediaInput,
  ExcludeFieldMediaResult,
  FieldMediaAccessResult,
  LoadAdReviewWorkspaceInput,
} from "./field-api.client";
import type { GoogleDriveClient } from "./google-drive.client";
import type { MediaRecord } from "./types";
import { get, ref, update } from "firebase/database";

import { driveTokenManager } from "./drive-auth.client";
import { DRIVE_ROOT_FOLDER_ID } from "./drive-folders";
import { database } from "./firebase.client";
import { GoogleDriveClient as GoogleDriveRuntimeClient } from "./google-drive.client";
import type { UserRole } from "./types";

export interface DirectAdArtifact {
  name: string;
  content: string;
}

export interface DirectAdPackageDependencies {
  drive: GoogleDriveClient;
  rootFolderId: string;
  uid(): string;
  now(): string;
  read(path: string): Promise<unknown>;
  update(patch: Record<string, unknown>): Promise<void>;
  loadCandidates?: () => Promise<AdPackageReviewCandidate[]>;
}

export interface DirectAdPackageApi {
  load(input?: LoadAdReviewWorkspaceInput): Promise<AdPackageReviewWorkspacePage>;
  create(input: CreateAdPackageInput): Promise<CreateAdPackageResult>;
  exclude(input: ExcludeFieldMediaInput): Promise<ExcludeFieldMediaResult>;
  mediaAccess(mediaId: string): Promise<FieldMediaAccessResult>;
}

function packageMediaOrder(approved: string[], representatives: string[]): string[] {
  const representativeSet = new Set(representatives);
  return [...representatives, ...approved.filter((id) => !representativeSet.has(id))];
}

function extensionForMime(mimeType: string): string {
  if (mimeType === "video/quicktime") return "mov";
  if (mimeType.startsWith("video/")) return mimeType.split("/")[1] || "mp4";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/heic" || mimeType === "image/heif") return mimeType.split("/")[1];
  return "jpg";
}

export function buildDirectAdArtifacts(
  candidate: AdPackageReviewCandidate,
  approvedMediaIds: string[],
  representativeMediaIds: string[],
): DirectAdArtifact[] {
  const preview = buildAdPackagePreview(candidate, approvedMediaIds, representativeMediaIds);
  const listing = candidate.listing;
  const summary = [
    `건물명\t${candidate.building.name}`,
    `주소\t${candidate.building.roadAddress}`,
    `호실\t${candidate.unit.unitLabel}`,
    `보증금\t${listing.depositWon.toLocaleString("ko-KR")}원`,
    `월세\t${listing.monthlyRentWon.toLocaleString("ko-KR")}원`,
    `관리비\t${listing.maintenanceFeeWon.toLocaleString("ko-KR")}원`,
    `입주 가능일\t${listing.availableFrom ?? "확인 필요"}`,
    `주차\t${listing.parkingDescription}`,
    `반려동물\t${listing.petPolicy}`,
  ].join("\n");
  const order = packageMediaOrder(approvedMediaIds, representativeMediaIds)
    .map((id, index) => `${String(index + 1).padStart(2, "0")}\t${id}${representativeMediaIds.includes(id) ? "\t대표사진" : ""}`)
    .join("\n");
  return [
    { name: "01_당근_광고문구.txt", content: preview.daangnDescription },
    { name: "02_네이버_등록정보.txt", content: preview.naverFields.map((item) => `${item.label}\t${item.value}`).join("\n") },
    { name: "03_매물_요약.txt", content: summary },
    { name: "04_사진_순서.txt", content: order },
    {
      name: "05_검토_정보.txt",
      content: [
        `매물 ID\t${listing.id}`,
        `촬영본\t${approvedMediaIds.length}개`,
        `대표사진\t${representativeMediaIds.length}개`,
        "용도\t당근·네이버 부동산 광고 업로드",
      ].join("\n"),
    },
  ];
}

function driveFileId(media: AdPackageReviewCandidate["media"][number]): string | null {
  if (media.driveFileId) return media.driveFileId;
  return media.storagePath.startsWith("drive:") ? media.storagePath.slice(6) : null;
}

export function createDirectAdPackageApi(
  dependencies: DirectAdPackageDependencies,
): DirectAdPackageApi {
  const loadCandidates = dependencies.loadCandidates
    ?? (() => loadAdPackageReviewCandidates(dependencies.read as AdvertisingPathReader));

  return {
    async load() {
      return { candidates: await loadCandidates() };
    },

    async create(input) {
      const packageId = `adpkg_${input.requestId}`;
      const existing = await dependencies.read(`fieldPlatform/adPackages/${packageId}`) as {
        listingId?: string;
        version?: number;
      } | null;
      if (existing?.listingId === input.listingId && typeof existing.version === "number") {
        return { packageId, listingId: input.listingId, version: existing.version, status: "reviewed" };
      }
      const candidate = (await loadCandidates()).find((item) => item.listing.id === input.listingId);
      if (!candidate) throw new Error("ad_package_listing_missing");
      const readiness = analyzeAdPackageReadiness(
        candidate,
        input.approvedMediaIds,
        input.representativeMediaIds,
      );
      if (!readiness.ready) throw new Error("ad_package_not_ready");
      const approved = new Set(input.approvedMediaIds);
      const chosenMedia = candidate.media.filter((item) => approved.has(item.id));
      const first = chosenMedia[0];
      if (!first) throw new Error("ad_package_media_missing");
      const session = candidate.captureSessions.find((item) => item.id === first.captureSessionId);
      if (!session) throw new Error("ad_package_session_missing");
      const version = Math.max(0, ...candidate.packages.map((item) => item.version)) + 1;
      const baseFolders = buildDriveFolderPlan({
        managementNumber: candidate.building.managementNumber,
        buildingName: candidate.building.name,
        roadAddress: candidate.building.roadAddress,
        unitLabel: candidate.unit.unitLabel,
        capturedAt: first.capturedAt,
        captureSessionId: session.id,
        zone: first.zone,
      }).slice(0, -1);
      const packageFolderId = await dependencies.drive.ensureFolderPath(
        dependencies.rootFolderId,
        [...baseFolders, "광고묶음", adPackageFolderName(version)],
      );
      const orderedIds = packageMediaOrder(input.approvedMediaIds, input.representativeMediaIds);
      const driveFileIds: Record<string, string> = {};
      for (let index = 0; index < orderedIds.length; index += 1) {
        const mediaId = orderedIds[index];
        const media = candidate.media.find((item) => item.id === mediaId);
        const sourceId = media ? driveFileId(media) : null;
        if (!media || !sourceId) throw new Error("ad_package_drive_media_missing");
        const prefix = input.representativeMediaIds.includes(mediaId) ? "대표" : "광고";
        const name = `${String(index + 1).padStart(2, "0")}_${prefix}_${media.zone}.${extensionForMime(media.mimeType)}`;
        const properties = { bringPackageId: packageId, bringSourceMediaId: mediaId };
        const existingCopy = await dependencies.drive.findExactChild(packageFolderId, name, "file", properties);
        const copied = existingCopy ?? await dependencies.drive.copyFile({
          fileId: sourceId,
          parentId: packageFolderId,
          name,
          appProperties: properties,
        });
        driveFileIds[`media_${String(index + 1).padStart(2, "0")}`] = copied.id;
      }
      const artifacts = buildDirectAdArtifacts(candidate, input.approvedMediaIds, input.representativeMediaIds);
      for (const artifact of artifacts) {
        const properties = { bringPackageId: packageId, bringArtifactName: artifact.name };
        const existingArtifact = await dependencies.drive.findExactChild(
          packageFolderId,
          artifact.name,
          "file",
          properties,
        );
        const file = existingArtifact ?? await dependencies.drive.uploadSmallFile({
          parentId: packageFolderId,
          name: artifact.name,
          mimeType: "text/plain;charset=utf-8",
          blob: new Blob([`\uFEFF${artifact.content}`], { type: "text/plain;charset=utf-8" }),
          appProperties: properties,
        });
        driveFileIds[artifact.name] = file.id;
      }
      const now = dependencies.now();
      const preview = buildAdPackagePreview(candidate, input.approvedMediaIds, input.representativeMediaIds);
      const patch: Record<string, unknown> = {
        [`fieldPlatform/adPackages/${packageId}`]: {
          id: packageId,
          listingId: input.listingId,
          version,
          status: "complete",
          representativeMediaIds: [...input.representativeMediaIds],
          allApprovedMediaIds: [...input.approvedMediaIds],
          daangnDescription: preview.daangnDescription,
          naverListingFields: Object.fromEntries(preview.naverFields.map((item) => [item.label, item.value])),
          reviewerId: dependencies.uid(),
          reviewedAt: now,
          createdAt: now,
          createdBy: dependencies.uid(),
          driveFolderId: packageFolderId,
          driveFileIds,
        },
        [`fieldPlatform/listings/${input.listingId}/status`]: "advertising",
        [`fieldPlatform/listings/${input.listingId}/advertisingApproved`]: true,
        [`fieldPlatform/listings/${input.listingId}/reviewerId`]: dependencies.uid(),
        [`fieldPlatform/listings/${input.listingId}/reviewedAt`]: now,
      };
      const advertisingOrder = new Map(orderedIds.map((mediaId, index) => [mediaId, index]));
      candidate.media.forEach((media) => {
        const order = advertisingOrder.get(media.id);
        patch[`fieldPlatform/media/${media.id}/advertisingApproved`] = order !== undefined;
        patch[`fieldPlatform/media/${media.id}/advertisingOrder`] = order ?? null;
      });
      await dependencies.update(patch);
      return { packageId, listingId: input.listingId, version, status: "reviewed" };
    },

    async exclude(input) {
      const media = await dependencies.read(`fieldPlatform/media/${input.mediaId}`) as MediaRecord | null;
      if (!media) throw new Error("field_media_not_found");
      const now = dependencies.now();
      const uid = dependencies.uid();
      await dependencies.update({
        [`fieldPlatform/media/${input.mediaId}/excludedAt`]: now,
        [`fieldPlatform/media/${input.mediaId}/excludedBy`]: uid,
        [`fieldPlatform/media/${input.mediaId}/advertisingApproved`]: false,
        [`fieldPlatform/media/${input.mediaId}/advertisingOrder`]: null,
      });
      return { mediaId: input.mediaId, excludedAt: now, excludedBy: uid };
    },

    async mediaAccess(mediaId) {
      const media = await dependencies.read(`fieldPlatform/media/${mediaId}`) as MediaRecord | null;
      const fileId = media?.driveFileId
        ?? (media?.storagePath?.startsWith("drive:") ? media.storagePath.slice(6) : null);
      if (!fileId) throw new Error("field_media_not_found");
      const blob = await dependencies.drive.downloadFile(fileId);
      return {
        url: URL.createObjectURL(blob),
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      };
    },
  };
}

export function createFirebaseDirectAdPackageApi(actor: {
  uid: string;
  role: UserRole;
}): DirectAdPackageApi {
  if (actor.role !== "admin" && actor.role !== "reviewer") {
    throw new Error("ad_package_review_forbidden");
  }
  return createDirectAdPackageApi({
    drive: new GoogleDriveRuntimeClient({ getAccessToken: driveTokenManager.getAccessToken }),
    rootFolderId: DRIVE_ROOT_FOLDER_ID,
    uid: () => actor.uid,
    now: () => new Date().toISOString(),
    read: async (path) => (await get(ref(database, path))).val(),
    update: async (patch) => update(ref(database), patch),
  });
}
