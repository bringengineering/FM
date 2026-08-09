import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type {
  FieldActor,
  SaveFieldRegistrationInput,
} from "../src/field/contracts.js";
import {
  saveFieldRegistrationCore,
  type RegistrationReservation,
  type RegistrationReservationOutcome,
  type RegistrationRequestReceipt,
  type SaveFieldRegistrationDependencies,
} from "../src/field/save-field-registration.js";

const NOW = "2026-08-09T12:34:56.000Z";

const staffActor: FieldActor = {
  uid: "staff-1",
  role: "staff",
  enabled: true,
  tokenDisplayName: "인증 토큰 이름",
  sessionId: "1723181696",
};

const adminActor: FieldActor = {
  uid: "admin-1",
  role: "admin",
  enabled: true,
};

function validRegistrationInput(): SaveFieldRegistrationInput {
  return {
    requestId: "request-1",
    draftId: "draft-1",
    building: {
      managementNumber: "MGMT-001",
      name: "상지 하우스",
      roadAddress: "강원특별자치도 원주시 상지대길 1",
      jibunAddress: "강원특별자치도 원주시 우산동 1",
      latitude: 37.369,
      longitude: 127.928,
      purpose: "다가구주택",
      completionYear: 2020,
      floorCount: 4,
      elevator: true,
      parking: { available: true, totalSpaces: 8 },
    },
    units: [
      {
        localId: "unit-1",
        unitLabel: "101호",
        structure: "원룸",
        floor: 1,
        options: ["에어컨", "세탁기"],
        isVacant: true,
      },
    ],
    listing: {
      depositWon: 3_000_000,
      monthlyRentWon: 350_000,
      maintenanceFeeWon: 50_000,
      maintenanceFeeItems: ["수도", "공용전기"],
      availableFrom: "2026-08-10",
      contractTermMonths: 12,
      parkingDescription: "1대 가능",
      petPolicy: "협의",
      vacancyReason: "기존 임차인 퇴거",
      vacantSince: "2026-08-01",
      moveInCondition: "즉시 입주",
      locationDescription: "상지대학교 정문 도보 5분",
      options: ["에어컨", "세탁기"],
    },
    primaryUnitLocalId: "unit-1",
    managementContract: {
      requested: true,
      startedOn: "2026-08-09",
    },
    ownerNoteDrafts: [
      {
        localId: "note_12345678",
        body: "  현관 비밀번호는 광고 담당자에게만 전달  ",
        recordedAt: "2026-08-09T01:30:00.000Z",
      },
    ],
  };
}

function deterministicEntityId(
  prefix: string,
  uid: string,
  draftId: string,
  localId: string,
): string {
  const digest = createHash("sha256")
    .update(`${uid}\0${draftId}\0${localId}`)
    .digest("hex")
    .slice(0, 24);
  return `${prefix}_${digest}`;
}

interface InMemoryAdapterOptions {
  beforeReceiptRead?: () => Promise<void>;
  persistReceipts?: boolean;
  now?: () => string;
}

function cloneReservation(
  reservation: RegistrationReservation,
): RegistrationReservation {
  return {
    ...reservation,
    result: {
      ...reservation.result,
      unitIds: { ...reservation.result.unitIds },
    },
  };
}

function createBarrier(participants: number): () => Promise<void> {
  let arrivals = 0;
  let release: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });

  return async () => {
    arrivals += 1;
    if (arrivals === participants) release?.();
    await ready;
  };
}

