import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { FieldV2Actor } from "../src/field-v2/contracts.js";
import {
  assignFieldJobCore,
  changeFieldVisitCore,
  claimFieldJobCore,
  createFieldJobsCore,
  listFieldOperationsWorkspaceCore,
  parseFieldMutationReceipt,
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

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]));
}

function sourceHash(item: Pick<FieldWorkItem, "sourceSnapshot" | "sourceVersion">): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize({ snapshot: item.sourceSnapshot, version: item.sourceVersion })))
    .digest("hex");
}

function baseItem(overrides: Partial<FieldWorkItem> = {}): FieldWorkItem {
  const normalizedOverrides: Partial<FieldWorkItem> = { ...overrides };
  const fallbackSnapshot = {
    parentType: "salesProspect" as const,
    parentId: "prospect_1",
    parentName: "상지 원룸",
    address: "강원 원주시 상지대길 1",
    unitType: "salesUnit" as const,
    unitId: "sales_unit_1",
    unitLabel: "101호",
    depositWon: 3_000_000,
    monthlyRentWon: 350_000,
    maintenanceFeeWon: 50_000,
  };
  if (
    !Object.hasOwn(overrides, "sourceSnapshot")
    && typeof overrides.crmSalesUnitId === "string"
    && overrides.crmSalesUnitId !== fallbackSnapshot.unitId
  ) {
    normalizedOverrides.sourceSnapshot = {
      ...fallbackSnapshot,
      unitId: overrides.crmSalesUnitId,
      unitLabel: overrides.crmSalesUnitId,
    };
  }
  const item = {
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
    sourceSnapshot: fallbackSnapshot,
    sourceVersion: {
      parentUpdatedAt: "2026-08-14T01:00:00.000Z",
      unitUpdatedAt: "2026-08-14T01:30:00.000Z",
    },
    sourceHash: "",
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
    ...normalizedOverrides,
  } as FieldWorkItem;
  if (!Object.hasOwn(overrides, "sourceHash")) {
    (item as { sourceHash: string }).sourceHash = sourceHash(item);
  }
  const timestamp = "2026-08-14T02:00:00.000Z";
  const acceptedStatuses = new Set([
    "accepted",
    "in_progress",
    "evidence_ready",
    "review_pending",
    "changes_requested",
    "approved",
    "completed",
  ]);
  const startedStatuses = new Set([
    "in_progress",
    "evidence_ready",
    "review_pending",
    "changes_requested",
    "approved",
    "completed",
  ]);
  const evidenceStatuses = new Set([
    "evidence_ready",
    "review_pending",
    "changes_requested",
    "approved",
    "completed",
  ]);
  const reviewStatuses = new Set(["review_pending", "changes_requested", "approved"]);
  if (acceptedStatuses.has(item.workflowStatus) && item.acceptedAt === undefined) {
    (item as { acceptedAt?: string }).acceptedAt = timestamp;
  }
  if (startedStatuses.has(item.workflowStatus) && item.startedAt === undefined) {
    (item as { startedAt?: string }).startedAt = timestamp;
  }
  if (evidenceStatuses.has(item.workflowStatus) && item.evidenceReadyAt === undefined) {
    (item as { evidenceReadyAt?: string }).evidenceReadyAt = timestamp;
  }
  if (reviewStatuses.has(item.workflowStatus) && item.reviewPendingAt === undefined) {
    (item as { reviewPendingAt?: string }).reviewPendingAt = timestamp;
  }
  if (item.workflowStatus === "completed" && item.completedAt === undefined) {
    (item as { completedAt?: string }).completedAt = timestamp;
  }
  if (item.workflowStatus === "cancelled" && item.cancelledAt === undefined) {
    (item as { cancelledAt?: string; cancelReason?: string }).cancelledAt = timestamp;
    (item as { cancelReason?: string }).cancelReason ??= "cancelled";
  }
  return item;
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
    readCrmWorkflowCase: vi.fn(async () => null),
    readCrmTask: vi.fn(async () => null),
    readCreationReceipt: vi.fn(async () => null),
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
    expect(command.patch[`fieldPlatform/v2/workItems/${result.jobIds[0]}`].sourceSnapshot)
      .toMatchObject({ moveOutAt: "2026-09-01" });
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

  it.each(["__proto__", "prototype", "constructor"])(
    "rejects the reserved dynamic path segment %s without prototype pollution",
    async (reserved) => {
      await expect(createFieldJobsCore({
        ...BASE_INPUT,
        crmSalesProspectId: reserved,
      }, ACTOR, deps())).rejects.toThrow("field_work_input_invalid");
      expect(Object.prototype).not.toHaveProperty("polluted");

      const actor = { ...ACTOR, operatorId: reserved };
      await expect(claimFieldJobCore({
        requestId: REQUEST_ID,
        operatorId: reserved,
        jobId: "job_1",
      }, actor, deps())).rejects.toThrow("field_operator_invalid");
      expect(Object.prototype).not.toHaveProperty("polluted");
    },
  );

  it("uses a race-safe exact receipt and never writes again for same-hash replay", async () => {
    const first = deps();
    await createFieldJobsCore(BASE_INPUT, ACTOR, first);
    const createdCommand = first.commitCreation.mock.calls[0][0];
    const dependencies = deps();
    const stored = { visitId: "visit_existing", jobIds: ["job_existing"] };
    dependencies.readCreationReceipt.mockResolvedValue({
      scope: "createFieldJobs",
      requestId: REQUEST_ID,
      requestHash: createdCommand.requestHash,
      result: stored,
      createdAt: "2026-08-14T02:00:00.000Z",
    });

    await expect(createFieldJobsCore(BASE_INPUT, ACTOR, dependencies)).resolves.toEqual({
      ...stored,
      repeated: true,
    });
    expect(dependencies.commitCreation).not.toHaveBeenCalled();
    expect(dependencies.readCrmSalesProspect).not.toHaveBeenCalled();
    expect(dependencies.readCrmSalesUnit).not.toHaveBeenCalled();
  });

  it("replays a valid creation receipt even when CRM becomes unavailable", async () => {
    const first = deps();
    await createFieldJobsCore(BASE_INPUT, ACTOR, first);
    const command = first.commitCreation.mock.calls[0][0];
    const replay = deps();
    replay.readCreationReceipt.mockResolvedValue({
      scope: "createFieldJobs",
      requestId: REQUEST_ID,
      requestHash: command.requestHash,
      result: command.result,
      createdAt: "2026-08-14T02:00:00.000Z",
    });
    replay.readCrmSalesProspect.mockRejectedValue(new Error("offline"));

    await expect(createFieldJobsCore(BASE_INPUT, ACTOR, replay))
      .resolves.toEqual({ ...command.result, repeated: true });
    expect(replay.readCrmSalesProspect).not.toHaveBeenCalled();
    expect(replay.commitCreation).not.toHaveBeenCalled();
  });

  it("rechecks the creation receipt after a CRM read race fails", async () => {
    const first = deps();
    await createFieldJobsCore(BASE_INPUT, ACTOR, first);
    const command = first.commitCreation.mock.calls[0][0];
    const racing = deps();
    racing.readCreationReceipt
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        scope: "createFieldJobs",
        requestId: REQUEST_ID,
        requestHash: command.requestHash,
        result: command.result,
        createdAt: "2026-08-14T02:00:00.000Z",
      });
    racing.readCrmSalesProspect.mockRejectedValue(new Error("offline"));

    await expect(createFieldJobsCore(BASE_INPUT, ACTOR, racing))
      .resolves.toEqual({ ...command.result, repeated: true });
    expect(racing.readCreationReceipt).toHaveBeenCalledTimes(2);
    expect(racing.commitCreation).not.toHaveBeenCalled();
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

  it("preserves authoritative moveOutAt and changes the snapshot hash when it changes", async () => {
    const first = deps();
    await createFieldJobsCore({ ...BASE_INPUT, crmSalesUnitIds: ["sales_unit_1"] }, ACTOR, first);
    const firstCommand = first.commitCreation.mock.calls[0][0];
    const firstItem = firstCommand.patch[`fieldPlatform/v2/workItems/${firstCommand.result.jobIds[0]}`];

    const second = deps();
    second.readCrmSalesUnit.mockResolvedValue({
      id: "sales_unit_1",
      prospectId: "prospect_1",
      label: "101호",
      deposit: 3_000_000,
      rent: 350_000,
      maintenanceFee: 50_000,
      moveOutAt: "2026-09-02",
      updatedAt: "2026-08-14T01:30:00.000Z",
      archivedAt: null,
    });
    await createFieldJobsCore({ ...BASE_INPUT, crmSalesUnitIds: ["sales_unit_1"] }, ACTOR, second);
    const secondCommand = second.commitCreation.mock.calls[0][0];
    const secondItem = secondCommand.patch[`fieldPlatform/v2/workItems/${secondCommand.result.jobIds[0]}`];

    expect(firstItem.sourceSnapshot.moveOutAt).toBe("2026-09-01");
    expect(secondItem.sourceSnapshot.moveOutAt).toBe("2026-09-02");
    expect(secondItem.sourceHash).not.toBe(firstItem.sourceHash);
    expect(firstItem.sourceSnapshot).not.toHaveProperty("availableFrom");
  });

  it("rejects malformed dates and oversized authoritative CRM source text", async () => {
    const invalidDate = deps();
    invalidDate.readCrmSalesUnit.mockResolvedValue({
      id: "sales_unit_1",
      prospectId: "prospect_1",
      label: "101호",
      deposit: 1,
      rent: 1,
      maintenanceFee: 1,
      moveOutAt: "2026-02-30",
      updatedAt: "2026-08-14T01:00:00.000Z",
      archivedAt: null,
    });
    await expect(createFieldJobsCore({ ...BASE_INPUT, crmSalesUnitIds: ["sales_unit_1"] }, ACTOR, invalidDate))
      .rejects.toThrow("field_crm_reference_invalid");

    const oversized = deps();
    oversized.readCrmSalesProspect.mockResolvedValue({
      id: "prospect_1",
      name: "x".repeat(513),
      address: "강원 원주시",
      updatedAt: "2026-08-14T01:00:00.000Z",
      archivedAt: null,
    });
    await expect(createFieldJobsCore(BASE_INPUT, ACTOR, oversized))
      .rejects.toThrow("field_crm_reference_invalid");
  });

  it("validates and stores active canonical case and task references", async () => {
    const dependencies = deps();
    dependencies.readCrmBuilding.mockResolvedValue({
      id: "building_1",
      name: "브링빌",
      address: "강원 원주시 중앙로 1",
      updatedAt: "2026-08-14T01:00:00.000Z",
      archivedAt: null,
    });
    dependencies.readCrmWorkflowCase.mockResolvedValue({
      id: "legacy-mismatch-is-not-authoritative",
      crmBuildingId: "building_1",
      deleted: false,
      archived: false,
      updatedAt: "2026-08-14T01:10:00.000Z",
    });
    dependencies.readCrmTask.mockResolvedValue({
      id: "task_1",
      status: "진행중",
      updatedAt: "2026-08-14T01:20:00.000Z",
    });
    const result = await createFieldJobsCore({
      requestId: REQUEST_ID,
      operatorId: "operator_kim",
      jobType: "maintenance_inspection",
      crmBuildingId: "building_1",
      crmWorkflowCaseId: "case_1",
      crmTaskId: "task_1",
      dueDate: "2026-08-15",
      priority: "normal",
    }, ACTOR, dependencies);
    const command = dependencies.commitCreation.mock.calls[0][0];
    expect(command.patch[`fieldPlatform/v2/workItems/${result.jobIds[0]}`]).toMatchObject({
      crmWorkflowCaseId: "case_1",
      crmTaskId: "task_1",
    });
    expect(command.sourceExpectations).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "crmCompany/cases/case_1", kind: "workflowCase" }),
      expect.objectContaining({ path: "crmCompany/data/tasks/task_1", kind: "task" }),
    ]));
  });

  it.each([
    ["deleted case", { deleted: true, crmBuildingId: "building_1" }, "field_crm_reference_inactive"],
    ["archived case", { archived: true, crmBuildingId: "building_1" }, "field_crm_reference_inactive"],
    ["cross-building case", { crmBuildingId: "building_other" }, "field_crm_reference_mismatch"],
  ])("rejects %s", async (_label, workflowCase, code) => {
    const dependencies = deps();
    dependencies.readCrmBuilding.mockResolvedValue({
      id: "building_1",
      name: "브링빌",
      address: "강원 원주시 중앙로 1",
      updatedAt: "2026-08-14T01:00:00.000Z",
      archivedAt: null,
    });
    dependencies.readCrmWorkflowCase.mockResolvedValue(workflowCase);
    await expect(createFieldJobsCore({
      requestId: REQUEST_ID,
      operatorId: "operator_kim",
      jobType: "maintenance_inspection",
      crmBuildingId: "building_1",
      crmWorkflowCaseId: "case_1",
      dueDate: "2026-08-15",
      priority: "normal",
    }, ACTOR, dependencies)).rejects.toThrow(code);
  });

  it.each(["완료", "취소"])("rejects inactive task status %s", async (status) => {
    const dependencies = deps();
    dependencies.readCrmTask.mockResolvedValue({ id: "task_1", status });
    await expect(createFieldJobsCore({ ...BASE_INPUT, crmTaskId: "task_1" }, ACTOR, dependencies))
      .rejects.toThrow("field_crm_reference_inactive");
  });

  it("revalidates both sides of a sales-prospect to workflow-case building relation", async () => {
    const dependencies = deps();
    dependencies.readCrmSalesProspect.mockResolvedValue({
      id: "prospect_1",
      name: "상지 원룸",
      address: "강원 원주시 상지대길 1",
      crmBuildingId: "building_1",
      updatedAt: "2026-08-14T01:00:00.000Z",
      archivedAt: null,
    });
    dependencies.readCrmWorkflowCase.mockResolvedValue({
      crmBuildingId: "building_1",
      deleted: false,
      archived: false,
    });
    await createFieldJobsCore({ ...BASE_INPUT, crmWorkflowCaseId: "case_1" }, ACTOR, dependencies);
    const command = dependencies.commitCreation.mock.calls[0][0];
    expect(command.sourceExpectations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "crmCompany/data/salesProspects/prospect_1",
        parentField: "crmBuildingId",
        parentId: "building_1",
      }),
      expect.objectContaining({
        path: "crmCompany/cases/case_1",
        parentField: "crmBuildingId",
        parentId: "building_1",
      }),
    ]));
  });

  it("rejects missing, unavailable, mismatched, or unprovable case/task references", async () => {
    const missing = deps();
    await expect(createFieldJobsCore({ ...BASE_INPUT, crmWorkflowCaseId: "case_1" }, ACTOR, missing))
      .rejects.toThrow("field_crm_reference_invalid");

    const unavailable = deps();
    unavailable.readCrmWorkflowCase.mockRejectedValue(new Error("offline"));
    await expect(createFieldJobsCore({ ...BASE_INPUT, crmWorkflowCaseId: "case_1" }, ACTOR, unavailable))
      .rejects.toThrow("field_crm_reference_unavailable");

    const unprovable = deps();
    unprovable.readCrmWorkflowCase.mockResolvedValue({
      address: "강원 원주시 상지대길 1",
      crmBuildingId: "building_1",
    });
    await expect(createFieldJobsCore({ ...BASE_INPUT, crmWorkflowCaseId: "case_1" }, ACTOR, unprovable))
      .rejects.toThrow("field_crm_reference_mismatch");

    const taskMismatch = deps();
    taskMismatch.readCrmTask.mockResolvedValue({ id: "task_other", status: "진행중" });
    await expect(createFieldJobsCore({ ...BASE_INPUT, crmTaskId: "task_1" }, ACTOR, taskMismatch))
      .rejects.toThrow("field_crm_reference_invalid");
  });
});

