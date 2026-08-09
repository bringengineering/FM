import { beforeEach, describe, expect, it, vi } from "vitest";

const registrations = vi.hoisted(() => {
  const transactionStates: unknown[] = [];
  const transactionPaths: string[] = [];
  const mutationPaths: string[] = [];
  const transactionCurrent = { value: null as unknown };
  const pathValues = new Map<string, unknown>();
  const readSequences = new Map<string, unknown[]>();
  const databaseTransaction = vi.fn(
    async (
      update: (current: unknown) => unknown,
      _onComplete: unknown,
      _applyLocally: unknown,
      path: string,
    ) => {
      const current = path === "fieldPlatform"
        ? transactionCurrent.value
        : (pathValues.get(path) ?? null);
      const state = update(current);
      const committed = state !== undefined;
      if (committed) {
        if (path === "fieldPlatform") {
          transactionCurrent.value = state;
        } else {
          pathValues.set(path, state);
        }
        if (JSON.stringify(state) !== JSON.stringify(current)) {
          mutationPaths.push(path);
        }
      }
      transactionStates.push(state);
      transactionPaths.push(path);
      return {
        committed,
        snapshot: {
          val: () => committed ? state : current,
          exists: () => (committed ? state : current) !== null,
        },
      };
    },
  );
  const fieldUser = {
    value: { enabled: true, role: "staff" } as unknown,
  };
  const databaseGet = vi.fn(async (path: string) => {
    const sequence = readSequences.get(path);
    const value = sequence && sequence.length > 0
      ? sequence.shift()
      : pathValues.has(path)
        ? pathValues.get(path)
        : path === "fieldPlatform/users/staff-1"
          ? fieldUser.value
          : undefined;
    return {
      val: () => value ?? null,
      exists: () => value !== undefined && value !== null,
    };
  });
  const databaseUpdate = vi.fn(async (path: string, patch: Record<string, unknown>) => {
    pathValues.set(path, { ...(pathValues.get(path) as object || {}), ...patch });
    mutationPaths.push(path);
  });
  return {
    onCall: vi.fn((options: unknown, handler: unknown) => ({
      kind: "callable",
      options,
      handler,
    })),
    onValueWritten: vi.fn((options: unknown, handler: unknown) => ({
      kind: "database",
      options,
      handler,
    })),
    initializeApp: vi.fn(),
    rebuildMapProjectionForBuilding: vi.fn(async () => undefined),
    databaseTransaction,
    databaseGet,
    databaseUpdate,
    databaseRef: vi.fn((path = "") => ({
      get: () => databaseGet(path),
      transaction: (
        update: (current: unknown) => unknown,
        onComplete?: unknown,
        applyLocally?: unknown,
      ) => databaseTransaction(update, onComplete, applyLocally, path),
      update: (patch: Record<string, unknown>) => databaseUpdate(path, patch),
    })),
    storageFile: vi.fn((path: string) => ({
      name: path,
      getMetadata: vi.fn(async () => [{
        generation: "1",
        size: "1024",
        contentType: "image/jpeg",
        md5Hash: "md5",
        crc32c: "crc",
        metadata: {},
      }]),
      copy: vi.fn(async () => [{
        name: path,
        getMetadata: vi.fn(async () => [{ generation: "2" }]),
      }]),
      delete: vi.fn(async () => undefined),
      getSignedUrl: vi.fn(async () => ["https://signed.example/read"]),
    })),
    fieldUser,
    mutationPaths,
    pathValues,
    readSequences,
    transactionStates,
    transactionPaths,
    transactionCurrent,
  };
});

vi.mock("firebase-admin/app", () => ({
  getApps: () => [],
  initializeApp: registrations.initializeApp,
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({}),
}));

vi.mock("firebase-admin/database", () => ({
  getDatabase: () => ({ ref: registrations.databaseRef }),
  ServerValue: { TIMESTAMP: { ".sv": "timestamp" } },
}));

vi.mock("firebase-admin/storage", () => ({
  getStorage: () => ({
    bucket: () => ({ file: registrations.storageFile }),
  }),
}));

vi.mock("firebase-functions/v2/https", () => ({
  HttpsError: class MockHttpsError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  onCall: registrations.onCall,
}));

vi.mock("firebase-functions/v2/database", () => ({
  onValueWritten: registrations.onValueWritten,
}));

vi.mock("../src/field/rebuild-map-projection.js", () => ({
  rebuildMapProjectionForBuilding:
    registrations.rebuildMapProjectionForBuilding,
}));

import * as entrypoints from "../src/index.js";

interface RegisteredEntrypoint {
  kind: "callable" | "database";
  options: Record<string, unknown>;
  handler: unknown;
}

