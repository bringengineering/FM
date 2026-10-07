export const CLEANING_PARTNER_OFFER_STATUSES = [
  "offered",
  "accepted",
  "declined",
  "expired",
  "reassigned",
] as const;

export type CleaningPartnerOfferStatus = (typeof CLEANING_PARTNER_OFFER_STATUSES)[number];

export const CLEANING_PARTNER_DECLINE_REASONS = [
  "schedule_unavailable",
  "outside_service_area",
  "staff_unavailable",
  "price_unavailable",
  "other",
] as const;

export type CleaningPartnerDeclineReason = (typeof CLEANING_PARTNER_DECLINE_REASONS)[number];

export const CLEANING_PARTNER_PROGRESS_STATES = [
  "accepted",
  "departed",
  "arrived",
  "started",
  "photos_submitted",
  "completed",
] as const;

export type CleaningPartnerProgress = (typeof CLEANING_PARTNER_PROGRESS_STATES)[number];

export const CLEANING_DELAY_ISSUE_TYPES = ["departure_delay", "on_site_missing", "no_show_suspected"] as const;
export type CleaningDelayIssueType = (typeof CLEANING_DELAY_ISSUE_TYPES)[number];
export const CLEANING_DELAY_ACTIONS = ["partner_contact_logged", "customer_notice_logged", "replacement_search_logged", "emergency_reassignment_requested"] as const;
export type CleaningDelayAction = (typeof CLEANING_DELAY_ACTIONS)[number];

interface CleaningPartnerDispatchEventBase {
  occurredAt: string;
  actorUid: string;
  vendorId: string;
  note: string;
}

export type CleaningPartnerDispatchEvent =
  | (CleaningPartnerDispatchEventBase & { type: "offer_created" | "offer_accepted" | "offer_declined" | "offer_expired" | "offer_reassigned" | "progress_updated" })
  | (CleaningPartnerDispatchEventBase & {
    type: "incident_reported"; incidentId: string; issueType: CleaningDelayIssueType; scheduledAt: string; delayMinutes: number;
  })
  | (CleaningPartnerDispatchEventBase & { type: "incident_action_logged"; incidentId: string; action: CleaningDelayAction });

export interface CleaningDelayIncidentInput {
  incidentId: string;
  orderId: string;
  expectedRevision: number;
  issueType: CleaningDelayIssueType;
  scheduledAt: string;
  delayMinutes: number;
  note: string;
}

export interface CleaningDelayActionInput {
  incidentId: string;
  orderId: string;
  expectedRevision: number;
  action: CleaningDelayAction;
  note: string;
}

export interface CleaningPartnerOfferEvent {
  type: "offered" | "accepted" | "declined" | "expired" | "reassigned"
    | "departed" | "arrived" | "started" | "photos_submitted" | "completed";
  occurredAt: string;
  actorUid: string;
  note: string;
}

export interface CleaningPartnerOffer {
  id: string;
  orderId: string;
  vendorId: string;
  serviceType: string;
  region: string;
  desiredDate: string;
  supplierAmount: number;
  expiresAt: string;
  status: CleaningPartnerOfferStatus;
  revision: number;
  createdAt: string;
  createdByUid: string;
  respondedAt: string;
  declineReason: CleaningPartnerDeclineReason | "";
  progress: CleaningPartnerProgress;
  events: CleaningPartnerOfferEvent[];
}

export interface CleaningPartnerDispatchRecord {
  orderId: string;
  revision: number;
  acceptedOfferId: string | null;
  offers: CleaningPartnerOffer[];
  events: CleaningPartnerDispatchEvent[];
}

export interface CleaningPartnerAccountBinding {
  vendorId: string;
  email: string;
  enabled: boolean;
  updatedAt: string;
  updatedByUid: string;
}

export const CLEANING_EXTRA_CHARGE_SERVICES = [
  "balcony_cleaning", "window_cleaning", "aircon_disassembly", "waste_disposal", "other",
] as const;
export type CleaningExtraChargeService = (typeof CLEANING_EXTRA_CHARGE_SERVICES)[number];
export type CleaningExtraChargeStatus = "draft" | "awaiting_customer_approval" | "approved" | "declined";
export type CleaningExtraChargeCommunicationStatus = "not_sent" | "accepted" | "failed";
export type CleaningExtraChargeEventType = "request_created" | "message_accepted" | "message_failed" | "customer_approved" | "customer_declined";

export interface CleaningExtraChargeEvent {
  type: CleaningExtraChargeEventType;
  occurredAt: string;
  actorUid: string;
  note: string;
}

export interface CleaningExtraChargeRequest {
  requestId: string;
  orderId: string;
  customerId: string;
  buildingId: string;
  vendorId: string;
  serviceType: CleaningExtraChargeService;
  amount: number;
  reason: string;
  evidenceFileIds: string[];
  status: CleaningExtraChargeStatus;
  revision: number;
  communication: { status: CleaningExtraChargeCommunicationStatus; providerMessageId: string; updatedAt: string };
  decisionEvidenceRef: string;
  decidedAt: string;
  decidedByUid: string;
  createdAt: string;
  createdByUid: string;
  updatedAt: string;
  events: CleaningExtraChargeEvent[];
}

export interface CleaningPartnerOfferInput {
  requestId: string;
  orderId: string;
  vendorId: string;
  supplierAmount: number;
  expiresAt: string;
}

export type CleaningPartnerOfferInputDecision =
  | { ok: true; value: CleaningPartnerOfferInput }
  | { ok: false; error: "invalid_cleaning_partner_input" };

export type CleaningPartnerOfferResponseDecision =
  | { ok: true; dispatch: CleaningPartnerDispatchRecord }
  | { ok: false; error: string };
