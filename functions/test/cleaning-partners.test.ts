import { describe, expect, it } from "vitest";
import {
  addCleaningPartnerOffer,
  advanceCleaningPartnerProgress,
  bindCleaningPartnerAccount,
  decideCleaningPartnerOfferResponse,
  createCleaningPartnerDispatch,
  createCleaningExtraChargeRequest,
  expireCleaningPartnerOffer,
  normalizeCleaningPartnerEmail,
  normalizeCleaningPartnerOfferInput,
  recordCleaningExtraChargeDecision,
  recordCleaningExtraChargeDelivery,
  validateCleaningPartnerDispatch,
  type CleaningPartnerDispatchRecord,
} from "../src/cleaning-partners/core.js";

const timestamp = "2026-09-28T03:00:00.000Z";
const dispatch: CleaningPartnerDispatchRecord = {
  orderId: "7c2ac2d0-9a09-42f3-b8f8-7237562fc501",
  revision: 1,
  acceptedOfferId: null,
  offers: [{
    id: "8c2ac2d0-9a09-42f3-b8f8-7237562fc502",
    orderId: "7c2ac2d0-9a09-42f3-b8f8-7237562fc501",
    vendorId: "vendor_01",
    serviceType: "move_in_cleaning",
    region: "원주시",
    desiredDate: "2026-09-29",
    supplierAmount: 190000,
    expiresAt: "2026-09-28T04:00:00.000Z",
    status: "offered",
    revision: 1,
    createdAt: timestamp,
    createdByUid: "admin_01",
    respondedAt: "",
    declineReason: "",
    progress: "accepted",
    events: [{ type: "offered", occurredAt: timestamp, actorUid: "admin_01", note: "" }],
  }],
  events: [{ type: "offer_created", occurredAt: timestamp, actorUid: "admin_01", vendorId: "vendor_01", note: "" }],
};

describe("cleaning partner account email", () => {
  it("normalizes a verified login email without accepting malformed values", () => {
    expect(normalizeCleaningPartnerEmail("  Partner@Example.com ")).toBe("partner@example.com");
    expect(normalizeCleaningPartnerEmail("not-an-email")).toBeNull();
    expect(normalizeCleaningPartnerEmail("a+b@example.com")).toBe("a+b@example.com");
  });

  it("binds one active verified email to one vendor and permits admin revocation", () => {
    const bound = bindCleaningPartnerAccount({}, "vendor_01", "partner@example.com", true, "admin_01", timestamp);
    expect(bound).toMatchObject({ ok: true, accounts: { vendor_01: { email: "partner@example.com", enabled: true } } });
    expect(bindCleaningPartnerAccount(bound.ok ? bound.accounts : {}, "vendor_02", "partner@example.com", true, "admin_01", timestamp))
      .toMatchObject({ ok: false, error: "cleaning_partner_email_already_bound" });
    expect(bindCleaningPartnerAccount(bound.ok ? bound.accounts : {}, "vendor_01", "partner@example.com", false, "admin_01", timestamp))
      .toMatchObject({ ok: true, accounts: { vendor_01: { enabled: false } } });
  });
});

describe("cleaning partner offer input", () => {
  it("accepts only an order, vendor, integer supplier amount, and expiry", () => {
    expect(normalizeCleaningPartnerOfferInput({
      requestId: "9c2ac2d0-9a09-42f3-b8f8-7237562fc503",
      orderId: dispatch.orderId,
      vendorId: "vendor_01",
      supplierAmount: 190000,
      expiresAt: "2026-09-28T04:00:00.000Z",
    })).toMatchObject({ ok: true, value: { supplierAmount: 190000 } });
    expect(normalizeCleaningPartnerOfferInput({
      requestId: "9c2ac2d0-9a09-42f3-b8f8-7237562fc503",
      orderId: dispatch.orderId,
      vendorId: "vendor_01",
      supplierAmount: 190000,
      expiresAt: "2026-09-28T04:00:00.000Z",
      customerPhone: "010-1111-2222",
    })).toMatchObject({ ok: false, error: "invalid_cleaning_partner_input" });
    expect(normalizeCleaningPartnerOfferInput({
      requestId: "9c2ac2d0-9a09-42f3-b8f8-7237562fc503",
      orderId: dispatch.orderId,
      vendorId: "vendor_01",
      supplierAmount: 190000.5,
      expiresAt: "2026-09-28T04:00:00.000Z",
    })).toMatchObject({ ok: false, error: "invalid_cleaning_partner_input" });
  });
});

