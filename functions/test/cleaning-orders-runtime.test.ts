import { describe, expect, it } from "vitest";
import {
  createCleaningOrderCore,
  transitionCleaningOrderCore,
} from "../src/cleaning-orders/runtime.js";
import type { CleaningOrderRecord } from "../src/cleaning-orders/contracts.js";

const input = {
  requestId: "7c2ac2d0-9a09-42f3-b8f8-7237562fc501",
  customerId: "customer_01",
  buildingId: "building_01",
  serviceType: "move_in_cleaning",
  title: "201호 입주청소",
  desiredDate: "2026-10-02",
  description: "입주 전 전체 청소",
};

function dependencies(overrides: Record<string, unknown> = {}) {
  let saved: CleaningOrderRecord | null = null;
  return {
    now: () => "2026-09-26T04:00:00.000Z",
    readCustomer: async (id: string) => ({ id, archivedAt: "", buildingIds: ["building_01"] }),
    readBuilding: async (id: string) => ({ id, archivedAt: "" }),
    createOrderIfAbsent: async (candidate: CleaningOrderRecord) => {
      if (saved) return { order: saved, created: false };
      saved = candidate;
      return { order: candidate, created: true };
    },
    getSaved: () => saved,
    ...overrides,
  };
}

describe("createCleaningOrderCore", () => {
  it("creates a revision-one order linked to active canonical customer and building IDs", async () => {
    const deps = dependencies();
    const result = await createCleaningOrderCore(input, { uid: "staff_uid_01", role: "member" }, deps);

    expect(result.replayed).toBe(false);
    expect(result.order).toMatchObject({
      id: input.requestId,
      customerId: input.customerId,
      buildingId: input.buildingId,
      status: "received",
      revision: 1,
      createdByUid: "staff_uid_01",
      updatedByUid: "staff_uid_01",
      history: [{ status: "received", changedByUid: "staff_uid_01" }],
    });
  });

  it("replays the same request without creating a second order", async () => {
    const deps = dependencies();
    const actor = { uid: "staff_uid_01", role: "member" as const };
    const first = await createCleaningOrderCore(input, actor, deps);
    const replay = await createCleaningOrderCore(input, actor, deps);

    expect(first.order.id).toBe(replay.order.id);
    expect(replay.replayed).toBe(true);
  });

  it("rejects reuse of a request ID with changed payload", async () => {
    const deps = dependencies();
    const actor = { uid: "staff_uid_01", role: "member" as const };
    await createCleaningOrderCore(input, actor, deps);

    await expect(createCleaningOrderCore({ ...input, title: "다른 주문" }, actor, deps))
      .rejects.toThrow("cleaning_order_request_conflict");
  });

  it("rejects missing or archived canonical records", async () => {
    await expect(createCleaningOrderCore(input, { uid: "staff_uid_01", role: "member" }, dependencies({
      readCustomer: async () => null,
    }))).rejects.toThrow("cleaning_order_customer_not_found");

    await expect(createCleaningOrderCore(input, { uid: "staff_uid_01", role: "member" }, dependencies({
      readBuilding: async (id: string) => ({ id, archivedAt: "2026-09-01T00:00:00.000Z" }),
    }))).rejects.toThrow("cleaning_order_building_not_found");
  });

  it("rejects an active building that is not linked to the selected customer", async () => {
    await expect(createCleaningOrderCore(input, { uid: "staff_uid_01", role: "member" }, dependencies({
      readCustomer: async (id: string) => ({ id, buildingIds: ["another_building"] }),
    }))).rejects.toThrow("cleaning_order_customer_building_mismatch");
  });

  it("accepts the canonical building owner relation", async () => {
    const deps = dependencies({ readCustomer: async (id: string) => ({ id }) });
    const ownerDeps = { ...deps, readBuilding: async (id: string) => ({ id, ownerCustomerId: input.customerId }) };
    const result = await createCleaningOrderCore(input, { uid: "staff_uid_01", role: "member" }, ownerDeps);
    expect(result.order.buildingId).toBe(input.buildingId);
  });

  it("rejects viewers and malformed actors before any reads or writes", async () => {
    const deps = dependencies({
      readCustomer: async () => { throw new Error("must_not_read"); },
    });
    await expect(createCleaningOrderCore(input, { uid: "viewer_01", role: "viewer" }, deps))
      .rejects.toThrow("cleaning_order_forbidden");
  });
});

