import { describe, expect, it } from "vitest";
import type { CleaningPartnerDispatchRecord } from "../src/cleaning-partners/contracts.js";
import { recordCleaningDelayAction, recordCleaningDelayIncident } from "../src/cleaning-partners/operations.js";

const orderId = "7c2ac2d0-9a09-42f3-b8f8-7237562fc501";
const incidentId = "9c2ac2d0-9a09-42f3-b8f8-7237562fc503";
const occurredAt = "2026-09-28T03:18:00.000Z";
const scheduledAt = "2026-09-28T03:00:00.000Z";

function acceptedDispatch(): CleaningPartnerDispatchRecord {
  return {
    orderId, revision: 3, acceptedOfferId: "8c2ac2d0-9a09-42f3-b8f8-7237562fc502",
    offers: [{
      id: "8c2ac2d0-9a09-42f3-b8f8-7237562fc502", orderId, vendorId: "vendor_01", serviceType: "move_in_cleaning",
      region: "원주시", desiredDate: "2026-09-28", supplierAmount: 190000, expiresAt: "2026-09-28T04:00:00.000Z",
      status: "accepted", revision: 2, createdAt: "2026-09-28T02:00:00.000Z", createdByUid: "admin_01",
      respondedAt: "2026-09-28T02:05:00.000Z", declineReason: "", progress: "departed",
      events: [
        { type: "offered", occurredAt: "2026-09-28T02:00:00.000Z", actorUid: "admin_01", note: "" },
        { type: "accepted", occurredAt: "2026-09-28T02:05:00.000Z", actorUid: "partner_uid_01", note: "" },
      ],
    }],
    events: [{ type: "offer_created", occurredAt: "2026-09-28T02:00:00.000Z", actorUid: "admin_01", vendorId: "vendor_01", note: "" },
      { type: "offer_accepted", occurredAt: "2026-09-28T02:05:00.000Z", actorUid: "partner_uid_01", vendorId: "vendor_01", note: "" }],
  };
}

describe("cleaning delay incident history", () => {
  it("records the incident against the accepted partner and advances the dispatch revision", () => {
    const result = recordCleaningDelayIncident(acceptedDispatch(), {
      incidentId, orderId, expectedRevision: 3, issueType: "departure_delay", scheduledAt, delayMinutes: 18,
      note: "파트너 출발 확인 후 예정 도착 시각을 넘김",
    }, "admin_01", occurredAt);

    expect(result).toMatchObject({ ok: true, dispatch: { revision: 4 } });
    if (result.ok) expect(result.dispatch.events.at(-1)).toMatchObject({
      type: "incident_reported", incidentId, issueType: "departure_delay", delayMinutes: 18, vendorId: "vendor_01",
    });
  });

  it("requires a current revision, a valid incident type, and a live accepted assignment", () => {
    const input = { incidentId, orderId, expectedRevision: 2, issueType: "departure_delay", scheduledAt, delayMinutes: 18, note: "지연" };
    expect(recordCleaningDelayIncident(acceptedDispatch(), input, "admin_01", occurredAt))
      .toMatchObject({ ok: false, error: "cleaning_delay_revision_conflict" });
    expect(recordCleaningDelayIncident(acceptedDispatch(), { ...input, expectedRevision: 3, issueType: "invented" }, "admin_01", occurredAt))
      .toMatchObject({ ok: false, error: "invalid_cleaning_delay_input" });
    const unassigned = { ...acceptedDispatch(), acceptedOfferId: null };
    expect(recordCleaningDelayIncident(unassigned, { ...input, expectedRevision: 3 }, "admin_01", occurredAt))
      .toMatchObject({ ok: false, error: "cleaning_delay_assignment_not_active" });
  });

  it("records an action only for a previously reported incident", () => {
    const report = recordCleaningDelayIncident(acceptedDispatch(), {
      incidentId, orderId, expectedRevision: 3, issueType: "no_show_suspected", scheduledAt, delayMinutes: 30, note: "연락 두절 확인 필요",
    }, "admin_01", occurredAt);
    if (!report.ok) throw new Error("incident fixture was rejected");
    const action = recordCleaningDelayAction(report.dispatch, {
      incidentId, orderId, expectedRevision: 4, action: "customer_notice_logged", note: "고객에게 예상 지연을 안내함",
    }, "admin_01", "2026-09-28T03:20:00.000Z");
    expect(action).toMatchObject({ ok: true, dispatch: { revision: 5 } });
    if (action.ok) expect(action.dispatch.events.at(-1)).toMatchObject({
      type: "incident_action_logged", incidentId, action: "customer_notice_logged", vendorId: "vendor_01",
    });
    expect(recordCleaningDelayAction(report.dispatch, {
      incidentId: "ac2ac2d0-9a09-42f3-b8f8-7237562fc504", orderId, expectedRevision: 4,
      action: "customer_notice_logged", note: "안내",
    }, "admin_01", "2026-09-28T03:20:00.000Z")).toMatchObject({ ok: false, error: "cleaning_delay_incident_not_found" });
  });
});
