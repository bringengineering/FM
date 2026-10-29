import { describe, expect, it } from "vitest";

import {
  reduceAuthoritativeProjectionRebuild,
  reduceRegistrationClaim,
  reduceTransitionClaim,
  reduceTransitionCommit,
} from "../src/field/firebase-transaction-state.js";
import type { FieldMapProjection } from "../src/field/contracts.js";
import type { RegistrationReservation } from "../src/field/save-field-registration.js";
import {
  managementContractFingerprint,
  type ContractTransitionCommitInput,
  type ContractTransitionReservation,
  type ContractTransitionSnapshot,
} from "../src/field/set-management-contract-status.js";

const REQUEST_HASH = "1".repeat(64);
const NEXT_HASH = "2".repeat(64);
const NOW = "2026-08-09T12:00:00.000Z";

function registrationReservation(
  overrides: Partial<RegistrationReservation> = {},
): RegistrationReservation {
  return {
    uid: "staff-1",
    requestId: "request-1",
    draftId: "draft-1",
    requestHash: REQUEST_HASH,
    result: {
      buildingId: "building-1",
      unitIds: { "unit-local-1": "unit-1" },
      listingId: "listing-1",
      visitId: "visit-1",
    },
    claimedAt: NOW,
    ...overrides,
  };
}

const previousContract: ContractTransitionSnapshot = {
  status: "pending",
  startedOn: "2026-08-01",
  updatedAt: "2026-08-01T09:00:00.000Z",
  updatedBy: "staff-1",
};

const nextContract: ContractTransitionSnapshot = {
  status: "active",
  startedOn: "2026-08-09",
  updatedAt: NOW,
  updatedBy: "admin-1",
};

function transitionReservation(
  overrides: Partial<ContractTransitionReservation> = {},
): ContractTransitionReservation {
  return {
    uid: "admin-1",
    requestId: "request-1",
    buildingId: "building-1",
    requestHash: REQUEST_HASH,
    previousContractStatus: previousContract.status,
    previousContractUpdatedAt: previousContract.updatedAt,
    previousContractFingerprint: managementContractFingerprint(previousContract),
    previousContract,
    nextContractFingerprint: managementContractFingerprint(nextContract),
    nextContract,
    result: { buildingId: "building-1", status: "active" },
    claimedAt: NOW,
    ...overrides,
  };
}

function transitionCommitInput(
  overrides: Partial<ContractTransitionCommitInput> = {},
): ContractTransitionCommitInput {
  const receipt = {
    requestHash: REQUEST_HASH,
    result: { buildingId: "building-1", status: "active" as const },
    completedAt: NOW,
  };
  return {
    uid: "admin-1",
    requestId: "request-1",
    requestHash: REQUEST_HASH,
    buildingId: "building-1",
    expectedPreviousContractFingerprint:
      managementContractFingerprint(previousContract),
    expectedNextContractFingerprint: managementContractFingerprint(nextContract),
    nextContract,
    result: receipt.result,
    patch: {
      "fieldPlatform/buildings/building-1/managementContract": nextContract,
      "fieldPlatform/buildings/building-1/updatedAt": NOW,
      "fieldPlatform/buildings/building-1/updatedBy": "admin-1",
      "fieldPlatform/auditLogs/audit-1": {
        id: "audit-1",
        privateSafeSummary: "status only",
      },
      "fieldPlatform/mapProjections/building-1": null,
      "fieldPlatform/managementContractRequests/admin-1/request-1": receipt,
    },
    ...overrides,
  };
}

