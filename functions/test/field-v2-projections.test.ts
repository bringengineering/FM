import { describe, expect, it } from "vitest";

import {
  buildCrmFieldSummary,
  buildOperatorProjection,
  buildTeamActiveProjection,
  buildUnassignedProjection,
  calculateFieldKpis,
} from "../src/field-v2/projections.js";
import type { FieldWorkItem } from "../src/field-v2/work-items.js";

function workItem(overrides: Partial<FieldWorkItem> = {}): FieldWorkItem {
  return {
    id: "job_1",
    visitId: "visit_1",
    jobType: "vacancy_capture",
    jobPolicyVersion: "FIELD_V2_VACANCY_CAPTURE",
    checklistId: "VACANCY_CAPTURE_V1",
    crmSalesProspectId: "prospect_1",
    crmSalesUnitId: "sales_unit_1",
    assignedOperatorId: "operator_kim",
    dueDate: "2026-08-15",
    priority: "normal",
    workflowStatus: "assigned",
    uploadStatus: "none",
    sourceSnapshot: {
      parentType: "salesProspect",
      parentId: "prospect_1",
      parentName: "상지 원룸",
      address: "강원 원주시 상지대길 1",
      unitType: "salesUnit",
      unitId: "sales_unit_1",
      unitLabel: "101호",
      depositWon: 3_000_000,
      monthlyRentWon: 350_000,
      maintenanceFeeWon: 50_000,
    },
    sourceVersion: {
      parentUpdatedAt: "2026-08-14T01:00:00.000Z",
      unitUpdatedAt: "2026-08-14T01:30:00.000Z",
    },
    sourceHash: "a".repeat(64),
    mediaCount: 0,
    uploadFailureCount: 0,
    adminActionRequired: false,
    createdAt: "2026-08-14T02:00:00.000Z",
    createdByAuthUid: "shared_uid",
    createdByOperatorId: "operator_kim",
    updatedAt: "2026-08-14T02:00:00.000Z",
    updatedByAuthUid: "shared_uid",
    updatedByOperatorId: "operator_kim",
    archivedAt: null,
    ...overrides,
  };
}

