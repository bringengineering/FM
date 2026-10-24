import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import type { CleaningOrderRecord } from "../src/cleaning-orders/contracts.js";
import { collectCleaningOrderCompletionPhotoFileIds, validateCleaningOrderCompletionEvidence } from "../src/cleaning-orders/completion-evidence.js";

const require = createRequire(import.meta.url);
const workReportCore = require("../../desktop-crm/src/work-report-core.js");

const order: CleaningOrderRecord = {
  requestId: "7c2ac2d0-9a09-42f3-b8f8-7237562fc501",
  id: "7c2ac2d0-9a09-42f3-b8f8-7237562fc501",
  customerId: "customer_01",
  buildingId: "building_01",
  serviceType: "stair_cleaning",
  title: "계단 청소",
  desiredDate: "2026-09-26",
  description: "합성 테스트 주문",
  status: "review_pending",
  revision: 7,
  createdAt: "2026-09-26T04:00:00.000Z",
  createdByUid: "staff_01",
  updatedAt: "2026-09-26T05:10:00.000Z",
  updatedByUid: "staff_01",
  history: [
    { requestId: "10000000-0000-4000-8000-000000000001", status: "received", changedAt: "2026-09-26T04:00:00.000Z", changedByUid: "staff_01", note: "주문 접수" },
    { requestId: "10000000-0000-4000-8000-000000000002", status: "reviewing", changedAt: "2026-09-26T04:10:00.000Z", changedByUid: "staff_01", note: "검토" },
    { requestId: "10000000-0000-4000-8000-000000000003", status: "quote_pending", changedAt: "2026-09-26T04:20:00.000Z", changedByUid: "staff_01", note: "견적" },
    { requestId: "10000000-0000-4000-8000-000000000004", status: "approval_pending", changedAt: "2026-09-26T04:30:00.000Z", changedByUid: "staff_01", note: "승인" },
    { requestId: "10000000-0000-4000-8000-000000000005", status: "scheduled", changedAt: "2026-09-26T04:40:00.000Z", changedByUid: "staff_01", note: "일정" },
    { requestId: "10000000-0000-4000-8000-000000000006", status: "in_progress", changedAt: "2026-09-26T05:00:00.000Z", changedByUid: "staff_01", note: "작업 시작" },
    { requestId: "10000000-0000-4000-8000-000000000007", status: "review_pending", changedAt: "2026-09-26T05:10:00.000Z", changedByUid: "staff_01", note: "검수 요청" },
  ],
};

function readyReport(overrides: Record<string, unknown> = {}) {
  const kind = workReportCore.kindForCleaningServiceType(order.serviceType);
  const template = workReportCore.KINDS.find((item: { key: string }) => item.key === kind);
  return {
    id: "report_01",
    cleaningOrderId: order.id,
    buildingId: order.buildingId,
    kind,
    workDate: "2026-09-26",
    updatedAt: "2026-09-26T05:05:00.000Z",
    items: template.items.map((item: { key: string }) => ({
      key: item.key,
      status: "done",
      before: [{ id: `${item.key}_before`, driveFileId: `${item.key}_before_file`, webViewLink: `https://drive.google.com/file/d/${item.key}_before_file/view` }],
      after: [{ id: `${item.key}_after`, driveFileId: `${item.key}_after_file`, webViewLink: `https://drive.google.com/file/d/${item.key}_after_file/view` }],
    })),
    ...overrides,
  };
}

function validate(orderValue: CleaningOrderRecord, reports: unknown, verified?: ReadonlySet<string>) {
  const candidates = collectCleaningOrderCompletionPhotoFileIds(orderValue.id, reports);
  return validateCleaningOrderCompletionEvidence(orderValue, reports, verified ?? new Set(candidates || []));
}