describe("registration claim reducer", () => {
  it("stores the canonical initial owner-note name in the winning reservation", () => {
    const proposed = {
      ...registrationReservation(),
      ownerNoteCreatedByName: "Original profile name",
    } as RegistrationReservation;

    const decision = reduceRegistrationClaim(null, proposed);

    expect(decision).toMatchObject({
      status: "acquired",
      write: true,
      reservation: { ownerNoteCreatedByName: "Original profile name" },
    });
    expect(decision.state).toMatchObject({
      requests: {
        "request-1": { ownerNoteCreatedByName: "Original profile name" },
      },
    });
  });

  it("accepts a persisted initial owner-note name at exactly 256 UTF-8 bytes", () => {
    const exactBoundaryName = "a".repeat(256);
    const proposed = {
      ...registrationReservation(),
      ownerNoteCreatedByName: exactBoundaryName,
    } as RegistrationReservation;

    expect(reduceRegistrationClaim(null, proposed)).toMatchObject({
      status: "acquired",
      reservation: { ownerNoteCreatedByName: exactBoundaryName },
    });
  });

  it("atomically upgrades a compatible legacy reservation with the proposed note name", () => {
    const legacy = reduceRegistrationClaim(
      null,
      registrationReservation(),
    ).state;
    const proposed = {
      ...registrationReservation({ claimedAt: "2026-08-09T13:00:00.000Z" }),
      ownerNoteCreatedByName: "Migration profile name",
    } as RegistrationReservation;

    const decision = reduceRegistrationClaim(legacy, proposed);

    expect(decision).toMatchObject({
      status: "acquired",
      write: true,
      reservation: {
        claimedAt: NOW,
        ownerNoteCreatedByName: "Migration profile name",
      },
    });
    expect(decision.state).toMatchObject({
      requests: {
        "request-1": { ownerNoteCreatedByName: "Migration profile name" },
      },
    });
  });

  it.each([
    ["blank", "   "],
    ["oversized", "x".repeat(257)],
    ["C0 control", "Bad\u0000name"],
    ["DEL control", "Bad\u007fname"],
  ])("fails closed for a %s persisted initial owner-note name", (_label, name) => {
    const malformed = {
      requests: {
        "request-1": {
          ...registrationReservation(),
          ownerNoteCreatedByName: name,
        },
      },
      drafts: {
        "draft-1": { requestId: "request-1", requestHash: REQUEST_HASH },
      },
    };

    expect(() =>
      reduceRegistrationClaim(malformed, registrationReservation()),
    ).toThrow("field_registration_claim_state_invalid");
  });

  it("atomically stores the full request reservation and the draft identity", () => {
    const proposed = registrationReservation();

    const decision = reduceRegistrationClaim(null, proposed);

    expect(decision).toMatchObject({
      status: "acquired",
      write: true,
      reservation: proposed,
    });
    expect(decision.state).toEqual({
      requests: { "request-1": proposed },
      drafts: {
        "draft-1": { requestId: "request-1", requestHash: REQUEST_HASH },
      },
    });
  });

  it("returns the stored original reservation for an identical retry", () => {
    const original = registrationReservation();
    const stored = reduceRegistrationClaim(null, original).state;
    const regenerated = registrationReservation({
      claimedAt: "2026-08-09T13:00:00.000Z",
      result: {
        buildingId: "building-regenerated",
        unitIds: {},
        listingId: "listing-regenerated",
        visitId: "visit-regenerated",
      },
    });

    const decision = reduceRegistrationClaim(stored, regenerated);

    expect(decision).toEqual({
      status: "acquired",
      write: false,
      state: stored,
      reservation: original,
    });
  });

  it("distinguishes request-hash conflicts from draft conflicts", () => {
    const stored = reduceRegistrationClaim(
      null,
      registrationReservation(),
    ).state;

    expect(
      reduceRegistrationClaim(
        stored,
        registrationReservation({ requestHash: "f".repeat(64) }),
      ),
    ).toMatchObject({ status: "requestConflict", write: false });
    expect(
      reduceRegistrationClaim(
        stored,
        registrationReservation({ requestId: "request-2" }),
      ),
    ).toMatchObject({ status: "draftConflict", write: false });
  });

  it.each([
    ["claim root", []],
    ["requests container", { requests: [] }],
    ["drafts container", { drafts: "malformed" }],
  ])("fails closed for a malformed non-null %s", (_label, current) => {
    expect(() =>
      reduceRegistrationClaim(current, registrationReservation()),
    ).toThrow("field_registration_claim_state_invalid");
  });
});

