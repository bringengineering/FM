export const CLEANING_ORDER_STATUSES = [
  "received",
  "reviewing",
  "quote_pending",
  "approval_pending",
  "scheduled",
  "in_progress",
  "review_pending",
  "revision_requested",
  "completed",
  "cancelled",
] as const;

export type CleaningOrderStatus = (typeof CLEANING_ORDER_STATUSES)[number];
export type CleaningOrderActorRole = "admin" | "member" | "viewer";

export const CLEANING_ORDER_SERVICE_TYPES = [
  "move_in_cleaning",
  "move_out_cleaning",
  "common_cleaning",
  "stair_cleaning",
  "other",
] as const;

export type CleaningOrderServiceType = (typeof CLEANING_ORDER_SERVICE_TYPES)[number];

export interface CleaningOrderCreateInput {
  requestId: string;
  customerId: string;
  buildingId: string;
  serviceType: CleaningOrderServiceType;
  title: string;
  desiredDate: string;
  description: string;
}

export interface CleaningOrderAuditEntry {
  requestId: string;
  status: CleaningOrderStatus;
  changedAt: string;
  changedByUid: string;
  note: string;
}

export interface CleaningOrderRecord extends CleaningOrderCreateInput {
  id: string;
  status: CleaningOrderStatus;
  revision: number;
  createdAt: string;
  createdByUid: string;
  updatedAt: string;
  updatedByUid: string;
  history: CleaningOrderAuditEntry[];
}

export type CleaningOrderTransitionDecision =
  | { ok: true }
  | { ok: false; error: "cleaning_order_transition_forbidden" };

export type CleaningOrderInputDecision =
  | { ok: true; value: CleaningOrderCreateInput }
  | { ok: false; error: "invalid_cleaning_order_input" };

export interface CleaningOrderActor {
  uid: string;
  role: CleaningOrderActorRole;
}

export interface CreateCleaningOrderResult {
  order: CleaningOrderRecord;
  replayed: boolean;
}

export interface CleaningOrderTransitionInput {
  requestId: string;
  orderId: string;
  expectedRevision: number;
  nextStatus: CleaningOrderStatus;
  note: string;
}
