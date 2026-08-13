import { describe, expect, it, vi } from "vitest";

import {
  commitCanonicalCrmEntityCore,
  reduceCanonicalCrmEntityRoot,
  type CanonicalCrmDependencies,
  type CanonicalCrmEntityInput,
} from "../src/field-v2/canonical-crm.js";
import type { FieldV2Actor } from "../src/field-v2/contracts.js";

const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";
const NOW = "2026-08-14T04:00:00.000Z";
const ACTOR: FieldV2Actor = {
  authUid: "shared_uid",
  operatorId: "operator_kim",
  displayName: "김현진",
  role: "member",
};

function release(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: 2,
    minDesktopVersion: "1.7.0",
    maxDesktopVersion: "2.0.0",
    minPwaVersion: "1.0.0",
    enabledOperatorIds: ["operator_kim"],
    v2WritesEnabled: true,
    canonicalCrmEnabled: true,
    safeMode: false,
    cutoverAt: null,
    ...overrides,
  };
}

function root(overrides: Record<string, unknown> = {}) {
  return {
    crmCompany: {
      access: {
        shared_uid: {
          enabled: true,
          role: "member",
          email: "team@bringcare.kr",
        },
      },
      teamProfiles: {
        operator_kim: { active: true, displayName: "김현진", sortOrder: 1 },
      },
      data: {
        customers: {
          customer_1: { id: "customer_1", archivedAt: "" },
        },
        buildings: {
          building_1: {
            id: "building_1",
            name: "상지 원룸",
            address: "강원 원주시 상지대길 1",
            type: "원룸",
            status: "관리중",
            ownerCustomerId: "customer_1",
            unitCount: 9,
            manager: "김현진",
            memo: "",
            aliases: [],
            externalRefs: {
              paymentBuildingIds: ["pay_1"],
              fieldBuildingIds: ["legacy_field_1"],
            },
            entityVersion: 4,
            createdAt: "2026-08-01T00:00:00.000Z",
            createdByAuthUid: "shared_uid",
            createdByOperatorId: "operator_kim",
            updatedAt: "2026-08-10T00:00:00.000Z",
            updatedByAuthUid: "shared_uid",
            updatedByOperatorId: "operator_kim",
            archivedAt: "",
            archivedByAuthUid: "",
            archivedByOperatorId: "",
          },
        },
        buildingUnits: {
          unit_1: {
            id: "unit_1",
            crmBuildingId: "building_1",
            label: "201호",
            status: "active",
            memo: "",
            entityVersion: 4,
            createdAt: "2026-08-01T00:00:00.000Z",
            createdByAuthUid: "shared_uid",
            createdByOperatorId: "operator_kim",
            updatedAt: "2026-08-10T00:00:00.000Z",
            updatedByAuthUid: "shared_uid",
            updatedByOperatorId: "operator_kim",
            archivedAt: "",
            archivedByAuthUid: "",
            archivedByOperatorId: "",
          },
          unit_2: {
            id: "unit_2",
            crmBuildingId: "building_1",
            label: "202호",
            status: "active",
            memo: "",
            entityVersion: 1,
            createdAt: "2026-08-01T00:00:00.000Z",
            createdByAuthUid: "shared_uid",
            createdByOperatorId: "operator_kim",
            updatedAt: "2026-08-10T00:00:00.000Z",
            updatedByAuthUid: "shared_uid",
            updatedByOperatorId: "operator_kim",
            archivedAt: "",
            archivedByAuthUid: "",
            archivedByOperatorId: "",
          },
        },
        salesProspects: {
          prospect_1: {
            id: "prospect_1",
            name: "대학가 영업 건물",
            address: "강원 원주시 대학로 1",
            crmBuildingId: "building_1",
            archivedAt: "",
          },
        },
        salesUnits: {
          sales_unit_1: {
            id: "sales_unit_1",
            prospectId: "prospect_1",
            crmBuildingUnitId: "unit_1",
            label: "201호",
            status: "vacant",
            moveOutAt: "",
            deposit: 3_000_000,
            rent: 350_000,
            maintenanceFee: 50_000,
            photoUrl: "",
            evidenceUrl: "",
            note: "",
            entityVersion: 2,
            createdAt: "2026-08-01T00:00:00.000Z",
            createdByAuthUid: "shared_uid",
            createdByOperatorId: "operator_kim",
            updatedAt: "2026-08-10T00:00:00.000Z",
            updatedByAuthUid: "shared_uid",
            updatedByOperatorId: "operator_kim",
            archivedAt: "",
            archivedByAuthUid: "",
            archivedByOperatorId: "",
          },
        },
      },
      fieldSummaries: {},
    },
    fieldPlatform: {
      v2: {
        config: { release: release() },
        links: {
          crmBuildings: {},
          crmBuildingUnits: {},
          crmSalesUnits: {},
        },
        workItems: {},
        requestReceipts: { commitCanonicalCrmEntity: {} },
        auditLogs: {},
      },
    },
    ...overrides,
  };
}

