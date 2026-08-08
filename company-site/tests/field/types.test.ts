import { describe, expect, it } from "vitest";

import type {
  Building,
  FieldUser,
  Listing,
  SecureAccess,
} from "../../app/field/lib/types";

describe("field platform domain types", () => {
  it("models public listing data separately from secure access data", () => {
    const user: FieldUser = {
      id: "user-1",
      displayName: "브링 담당자",
      role: "staff",
      enabled: true,
      assignedBuildingIds: ["building-1"],
      createdAt: "2026-08-09T00:00:00.000Z",
      updatedAt: "2026-08-09T00:00:00.000Z",
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
      assignedStaffIds: [user.id],
      createdAt: "2026-08-09T00:00:00.000Z",
      createdBy: user.id,
      updatedAt: "2026-08-09T00:00:00.000Z",
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
    expect(listing).not.toHaveProperty("commonDoorAccess");
    expect(secureAccess.ownerContact).toBe("TEST-OWNER-PHONE");
  });
});
