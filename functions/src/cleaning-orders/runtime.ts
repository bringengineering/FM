import type {
  CleaningOrderActor,
  CleaningOrderCreateInput,
  CleaningOrderRecord,
  CleaningOrderTransitionInput,
  CreateCleaningOrderResult,
} from "./contracts.js";
import {
  decideCleaningOrderTransition,
  normalizeCleaningOrderInput,
  validateStoredCleaningOrder,
} from "./core.js";
import {
  collectCleaningOrderCompletionPhotoFileIds,
  validateCleaningOrderCompletionEvidence,
} from "./completion-evidence.js";

export interface CleaningOrderCreateDependencies {
  now(): string;
  readCustomer(id: string): Promise<unknown | null>;
  readBuilding(id: string): Promise<unknown | null>;
  createOrderIfAbsent(order: CleaningOrderRecord): Promise<{
    order: CleaningOrderRecord | null;
    created: boolean;
  }>;
}

export interface CleaningOrderTransitionDependencies {
  now(): string;
  readOrder(id: string): Promise<unknown | null>;
  readLinkedWorkOrders?(orderId: string): Promise<unknown>;
  readCompletionReports?(orderId: string): Promise<unknown>;
  verifyCompletionPhotoFileIds?(fileIds: string[]): Promise<unknown>;
  updateOrderIfRevision(
    id: string,
    expectedRevision: number,
    order: CleaningOrderRecord,
  ): Promise<{ order: CleaningOrderRecord | null; updated: boolean }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isSafeActor(actor: unknown): actor is CleaningOrderActor {
  if (!isRecord(actor)) return false;
  return typeof actor.uid === "string"
    && /^[A-Za-z0-9_-]{1,128}$/.test(actor.uid)
    && actor.uid !== "__proto__"
    && actor.uid !== "prototype"
    && actor.uid !== "constructor"
    && (actor.role === "admin" || actor.role === "member");
}

function isActiveEntity(value: unknown, id: string): boolean {
  if (!isRecord(value) || value.id !== id) return false;
  if (value.archived === true || value.deleted === true) return false;
  if (typeof value.archivedAt === "string" && value.archivedAt !== "") return false;
  if (typeof value.deletedAt === "string" && value.deletedAt !== "") return false;
  return true;
}

function isCustomerLinkedToBuilding(customer: unknown, building: unknown, buildingId: string): boolean {
  if (!isRecord(customer) || !isRecord(building)) return false;
  if (building.ownerCustomerId === customer.id) return true;
  const buildingIds = Array.isArray(customer.buildingIds)
    ? customer.buildingIds
    : [];
  if (buildingIds.includes(buildingId)) return true;
  const links = isRecord(customer.buildingIdLinks) ? customer.buildingIdLinks : {};
  return links[buildingId] === true;
}

function hasSameCreatePayload(
  existing: unknown,
  input: CleaningOrderCreateInput,
  actorUid: string,
): existing is CleaningOrderRecord {
  if (!validateStoredCleaningOrder(existing, input.requestId)) return false;
  return existing.id === input.requestId
    && existing.createdByUid === actorUid
    && existing.customerId === input.customerId
    && existing.buildingId === input.buildingId
    && existing.serviceType === input.serviceType
    && existing.title === input.title
    && existing.desiredDate === input.desiredDate
    && existing.description === input.description;
}

function hasAssignedCleaningWorkOrder(order: CleaningOrderRecord, value: unknown): boolean {
  const workOrders = Array.isArray(value)
    ? value
    : isRecord(value) ? Object.values(value) : [];
  return workOrders.some((raw) => {
    if (!isRecord(raw)) return false;
    const dueDate = raw.dueDate;
    return raw.cleaningOrderId === order.id
      && raw.buildingId === order.buildingId
      && raw.status === "assigned"
      && typeof raw.id === "string" && raw.id.length > 0
      && typeof raw.assigneeUid === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(raw.assigneeUid)
      && typeof dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dueDate)
      && Number.isFinite(Date.parse(`${dueDate}T00:00:00.000Z`))
      && new Date(`${dueDate}T00:00:00.000Z`).toISOString().slice(0, 10) === dueDate;
  });
}

