import { describe, expect, it } from "vitest";

import {
  migrateRegistrationDraft,
  toSaveFieldRegistrationInput,
} from "../../app/field/lib/registration-draft";

describe("registration draft migration", () => {
  it("replaces duplicate or unusable unit local IDs deterministically", () => {
    const raw = {
      units: [
        { localId: "unit-1", unitLabel: "201호" },
        { localId: "unit-1", unitLabel: "202호" },
        { localId: "unit-2", unitLabel: "203호" },
        { localId: " ", unitLabel: "204호" },
      ],
    };

    const draft = migrateRegistrationDraft(raw, undefined, () => "fixed-id");

    expect(draft.units.map((unit) => unit.localId)).toEqual([
      "unit-1",
      "unit-3",
      "unit-2",
      "unit-4",
    ]);
    expect(new Set(draft.units.map((unit) => unit.localId)).size).toBe(draft.units.length);
  });

  it("rejects drafts created by a newer schema version", () => {
    let thrown: unknown;

    try {
      migrateRegistrationDraft({ draftVersion: 3 }, undefined, () => "unused-id");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      name: "RegistrationDraftCompatibilityError",
      code: "registration_draft_future_version",
      draftVersion: 3,
    });
  });

  it("removes binary URL and realistic bare base64 strings without erasing short text", () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
    const blobUrl = "blob:https://bring.example/12345678-1234-1234-1234-123456789abc";
    const bareBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGsAAAAASUVORK5CYII=";
    const draft = migrateRegistrationDraft({
      building: {
        managementNumber: "BR0001",
        name: "BRING2026",
        purpose: dataUrl,
        jibunAddress: blobUrl,
      },
      units: [{ localId: "unit-1", unitLabel: "QUJD" }],
      listing: { locationNote: bareBase64 },
    }, undefined, () => "fixed-id");

    expect(draft.building).toMatchObject({
      managementNumber: "BR0001",
      name: "BRING2026",
      purpose: "",
      jibunAddress: "",
    });
    expect(draft.units[0].unitLabel).toBe("QUJD");
    expect(draft.listing.locationNote).toBe("");

    const serializedInput = JSON.stringify(toSaveFieldRegistrationInput(draft));
    expect(serializedInput).not.toContain(dataUrl);
    expect(serializedInput).not.toContain(blobUrl);
    expect(serializedInput).not.toContain(bareBase64);
  });

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

  it("fails deliberately when projecting a draft without units", () => {
    const draft = migrateRegistrationDraft({}, undefined, () => "fixed-id");
    draft.units = [];

    expect(() => toSaveFieldRegistrationInput(draft))
      .toThrowError("registration_draft_units_required");
  });
});