describe("transitionCleaningOrderCore", () => {
  const started: CleaningOrderRecord = {
    requestId: input.requestId,
    id: input.requestId,
    customerId: input.customerId,
    buildingId: input.buildingId,
    serviceType: "move_in_cleaning",
    title: input.title,
    desiredDate: input.desiredDate,
    description: input.description,
    status: "received",
    revision: 1,
    createdAt: "2026-09-26T04:00:00.000Z",
    createdByUid: "staff_uid_01",
    updatedAt: "2026-09-26T04:00:00.000Z",
    updatedByUid: "staff_uid_01",
    history: [{ requestId: input.requestId, status: "received", changedAt: "2026-09-26T04:00:00.000Z", changedByUid: "staff_uid_01", note: "주문 접수" }],
  };

  function transitionDependencies() {
    let saved = structuredClone(started);
    return {
      now: () => "2026-09-26T05:00:00.000Z",
      readOrder: async () => structuredClone(saved),
      updateOrderIfRevision: async (_id: string, expectedRevision: number, candidate: CleaningOrderRecord) => {
        if (saved.revision !== expectedRevision) return { order: structuredClone(saved), updated: false };
        saved = candidate;
        return { order: structuredClone(saved), updated: true };
      },
      getSaved: () => structuredClone(saved),
    };
  }

  it("records an allowed transition with revision and actor audit metadata", async () => {
    const result = await transitionCleaningOrderCore({
      requestId: "1f803506-2f0c-4a11-98ea-1c52b891b1b1",
      orderId: started.id,
      expectedRevision: 1,
      nextStatus: "reviewing",
      note: "접수 내용 확인",
    }, { uid: "staff_uid_02", role: "member" }, transitionDependencies());

    expect(result.replayed).toBe(false);
    expect(result.order).toMatchObject({
      status: "reviewing",
      revision: 2,
      updatedByUid: "staff_uid_02",
      history: [{ status: "received" }, { requestId: "1f803506-2f0c-4a11-98ea-1c52b891b1b1", status: "reviewing", changedByUid: "staff_uid_02" }],
    });
  });

  it("rejects stale revisions and forbidden status changes", async () => {
    await expect(transitionCleaningOrderCore({
      requestId: "1f803506-2f0c-4a11-98ea-1c52b891b1b1",
      orderId: started.id,
      expectedRevision: 2,
      nextStatus: "reviewing",
      note: "",
    }, { uid: "staff_uid_02", role: "member" }, transitionDependencies()))
      .rejects.toThrow("cleaning_order_revision_conflict");

    await expect(transitionCleaningOrderCore({
      requestId: "1f803506-2f0c-4a11-98ea-1c52b891b1b1",
      orderId: started.id,
      expectedRevision: 1,
      nextStatus: "completed",
      note: "",
    }, { uid: "staff_uid_02", role: "member" }, transitionDependencies()))
      .rejects.toThrow("cleaning_order_transition_forbidden");
  });

  it("does not mark an order scheduled without a matching assigned CRM work order", async () => {
    const approvalPending: CleaningOrderRecord = {
      ...started,
      status: "approval_pending",
      revision: 4,
      updatedAt: "2026-09-26T04:30:00.000Z",
      history: [
        ...started.history,
        { requestId: "20000000-0000-4000-8000-000000000021", status: "reviewing", changedAt: "2026-09-26T04:10:00.000Z", changedByUid: "staff_uid_01", note: "요청 검토" },
        { requestId: "20000000-0000-4000-8000-000000000022", status: "quote_pending", changedAt: "2026-09-26T04:20:00.000Z", changedByUid: "staff_uid_01", note: "견적 확인" },
        { requestId: "20000000-0000-4000-8000-000000000023", status: "approval_pending", changedAt: "2026-09-26T04:30:00.000Z", changedByUid: "staff_uid_01", note: "승인 확인" },
      ],
    };
    let writes = 0;
    const deps = {
      now: () => "2026-09-26T05:00:00.000Z",
      readOrder: async () => structuredClone(approvalPending),
      readLinkedWorkOrders: async () => [],
      updateOrderIfRevision: async (_id: string, _revision: number, order: CleaningOrderRecord) => {
        writes += 1;
        return { order, updated: true };
      },
    };

    await expect(transitionCleaningOrderCore({
      requestId: "20000000-0000-4000-8000-000000000024",
      orderId: started.id,
      expectedRevision: 4,
      nextStatus: "scheduled",
      note: "일정 확정",
    }, { uid: "admin_uid_01", role: "admin" }, deps))
      .rejects.toThrow("cleaning_order_assignment_required");
    expect(writes).toBe(0);
  });

  it("schedules only after a linked CRM work order has an assignee and valid due date", async () => {
    const approvalPending: CleaningOrderRecord = {
      ...started,
      status: "approval_pending",
      revision: 4,
      updatedAt: "2026-09-26T04:30:00.000Z",
      history: [
        ...started.history,
        { requestId: "20000000-0000-4000-8000-000000000021", status: "reviewing", changedAt: "2026-09-26T04:10:00.000Z", changedByUid: "staff_uid_01", note: "요청 검토" },
        { requestId: "20000000-0000-4000-8000-000000000022", status: "quote_pending", changedAt: "2026-09-26T04:20:00.000Z", changedByUid: "staff_uid_01", note: "견적 확인" },
        { requestId: "20000000-0000-4000-8000-000000000023", status: "approval_pending", changedAt: "2026-09-26T04:30:00.000Z", changedByUid: "staff_uid_01", note: "승인 확인" },
      ],
    };
    const linkedWorkOrder = {
      id: "work_order_cleaning_01",
      cleaningOrderId: started.id,
      buildingId: started.buildingId,
      status: "assigned",
      assigneeUid: "staff_uid_02",
      dueDate: "2026-10-02",
    };
    const deps = {
      now: () => "2026-09-26T05:00:00.000Z",
      readOrder: async () => structuredClone(approvalPending),
      readLinkedWorkOrders: async () => [linkedWorkOrder],
      updateOrderIfRevision: async (_id: string, _revision: number, order: CleaningOrderRecord) => ({ order, updated: true }),
    };

    const result = await transitionCleaningOrderCore({
      requestId: "20000000-0000-4000-8000-000000000025",
      orderId: started.id,
      expectedRevision: 4,
      nextStatus: "scheduled",
      note: "일정 확정",
    }, { uid: "admin_uid_01", role: "admin" }, deps);

    expect(result.order).toMatchObject({ status: "scheduled", revision: 5 });
  });

  it("blocks administrator completion before writing when no validated order-linked report exists", async () => {
    const reviewPending = {
      ...started,
      status: "review_pending" as const,
      revision: 7,
      updatedAt: "2026-09-26T05:10:00.000Z",
      history: [
        ...started.history,
        { requestId: "20000000-0000-4000-8000-000000000001", status: "reviewing" as const, changedAt: "2026-09-26T04:10:00.000Z", changedByUid: "staff_uid_01", note: "검토" },
        { requestId: "20000000-0000-4000-8000-000000000002", status: "quote_pending" as const, changedAt: "2026-09-26T04:20:00.000Z", changedByUid: "staff_uid_01", note: "견적" },
        { requestId: "20000000-0000-4000-8000-000000000003", status: "approval_pending" as const, changedAt: "2026-09-26T04:30:00.000Z", changedByUid: "staff_uid_01", note: "승인" },
        { requestId: "20000000-0000-4000-8000-000000000004", status: "scheduled" as const, changedAt: "2026-09-26T04:40:00.000Z", changedByUid: "staff_uid_01", note: "일정" },
        { requestId: "20000000-0000-4000-8000-000000000005", status: "in_progress" as const, changedAt: "2026-09-26T05:00:00.000Z", changedByUid: "staff_uid_01", note: "작업 시작" },
        { requestId: "20000000-0000-4000-8000-000000000006", status: "review_pending" as const, changedAt: "2026-09-26T05:10:00.000Z", changedByUid: "staff_uid_01", note: "검수 요청" },
      ],
    } as CleaningOrderRecord;
    let saved = false;
    const deps = {
      now: () => "2026-09-26T06:00:00.000Z",
      readOrder: async () => structuredClone(reviewPending),
      readCompletionReports: async () => [],
      updateOrderIfRevision: async () => { saved = true; return { order: reviewPending, updated: true }; },
    };
    await expect(transitionCleaningOrderCore({
      requestId: "20000000-0000-4000-8000-000000000007",
      orderId: started.id,
      expectedRevision: reviewPending.revision,
      nextStatus: "completed",
      note: "검수 완료",
    }, { uid: "admin_uid_01", role: "admin" }, deps))
      .rejects.toThrow("cleaning_order_completion_evidence_required");
    expect(saved).toBe(false);
  });
});