export async function createCleaningOrderCore(
  rawInput: unknown,
  actor: unknown,
  dependencies: CleaningOrderCreateDependencies,
): Promise<CreateCleaningOrderResult> {
  const decision = normalizeCleaningOrderInput(rawInput);
  if (!decision.ok) throw new Error(decision.error);
  if (!isSafeActor(actor)) throw new Error("cleaning_order_forbidden");
  if (
    !isRecord(dependencies)
    || typeof dependencies.now !== "function"
    || typeof dependencies.readCustomer !== "function"
    || typeof dependencies.readBuilding !== "function"
    || typeof dependencies.createOrderIfAbsent !== "function"
  ) {
    throw new Error("cleaning_order_runtime_invalid");
  }

  const input = decision.value;
  const [customer, building] = await Promise.all([
    dependencies.readCustomer(input.customerId),
    dependencies.readBuilding(input.buildingId),
  ]);
  if (!isActiveEntity(customer, input.customerId)) throw new Error("cleaning_order_customer_not_found");
  if (!isActiveEntity(building, input.buildingId)) throw new Error("cleaning_order_building_not_found");
  if (!isCustomerLinkedToBuilding(customer, building, input.buildingId)) {
    throw new Error("cleaning_order_customer_building_mismatch");
  }

  const now = dependencies.now();
  if (!isCanonicalTimestamp(now)) throw new Error("cleaning_order_timestamp_invalid");

  const order: CleaningOrderRecord = {
    ...input,
    id: input.requestId,
    status: "received",
    revision: 1,
    createdAt: now,
    createdByUid: actor.uid,
    updatedAt: now,
    updatedByUid: actor.uid,
    history: [{ requestId: input.requestId, status: "received", changedAt: now, changedByUid: actor.uid, note: "주문 접수" }],
  };

  const result = await dependencies.createOrderIfAbsent(order);
  if (!isRecord(result) || typeof result.created !== "boolean") {
    throw new Error("cleaning_order_write_failed");
  }
  if (result.created) {
    if (!hasSameCreatePayload(result.order, input, actor.uid) || result.order.revision !== 1) {
      throw new Error("cleaning_order_write_failed");
    }
    return { order: result.order, replayed: false };
  }
  if (hasSameCreatePayload(result.order, input, actor.uid)) {
    return { order: result.order, replayed: true };
  }
  throw new Error("cleaning_order_request_conflict");
}

function normalizeTransitionInput(input: unknown): CleaningOrderTransitionInput {
  if (!isRecord(input)) throw new Error("invalid_cleaning_order_input");
  const allowedKeys = new Set(["requestId", "orderId", "expectedRevision", "nextStatus", "note"]);
  if (Object.keys(input).some(key => !allowedKeys.has(key))) throw new Error("invalid_cleaning_order_input");
  const requestId = input.requestId;
  const orderId = input.orderId;
  const expectedRevision = input.expectedRevision;
  const nextStatus = input.nextStatus;
  const note = input.note === undefined ? "" : input.note;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    typeof requestId !== "string" || !uuid.test(requestId)
    || typeof orderId !== "string" || !uuid.test(orderId)
    || !Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 1
    || typeof nextStatus !== "string"
    || typeof note !== "string" || note.trim().length > 500
  ) throw new Error("invalid_cleaning_order_input");

  return {
    requestId,
    orderId,
    expectedRevision: Number(expectedRevision),
    nextStatus: nextStatus as CleaningOrderTransitionInput["nextStatus"],
    note: note.trim(),
  };
}