describe("contract transition claim reducer", () => {
  it("returns the original reservation for a matching actor request retry", () => {
    const original = transitionReservation();
    const stored = reduceTransitionClaim(null, original).state;

    const decision = reduceTransitionClaim(
      stored,
      transitionReservation({ claimedAt: "2026-08-09T13:00:00.000Z" }),
    );

    expect(decision).toEqual({
      status: "acquired",
      write: false,
      state: stored,
      reservation: original,
    });
  });

  it("rejects a different hash for an existing actor request", () => {
    const stored = reduceTransitionClaim(
      null,
      transitionReservation(),
    ).state;

    expect(
      reduceTransitionClaim(
        stored,
        transitionReservation({ requestHash: "f".repeat(64) }),
      ),
    ).toMatchObject({ status: "requestConflict", write: false });
  });

  it("fences different actors from the same building fingerprint", () => {
    const stored = reduceTransitionClaim(
      null,
      transitionReservation(),
    ).state;

    expect(
      reduceTransitionClaim(
        stored,
        transitionReservation({
          uid: "admin-2",
          requestId: "request-2",
          requestHash: "3".repeat(64),
        }),
      ),
    ).toMatchObject({ status: "buildingConflict", write: false });
  });

  it("allows a later contract fingerprint to acquire its own fence", () => {
    const first = transitionReservation();
    const firstDecision = reduceTransitionClaim(null, first);
    const laterPrevious = nextContract;
    const laterNext: ContractTransitionSnapshot = {
      ...nextContract,
      status: "paused",
      updatedAt: "2026-08-10T10:00:00.000Z",
    };
    const later = transitionReservation({
      uid: "admin-2",
      requestId: "request-2",
      requestHash: "3".repeat(64),
      previousContractStatus: laterPrevious.status,
      previousContractUpdatedAt: laterPrevious.updatedAt,
      previousContractFingerprint: managementContractFingerprint(laterPrevious),
      previousContract: laterPrevious,
      nextContractFingerprint: managementContractFingerprint(laterNext),
      nextContract: laterNext,
      result: { buildingId: "building-1", status: "paused" },
      claimedAt: laterNext.updatedAt,
    });

    const laterDecision = reduceTransitionClaim(firstDecision.state, later);

    expect(laterDecision).toMatchObject({
      status: "acquired",
      write: true,
      reservation: later,
    });
    expect(laterDecision.state).toMatchObject({
      requests: {
        "admin-1": { "request-1": first },
        "admin-2": { "request-2": later },
      },
      buildingVersions: {
        "building-1": {
          [first.previousContractFingerprint]: {
            uid: "admin-1",
            requestId: "request-1",
            requestHash: REQUEST_HASH,
          },
          [later.previousContractFingerprint]: {
            uid: "admin-2",
            requestId: "request-2",
            requestHash: "3".repeat(64),
          },
        },
      },
    });
  });

  it.each([
    ["claim root", []],
    ["requests container", { requests: [] }],
    ["actor request bucket", { requests: { "admin-1": [] } }],
    ["buildingVersions container", { buildingVersions: "malformed" }],
    [
      "building version bucket",
      { buildingVersions: { "building-1": [] } },
    ],
  ])("fails closed for a malformed non-null %s", (_label, current) => {
    expect(() =>
      reduceTransitionClaim(current, transitionReservation()),
    ).toThrow("field_management_transition_state_invalid");
  });

  it("fails closed for malformed building version claims even on a matching request retry", () => {
    const proposed = transitionReservation();
    const acquired = reduceTransitionClaim(null, proposed);
    const malformed = {
      ...(acquired.state as Record<string, unknown>),
      buildingVersions: [],
    };

    expect(() => reduceTransitionClaim(malformed, proposed)).toThrow(
      "field_management_transition_state_invalid",
    );
  });
});

const publicProjection: FieldMapProjection = {
  buildingId: "building-1",
  name: "New projection",
  roadAddress: "1 Sangji-ro, Wonju",
  latitude: 37.369,
  longitude: 127.928,
  markerStatus: "managed",
  vacancyCount: 0,
  approvedRentSummary: "none",
  parkingSummary: "available",
  captureStatus: "notStarted",
  updatedAt: "2026-08-09T12:00:02.000Z",
};

const authoritativeActiveBuilding = {
  id: "building-1",
  name: "Authoritative building",
  roadAddress: "1 Current-ro, Wonju",
  latitude: 37.369,
  longitude: 127.928,
  parking: { available: true, totalSpaces: 3 },
  managementContract: {
    status: "active" as const,
    startedOn: "2026-08-01",
    updatedAt: "2026-08-09T12:00:02.000Z",
    updatedBy: "admin-1",
  },
  privateOwnerPhone: "DO-NOT-PROJECT",
};