describe("validateCleaningOrderCompletionEvidence", () => {
  it("accepts a current, same-order report with the service checklist and before/after evidence", () => {
    expect(validate(order, [readyReport()]))
      .toEqual({ ok: true, reportId: "report_01" });
  });

  it("rejects completion without an order-linked result report", () => {
    expect(validate(order, []))
      .toEqual({ ok: false, error: "cleaning_order_completion_evidence_required" });
  });

  it("requires each completion photo to have an openable Google Drive view link", () => {
    const report = readyReport() as ReturnType<typeof readyReport>;
    const items = report.items as Array<Record<string, unknown>>;
    const first = items[0] as Record<string, unknown>;
    const before = first.before as Array<Record<string, unknown>>;
    expect(validate(order, [readyReport({
      items: [{ ...first, before: [{ ...before[0], webViewLink: "" }] }, ...items.slice(1)],
    })])).toMatchObject({ ok: false, error: "cleaning_order_completion_evidence_required" });
    expect(validate(order, [readyReport({
      items: [{ ...first, before: [{ ...before[0], webViewLink: "https://attacker.example/photo" }] }, ...items.slice(1)],
    })])).toMatchObject({ ok: false, error: "cleaning_order_completion_evidence_required" });
  });

  it("rejects plausible-looking Drive links unless the server verified the referenced image files", () => {
    expect(validate(order, [readyReport()], new Set()))
      .toMatchObject({ ok: false, error: "cleaning_order_completion_evidence_required" });
  });

  it("requires each stored Drive view link to point to the same verified file ID", () => {
    const report = readyReport() as ReturnType<typeof readyReport>;
    const items = report.items as Array<Record<string, unknown>>;
    const first = items[0] as Record<string, unknown>;
    const before = first.before as Array<Record<string, unknown>>;
    const mismatched = readyReport({
      items: [{
        ...first,
        before: [{ ...before[0], webViewLink: "https://drive.google.com/file/d/unrelated_photo_01/view" }],
      }, ...items.slice(1)],
    });
    expect(validate(order, [mismatched]))
      .toMatchObject({ ok: false, error: "cleaning_order_completion_evidence_required" });
  });

  it("does not allow one verified image to stand in for both before and after evidence", () => {
    const report = readyReport() as ReturnType<typeof readyReport>;
    const items = report.items as Array<Record<string, unknown>>;
    const first = items[0] as Record<string, unknown>;
    const before = first.before as Array<Record<string, unknown>>;
    const after = first.after as Array<Record<string, unknown>>;
    expect(validate(order, [readyReport({
      items: [{ ...first, after: [{ ...after[0], driveFileId: before[0].driveFileId, webViewLink: before[0].webViewLink }] }, ...items.slice(1)],
    })])).toMatchObject({ ok: false, error: "cleaning_order_completion_evidence_required" });
  });

  it("rejects reports linked to another building or service template", () => {
    expect(validate(order, [readyReport({ buildingId: "building_other" })]))
      .toMatchObject({ ok: false, error: "cleaning_order_completion_evidence_required" });
    expect(validate(order, [readyReport({ kind: "moveIn" })]))
      .toMatchObject({ ok: false, error: "cleaning_order_completion_evidence_required" });
  });

  it("requires all required checklist rows, both photos for completed rows, and a reason for skipped rows", () => {
    const report = readyReport() as ReturnType<typeof readyReport>;
    const items = report.items as Array<Record<string, unknown>>;
    expect(validate(order, [readyReport({ items: items.slice(1) })]))
      .toMatchObject({ ok: false, error: "cleaning_order_completion_evidence_required" });
    expect(validate(order, [readyReport({ items: [{ ...items[0], after: [] }, ...items.slice(1)] })]))
      .toMatchObject({ ok: false, error: "cleaning_order_completion_evidence_required" });
    expect(validate(order, [readyReport({ items: items.map(item => ({ ...item, status: "skipped", note: "" })) })]))
      .toMatchObject({ ok: false, error: "cleaning_order_completion_evidence_required" });
  });

  it("does not allow evidence from before the latest work attempt to complete a revised order", () => {
    const revisedOrder = {
      ...order,
      history: [...order.history, {
        requestId: "10000000-0000-4000-8000-000000000008",
        status: "revision_requested" as const,
        changedAt: "2026-09-26T05:20:00.000Z",
        changedByUid: "admin_01",
        note: "보완 필요",
      }, {
        requestId: "10000000-0000-4000-8000-000000000009",
        status: "in_progress" as const,
        changedAt: "2026-09-26T05:30:00.000Z",
        changedByUid: "staff_01",
        note: "보완 작업 시작",
      }],
    } as CleaningOrderRecord;
    expect(validate(revisedOrder, [readyReport()]))
      .toMatchObject({ ok: false, error: "cleaning_order_completion_evidence_required" });
    expect(validate(revisedOrder, [readyReport({ updatedAt: "2026-09-26T05:35:00.000Z" })]))
      .toMatchObject({ ok: true, reportId: "report_01" });
  });

  it("keeps the server service-to-checklist mapping aligned with the existing CRM report templates", () => {
    const serviceToKind: Record<string, string> = {
      move_in_cleaning: "moveIn",
      move_out_cleaning: "moveOut",
      common_cleaning: "common",
      stair_cleaning: "stairs",
      other: "general",
    };
    for (const [serviceType, kind] of Object.entries(serviceToKind)) {
      const template = workReportCore.KINDS.find((item: { key: string }) => item.key === kind);
      expect(validate(
        { ...order, serviceType } as CleaningOrderRecord,
        [readyReport({ kind, items: template.items.map((item: { key: string }) => ({
          key: item.key,
          status: "done",
          before: [{ id: `${item.key}_before`, driveFileId: `${item.key}_before_file`, webViewLink: `https://drive.google.com/file/d/${item.key}_before_file/view` }],
          after: [{ id: `${item.key}_after`, driveFileId: `${item.key}_after_file`, webViewLink: `https://drive.google.com/file/d/${item.key}_after_file/view` }],
        })) })],
      )).toMatchObject({ ok: true });
    }
  });
});