export async function transitionCleaningOrderCore(
  rawInput: unknown,
  actor: unknown,
  dependencies: CleaningOrderTransitionDependencies,
): Promise<CreateCleaningOrderResult> {
  const input = normalizeTransitionInput(rawInput);
  if (!isSafeActor(actor)) throw new Error("cleaning_order_forbidden");
  if (
    !isRecord(dependencies)
    || typeof dependencies.now !== "function"
    || typeof dependencies.readOrder !== "function"
    || typeof dependencies.updateOrderIfRevision !== "function"
  ) throw new Error("cleaning_order_runtime_invalid");

  const existing = await dependencies.readOrder(input.orderId);
  if (!validateStoredCleaningOrder(existing, input.orderId)) throw new Error("cleaning_order_not_found");
  const replayedTransition = existing.history.find((entry: unknown) =>
    isRecord(entry) && entry.requestId === input.requestId,
  );
  if (replayedTransition) {
    if (
      replayedTransition.status === input.nextStatus
      && replayedTransition.changedByUid === actor.uid
      && replayedTransition.note === input.note
    ) return { order: existing, replayed: true };
    throw new Error("cleaning_order_request_conflict");
  }
  if (existing.revision !== input.expectedRevision) throw new Error("cleaning_order_revision_conflict");
  const allowed = decideCleaningOrderTransition(existing.status, input.nextStatus, actor.role);
  if (!allowed.ok) throw new Error(allowed.error);
  if (input.nextStatus === "scheduled") {
    if (typeof dependencies.readLinkedWorkOrders !== "function") throw new Error("cleaning_order_assignment_required");
    const linkedWorkOrders = await dependencies.readLinkedWorkOrders(existing.id);
    if (!hasAssignedCleaningWorkOrder(existing, linkedWorkOrders)) throw new Error("cleaning_order_assignment_required");
  }
  if (input.nextStatus === "completed") {
    if (typeof dependencies.readCompletionReports !== "function") {
      throw new Error("cleaning_order_completion_evidence_required");
    }
    const reports = await dependencies.readCompletionReports(existing.id);
    const fileIds = collectCleaningOrderCompletionPhotoFileIds(existing.id, reports);
    if (fileIds === null || typeof dependencies.verifyCompletionPhotoFileIds !== "function") {
      throw new Error("cleaning_order_completion_evidence_required");
    }
    let verified: unknown;
    try {
      verified = await dependencies.verifyCompletionPhotoFileIds(fileIds);
    } catch {
      verified = [];
    }
    const verifiedPhotoFileIds = new Set(Array.isArray(verified)
      ? verified.filter((value): value is string => typeof value === "string")
      : []);
    const evidence = validateCleaningOrderCompletionEvidence(existing, reports, verifiedPhotoFileIds);
    if (!evidence.ok) throw new Error(evidence.error);
  }
  if (existing.history.length >= 200) throw new Error("cleaning_order_history_limit");

  const now = dependencies.now();
  if (!isCanonicalTimestamp(now)) throw new Error("cleaning_order_timestamp_invalid");
  const order: CleaningOrderRecord = {
    ...existing,
    status: input.nextStatus,
    revision: input.expectedRevision + 1,
    updatedAt: now,
    updatedByUid: actor.uid,
    history: [...existing.history, {
      requestId: input.requestId,
      status: input.nextStatus,
      changedAt: now,
      changedByUid: actor.uid,
      note: input.note,
    }],
  };
  const result = await dependencies.updateOrderIfRevision(input.orderId, input.expectedRevision, order);
  if (!isRecord(result) || typeof result.updated !== "boolean") throw new Error("cleaning_order_write_failed");
  if (result.updated && validateStoredCleaningOrder(result.order, input.orderId)) return { order: result.order, replayed: false };
  if (validateStoredCleaningOrder(result.order, input.orderId)) {
    const repeated = result.order.history.find((entry: unknown) =>
      isRecord(entry) && entry.requestId === input.requestId
        && entry.status === input.nextStatus && entry.changedByUid === actor.uid && entry.note === input.note,
    );
    if (repeated) return { order: result.order, replayed: true };
  }
  throw new Error("cleaning_order_revision_conflict");
}
