import { describe, expect, it, vi } from "vitest";

import {
  FIELD_BUILD_VERSION,
  FIELD_PROTOCOL_VERSION,
  isStrictFieldBuildVersion,
} from "../../app/field/lib/v2/contracts";
import {
  createFieldV2Api,
  FIELD_COMMAND_CALLABLES,
  mergeFieldWorkspaceItems,
  type FieldCallable,
} from "../../app/field/lib/v2/field-v2-api.client";

const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";

const KPIS = Object.freeze({
  todayVisits: 1,
  capturePending: 2,
  uploadFailures: 0,
  reviewPending: 1,
  unassigned: 0,
  overdue: 1,
  adminActionRequired: 0,
});

const ITEM = Object.freeze({
  id: "job_1",
  visitId: "visit_1",
  jobType: "vacancy_capture",
  jobPolicyVersion: "FIELD_V2_VACANCY_CAPTURE",
  checklistId: "VACANCY_CAPTURE_V1",
  crmSalesProspectId: "prospect_1",
  crmSalesUnitId: "sales_unit_1",
  assignedOperatorId: "operator_kim",
  dueDate: "2026-08-14",
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
    depositWon: 5_000_000,
    monthlyRentWon: 400_000,
    maintenanceFeeWon: 50_000,
  } as const,
  sourceVersion: {
    parentUpdatedAt: "2026-08-14T01:00:00.000Z",
    unitUpdatedAt: "2026-08-14T01:30:00.000Z",
  },
  sourceHash: "1d068b3e9484d0b8c202f2263311bdec267354f57aeb76505cb6790ed640a9c8",
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
});

const WORKSPACE = Object.freeze({
  items: [ITEM],
  kpis: KPIS,
  scope: "personal",
  nextCursor: null,
});