describe("cleaning partner offer response", () => {
  it("expires an unanswered offer only after its deadline and records a revisioned event", () => {
    expect(expireCleaningPartnerOffer(dispatch, { offerId: dispatch.offers[0].id, actorUid: "admin_01", expectedRevision: 1, now: "2026-09-28T03:59:59.000Z" }))
      .toMatchObject({ ok: false, error: "cleaning_partner_offer_not_expired" });
    expect(expireCleaningPartnerOffer(dispatch, { offerId: dispatch.offers[0].id, actorUid: "admin_01", expectedRevision: 1, now: "2026-09-28T04:00:00.000Z" }))
      .toMatchObject({ ok: true, dispatch: { revision: 2, offers: [{ status: "expired", revision: 2, respondedAt: "2026-09-28T04:00:00.000Z" }], events: [{ type: "offer_created" }, { type: "offer_expired" }] } });
    expect(expireCleaningPartnerOffer(dispatch, { offerId: dispatch.offers[0].id, actorUid: "admin_01", expectedRevision: 0, now: "2026-09-28T04:00:00.000Z" }))
      .toMatchObject({ ok: false, error: "invalid_cleaning_partner_input" });
  });
  it("accepts a live offer for its vendor and records a revisioned event", () => {
    const result = decideCleaningPartnerOfferResponse(dispatch, {
      offerId: dispatch.offers[0].id,
      vendorId: "vendor_01",
      action: "accept",
      reason: "",
      actorUid: "partner_uid_01",
      now: "2026-09-28T03:30:00.000Z",
    });
    expect(result.dispatch?.acceptedOfferId).toBe(dispatch.offers[0].id);
    expect(result.dispatch?.offers[0]).toMatchObject({ status: "accepted", revision: 2, respondedAt: "2026-09-28T03:30:00.000Z" });
    expect(result.dispatch?.offers[0].events.at(-1)).toMatchObject({ type: "accepted", actorUid: "partner_uid_01" });
  });

  it("requires a decline reason and never permits another vendor to respond", () => {
    expect(decideCleaningPartnerOfferResponse(dispatch, {
      offerId: dispatch.offers[0].id, vendorId: "vendor_01", action: "decline", reason: "",
      actorUid: "partner_uid_01", now: "2026-09-28T03:30:00.000Z",
    })).toMatchObject({ error: "cleaning_partner_decline_reason_required" });
    expect(decideCleaningPartnerOfferResponse(dispatch, {
      offerId: dispatch.offers[0].id, vendorId: "vendor_other", action: "accept", reason: "",
      actorUid: "partner_uid_02", now: "2026-09-28T03:30:00.000Z",
    })).toMatchObject({ error: "cleaning_partner_forbidden" });
  });

  it("blocks acceptance after expiry and blocks accepting a second offer for the order", () => {
    expect(decideCleaningPartnerOfferResponse(dispatch, {
      offerId: dispatch.offers[0].id, vendorId: "vendor_01", action: "accept", reason: "",
      actorUid: "partner_uid_01", now: "2026-09-28T04:00:00.000Z",
    })).toMatchObject({ error: "cleaning_partner_offer_expired" });
    const acceptedOfferId = "ac2ac2d0-9a09-42f3-b8f8-7237562fc504";
    const alreadyAssigned: CleaningPartnerDispatchRecord = {
      ...dispatch,
      acceptedOfferId,
      offers: [dispatch.offers[0], {
        ...dispatch.offers[0],
        id: acceptedOfferId,
        vendorId: "vendor_02",
        status: "accepted",
        revision: 2,
        respondedAt: "2026-09-28T03:20:00.000Z",
        events: [...dispatch.offers[0].events, { type: "accepted", occurredAt: "2026-09-28T03:20:00.000Z", actorUid: "partner_uid_02", note: "" }],
      }],
    };
    expect(decideCleaningPartnerOfferResponse(alreadyAssigned, {
      offerId: dispatch.offers[0].id, vendorId: "vendor_01", action: "accept", reason: "",
      actorUid: "partner_uid_01", now: "2026-09-28T03:30:00.000Z",
    })).toMatchObject({ error: "cleaning_partner_order_already_assigned" });
  });
});