function createInMemoryAdapter(options: InMemoryAdapterOptions = {}) {
  const receipts = new Map<string, RegistrationRequestReceipt>();
  const reservationsByRequest = new Map<string, RegistrationReservation>();
  const reservationsByDraft = new Map<string, RegistrationReservation>();
  const patches: Record<string, unknown>[] = [];

  const dependencies: SaveFieldRegistrationDependencies = {
    getReceipt: vi.fn(async (uid, requestId) => {
      await options.beforeReceiptRead?.();
      return receipts.get(`${uid}\0${requestId}`) ?? null;
    }),
    reserveRegistration: vi.fn(
      async (
        proposed: RegistrationReservation,
      ): Promise<RegistrationReservationOutcome> => {
        const requestKey = `${proposed.uid}\0${proposed.requestId}`;
        const draftKey = `${proposed.uid}\0${proposed.draftId}`;
        const requestReservation = reservationsByRequest.get(requestKey);
        if (requestReservation) {
          if (
            requestReservation.requestHash !== proposed.requestHash ||
            requestReservation.draftId !== proposed.draftId
          ) {
            return { status: "requestConflict" };
          }
          return {
            status: "acquired",
            reservation: cloneReservation(requestReservation),
          };
        }

        const draftReservation = reservationsByDraft.get(draftKey);
        if (
          draftReservation &&
          draftReservation.requestId !== proposed.requestId
        ) {
          return { status: "draftConflict" };
        }

        const stored = cloneReservation(proposed);
        reservationsByRequest.set(requestKey, stored);
        reservationsByDraft.set(draftKey, stored);
        return { status: "acquired", reservation: cloneReservation(stored) };
      },
    ),
    updateRoot: vi.fn(async (patch) => {
      patches.push(patch);
      if (options.persistReceipts === false) return;
      for (const [path, value] of Object.entries(patch)) {
        const match = /^fieldPlatform\/registrationRequests\/([^/]+)\/([^/]+)$/.exec(
          path,
        );
        if (match) {
          receipts.set(
            `${match[1]}\0${match[2]}`,
            value as RegistrationRequestReceipt,
          );
        }
      }
    }),
    getUserDisplayName: vi.fn(async () => "서버 프로필 이름"),
    now: vi.fn(options.now ?? (() => NOW)),
  };

  return {
    dependencies,
    patches,
    receipts,
    reservationsByRequest,
    reservationsByDraft,
  };
}

async function expectInvalid(input: SaveFieldRegistrationInput): Promise<void> {
  const { dependencies } = createInMemoryAdapter();

  await expect(
    saveFieldRegistrationCore(input, staffActor, dependencies),
  ).rejects.toThrow("field_invalid_registration");
  expect(dependencies.reserveRegistration).not.toHaveBeenCalled();
  expect(dependencies.updateRoot).not.toHaveBeenCalled();
}