interface DatabaseWriteEvent {
  id: string;
  time: string;
  params: Record<string, string>;
  data: {
    before: { val(): unknown };
    after: { val(): unknown };
  };
}

type DatabaseWriteHandler = (event: DatabaseWriteEvent) => Promise<void>;

type CallableHandler = (request: unknown) => Promise<unknown>;

interface EventScopedProjectionDependencies {
  now(): string;
  setProjection(buildingId: string, projection: unknown): Promise<void>;
}

function registration(value: unknown): RegisteredEntrypoint {
  return value as RegisteredEntrypoint;
}

function databaseHandler(value: unknown): DatabaseWriteHandler {
  return registration(value).handler as DatabaseWriteHandler;
}

function callableHandler(value: unknown): CallableHandler {
  return registration(value).handler as CallableHandler;
}

function validRegistrationData() {
  return {
    requestId: "request-1",
    draftId: "draft-1",
    building: {
      managementNumber: "MGMT-001",
      name: "Test building",
      roadAddress: "1 Test-ro, Wonju",
      latitude: 37.369,
      longitude: 127.928,
      elevator: true,
      parking: { available: true },
    },
    units: [{
      localId: "unit-1",
      unitLabel: "101",
      options: [],
      isVacant: true,
    }],
    listing: {
      depositWon: 3_000_000,
      monthlyRentWon: 350_000,
      maintenanceFeeWon: 50_000,
      maintenanceFeeItems: [],
      parkingDescription: "Available",
      petPolicy: "Ask owner",
      options: [],
    },
    primaryUnitLocalId: "unit-1",
    managementContract: { requested: false },
    ownerNoteDrafts: [{
      localId: "note_12345678",
      body: "Owner requested a follow-up",
      recordedAt: "2026-08-09T01:30:00.000Z",
    }],
  };
}

function validCallableRequest(data: unknown) {
  return {
    auth: {
      uid: "staff-1",
      token: {
        fieldPlatform: true,
        fieldRole: "staff",
        name: "Verified staff",
        auth_time: 1_723_181_696,
      },
    },
    data,
  };
}

const OWNER_NOTE_PATH = "fieldPlatform/ownerNotes/building-1/note_12345678";
const OWNER_RATE_PATH =
  "fieldPlatform/serverState/rateLimits/ownerNotes/staff-1/1723181696/append";

function validOwnerNoteData() {
  return {
    buildingId: "building-1",
    localId: "note_12345678",
    body: "Owner requested a follow-up",
    recordedAt: "2026-08-09T01:30:00.000Z",
  };
}

function ownerNoteRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "note_12345678",
    buildingId: "building-1",
    body: "Owner requested a follow-up",
    recordedAt: "2026-08-09T01:30:00.000Z",
    createdAt: "2026-08-09T02:00:00.000Z",
    createdBy: "staff-1",
    createdByName: "Verified staff",
    ...overrides,
  };
}

function seedOwnerNoteAccess(role: "admin" | "staff" | "reviewer" = "staff") {
  registrations.fieldUser.value = { enabled: true, role };
  registrations.pathValues.set(
    `fieldPlatform/users/${role === "admin" ? "admin-1" : "staff-1"}`,
    { enabled: true, role },
  );
  const uid = role === "admin" ? "admin-1" : "staff-1";
  registrations.pathValues.set(`fieldPlatform/users/${uid}/enabled`, true);
  registrations.pathValues.set(`fieldPlatform/users/${uid}/displayName`,
    role === "admin" ? "Administrator" : "Verified staff");
  registrations.pathValues.set("fieldPlatform/buildings/building-1", { id: "building-1" });
  registrations.pathValues.set(
    `fieldPlatform/buildingAssignments/building-1/${uid}`,
    true,
  );
}

function validOwnerCallableRequest(
  data: unknown,
  role: "admin" | "staff" | "reviewer" = "staff",
) {
  const uid = role === "admin" ? "admin-1" : "staff-1";
  return {
    auth: {
      uid,
      token: {
        fieldPlatform: true,
        fieldRole: role,
        name: role === "admin" ? "Administrator" : "Verified staff",
        auth_time: 1_723_181_696,
      },
    },
    data,
  };
}

const EVENT_VERSION = {
  eventTime: "2026-08-09T12:00:02.000Z",
  revision: "database-event-2",
};

beforeEach(() => {
  registrations.rebuildMapProjectionForBuilding.mockClear();
  registrations.databaseRef.mockClear();
  registrations.databaseTransaction.mockClear();
  registrations.databaseGet.mockClear();
  registrations.databaseUpdate.mockClear();
  registrations.storageFile.mockClear();
  registrations.fieldUser.value = { enabled: true, role: "staff" };
  registrations.mutationPaths.length = 0;
  registrations.pathValues.clear();
  registrations.readSequences.clear();
  registrations.transactionStates.length = 0;
  registrations.transactionPaths.length = 0;
  registrations.transactionCurrent.value = null;
});