describe("cleaning partner dispatch validation", () => {
  it("rejects PII and malformed or inconsistent offer snapshots", () => {
    expect(validateCleaningPartnerDispatch(dispatch, dispatch.orderId)).toBe(true);
    const withContact = structuredClone(dispatch) as CleaningPartnerDispatchRecord & { customerPhone?: string };
    withContact.customerPhone = "010-1111-2222";
    expect(validateCleaningPartnerDispatch(withContact, dispatch.orderId)).toBe(false);
    const wrongVendor = structuredClone(dispatch);
    wrongVendor.offers[0].vendorId = "vendor.other";
    expect(validateCleaningPartnerDispatch(wrongVendor, dispatch.orderId)).toBe(false);
  });

  it("creates the first dispatch and reassigns a declined or expired offer with an audit trail", () => {
    const first = createCleaningPartnerDispatch(dispatch.offers[0], "admin_01", timestamp);
    expect(first).toMatchObject({ orderId: dispatch.orderId, revision: 1, acceptedOfferId: null });
    const secondOffer = {
      ...dispatch.offers[0],
      id: "bc2ac2d0-9a09-42f3-b8f8-7237562fc505",
      vendorId: "vendor_02",
      createdAt: "2026-09-28T03:15:00.000Z",
      expiresAt: "2026-09-28T04:15:00.000Z",
      events: [{ type: "offered" as const, occurredAt: "2026-09-28T03:15:00.000Z", actorUid: "admin_01", note: "" }],
    };
    const declinedDispatch: CleaningPartnerDispatchRecord = {
      ...dispatch,
      offers: [{ ...dispatch.offers[0], status: "declined", revision: 2, respondedAt: "2026-09-28T03:10:00.000Z", declineReason: "schedule_unavailable",
        events: [...dispatch.offers[0].events, { type: "declined", occurredAt: "2026-09-28T03:10:00.000Z", actorUid: "partner_uid_01", note: "" }] }],
      revision: 2,
      events: [...dispatch.events, { type: "offer_declined", occurredAt: "2026-09-28T03:10:00.000Z", actorUid: "partner_uid_01", vendorId: "vendor_01", note: "schedule_unavailable" }],
    };
    const reassigned = addCleaningPartnerOffer(declinedDispatch, secondOffer, "admin_01", "2026-09-28T03:15:00.000Z");
    expect(reassigned).toMatchObject({ ok: true, dispatch: { revision: 3, offers: [{ status: "declined" }, { status: "offered", vendorId: "vendor_02" }] } });
    const acceptedDispatch: CleaningPartnerDispatchRecord = {
      ...dispatch,
      acceptedOfferId: dispatch.offers[0].id,
      offers: [{ ...dispatch.offers[0], status: "accepted", revision: 2, respondedAt: "2026-09-28T03:10:00.000Z",
        events: [...dispatch.offers[0].events, { type: "accepted", occurredAt: "2026-09-28T03:10:00.000Z", actorUid: "partner_uid_01", note: "" }] }],
    };
    expect(addCleaningPartnerOffer(acceptedDispatch, secondOffer, "admin_01", "2026-09-28T03:15:00.000Z"))
      .toMatchObject({ ok: false, error: "cleaning_partner_reassignment_required" });
    const replacement = addCleaningPartnerOffer(acceptedDispatch, secondOffer, "admin_01", "2026-09-28T03:15:00.000Z", true, "파트너 일정 변경으로 재배정");
    expect(replacement).toMatchObject({ ok: true, dispatch: { acceptedOfferId: null, offers: [{ status: "reassigned" }, { status: "offered" }] } });
    if (replacement.ok) {
      expect(replacement.dispatch.events.at(-1)).toMatchObject({ type: "offer_reassigned", note: "파트너 일정 변경으로 재배정" });
      expect(replacement.dispatch.offers[0].events.at(-1)).toMatchObject({ type: "reassigned", note: "파트너 일정 변경으로 재배정" });
    }
    const inProgress = { ...acceptedDispatch, offers: [{ ...acceptedDispatch.offers[0], progress: "departed" as const }] };
    expect(addCleaningPartnerOffer(inProgress, secondOffer, "admin_01", "2026-09-28T03:15:00.000Z", true, "파트너 일정 변경으로 재배정"))
      .toMatchObject({ ok: false, error: "cleaning_partner_reassignment_not_allowed" });
  });

  it("allows a departed partner to be reassigned only after an emergency request is audited", () => {
    const assigned: CleaningPartnerDispatchRecord = {
      ...dispatch, acceptedOfferId: dispatch.offers[0].id,
      offers: [{ ...dispatch.offers[0], status: "accepted", revision: 2, respondedAt: "2026-09-28T03:10:00.000Z",
        events: [...dispatch.offers[0].events, { type: "accepted", occurredAt: "2026-09-28T03:10:00.000Z", actorUid: "partner_uid_01", note: "" }] }],
    };
    const departed = advanceCleaningPartnerProgress(assigned, { offerId: assigned.offers[0].id, vendorId: "vendor_01",
      actorUid: "partner_uid_01", expectedRevision: 2, nextProgress: "departed", now: "2026-09-28T03:20:00.000Z" });
    expect(departed.ok).toBe(true);
    if (!departed.ok) return;
    const incident = { ...departed.dispatch, revision: departed.dispatch.revision + 2, events: [...departed.dispatch.events,
      { type: "incident_reported" as const, incidentId: "9c2ac2d0-9a09-42f3-b8f8-7237562fc503", issueType: "departure_delay" as const,
        scheduledAt: "2026-09-28T03:00:00.000Z", delayMinutes: 18, occurredAt: "2026-09-28T03:21:00.000Z", actorUid: "admin_01", vendorId: "vendor_01", note: "지연" },
      { type: "incident_action_logged" as const, incidentId: "9c2ac2d0-9a09-42f3-b8f8-7237562fc503", action: "emergency_reassignment_requested" as const,
        occurredAt: "2026-09-28T03:22:00.000Z", actorUid: "admin_01", vendorId: "vendor_01", note: "파트너와 고객 안내 확인" },
    ] };
    const replacementOffer = { ...dispatch.offers[0], id: "bc2ac2d0-9a09-42f3-b8f8-7237562fc505", vendorId: "vendor_02",
      createdAt: "2026-09-28T03:30:00.000Z", expiresAt: "2026-09-28T04:30:00.000Z",
      events: [{ type: "offered" as const, occurredAt: "2026-09-28T03:30:00.000Z", actorUid: "admin_01", note: "" }] };
    expect(addCleaningPartnerOffer(incident, replacementOffer, "admin_01", "2026-09-28T03:30:00.000Z", true, "긴급 재배정 · 고객 및 기존 파트너 안내 확인"))
      .toMatchObject({ ok: true, dispatch: { acceptedOfferId: null, offers: [{ status: "reassigned" }, { status: "offered", vendorId: "vendor_02" }] } });
  });
});