describe("saveFieldRegistrationCore", () => {
  it("saves a staff contract request as pending with deterministic entity IDs", async () => {
    const input = validRegistrationInput();
    const { dependencies, patches } = createInMemoryAdapter();

    const result = await saveFieldRegistrationCore(input, staffActor, dependencies);

    expect(result).toEqual({
      buildingId: expect.stringMatching(/^building_/),
      unitIds: { "unit-1": expect.stringMatching(/^unit_/) },
      listingId: expect.stringMatching(/^listing_/),
      visitId: expect.stringMatching(/^visit_/),
    });
    expect(result).toEqual({
      buildingId: deterministicEntityId(
        "building",
        staffActor.uid,
        input.draftId,
        input.draftId,
      ),
      unitIds: {
        "unit-1": deterministicEntityId(
          "unit",
          staffActor.uid,
          input.draftId,
          "unit-1",
        ),
      },
      listingId: deterministicEntityId(
        "listing",
        staffActor.uid,
        input.draftId,
        input.primaryUnitLocalId,
      ),
      visitId: deterministicEntityId(
        "visit",
        staffActor.uid,
        input.draftId,
        input.primaryUnitLocalId,
      ),
    });

    const patch = patches[0];
    expect(patch[`fieldPlatform/buildings/${result.buildingId}`]).toMatchObject({
      id: result.buildingId,
      managementNumber: "MGMT-001",
      name: "상지 하우스",
      assignedStaffIds: [staffActor.uid],
      managementContract: {
        status: "pending",
        startedOn: "2026-08-09",
        updatedAt: NOW,
        updatedBy: staffActor.uid,
      },
      createdAt: NOW,
      createdBy: staffActor.uid,
      updatedAt: NOW,
      updatedBy: staffActor.uid,
    });
    expect(patch[`fieldPlatform/mapProjections/${result.buildingId}`]).toBeNull();
    expect(
      patch[`fieldPlatform/ownerNotes/${result.buildingId}/note_12345678`],
    ).toEqual({
      id: "note_12345678",
      buildingId: result.buildingId,
      body: "현관 비밀번호는 광고 담당자에게만 전달",
      recordedAt: "2026-08-09T01:30:00.000Z",
      createdAt: NOW,
      createdBy: staffActor.uid,
      createdByName: "서버 프로필 이름",
    });
    expect(dependencies.now).toHaveBeenCalledTimes(1);
  });

  it("saves an admin contract request as active and builds the safe projection", async () => {
    const input = validRegistrationInput();
    (input.building as typeof input.building & { ownerPhone: string }).ownerPhone =
      "TEST-OWNER-PHONE";
    (input.listing as typeof input.listing & { secureNote: string }).secureNote =
      "TEST-SECURE-NOTE";
    const { dependencies, patches } = createInMemoryAdapter();

    const result = await saveFieldRegistrationCore(input, adminActor, dependencies);
    const patch = patches[0];
    const projection = patch[
      `fieldPlatform/mapProjections/${result.buildingId}`
    ] as Record<string, unknown>;

    expect(patch[`fieldPlatform/buildings/${result.buildingId}`]).toMatchObject({
      managementContract: {
        status: "active",
        startedOn: "2026-08-09",
        updatedBy: adminActor.uid,
      },
    });
    expect(projection).toMatchObject({
      buildingId: result.buildingId,
      vacancyCount: 1,
      captureStatus: "notStarted",
    });
    expect(Object.keys(projection)).toHaveLength(11);
    expect(JSON.stringify(projection)).not.toMatch(
      /TEST-OWNER-PHONE|TEST-SECURE-NOTE|3000000|350000|50000|현관 비밀번호|ownerNote|createdByName/,
    );
  });

  it("stores no contract and no projection when management was not requested", async () => {
    const input = validRegistrationInput();
    input.managementContract = {
      requested: false,
      startedOn: "not-semantic-when-not-requested",
    };
    const { dependencies, patches } = createInMemoryAdapter();

    const result = await saveFieldRegistrationCore(input, adminActor, dependencies);
    const patch = patches[0];

    expect(patch[`fieldPlatform/buildings/${result.buildingId}`]).toMatchObject({
      managementContract: {
        status: "none",
        updatedAt: NOW,
        updatedBy: adminActor.uid,
      },
    });
    expect(
      (patch[`fieldPlatform/buildings/${result.buildingId}`] as {
        managementContract: Record<string, unknown>;
      }).managementContract,
    ).not.toHaveProperty("startedOn");
    expect(patch[`fieldPlatform/mapProjections/${result.buildingId}`]).toBeNull();
  });

  it("returns the stored receipt for an identical retry without a second root update", async () => {
    const input = validRegistrationInput();
    const { dependencies } = createInMemoryAdapter();

    const first = await saveFieldRegistrationCore(input, staffActor, dependencies);
    const second = await saveFieldRegistrationCore(
      validRegistrationInput(),
      staffActor,
      dependencies,
    );

    expect(second).toEqual(first);
    expect(dependencies.getReceipt).toHaveBeenCalledTimes(2);
    expect(dependencies.reserveRegistration).toHaveBeenCalledTimes(1);
    expect(dependencies.updateRoot).toHaveBeenCalledTimes(1);
    expect(dependencies.now).toHaveBeenCalledTimes(1);
    expect(dependencies.getUserDisplayName).toHaveBeenCalledTimes(1);
    const committedPatch = vi.mocked(dependencies.updateRoot).mock.calls[0][0];
    expect(
      Object.keys(committedPatch).filter((path) =>
        path.startsWith(`fieldPlatform/ownerNotes/${first.buildingId}/`),
      ),
    ).toEqual([
      `fieldPlatform/ownerNotes/${first.buildingId}/note_12345678`,
    ]);
  });

  it("atomically rejects one of two simultaneous different inputs sharing a request ID", async () => {
    const changed = validRegistrationInput();
    changed.listing.monthlyRentWon += 1;
    const { dependencies, patches } = createInMemoryAdapter({
      beforeReceiptRead: createBarrier(2),
    });

    const settled = await Promise.allSettled([
      saveFieldRegistrationCore(
        validRegistrationInput(),
        staffActor,
        dependencies,
      ),
      saveFieldRegistrationCore(changed, staffActor, dependencies),
    ]);
    const fulfilled = settled.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof saveFieldRegistrationCore>>> =>
        result.status === "fulfilled",
    );
    const rejected = settled.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toEqual(
      expect.objectContaining({ message: "field_request_id_conflict" }),
    );
    expect(dependencies.getReceipt).toHaveBeenCalledTimes(2);
    expect(dependencies.reserveRegistration).toHaveBeenCalledTimes(2);
    expect(dependencies.updateRoot).toHaveBeenCalledTimes(1);
    expect(patches).toHaveLength(1);
  });

  it("uses one stored reservation for two simultaneous identical calls", async () => {
    let clockIndex = 0;
    const clock = [NOW, "2026-08-09T12:35:56.000Z"];
    const { dependencies, patches } = createInMemoryAdapter({
      beforeReceiptRead: createBarrier(2),
      now: () => clock[clockIndex++] ?? clock[clock.length - 1],
    });

    const [first, second] = await Promise.all([
      saveFieldRegistrationCore(
        validRegistrationInput(),
        staffActor,
        dependencies,
      ),
      saveFieldRegistrationCore(
        validRegistrationInput(),
        staffActor,
        dependencies,
      ),
    ]);

    expect(second).toEqual(first);
    expect(dependencies.reserveRegistration).toHaveBeenCalledTimes(2);
    expect(dependencies.updateRoot).toHaveBeenCalledTimes(2);
    expect(patches).toHaveLength(2);
    expect(patches[1]).toEqual(patches[0]);
    expect(Object.keys(patches[1]).sort()).toEqual(
      Object.keys(patches[0]).sort(),
    );
  });

  it("rejects a new request ID for an already reserved draft before overwriting entities", async () => {
    const { dependencies, patches } = createInMemoryAdapter();
    const first = await saveFieldRegistrationCore(
      validRegistrationInput(),
      staffActor,
      dependencies,
    );
    const reusedDraft = validRegistrationInput();
    reusedDraft.requestId = "request-2";

    await expect(
      saveFieldRegistrationCore(reusedDraft, staffActor, dependencies),
    ).rejects.toThrow("field_draft_id_conflict");

    expect(dependencies.updateRoot).toHaveBeenCalledTimes(1);
    expect(patches).toHaveLength(1);
    expect(patches[0][`fieldPlatform/buildings/${first.buildingId}`]).toMatchObject({
      createdAt: NOW,
    });
  });

  it("atomically rejects one of two simultaneous request IDs sharing a draft", async () => {
    const secondInput = validRegistrationInput();
    secondInput.requestId = "request-2";
    const { dependencies, patches } = createInMemoryAdapter({
      beforeReceiptRead: createBarrier(2),
    });

    const settled = await Promise.allSettled([
      saveFieldRegistrationCore(
        validRegistrationInput(),
        staffActor,
        dependencies,
      ),
      saveFieldRegistrationCore(secondInput, staffActor, dependencies),
    ]);

    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejection = settled.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejection?.reason).toEqual(
      expect.objectContaining({ message: "field_draft_id_conflict" }),
    );
    expect(dependencies.updateRoot).toHaveBeenCalledTimes(1);
    expect(patches).toHaveLength(1);
  });

  it("replays an acquired reservation with its original result and claimedAt while the receipt is stale", async () => {
    let clockIndex = 0;
    const clock = [NOW, "2026-08-09T13:34:56.000Z"];
    const { dependencies, patches } = createInMemoryAdapter({
      persistReceipts: false,
      now: () => clock[clockIndex++] ?? clock[clock.length - 1],
    });

    const first = await saveFieldRegistrationCore(
      validRegistrationInput(),
      staffActor,
      dependencies,
    );
    const second = await saveFieldRegistrationCore(
      validRegistrationInput(),
      staffActor,
      dependencies,
    );

    expect(second).toEqual(first);
    expect(dependencies.getReceipt).toHaveBeenCalledTimes(2);
    expect(dependencies.reserveRegistration).toHaveBeenCalledTimes(2);
    expect(dependencies.updateRoot).toHaveBeenCalledTimes(2);
    expect(patches[1]).toEqual(patches[0]);
    expect(patches[1][`fieldPlatform/buildings/${first.buildingId}`]).toMatchObject({
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(
      patches[1][
        `fieldPlatform/registrationRequests/${staffActor.uid}/request-1`
      ],
    ).toMatchObject({ completedAt: NOW });
  });

  it("normalizes non-semantic surrounding whitespace before hashing and persistence", async () => {
    const firstInput = validRegistrationInput();
    firstInput.building.name = "  상지 하우스  ";
    firstInput.units[0].unitLabel = "  101호 ";
    firstInput.listing.maintenanceFeeItems = [" 수도 ", " 공용전기  "];
    const { dependencies, patches } = createInMemoryAdapter();

    const first = await saveFieldRegistrationCore(
      firstInput,
      staffActor,
      dependencies,
    );
    const second = await saveFieldRegistrationCore(
      validRegistrationInput(),
      staffActor,
      dependencies,
    );

    expect(second).toEqual(first);
    expect(dependencies.updateRoot).toHaveBeenCalledTimes(1);
    expect(patches[0][`fieldPlatform/buildings/${first.buildingId}`]).toMatchObject({
      name: "상지 하우스",
    });
    expect(patches[0][`fieldPlatform/units/${first.unitIds["unit-1"]}`]).toMatchObject({
      unitLabel: "101호",
    });
  });

  it("canonicalizes set-valued options before hashing and persistence", async () => {
    const firstInput = validRegistrationInput();
    firstInput.units[0].options = ["washer", "aircon", "washer"];
    firstInput.listing.options = ["washer", "aircon", "washer"];
    const retryInput = validRegistrationInput();
    retryInput.units[0].options = ["aircon", "washer"];
    retryInput.listing.options = ["aircon", "washer"];
    const { dependencies, patches } = createInMemoryAdapter();

    const first = await saveFieldRegistrationCore(
      firstInput,
      staffActor,
      dependencies,
    );
    const second = await saveFieldRegistrationCore(
      retryInput,
      staffActor,
      dependencies,
    );

    expect(second).toEqual(first);
    expect(dependencies.updateRoot).toHaveBeenCalledTimes(1);
    expect(patches[0][`fieldPlatform/units/${first.unitIds["unit-1"]}`]).toMatchObject({
      options: ["aircon", "washer"],
    });
    expect(patches[0][`fieldPlatform/listings/${first.listingId}`]).toMatchObject({
      options: ["aircon", "washer"],
      maintenanceFeeItems: ["수도", "공용전기"],
    });
  });

  it("rejects reuse of a request ID for different normalized input", async () => {
    const { dependencies } = createInMemoryAdapter();
    await saveFieldRegistrationCore(
      validRegistrationInput(),
      staffActor,
      dependencies,
    );
    const changed = validRegistrationInput();
    changed.listing.monthlyRentWon += 1;

    await expect(
      saveFieldRegistrationCore(changed, staffActor, dependencies),
    ).rejects.toThrow("field_request_id_conflict");
    expect(dependencies.updateRoot).toHaveBeenCalledTimes(1);
  });

  it("rejects reuse of a request ID when a canonical owner note changes", async () => {
    const { dependencies } = createInMemoryAdapter();
    await saveFieldRegistrationCore(
      validRegistrationInput(),
      staffActor,
      dependencies,
    );
    const changed = validRegistrationInput();
    changed.ownerNoteDrafts![0].body = "현관 비밀번호 변경됨";

    await expect(
      saveFieldRegistrationCore(changed, staffActor, dependencies),
    ).rejects.toThrow("field_request_id_conflict");
    expect(dependencies.updateRoot).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["reviewer", { uid: "reviewer-1", role: "reviewer", enabled: true }],
    ["disabled staff", { uid: "staff-1", role: "staff", enabled: false }],
    ["disabled admin", { uid: "admin-1", role: "admin", enabled: false }],
  ] satisfies [string, FieldActor][])(
    "rejects a %s actor before reading or writing",
    async (_label, actor) => {
      const { dependencies } = createInMemoryAdapter();

      await expect(
        saveFieldRegistrationCore(validRegistrationInput(), actor, dependencies),
      ).rejects.toThrow("field_registration_forbidden");
      expect(dependencies.getReceipt).not.toHaveBeenCalled();
      expect(dependencies.updateRoot).not.toHaveBeenCalled();
    },
  );

  it("strips caller-forged note audit stamps and uses the reservation timestamp", async () => {
    const input = validRegistrationInput();
    Object.assign(input.ownerNoteDrafts![0], {
      createdAt: "2000-01-01T00:00:00.000Z",
      createdBy: "attacker",
      createdByName: "위조 이름",
      archivedAt: "2000-01-01T00:00:00.000Z",
      archivedBy: "attacker",
    });
    const { dependencies, patches } = createInMemoryAdapter();

    const result = await saveFieldRegistrationCore(input, staffActor, dependencies);

    expect(
      patches[0][`fieldPlatform/ownerNotes/${result.buildingId}/note_12345678`],
    ).toEqual({
      id: "note_12345678",
      buildingId: result.buildingId,
      body: "현관 비밀번호는 광고 담당자에게만 전달",
      recordedAt: "2026-08-09T01:30:00.000Z",
      createdAt: NOW,
      createdBy: staffActor.uid,
      createdByName: "서버 프로필 이름",
    });
  });

  it("does not resolve a profile or add a note path when initial notes are empty", async () => {
    const input = validRegistrationInput();
    input.ownerNoteDrafts = [];
    const { dependencies, patches } = createInMemoryAdapter();
    vi.mocked(dependencies.getUserDisplayName).mockRejectedValue(
      new Error("profile lookup must not run"),
    );

    const result = await saveFieldRegistrationCore(input, staffActor, dependencies);

    expect(dependencies.getUserDisplayName).not.toHaveBeenCalled();
    expect(
      Object.keys(patches[0]).filter((path) =>
        path.startsWith(`fieldPlatform/ownerNotes/${result.buildingId}/`),
      ),
    ).toEqual([]);
  });

  it.each([
    ["empty request ID", (input: SaveFieldRegistrationInput) => (input.requestId = "")],
    ["unsafe request ID", (input: SaveFieldRegistrationInput) => (input.requestId = "request/1")],
    ["unsafe draft ID", (input: SaveFieldRegistrationInput) => (input.draftId = "draft#1")],
    [
      "unsafe local unit ID",
      (input: SaveFieldRegistrationInput) => (input.units[0].localId = "unit.1"),
    ],
    [
      "a request ID over 128 UTF-8 bytes",
      (input: SaveFieldRegistrationInput) =>
        (input.requestId = "한".repeat(43)),
    ],
    [
      "a draft ID over 128 UTF-8 bytes",
      (input: SaveFieldRegistrationInput) =>
        (input.draftId = "한".repeat(43)),
    ],
    [
      "a local unit ID over 128 UTF-8 bytes",
      (input: SaveFieldRegistrationInput) => {
        const oversizedId = "한".repeat(43);
        input.units[0].localId = oversizedId;
        input.primaryUnitLocalId = oversizedId;
      },
    ],
  ])("rejects %s", async (_label, mutate) => {
    const input = validRegistrationInput();
    mutate(input);
    await expectInvalid(input);
  });

  it("rejects an actor UID over 128 UTF-8 bytes before reading or writing", async () => {
    const { dependencies } = createInMemoryAdapter();
    const actor: FieldActor = {
      ...staffActor,
      uid: "한".repeat(43),
    };

    await expect(
      saveFieldRegistrationCore(validRegistrationInput(), actor, dependencies),
    ).rejects.toThrow("field_invalid_registration");
    expect(dependencies.getReceipt).not.toHaveBeenCalled();
    expect(dependencies.reserveRegistration).not.toHaveBeenCalled();
    expect(dependencies.updateRoot).not.toHaveBeenCalled();
  });

  it.each([
    [
      "management number",
      (input: SaveFieldRegistrationInput) => (input.building.managementNumber = "  "),
    ],
    ["building name", (input: SaveFieldRegistrationInput) => (input.building.name = "")],
    [
      "road address",
      (input: SaveFieldRegistrationInput) => (input.building.roadAddress = " \t "),
    ],
    ["unit label", (input: SaveFieldRegistrationInput) => (input.units[0].unitLabel = "")],
    [
      "parking description",
      (input: SaveFieldRegistrationInput) =>
        (input.listing.parkingDescription = "   "),
    ],
    ["pet policy", (input: SaveFieldRegistrationInput) => (input.listing.petPolicy = "")],
  ])("rejects a blank required %s", async (_label, mutate) => {
    const input = validRegistrationInput();
    mutate(input);
    await expectInvalid(input);
  });

  it.each([
    ["NaN latitude", { latitude: Number.NaN }],
    ["latitude below range", { latitude: -90.000_001 }],
    ["latitude above range", { latitude: 90.000_001 }],
    ["infinite longitude", { longitude: Number.POSITIVE_INFINITY }],
    ["longitude below range", { longitude: -180.000_001 }],
    ["longitude above range", { longitude: 180.000_001 }],
  ])("rejects %s", async (_label, coordinates) => {
    const input = validRegistrationInput();
    Object.assign(input.building, coordinates);
    await expectInvalid(input);
  });

  it.each([
    [
      "a domain string over 4096 UTF-8 bytes",
      (input: SaveFieldRegistrationInput) => {
        input.building.name = "x".repeat(4_097);
      },
    ],
    [
      "more than 100 string-array items",
      (input: SaveFieldRegistrationInput) => {
        input.listing.options = Array.from(
          { length: 101 },
          (_, index) => `option-${index}`,
        );
      },
    ],
    [
      "a string-array item over 4096 UTF-8 bytes",
      (input: SaveFieldRegistrationInput) => {
        input.units[0].options = ["x".repeat(4_097)];
      },
    ],
    [
      "more than 200 units",
      (input: SaveFieldRegistrationInput) => {
        input.units = Array.from({ length: 201 }, (_, index) => ({
          ...input.units[0],
          localId: `unit-${index + 1}`,
          unitLabel: `${index + 1}호`,
        }));
      },
    ],
    [
      "a normalized aggregate payload over 256 KiB",
      (input: SaveFieldRegistrationInput) => {
        input.listing.options = Array.from(
          { length: 100 },
          (_, index) => `${index}-${"x".repeat(3_000)}`,
        );
      },
    ],
  ])("rejects %s before hashing or reserving", async (_label, mutate) => {
    const input = validRegistrationInput();
    mutate(input);
    await expectInvalid(input);
  });

  it.each([
    ["negative deposit", "depositWon", -1],
    ["fractional monthly rent", "monthlyRentWon", 1.5],
    [
      "unsafe maintenance fee",
      "maintenanceFeeWon",
      Number.MAX_SAFE_INTEGER + 1,
    ],
  ] as const)("rejects %s", async (_label, field, value) => {
    const input = validRegistrationInput();
    input.listing[field] = value;
    await expectInvalid(input);
  });

  it.each([
    [
      "an empty unit collection",
      (input: SaveFieldRegistrationInput) => {
        input.units = [];
      },
    ],
    [
      "duplicate unit local IDs",
      (input: SaveFieldRegistrationInput) => {
        input.units.push({ ...input.units[0] });
      },
    ],
    [
      "a missing primary unit",
      (input: SaveFieldRegistrationInput) => {
        input.primaryUnitLocalId = "unit-missing";
      },
    ],
    [
      "a missing requested contract start date",
      (input: SaveFieldRegistrationInput) => {
        delete input.managementContract.startedOn;
      },
    ],
    [
      "a malformed contract start date",
      (input: SaveFieldRegistrationInput) => {
        input.managementContract.startedOn = "09-08-2026";
      },
    ],
    [
      "an impossible contract start date",
      (input: SaveFieldRegistrationInput) => {
        input.managementContract.startedOn = "2026-02-30";
      },
    ],
    [
      "a non-array owner note boundary",
      (input: SaveFieldRegistrationInput) => {
        input.ownerNoteDrafts = {} as never;
      },
    ],
  ])("rejects %s", async (_label, mutate) => {
    const input = validRegistrationInput();
    mutate(input);
    await expectInvalid(input);
  });

  it("writes exactly one atomic root patch containing every entity, note, unit, audit, projection, and receipt path", async () => {
    const input = validRegistrationInput();
    input.units.push({
      localId: "unit-2",
      unitLabel: "102호",
      structure: "투룸",
      floor: 1,
      options: [],
      isVacant: false,
    });
    const { dependencies, patches } = createInMemoryAdapter();

    const result = await saveFieldRegistrationCore(input, staffActor, dependencies);
    const patch = patches[0];
    const paths = Object.keys(patch);
    const unitPaths = paths.filter((path) =>
      path.startsWith("fieldPlatform/units/"),
    );
    const auditPaths = paths.filter((path) =>
      path.startsWith("fieldPlatform/auditLogs/"),
    );

    expect(dependencies.updateRoot).toHaveBeenCalledTimes(1);
    expect(unitPaths.sort()).toEqual(
      Object.values(result.unitIds)
        .map((unitId) => `fieldPlatform/units/${unitId}`)
        .sort(),
    );
    expect(auditPaths).toHaveLength(2);
    expect(paths).toHaveLength(11);
    expect(new Set(paths)).toEqual(
      new Set([
        `fieldPlatform/buildings/${result.buildingId}`,
        ...unitPaths,
        `fieldPlatform/listings/${result.listingId}`,
        `fieldPlatform/visits/${result.visitId}`,
        `fieldPlatform/ownerNotes/${result.buildingId}/note_12345678`,
        `fieldPlatform/buildingAssignments/${result.buildingId}/${staffActor.uid}`,
        ...auditPaths,
        `fieldPlatform/mapProjections/${result.buildingId}`,
        `fieldPlatform/registrationRequests/${staffActor.uid}/${input.requestId}`,
      ]),
    );
    expect(patch[`fieldPlatform/units/${result.unitIds["unit-1"]}`]).toMatchObject({
      id: result.unitIds["unit-1"],
      buildingId: result.buildingId,
      currentListingId: result.listingId,
    });
    expect(patch[`fieldPlatform/units/${result.unitIds["unit-2"]}`]).toMatchObject({
      id: result.unitIds["unit-2"],
      buildingId: result.buildingId,
    });
    expect(patch[`fieldPlatform/listings/${result.listingId}`]).toMatchObject({
      id: result.listingId,
      buildingId: result.buildingId,
      unitId: result.unitIds[input.primaryUnitLocalId],
      unitLabel: "101호",
      status: "draft",
      advertisingApproved: false,
      createdAt: NOW,
      createdBy: staffActor.uid,
      updatedAt: NOW,
      updatedBy: staffActor.uid,
    });
    expect(patch[`fieldPlatform/visits/${result.visitId}`]).toMatchObject({
      id: result.visitId,
      buildingId: result.buildingId,
      unitId: result.unitIds[input.primaryUnitLocalId],
      listingId: result.listingId,
      type: "initial",
      assignedUserId: staffActor.uid,
      checklistTemplateId: expect.any(String),
      checklistTemplateVersion: 1,
      createdAt: NOW,
      createdBy: staffActor.uid,
      updatedAt: NOW,
      updatedBy: staffActor.uid,
    });
    expect(
      patch[
        `fieldPlatform/buildingAssignments/${result.buildingId}/${staffActor.uid}`
      ],
    ).toBe(true);

    for (const auditPath of auditPaths) {
      expect(patch[auditPath]).toMatchObject({
        id: auditPath.slice("fieldPlatform/auditLogs/".length),
        actorId: staffActor.uid,
        entityId: result.buildingId,
        occurredAt: NOW,
        requestId: input.requestId,
      });
    }

    expect(
      patch[
        `fieldPlatform/registrationRequests/${staffActor.uid}/${input.requestId}`
      ],
    ).toEqual({
      requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      result,
      completedAt: NOW,
    });
  });
});