describe("Firebase entrypoint metadata", () => {
  it.each([
    ["blank body", (data: ReturnType<typeof validRegistrationData>) => {
      data.ownerNoteDrafts[0].body = "   ";
    }],
    ["duplicate IDs", (data: ReturnType<typeof validRegistrationData>) => {
      data.ownerNoteDrafts.push({ ...data.ownerNoteDrafts[0] });
    }],
    ["more than 100 drafts", (data: ReturnType<typeof validRegistrationData>) => {
      data.ownerNoteDrafts = Array.from({ length: 101 }, (_, index) => ({
        ...data.ownerNoteDrafts[0],
        localId: `note_${String(index).padStart(8, "0")}`,
      }));
    }],
    ["noncanonical recordedAt", (data: ReturnType<typeof validRegistrationData>) => {
      data.ownerNoteDrafts[0].recordedAt = "2026-08-09T01:30:00Z";
    }],
  ])("maps an initial owner-note %s to invalid-argument", async (_label, mutate) => {
    const data = validRegistrationData();
    mutate(data);

    await expect(
      callableHandler(entrypoints.saveFieldRegistration)(
        validCallableRequest(data),
      ),
    ).rejects.toMatchObject({
      code: "invalid-argument",
      message: "field_invalid_registration",
    });
  });

  it("derives the note actor name and decimal session ID only from verified claims", async () => {
    const actor = await entrypoints.requireFieldActor({
      auth: {
        uid: "staff-1",
        token: {
          fieldPlatform: true,
          fieldRole: "staff",
          name: "인증된 이름",
          auth_time: 1_723_181_696,
        },
      },
      data: {
        tokenDisplayName: "위조 이름",
        sessionId: "위조 세션",
      },
    } as never);

    expect(actor).toEqual({
      uid: "staff-1",
      role: "staff",
      enabled: true,
      tokenDisplayName: "인증된 이름",
      sessionId: "1723181696",
    });
    expect(registrations.databaseRef).toHaveBeenCalledWith(
      "fieldPlatform/users/staff-1",
    );
  });

  it("exports all field callables with their exact App Check options", () => {
    expect(registration(entrypoints.saveFieldRegistration)).toMatchObject({
      kind: "callable",
      options: {
        region: "asia-northeast3",
        enforceAppCheck: true,
      },
    });
    expect(registration(entrypoints.saveFieldRegistration).options).toEqual({
      region: "asia-northeast3",
      enforceAppCheck: true,
    });

    expect(registration(entrypoints.setManagementContractStatus)).toMatchObject({
      kind: "callable",
      options: {
        region: "asia-northeast3",
        enforceAppCheck: true,
      },
    });
    expect(
      registration(entrypoints.setManagementContractStatus).options,
    ).toEqual({
      region: "asia-northeast3",
      enforceAppCheck: true,
    });

    expect(registration(entrypoints.startFieldCaptureSession)).toMatchObject({
      kind: "callable",
      options: {
        region: "asia-northeast3",
        enforceAppCheck: true,
        consumeAppCheckToken: true,
      },
    });
    expect(registration(entrypoints.startFieldCaptureSession).options).toEqual({
      region: "asia-northeast3",
      enforceAppCheck: true,
      consumeAppCheckToken: true,
    });

    for (const callable of [
      entrypoints.finalizeFieldMedia,
      entrypoints.getFieldMediaAccess,
      entrypoints.excludeFieldMedia,
      entrypoints.listFieldCaptureWorkspace,
    ]) {
      expect(registration(callable)).toMatchObject({
        kind: "callable",
        options: {
          region: "asia-northeast3",
          enforceAppCheck: true,
          consumeAppCheckToken: true,
        },
      });
      expect(registration(callable).options).toEqual({
        region: "asia-northeast3",
        enforceAppCheck: true,
        consumeAppCheckToken: true,
      });
    }

    for (const callable of [
      entrypoints.appendOwnerNote,
      entrypoints.archiveOwnerNote,
    ]) {
      expect(registration(callable)).toMatchObject({
        kind: "callable",
        options: {
          region: "asia-northeast3",
          enforceAppCheck: true,
        },
      });
      expect(registration(callable).options).toEqual({
        region: "asia-northeast3",
        enforceAppCheck: true,
      });
    }
  });

  it.each([
    [
      "building",
      entrypoints.rebuildMapProjectionOnBuildingWrite,
      "/fieldPlatform/buildings/{buildingId}",
    ],
    [
      "listing",
      entrypoints.rebuildMapProjectionOnListingWrite,
      "/fieldPlatform/listings/{listingId}",
    ],
    [
      "media",
      entrypoints.rebuildMapProjectionOnMediaWrite,
      "/fieldPlatform/media/{mediaId}",
    ],
  ])("exports the %s projection trigger with exact RTDB options", (_name, value, ref) => {
    expect(registration(value)).toMatchObject({ kind: "database" });
    expect(registration(value).options).toEqual({
      ref,
      instance: "bring-fm-hj-default-rtdb",
      region: "asia-southeast1",
    });
  });

  it("keeps provisionFieldUser exported while registering exactly thirteen entrypoints", () => {
    expect(entrypoints.provisionFieldUser).toBeDefined();
    expect(registration(entrypoints.provisionFieldUser)).toMatchObject({
      kind: "callable",
      options: { region: "asia-northeast3" },
    });
    expect(registrations.initializeApp).toHaveBeenCalledTimes(1);
    expect(registrations.onCall).toHaveBeenCalledTimes(10);
    expect(registrations.onValueWritten).toHaveBeenCalledTimes(3);
  });

  it("returns assigned capture workspace data through one protected rate-limited callable", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
    registrations.pathValues.set("fieldPlatform/buildingAssignments", {
      "building-1": { "staff-1": true },
      "foreign-building": { "other-staff": true },
    });
    registrations.pathValues.set("fieldPlatform/buildings", {
      "building-1": {
        id: "building-1",
        name: "관리 건물",
        managementContract: { status: "active" },
      },
      "foreign-building": {
        id: "foreign-building",
        name: "미배정 건물",
        managementContract: { status: "active" },
      },
    });
    registrations.pathValues.set("fieldPlatform/units", {
      "unit-1": { id: "unit-1", buildingId: "building-1", unitLabel: "201호" },
    });
    registrations.pathValues.set("fieldPlatform/listings", {
      "listing-1": {
        id: "listing-1",
        buildingId: "building-1",
        unitId: "unit-1",
        unitLabel: "201호",
        status: "capturing",
      },
    });
    registrations.pathValues.set("fieldPlatform/captureSessions", {
      "11111111-1111-4111-8111-111111111111": {
        id: "11111111-1111-4111-8111-111111111111",
        requestId: "22222222-2222-4222-8222-222222222222",
        buildingId: "building-1",
        unitId: "unit-1",
        listingId: "listing-1",
        visitId: "33333333-3333-4333-8333-333333333333",
        createdBy: "staff-1",
        status: "open",
        createdAt: "2026-08-09T09:00:00.000Z",
        updatedAt: "2026-08-09T09:30:00.000Z",
      },
    });

    await expect(callableHandler(entrypoints.listFieldCaptureWorkspace)(
      validCallableRequest({}),
    )).resolves.toEqual({
      targets: [
        {
          id: "management:building-1:unit-1",
          buildingId: "building-1",
          buildingName: "관리 건물",
          unitId: "unit-1",
          unitLabel: "201호",
          source: "management",
        },
        {
          id: "advertising:listing-1",
          buildingId: "building-1",
          buildingName: "관리 건물",
          unitId: "unit-1",
          unitLabel: "201호",
          listingId: "listing-1",
          source: "advertising",
        },
      ],
      openSessions: [expect.objectContaining({
        id: "11111111-1111-4111-8111-111111111111",
        createdBy: "staff-1",
        status: "open",
      })],
    });
    expect(registrations.transactionPaths).toContain(
      "fieldPlatform/rateLimits/captureWorkspace/staff-1/1723181696",
    );
    expect(registrations.databaseRef).not.toHaveBeenCalledWith(
      "fieldPlatform/buildings/foreign-building",
    );
    now.mockRestore();
  });

  it("rejects unauthenticated capture workspace reads before database access", async () => {
    await expect(callableHandler(entrypoints.listFieldCaptureWorkspace)({
      data: {},
    })).rejects.toMatchObject({
      code: "unauthenticated",
      message: "field_auth_required",
    });
    expect(registrations.databaseGet).not.toHaveBeenCalled();
  });

  it("rate-limits media access by UID/media and signs only the finalized path", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    registrations.pathValues.set("fieldPlatform/users/staff-1/enabled", true);
    registrations.pathValues.set(
      "fieldPlatform/buildingAssignments/b1/staff-1",
      true,
    );
    registrations.pathValues.set("fieldPlatform/media/media-1", {
      id: "media-1",
      buildingId: "b1",
      uploadState: "finalized",
      storagePath: "field-media-finalized/b1/media-1.jpg",
    });

    await expect(callableHandler(entrypoints.getFieldMediaAccess)(
      validCallableRequest({ mediaId: "media-1" }),
    )).resolves.toEqual({
      url: "https://signed.example/read",
      expiresAt: "1970-01-01T00:05:01.000Z",
    });
    expect(registrations.transactionPaths).toContain(
      "fieldPlatform/rateLimits/mediaAccess/staff-1/media-1",
    );
    expect(registrations.storageFile).toHaveBeenCalledWith(
      "field-media-finalized/b1/media-1.jpg",
    );
    now.mockRestore();
  });

  it("maps a media rate-limit rejection without reaching Storage", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    registrations.pathValues.set(
      "fieldPlatform/rateLimits/mediaAccess/staff-1/media-1",
      { windowStartedAt: 1_000, count: 120 },
    );
    await expect(callableHandler(entrypoints.getFieldMediaAccess)(
      validCallableRequest({ mediaId: "media-1" }),
    )).rejects.toMatchObject({
      code: "resource-exhausted",
      message: "field_rate_limit_exceeded",
    });
    expect(registrations.storageFile).not.toHaveBeenCalled();
    now.mockRestore();
  });

  it("creates an owner note through one current-or-candidate transaction", async () => {
    seedOwnerNoteAccess();

    const result = await callableHandler(entrypoints.appendOwnerNote)(
      validOwnerCallableRequest(validOwnerNoteData()),
    );

    expect(result).toEqual({
      note: expect.objectContaining({
        id: "note_12345678",
        buildingId: "building-1",
        body: "Owner requested a follow-up",
        createdBy: "staff-1",
        createdByName: "Verified staff",
      }),
    });
    expect(registrations.transactionPaths).toContain(OWNER_NOTE_PATH);
    expect(registrations.pathValues.get(OWNER_NOTE_PATH)).toEqual(
      (result as { note: unknown }).note,
    );
  });

  it("uses a bounded current-session rate key when auth_time is unavailable", async () => {
    seedOwnerNoteAccess();
    const request = validOwnerCallableRequest(validOwnerNoteData());
    delete (request.auth.token as { auth_time?: number }).auth_time;

    await callableHandler(entrypoints.appendOwnerNote)(request);

    expect(registrations.transactionPaths).toContain(
      "fieldPlatform/serverState/rateLimits/ownerNotes/staff-1/current/append",
    );
    expect(registrations.transactionPaths.join("\n")).not.toContain("undefined");
  });

  it("returns an id conflict without overwriting the transaction winner", async () => {
    seedOwnerNoteAccess();
    const winner = ownerNoteRecord({ body: "Concurrent winner" });
    registrations.readSequences.set(OWNER_NOTE_PATH, [null]);
    registrations.pathValues.set(OWNER_NOTE_PATH, winner);

    await expect(callableHandler(entrypoints.appendOwnerNote)(
      validOwnerCallableRequest(validOwnerNoteData()),
    )).rejects.toMatchObject({
      code: "already-exists",
      message: "owner_note_id_conflict",
    });

    expect(registrations.pathValues.get(OWNER_NOTE_PATH)).toEqual(winner);
    expect(registrations.mutationPaths).not.toContain(OWNER_NOTE_PATH);
  });

  it("rejects a malformed append transaction winner without mutation", async () => {
    seedOwnerNoteAccess();
    const malformedWinner = ownerNoteRecord({ createdAt: "not-a-date" });
    registrations.readSequences.set(OWNER_NOTE_PATH, [null]);
    registrations.pathValues.set(OWNER_NOTE_PATH, malformedWinner);

    await expect(callableHandler(entrypoints.appendOwnerNote)(
      validOwnerCallableRequest(validOwnerNoteData()),
    )).rejects.toMatchObject({
      code: "internal",
      message: "owner_note_internal",
    });

    expect(registrations.pathValues.get(OWNER_NOTE_PATH)).toEqual(malformedWinner);
    expect(registrations.mutationPaths).not.toContain(OWNER_NOTE_PATH);
  });

  it("accepts an auth-boundary colon UID through append persistence", async () => {
    const uid = "staff:wonju";
    registrations.pathValues.set(`fieldPlatform/users/${uid}`, {
      enabled: true,
      role: "staff",
    });
    registrations.pathValues.set(`fieldPlatform/users/${uid}/enabled`, true);
    registrations.pathValues.set(
      `fieldPlatform/users/${uid}/displayName`,
      "Verified staff",
    );
    registrations.pathValues.set("fieldPlatform/buildings/building-1", {
      id: "building-1",
    });
    registrations.pathValues.set(
      `fieldPlatform/buildingAssignments/building-1/${uid}`,
      true,
    );

    const result = await callableHandler(entrypoints.appendOwnerNote)({
      auth: {
        uid,
        token: {
          fieldPlatform: true,
          fieldRole: "staff",
          name: "Verified staff",
          auth_time: 1_723_181_696,
        },
      },
      data: validOwnerNoteData(),
    });

    expect(result).toEqual({
      note: expect.objectContaining({ createdBy: uid }),
    });
    expect(registrations.pathValues.get(OWNER_NOTE_PATH)).toMatchObject({
      createdBy: uid,
    });
    expect(registrations.transactionPaths).toContain(OWNER_NOTE_PATH);
  });

  it("rejects malformed stored state on the append pre-read", async () => {
    seedOwnerNoteAccess();
    const malformedStored = ownerNoteRecord({
      createdByName: "Bad\u007fname",
    });
    registrations.pathValues.set(OWNER_NOTE_PATH, malformedStored);

    await expect(callableHandler(entrypoints.appendOwnerNote)(
      validOwnerCallableRequest(validOwnerNoteData()),
    )).rejects.toMatchObject({
      code: "internal",
      message: "owner_note_internal",
    });

    expect(registrations.pathValues.get(OWNER_NOTE_PATH)).toEqual(malformedStored);
    expect(registrations.transactionPaths).not.toContain(OWNER_NOTE_PATH);
  });

  it("strips extra stored fields from an idempotent append response", async () => {
    seedOwnerNoteAccess();
    registrations.pathValues.set(OWNER_NOTE_PATH, ownerNoteRecord({
      ignoredServerField: "must not escape",
    }));

    const result = await callableHandler(entrypoints.appendOwnerNote)(
      validOwnerCallableRequest(validOwnerNoteData()),
    );

    expect(result).toEqual({ note: ownerNoteRecord() });
    expect(result).not.toHaveProperty("note.ignoredServerField");
    expect(registrations.transactionPaths).not.toContain(OWNER_NOTE_PATH);
  });

  it("preserves and returns the first archive winner in a transaction race", async () => {
    seedOwnerNoteAccess("admin");
    const active = ownerNoteRecord({ createdBy: "staff-1" });
    const winner = ownerNoteRecord({
      createdBy: "staff-1",
      archivedAt: "2026-08-09T02:30:00.000Z",
      archivedBy: "admin-winner",
    });
    registrations.readSequences.set(OWNER_NOTE_PATH, [active]);
    registrations.pathValues.set(OWNER_NOTE_PATH, winner);

    await expect(callableHandler(entrypoints.archiveOwnerNote)(
      validOwnerCallableRequest(
        { buildingId: "building-1", noteId: "note_12345678" },
        "admin",
      ),
    )).resolves.toEqual({
      archivedAt: "2026-08-09T02:30:00.000Z",
      archivedBy: "admin-winner",
    });

    expect(registrations.pathValues.get(OWNER_NOTE_PATH)).toEqual(winner);
    expect(registrations.mutationPaths).not.toContain(OWNER_NOTE_PATH);
  });

  it("never recreates a note deleted between the archive read and transaction", async () => {
    seedOwnerNoteAccess("admin");
    registrations.readSequences.set(OWNER_NOTE_PATH, [ownerNoteRecord()]);

    await expect(callableHandler(entrypoints.archiveOwnerNote)(
      validOwnerCallableRequest(
        { buildingId: "building-1", noteId: "note_12345678" },
        "admin",
      ),
    )).rejects.toMatchObject({
      code: "not-found",
      message: "owner_note_not_found",
    });

    expect(registrations.pathValues.has(OWNER_NOTE_PATH)).toBe(false);
    expect(registrations.mutationPaths).not.toContain(OWNER_NOTE_PATH);
  });

  it("rejects malformed archive transaction state without mutating it", async () => {
    seedOwnerNoteAccess("admin");
    const malformedWinner = ownerNoteRecord({
      archivedAt: "2026-08-09T02:30:00.000Z",
    });
    registrations.readSequences.set(OWNER_NOTE_PATH, [ownerNoteRecord()]);
    registrations.pathValues.set(OWNER_NOTE_PATH, malformedWinner);

    await expect(callableHandler(entrypoints.archiveOwnerNote)(
      validOwnerCallableRequest(
        { buildingId: "building-1", noteId: "note_12345678" },
        "admin",
      ),
    )).rejects.toMatchObject({
      code: "internal",
      message: "owner_note_internal",
    });

    expect(registrations.pathValues.get(OWNER_NOTE_PATH)).toEqual(malformedWinner);
    expect(registrations.mutationPaths).not.toContain(OWNER_NOTE_PATH);
  });

  it("maps archive role and input failures without mutating a note", async () => {
    seedOwnerNoteAccess("reviewer");
    registrations.pathValues.set(OWNER_NOTE_PATH, ownerNoteRecord());

    await expect(callableHandler(entrypoints.archiveOwnerNote)(
      validOwnerCallableRequest(
        { buildingId: "building-1", noteId: "note_12345678" },
        "reviewer",
      ),
    )).rejects.toMatchObject({
      code: "permission-denied",
      message: "owner_note_archive_forbidden",
    });

    seedOwnerNoteAccess("admin");
    await expect(callableHandler(entrypoints.archiveOwnerNote)(
      validOwnerCallableRequest(
        { buildingId: "bad/path", noteId: "note_12345678" },
        "admin",
      ),
    )).rejects.toMatchObject({
      code: "invalid-argument",
      message: "owner_note_building_id_invalid",
    });
    expect(registrations.mutationPaths).not.toContain(OWNER_NOTE_PATH);
  });

  it.each([
    ["unsafe input", "invalid-argument", "owner_note_building_id_invalid"],
    ["unassigned staff", "permission-denied", "owner_note_forbidden"],
    ["reviewer", "permission-denied", "owner_note_forbidden"],
    ["rate limit", "resource-exhausted", "owner_note_rate_limited"],
    ["missing building", "not-found", "owner_note_building_not_found"],
  ])("maps %s and performs no owner-note mutation", async (scenario, code, message) => {
    const role = scenario === "reviewer" ? "reviewer" : "staff";
    seedOwnerNoteAccess(role);
    let data = validOwnerNoteData();
    if (scenario === "unsafe input") data = { ...data, buildingId: "bad/path" };
    if (scenario === "unassigned staff") {
      registrations.pathValues.set(
        "fieldPlatform/buildingAssignments/building-1/staff-1",
        false,
      );
    }
    if (scenario === "rate limit") {
      registrations.pathValues.set(OWNER_RATE_PATH, {
        windowStartedAt: Date.now(),
        count: 30,
      });
    }
    if (scenario === "missing building") {
      registrations.pathValues.delete("fieldPlatform/buildings/building-1");
    }

    await expect(callableHandler(entrypoints.appendOwnerNote)(
      validOwnerCallableRequest(data, role),
    )).rejects.toMatchObject({ code, message });

    expect(registrations.pathValues.has(OWNER_NOTE_PATH)).toBe(false);
    expect(registrations.mutationPaths).not.toContain(OWNER_NOTE_PATH);
  });

  it("maps disabled authentication and unexpected database failures safely", async () => {
    seedOwnerNoteAccess();
    registrations.pathValues.set("fieldPlatform/users/staff-1", {
      enabled: false,
      role: "staff",
    });
    await expect(callableHandler(entrypoints.appendOwnerNote)(
      validOwnerCallableRequest(validOwnerNoteData()),
    )).rejects.toMatchObject({
      code: "permission-denied",
      message: "field_access_denied",
    });
    expect(registrations.mutationPaths).not.toContain(OWNER_NOTE_PATH);

    registrations.databaseGet.mockRejectedValueOnce(new Error("database_offline"));
    await expect(callableHandler(entrypoints.appendOwnerNote)(
      validOwnerCallableRequest(validOwnerNoteData()),
    )).rejects.toMatchObject({
      code: "internal",
      message: "owner_note_internal",
    });
  });

  it("maps malformed atomic archive results to internal, not invalid-argument", async () => {
    seedOwnerNoteAccess("admin");
    registrations.readSequences.set(OWNER_NOTE_PATH, [ownerNoteRecord()]);
    registrations.pathValues.set(OWNER_NOTE_PATH, ownerNoteRecord({
      archivedAt: "not-a-date",
      archivedBy: "admin-winner",
    }));

    await expect(callableHandler(entrypoints.archiveOwnerNote)(
      validOwnerCallableRequest(
        { buildingId: "building-1", noteId: "note_12345678" },
        "admin",
      ),
    )).rejects.toMatchObject({
      code: "internal",
      message: "owner_note_internal",
    });
  });

  it("rebuilds from transaction-current state instead of an obsolete pre-read candidate", async () => {
    await databaseHandler(
      entrypoints.rebuildMapProjectionOnBuildingWrite,
    )({
      id: EVENT_VERSION.revision,
      time: EVENT_VERSION.eventTime,
      params: { buildingId: "building-1" },
      data: {
        before: { val: () => null },
        after: { val: () => null },
      },
    });

    expect(
      registrations.rebuildMapProjectionForBuilding,
    ).toHaveBeenCalledWith("building-1", expect.any(Object));
    const call = registrations.rebuildMapProjectionForBuilding.mock.calls[0];
    expect(call).toHaveLength(2);
    const dependencies = call[1] as EventScopedProjectionDependencies;
    expect(dependencies.now()).toBe(EVENT_VERSION.eventTime);

    registrations.transactionCurrent.value = {
      buildings: {
        "building-1": {
          id: "building-1",
          name: "Current paused building",
          roadAddress: "1 Current-ro, Wonju",
          latitude: 37.369,
          longitude: 127.928,
          managementContract: {
            status: "paused",
            startedOn: "2026-08-01",
            updatedAt: "2026-08-09T12:00:03.000Z",
            updatedBy: "admin-1",
          },
        },
      },
      listings: {},
      media: {},
    };
    await dependencies.setProjection("building-1", {
      buildingId: "building-1",
      name: "Obsolete active projection",
      roadAddress: "1 Old-ro, Wonju",
      latitude: 37.369,
      longitude: 127.928,
      markerStatus: "managed",
      vacancyCount: 0,
      approvedRentSummary: "obsolete",
      parkingSummary: "obsolete",
      captureStatus: "notStarted",
      updatedAt: "2026-08-09T12:00:01.000Z",
    });

    expect(registrations.databaseRef).toHaveBeenCalledWith("fieldPlatform");
    expect(registrations.databaseTransaction).toHaveBeenCalledTimes(1);
    expect(registrations.transactionStates[0]).not.toHaveProperty(
      "mapProjections.building-1",
    );
    expect(registrations.transactionStates[0]).not.toHaveProperty(
      "mapProjectionVersions",
    );
  });

  it.each([
    ["listing", entrypoints.rebuildMapProjectionOnListingWrite],
    ["media", entrypoints.rebuildMapProjectionOnMediaWrite],
  ])(
    "refreshes both distinct path-safe building IDs once for a %s move",
    async (_name, trigger) => {
      const handler = databaseHandler(trigger);
      await handler({
        id: EVENT_VERSION.revision,
        time: EVENT_VERSION.eventTime,
        params: {},
        data: {
          before: { val: () => ({ buildingId: "building-before" }) },
          after: { val: () => ({ buildingId: "building-after" }) },
        },
      });

      expect(
        registrations.rebuildMapProjectionForBuilding.mock.calls.map(
          ([buildingId]) => buildingId,
        ),
      ).toEqual(["building-before", "building-after"]);
      expect(
        registrations.rebuildMapProjectionForBuilding,
      ).toHaveBeenCalledTimes(2);
      for (const call of registrations.rebuildMapProjectionForBuilding.mock.calls) {
        expect(call).toHaveLength(2);
        expect(
          (call[1] as EventScopedProjectionDependencies).now(),
        ).toBe(EVENT_VERSION.eventTime);
      }

      registrations.rebuildMapProjectionForBuilding.mockClear();
      await handler({
        id: EVENT_VERSION.revision,
        time: EVENT_VERSION.eventTime,
        params: {},
        data: {
          before: { val: () => ({ buildingId: "building-same" }) },
          after: { val: () => ({ buildingId: "building-same" }) },
        },
      });
      expect(
        registrations.rebuildMapProjectionForBuilding,
      ).toHaveBeenCalledTimes(1);
      expect(
        registrations.rebuildMapProjectionForBuilding,
      ).toHaveBeenCalledWith("building-same", expect.any(Object));
    },
  );

  it("ignores reversed CloudEvent IDs at the same timestamp", async () => {
    const handler = databaseHandler(
      entrypoints.rebuildMapProjectionOnBuildingWrite,
    );
    registrations.transactionCurrent.value = {
      buildings: {
        "building-1": {
          id: "building-1",
          name: "Authoritative same-time building",
          roadAddress: "1 Current-ro, Wonju",
          latitude: 37.369,
          longitude: 127.928,
          managementContract: {
            status: "active",
            startedOn: "2026-08-01",
            updatedAt: "2026-08-09T12:00:06.000Z",
            updatedBy: "admin-1",
          },
        },
      },
      listings: {},
      media: {},
    };

    for (const id of ["zzzz-event", "aaaa-event"]) {
      await handler({
        id,
        time: "2026-08-09T12:00:06.123456Z",
        params: { buildingId: "building-1" },
        data: {
          before: { val: () => null },
          after: { val: () => null },
        },
      });
      const call = registrations.rebuildMapProjectionForBuilding.mock.calls.at(-1);
      expect(call).toHaveLength(2);
      await (call?.[1] as EventScopedProjectionDependencies).setProjection(
        "building-1",
        { name: `obsolete-${id}` },
      );
    }

    expect(registrations.transactionCurrent.value).toMatchObject({
      mapProjections: {
        "building-1": {
          name: "Authoritative same-time building",
          updatedAt: "2026-08-09T12:00:06.123456Z",
        },
      },
    });
    expect(registrations.transactionCurrent.value).not.toHaveProperty(
      "mapProjectionVersions",
    );
  });
});