describe("cleaning partner job milestones", () => {
  it("advances only the assigned partner through departure, arrival, and work start", () => {
    const assigned: CleaningPartnerDispatchRecord = {
      ...dispatch,
      acceptedOfferId: dispatch.offers[0].id,
      offers: [{ ...dispatch.offers[0], status: "accepted", revision: 2, respondedAt: "2026-09-28T03:10:00.000Z",
        events: [...dispatch.offers[0].events, { type: "accepted", occurredAt: "2026-09-28T03:10:00.000Z", actorUid: "partner_uid_01", note: "" }] }],
    };
    const departed = advanceCleaningPartnerProgress(assigned, {
      offerId: dispatch.offers[0].id, vendorId: "vendor_01", actorUid: "partner_uid_01", expectedRevision: 2,
      nextProgress: "departed", now: "2026-09-28T03:20:00.000Z",
    });
    expect(departed).toMatchObject({ ok: true, dispatch: { offers: [{ progress: "departed", revision: 3 }] } });
    expect(advanceCleaningPartnerProgress(assigned, {
      offerId: dispatch.offers[0].id, vendorId: "other_vendor", actorUid: "partner_uid_02", expectedRevision: 2,
      nextProgress: "departed", now: "2026-09-28T03:20:00.000Z",
    })).toMatchObject({ ok: false, error: "cleaning_partner_forbidden" });
    expect(advanceCleaningPartnerProgress(departed.ok ? departed.dispatch : assigned, {
      offerId: dispatch.offers[0].id, vendorId: "vendor_01", actorUid: "partner_uid_01", expectedRevision: 3,
      nextProgress: "completed", now: "2026-09-28T03:30:00.000Z",
    })).toMatchObject({ ok: false, error: "cleaning_partner_progress_transition_invalid" });
  });
});