describe("FIELD v2 client contract", () => {
  it("pins one strict PWA build for standalone and CRM-embedded callable requests", () => {
    expect(FIELD_PROTOCOL_VERSION).toBe(2);
    expect(FIELD_BUILD_VERSION).toBe("1.0.0");
    expect(isStrictFieldBuildVersion(FIELD_BUILD_VERSION)).toBe(true);
    expect(isStrictFieldBuildVersion("0.1.0-beta")).toBe(false);
    expect(isStrictFieldBuildVersion("01.0.0")).toBe(false);
  });

  it.each([false, true])(
    "loads only the named server workspace projection in embedded=%s mode",
    async (embedded) => {
      const callable = vi.fn<FieldCallable>(async () => ({ data: WORKSPACE }));
      const api = createFieldV2Api({
        callable,
        operatorId: "operator_kim",
        embedded,
      });

      await expect(api.loadWorkspace()).resolves.toEqual(WORKSPACE);
      expect(callable).toHaveBeenCalledWith("listFieldOperationsWorkspace", {
        protocolVersion: 2,
        clientKind: "pwa",
        buildVersion: "1.0.0",
        operatorId: "operator_kim",
        scope: "personal",
        limit: 50,
      });
      const payload = callable.mock.calls[0]![1] as Record<string, unknown>;
      expect(payload).not.toHaveProperty("authUid");
      expect(payload).not.toHaveProperty("email");
      expect(payload).not.toHaveProperty("token");
      expect(payload).not.toHaveProperty("requestId");
    },
  );

  it("preserves an empty page, its continuation cursor, and its authoritative KPIs", async () => {
    const emptyPage = {
      items: [],
      kpis: { ...KPIS, overdue: KPIS.overdue + 1 },
      scope: "personal",
      nextCursor: "cursor_2",
    } as const;
    const callable = vi.fn()
      .mockResolvedValueOnce({
        data: emptyPage,
      })
      .mockResolvedValueOnce({
        data: WORKSPACE,
      });
    const api = createFieldV2Api({ callable, operatorId: "operator_kim" });

    await expect(api.loadWorkspace({ limit: 1 })).resolves.toEqual(emptyPage);
    expect(callable).toHaveBeenCalledOnce();
    expect(callable).toHaveBeenCalledWith("listFieldOperationsWorkspace", {
      protocolVersion: 2,
      clientKind: "pwa",
      buildVersion: "1.0.0",
      operatorId: "operator_kim",
      scope: "personal",
      limit: 1,
    });
  });

  it("rejects invalid, negative, or unsafe KPI responses", async () => {
    for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const callable = vi.fn(async () => ({
        data: {
          ...WORKSPACE,
          kpis: { ...KPIS, uploadFailures: value },
        },
      }));
      const api = createFieldV2Api({ callable, operatorId: "operator_kim" });
      await expect(api.loadWorkspace()).rejects.toThrow("field_workspace_invalid");
    }

  });

  it("fails closed on unknown fields, impossible calendar dates, oversized copy, and oversized responses", async () => {
    const invalidItems = [
      { ...ITEM, internalMemo: "must not enter FIELD state" },
      { ...ITEM, dueDate: "2026-02-31" },
      { ...ITEM, crmWorkflowCaseId: 7 },
      { ...ITEM, acceptedAt: "yesterday" },
      { ...ITEM, adPackageId: { id: "package_1" } },
      { ...ITEM, sourceVersion: { ...ITEM.sourceVersion, internalRevision: "2026-08-14T01:40:00.000Z" } },
      {
        ...ITEM,
        sourceSnapshot: { ...ITEM.sourceSnapshot, address: "가".repeat(700) },
      },
    ];
    for (const invalid of invalidItems) {
      const callable = vi.fn(async () => ({ data: { ...WORKSPACE, items: [invalid] } }));
      await expect(createFieldV2Api({ callable, operatorId: "operator_kim" }).loadWorkspace())
        .rejects.toThrow("field_workspace_invalid");
    }

    const manyLargeItems = Array.from({ length: 100 }, (_, index) => ({
      ...ITEM,
      id: `job_${index}`,
      visitId: `visit_${index}`,
      sourceSnapshot: { ...ITEM.sourceSnapshot, address: "가".repeat(650) },
    }));
    const oversized = vi.fn(async () => ({ data: { ...WORKSPACE, items: manyLargeItems } }));
    await expect(createFieldV2Api({ callable: oversized, operatorId: "operator_kim" }).loadWorkspace())
      .rejects.toThrow("field_workspace_invalid");
  });

  it("mirrors stored-work-item policy, parent, unit, assignee, and lifecycle invariants", async () => {
    const invalidItems = [
      { ...ITEM, jobPolicyVersion: "FIELD_V2_MOVE_OUT_CHECK" },
      { ...ITEM, checklistId: "MOVE_OUT_CHECK_V1" },
      { ...ITEM, crmBuildingId: "building_1" },
      { ...ITEM, crmSalesProspectId: "other_prospect" },
      { ...ITEM, crmSalesUnitId: "other_unit" },
      { ...ITEM, crmBuildingUnitId: "building_unit_1" },
      { ...ITEM, sourceSnapshot: { ...ITEM.sourceSnapshot, unitLabel: undefined } },
      { ...ITEM, sourceSnapshot: { ...ITEM.sourceSnapshot, depositWon: undefined } },
      { ...ITEM, workflowStatus: "requested", assignedOperatorId: "operator_kim" },
      { ...ITEM, workflowStatus: "assigned", assignedOperatorId: null },
      { ...ITEM, workflowStatus: "accepted" },
      { ...ITEM, workflowStatus: "assigned", acceptedAt: "2026-08-14T02:30:00.000Z" },
      { ...ITEM, workflowStatus: "in_progress", acceptedAt: "2026-08-14T02:30:00.000Z" },
      { ...ITEM, workflowStatus: "completed", completedAt: "2026-08-14T04:00:00.000Z" },
      { ...ITEM, workflowStatus: "cancelled", cancelledAt: "2026-08-14T04:00:00.000Z" },
      { ...ITEM, workflowStatus: "assigned", cancelReason: "stale" },
    ];
    for (const invalid of invalidItems) {
      const callable = vi.fn(async () => ({ data: { ...WORKSPACE, items: [invalid] } }));
      await expect(createFieldV2Api({ callable, operatorId: "operator_kim" }).loadWorkspace())
        .rejects.toThrow("field_workspace_invalid");
    }
  });

  it("rejects a valid-looking source hash that does not match its canonical snapshot", async () => {
    const tampered = {
      ...ITEM,
      sourceSnapshot: { ...ITEM.sourceSnapshot, parentName: "변조된 원룸" },
    };
    const callable = vi.fn(async () => ({ data: { ...WORKSPACE, items: [tampered] } }));

    await expect(createFieldV2Api({ callable, operatorId: "operator_kim" }).loadWorkspace())
      .rejects.toThrow("field_workspace_invalid");
  });

  it("rejects terminal team projections and requires the exact active order key", async () => {
    const baseTeamItem = {
      fieldJobId: "job_1",
      visitId: "visit_1",
      jobType: "vacancy_capture",
      parentName: "Bring building",
      address: "1 Field road",
      unitLabel: "101",
      assignedOperatorId: "operator_kim",
      dueDate: "2026-08-14",
      priority: "urgent",
      workflowStatus: "assigned",
      uploadStatus: "none",
      mediaCount: 0,
      uploadFailureCount: 0,
      adminActionRequired: false,
      updatedAt: "2026-08-14T02:00:00.000Z",
      activeOrderKey: "2026-08-14|0|2026-08-14T02:00:00.000Z|job_1",
    };
    const teamWorkspace = { ...WORKSPACE, scope: "team", items: [baseTeamItem] };
    await expect(createFieldV2Api({
      callable: async () => ({ data: teamWorkspace }),
      operatorId: "operator_kim",
    }).loadWorkspace({ scope: "team" })).resolves.toMatchObject(teamWorkspace);

    for (const invalid of [
      { ...baseTeamItem, workflowStatus: "completed" },
      { ...baseTeamItem, workflowStatus: "cancelled" },
      { ...baseTeamItem, activeOrderKey: `${baseTeamItem.activeOrderKey}|extra` },
      { ...baseTeamItem, activeOrderKey: "2026-08-14|1|2026-08-14T02:00:00.000Z|job_1" },
    ]) {
      const callable = vi.fn(async () => ({ data: { ...teamWorkspace, items: [invalid] } }));
      await expect(createFieldV2Api({ callable, operatorId: "operator_kim" }).loadWorkspace({ scope: "team" }))
        .rejects.toThrow("field_workspace_invalid");
    }
  });

  it("fails closed on a malformed continuation cursor", async () => {
    const malformed = vi.fn(async () => ({
      data: { items: [], kpis: KPIS, scope: "personal", nextCursor: "" },
    }));
    await expect(createFieldV2Api({
      callable: malformed,
      operatorId: "operator_kim",
    }).loadWorkspace()).rejects.toThrow("field_workspace_invalid");

  });

  it("maps App Check bootstrap failures to the stable session-unavailable code", async () => {
    const api = createFieldV2Api({
      callable: vi.fn(),
      verifyAppCheck: async () => { throw new Error("raw app check provider detail"); },
      operatorId: "operator_kim",
    });

    await expect(api.loadWorkspace()).rejects.toMatchObject({ code: "FIELD_SESSION_UNAVAILABLE" });
  });

  it("maps callable-time authentication expiry to the same stable session-unavailable code", async () => {
    const api = createFieldV2Api({
      callable: async () => {
        throw Object.assign(new Error("raw token or App Check detail"), {
          code: "functions/unauthenticated",
        });
      },
      verifyAppCheck: async () => undefined,
      operatorId: "operator_kim",
    });

    await expect(api.runCommand("claimJob", { jobId: "job_1" }, { requestId: REQUEST_ID }))
      .rejects.toMatchObject({ code: "FIELD_SESSION_UNAVAILABLE" });
  });

  it("preserves nextCursor and merges later duplicate IDs with the newest server row", async () => {
    const pageOne = { ...WORKSPACE, nextCursor: "page_2" };
    const callable = vi.fn(async () => ({ data: pageOne }));
    const result = await createFieldV2Api({ callable, operatorId: "operator_kim" }).loadWorkspace();
    expect(result.nextCursor).toBe("page_2");
    expect(mergeFieldWorkspaceItems(result.items, [
      { ...ITEM, workflowStatus: "accepted", updatedAt: "2026-08-14T03:00:00.000Z" },
      { ...ITEM, id: "job_2", visitId: "visit_2" },
    ])).toEqual([
      { ...ITEM, workflowStatus: "accepted", updatedAt: "2026-08-14T03:00:00.000Z" },
      { ...ITEM, id: "job_2", visitId: "visit_2" },
    ]);
  });

  it("maps the desktop transitionStatus command to transitionFieldJob with one UUID", async () => {
    const callable = vi.fn(async () => ({ data: { ...ITEM, workflowStatus: "accepted" } }));
    const api = createFieldV2Api({
      callable,
      operatorId: "operator_kim",
      requestId: () => "123e4567-e89b-42d3-a456-426614174000",
    });

    await api.runCommand("transitionStatus", {
      jobId: "job_1",
      toStatus: "accepted",
    });

    expect(callable).toHaveBeenCalledWith("transitionFieldJob", {
      protocolVersion: 2,
      clientKind: "pwa",
      buildVersion: "1.0.0",
      operatorId: "operator_kim",
      requestId: "123e4567-e89b-42d3-a456-426614174000",
      jobId: "job_1",
      toStatus: "accepted",
    });
  });

  it("does not invent unavailable operator-switch or review callables", async () => {
    expect(FIELD_COMMAND_CALLABLES).toEqual({
      createJob: "createFieldJobs",
      claimJob: "claimFieldJob",
      assignJob: "assignFieldJob",
      changeVisit: "changeFieldVisit",
      transitionStatus: "transitionFieldJob",
    });
    const callable = vi.fn();
    const api = createFieldV2Api({ callable, operatorId: "operator_kim" });
    await expect(api.runCommand("switchOperator" as never, {})).rejects.toThrow("field_command_invalid");
    await expect(api.runCommand("reviewJob" as never, {})).rejects.toThrow("field_command_invalid");
    expect(callable).not.toHaveBeenCalled();
  });

  it("keeps self-claim separate from admin assignment and sends one idempotent claim", async () => {
    const claimed = { ...ITEM, assignedOperatorId: "operator_kim", workflowStatus: "assigned" };
    const callable = vi.fn(async () => ({ data: claimed }));
    const api = createFieldV2Api({ callable, operatorId: "operator_kim" });

    await expect(api.runCommand("claimJob", { jobId: "job_1" }, {
      requestId: REQUEST_ID,
    })).resolves.toEqual(claimed);
    expect(callable).toHaveBeenCalledWith("claimFieldJob", {
      protocolVersion: 2,
      clientKind: "pwa",
      buildVersion: "1.0.0",
      operatorId: "operator_kim",
      requestId: REQUEST_ID,
      jobId: "job_1",
    });
  });

  it("preserves the desktop bridge request ID and abort signal for mutation dedupe", async () => {
    const callable = vi.fn(async () => ({ data: { ...ITEM, workflowStatus: "accepted" } }));
    const controller = new AbortController();
    const api = createFieldV2Api({
      callable,
      operatorId: "operator_kim",
      requestId: () => "223e4567-e89b-42d3-a456-426614174000",
    });

    await api.runCommand("transitionStatus", {
      jobId: "job_1",
      toStatus: "accepted",
    }, {
      requestId: REQUEST_ID,
      signal: controller.signal,
    });

    expect(callable).toHaveBeenCalledWith("transitionFieldJob", expect.objectContaining({
      requestId: REQUEST_ID,
    }));
  });
});

export { ITEM, KPIS, WORKSPACE };
