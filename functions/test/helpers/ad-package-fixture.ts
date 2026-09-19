import {
  ARTIFACT_SET_VERSION,
  adPackageSourceFingerprint,
} from "../../src/packages/ad-package-artifacts.js";
import { buildAdPackageRecoveryKey } from "../../src/packages/generation-recovery-key.js";

export const PACKAGE_ID =
  "ad-package-11111111-1111-4111-8111-111111111111";
export const BUILDING_ID = "building-1";
export const SESSION_ID = "22222222-2222-4222-8222-222222222222";
export const STORAGE_MD5_BASE64 = "1B2M2Y8AsgTpgAmY7PhCfg==";
export const DRIVE_MD5_HEX = "d41d8cd98f00b204e9800998ecf8427e";
export const MEDIA_IDS = Array.from({ length: 10 }, (_, index) =>
  `33333333-3333-4333-8333-${String(index + 331).padStart(12, "0")}`,
);
export const PHOTO_1 = MEDIA_IDS[0];
export const PHOTO_2 = MEDIA_IDS[3];
export const VIDEO_1 = MEDIA_IDS[9];

const REQUIRED_MEDIA = [
  ["exterior", "photo"],
  ["accessRoad", "photo"],
  ["commonEntrance", "photo"],
  ["roomOverview", "photo"],
  ["roomOverview", "photo"],
  ["windowDaylight", "photo"],
  ["kitchen", "photo"],
  ["bathroom", "photo"],
  ["boilerEquipment", "photo"],
  ["verticalVideo", "video"],
] as const;

export function makeFrozenPackage(version = 3): Record<string, any> {
  const mediaManifest = MEDIA_IDS.map((id, index) => {
    const [zone, kind] = REQUIRED_MEDIA[index];
    const mimeType = kind === "video"
      ? "video/mp4"
      : id === PHOTO_2
        ? "image/png"
        : "image/jpeg";
    const extension = mimeType === "video/mp4"
      ? "mp4"
      : mimeType === "image/png"
        ? "png"
        : "jpg";
    return {
      id,
      buildingId: BUILDING_ID,
      captureSessionId: SESSION_ID,
      kind,
      zone,
      mimeType,
      sizeBytes: 100 + index,
      capturedAt: `2026-08-10T02:${String(index).padStart(2, "0")}:00.000Z`,
      storagePath: `field-media-finalized/${BUILDING_ID}/${id}.${extension}`,
      objectGeneration: String(1_001 + index),
      driveMd5Checksum: DRIVE_MD5_HEX,
      ...(kind === "video" ? { captureQualityState: "valid" } : {}),
      advertisingOrder: index + 1,
    };
  });
  const value: Record<string, any> = {
    id: PACKAGE_ID,
    requestId: "11111111-1111-4111-8111-111111111111",
    listingId: "listing-1",
    buildingId: BUILDING_ID,
    version,
    status: "reviewed",
    artifactSetVersion: ARTIFACT_SET_VERSION,
    captureSessionId: SESSION_ID,
    representativeMediaIds: [PHOTO_2, PHOTO_1],
    allApprovedMediaIds: [...MEDIA_IDS],
    mediaManifest,
    daangnDescription: "브링빌 301호\n보증금 500만원\n월세 45만원\n",
    naverListingFields: {
      buildingName: "브링빌",
      roadAddress: "강원특별자치도 원주시 브링로 1",
      unitLabel: "301",
      depositWon: 5_000_000,
      monthlyRentWon: 450_000,
      maintenanceFeeWon: 50_000,
      maintenanceFeeItems: ["수도", "공용전기"],
      availableFrom: "2026-08-11",
      structure: "분리형 원룸",
      floor: 3,
      direction: "남향",
      parkingAvailable: true,
      parkingTotalSpaces: 4,
      parkingDescription: "1대 가능",
      petPolicy: "건물주 협의",
      options: ["에어컨", "세탁기"],
      locationDescription: "터미널 도보 5분",
      representativeMediaIds: [PHOTO_2, PHOTO_1],
    },
    reviewerId: "reviewer-1",
    reviewedAt: "2026-08-10T02:30:00.000Z",
    createdAt: "2026-08-10T02:30:00.000Z",
    createdBy: "reviewer-1",
  };
  value.sourceFingerprint = adPackageSourceFingerprint(value);
  value.generation = {
    status: "reviewed",
    attemptCount: 0,
    generationNumber: 0,
    sourceFingerprint: value.sourceFingerprint,
    updatedAt: value.createdAt,
    recoveryKey: buildAdPackageRecoveryKey(
      "reviewed",
      value.createdAt,
      PACKAGE_ID,
    ),
  };
  return value;
}

export function removeManifestMedia(
  value: Record<string, any>,
  mediaId: string,
): void {
  value.mediaManifest = value.mediaManifest
    .filter((item: Record<string, any>) => item.id !== mediaId)
    .map((item: Record<string, any>, index: number) => ({
      ...item,
      advertisingOrder: index + 1,
    }));
  value.allApprovedMediaIds = value.mediaManifest.map(
    (item: Record<string, any>) => item.id,
  );
}