describe("FIELD v2 workspace reads", () => {
  it("propagates a workspace query failure instead of reporting zero KPIs", async () => {
    const dependencies = deps();
    dependencies.readWorkspace.mockRejectedValue(new Error("network"));
    await expect(listFieldOperationsWorkspaceCore({ operatorId: "operator_kim" }, ACTOR, dependencies))
      .rejects.toMatchObject({
        name: "FieldV2Error",
        code: "field_workspace_unavailable",
      });
  });

  it.each([0, 101, 1.5, "50"])("rejects invalid bounded workspace limit %p", async (limit) => {
    await expect(listFieldOperationsWorkspaceCore({
      operatorId: "operator_kim",
      limit: limit as number,
    }, ACTOR, deps())).rejects.toThrow("field_workspace_limit_invalid");
  });

  it("allows only admins to request a team workspace", async () => {
    await expect(listFieldOperationsWorkspaceCore({
      operatorId: "operator_kim",
      scope: "team",
    }, ACTOR, deps())).rejects.toThrow("field_workspace_scope_forbidden");
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
          createdAt: "2026-08-14T02:00:00.000Z",
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

  it("replays an assignment before reading the historical target operator", async () => {
    const assigned = baseItem({
      assignedOperatorId: "operator_hwang",
      workflowStatus: "assigned",
    });
    const dependencies = deps();
    dependencies.readOperator.mockRejectedValue(new Error("operator directory unavailable"));
    dependencies.transactWork.mockImplementation(async (selector: unknown, decide: (
      snapshot: unknown,
    ) => { errorCode?: string; result?: unknown }) => {
      const typed = selector as { requestHash: string };
      const decision = decide({
        workItem: null,
        visit: null,
        visitWorkItems: [],
        receipt: {
          scope: "assignFieldJob",
          requestId: REQUEST_ID,
          requestHash: typed.requestHash,
          result: assigned,
          createdAt: "2026-08-14T02:00:00.000Z",
        },
      });
      if (decision.errorCode) throw new Error(decision.errorCode);
      return decision.result;
    });

    await expect(assignFieldJobCore({
      requestId: REQUEST_ID,
      operatorId: "operator_kim",
      jobId: "job_1",
      assignedOperatorId: "operator_hwang",
      reason: "assignment changed",
    }, ACTOR, dependencies)).resolves.toEqual(assigned);
    expect(dependencies.readOperator).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown job type", { jobType: "unknown" }],
    ["unknown workflow status", { workflowStatus: "mystery" }],
    ["unknown upload status", { uploadStatus: "mystery" }],
    ["unknown priority", { priority: "critical" }],
    ["assigned state without operator", { workflowStatus: "assigned", assignedOperatorId: null }],
    ["requested state with operator", { workflowStatus: "requested", assignedOperatorId: "operator_kim" }],
    ["negative media count", { mediaCount: -1 }],
    ["malformed source snapshot", { sourceSnapshot: { parentType: "building" } }],
    ["malformed source version", { sourceVersion: { parentUpdatedAt: "yesterday" } }],
    ["malformed audit timestamp", { updatedAt: "yesterday" }],
    ["malformed archive marker", { archivedAt: "archived" }],
    ["policy version mismatch", { jobPolicyVersion: "FIELD_V2_OTHER" }],
    ["checklist mismatch", { checklistId: "OTHER_V1" }],
    ["both CRM parents", { crmBuildingId: "building_1" }],
    ["unsafe optional CRM ref", { crmTaskId: "__proto__" }],
    ["snapshot parent mismatch", { sourceSnapshot: { ...baseItem().sourceSnapshot, parentId: "prospect_other" } }],
    ["snapshot unit mismatch", { sourceSnapshot: { ...baseItem().sourceSnapshot, unitId: "sales_unit_other" } }],
    ["source content hash mismatch", { sourceHash: "b".repeat(64) }],
    ["unknown sensitive field", { secretDoorCode: "1234" }],
  ])("rejects stored work item with %s", async (_label, override) => {
    const malformed = { ...baseItem(), ...override } as FieldWorkItem;
    const dependencies = transactionDeps({ item: malformed, visit: baseVisit() });
    await expect(claimFieldJobCore({
      requestId: REQUEST_ID,
      operatorId: "operator_kim",
      jobId: "job_1",
    }, ACTOR, dependencies)).rejects.toThrow("field_work_item_state_invalid");
  });

  it("rejects an exact receipt result containing an unknown sensitive field", () => {
    expect(() => parseFieldMutationReceipt({
      scope: "claimFieldJob",
      requestId: REQUEST_ID,
      requestHash: "a".repeat(64),
      createdAt: "2026-08-14T02:00:00.000Z",
      result: {
        ...baseItem({ assignedOperatorId: "operator_kim", workflowStatus: "assigned" }),
        internalMemo: "do not expose",
      },
    }, "claimFieldJob", REQUEST_ID)).toThrow("field_request_receipt_invalid");
  });

  it("rejects unknown fields in a creation receipt result", () => {
    expect(() => parseFieldMutationReceipt({
      scope: "createFieldJobs",
      requestId: REQUEST_ID,
      requestHash: "a".repeat(64),
      createdAt: "2026-08-14T02:00:00.000Z",
      result: {
        visitId: "visit_1",
        jobIds: ["job_1"],
        internalMemo: "do not expose",
      },
    }, "createFieldJobs", REQUEST_ID)).toThrow("field_request_receipt_invalid");
  });

  it.each(["sourceSnapshot", "sourceVersion"] as const)(
    "rejects unknown fields nested inside %s even when its source hash is valid",
    async (field) => {
      const base = baseItem();
      const poisoned = baseItem({
        [field]: { ...base[field], internalMemo: "do not expose" },
      } as Partial<FieldWorkItem>);
      const dependencies = transactionDeps({ item: poisoned, visit: baseVisit() });
      await expect(claimFieldJobCore({
        requestId: REQUEST_ID,
        operatorId: "operator_kim",
        jobId: "job_1",
      }, ACTOR, dependencies)).rejects.toThrow("field_work_item_state_invalid");
    },
  );

  it.each([
    ["invalid new visit id", { newVisitId: "__proto__" }],
    ["duplicate updated IDs", { updatedJobIds: ["job_1", "job_1"] }],
    ["IDs that do not match work items", { updatedJobIds: ["job_other"] }],
    ["unknown result field", { internalMemo: "do not expose" }],
  ])("rejects a change receipt with %s", (_label, resultOverride) => {
    expect(() => parseFieldMutationReceipt({
      scope: "changeFieldVisit",
      requestId: REQUEST_ID,
      requestHash: "a".repeat(64),
      createdAt: "2026-08-14T02:00:00.000Z",
      result: {
        visitId: "visit_1",
        updatedJobIds: ["job_1"],
        workItems: [baseItem()],
        ...resultOverride,
      },
    }, "changeFieldVisit", REQUEST_ID)).toThrow("field_request_receipt_invalid");
  });

  it.each([
    ["invalid visit due date", { dueDate: "2026-8-15" }],
    ["invalid visit priority", { priority: "critical" }],
    ["invalid visit assignee", { assignedOperatorId: "__proto__" }],
    ["two visit parents", { crmBuildingId: "building_1" }],
    ["duplicate visit media", { sharedMediaIds: ["media_1", "media_1"] }],
    ["invalid visit audit actor", { updatedByOperatorId: "constructor" }],
    ["unknown sensitive visit field", { internalMemo: "do not expose" }],
  ])("rejects stored visit with %s", async (_label, override) => {
    const item = baseItem();
    const dependencies = transactionDeps({ item, visit: baseVisit(override as Partial<FieldVisit>) });
    await expect(claimFieldJobCore({
      requestId: REQUEST_ID,
      operatorId: "operator_kim",
      jobId: "job_1",
    }, ACTOR, dependencies)).rejects.toThrow("field_visit_state_invalid");
  });

  it("rejects a visit whose parent, due date, or priority contradicts its children", async () => {
    const item = baseItem();
    for (const visit of [
      baseVisit({ crmSalesProspectId: "prospect_other" }),
      baseVisit({ dueDate: "2026-08-16" }),
      baseVisit({ priority: "urgent" }),
    ]) {
      const dependencies = transactionDeps({ item, visit });
      await expect(claimFieldJobCore({
        requestId: REQUEST_ID,
        operatorId: "operator_kim",
        jobId: "job_1",
      }, ACTOR, dependencies)).rejects.toThrow("field_visit_relation_invalid");
    }
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

  it("keeps acceptance when an explicit assignee is unchanged during a schedule change", async () => {
    const item = baseItem({ workflowStatus: "accepted", assignedOperatorId: "operator_kim" });
    const dependencies = transactionDeps({
      item,
      visit: baseVisit({ assignedOperatorId: "operator_kim" }),
    });
    const changed = await changeFieldVisitCore({
      requestId: REQUEST_ID,
      operatorId: "operator_kim",
      visitId: "visit_1",
      assignedOperatorId: "operator_kim",
      dueDate: "2026-08-16",
      reason: "schedule changed without reassignment",
    }, ACTOR, dependencies);

    expect(changed.workItems[0]).toMatchObject({
      assignedOperatorId: "operator_kim",
      workflowStatus: "accepted",
      acceptedAt: item.acceptedAt,
      dueDate: "2026-08-16",
    });
  });

  it("does not split a started child away from media already owned by its visit", async () => {
    const started = baseItem({ workflowStatus: "in_progress", assignedOperatorId: "operator_kim" });
    const pending = baseItem({
      id: "job_2",
      crmSalesUnitId: "sales_unit_2",
      assignedOperatorId: "operator_kim",
      workflowStatus: "assigned",
    });
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

  it.each([
    ["operator_hwang", "assigned"],
    [null, "requested"],
  ] as const)("requires a fresh acceptance when an accepted job is assigned to %s", async (
    assignedOperatorId,
    workflowStatus,
  ) => {
    const item = baseItem({ workflowStatus: "accepted", assignedOperatorId: "operator_kim" });
    const visit = baseVisit({ assignedOperatorId: "operator_kim" });
    const dependencies = transactionDeps({ item, visit });

    const changed = await assignFieldJobCore({
      requestId: REQUEST_ID,
      operatorId: "operator_kim",
      jobId: "job_1",
      assignedOperatorId,
      reason: "assignment changed",
    }, ACTOR, dependencies);

    expect(changed).toMatchObject({ assignedOperatorId, workflowStatus });
    expect(changed).not.toHaveProperty("acceptedAt");
    const decision = dependencies.transactWork.mock.calls[0][1]({
      workItem: item,
      visit,
      visitWorkItems: [item],
    });
    expect(decision.patch["fieldPlatform/v2/visits/visit_1"])
      .toMatchObject({ assignedOperatorId });
  });

  it("blocks a reasoned reassignment after work has started even for a single-item visit", async () => {
    const item = baseItem({ workflowStatus: "in_progress", assignedOperatorId: "operator_kim" });
    const dependencies = transactionDeps({
      item,
      visit: baseVisit({ assignedOperatorId: "operator_kim" }),
    });
    await expect(assignFieldJobCore({
      requestId: REQUEST_ID,
      operatorId: "operator_kim",
      jobId: "job_1",
      assignedOperatorId: "operator_hwang",
      reason: "attempted recovery",
    }, ACTOR, dependencies)).rejects.toThrow("field_started_job_change_forbidden");
  });

  it("honors explicit null when an accepted child is split from a multi-item visit", async () => {
    const accepted = baseItem({ workflowStatus: "accepted", assignedOperatorId: "operator_kim" });
    const pending = baseItem({
      id: "job_2",
      crmSalesUnitId: "sales_unit_2",
      workflowStatus: "assigned",
      assignedOperatorId: "operator_kim",
    });
    const visit = baseVisit({
      workItemIds: ["job_1", "job_2"],
      assignedOperatorId: "operator_kim",
    });
    const dependencies = transactionDeps({ item: accepted, visit, visitItems: [accepted, pending] });
    const changed = await changeFieldVisitCore({
      requestId: REQUEST_ID,
      operatorId: "operator_kim",
      visitId: "visit_1",
      jobId: "job_1",
      assignedOperatorId: null,
      reason: "return to queue",
    }, ACTOR, dependencies);
    expect(changed.workItems[0]).toMatchObject({
      assignedOperatorId: null,
      workflowStatus: "requested",
    });
    expect(changed.workItems[0]).not.toHaveProperty("acceptedAt");
    const decision = dependencies.transactWork.mock.calls[0][1]({
      workItem: accepted,
      visit,
      visitWorkItems: [accepted, pending],
    });
    expect(decision.patch[`fieldPlatform/v2/visits/${changed.newVisitId}`])
      .toMatchObject({ assignedOperatorId: null });
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