function authoritativeProjectionRoot() {
  return {
    buildings: { "building-1": authoritativeActiveBuilding },
    listings: {
      "listing-current": {
        id: "listing-current",
        buildingId: "building-1",
        status: "advertising",
        advertisingApproved: true,
        depositWon: 3_000_000,
        monthlyRentWon: 350_000,
        maintenanceFeeWon: 0,
      },
      "listing-foreign": {
        id: "listing-foreign",
        buildingId: "building-foreign",
        status: "advertising",
      },
    },
    media: {
      "media-current": {
        buildingId: "building-1",
        uploadState: "finalized",
      },
    },
    mapProjections: {
      "building-1": { ...publicProjection, name: "Obsolete candidate" },
    },
    mapProjectionVersions: {
      "building-1": {
        eventTime: "2026-08-09T12:00:01.000Z",
        revision: "legacy-event",
      },
    },
    unrelated: { retained: true },
  };
}

describe("authoritative map projection transaction reducer", () => {
  it("rebuilds the eleven-key projection only from transaction-current state", () => {
    const decision = reduceAuthoritativeProjectionRebuild(
      authoritativeProjectionRoot(),
      {
        buildingId: "building-1",
        updatedAt: "2026-08-09T12:00:03.000Z",
      },
    );

    expect(decision).toMatchObject({ status: "committed", write: true });
    const state = decision.state as Record<string, unknown>;
    const projection = (state.mapProjections as Record<string, unknown>)[
      "building-1"
    ] as Record<string, unknown>;
    expect(projection).toMatchObject({
      buildingId: "building-1",
      name: "Authoritative building",
      vacancyCount: 1,
      captureStatus: "inProgress",
    });
    expect(Object.keys(projection)).toHaveLength(11);
    expect(JSON.stringify(projection)).not.toContain("DO-NOT-PROJECT");
    expect(state).not.toHaveProperty("mapProjectionVersions");
  });

  it("does not restore an obsolete projection after a callable pauses the contract", () => {
    const obsoletePreReadCandidate = {
      ...publicProjection,
      name: "Obsolete active projection",
    };
    const currentAfterCallable = authoritativeProjectionRoot();
    currentAfterCallable.buildings["building-1"] = {
      ...authoritativeActiveBuilding,
      managementContract: {
        ...authoritativeActiveBuilding.managementContract,
        status: "paused",
        updatedAt: "2026-08-09T12:00:04.000Z",
      },
    };
    delete currentAfterCallable.mapProjections["building-1"];

    const delayedTrigger = reduceAuthoritativeProjectionRebuild(
      currentAfterCallable,
      {
        buildingId: "building-1",
        updatedAt: "2026-08-09T12:00:01.000Z",
      },
    );

    expect(delayedTrigger).toMatchObject({ status: "committed", write: true });
    expect(delayedTrigger.state).not.toHaveProperty(
      "mapProjections.building-1",
    );
    expect(JSON.stringify(delayedTrigger.state)).not.toContain(
      obsoletePreReadCandidate.name,
    );
  });

  it("is independent of reversed CloudEvent IDs at the same timestamp", () => {
    let current: unknown = authoritativeProjectionRoot();
    for (const _reversedEventId of ["zzzz-event", "aaaa-event"]) {
      current = reduceAuthoritativeProjectionRebuild(current, {
        buildingId: "building-1",
        updatedAt: "2026-08-09T12:00:05.123456Z",
      }).state;
    }

    expect(current).toMatchObject({
      mapProjections: {
        "building-1": {
          name: "Authoritative building",
          vacancyCount: 1,
          updatedAt: "2026-08-09T12:00:05.123456Z",
        },
      },
    });
    expect(current).not.toHaveProperty("mapProjectionVersions");
  });

  it("keeps the newer projection timestamp while rebuilding current content for a delayed older event", () => {
    const initial = authoritativeProjectionRoot();
    initial.mapProjections["building-1"].updatedAt =
      "2026-08-09T12:00:00.000Z";
    const afterE2 = reduceAuthoritativeProjectionRebuild(initial, {
      buildingId: "building-1",
      updatedAt: "2026-08-09T12:00:02.000Z",
    }).state as ReturnType<typeof authoritativeProjectionRoot>;
    afterE2.buildings["building-1"] = {
      ...authoritativeActiveBuilding,
      name: "Current content when delayed E1 commits",
    };

    const afterDelayedE1 = reduceAuthoritativeProjectionRebuild(afterE2, {
      buildingId: "building-1",
      updatedAt: "2026-08-09T12:00:01.000Z",
    }).state;

    expect(afterDelayedE1).toMatchObject({
      mapProjections: {
        "building-1": {
          name: "Current content when delayed E1 commits",
          updatedAt: "2026-08-09T12:00:02.000Z",
        },
      },
    });
  });

  it("preserves the existing timestamp string when parsed milliseconds are equal", () => {
    const current = authoritativeProjectionRoot();
    current.mapProjections["building-1"].updatedAt =
      "2026-08-09T12:00:02.123456Z";

    const decision = reduceAuthoritativeProjectionRebuild(current, {
      buildingId: "building-1",
      updatedAt: "2026-08-09T12:00:02.123999Z",
    });

    expect(decision.state).toHaveProperty(
      "mapProjections.building-1.updatedAt",
      "2026-08-09T12:00:02.123456Z",
    );
  });

  it("uses the requested timestamp when the existing projection timestamp is malformed", () => {
    const current = authoritativeProjectionRoot();
    current.mapProjections["building-1"].updatedAt = "not-a-timestamp";

    const decision = reduceAuthoritativeProjectionRebuild(current, {
      buildingId: "building-1",
      updatedAt: "2026-08-09T12:00:03.000Z",
    });

    expect(decision.state).toHaveProperty(
      "mapProjections.building-1.updatedAt",
      "2026-08-09T12:00:03.000Z",
    );
  });
});