describe("cleaning extra charge approval lifecycle", () => {
  const input = {
    requestId: "9c2ac2d0-9a09-42f3-b8f8-7237562fc503",
    orderId: dispatch.orderId,
    customerId: "ac2ac2d0-9a09-42f3-b8f8-7237562fc504",
    buildingId: "bc2ac2d0-9a09-42f3-b8f8-7237562fc505",
    vendorId: "vendor_01",
    serviceType: "waste_disposal",
    amount: 13000,
    reason: "현장 확인 결과 대형 폐기물이 발생했습니다.",
    evidenceFileIds: ["drive_file_123456"],
  };

  it("accepts bounded charge requests with real Drive evidence and rejects invented or excessive input", () => {
    expect(createCleaningExtraChargeRequest(input, "admin_01", timestamp)).toMatchObject({
      ok: true,
      request: { amount: 13000, status: "draft", communication: { status: "not_sent" }, evidenceFileIds: ["drive_file_123456"] },
    });
    expect(createCleaningExtraChargeRequest({ ...input, amount: 13000.5 }, "admin_01", timestamp))
      .toMatchObject({ ok: false, error: "invalid_cleaning_extra_charge_input" });
    expect(createCleaningExtraChargeRequest({ ...input, reason: "bad" }, "admin_01", timestamp))
      .toMatchObject({ ok: false, error: "invalid_cleaning_extra_charge_input" });
    expect(createCleaningExtraChargeRequest({ ...input, evidenceFileIds: Array(6).fill("drive_file_123456") }, "admin_01", timestamp))
      .toMatchObject({ ok: false, error: "invalid_cleaning_extra_charge_input" });
    expect(createCleaningExtraChargeRequest({ ...input, evidenceFileIds: ["https://example.com/fake.jpg"] }, "admin_01", timestamp))
      .toMatchObject({ ok: false, error: "invalid_cleaning_extra_charge_input" });
  });

  it("keeps delivery acceptance separate from customer approval and requires decision evidence", () => {
    const created = createCleaningExtraChargeRequest(input, "admin_01", timestamp);
    if (!created.ok) throw new Error("valid request was rejected");
    const sent = recordCleaningExtraChargeDelivery(created.request, {
      actorUid: "admin_01", expectedRevision: 1, result: "accepted", providerMessageId: "msg-123",
      now: "2026-09-28T03:10:00.000Z",
    });
    expect(sent).toMatchObject({ ok: true, request: { status: "awaiting_customer_approval", revision: 2, communication: { status: "accepted" } } });
    if (!sent.ok) throw new Error("accepted message delivery was rejected");
    expect(recordCleaningExtraChargeDecision(sent.request, {
      actorUid: "admin_01", expectedRevision: 2, decision: "approve", evidenceRef: "call-log-42", now: "2026-09-28T03:15:00.000Z",
    })).toMatchObject({ ok: true, request: { status: "approved", revision: 3 } });
    expect(recordCleaningExtraChargeDecision(sent.request, {
      actorUid: "admin_01", expectedRevision: 2, decision: "approve", evidenceRef: "", now: "2026-09-28T03:15:00.000Z",
    })).toMatchObject({ ok: false, error: "cleaning_extra_charge_decision_evidence_required" });
    expect(recordCleaningExtraChargeDecision(sent.request, {
      actorUid: "admin_01", expectedRevision: 1, decision: "approve", evidenceRef: "call-log-42", now: "2026-09-28T03:15:00.000Z",
    })).toMatchObject({ ok: false, error: "cleaning_extra_charge_revision_conflict" });
  });

  it("keeps a failed provider attempt unsent and prevents customer decisions before delivery", () => {
    const created = createCleaningExtraChargeRequest(input, "admin_01", timestamp);
    if (!created.ok) throw new Error("valid request was rejected");
    const failed = recordCleaningExtraChargeDelivery(created.request, {
      actorUid: "admin_01", expectedRevision: 1, result: "failed", providerMessageId: "",
      now: "2026-09-28T03:10:00.000Z",
    });
    expect(failed).toMatchObject({ ok: true, request: { status: "draft", revision: 2, communication: { status: "failed" } } });
    if (!failed.ok) throw new Error("provider failure state was rejected");
    expect(recordCleaningExtraChargeDecision(failed.request, {
      actorUid: "admin_01", expectedRevision: 2, decision: "approve", evidenceRef: "call-log-42", now: "2026-09-28T03:15:00.000Z",
    })).toMatchObject({ ok: false, error: "cleaning_extra_charge_not_awaiting_decision" });
  });
});
