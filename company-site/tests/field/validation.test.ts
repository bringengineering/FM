import { describe, expect, it } from "vitest";

import {
  validateBuildingDraft,
  validateListingDraft,
  validateVisitCompletion,
} from "../../app/field/lib/validation";

describe("validateListingDraft", () => {
  it("requires the approved core advertising fields", () => {
    expect(validateListingDraft({})).toEqual(
      expect.arrayContaining([
        "buildingId",
        "unitLabel",
        "depositWon",
        "monthlyRentWon",
        "maintenanceFeeWon",
      ]),
    );
  });

  it("accepts zero maintenance fee without treating it as missing", () => {
    expect(
      validateListingDraft({
        buildingId: "building-1",
        unitLabel: "201호",
        depositWon: 3_000_000,
        monthlyRentWon: 350_000,
        maintenanceFeeWon: 0,
      }),
    ).toEqual([]);
  });

  it("trims required strings and rejects negative or fractional won amounts", () => {
    expect(
      validateListingDraft({
        buildingId: "   ",
        unitLabel: "201호",
        depositWon: -1,
        monthlyRentWon: 350_000.5,
        maintenanceFeeWon: 50_000,
      }),
    ).toEqual(["buildingId", "depositWon", "monthlyRentWon"]);
  });
});

describe("validateBuildingDraft", () => {
  it("requires identity, address, and valid coordinates", () => {
    expect(
      validateBuildingDraft({
        managementNumber: "BR-0001",
        name: "단계동 테스트 빌딩",
        roadAddress: "강원특별자치도 원주시 서원대로 1",
        latitude: 91,
        longitude: 181,
      }),
    ).toEqual(["latitude", "longitude"]);
  });

  it("accepts valid Wonju coordinates", () => {
    expect(
      validateBuildingDraft({
        managementNumber: "BR-0001",
        name: "단계동 테스트 빌딩",
        roadAddress: "강원특별자치도 원주시 서원대로 1",
        latitude: 37.3422,
        longitude: 127.9202,
      }),
    ).toEqual([]);
  });
});

describe("validateVisitCompletion", () => {
  it("reports every unanswered required checklist field and media slot", () => {
    expect(
      validateVisitCompletion({
        checklistFields: [
          { id: "listing.depositWon", required: true },
          { id: "building.elevator", required: true },
          { id: "notes.optional", required: false },
        ],
        answers: {
          "listing.depositWon": 0,
        },
        requiredMediaSlots: ["exterior", "bathroom"],
        completedMediaSlotIds: ["exterior"],
      }),
    ).toEqual(["building.elevator", "media:bathroom"]);
  });

  it("treats false and numeric zero as completed answers", () => {
    expect(
      validateVisitCompletion({
        checklistFields: [
          { id: "building.elevator", required: true },
          { id: "listing.maintenanceFeeWon", required: true },
        ],
        answers: {
          "building.elevator": false,
          "listing.maintenanceFeeWon": 0,
        },
        requiredMediaSlots: [],
        completedMediaSlotIds: [],
      }),
    ).toEqual([]);
  });
});
