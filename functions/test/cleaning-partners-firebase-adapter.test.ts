import { describe, expect, it, vi } from "vitest";
import { createCleaningPartnerFirebaseDependencies } from "../src/cleaning-partners/firebase-adapter.js";
import type { CleaningPartnerDispatchRecord } from "../src/cleaning-partners/contracts.js";

const now = "2026-09-28T03:00:00.000Z";
const orderId = "7c2ac2d0-9a09-42f3-b8f8-7237562fc501";
const offerId = "8c2ac2d0-9a09-42f3-b8f8-7237562fc502";
const chargeRequestId = "9c2ac2d0-9a09-42f3-b8f8-7237562fc503";

function fakeDb(seed: Record<string, unknown>) {
  const root = structuredClone(seed) as Record<string, unknown>;
  const pathValue = (path: string) => path.split("/").reduce<unknown>((value, key) =>
    value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, root);
  const setPath = (path: string, value: unknown) => {
    const keys = path.split("/");
    let cursor = root;
    for (const key of keys.slice(0, -1)) {
      if (!cursor[key] || typeof cursor[key] !== "object") cursor[key] = {};
      cursor = cursor[key] as Record<string, unknown>;
    }
    cursor[keys.at(-1)!] = value;
  };
  const ref = (path: string) => ({
    async get() { return { val: () => structuredClone(pathValue(path) ?? null) }; },
    orderByChild(child: string) {
      let match: unknown = undefined;
      return {
        equalTo(value: string) { match = value; return this; },
        async get() {
          const rows = pathValue(path);
          const filtered = rows && typeof rows === "object"
            ? Object.fromEntries(Object.entries(rows as Record<string, unknown>).filter(([, row]) =>
              row && typeof row === "object" && (row as Record<string, unknown>)[child] === match)) : null;
          return { val: () => structuredClone(filtered) };
        },
      };
    },
    async transaction(update: (current: unknown) => unknown) {
      const current = pathValue(path) ?? null;
      const next = update(structuredClone(current));
      if (next === undefined) return { committed: false, snapshot: { val: () => structuredClone(current) } };
      setPath(path, structuredClone(next));
      return { committed: true, snapshot: { val: () => structuredClone(next) } };
    },
  });
  return { ref, value: (path: string) => pathValue(path), mutate: setPath };
}

const seed = () => ({
  crmCompany: {
    cleaningOrders: { [orderId]: {
      id: orderId, customerId: "customer_private", buildingId: "building_private", status: "scheduled",
      serviceType: "move_in_cleaning", desiredDate: "2026-09-29",
    } },
    data: {
      buildings: { building_private: { roadAddress: "강원특별자치도 원주시 무실로 123" } },
      partnerVendors: { vendor_01: { id: "vendor_01", archived: false } },
    },
    cleaningPartnerAccounts: {
      vendor_01: { vendorId: "vendor_01", email: "partner@example.com", enabled: true, updatedAt: now, updatedByUid: "admin_01" },
    },
  },
});

function extraChargeSeed() {
  const value = seed();
  const company = value.crmCompany as Record<string, any>;
  const extraOrderId = company.cleaningOrders[orderId].customerId = "ac2ac2d0-9a09-42f3-b8f8-7237562fc504";
  const buildingId = company.cleaningOrders[orderId].buildingId = "bc2ac2d0-9a09-42f3-b8f8-7237562fc505";
  company.cleaningOrders[orderId].status = "in_progress";
  company.cleaningOrders[orderId].desiredDate = "2026-09-29";
  company.data.customers = { [extraOrderId]: { id: extraOrderId, name: "김민수", phone: "01012345678", buildingIdLinks: { [buildingId]: true } } };
  company.data.buildings = { [buildingId]: { id: buildingId, customerId: extraOrderId, roadAddress: "원주시 무실로 123" } };
  company.cleaningPartnerDispatches = { [orderId]: {
    orderId, revision: 2, acceptedOfferId: offerId,
    offers: [{ id: offerId, orderId, vendorId: "vendor_01", serviceType: "move_in_cleaning", region: "원주시",
      desiredDate: "2026-09-29", supplierAmount: 190000, expiresAt: "2026-09-28T04:00:00.000Z", status: "accepted",
      revision: 2, createdAt: now, createdByUid: "admin_01", respondedAt: "2026-09-28T03:10:00.000Z",
      declineReason: "", progress: "started", events: [
        { type: "offered", occurredAt: now, actorUid: "admin_01", note: "" },
        { type: "accepted", occurredAt: "2026-09-28T03:10:00.000Z", actorUid: "partner_uid_01", note: "" },
        { type: "started", occurredAt: "2026-09-28T03:15:00.000Z", actorUid: "partner_uid_01", note: "" },
      ] }], events: [{ type: "offer_created", occurredAt: now, actorUid: "admin_01", vendorId: "vendor_01", note: "" }],
  } };
  return value;
}