describe("FIELD v2 deterministic projections", () => {
  it("calculates Seoul-calendar KPIs with unique visits and accepted capture work", () => {
    const items = [
      workItem({ id: "today_a", visitId: "visit_same", dueDate: "2026-08-15", workflowStatus: "accepted" }),
      workItem({ id: "today_b", visitId: "visit_same", dueDate: "2026-08-15", workflowStatus: "in_progress", jobType: "complaint_check" }),
      workItem({ id: "late", visitId: "visit_late", dueDate: "2026-08-14", workflowStatus: "review_pending", uploadStatus: "failed", assignedOperatorId: null, adminActionRequired: true }),
      workItem({ id: "done", visitId: "visit_done", dueDate: "2026-08-15", workflowStatus: "completed", uploadStatus: "failed", assignedOperatorId: null, adminActionRequired: true }),
      workItem({ id: "cancelled", visitId: "visit_cancelled", dueDate: "2026-08-14", workflowStatus: "cancelled", uploadStatus: "partial_failure", assignedOperatorId: null, adminActionRequired: true }),
      workItem({ id: "archived", visitId: "visit_archived", dueDate: "2026-08-14", archivedAt: "2026-08-14T09:00:00.000Z", uploadStatus: "failed", assignedOperatorId: null, adminActionRequired: true }),
    ];

    expect(calculateFieldKpis(items, new Date("2026-08-14T15:05:00.000Z"))).toEqual({
      todayVisits: 1,
      capturePending: 2,
      uploadFailures: 1,
      reviewPending: 1,
      unassigned: 1,
      overdue: 1,
      adminActionRequired: 1,
    });
  });

  it("uses Asia/Seoul midnight instead of the host timezone", () => {
    expect(calculateFieldKpis([
      workItem({ dueDate: "2026-08-15" }),
    ], new Date("2026-08-14T15:00:00.000Z")).todayVisits).toBe(1);
  });

  it("counts only job policies with unconditional photo capture in capturePending", () => {
    const jobTypes = [
      "vacancy_capture",
      "move_out_check",
      "cleaning_before_after",
      "maintenance_inspection",
      "complaint_check",
      "repair_before_after",
    ] as const;
    const items = jobTypes.map((jobType, index) => workItem({
      id: `job_${index}`,
      visitId: `visit_${index}`,
      jobType,
      workflowStatus: "accepted",
    }));
    expect(calculateFieldKpis(items, new Date("2026-08-14T15:00:00.000Z")))
      .toMatchObject({ capturePending: 4 });
  });

  it.each([new Date("invalid"), null, undefined])(
    "returns a stable domain error for invalid now %p",
    (now) => {
      expect(() => calculateFieldKpis([], now as Date)).toThrow("field_kpi_now_invalid");
    },
  );

  it("builds frozen minimum projections without leaking source lease terms or audit identity", () => {
    const item = workItem({
      secretDoorCode: "1234" as never,
      internalMemo: "do not expose" as never,
    });
    const before = structuredClone(item);

    const operator = buildOperatorProjection(item);
    const summary = buildCrmFieldSummary(item);

    expect(operator).toEqual({
      fieldJobId: "job_1",
      visitId: "visit_1",
      jobType: "vacancy_capture",
      parentName: "상지 원룸",
      address: "강원 원주시 상지대길 1",
      unitLabel: "101호",
      assignedOperatorId: "operator_kim",
      dueDate: "2026-08-15",
      priority: "normal",
      workflowStatus: "assigned",
      uploadStatus: "none",
      mediaCount: 0,
      uploadFailureCount: 0,
      adminActionRequired: false,
      updatedAt: "2026-08-14T02:00:00.000Z",
    });
    expect(summary).toEqual({
      fieldJobId: "job_1",
      crmSalesProspectId: "prospect_1",
      crmSalesUnitId: "sales_unit_1",
      jobType: "vacancy_capture",
      assignedOperatorId: "operator_kim",
      dueDate: "2026-08-15",
      workflowStatus: "assigned",
      mediaCount: 0,
      uploadFailureCount: 0,
      reviewStatus: "not_started",
      adPackageId: null,
      updatedAt: "2026-08-14T02:00:00.000Z",
    });
    expect(operator).not.toHaveProperty("depositWon");
    expect(operator).not.toHaveProperty("secretDoorCode");
    expect(summary).not.toHaveProperty("address");
    expect(Object.isFrozen(operator)).toBe(true);
    expect(Object.isFrozen(summary)).toBe(true);
    expect(item).toEqual(before);
  });

  it("emits an unassigned projection only for an active unassigned item", () => {
    const item = workItem({ assignedOperatorId: null });
    const projection = buildUnassignedProjection(item);
    expect(projection).toMatchObject({ fieldJobId: "job_1", assignedOperatorId: null });
    expect(Object.isFrozen(projection)).toBe(true);
    expect(buildUnassignedProjection(workItem())).toBeNull();
    expect(buildUnassignedProjection(workItem({ assignedOperatorId: null, workflowStatus: "completed" }))).toBeNull();
    expect(buildUnassignedProjection(workItem({ assignedOperatorId: null, archivedAt: "2026-08-14T03:00:00.000Z" }))).toBeNull();
  });

  it("builds a deterministic ordered team projection only for active work", () => {
    const projection = buildTeamActiveProjection(workItem({ priority: "urgent" }));
    expect(projection).toMatchObject({
      fieldJobId: "job_1",
      activeOrderKey: "2026-08-15|0|2026-08-14T02:00:00.000Z|job_1",
    });
    expect(Object.isFrozen(projection)).toBe(true);
    expect(buildTeamActiveProjection(workItem({ workflowStatus: "completed" }))).toBeNull();
    expect(buildTeamActiveProjection(workItem({ archivedAt: "2026-08-14T03:00:00.000Z" }))).toBeNull();
  });
});