function input(overrides: Partial<CanonicalCrmEntityInput> = {}): CanonicalCrmEntityInput {
  return {
    protocolVersion: 2,
    clientKind: "desktop",
    buildVersion: "1.8.0",
    operatorId: "operator_kim",
    requestId: REQUEST_ID,
    entityType: "buildingUnits",
    entityId: "unit_1",
    operation: "update",
    expectedVersion: 4,
    patch: { label: "203호" },
    reason: "호실 표기 확인",
    ...overrides,
  } as CanonicalCrmEntityInput;
}

function dependencies(initial = root()): {
  deps: CanonicalCrmDependencies;
  state: { current: unknown };
  transact: ReturnType<typeof vi.fn>;
} {
  const state = { current: initial as unknown };
  const transact = vi.fn(async (command) => {
    const decision = reduceCanonicalCrmEntityRoot(state.current, command);
    if (!decision.repeated) state.current = decision.root;
    return decision.result;
  });
  return {
    state,
    transact,
    deps: {
      authenticatedEmail: "team@bringcare.kr",
      now: () => NOW,
      transact,
    },
  };
}

function readPath(value: unknown, path: string): unknown {
  let current = value as Record<string, unknown>;
  for (const segment of path.split("/")) {
    current = current[segment] as Record<string, unknown>;
  }
  return current;
}