describe("cleaning partner Firebase adapter", () => {
  it("stores a vendor-safe dispatch transactionally and returns it by verified email binding", async () => {
    const db = fakeDb(seed());
    const deps = createCleaningPartnerFirebaseDependencies(db, () => now);
    const created = await deps.createOffer({ requestId: offerId, orderId, vendorId: "vendor_01", supplierAmount: 190000,
      expiresAt: "2026-09-28T04:00:00.000Z" }, "admin_01");
    expect(created).toMatchObject({ ok: true, dispatch: { orderId, offers: [{ vendorId: "vendor_01", region: "원주시" }] } });
    const vendorOffers = await deps.readOffersForEmail("PARTNER@example.com");
    expect(vendorOffers).toHaveLength(1);
    expect(vendorOffers[0]).not.toHaveProperty("customerId");
    expect(vendorOffers[0]).not.toHaveProperty("buildingId");
    expect(vendorOffers[0]).not.toHaveProperty("address");
  });

  it("atomically accepts an offer once and prevents a second response", async () => {
    const db = fakeDb(seed());
    const deps = createCleaningPartnerFirebaseDependencies(db, () => "2026-09-28T03:30:00.000Z");
    await deps.createOffer({ requestId: offerId, orderId, vendorId: "vendor_01", supplierAmount: 190000,
      expiresAt: "2026-09-28T04:00:00.000Z" }, "admin_01");
    const accepted = await deps.respond({ offerId, action: "accept", reason: "" }, "partner_uid_01", "vendor_01");
    expect(accepted).toMatchObject({ ok: true, dispatch: { acceptedOfferId: offerId } });
    expect(await deps.respond({ offerId, action: "decline", reason: "schedule_unavailable" }, "partner_uid_01", "vendor_01"))
      .toMatchObject({ ok: false, error: "cleaning_partner_offer_already_resolved" });
    const stored = db.value(`crmCompany/cleaningPartnerDispatches/${orderId}`) as CleaningPartnerDispatchRecord;
    expect(stored.acceptedOfferId).toBe(offerId);
  });

  it("does not expose offers to unbound or disabled emails", async () => {
    const db = fakeDb(seed());
    const deps = createCleaningPartnerFirebaseDependencies(db, () => now);
    expect(await deps.readOffersForEmail("other@example.com")).toEqual([]);
    expect(await deps.readOffersForEmail("not-an-email")).toEqual([]);
  });

  it("lets the authorized admin workflow inspect one canonical dispatch without scanning partner records", async () => {
    const db = fakeDb(seed());
    const deps = createCleaningPartnerFirebaseDependencies(db, () => now);
    await deps.createOffer({ requestId: offerId, orderId, vendorId: "vendor_01", supplierAmount: 190000,
      expiresAt: "2026-09-28T04:00:00.000Z" }, "admin_01");
    expect(await deps.readDispatch(orderId)).toMatchObject({ orderId, revision: 1, offers: [{ id: offerId, vendorId: "vendor_01", status: "offered" }] });
    expect(await deps.readDispatch("missing-order")).toBeNull();
  });

  it("expires an unanswered offer inside the canonical dispatch transaction", async () => {
    const db = fakeDb(seed());
    let clock = "2026-09-28T03:00:00.000Z";
    const deps = createCleaningPartnerFirebaseDependencies(db, () => clock);
    await deps.createOffer({ requestId: offerId, orderId, vendorId: "vendor_01", supplierAmount: 190000,
      expiresAt: "2026-09-28T04:00:00.000Z" }, "admin_01");
    clock = "2026-09-28T04:00:00.000Z";
    expect(await deps.expireOffer({ orderId, offerId, expectedRevision: 1 }, "admin_01"))
      .toMatchObject({ ok: true, dispatch: { offers: [{ status: "expired", revision: 2 }] } });
  });
});

