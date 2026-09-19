import { describe, expect, it } from "vitest";

import type {
  Building,
  CaptureAttachmentDescriptor,
  CaptureBinding,
  CaptureSessionRecord,
  FieldUser,
  Listing,
  MediaRecord,
  SecureAccess,
  UploadState,
} from "../../app/field/lib/types";

const NOW = "2026-08-09T00:00:00.000Z";

describe("field platform domain types", () => {
  it("uses the canonical six-state capture contracts without transient media data", () => {
    const states: UploadState[] = [
      "queued",
      "uploading",
      "objectStored",
      "finalizing",
      "finalized",
      "failed",
    ];
    const binding: CaptureBinding = {
      buildingId: "building-1",
      unitLocalId: "unit-local-1",
    };
    const descriptor: CaptureAttachmentDescriptor = {
      mediaId: "22222222-2222-4222-8222-222222222222",
      captureSessionId: "11111111-1111-4111-8111-111111111111",
      kind: "photo",
      zone: "exterior",
      slotId: "exterior-1",
      required: true,
      originalFileName: "building.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 1024,
      lastModified: 10,
      capturedAt: NOW,
      uploadState: "queued",
      uploadProgress: 0,
    };
    const session: CaptureSessionRecord = {
      id: descriptor.captureSessionId,
      requestId: "33333333-3333-4333-8333-333333333333",
      buildingId: "building-1",
      visitId: "44444444-4444-4444-8444-444444444444",
      createdBy: "staff-1",
      status: "open",
      createdAt: NOW,
      updatedAt: NOW,
    };
    const media: MediaRecord = {
      id: descriptor.mediaId,
      requestId: "55555555-5555-4555-8555-555555555555",
      buildingId: session.buildingId,
      visitId: session.visitId,
      captureSessionId: session.id,
      capturedBy: session.createdBy,
      kind: descriptor.kind,
      zone: descriptor.zone,
      slotId: descriptor.slotId,
      required: descriptor.required,
      originalFileName: descriptor.originalFileName,
      mimeType: descriptor.mimeType,
      sizeBytes: descriptor.sizeBytes,
      capturedAt: descriptor.capturedAt,
      uploadState: "finalized",
      uploadProgress: 100,
      driveSyncState: "queued",
      captureQualityState: "valid",
      objectGeneration: "2",
      objectMd5Hash: "trusted-server-hash",
      advertisingApproved: false,
    };

    expect(states).toHaveLength(6);
    expect(binding.unitLocalId).toBe("unit-local-1");
    expect(JSON.stringify(descriptor)).not.toMatch(/blob:|base64|data:|signedUrl|downloadToken/);
    expect(media).not.toHaveProperty("contentHash");
  });

  it("models public listing data separately from secure access data", () => {
    const user: FieldUser = {
      id: "user-1",
      displayName: "브링 담당자",
      role: "staff",
      enabled: true,
      assignedBuildingIds: ["building-1"],
      createdAt: NOW,
      updatedAt: NOW,
    };
    const building: Building = {
      id: "building-1",
      managementNumber: "BR-0001",
      name: "테스트 빌딩",
      roadAddress: "강원특별자치도 원주시 서원대로 1",
      jibunAddress: "강원특별자치도 원주시 단계동 1",
      latitude: 37.3422,
      longitude: 127.9202,
      purpose: "다가구주택",
      elevator: true,
      parking: { available: true, totalSpaces: 8 },
      managementContract: {
        status: "active",
        startedOn: "2026-08-09",
        updatedAt: NOW,
        updatedBy: user.id,
      },
      assignedStaffIds: [user.id],
      createdAt: NOW,
      createdBy: user.id,
      updatedAt: NOW,
      updatedBy: user.id,
    };
    const listing: Listing = {
      id: "listing-1",
      buildingId: building.id,
      unitId: "unit-1",
      unitLabel: "201호",
      status: "draft",
      depositWon: 3_000_000,
      monthlyRentWon: 350_000,
      maintenanceFeeWon: 0,
      maintenanceFeeItems: [],
      options: [],
      parkingDescription: "1대 가능",
      petPolicy: "확인 필요",
      advertisingApproved: false,
      createdAt: "2026-08-09T00:00:00.000Z",
      createdBy: user.id,
      updatedAt: "2026-08-09T00:00:00.000Z",
      updatedBy: user.id,
    };
    const secureAccess: SecureAccess = {
      id: "access-1",
      buildingId: building.id,
      unitId: listing.unitId,
      commonDoorAccess: "관리자 문의",
      unitDoorAccess: "키박스",
      keyLocation: "관리자 보관",
      ownerContact: "TEST-OWNER-PHONE",
      internalMemo: "외부 광고 사용 금지",
      allowedUserIds: [user.id],
      updatedAt: "2026-08-09T00:00:00.000Z",
      updatedBy: user.id,
    };

    expect(building).not.toHaveProperty("ownerContact");
    expect(building.managementContract?.status).toBe("active");
    expect(listing).not.toHaveProperty("commonDoorAccess");
    expect(secureAccess.ownerContact).toBe("TEST-OWNER-PHONE");
  });
});
