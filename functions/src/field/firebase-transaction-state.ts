import {
  buildMapProjection,
  type ProjectionBuilding,
  type ProjectionListing,
  type ProjectionMedia,
} from "./map-projection.js";
import type {
  RegistrationReservation,
  RegistrationReservationOutcome,
} from "./save-field-registration.js";
import {
  managementContractFingerprint,
  type ContractTransitionCommitInput,
  type ContractTransitionCommitOutcome,
  type ContractTransitionReservation,
  type ContractTransitionReservationOutcome,
} from "./set-management-contract-status.js";

type UnknownRecord = Record<string, unknown>;

interface DraftClaimIdentity {
  requestId: string;
  requestHash: string;
}

interface BuildingVersionClaimIdentity {
  uid: string;
  requestId: string;
  requestHash: string;
}

type RegistrationClaimDecision = RegistrationReservationOutcome & {
  write: boolean;
  state: unknown;
};

type TransitionClaimDecision = ContractTransitionReservationOutcome & {
  write: boolean;
  state: unknown;
};

type TransitionCommitDecision = ContractTransitionCommitOutcome & {
  write: boolean;
  state: unknown;
};

export interface AuthoritativeProjectionRebuildInput {
  buildingId: string;
  updatedAt: string;
}

export interface AuthoritativeProjectionRebuildDecision {
  status: "committed";
  write: true;
  state: unknown;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordOrEmpty(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function claimRecordOrEmpty(
  value: unknown,
  invalid: () => never,
): UnknownRecord {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return invalid();
  return value;
}

function invalidRegistrationClaim(): never {
  throw new Error("field_registration_claim_state_invalid");
}

function invalidTransitionState(): never {
  throw new Error("field_management_transition_state_invalid");
}

function cloneRegistrationReservation(
  value: unknown,
): RegistrationReservation {
  if (
    !isRecord(value) ||
    typeof value.uid !== "string" ||
    typeof value.requestId !== "string" ||
    typeof value.draftId !== "string" ||
    typeof value.requestHash !== "string" ||
    typeof value.claimedAt !== "string" ||
    !isRecord(value.result) ||
    typeof value.result.buildingId !== "string" ||
    !isRecord(value.result.unitIds) ||
    typeof value.result.listingId !== "string" ||
    typeof value.result.visitId !== "string"
  ) {
    return invalidRegistrationClaim();
  }

  const unitIds: Record<string, string> = {};
  for (const [localId, unitId] of Object.entries(value.result.unitIds)) {
    if (typeof unitId !== "string") invalidRegistrationClaim();
    unitIds[localId] = unitId;
  }

  return {
    uid: value.uid,
    requestId: value.requestId,
    draftId: value.draftId,
    requestHash: value.requestHash,
    result: {
      buildingId: value.result.buildingId,
      unitIds,
      listingId: value.result.listingId,
      visitId: value.result.visitId,
    },
    claimedAt: value.claimedAt,
  };
}

function draftClaimIdentity(value: unknown): DraftClaimIdentity {
  if (
    !isRecord(value) ||
    typeof value.requestId !== "string" ||
    typeof value.requestHash !== "string"
  ) {
    return invalidRegistrationClaim();
  }
  return { requestId: value.requestId, requestHash: value.requestHash };
}

export function reduceRegistrationClaim(
  current: unknown,
  proposed: RegistrationReservation,
): RegistrationClaimDecision {
  const state = claimRecordOrEmpty(current, invalidRegistrationClaim);
  const requests = claimRecordOrEmpty(
    state.requests,
    invalidRegistrationClaim,
  );
  const drafts = claimRecordOrEmpty(state.drafts, invalidRegistrationClaim);
  const storedRequest = requests[proposed.requestId];

  if (storedRequest !== undefined && storedRequest !== null) {
    const reservation = cloneRegistrationReservation(storedRequest);
    if (
      reservation.uid !== proposed.uid ||
      reservation.requestId !== proposed.requestId ||
      reservation.draftId !== proposed.draftId ||
      reservation.requestHash !== proposed.requestHash
    ) {
      return { status: "requestConflict", write: false, state: current };
    }

    const identity = draftClaimIdentity(drafts[reservation.draftId]);
    if (
      identity.requestId !== reservation.requestId ||
      identity.requestHash !== reservation.requestHash
    ) {
      return invalidRegistrationClaim();
    }
    return {
      status: "acquired",
      reservation,
      write: false,
      state: current,
    };
  }

  const storedDraft = drafts[proposed.draftId];
  if (storedDraft !== undefined && storedDraft !== null) {
    const identity = draftClaimIdentity(storedDraft);
    if (
      identity.requestId !== proposed.requestId ||
      identity.requestHash !== proposed.requestHash
    ) {
      return { status: "draftConflict", write: false, state: current };
    }
    return invalidRegistrationClaim();
  }

  const reservation = cloneRegistrationReservation(proposed);
  const nextState = {
    ...state,
    requests: { ...requests, [proposed.requestId]: reservation },
    drafts: {
      ...drafts,
      [proposed.draftId]: {
        requestId: proposed.requestId,
        requestHash: proposed.requestHash,
      },
    },
  };
  return {
    status: "acquired",
    reservation,
    write: true,
    state: nextState,
  };
}

function cloneTransitionReservation(
  value: unknown,
): ContractTransitionReservation {
  if (!isRecord(value)) invalidTransitionState();
  return {
    ...(value as unknown as ContractTransitionReservation),
    previousContract: {
      ...(value.previousContract as ContractTransitionReservation["previousContract"]),
    },
    nextContract: {
      ...(value.nextContract as ContractTransitionReservation["nextContract"]),
    },
    result: {
      ...(value.result as ContractTransitionReservation["result"]),
    },
  };
}

function buildingVersionClaimIdentity(
  value: unknown,
): BuildingVersionClaimIdentity {
  if (
    !isRecord(value) ||
    typeof value.uid !== "string" ||
    typeof value.requestId !== "string" ||
    typeof value.requestHash !== "string"
  ) {
    return invalidTransitionState();
  }
  return {
    uid: value.uid,
    requestId: value.requestId,
    requestHash: value.requestHash,
  };
}

export function reduceTransitionClaim(
  current: unknown,
  proposed: ContractTransitionReservation,
): TransitionClaimDecision {
  const state = claimRecordOrEmpty(current, invalidTransitionState);
  const requests = claimRecordOrEmpty(state.requests, invalidTransitionState);
  const actorRequests = claimRecordOrEmpty(
    requests[proposed.uid],
    invalidTransitionState,
  );
  const buildingVersions = claimRecordOrEmpty(
    state.buildingVersions,
    invalidTransitionState,
  );
  const versionClaims = claimRecordOrEmpty(
    buildingVersions[proposed.buildingId],
    invalidTransitionState,
  );
  const storedRequest = actorRequests[proposed.requestId];

  if (storedRequest !== undefined && storedRequest !== null) {
    const reservation = cloneTransitionReservation(storedRequest);
    if (
      reservation.uid !== proposed.uid ||
      reservation.requestId !== proposed.requestId ||
      reservation.requestHash !== proposed.requestHash ||
      reservation.buildingId !== proposed.buildingId
    ) {
      return { status: "requestConflict", write: false, state: current };
    }
    return {
      status: "acquired",
      reservation,
      write: false,
      state: current,
    };
  }

  const storedVersion = versionClaims[proposed.previousContractFingerprint];
  if (storedVersion !== undefined && storedVersion !== null) {
    buildingVersionClaimIdentity(storedVersion);
    return { status: "buildingConflict", write: false, state: current };
  }

  const reservation = cloneTransitionReservation(proposed);
  const nextState = {
    ...state,
    requests: {
      ...requests,
      [proposed.uid]: {
        ...actorRequests,
        [proposed.requestId]: reservation,
      },
    },
    buildingVersions: {
      ...buildingVersions,
      [proposed.buildingId]: {
        ...versionClaims,
        [proposed.previousContractFingerprint]: {
          uid: proposed.uid,
          requestId: proposed.requestId,
          requestHash: proposed.requestHash,
        },
      },
    },
  };
  return {
    status: "acquired",
    reservation,
    write: true,
    state: nextState,
  };
}

function invalidProjectionState(): never {
  throw new Error("field_projection_state_invalid");
}

function projectionRecordOrEmpty(value: unknown): UnknownRecord {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return invalidProjectionState();
  return value;
}

function monotonicProjectionUpdatedAt(
  existingProjection: unknown,
  requestedUpdatedAt: string,
): string {
  const requestedMilliseconds = Date.parse(requestedUpdatedAt);
  if (!Number.isFinite(requestedMilliseconds)) return invalidProjectionState();
  if (!isRecord(existingProjection)) return requestedUpdatedAt;

  const existingUpdatedAt = existingProjection.updatedAt;
  if (typeof existingUpdatedAt !== "string") return requestedUpdatedAt;
  const existingMilliseconds = Date.parse(existingUpdatedAt);
  if (!Number.isFinite(existingMilliseconds)) return requestedUpdatedAt;

  return existingMilliseconds >= requestedMilliseconds
    ? existingUpdatedAt
    : requestedUpdatedAt;
}

export function reduceAuthoritativeProjectionRebuild(
  current: unknown,
  input: AuthoritativeProjectionRebuildInput,
): AuthoritativeProjectionRebuildDecision {
  if (typeof input.updatedAt !== "string" || input.updatedAt.length === 0) {
    return invalidProjectionState();
  }

  const state = projectionRecordOrEmpty(current);
  const buildings = projectionRecordOrEmpty(state.buildings);
  const listings = projectionRecordOrEmpty(state.listings);
  const media = projectionRecordOrEmpty(state.media);
  const projections = projectionRecordOrEmpty(state.mapProjections);
  const updatedAt = monotonicProjectionUpdatedAt(
    projections[input.buildingId],
    input.updatedAt,
  );
  const storedBuilding = buildings[input.buildingId];
  const building =
    isRecord(storedBuilding) && storedBuilding.id === input.buildingId
      ? (storedBuilding as unknown as ProjectionBuilding)
      : null;
  const projection = buildMapProjection({
    building,
    listings: Object.values(listings) as ProjectionListing[],
    media: Object.values(media) as ProjectionMedia[],
    updatedAt,
  });

  const nextProjections = { ...projections };
  if (projection === null) {
    delete nextProjections[input.buildingId];
  } else {
    nextProjections[input.buildingId] = projection;
  }

  const nextState: UnknownRecord = { ...state };
  delete nextState.mapProjectionVersions;
  if (Object.keys(nextProjections).length === 0) {
    delete nextState.mapProjections;
  } else {
    nextState.mapProjections = nextProjections;
  }

  return { status: "committed", write: true, state: nextState };
}

function getPath(root: unknown, segments: string[]): unknown {
  let current = root;
  for (const segment of segments) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function setPath(
  current: UnknownRecord,
  segments: string[],
  value: unknown,
): UnknownRecord {
  const [segment, ...remaining] = segments;
  if (segment === undefined) invalidTransitionState();

  const next = { ...current };
  if (remaining.length === 0) {
    if (value === null) {
      delete next[segment];
    } else {
      next[segment] = value;
    }
    return next;
  }

  const child = setPath(recordOrEmpty(current[segment]), remaining, value);
  if (Object.keys(child).length === 0) {
    delete next[segment];
  } else {
    next[segment] = child;
  }
  return next;
}

function relativePatchSegments(path: string): string[] {
  const prefix = "fieldPlatform/";
  if (!path.startsWith(prefix)) invalidTransitionState();
  const segments = path.slice(prefix.length).split("/");
  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        segment.length === 0 || /[\u0000-\u001f\u007f.#$\[\]]/u.test(segment),
    )
  ) {
    return invalidTransitionState();
  }
  return segments;
}

function matchingReceipt(
  state: unknown,
  input: ContractTransitionCommitInput,
): boolean {
  const value = getPath(state, [
    "managementContractRequests",
    input.uid,
    input.requestId,
  ]);
  if (value === undefined || value === null) return false;
  if (!isRecord(value) || value.requestHash !== input.requestHash) {
    throw new Error("field_request_id_conflict");
  }
  if (
    !isRecord(value.result) ||
    value.result.buildingId !== input.result.buildingId ||
    value.result.status !== input.result.status
  ) {
    return invalidTransitionState();
  }
  return true;
}

export function reduceTransitionCommit(
  current: unknown,
  input: ContractTransitionCommitInput,
): TransitionCommitDecision {
  if (matchingReceipt(current, input)) {
    return {
      status: "alreadyCommitted",
      write: false,
      state: current,
    };
  }

  const contract = getPath(current, [
    "buildings",
    input.buildingId,
    "managementContract",
  ]);
  if (
    !isRecord(contract) ||
    managementContractFingerprint(
      contract as unknown as ContractTransitionReservation["previousContract"],
    ) !== input.expectedPreviousContractFingerprint
  ) {
    return { status: "staleConflict", write: false, state: current };
  }
  if (
    managementContractFingerprint(input.nextContract) !==
    input.expectedNextContractFingerprint
  ) {
    return invalidTransitionState();
  }

  let nextState = recordOrEmpty(current);
  for (const [path, value] of Object.entries(input.patch)) {
    nextState = setPath(nextState, relativePatchSegments(path), value);
  }
  if (!matchingReceipt(nextState, input)) invalidTransitionState();

  return { status: "committed", write: true, state: nextState };
}