describe("cleaning extra charge Firebase adapter", () => {
  const input = {
    requestId: chargeRequestId, orderId,
    customerId: "ac2ac2d0-9a09-42f3-b8f8-7237562fc504",
    buildingId: "bc2ac2d0-9a09-42f3-b8f8-7237562fc505",
    vendorId: "vendor_01", serviceType: "waste_disposal", amount: 13000,
    reason: "현장 확인 결과 대형 폐기물이 발생했습니다.", evidenceFileIds: ["drive_file_123456"],
  };

  it("creates a request only for the same active job, accepted partner and linked customer, without touching billing", async () => {
    const db = fakeDb(extraChargeSeed());
    const deps = createCleaningPartnerFirebaseDependencies(db, () => now);
    expect(await deps.createExtraChargeRequest(input, "admin_01")).toMatchObject({
      ok: true, request: { requestId: chargeRequestId, status: "draft", customerId: input.customerId, vendorId: "vendor_01" },
    });
    expect(await deps.createExtraChargeRequest(input, "admin_01")).toMatchObject({ ok: false, error: "cleaning_extra_charge_conflict" });
    expect(db.value("crmCompany/invoices")).toBeUndefined();
    expect(db.value("crmCompany/paymentReceipts")).toBeUndefined();
  });

  it("rejects evidence IDs that the authenticated company Drive cannot verify", async () => {
    const db = fakeDb(extraChargeSeed());
    const deps = createCleaningPartnerFirebaseDependencies(db, () => now, async () => {
      throw new Error("not a company Drive image");
    });
    expect(await deps.createExtraChargeRequest(input, "admin_01")).toMatchObject({
      ok: false, error: "cleaning_extra_charge_evidence_invalid",
    });
    expect(db.value(`crmCompany/cleaningPartnerExtraCharges/${orderId}`)).toBeUndefined();
  });

  it("records only a matching accepted customer message and requires evidence for a decision", async () => {
    const db = fakeDb(extraChargeSeed());
    const deps = createCleaningPartnerFirebaseDependencies(db, () => "2026-09-28T03:20:00.000Z");
    await deps.createExtraChargeRequest(input, "admin_01");
    db.ref("crmCompany/messageDeliveries/12345678-1234-4234-8234-123456789012").transaction(() => ({
      requestId: "12345678-1234-4234-8234-123456789012", customerId: input.customerId,
      category: "cleaning_extra_charge_approval", sourceType: "cleaningOrder", sourceId: orderId, status: "accepted", providerMessageId: "provider-5678",
    }));
    expect(await deps.recordExtraChargeDelivery({ orderId, requestId: chargeRequestId, expectedRevision: 1,
      messageDeliveryId: "12345678-1234-4234-8234-123456789012" }, "admin_01"))
      .toMatchObject({ ok: true, request: { status: "awaiting_customer_approval", communication: { status: "accepted" } } });
    expect(await deps.recordExtraChargeDecision({ orderId, requestId: chargeRequestId, expectedRevision: 2, decision: "approve", evidenceRef: "", }, "admin_01"))
      .toMatchObject({ ok: false, error: "cleaning_extra_charge_decision_evidence_required" });
    expect(await deps.recordExtraChargeDecision({ orderId, requestId: chargeRequestId, expectedRevision: 2, decision: "approve", evidenceRef: "call-log-42", }, "admin_01"))
      .toMatchObject({ ok: true, request: { status: "approved", decisionEvidenceRef: "call-log-42" } });
    expect(db.value("crmCompany/invoices")).toBeUndefined();
  });

  it("keeps a provider rejection as an unsent draft instead of claiming customer approval", async () => {
    const db = fakeDb(extraChargeSeed());
    const deps = createCleaningPartnerFirebaseDependencies(db, () => "2026-09-28T03:20:00.000Z");
    await deps.createExtraChargeRequest(input, "admin_01");
    const deliveryId = "22345678-1234-4234-8234-123456789012";
    await db.ref(`crmCompany/messageDeliveries/${deliveryId}`).transaction(() => ({
      requestId: deliveryId, customerId: input.customerId, category: "cleaning_extra_charge_approval",
      sourceType: "cleaningOrder", sourceId: orderId, status: "failed", providerMessageId: "",
    }));
    expect(await deps.recordExtraChargeDelivery({ orderId, requestId: chargeRequestId, expectedRevision: 1,
      messageDeliveryId: deliveryId }, "admin_01"))
      .toMatchObject({ ok: true, request: { status: "draft", communication: { status: "failed", providerMessageId: "" } } });
  });

  it("rechecks the canonical customer/building link before recording an approval", async () => {
    const db = fakeDb(extraChargeSeed());
    const deps = createCleaningPartnerFirebaseDependencies(db, () => "2026-09-28T03:20:00.000Z");
    await deps.createExtraChargeRequest(input, "admin_01");
    const deliveryId = "32345678-1234-4234-8234-123456789012";
    await db.ref(`crmCompany/messageDeliveries/${deliveryId}`).transaction(() => ({
      requestId: deliveryId, customerId: input.customerId, category: "cleaning_extra_charge_approval",
      sourceType: "cleaningOrder", sourceId: orderId, status: "accepted", providerMessageId: "provider-5678",
    }));
    await deps.recordExtraChargeDelivery({ orderId, requestId: chargeRequestId, expectedRevision: 1,
      messageDeliveryId: deliveryId }, "admin_01");
    db.mutate(`crmCompany/data/buildings/${input.buildingId}/customerId`, "another_customer");
    db.mutate(`crmCompany/data/customers/${input.customerId}/buildingIdLinks/${input.buildingId}`, false);
    expect(await deps.recordExtraChargeDecision({ orderId, requestId: chargeRequestId, expectedRevision: 2,
      decision: "approve", evidenceRef: "전화 녹취 09:25" }, "admin_01"))
      .toMatchObject({ ok: false, error: "cleaning_extra_charge_order_context_invalid" });
    expect(db.value(`crmCompany/cleaningPartnerExtraCharges/${orderId}/${chargeRequestId}`))
      .toMatchObject({ status: "awaiting_customer_approval", revision: 2 });
  });

  it("records delay incidents and operator actions transactionally on the active dispatch", async () => {
    const db = fakeDb(extraChargeSeed());
    const deps = createCleaningPartnerFirebaseDependencies(db, () => "2026-09-28T03:25:00.000Z");
    const incidentId = "42345678-1234-4234-8234-123456789012";
    const report = await deps.recordDelayIncident({
      incidentId, orderId, expectedRevision: 2, issueType: "departure_delay",
      scheduledAt: "2026-09-28T03:00:00.000Z", delayMinutes: 25, note: "현장 미도착 확인",
    }, "admin_01");
    expect(report).toMatchObject({ ok: true, dispatch: { revision: 3 } });
    const action = await deps.recordDelayAction({
      incidentId, orderId, expectedRevision: 3, action: "customer_notice_logged", note: "고객에게 지연을 안내했습니다.",
    }, "admin_01");
    expect(action).toMatchObject({ ok: true, dispatch: { revision: 4 } });
    expect(db.value(`crmCompany/cleaningPartnerDispatches/${orderId}/events`)).toMatchObject([
      {}, { type: "incident_reported", incidentId, issueType: "departure_delay", delayMinutes: 25, vendorId: "vendor_01" },
      { type: "incident_action_logged", incidentId, action: "customer_notice_logged", vendorId: "vendor_01" },
    ]);
    expect(db.value("crmCompany/invoices")).toBeUndefined();
  });
});

