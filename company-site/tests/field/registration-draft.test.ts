import { describe, expect, it } from "vitest";

import {
  migrateRegistrationDraft,
  toSaveFieldRegistrationInput,
} from "../../app/field/lib/registration-draft";

describe("registration draft migration", () => {
  it("preserves address coordinates and defaults management contract fields", () => {
    const raw = {
      building: {
        managementNumber: "BR-0001",
        name: "테스트 빌딩",
        roadAddress: "강원특별자치도 원주시 서원대로 1",
        latitude: 37.3422,
        longitude: 127.9202,
      },
      units: [
        { localId: "unit-1", unitLabel: "201호", structure: "원룸", floor: 2 },
      ],
      listing: {
        depositWon: 3_000_000,
        monthlyRentWon: 350_000,
        maintenanceFeeWon: 0,
      },
      addressVerified: true,
      duplicateBuilding: null,
    };

    expect(migrateRegistrationDraft(raw, undefined, () => "fixed-id")).toMatchObject({
      draftVersion: 2,
      draftId: "fixed-id",
      requestId: "fixed-id",
      building: {
        managementNumber: "BR-0001",
        name: "테스트 빌딩",
        roadAddress: "강원특별자치도 원주시 서원대로 1",
        latitude: 37.3422,
        longitude: 127.9202,
        managementContractRequested: false,
        managementStartedOn: "",
      },
      units: [
        { localId: "unit-1", unitLabel: "201호", structure: "원룸", floor: 2 },
      ],
      listing: {
        depositWon: 3_000_000,
        monthlyRentWon: 350_000,
        maintenanceFeeWon: 0,
      },
      addressVerified: true,
      duplicateBuilding: null,
    });
  });

  it("converts a version 2 draft into the callable save input", () => {
    const draft = migrateRegistrationDraft({
      draftVersion: 2,
      draftId: "draft-12345678",
      requestId: "request-12345678",
      building: {
        managementNumber: " BR-0001 ",
        name: " 테스트 빌딩 ",
        roadAddress: " 강원특별자치도 원주시 서원대로 1 ",
        latitude: 37.3422,
        longitude: 127.9202,
        managementContractRequested: true,
        managementStartedOn: "2026-08-09",
      },
      units: [
        { localId: "unit-1", unitLabel: " 201호 ", structure: " 원룸 ", floor: 2 },
      ],
      listing: {
        depositWon: 3_000_000,
        monthlyRentWon: 350_000,
        maintenanceFeeWon: 0,
        maintenanceFeeItems: " 수도, 인터넷, ",
        locationNote: " 터미널 인근 ",
      },
      addressVerified: true,
      duplicateBuilding: null,
    });

    const input = toSaveFieldRegistrationInput(draft);

    expect(input).toMatchObject({
      requestId: "request-12345678",
      draftId: "draft-12345678",
      building: {
        managementNumber: "BR-0001",
        name: "테스트 빌딩",
        roadAddress: "강원특별자치도 원주시 서원대로 1",
        latitude: 37.3422,
        longitude: 127.9202,
      },
      units: [
        { localId: "unit-1", unitLabel: "201호", structure: "원룸", floor: 2 },
      ],
      listing: {
        maintenanceFeeItems: ["수도", "인터넷"],
        locationDescription: "터미널 인근",
      },
      primaryUnitLocalId: "unit-1",
      managementContract: { requested: true, startedOn: "2026-08-09" },
      ownerNoteDrafts: [],
    });
    expect(input.managementContract).not.toHaveProperty("status");
  });
});