describe("contract transition CAS reducer", () => {
  it("applies every granular fieldPlatform patch path and deletes null children", () => {
    const current = {
      buildings: {
        "building-1": {
          managementContract: previousContract,
          updatedAt: previousContract.updatedAt,
          updatedBy: previousContract.updatedBy,
          privateHistory: { retained: true },
        },
      },
      mapProjections: { "building-1": { stale: true } },
      unrelated: { retained: true },
    };

    const decision = reduceTransitionCommit(current, transitionCommitInput());

    expect(decision.status).toBe("committed");
    expect(decision.write).toBe(true);
    expect(decision.state).toEqual({
      buildings: {
        "building-1": {
          managementContract: nextContract,
          updatedAt: NOW,
          updatedBy: "admin-1",
          privateHistory: { retained: true },
        },
      },
      auditLogs: {
        "audit-1": { id: "audit-1", privateSafeSummary: "status only" },
      },
      managementContractRequests: {
        "admin-1": {
          "request-1": {
            requestHash: REQUEST_HASH,
            result: { buildingId: "building-1", status: "active" },
            completedAt: NOW,
          },
        },
      },
      unrelated: { retained: true },
    });
    expect(decision.state).not.toHaveProperty("fieldPlatform");
    expect(current.mapProjections).toHaveProperty("building-1");
  });

  it("returns alreadyCommitted from the receipt before checking newer building state", () => {
    const input = transitionCommitInput();
    const receipt = input.patch[
      "fieldPlatform/managementContractRequests/admin-1/request-1"
    ];
    const newerContract: ContractTransitionSnapshot = {
      ...nextContract,
      status: "paused",
      updatedAt: "2026-08-10T10:00:00.000Z",
    };
    const current = {
      buildings: {
        "building-1": { managementContract: newerContract },
      },
      managementContractRequests: {
        "admin-1": { "request-1": receipt },
      },
    };

    expect(reduceTransitionCommit(current, input)).toEqual({
      status: "alreadyCommitted",
      write: false,
      state: current,
    });
  });

  it("rejects an authoritative receipt with a conflicting request hash", () => {
    const input = transitionCommitInput();
    const current = {
      buildings: {
        "building-1": { managementContract: previousContract },
      },
      managementContractRequests: {
        "admin-1": {
          "request-1": {
            requestHash: "f".repeat(64),
            result: input.result,
            completedAt: NOW,
          },
        },
      },
    };

    expect(() => reduceTransitionCommit(current, input)).toThrow(
      "field_request_id_conflict",
    );
  });

  it("returns staleConflict without mutating state when the fingerprint changed", () => {
    const current = {
      buildings: {
        "building-1": {
          managementContract: {
            ...previousContract,
            updatedAt: "2026-08-02T09:00:00.000Z",
          },
        },
      },
      mapProjections: { "building-1": { retained: true } },
    };

    expect(reduceTransitionCommit(current, transitionCommitInput())).toEqual({
      status: "staleConflict",
      write: false,
      state: current,
    });
  });
});