describe("cleaning rework Firebase adapter", () => {
  const reworkId = "5c2ac2d0-9a09-42f3-b8f8-7237562fc506";
  const customerId = "ac2ac2d0-9a09-42f3-b8f8-7237562fc504";
  const buildingId = "bc2ac2d0-9a09-42f3-b8f8-7237562fc505";
  const reworkInput = {
    requestId: reworkId, orderId, customerId, buildingId, vendorId: "vendor_01",
    complaintTitle: "주방 재작업 요청", complaintDetail: "싱크대 주변 오염이 남아 있습니다.",
    areas: ["kitchen"], customerPhotoFileIds: [], desiredAt: "2026-10-01T01:00:00.000Z",
    partnerNote: "고객 요청 부위를 확인해 주세요.", customerNoticeRequested: true,
  };
  const completedSeed = () => {
    const value = extraChargeSeed();
    const company = value.crmCompany as Record<string, any>;
    const statuses = ["received", "reviewing", "quote_pending", "approval_pending", "scheduled", "in_progress", "review_pending", "completed"];
    const history = statuses.map((status, index) => ({
      requestId: `history_request_${index.toString().padStart(2, "0")}`,
      status,
      changedAt: new Date(Date.parse(now) + index * 60_000).toISOString(),
      changedByUid: "admin_01",
      note: "상태 확인",
    }));
    company.cleaningOrders[orderId] = {
      requestId: orderId, id: orderId, customerId, buildingId, serviceType: "move_in_cleaning",
      title: "입주청소", desiredDate: "2026-09-29", description: "", status: "completed", revision: history.length,
      createdAt: history[0].changedAt, createdByUid: "admin_01", updatedAt: history.at(-1).changedAt,
      updatedByUid: "admin_01", history,
    };
    company.data.customers = { [customerId]: { id: customerId, name: "김민수", buildingIdLinks: { [buildingId]: true } } };
    company.data.buildings = { [buildingId]: { id: buildingId, customerId, roadAddress: "원주시 무실로 123" } };
    const offer = company.cleaningPartnerDispatches[orderId].offers[0];
    offer.progress = "completed";
    offer.events = ["accepted", "departed", "arrived", "started", "photos_submitted", "completed"].map((type, index) => ({
      type, occurredAt: new Date(Date.parse(now) + (index + 1) * 60_000).toISOString(),
      actorUid: type === "accepted" ? "partner_uid_01" : "partner_uid_01", note: "",
    }));
    offer.status = "accepted";
    offer.respondedAt = offer.events[0].occurredAt;
    company.cleaningPartnerDispatches[orderId].events = [
      { type: "offer_created", occurredAt: now, actorUid: "admin_01", vendorId: "vendor_01", note: "" },
      { type: "offer_accepted", occurredAt: offer.respondedAt, actorUid: "partner_uid_01", vendorId: "vendor_01", note: "" },
    ];
    return value;
  };

  it("creates rework only against a canonical completed order and assigned completed partner", async () => {
    const db = fakeDb(completedSeed());
    const deps = createCleaningPartnerFirebaseDependencies(db, () => "2026-09-28T04:00:00.000Z");
    expect(await deps.createCleaningReworkRequest(reworkInput, "admin_01"))
      .toMatchObject({ ok: true, request: { status: "requested", customerNotice: { status: "pending" } } });
    expect(db.value(`crmCompany/cleaningReworkRequests/${orderId}/${reworkId}`)).toMatchObject({ vendorId: "vendor_01" });
    expect(db.value("crmCompany/paymentReceipts")).toBeUndefined();
  });

  it("scopes partner requests to the bound vendor and removes customer identifiers and evidence", async () => {
    const db = fakeDb(completedSeed());
    const deps = createCleaningPartnerFirebaseDependencies(db, () => "2026-09-28T04:00:00.000Z");
    await deps.createCleaningReworkRequest({ ...reworkInput, customerPhotoFileIds: ["customer_photo_123"] }, "admin_01");
    const result = await deps.readCleaningReworksForEmail("PARTNER@example.com");
    expect(result).toMatchObject({ vendorId: "vendor_01", requests: [{ status: "requested", orderId }] });
    expect(result.requests[0]).not.toHaveProperty("customerId");
    expect(result.requests[0]).not.toHaveProperty("buildingId");
    expect(result.requests[0]).not.toHaveProperty("customerPhotoFileIds");
    expect(result.requests[0]).toHaveProperty("customerPhotoCount", 1);
    expect(await deps.readCleaningReworksForEmail("other@example.com")).toMatchObject({ vendorId: "", requests: [] });
  });

  it("returns an indexed customer photo only to its authenticated assigned vendor without exposing Drive ids", async () => {
    const db = fakeDb(completedSeed());
    const readImage = vi.fn(async (fileId: string) => ({ mimeType: "image/jpeg", base64: "cGhvdG8=" }));
    const deps = createCleaningPartnerFirebaseDependencies(db, () => "2026-09-28T04:00:00.000Z", async ids => ids, readImage);
    await deps.createCleaningReworkRequest({ ...reworkInput, customerPhotoFileIds: ["customer_photo_123"] }, "admin_01");
    await expect(deps.readCleaningReworkPhotoForEmail("partner@example.com", orderId, reworkId, 0))
      .resolves.toEqual({ mimeType: "image/jpeg", base64: "cGhvdG8=" });
    await expect(deps.readCleaningReworkPhotoForEmail("other@example.com", orderId, reworkId, 0)).resolves.toBeNull();
    await expect(deps.readCleaningReworkPhotoForEmail("partner@example.com", orderId, reworkId, 1)).resolves.toBeNull();
    await expect(deps.readCleaningReworkPhotoForEmail("partner@example.com", orderId, reworkId, -1)).resolves.toBeNull();
    expect(readImage).toHaveBeenCalledTimes(1);
  });

  it("requires actual later work report with verified before and after photos before admin completion", async () => {
    const db = fakeDb(completedSeed());
    const deps = createCleaningPartnerFirebaseDependencies(db, () => "2026-09-28T04:00:00.000Z", async ids => ids);
    await deps.createCleaningReworkRequest(reworkInput, "admin_01");
    await deps.respondToCleaningRework({ orderId, requestId: reworkId, expectedRevision: 1, action: "accept", reason: "" }, "partner_uid_01", "vendor_01");
    await deps.updateCleaningReworkProgress({ orderId, requestId: reworkId, expectedRevision: 2, nextStatus: "in_progress" }, "partner_uid_01", "vendor_01");
    await deps.updateCleaningReworkProgress({ orderId, requestId: reworkId, expectedRevision: 3, nextStatus: "awaiting_review" }, "partner_uid_01", "vendor_01");
    const updatedAt = "2026-09-28T05:00:00.000Z";
    db.mutate("crmCompany/workReports/report_rework_01", {
      id: "report_rework_01", cleaningOrderId: orderId, buildingId, updatedAt,
      items: [{ key: "kitchen", status: "done",
        before: [{ id: "before_01", driveFileId: "before_drive_123", webViewLink: "https://drive.google.com/file/d/before_drive_123/view" }],
        after: [{ id: "after_01", driveFileId: "after_drive_123", webViewLink: "https://drive.google.com/file/d/after_drive_123/view" }] }],
    });
    expect(await deps.completeCleaningRework({ orderId, requestId: reworkId, expectedRevision: 4, reportId: "report_rework_01" }, "admin_01"))
      .toMatchObject({ ok: true, request: { status: "completed", completionReportId: "report_rework_01" } });
  });
});
