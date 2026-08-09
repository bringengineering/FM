import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SaveFieldRegistrationInput } from "../../app/field/lib/registration-draft";

const firebase = vi.hoisted(() => {
  const callableInvoke = vi.fn();
  return {
    auth: { currentUser: null as null | { getIdTokenResult(): Promise<{ claims: Record<string, unknown> }> } },
    database: {},
    functions: {},
    callableInvoke,
    httpsCallable: vi.fn((_functions: unknown, name: string) => (
      input: unknown,
    ) => callableInvoke(name, input)),
    onValue: vi.fn(),
    query: vi.fn((...constraints: unknown[]) => ({ constraints })),
    ref: vi.fn((_database: unknown, path: string) => ({ path })),
    orderByChild: vi.fn((path: string) => ({ orderByChild: path })),
    equalTo: vi.fn((value: unknown) => ({ equalTo: value })),
    limitToLast: vi.fn((limit: number) => ({ limitToLast: limit })),
  };
});

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
  limitToLast: firebase.limitToLast,
}));

vi.mock("firebase/functions", () => ({
  httpsCallable: firebase.httpsCallable,
}));

import {
  appendOwnerNote,
  archiveOwnerNote,
  getCurrentFieldRole,
  saveFieldRegistration,
  setManagementContractStatus,
  sortOwnerNotes,
  subscribeOwnerNotes,
  subscribePendingManagementContracts,
} from "../../app/field/lib/field-api.client";

const serverNote = {
  id: "note_12345678",
  buildingId: "building-1",
  body: "Check boiler pressure",
  recordedAt: "2026-08-09T01:30:00.000Z",
  createdAt: "2026-08-09T02:00:00.000Z",
  createdBy: "staff-1",
  createdByName: "Assigned staff",
};

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
  beforeEach(() => {
    firebase.callableInvoke.mockReset();
    firebase.httpsCallable.mockClear();
  });

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

  it("sends only client-owned fields to appendOwnerNote", async () => {
    firebase.callableInvoke.mockResolvedValue({
      data: {
        note: { ...serverNote, ignoredServerField: "must not escape" },
      },
    });

    await expect(appendOwnerNote({
      buildingId: "building-1",
      localId: "note_12345678",
      body: "Check boiler pressure",
      recordedAt: "2026-08-09T01:30:00.000Z",
      createdAt: "forged-client-time",
      createdBy: "attacker",
      createdByName: "spoofed",
      archivedAt: "forged-archive",
    } as never)).resolves.toEqual(serverNote);

    expect(firebase.callableInvoke).toHaveBeenCalledWith(
      "appendOwnerNote",
      {
        buildingId: "building-1",
        localId: "note_12345678",
        body: "Check boiler pressure",
        recordedAt: "2026-08-09T01:30:00.000Z",
      },
    );
    expect(JSON.stringify(firebase.callableInvoke.mock.calls[0]?.[1]))
      .not.toMatch(/createdAt|createdBy|createdByName|archivedAt/);
  });

  it.each([
    ["invalid createdAt", { createdAt: "not-a-date" }],
    ["oversized name", { createdByName: "가".repeat(86) }],
    ["control name", { createdByName: "Bad\u0000name" }],
    ["forbidden creator", { createdBy: "bad.uid" }],
    ["control creator", { createdBy: "bad\u0000uid" }],
    ["over-byte creator", { createdBy: "가".repeat(43) }],
    ["partial archive", { archivedAt: "2026-08-09T02:30:00.000Z" }],
    ["mismatched id", { id: "note_87654321" }],
    ["mismatched building", { buildingId: "building-2" }],
  ])("rejects an append callable response with %s", async (_label, override) => {
    firebase.callableInvoke.mockResolvedValue({
      data: { note: { ...serverNote, ...override } },
    });

    await expect(appendOwnerNote({
      buildingId: "building-1",
      localId: "note_12345678",
      body: "Check boiler pressure",
      recordedAt: "2026-08-09T01:30:00.000Z",
    })).rejects.toThrow("field_owner_note_response_invalid");
  });

  it.each(["staff:wonju", "원주담당자"])(
    "accepts the auth-boundary append creator %s",
    async (createdBy) => {
      firebase.callableInvoke.mockResolvedValue({
        data: { note: { ...serverNote, createdBy } },
      });

      await expect(appendOwnerNote({
        buildingId: "building-1",
        localId: "note_12345678",
        body: "Check boiler pressure",
        recordedAt: "2026-08-09T01:30:00.000Z",
      })).resolves.toMatchObject({ createdBy });
    },
  );

  it("sends only the building and note IDs to archiveOwnerNote", async () => {
    const archive = {
      archivedAt: "2026-08-09T02:30:00.000Z",
      archivedBy: "admin-1",
    };
    firebase.callableInvoke.mockResolvedValue({
      data: { ...archive, ignoredServerField: "must not escape" },
    });

    await expect(archiveOwnerNote({
      buildingId: "building-1",
      noteId: "note_12345678",
      archivedAt: "forged-client-time",
      archivedBy: "attacker",
    } as never)).resolves.toEqual(archive);

    expect(firebase.callableInvoke).toHaveBeenCalledWith(
      "archiveOwnerNote",
      { buildingId: "building-1", noteId: "note_12345678" },
    );
  });

  it.each([
    ["invalid archivedAt", { archivedAt: "not-a-date", archivedBy: "admin-1" }],
    ["missing archivedBy", { archivedAt: "2026-08-09T02:30:00.000Z" }],
    ["unsafe archivedBy", {
      archivedAt: "2026-08-09T02:30:00.000Z",
      archivedBy: "bad/path",
    }],
    ["control archivedBy", {
      archivedAt: "2026-08-09T02:30:00.000Z",
      archivedBy: "bad\u007fuid",
    }],
    ["over-byte archivedBy", {
      archivedAt: "2026-08-09T02:30:00.000Z",
      archivedBy: "가".repeat(43),
    }],
  ])("rejects an archive callable response with %s", async (_label, data) => {
    firebase.callableInvoke.mockResolvedValue({ data });

    await expect(archiveOwnerNote({
      buildingId: "building-1",
      noteId: "note_12345678",
    })).rejects.toThrow("field_owner_note_archive_response_invalid");
  });

  it.each(["staff:wonju", "원주관리자"])(
    "accepts the auth-boundary archive actor %s",
    async (archivedBy) => {
      firebase.callableInvoke.mockResolvedValue({
        data: {
          archivedAt: "2026-08-09T02:30:00.000Z",
          archivedBy,
        },
      });

      await expect(archiveOwnerNote({
        buildingId: "building-1",
        noteId: "note_12345678",
      })).resolves.toMatchObject({ archivedBy });
    },
  );
});

