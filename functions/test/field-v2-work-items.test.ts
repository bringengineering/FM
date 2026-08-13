import { describe, expect, it, vi } from "vitest";

import type { FieldV2Actor } from "../src/field-v2/contracts.js";
import {
  assignFieldJobCore,
  changeFieldVisitCore,
  claimFieldJobCore,
  createFieldJobsCore,
  listFieldOperationsWorkspaceCore,
  transitionFieldJobCore,
  type CreateFieldJobsInput,
  type FieldVisit,
  type FieldWorkItem,
  type WorkItemDependencies,
} from "../src/field-v2/work-items.js";

const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";
const ACTOR: FieldV2Actor = {
  authUid: "shared_uid",
  operatorId: "operator_kim",
  displayName: "김현진",
  role: "member",
};

const BASE_INPUT: CreateFieldJobsInput = {
  requestId: REQUEST_ID,
  operatorId: "operator_kim",
  jobType: "vacancy_capture",
  crmSalesProspectId: "prospect_1",
  crmSalesUnitIds: ["sales_unit_1", "sales_unit_2"],
  dueDate: "2026-08-15",
  priority: "high",
  assignedOperatorId: null,
};

function baseItem(overrides: Partial<FieldWorkItem> = {}): FieldWorkItem {
  return {
    id: "job_1",
    visitId: "visit_1",
    jobType: "vacancy_capture",
    jobPolicyVersion: "FIELD_V2_VACANCY_CAPTURE",
    checklistId: "VACANCY_CAPTURE_V1",
    crmSalesProspectId: "prospect_1",
    crmSalesUnitId: "sales_unit_1",
    assignedOperatorId: null,
    dueDate: "2026-08-15",
    priority: "normal",
    workflowStatus: "requested",
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

function baseVisit(overrides: Partial<FieldVisit> = {}): FieldVisit {
  return {
    id: "visit_1",
    crmSalesProspectId: "prospect_1",
    workItemIds: ["job_1"],
    assignedOperatorId: null,
    dueDate: "2026-08-15",
    priority: "normal",
    accessPreparationStatus: "unknown",
    sharedMediaIds: [],
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

function deps(): WorkItemDependencies & Record<string, ReturnType<typeof vi.fn>> {
  return {
    now: vi.fn(() => "2026-08-14T02:00:00.000Z"),
    readCrmBuilding: vi.fn(async () => null),
    readCrmSalesProspect: vi.fn(async (id: string) => id === "prospect_1" ? {
      id,
      name: "상지 원룸",
      address: "강원 원주시 상지대길 1",
      updatedAt: "2026-08-14T01:00:00.000Z",
      archivedAt: null,
    } : null),
    readCrmBuildingUnit: vi.fn(async () => null),
    readCrmSalesUnit: vi.fn(async (id: string) => ({
      id,
      crmSalesProspectId: "prospect_1",
      label: id === "sales_unit_1" ? "101호" : "102호",
      deposit: 3_000_000,
      rent: 350_000,
      maintenanceFee: 50_000,
      moveOutAt: "2026-09-01",
      updatedAt: id === "sales_unit_1"
        ? "2026-08-14T01:30:00.000Z"
        : "2026-08-14T01:31:00.000Z",
      archivedAt: null,
    })),
    readOperator: vi.fn(async (id: string) => ({ id, active: true, displayName: "팀원" })),
    commitCreation: vi.fn(async (command: unknown) => ({ kind: "created", result: (command as { result: unknown }).result })),
    transactWork: vi.fn(),
    readWorkspace: vi.fn(async () => ({ items: [] })),
  } as never;
}

function transactionDeps(state: {
  item: FieldWorkItem;
  visit: FieldVisit;
  visitItems?: FieldWorkItem[];
}): WorkItemDependencies & Record<string, ReturnType<typeof vi.fn>> {
  const dependencies = deps();
  dependencies.transactWork.mockImplementation(async (_selector: unknown, decide: (value: unknown) => { errorCode?: string; result?: unknown }) => {
    const decision = decide({
      workItem: structuredClone(state.item),
      visit: structuredClone(state.visit),
      visitWorkItems: structuredClone(state.visitItems ?? [state.item]),
    });
    if (decision.errorCode) throw new Error(decision.errorCode);
    return decision.result;
  });
  return dependencies;
}

describe("FIELD v2 CRM-backed work creation", () => {
  it("creates one visit and independent work items for every validated sales unit", async () => {
    const dependencies = deps();
    const result = await createFieldJobsCore(BASE_INPUT, ACTOR, dependencies);

    expect(result.repeated).toBe(false);
    expect(result.jobIds).toHaveLength(2);
    const command = dependencies.commitCreation.mock.calls[0][0];
    expect(command.receiptPath).toBe(`fieldPlatform/v2/requestReceipts/createFieldJobs/${REQUEST_ID}`);
    expect(command.requestHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(command.patch[`fieldPlatform/v2/visits/${result.visitId}`]).toMatchObject({
      workItemIds: result.jobIds,
      crmSalesProspectId: "prospect_1",
      assignedOperatorId: null,
      sharedMediaIds: [],
    });
    expect(command.patch[`fieldPlatform/v2/workItems/${result.jobIds[0]}`]).toMatchObject({
      crmSalesUnitId: "sales_unit_1",
      workflowStatus: "requested",
      checklistId: "VACANCY_CAPTURE_V1",
    });
    expect(command.patch[`fieldPlatform/v2/workItems/${result.jobIds[1]}`]).toMatchObject({
      crmSalesUnitId: "sales_unit_2",
    });
    expect(command.patch[`fieldPlatform/v2/workItems/${result.jobIds[0]}`].sourceSnapshot)
      .not.toHaveProperty("availableFrom");
    expect(Object.keys(command.patch)).toEqual(expect.arrayContaining([
      `fieldPlatform/v2/projections/unassigned/${result.jobIds[0]}`,
      `fieldPlatform/v2/projections/unassigned/${result.jobIds[1]}`,
      `crmCompany/fieldSummaries/${result.jobIds[0]}`,
      `crmCompany/fieldSummaries/${result.jobIds[1]}`,
    ]));
    expect(Object.keys(command.patch).filter((path) => path.includes("auditLogs/"))).toHaveLength(3);
    expect(Object.keys(command.patch)).not.toContain(expect.stringContaining("fieldPlatform/buildings"));
  });

  it("creates one building-level work item when no unit array is supplied", async () => {
    const dependencies = deps();
    dependencies.readCrmBuilding.mockResolvedValue({
      id: "building_1",
      name: "브링빌",
      address: "강원 원주시 중앙로 1",
      updatedAt: "2026-08-14T01:00:00.000Z",
      archivedAt: null,
    });
    const result = await createFieldJobsCore({
      requestId: REQUEST_ID,
      operatorId: "operator_kim",
      jobType: "maintenance_inspection",
      crmBuildingId: "building_1",
      dueDate: "2026-08-15",
      priority: "normal",
      assignedOperatorId: "operator_hwang",
    }, ACTOR, dependencies);
    expect(result.jobIds).toHaveLength(1);
    expect(dependencies.readOperator).toHaveBeenCalledWith("operator_hwang");
  });

  it("uses a race-safe exact receipt and never writes again for same-hash replay", async () => {
    const dependencies = deps();
    const stored = { visitId: "visit_existing", jobIds: ["job_existing"] };
    dependencies.commitCreation.mockResolvedValue({ kind: "replayed", result: stored });

    await expect(createFieldJobsCore(BASE_INPUT, ACTOR, dependencies)).resolves.toEqual({
      ...stored,
      repeated: true,
    });
    expect(dependencies.commitCreation).toHaveBeenCalledTimes(1);
  });

  it("rejects an atomic same-request/different-hash conflict", async () => {
    const dependencies = deps();
    dependencies.commitCreation.mockResolvedValue({ kind: "conflict" });
    await expect(createFieldJobsCore(BASE_INPUT, ACTOR, dependencies))
      .rejects.toThrow("field_request_id_conflict");
  });

  it.each([
    ["no parent", { crmSalesProspectId: undefined }],
    ["two parents", { crmBuildingId: "building_1" }],
    ["duplicate unit ids", { crmSalesUnitIds: ["sales_unit_1", "sales_unit_1"] }],
    ["both unit arrays", { crmBuildingUnitIds: ["unit_1"] }],
    ["invalid date", { dueDate: "2026-02-30" }],
    ["invalid request id", { requestId: "not-a-uuid" }],
    ["spoofed operator", { operatorId: "operator_hwang" }],
    ["unverified workflow case", { crmWorkflowCaseId: "case_1" }],
    ["unverified CRM task", { crmTaskId: "task_1" }],
  ])("rejects %s", async (_label, overrides) => {
    await expect(createFieldJobsCore({ ...BASE_INPUT, ...overrides }, ACTOR, deps()))
      .rejects.toThrow();
  });

  it("validates archived and exact parent relations without inferring by address", async () => {
    const archived = deps();
    archived.readCrmSalesProspect.mockResolvedValue({
      id: "prospect_1",
      name: "상지 원룸",
      address: "같은 주소",
      updatedAt: "2026-08-14T01:00:00.000Z",
      archivedAt: "2026-08-14T01:10:00.000Z",
    });
    await expect(createFieldJobsCore(BASE_INPUT, ACTOR, archived))
      .rejects.toThrow("field_crm_reference_archived");

    const mismatch = deps();
    mismatch.readCrmSalesUnit.mockResolvedValue({
      id: "sales_unit_1",
      crmSalesProspectId: "prospect_other",
      label: "101호",
      deposit: 1,
      rent: 1,
      maintenanceFee: 1,
      updatedAt: "2026-08-14T01:00:00.000Z",
      archivedAt: null,
    });
    await expect(createFieldJobsCore({ ...BASE_INPUT, crmSalesUnitIds: ["sales_unit_1"] }, ACTOR, mismatch))
      .rejects.toThrow("field_crm_reference_mismatch");
  });

  it("accepts current CRM active empty archive markers and canonical prospectId", async () => {
    const dependencies = deps();
    dependencies.readCrmSalesProspect.mockResolvedValue({
      id: "prospect_1",
      name: "상지 원룸",
      address: "강원 원주시 상지대길 1",
      updatedAt: "2026-08-14T01:00:00.000Z",
      archivedAt: "",
    });
    dependencies.readCrmSalesUnit.mockResolvedValue({
      id: "sales_unit_1",
      prospectId: "prospect_1",
      label: "101호",
      deposit: 3_000_000,
      rent: 350_000,
      maintenanceFee: 50_000,
      moveOutAt: "2026-09-01",
      updatedAt: "2026-08-14T01:30:00.000Z",
      archivedAt: "",
    });
    await expect(createFieldJobsCore({
      ...BASE_INPUT,
      crmSalesUnitIds: ["sales_unit_1"],
    }, ACTOR, dependencies)).resolves.toMatchObject({ repeated: false });
    const command = dependencies.commitCreation.mock.calls[0][0];
    expect(command.sourceExpectations).toContainEqual({
      path: "crmCompany/data/salesUnits/sales_unit_1",
      id: "sales_unit_1",
      updatedAt: "2026-08-14T01:30:00.000Z",
      parentField: "prospectId",
      parentId: "prospect_1",
    });
    expect(command.patch[`fieldPlatform/v2/workItems/${command.result.jobIds[0]}`].sourceSnapshot)
      .not.toHaveProperty("availableFrom");
  });
});

describe("FIELD v2 workspace reads", () => {
  it("propagates a workspace query failure instead of reporting zero KPIs", async () => {
    const dependencies = deps();
    dependencies.readWorkspace.mockRejectedValue(new Error("network"));
    await expect(listFieldOperationsWorkspaceCore(ACTOR, dependencies))
      .rejects.toMatchObject({
        name: "FieldV2Error",
        code: "field_workspace_unavailable",
      });
  });
});

describe("FIELD v2 atomic claim, assignment, visit changes, and transitions", () => {
  it("lets only the transaction winner claim an unassigned job", async () => {
    const dependencies = transactionDeps({ item: baseItem(), visit: baseVisit() });
    const first = await claimFieldJobCore({ requestId: REQUEST_ID, operatorId: "operator_kim", jobId: "job_1" }, ACTOR, dependencies);
    expect(first).toMatchObject({ assignedOperatorId: "operator_kim", workflowStatus: "assigned" });

    dependencies.transactWork.mockRejectedValueOnce(new Error("field_job_already_claimed"));
    await expect(claimFieldJobCore({ requestId: REQUEST_ID, operatorId: "operator_kim", jobId: "job_1" }, ACTOR, dependencies))
      .rejects.toThrow("field_job_already_claimed");
  });

  it("returns an exact old receipt result without asking the adapter to rewrite newer state", async () => {
    const oldAssigned = baseItem({
      assignedOperatorId: "operator_kim",
      workflowStatus: "assigned",
    });
    const newerAccepted = baseItem({
      assignedOperatorId: "operator_kim",
      workflowStatus: "accepted",
      acceptedAt: "2026-08-14T02:05:00.000Z",
      updatedAt: "2026-08-14T02:05:00.000Z",
    });
    const dependencies = deps();
    dependencies.transactWork.mockImplementation(async (_selector: unknown, decide: (value: unknown) => { replay?: boolean; result?: unknown; patch?: unknown }) => {
      const decision = decide({
        workItem: newerAccepted,
        visit: baseVisit({ assignedOperatorId: "operator_kim" }),
        visitWorkItems: [newerAccepted],
        receipt: {
          scope: "claimFieldJob",
          requestId: REQUEST_ID,
          // Hash is deliberately supplied from the selector so this is exact replay A.
          requestHash: (_selector as { requestHash: string }).requestHash,
          result: oldAssigned,
          completedAt: "2026-08-14T02:00:00.000Z",
        },
      });
      expect(decision).toEqual({ replay: true, result: oldAssigned });
      expect(decision).not.toHaveProperty("patch");
      return decision.result;
    });

    await expect(claimFieldJobCore({
      requestId: REQUEST_ID,
      operatorId: "operator_kim",
      jobId: "job_1",
    }, ACTOR, dependencies)).resolves.toEqual(oldAssigned);
  });

  it("splits one claimed item from a multi-item visit without copying shared media", async () => {
    const first = baseItem();
    const second = baseItem({ id: "job_2", crmSalesUnitId: "sales_unit_2" });
    const dependencies = transactionDeps({
      item: first,
      visit: baseVisit({ workItemIds: ["job_1", "job_2"], sharedMediaIds: ["media_common"] }),
      visitItems: [first, second],
    });
    const result = await claimFieldJobCore({ requestId: REQUEST_ID, operatorId: "operator_kim", jobId: "job_1" }, ACTOR, dependencies);
    expect(result.visitId).not.toBe("visit_1");
    const decision = dependencies.transactWork.mock.calls[0][1](
      { workItem: first, visit: baseVisit({ workItemIds: ["job_1", "job_2"], sharedMediaIds: ["media_common"] }), visitWorkItems: [first, second] },
    );
    const splitVisit = decision.patch[`fieldPlatform/v2/visits/${result.visitId}`];
    expect(splitVisit.sharedMediaIds).toEqual([]);
    expect(splitVisit).not.toEqual(expect.objectContaining({ sharedMediaIds: ["media_common"] }));
  });

  it("updates every not-started child for a whole-visit change and requires a reason", async () => {
    const first = baseItem({ workflowStatus: "accepted", assignedOperatorId: "operator_kim" });
    const second = baseItem({ id: "job_2", workflowStatus: "assigned", assignedOperatorId: "operator_kim" });
    const dependencies = transactionDeps({
      item: first,
      visit: baseVisit({ workItemIds: ["job_1", "job_2"], assignedOperatorId: "operator_kim" }),
      visitItems: [first, second],
    });
    const changed = await changeFieldVisitCore({
      requestId: REQUEST_ID,
      operatorId: "operator_kim",
      visitId: "visit_1",
      dueDate: "2026-08-16",
      assignedOperatorId: "operator_hwang",
      reason: "황우중 일정에 맞춤",
    }, ACTOR, dependencies);
    expect(changed.updatedJobIds).toEqual(["job_1", "job_2"]);

    await expect(changeFieldVisitCore({
      requestId: REQUEST_ID,
      operatorId: "operator_kim",
      visitId: "visit_1",
      dueDate: "2026-08-16",
      reason: "",
    }, ACTOR, dependencies)).rejects.toThrow("field_change_reason_required");
  });

  it("does not split a started child away from media already owned by its visit", async () => {
    const started = baseItem({ workflowStatus: "in_progress", assignedOperatorId: "operator_kim" });
    const pending = baseItem({ id: "job_2", crmSalesUnitId: "sales_unit_2", assignedOperatorId: "operator_kim" });
    const dependencies = transactionDeps({
      item: started,
      visit: baseVisit({
        workItemIds: ["job_1", "job_2"],
        assignedOperatorId: "operator_kim",
        sharedMediaIds: ["media_common"],
      }),
      visitItems: [started, pending],
    });

    await expect(changeFieldVisitCore({
      requestId: REQUEST_ID,
      operatorId: "operator_kim",
      visitId: "visit_1",
      jobId: "job_1",
      dueDate: "2026-08-16",
      reason: "started work keeps its original visit",
    }, ACTOR, dependencies)).rejects.toThrow("field_started_job_change_forbidden");
  });

  it("denies silent reassignment of started work", async () => {
    const dependencies = transactionDeps({
      item: baseItem({ workflowStatus: "in_progress", assignedOperatorId: "operator_kim" }),
      visit: baseVisit({ assignedOperatorId: "operator_kim" }),
    });
    await expect(assignFieldJobCore({
      requestId: REQUEST_ID,
      operatorId: "operator_kim",
      jobId: "job_1",
      assignedOperatorId: "operator_hwang",
      reason: "",
    }, ACTOR, dependencies)).rejects.toThrow("field_change_reason_required");
  });

  it("blocks review decisions from the generic transition API", async () => {
    const dependencies = transactionDeps({
      item: baseItem({ workflowStatus: "review_pending", assignedOperatorId: "operator_kim" }),
      visit: baseVisit({ assignedOperatorId: "operator_kim" }),
    });
    await expect(transitionFieldJobCore({
      requestId: REQUEST_ID,
      operatorId: "operator_kim",
      jobId: "job_1",
      toStatus: "approved",
    }, ACTOR, dependencies)).rejects.toThrow("field_review_action_required");
    await expect(transitionFieldJobCore({
      requestId: REQUEST_ID,
      operatorId: "operator_kim",
      jobId: "job_1",
      toStatus: "changes_requested",
    }, ACTOR, dependencies)).rejects.toThrow("field_review_action_required");
  });

  it("passes the maintenance outcome to the authoritative transition policy", async () => {
    const item = baseItem({
      jobType: "maintenance_inspection",
      jobPolicyVersion: "FIELD_V2_MAINTENANCE_INSPECTION",
      checklistId: "MAINTENANCE_INSPECTION_V1",
      workflowStatus: "evidence_ready",
      assignedOperatorId: "operator_kim",
    });
    const dependencies = transactionDeps({ item, visit: baseVisit({ assignedOperatorId: "operator_kim" }) });
    await expect(transitionFieldJobCore({
      requestId: REQUEST_ID,
      operatorId: "operator_kim",
      jobId: "job_1",
      toStatus: "completed",
      inspectionOutcome: "issue_found",
    }, ACTOR, dependencies)).rejects.toThrow("field_inspection_outcome_invalid");

    await expect(transitionFieldJobCore({
      requestId: REQUEST_ID,
      operatorId: "operator_kim",
      jobId: "job_1",
      toStatus: "completed",
      inspectionOutcome: "no_issue",
    }, ACTOR, dependencies)).resolves.toMatchObject({ workflowStatus: "completed" });
  });

  it("requires a reason for cancellation and preserves immutable creation audit fields", async () => {
    const item = baseItem({ workflowStatus: "assigned", assignedOperatorId: "operator_kim" });
    const dependencies = transactionDeps({ item, visit: baseVisit({ assignedOperatorId: "operator_kim" }) });
    await expect(transitionFieldJobCore({
      requestId: REQUEST_ID,
      operatorId: "operator_kim",
      jobId: "job_1",
      toStatus: "cancelled",
    }, ACTOR, dependencies)).rejects.toThrow("field_change_reason_required");

    const cancelled = await transitionFieldJobCore({
      requestId: REQUEST_ID,
      operatorId: "operator_kim",
      jobId: "job_1",
      toStatus: "cancelled",
      reason: "건물주 요청",
    }, ACTOR, dependencies);
    expect(cancelled).toMatchObject({
      workflowStatus: "cancelled",
      createdAt: item.createdAt,
      createdByAuthUid: item.createdByAuthUid,
      createdByOperatorId: item.createdByOperatorId,
      cancelReason: "건물주 요청",
    });
  });
});
