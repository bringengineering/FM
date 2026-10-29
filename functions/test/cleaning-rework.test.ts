import { describe, expect, it } from "vitest";
import {
  createCleaningReworkRequest,
  recordCleaningReworkPartnerResponse,
  recordCleaningReworkProgress,
  recordCleaningReworkCompletion,
  validateCleaningReworkRequest,
} from "../src/cleaning-partners/rework.js";

const ids = {
  orderId: "7c2ac2d0-9a09-42f3-b8f8-7237562fc501",
  customerId: "ac2ac2d0-9a09-42f3-b8f8-7237562fc504",
  buildingId: "bc2ac2d0-9a09-42f3-b8f8-7237562fc505",
  requestId: "9c2ac2d0-9a09-42f3-b8f8-7237562fc503",
};
const now = "2026-09-28T03:00:00.000Z";

function input() {
  return {
    requestId: ids.requestId,
    orderId: ids.orderId,
    customerId: ids.customerId,
    buildingId: ids.buildingId,
    vendorId: "vendor_01",
    complaintTitle: "창틀 모서리 청소 누락",
    complaintDetail: "창틀 끝 모서리에 먼지가 남아 있습니다.",
    areas: ["window", "kitchen"],
    customerPhotoFileIds: ["driveFile123"],
    desiredAt: "2026-09-30T03:00:00.000Z",
    partnerNote: "거실과 안방 창틀 모서리를 다시 확인해 주세요.",
    customerNoticeRequested: true,
  };
}

describe("cleaning rework requests", () => {
  it("creates a validated request with an audit event and no order or billing mutation", () => {
    const created = createCleaningReworkRequest(input(), "admin_01", now);
    const { customerNoticeRequested: _noticeRequested, ...recordInput } = input();
    expect(created).toMatchObject({ ok: true, request: {
      ...recordInput, status: "requested", revision: 1,
      customerNotice: { requested: true, status: "pending" },
      events: [{ type: "requested", actorUid: "admin_01" }],
    } });
    if (created.ok) expect(validateCleaningReworkRequest(created.request)).toBe(true);
  });

  it("rejects empty areas, invalid photo IDs, and unexpected customer PII", () => {
    expect(createCleaningReworkRequest({ ...input(), areas: [] }, "admin_01", now))
      .toMatchObject({ ok: false, error: "invalid_cleaning_rework_input" });
    expect(createCleaningReworkRequest({ ...input(), customerPhotoFileIds: ["x"] }, "admin_01", now))
      .toMatchObject({ ok: false, error: "invalid_cleaning_rework_input" });
    expect(createCleaningReworkRequest({ ...input(), phone: "01012345678" }, "admin_01", now))
      .toMatchObject({ ok: false, error: "invalid_cleaning_rework_input" });
  });

  it("lets only the assigned vendor accept or decline a request and requires a reason", () => {
    const created = createCleaningReworkRequest(input(), "admin_01", now);
    if (!created.ok) throw new Error("fixture invalid");
    expect(recordCleaningReworkPartnerResponse(created.request, {
      vendorId: "vendor_other", actorUid: "partner_02", expectedRevision: 1, action: "accept", reason: "", now,
    })).toMatchObject({ ok: false, error: "cleaning_rework_forbidden" });
    expect(recordCleaningReworkPartnerResponse(created.request, {
      vendorId: "vendor_01", actorUid: "partner_01", expectedRevision: 1, action: "decline", reason: "", now,
    })).toMatchObject({ ok: false, error: "cleaning_rework_decline_reason_required" });
    expect(recordCleaningReworkPartnerResponse(created.request, {
      vendorId: "vendor_01", actorUid: "partner_01", expectedRevision: 1, action: "accept", reason: "", now,
    })).toMatchObject({ ok: true, request: { status: "accepted", revision: 2 } });
  });

  it("checks revisions for partner progress and permits admin completion only from review", () => {
    const created = createCleaningReworkRequest(input(), "admin_01", now);
    if (!created.ok) throw new Error("fixture invalid");
    const accepted = recordCleaningReworkPartnerResponse(created.request, {
      vendorId: "vendor_01", actorUid: "partner_01", expectedRevision: 1, action: "accept", reason: "", now,
    });
    if (!accepted.ok) throw new Error("accept fixture invalid");
    const started = recordCleaningReworkProgress(accepted.request, {
      vendorId: "vendor_01", actorUid: "partner_01", expectedRevision: 2, nextStatus: "in_progress", now,
    });
    expect(started).toMatchObject({ ok: true, request: { status: "in_progress", revision: 3 } });
    if (!started.ok) return;
    const submitted = recordCleaningReworkProgress(started.request, {
      vendorId: "vendor_01", actorUid: "partner_01", expectedRevision: 3, nextStatus: "awaiting_review", now,
    });
    expect(submitted).toMatchObject({ ok: true, request: { status: "awaiting_review", revision: 4 } });
    if (!submitted.ok) return;
    expect(recordCleaningReworkCompletion(submitted.request, {
      actorUid: "admin_01", expectedRevision: 3, reportId: "report_123", now,
    })).toMatchObject({ ok: false, error: "cleaning_rework_revision_conflict" });
    expect(recordCleaningReworkCompletion(submitted.request, {
      actorUid: "admin_01", expectedRevision: 4, reportId: "report_123", now,
    })).toMatchObject({ ok: true, request: { status: "completed", completionReportId: "report_123", revision: 5 } });
  });

  it("never allows a declined request to be progressed and rejects malformed stored records", () => {
    const created = createCleaningReworkRequest(input(), "admin_01", now);
    if (!created.ok) throw new Error("fixture invalid");
    const declined = recordCleaningReworkPartnerResponse(created.request, {
      vendorId: "vendor_01", actorUid: "partner_01", expectedRevision: 1, action: "decline", reason: "일정 불가", now,
    });
    expect(declined).toMatchObject({ ok: true, request: { status: "declined", declineReason: "일정 불가" } });
    if (!declined.ok) return;
    expect(recordCleaningReworkProgress(declined.request, {
      vendorId: "vendor_01", actorUid: "partner_01", expectedRevision: 2, nextStatus: "in_progress", now,
    })).toMatchObject({ ok: false, error: "cleaning_rework_invalid_transition" });
    expect(validateCleaningReworkRequest({ ...declined.request, customerPhone: "01012345678" })).toBe(false);
  });
});