describe("owner note read adapter", () => {
  beforeEach(() => {
    firebase.onValue.mockReset();
    firebase.query.mockClear();
    firebase.ref.mockClear();
    firebase.orderByChild.mockClear();
    firebase.limitToLast.mockClear();
  });

  it("sorts only well-formed active notes by server creation time newest first", () => {
    expect(sortOwnerNotes({
      "older-note": {
        ...serverNote,
        id: "older-note",
        createdAt: "2026-08-09T01:00:00.000Z",
      },
      "archived-note": {
        ...serverNote,
        id: "archived-note",
        archivedAt: "2026-08-09T02:00:00.000Z",
        archivedBy: "admin-1",
      },
      "newer-note": {
        ...serverNote,
        id: "newer-note",
        createdAt: "2026-08-09T03:00:00.000Z",
        ignoredServerField: "not exposed",
      },
      "bad-created": { ...serverNote, id: "bad-created", createdAt: null },
      mismatchedKey: { ...serverNote, id: "different-id" },
      malformedBody: { ...serverNote, id: "malformedBody", body: 42 },
      "oversized-name": {
        ...serverNote,
        id: "oversized-name",
        createdByName: "가".repeat(86),
      },
      "padded-name": {
        ...serverNote,
        id: "padded-name",
        createdByName: " Padded staff ",
      },
      "partial-archive": {
        ...serverNote,
        id: "partial-archive",
        archivedAt: "2026-08-09T02:30:00.000Z",
      },
      "colon-creator": {
        ...serverNote,
        id: "colon-creator",
        createdBy: "staff:wonju",
      },
      "hangul-creator": {
        ...serverNote,
        id: "hangul-creator",
        createdBy: "원주담당자",
      },
      "forbidden-creator": {
        ...serverNote,
        id: "forbidden-creator",
        createdBy: "bad#uid",
      },
      "over-byte-creator": {
        ...serverNote,
        id: "over-byte-creator",
        createdBy: "가".repeat(43),
      },
      "wrong-building": {
        ...serverNote,
        id: "wrong-building",
        buildingId: "building-2",
      },
      scalar: "skip-me",
    }, "building-1")).toEqual([
      { ...serverNote, id: "newer-note", createdAt: "2026-08-09T03:00:00.000Z" },
      { ...serverNote, id: "colon-creator", createdBy: "staff:wonju" },
      { ...serverNote, id: "hangul-creator", createdBy: "원주담당자" },
      { ...serverNote, id: "older-note", createdAt: "2026-08-09T01:00:00.000Z" },
    ]);
  });

  it("subscribes in createdAt order with the omitted-options default limit of 50", () => {
    const unsubscribe = vi.fn();
    firebase.onValue.mockImplementation((_query, listener) => {
      listener({ val: () => ({
        "note_12345678": serverNote,
        "wrong-building": {
          ...serverNote,
          id: "wrong-building",
          buildingId: "building-2",
        },
      }) });
      return unsubscribe;
    });
    const listener = vi.fn();

    expect(subscribeOwnerNotes(
      "building-1",
      listener,
      vi.fn(),
    )).toBe(unsubscribe);

    expect(firebase.ref).toHaveBeenCalledWith(
      firebase.database,
      "fieldPlatform/ownerNotes/building-1",
    );
    expect(firebase.orderByChild).toHaveBeenCalledWith("createdAt");
    expect(firebase.limitToLast).toHaveBeenCalledWith(50);
    expect(listener).toHaveBeenCalledWith([serverNote]);
  });

  it("treats an explicit empty options object as an unbounded show-all query", () => {
    firebase.onValue.mockReturnValue(vi.fn());

    subscribeOwnerNotes("building-1", vi.fn(), vi.fn(), {});

    expect(firebase.limitToLast).not.toHaveBeenCalled();
    expect(firebase.query).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["bad/path", {}],
    [" building-1", {}],
    ["building-1", { limit: 0 }],
    ["building-1", { limit: -1 }],
    ["building-1", { limit: 1.5 }],
    ["building-1", { limit: Number.NaN }],
    ["building-1", { limit: Number.POSITIVE_INFINITY }],
  ])("rejects an unsafe building or invalid numeric limit before database access", (
    buildingId,
    options,
  ) => {
    expect(() => subscribeOwnerNotes(
      buildingId,
      vi.fn(),
      vi.fn(),
      options,
    )).toThrow();
    expect(firebase.ref).not.toHaveBeenCalled();
    expect(firebase.onValue).not.toHaveBeenCalled();
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