describe("canonical CRM entity commits", () => {
  it("updates a building unit only when its active parent exists and version matches", async () => {
    const fixture = dependencies();
    const result = await commitCanonicalCrmEntityCore(input(), ACTOR, fixture.deps);

    expect(result).toEqual({
      entityType: "buildingUnits",
      entityId: "unit_1",
      entityVersion: 5,
      updatedAt: NOW,
      archivedAt: "",
      repeated: false,
    });
    expect(readPath(fixture.state.current, "crmCompany/data/buildingUnits/unit_1")).toMatchObject({
      id: "unit_1",
      crmBuildingId: "building_1",
      label: "203호",
      entityVersion: 5,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: NOW,
    });
    expect(fixture.transact).toHaveBeenCalledTimes(1);
  });

  it("accepts the plan's unitLabel input alias but stores one canonical label", async () => {
    const fixture = dependencies();
    await commitCanonicalCrmEntityCore(input({ patch: { unitLabel: "203호" } }), ACTOR, fixture.deps);
    const stored = readPath(fixture.state.current, "crmCompany/data/buildingUnits/unit_1") as Record<string, unknown>;
    expect(stored.label).toBe("203호");
    expect(stored).not.toHaveProperty("unitLabel");
  });

  it("creates expectedVersion zero as version one with server-owned metadata", async () => {
    const fixture = dependencies();
    const result = await commitCanonicalCrmEntityCore(input({
      entityId: "unit_3",
      operation: "create",
      expectedVersion: 0,
      patch: {
        crmBuildingId: "building_1",
        label: "301호",
        status: "active",
        memo: "",
      },
    }), ACTOR, fixture.deps);
    expect(result.entityVersion).toBe(1);
    expect(readPath(fixture.state.current, "crmCompany/data/buildingUnits/unit_3")).toMatchObject({
      id: "unit_3",
      entityVersion: 1,
      createdAt: NOW,
      createdByAuthUid: "shared_uid",
      createdByOperatorId: "operator_kim",
      archivedAt: "",
    });
  });

  it("uses a monotonic server timestamp when the current record is ahead of the clock", async () => {
    const fixtureRoot = root();
    const unit = readPath(fixtureRoot, "crmCompany/data/buildingUnits/unit_1") as Record<string, unknown>;
    unit.updatedAt = "2026-08-15T00:00:00.000Z";
    const fixture = dependencies(fixtureRoot);
    const result = await commitCanonicalCrmEntityCore(input(), ACTOR, fixture.deps);
    expect(result.updatedAt).toBe("2026-08-15T00:00:00.001Z");
  });

  it.each([
    ["stale version", input({ expectedVersion: 3 }), "crm_entity_version_conflict"],
    ["create over existing", input({ operation: "create", expectedVersion: 0, patch: { crmBuildingId: "building_1", label: "201호" } }), "crm_entity_version_conflict"],
    ["missing create parent", input({ entityId: "unit_3", operation: "create", expectedVersion: 0, patch: { crmBuildingId: "missing", label: "301호" } }), "crm_parent_not_found"],
    ["immutable ID", input({ patch: { id: "other" } }), "crm_immutable_field_forbidden"],
    ["immutable parent", input({ patch: { crmBuildingId: "building_2" } }), "crm_immutable_field_forbidden"],
    ["unknown field", input({ patch: { label: "203호", surprise: true } }), "crm_patch_field_forbidden"],
    ["nested unknown ref", input({ entityType: "buildings", entityId: "building_1", patch: { externalRefs: { mysteryIds: ["x"] } } }), "crm_patch_field_forbidden"],
    ["secret key", input({ patch: { doorLockPassword: "1234" } }), "crm_secret_field_forbidden"],
    ["nested secret key", input({ entityType: "buildings", entityId: "building_1", patch: { externalRefs: { accessToken: "secret" } } }), "crm_secret_field_forbidden"],
  ])("rejects %s", async (_label, request, code) => {
    const fixture = dependencies();
    await expect(commitCanonicalCrmEntityCore(request as CanonicalCrmEntityInput, ACTOR, fixture.deps))
      .rejects.toThrow(code);
    const rootValidated = code === "crm_entity_version_conflict"
      || code === "crm_parent_not_found"
      || (_label === "immutable parent" && code === "crm_immutable_field_forbidden");
    expect(fixture.transact).toHaveBeenCalledTimes(rootValidated ? 1 : 0);
  });

  it("fails closed for a legacy existing entity without entityVersion", async () => {
    const fixtureRoot = root();
    delete (readPath(fixtureRoot, "crmCompany/data/buildingUnits/unit_1") as Record<string, unknown>).entityVersion;
    const fixture = dependencies(fixtureRoot);
    await expect(commitCanonicalCrmEntityCore(input(), ACTOR, fixture.deps))
      .rejects.toThrow("crm_entity_upgrade_required");
  });

  it.each([
    ["unknown stored field", (entity: Record<string, unknown>) => { entity.unexpected = true; }, "crm_entity_invalid"],
    ["secret-bearing stored field", (entity: Record<string, unknown>) => { entity.accessToken = "secret"; }, "crm_secret_field_forbidden"],
    ["invalid stored timestamp", (entity: Record<string, unknown>) => { entity.updatedAt = "yesterday"; }, "crm_entity_invalid"],
    ["unknown nested external ref", (entity: Record<string, unknown>) => { entity.externalRefs = { mysteryIds: ["x"] }; }, "crm_entity_invalid"],
  ])("fails closed for a canonical record with %s", async (_label, mutate, code) => {
    const fixtureRoot = root();
    mutate(readPath(fixtureRoot, "crmCompany/data/buildingUnits/unit_1") as Record<string, unknown>);
    const fixture = dependencies(fixtureRoot);
    await expect(commitCanonicalCrmEntityCore(input(), ACTOR, fixture.deps))
      .rejects.toThrow(code);
  });

  it("rejects empty update patches and physical-delete operations", async () => {
    const fixture = dependencies();
    await expect(commitCanonicalCrmEntityCore(input({ patch: {} }), ACTOR, fixture.deps))
      .rejects.toThrow("crm_patch_empty");
    await expect(commitCanonicalCrmEntityCore({
      ...input(),
      operation: "delete" as never,
    }, ACTOR, fixture.deps)).rejects.toThrow("crm_physical_delete_forbidden");
  });

  it("rejects missing, archived, and cross-building parents", async () => {
    const missing = dependencies();
    await expect(commitCanonicalCrmEntityCore(input({
      entityId: "unit_3",
      operation: "create",
      expectedVersion: 0,
      patch: { crmBuildingId: "missing", label: "301호" },
    }), ACTOR, missing.deps)).rejects.toThrow("crm_parent_not_found");

    const archivedRoot = root();
    (readPath(archivedRoot, "crmCompany/data/buildings/building_1") as Record<string, unknown>).archivedAt = "2026-08-13T00:00:00.000Z";
    const archived = dependencies(archivedRoot);
    await expect(commitCanonicalCrmEntityCore(input(), ACTOR, archived.deps))
      .rejects.toThrow("crm_parent_archived");

    const mismatch = dependencies();
    await expect(commitCanonicalCrmEntityCore(input({
      entityType: "salesUnits",
      entityId: "sales_unit_2",
      operation: "create",
      expectedVersion: 0,
      patch: {
        prospectId: "prospect_1",
        crmBuildingUnitId: "unit_1",
        label: "201호",
        status: "vacant",
      },
    }), ACTOR, mismatch.deps)).resolves.toMatchObject({ entityVersion: 1 });
  });

  it("enforces NFKC unit-label uniqueness among active units", async () => {
    const fixture = dependencies();
    await expect(commitCanonicalCrmEntityCore(input({ patch: { label: "２０２호" } }), ACTOR, fixture.deps))
      .rejects.toThrow("crm_building_unit_label_conflict");
  });

  it("allows an archived label to be reused but revalidates uniqueness on restore", async () => {
    const fixtureRoot = root();
    const existing = readPath(fixtureRoot, "crmCompany/data/buildingUnits/unit_2") as Record<string, unknown>;
    existing.archivedAt = "2026-08-13T00:00:00.000Z";
    existing.archivedByAuthUid = "shared_uid";
    existing.archivedByOperatorId = "operator_kim";
    const fixture = dependencies(fixtureRoot);
    await expect(commitCanonicalCrmEntityCore(input({ patch: { label: "202호" } }), ACTOR, fixture.deps))
      .resolves.toMatchObject({ entityVersion: 5 });

    const restoreRoot = root();
    const unit = readPath(restoreRoot, "crmCompany/data/buildingUnits/unit_1") as Record<string, unknown>;
    unit.label = "202호";
    unit.archivedAt = "2026-08-13T00:00:00.000Z";
    unit.archivedByAuthUid = "shared_uid";
    unit.archivedByOperatorId = "operator_kim";
    const restore = dependencies(restoreRoot);
    await expect(commitCanonicalCrmEntityCore(input({ operation: "restore", patch: {} }), ACTOR, restore.deps))
      .rejects.toThrow("crm_building_unit_label_conflict");
  });

  it("archives instead of deleting and preserves FIELD links and external references", async () => {
    const fixtureRoot = root();
    (fixtureRoot.fieldPlatform.v2.links.crmBuildingUnits as Record<string, unknown>).unit_1 = "field_unit_1";
    (fixtureRoot.fieldPlatform.v2.workItems as Record<string, unknown>).job_1 = {
      id: "job_1",
      crmBuildingUnitId: "unit_1",
    };
    (fixtureRoot.crmCompany.fieldSummaries as Record<string, unknown>).job_1 = {
      fieldJobId: "job_1",
      crmBuildingUnitId: "unit_1",
    };
    const fixture = dependencies(fixtureRoot);
    const result = await commitCanonicalCrmEntityCore(input({ operation: "archive", patch: {} }), ACTOR, fixture.deps);
    expect(result.archivedAt).toBe(NOW);
    expect(readPath(fixture.state.current, "fieldPlatform/v2/links/crmBuildingUnits/unit_1")).toBe("field_unit_1");
    expect(readPath(fixture.state.current, "crmCompany/data/buildingUnits/unit_1")).toMatchObject({
      archivedAt: NOW,
      archivedByAuthUid: "shared_uid",
      archivedByOperatorId: "operator_kim",
      entityVersion: 5,
    });
  });

  it("merges external references without allowing a canonical update to erase FIELD references", async () => {
    const fixture = dependencies();
    await commitCanonicalCrmEntityCore(input({
      entityType: "buildings",
      entityId: "building_1",
      expectedVersion: 4,
      patch: { externalRefs: { paymentBuildingIds: ["pay_2"] } },
    }), ACTOR, fixture.deps);
    expect(readPath(fixture.state.current, "crmCompany/data/buildings/building_1")).toMatchObject({
      externalRefs: {
        paymentBuildingIds: ["pay_2"],
        fieldBuildingIds: ["legacy_field_1"],
      },
    });
    const audits = Object.values(readPath(fixture.state.current, "fieldPlatform/v2/auditLogs") as Record<string, unknown>);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      changedFields: ["externalRefs.paymentBuildingIds"],
    });
  });

  it.each([
    ["building FIELD building IDs", input({
      entityType: "buildings",
      entityId: "building_1",
      expectedVersion: 4,
      patch: { externalRefs: { fieldBuildingIds: ["forged_field_building"] } },
    })],
    ["building FIELD work-item IDs mixed with payment IDs", input({
      entityType: "buildings",
      entityId: "building_1",
      expectedVersion: 4,
      patch: {
        externalRefs: {
          paymentBuildingIds: ["pay_2"],
          fieldWorkItemIds: ["forged_work_item"],
        },
      },
    })],
    ["building-unit external references", input({
      patch: { externalRefs: { fieldUnitIds: ["forged_field_unit"] } },
    })],
    ["sales-unit external references", input({
      entityType: "salesUnits",
      entityId: "sales_unit_1",
      expectedVersion: 2,
      patch: { externalRefs: { fieldListingIds: ["forged_listing"] } },
    })],
  ])("rejects client-controlled %s", async (_label, request) => {
    const fixture = dependencies();
    await expect(commitCanonicalCrmEntityCore(request, ACTOR, fixture.deps))
      .rejects.toThrow("crm_patch_field_forbidden");
    expect(fixture.transact).not.toHaveBeenCalled();
  });

  it.each([
    ["building type", "buildings", "crmCompany/data/buildings/building_1", (entity: Record<string, unknown>) => { entity.type = "x".repeat(257); }],
    ["building status", "buildings", "crmCompany/data/buildings/building_1", (entity: Record<string, unknown>) => { entity.status = "x".repeat(257); }],
    ["building manager", "buildings", "crmCompany/data/buildings/building_1", (entity: Record<string, unknown>) => { entity.manager = "x".repeat(257); }],
    ["building memo", "buildings", "crmCompany/data/buildings/building_1", (entity: Record<string, unknown>) => { entity.memo = "x".repeat(4_001); }],
    ["building unit count", "buildings", "crmCompany/data/buildings/building_1", (entity: Record<string, unknown>) => { entity.unitCount = -1; }],
    ["building alias list", "buildings", "crmCompany/data/buildings/building_1", (entity: Record<string, unknown>) => { entity.aliases = Array.from({ length: 101 }, (_, index) => `alias_${index}`); }],
    ["building undefined optional owner", "buildings", "crmCompany/data/buildings/building_1", (entity: Record<string, unknown>) => { entity.ownerCustomerId = undefined; }],
    ["building-unit status", "buildingUnits", "crmCompany/data/buildingUnits/unit_1", (entity: Record<string, unknown>) => { entity.status = "x".repeat(257); }],
    ["building-unit memo", "buildingUnits", "crmCompany/data/buildingUnits/unit_1", (entity: Record<string, unknown>) => { entity.memo = "x".repeat(4_001); }],
    ["building-unit undefined external references", "buildingUnits", "crmCompany/data/buildingUnits/unit_1", (entity: Record<string, unknown>) => { entity.externalRefs = undefined; }],
    ["sales-unit money", "salesUnits", "crmCompany/data/salesUnits/sales_unit_1", (entity: Record<string, unknown>) => { entity.deposit = -1; }],
    ["sales-unit date", "salesUnits", "crmCompany/data/salesUnits/sales_unit_1", (entity: Record<string, unknown>) => { entity.availableFrom = "2026-99-99"; }],
    ["sales-unit URL", "salesUnits", "crmCompany/data/salesUnits/sales_unit_1", (entity: Record<string, unknown>) => { entity.photoUrl = "x".repeat(4_001); }],
    ["sales-unit note", "salesUnits", "crmCompany/data/salesUnits/sales_unit_1", (entity: Record<string, unknown>) => { entity.note = "x".repeat(4_001); }],
    ["sales-unit status", "salesUnits", "crmCompany/data/salesUnits/sales_unit_1", (entity: Record<string, unknown>) => { entity.status = "x".repeat(257); }],
    ["sales-unit undefined formal-room link", "salesUnits", "crmCompany/data/salesUnits/sales_unit_1", (entity: Record<string, unknown>) => { entity.crmBuildingUnitId = undefined; }],
  ])("fails closed before updating a record with invalid stored %s", async (
    _label,
    entityType,
    path,
    mutate,
  ) => {
    const fixtureRoot = root();
    mutate(readPath(fixtureRoot, path) as Record<string, unknown>);
    const fixture = dependencies(fixtureRoot);
    const request = entityType === "buildings"
      ? input({
        entityType: "buildings",
        entityId: "building_1",
        expectedVersion: 4,
        patch: { name: "Updated building" },
      })
      : entityType === "salesUnits"
        ? input({
          entityType: "salesUnits",
          entityId: "sales_unit_1",
          expectedVersion: 2,
          patch: { note: "Unrelated update" },
        })
        : input({ patch: { label: "203" } });
    await expect(commitCanonicalCrmEntityCore(request, ACTOR, fixture.deps))
      .rejects.toThrow("crm_entity_invalid");
  });

  it.each([
    "2026-99-99",
    "2025-02-29",
  ])("rejects a non-Gregorian calendar date %s", async (moveOutAt) => {
    const fixture = dependencies();
    await expect(commitCanonicalCrmEntityCore(input({
      entityType: "salesUnits",
      entityId: "sales_unit_1",
      expectedVersion: 2,
      patch: { moveOutAt },
    }), ACTOR, fixture.deps)).rejects.toThrow("crm_moveOutAt_invalid");
    expect(fixture.transact).not.toHaveBeenCalled();
  });

  it.each([
    "2024-02-29",
    "2026-08-14T04:00:00.000Z",
  ])("accepts a real calendar date or canonical timestamp %s", async (moveOutAt) => {
    const fixture = dependencies();
    await expect(commitCanonicalCrmEntityCore(input({
      entityType: "salesUnits",
      entityId: "sales_unit_1",
      expectedVersion: 2,
      patch: { moveOutAt },
    }), ACTOR, fixture.deps)).resolves.toMatchObject({ entityVersion: 3 });
  });

  it.each([
    ["audit log collection", (fixtureRoot: ReturnType<typeof root>) => {
      fixtureRoot.fieldPlatform.v2.auditLogs = "corrupt" as never;
    }, "fieldPlatform/v2/auditLogs"],
    ["receipt scope", (fixtureRoot: ReturnType<typeof root>) => {
      fixtureRoot.fieldPlatform.v2.requestReceipts.commitCanonicalCrmEntity = "corrupt" as never;
    }, "fieldPlatform/v2/requestReceipts/commitCanonicalCrmEntity"],
    ["entity collection", (fixtureRoot: ReturnType<typeof root>) => {
      fixtureRoot.crmCompany.data.buildingUnits = "corrupt" as never;
    }, "crmCompany/data/buildingUnits"],
  ])("fails closed instead of overwriting a scalar %s", async (_label, corrupt, path) => {
    const fixtureRoot = root();
    corrupt(fixtureRoot);
    const fixture = dependencies(fixtureRoot);
    const request = path.endsWith("buildingUnits")
      ? input({
        entityId: "unit_3",
        operation: "create",
        expectedVersion: 0,
        patch: { crmBuildingId: "building_1", label: "301" },
      })
      : input();
    await expect(commitCanonicalCrmEntityCore(request, ACTOR, fixture.deps))
      .rejects.toThrow("crm_transaction_invalid");
    expect(readPath(fixtureRoot, path)).toBe("corrupt");
  });

  it("maintains the owner customer's building backlink atomically on create", async () => {
    const fixtureRoot = root();
    (readPath(fixtureRoot, "crmCompany/data/customers/customer_1") as Record<string, unknown>).buildingIds = ["building_1"];
    const fixture = dependencies(fixtureRoot);
    await commitCanonicalCrmEntityCore(input({
      entityType: "buildings",
      entityId: "building_2",
      operation: "create",
      expectedVersion: 0,
      patch: {
        name: "새 원룸",
        address: "강원 원주시 새길 1",
        ownerCustomerId: "customer_1",
      },
    }), ACTOR, fixture.deps);
    expect(readPath(fixture.state.current, "crmCompany/data/customers/customer_1/buildingIds"))
      .toEqual(["building_1", "building_2"]);
  });

  it("allows creating a building without an owner link", async () => {
    const fixture = dependencies();
    await expect(commitCanonicalCrmEntityCore(input({
      entityType: "buildings",
      entityId: "building_2",
      operation: "create",
      expectedVersion: 0,
      patch: {
        name: "새 원룸",
        address: "강원 원주시 새길 1",
      },
    }), ACTOR, fixture.deps)).resolves.toMatchObject({ entityVersion: 1 });
  });

  it("blocks normal updates to archived entities until an explicit restore", async () => {
    const fixtureRoot = root();
    const entity = readPath(fixtureRoot, "crmCompany/data/buildingUnits/unit_1") as Record<string, unknown>;
    entity.archivedAt = "2026-08-13T00:00:00.000Z";
    entity.archivedByAuthUid = "shared_uid";
    entity.archivedByOperatorId = "operator_kim";
    const fixture = dependencies(fixtureRoot);
    await expect(commitCanonicalCrmEntityCore(input(), ACTOR, fixture.deps))
      .rejects.toThrow("crm_entity_archived");
  });

  it("requires a sales prospect canonical building before linking a formal room", async () => {
    const fixtureRoot = root();
    delete (readPath(fixtureRoot, "crmCompany/data/salesProspects/prospect_1") as Record<string, unknown>).crmBuildingId;
    const fixture = dependencies(fixtureRoot);
    await expect(commitCanonicalCrmEntityCore(input({
      entityType: "salesUnits",
      entityId: "sales_unit_2",
      operation: "create",
      expectedVersion: 0,
      patch: {
        prospectId: "prospect_1",
        crmBuildingUnitId: "unit_1",
        label: "201호",
      },
    }), ACTOR, fixture.deps)).rejects.toThrow("crm_parent_mismatch");
  });

  it("permits one verified formal-room link but never silently changes it", async () => {
    const fixture = dependencies();
    await expect(commitCanonicalCrmEntityCore(input({
      entityType: "salesUnits",
      entityId: "sales_unit_1",
      expectedVersion: 2,
      patch: { crmBuildingUnitId: "unit_2" },
    }), ACTOR, fixture.deps)).rejects.toThrow("crm_immutable_field_forbidden");
  });

  it("does not allow ownerCustomerId changes without an atomic inverse update", async () => {
    const fixture = dependencies();
    await expect(commitCanonicalCrmEntityCore(input({
      entityType: "buildings",
      entityId: "building_1",
      expectedVersion: 4,
      patch: { ownerCustomerId: "customer_2" },
    }), ACTOR, fixture.deps)).rejects.toThrow("crm_owner_change_requires_atomic_link");
  });

  it("creates a building only with an active existing owner and validates it again on restore", async () => {
    const fixture = dependencies();
    await expect(commitCanonicalCrmEntityCore(input({
      entityType: "buildings",
      entityId: "building_2",
      operation: "create",
      expectedVersion: 0,
      patch: {
        name: "새 원룸",
        address: "강원 원주시 새길 1",
        ownerCustomerId: "customer_1",
      },
    }), ACTOR, fixture.deps)).resolves.toMatchObject({ entityVersion: 1 });

    const invalid = dependencies();
    await expect(commitCanonicalCrmEntityCore(input({
      entityType: "buildings",
      entityId: "building_2",
      operation: "create",
      expectedVersion: 0,
      patch: {
        name: "새 원룸",
        address: "강원 원주시 새길 1",
        ownerCustomerId: "missing",
      },
    }), ACTOR, invalid.deps)).rejects.toThrow("crm_parent_not_found");
  });

  it("returns an exact replay without another version or audit record", async () => {
    const fixture = dependencies();
    const first = await commitCanonicalCrmEntityCore(input(), ACTOR, fixture.deps);
    const auditBefore = Object.keys(readPath(fixture.state.current, "fieldPlatform/v2/auditLogs") as object);
    const second = await commitCanonicalCrmEntityCore(input(), ACTOR, fixture.deps);
    const auditAfter = Object.keys(readPath(fixture.state.current, "fieldPlatform/v2/auditLogs") as object);
    expect(first.entityVersion).toBe(5);
    expect(second).toEqual({ ...first, repeated: true });
    expect(auditAfter).toEqual(auditBefore);
    expect((readPath(fixture.state.current, "crmCompany/data/buildingUnits/unit_1") as Record<string, unknown>).entityVersion).toBe(5);
  });

  it("fingerprints unitLabel and label as the same canonical request", async () => {
    const fixture = dependencies();
    const first = await commitCanonicalCrmEntityCore(input({ patch: { unitLabel: "203호" } }), ACTOR, fixture.deps);
    const second = await commitCanonicalCrmEntityCore(input({ patch: { label: "203호" } }), ACTOR, fixture.deps);
    expect(second).toEqual({ ...first, repeated: true });
  });

  it("rejects the same requestId with a different canonical request hash", async () => {
    const fixture = dependencies();
    await commitCanonicalCrmEntityCore(input(), ACTOR, fixture.deps);
    await expect(commitCanonicalCrmEntityCore(input({ patch: { label: "204호" } }), ACTOR, fixture.deps))
      .rejects.toThrow("crm_request_id_conflict");
  });

  it("allows a current viewer to read an exact receipt but not create a new mutation", async () => {
    const fixture = dependencies();
    const first = await commitCanonicalCrmEntityCore(input(), ACTOR, fixture.deps);
    const viewerRoot = fixture.state.current as ReturnType<typeof root>;
    viewerRoot.crmCompany.access.shared_uid.role = "viewer";
    const viewer = { ...ACTOR, role: "viewer" } as const;
    await expect(commitCanonicalCrmEntityCore(input(), viewer, fixture.deps))
      .resolves.toEqual({ ...first, repeated: true });
    await expect(commitCanonicalCrmEntityCore(input({
      requestId: "223e4567-e89b-42d3-a456-426614174000",
      expectedVersion: 5,
      patch: { label: "204호" },
    }), viewer, fixture.deps)).rejects.toThrow("crm_mutation_forbidden");
  });

  it.each([
    ["disabled access", (value: ReturnType<typeof root>) => { value.crmCompany.access.shared_uid.enabled = false as true; }, "crm_access_forbidden"],
    ["inactive profile", (value: ReturnType<typeof root>) => { value.crmCompany.teamProfiles.operator_kim.active = false; }, "crm_operator_inactive"],
    ["safe mode", (value: ReturnType<typeof root>) => { value.fieldPlatform.v2.config.release.safeMode = true; }, "crm_safe_mode_read_only"],
    ["canonical flag off", (value: ReturnType<typeof root>) => { value.fieldPlatform.v2.config.release.canonicalCrmEnabled = false; }, "crm_canonical_writes_disabled"],
    ["v2 writes off", (value: ReturnType<typeof root>) => { value.fieldPlatform.v2.config.release.v2WritesEnabled = false; }, "crm_v2_writes_disabled"],
    ["build incompatible", (value: ReturnType<typeof root>) => { value.fieldPlatform.v2.config.release.minDesktopVersion = "1.9.0"; }, "field_client_upgrade_required"],
  ])("rechecks current %s inside the commit transaction", async (_label, mutate, code) => {
    const fixtureRoot = root();
    mutate(fixtureRoot);
    const fixture = dependencies(fixtureRoot);
    await expect(commitCanonicalCrmEntityCore(input(), ACTOR, fixture.deps)).rejects.toThrow(code);
  });

  it("keeps receipts and audits closed and secret-free", async () => {
    const fixture = dependencies();
    await commitCanonicalCrmEntityCore(input(), ACTOR, fixture.deps);
    const receipts = readPath(fixture.state.current, "fieldPlatform/v2/requestReceipts/commitCanonicalCrmEntity") as Record<string, unknown>;
    const receipt = receipts[REQUEST_ID] as Record<string, unknown>;
    expect(Object.keys(receipt).sort()).toEqual(["createdAt", "requestHash", "requestId", "result", "scope"]);
    const audits = Object.values(readPath(fixture.state.current, "fieldPlatform/v2/auditLogs") as Record<string, unknown>);
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0])).not.toContain("203호");
    expect(audits[0]).not.toHaveProperty("patch");
    expect(audits[0]).toMatchObject({
      entityType: "buildingUnits",
      entityId: "unit_1",
      beforeVersion: 4,
      afterVersion: 5,
      authUid: "shared_uid",
      operatorId: "operator_kim",
      reasonProvided: true,
      changedFields: ["label"],
    });
  });
});
