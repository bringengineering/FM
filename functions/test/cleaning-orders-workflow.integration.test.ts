import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import type { CleaningOrderRecord } from "../src/cleaning-orders/contracts.js";
import { createCleaningOrderCore, transitionCleaningOrderCore } from "../src/cleaning-orders/runtime.js";
import { buildCleaningWallboardProjection } from "../src/cleaning-orders/wallboard-projection.js";

const require = createRequire(import.meta.url);
const workOrderCore = require("../../desktop-crm/src/work-order-core.js");
const workReportCore = require("../../desktop-crm/src/work-report-core.js");
const cleaningCenterUI = require("../../desktop-crm/src/cleaning-center-ui.js");

describe("synthetic CRM → field work/report → TV cleaning workflow", () => {
  it("keeps one canonical order ID through CRM work, report, and privacy-safe TV projection", async () => {
    const orderId = "7c2ac2d0-9a09-42f3-b8f8-7237562fc501";
    const customerId = "customer_demo_01";
    const buildingId = "building_demo_01";
    const actor = { uid: "staff_demo_01", role: "member" as const };
    let revision = 0;
    let clock = Date.parse("2026-09-26T04:00:00.000Z");
    const persisted = new Map<string, CleaningOrderRecord>();
    const linkedAssignments: unknown[] = [];
    const createDependencies = {
      now: () => new Date(clock).toISOString(),
      readCustomer: async (id: string) => ({ id, buildingIds: [buildingId] }),
      readBuilding: async (id: string) => ({ id }),
      createOrderIfAbsent: async (candidate: CleaningOrderRecord) => {
        const saved = persisted.get(candidate.id);
        if (saved) return { order: saved, created: false };
        persisted.set(candidate.id, candidate);
        return { order: candidate, created: true };
      },
    };

    const created = await createCleaningOrderCore({
      requestId: orderId,
      customerId,
      buildingId,
      serviceType: "stair_cleaning",
      title: "공용 계단 청소",
      desiredDate: "2026-09-26",
      description: "합성 데이터 검증 전용",
    }, actor, createDependencies);

    let order = created.order;
    for (const nextStatus of ["reviewing", "quote_pending", "approval_pending", "scheduled", "in_progress", "review_pending"] as const) {
      clock += 60_000;
      const result = await transitionCleaningOrderCore({
        requestId: `8c2ac2d0-9a09-42f3-b8f8-7237562fc50${++revision}`,
        orderId,
        expectedRevision: order.revision,
        nextStatus,
        note: "synthetic workflow step",
      }, actor, {
        now: () => new Date(clock).toISOString(),
        readOrder: async id => persisted.get(id) || null,
        readLinkedWorkOrders: async () => linkedAssignments,
        updateOrderIfRevision: async (id, expected, candidate) => {
          const current = persisted.get(id);
          if (!current || current.revision !== expected) return { order: current || null, updated: false };
          persisted.set(id, candidate);
          return { order: candidate, updated: true };
        },
      });
      order = result.order;
      if (nextStatus === "approval_pending") linkedAssignments.push(workOrderCore.normalizeOrder({
        id: "work_demo_01", title: "공용 계단 청소 지시", why: "접수 주문 이행",
        what: "계단·난간 청소 후 결과 등록", doneWhen: "전후 사진과 보고서 연결",
        cleaningOrderId: order.id, buildingId: order.buildingId,
        assigneeUid: actor.uid, status: "assigned", dueDate: "2026-09-26",
      }));
    }

    const stairChecklist = workReportCore.KINDS.find((kind: { key: string }) => kind.key === "stairs").items;
    const report = {
      id: "report_demo_01", kind: "stairs", title: "공용 계단 청소 결과",
      cleaningOrderId: order.id, buildingId: order.buildingId, workDate: "2026-09-26",
      updatedAt: new Date(clock).toISOString(),
      items: stairChecklist.map((item: { key: string; label: string }) => ({
        key: item.key, label: item.label, status: "done",
        before: [{ id: `${item.key}_before`, driveFileId: `${item.key}_before_file`, webViewLink: `https://drive.google.com/file/d/${item.key}_before_file/view` }],
        after: [{ id: `${item.key}_after`, driveFileId: `${item.key}_after_file`, webViewLink: `https://drive.google.com/file/d/${item.key}_after_file/view` }],
      })),
    };
    clock += 60_000;
    order = (await transitionCleaningOrderCore({
      requestId: `8c2ac2d0-9a09-42f3-b8f8-7237562fc50${++revision}`,
      orderId,
      expectedRevision: order.revision,
      nextStatus: "completed",
      note: "검수 완료",
    }, { uid: "admin_demo_01", role: "admin" }, {
      now: () => new Date(clock).toISOString(),
      readOrder: async id => persisted.get(id) || null,
      readCompletionReports: async () => [report],
      verifyCompletionPhotoFileIds: async fileIds => fileIds,
      updateOrderIfRevision: async (id, expected, candidate) => {
        const current = persisted.get(id);
        if (!current || current.revision !== expected) return { order: current || null, updated: false };
        persisted.set(id, candidate);
        return { order: candidate, updated: true };
      },
    })).order;

    const workOrder = workOrderCore.normalizeOrder({
      id: "work_demo_01", title: "공용 계단 청소 지시", why: "접수 주문 이행",
      what: "계단·난간 청소 후 결과 등록", doneWhen: "전후 사진과 보고서 연결",
      cleaningOrderId: order.id, buildingId: order.buildingId, assigneeUid: actor.uid,
      status: "done", progress: 100,
    });
    const normalizedReport = workReportCore.normalizeReport(report);
    const linkedWork = workOrderCore.forCleaningOrder([workOrder], order.id);
    const linkedReports = workReportCore.forCleaningOrder([normalizedReport], order.id);
    const centerMarkup = cleaningCenterUI.render({
      orders: [{ ...order, relatedWorkOrders: linkedWork, relatedReports: linkedReports }],
    });
    const projection = buildCleaningWallboardProjection(Object.fromEntries(persisted), new Date(clock + 60_000).toISOString());

    expect(created.replayed).toBe(false);
    expect(order).toMatchObject({ id: orderId, customerId, buildingId, status: "completed", revision: 8 });
    expect(linkedWork.map((item: { id: string; cleaningOrderId: string; buildingId: string }) => ({
      id: item.id,
      cleaningOrderId: item.cleaningOrderId,
      buildingId: item.buildingId,
    })))
      .toEqual([{ id: "work_demo_01", cleaningOrderId: orderId, buildingId }]);
    expect(linkedReports.map((item: { id: string; cleaningOrderId: string; buildingId: string }) => ({
      id: item.id,
      cleaningOrderId: item.cleaningOrderId,
      buildingId: item.buildingId,
    })))
      .toEqual([{ id: "report_demo_01", cleaningOrderId: orderId, buildingId }]);
    expect(centerMarkup).toContain("공용 계단 청소 지시");
    expect(centerMarkup).toContain("공용 계단 청소 결과");
    expect(projection).toMatchObject({ total: 1, open: 0, completed: 1, byStatus: { completed: 1 } });
    expect(JSON.stringify(projection)).not.toMatch(/customer_demo|building_demo|order_demo|staff_demo|report_demo|private|합성/u);
  });
});
