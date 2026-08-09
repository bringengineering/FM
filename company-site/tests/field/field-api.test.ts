import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SaveFieldRegistrationInput } from "../../app/field/lib/registration-draft";

const firebase = vi.hoisted(() => ({
  auth: { currentUser: null as null | { getIdTokenResult(): Promise<{ claims: Record<string, unknown> }> } },
  database: {},
  functions: {},
  onValue: vi.fn(),
  query: vi.fn(() => "pending-query"),
  ref: vi.fn(() => "buildings-ref"),
  orderByChild: vi.fn(() => "status-order"),
  equalTo: vi.fn(() => "pending-filter"),
}));

vi.mock("../../app/field/lib/firebase.client", () => ({
  auth: firebase.auth,
  database: firebase.database,
  functions: firebase.functions,
}));

vi.mock("firebase/database", () => ({
  onValue: firebase.onValue,
  query: firebase.query,
  ref: firebase.ref,
  orderByChild: firebase.orderByChild,
  equalTo: firebase.equalTo,
}));

import {
  getCurrentFieldRole,
  saveFieldRegistration,
  setManagementContractStatus,
  subscribePendingManagementContracts,
} from "../../app/field/lib/field-api.client";

const registrationInput: SaveFieldRegistrationInput = {
  requestId: "request-12345678",
  draftId: "draft-12345678",
  building: {
    managementNumber: "BR-0001",
    name: "테스트 빌딩",
    roadAddress: "강원특별자치도 원주시 서원대로 1",
    latitude: 37.3422,
    longitude: 127.9202,
    elevator: true,
    parking: { available: true, totalSpaces: 8 },
  },
  units: [{
    localId: "unit-1",
    unitLabel: "201호",
    options: [],
    isVacant: true,
  }],
  listing: {
    depositWon: 3_000_000,
    monthlyRentWon: 350_000,
    maintenanceFeeWon: 0,
    maintenanceFeeItems: [],
    parkingDescription: "1대 가능",
    petPolicy: "확인 필요",
    options: [],
  },
  primaryUnitLocalId: "unit-1",
  managementContract: { requested: true, startedOn: "2026-08-09" },
  ownerNoteDrafts: [],
};

describe("field callable client", () => {
  it("returns the save callable data unchanged", async () => {
    const result = {
      buildingId: "building-1",
      unitIds: { "unit-1": "unit-1-server" },
      listingId: "listing-1",
      visitId: "visit-1",
    };
    const invoke = vi.fn(async () => ({ data: result }));

    await expect(saveFieldRegistration(registrationInput, invoke)).resolves.toBe(result);
    expect(invoke).toHaveBeenCalledWith(registrationInput);
  });

  it("sends the exact management-contract transition request", async () => {
    const input = {
      requestId: "transition-12345678",
      buildingId: "building-1",
      status: "active" as const,
      startedOn: "2026-08-09",
    };
    const result = { buildingId: "building-1", status: "active" as const };
    const invoke = vi.fn(async () => ({ data: result }));

    await expect(setManagementContractStatus(input, invoke)).resolves.toBe(result);
    expect(invoke).toHaveBeenCalledWith(input);
  });
});

describe("field claim and pending subscription", () => {
  beforeEach(() => {
    firebase.auth.currentUser = null;
    firebase.onValue.mockReset();
    firebase.query.mockClear();
    firebase.ref.mockClear();
    firebase.orderByChild.mockClear();
    firebase.equalTo.mockClear();
  });

  it("returns a role only when the field platform claim is present", async () => {
    firebase.auth.currentUser = {
      getIdTokenResult: vi.fn(async () => ({ claims: { fieldRole: "admin" } })),
    };
    await expect(getCurrentFieldRole()).resolves.toBeNull();

    firebase.auth.currentUser = {
      getIdTokenResult: vi.fn(async () => ({
        claims: { fieldPlatform: true, fieldRole: "reviewer" },
      })),
    };
    await expect(getCurrentFieldRole()).resolves.toBe("reviewer");
  });

  it("queries pending contracts and restores each building id from its snapshot key", () => {
    const unsubscribe = vi.fn();
    const persistedPendingBuilding = {
      managementNumber: "BR-0001",
      name: "테스트 빌딩",
      roadAddress: "강원특별자치도 원주시 서원대로 1",
      latitude: 37.3422,
      longitude: 127.9202,
      parking: { available: true, totalSpaces: 8 },
      assignedStaffIds: ["staff-1"],
      managementContract: {
        status: "pending",
        startedOn: "2026-08-09",
        updatedAt: "2026-08-09T00:00:00.000Z",
        updatedBy: "staff-1",
      },
      createdAt: "2026-08-09T00:00:00.000Z",
      createdBy: "staff-1",
      updatedAt: "2026-08-09T00:00:00.000Z",
      updatedBy: "staff-1",
    };
    firebase.onValue.mockImplementation((_pendingQuery, listener) => {
      listener({
        val: () => ({
          "building-1": persistedPendingBuilding,
          malformed: "skip-me",
          "unsafe/id": {
            ...persistedPendingBuilding,
            name: "잘못된 ID",
          },
          "object-name": {
            ...persistedPendingBuilding,
            name: { text: "객체 이름" },
          },
          "numeric-address": {
            ...persistedPendingBuilding,
            roadAddress: 12345,
          },
          "invalid-start-date": {
            ...persistedPendingBuilding,
            managementContract: {
              ...persistedPendingBuilding.managementContract,
              startedOn: "2026-02-30",
            },
          },
          "legacy-missing-name": {
            ...persistedPendingBuilding,
            name: undefined,
            roadAddress: "강원특별자치도 원주시 중앙로 4",
          },
        }),
      });
      return unsubscribe;
    });
    const listener = vi.fn();

    expect(subscribePendingManagementContracts(listener)).toBe(unsubscribe);
    expect(firebase.ref).toHaveBeenCalledWith(
      firebase.database,
      "fieldPlatform/buildings",
    );
    expect(firebase.orderByChild).toHaveBeenCalledWith("managementContract/status");
    expect(firebase.equalTo).toHaveBeenCalledWith("pending");
    expect(listener).toHaveBeenCalledWith([
      expect.objectContaining({ id: "building-1", name: "테스트 빌딩" }),
    ]);
  });
});
