// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { get, ref, remove, set, update } from "firebase/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const PROJECT_ID = "demo-bring-field-platform";
const CUTOVER_PROJECT_ID = "demo-bring-field-cutover";
const NOW = "2026-08-09T00:00:00.000Z";

let environment: RulesTestEnvironment;
let cutoverEnvironment: RulesTestEnvironment;
const databaseEmulatorAvailable = Boolean(
  process.env.FIREBASE_DATABASE_EMULATOR_HOST,
);

function claims(role: "staff" | "reviewer" | "admin") {
  return { fieldPlatform: true, fieldRole: role, email_verified: true };
}

function crmClaims(email: string) {
  return { email, email_verified: true };
}

const CRM_ACCESS = {
  "crm-admin": {
    enabled: true,
    email: "admin@bring.test",
    role: "admin",
    operatorId: "operator_kim",
  },
  "crm-member": {
    enabled: true,
    email: "member@bring.test",
    role: "member",
    operatorId: "operator_kim",
  },
  "crm-viewer": {
    enabled: true,
    email: "viewer@bring.test",
    role: "viewer",
    operatorId: "operator_kim",
  },
  "crm-disabled": {
    enabled: false,
    email: "disabled@bring.test",
    role: "member",
    operatorId: "operator_kim",
  },
  "crm-invalid-role": {
    enabled: true,
    email: "invalid@bring.test",
    role: "owner",
    operatorId: "operator_kim",
  },
} as const;

const CRM_DATA = {
  buildings: { building_1: {
    id: "building_1",
    name: "Canonical building",
    address: "원주시 우산동",
    entityVersion: 1,
    createdAt: NOW,
    createdByAuthUid: "crm-member",
    createdByOperatorId: "operator_kim",
    updatedAt: NOW,
    updatedByAuthUid: "crm-member",
    updatedByOperatorId: "operator_kim",
    archivedAt: "",
    archivedByAuthUid: "",
    archivedByOperatorId: "",
    vacantUnitCount: 0,
    vacantUnits: [],
  } },
  buildingUnits: {
    building_unit_1: {
      id: "building_unit_1",
      crmBuildingId: "building_1",
      label: "101",
      floorLabel: "1층",
      floorOrder: 1,
      unitOrder: 1,
      status: "occupied",
      moveOutAt: "",
      availableFrom: "",
      memo: "",
      entityVersion: 1,
      createdAt: NOW,
      createdByAuthUid: "crm-member",
      createdByOperatorId: "operator_kim",
      updatedAt: NOW,
      updatedByAuthUid: "crm-member",
      updatedByOperatorId: "operator_kim",
      archivedAt: "",
      archivedByAuthUid: "",
      archivedByOperatorId: "",
    },
  },
  salesUnits: {
    sales_unit_1: {
      id: "sales_unit_1",
      prospectId: "prospect_1",
      label: "101",
      entityVersion: 1,
      createdAt: NOW,
      createdByAuthUid: "crm-member",
      createdByOperatorId: "operator_kim",
      updatedAt: NOW,
      updatedByAuthUid: "crm-member",
      updatedByOperatorId: "operator_kim",
      archivedAt: "",
      archivedByAuthUid: "",
      archivedByOperatorId: "",
    },
  },
  salesProspects: { prospect_1: { id: "prospect_1", name: "Canonical prospect" } },
  customers: {
    customer_1: {
      id: "customer_1",
      name: "Legacy owner",
      buildingIdLinks: { building_1: true },
    },
  },
  tasks: { task_1: { id: "task_1", title: "Legacy task" } },
};

function marketingLead(requestId = "lead_01JMARKETINGREQUEST000000001") {
  return {
    requestId,
    name: "김건물",
    phone: "010-1234-5678",
    location: "원주시 단계동",
    needs: "4층 원룸 계단을 월 4회 청소하고 싶습니다.",
    buildingInfo: "4층 16세대",
    customerType: "building_owner",
    service: "계단·공용부 청소",
    sourcePath: "/stair-cleaning",
    utmSource: "naver",
    utmCampaign: "stair-launch",
    utmTerm: "원주계단청소",
    consent: true,
    submittedAt: Date.now(),
    status: "new",
  };
}

const TEAM_PROFILES = {
  operator_lee: {
    displayName: "이지",
    active: true,
    sortOrder: 10,
  },
  operator_kim: {
    displayName: "김현진",
    active: true,
    sortOrder: 20,
  },
  operator_inactive: {
    displayName: "비활성 운영자",
    active: false,
    sortOrder: 99,
  },
} as const;

function user(
  id: string,
  role: "staff" | "reviewer" | "admin",
  enabled = true,
) {
  return {
    id,
    email: `${id}@bring.example`,
    displayName: id,
    role,
    enabled,
  };
}

function managementContract(
  status: "none" | "pending" | "active" | "paused" | "ended" = "active",
) {
  return {
    status,
    ...(status === "none" ? {} : { startedOn: "2026-08-09" }),
    ...(status === "ended" ? { endedOn: "2026-12-31" } : {}),
    updatedAt: NOW,
    updatedBy: "admin-1",
  };
}

function building(id = "building-1") {
  return {
    id,
    managementNumber: "BR-WJ-TEST-26-0001",
    name: "테스트 빌딩",
    roadAddress: "강원특별자치도 원주시 서원대로 1",
    latitude: 37.3422,
    longitude: 127.9202,
    parking: { available: true, totalSpaces: 8 },
    assignedStaffIds: ["staff-1"],
    createdAt: NOW,
    createdBy: "admin-1",
    updatedAt: NOW,
    updatedBy: "admin-1",
  };
}

function listing(id = "listing-1") {
  return {
    id,
    buildingId: "building-1",
    unitId: "unit-1",
    unitLabel: "201호",
    status: "draft",
    depositWon: 3_000_000,
    monthlyRentWon: 350_000,
    maintenanceFeeWon: 0,
    maintenanceFeeItems: [],
    parkingDescription: "1대 가능",
    petPolicy: "확인 필요",
    options: [],
    advertisingApproved: false,
    createdAt: NOW,
    createdBy: "staff-1",
    updatedAt: NOW,
    updatedBy: "staff-1",
  };
}

async function seed() {
  await environment.withSecurityRulesDisabled(async (context) => {
    await set(ref(context.database(), "fieldPlatform"), {
      users: {
        "staff-1": user("staff-1", "staff"),
        "staff-2": user("staff-2", "staff"),
        "reviewer-1": user("reviewer-1", "reviewer"),
        "admin-1": user("admin-1", "admin"),
        "disabled-1": user("disabled-1", "admin", false),
        "disabled-staff": user("disabled-staff", "staff", false),
        "email-only": user("email-only", "admin"),
        "stale-admin": user("stale-admin", "staff"),
      },
      buildings: {
        "building-1": {
          ...building(),
          managementContract: managementContract("active"),
        },
        "building-legacy": building("building-legacy"),
        "building-unassigned": building("building-unassigned"),
      },
      buildingAssignments: {
        "building-1": {
          "staff-1": true,
          "reviewer-1": true,
          "disabled-1": true,
          "disabled-staff": true,
        },
      },
      ownerNotes: {
        "building-1": {
          "note_12345678": {
            id: "note_12345678",
            buildingId: "building-1",
            body: "서버 저장 메모",
            recordedAt: NOW,
            createdAt: NOW,
            createdBy: "staff-1",
            createdByName: "담당 직원",
          },
        },
      },
      units: {
        "unit-1": { id: "unit-1", buildingId: "building-1", unitLabel: "201호" },
        "unit-unassigned": {
          id: "unit-unassigned",
          buildingId: "building-unassigned",
          unitLabel: "301호",
        },
      },
      listings: {
        "listing-1": listing(),
        "listing-unassigned": {
          ...listing("listing-unassigned"),
          buildingId: "building-unassigned",
        },
      },
      visits: {
        "visit-1": {
          id: "visit-1",
          buildingId: "building-1",
          type: "initial",
          assignedUserId: "staff-1",
        },
        "visit-unassigned": {
          id: "visit-unassigned",
          buildingId: "building-unassigned",
          type: "initial",
          assignedUserId: "staff-1",
        },
      },
      captureSessions: {
        "11111111-1111-4111-8111-111111111111": {
          id: "11111111-1111-4111-8111-111111111111",
          requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          buildingId: "building-1",
          visitId: "visit-1",
          createdBy: "staff-1",
          status: "open",
          createdAt: NOW,
          updatedAt: NOW,
        },
        "22222222-2222-4222-8222-222222222222": {
          id: "22222222-2222-4222-8222-222222222222",
          requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          buildingId: "building-unassigned",
          visitId: "visit-unassigned",
          createdBy: "staff-2",
          status: "open",
          createdAt: NOW,
          updatedAt: NOW,
        },
      },
      media: {
        "media-1": {
          id: "media-1",
          requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          buildingId: "building-1",
          visitId: "visit-1",
          captureSessionId: "11111111-1111-4111-8111-111111111111",
          capturedBy: "staff-1",
          uploadState: "finalized",
          uploadProgress: 100,
          driveSyncState: "queued",
        },
        "media-unassigned": {
          id: "media-unassigned",
          requestId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          buildingId: "building-unassigned",
          visitId: "visit-unassigned",
          captureSessionId: "22222222-2222-4222-8222-222222222222",
          capturedBy: "staff-1",
          uploadState: "finalized",
          uploadProgress: 100,
          driveSyncState: "queued",
        },
      },
      secureAccess: {
        "access-1": {
          id: "access-1",
          buildingId: "building-1",
          commonDoorAccess: "TEST-DOOR-SECRET",
          updatedAt: NOW,
          updatedBy: "admin-1",
        },
      },
      secureAccessAssignments: {
        "building-1": { "staff-1": true, "disabled-1": true },
      },
      adPackages: {
        "package-1": {
          id: "package-1",
          listingId: "listing-1",
          status: "draft",
          version: 1,
          representativeMediaIds: [],
          allApprovedMediaIds: [],
          daangnDescription: "",
          naverListingFields: {},
          createdAt: NOW,
          createdBy: "staff-1",
        },
      },
      checklistTemplates: { "template-1": { id: "template-1" } },
      checklistSubmissions: { "submission-1": { id: "submission-1" } },
      auditLogs: { "event-1": { action: "seeded" } },
      driveSyncJobs: { "job-1": { status: "queued" } },
      mapProjections: {
        "building-1": {
          buildingId: "building-1",
          name: "테스트 빌딩",
          roadAddress: "강원특별자치도 원주시 서원대로 1",
          latitude: 37.3422,
          longitude: 127.9202,
          markerStatus: "managed",
          vacancyCount: 0,
          approvedRentSummary: "",
          parkingSummary: "8대",
          captureStatus: "notStarted",
          updatedAt: NOW,
        },
      },
      registrationRequests: {
        "admin-1": { "request-1": { buildingId: "building-1" } },
      },
      managementContractRequests: {
        "admin-1": { "request-1": { buildingId: "building-1" } },
      },
      v2: {
        config: { release: { protocolVersion: 2 } },
        policies: { policy_1: { policyVersion: "policy_1" } },
        workItems: { job_1: { jobId: "job_1", updatedAt: NOW } },
        visits: { visit_1: { visitId: "visit_1", updatedAt: NOW } },
        captureSessions: { session_1: { sessionId: "session_1" } },
        media: { media_1: { mediaId: "media_1" } },
        uploadJobs: { media_1: { mediaId: "media_1" } },
        reviews: { review_1: { reviewId: "review_1" } },
        adPackages: { package_1: { packageId: "package_1" } },
        channelPublications: {
          publication_1: { publicationId: "publication_1" },
        },
        auditLogs: { audit_1: { auditId: "audit_1" } },
        projections: {
          operatorJobs: {
            operator_kim: { job_1: { jobId: "job_1", updatedAt: NOW } },
            operator_hwang: { job_2: { jobId: "job_2", updatedAt: NOW } },
          },
          unassigned: { job_3: { jobId: "job_3", updatedAt: NOW } },
          teamActive: {
            job_1: { jobId: "job_1", activeOrderKey: `${NOW}|job_1` },
          },
          teamKpis: { daily: { date: "2026-08-09" } },
          teamVisitState: { visit_1: { visitId: "visit_1" } },
          map: { building_1: { entityId: "building_1" } },
        },
        links: { crmBuildings: { building_1: "field_building_1" } },
        notifications: {
          operator_kim: { notification_1: { notificationId: "notification_1" } },
        },
        candidates: { candidate_1: { candidateId: "candidate_1" } },
        requestReceipts: { create: { request_1: { requestId: "request_1" } } },
        migrationRuns: { run_1: { runId: "run_1" } },
      },
    });
    await set(ref(context.database(), "crmCompany"), {
      access: CRM_ACCESS,
      data: CRM_DATA,
      teamProfiles: TEAM_PROFILES,
      fieldSummaries: {
        job_1: {
          fieldJobId: "job_1",
          workflowStatus: "assigned",
          updatedAt: NOW,
        },
      },
    });
  });
}

async function seedCutover() {
  await cutoverEnvironment.withSecurityRulesDisabled(async (context) => {
    await set(ref(context.database(), "crmCompany"), {
      access: CRM_ACCESS,
      teamProfiles: TEAM_PROFILES,
      data: CRM_DATA,
    });
  });
}

async function exerciseCustomerBuildingLinkRules(testEnvironment: RulesTestEnvironment) {
  const unauthenticated = testEnvironment.unauthenticatedContext().database();
  const admin = testEnvironment.authenticatedContext(
    "crm-admin",
    crmClaims("admin@bring.test"),
  ).database();
  const member = testEnvironment.authenticatedContext(
    "crm-member",
    crmClaims("member@bring.test"),
  ).database();
  const viewer = testEnvironment.authenticatedContext(
    "crm-viewer",
    crmClaims("viewer@bring.test"),
  ).database();
  const disabled = testEnvironment.authenticatedContext(
    "crm-disabled",
    crmClaims("disabled@bring.test"),
  ).database();
  const wrongEmail = testEnvironment.authenticatedContext(
    "crm-member",
    crmClaims("wrong@bring.test"),
  ).database();
  const customerPath = "crmCompany/data/customers/customer_1";

  await assertSucceeds(update(ref(member, customerPath), { phone: "010-1234-5678" }));
  await assertSucceeds(update(ref(admin, customerPath), { memo: "admin field update" }));

  for (const [database, buildingId] of [
    [unauthenticated, "building_unauthenticated"],
    [viewer, "building_viewer"],
    [disabled, "building_disabled"],
    [wrongEmail, "building_wrong_email"],
  ] as const) {
    await assertFails(set(
      ref(database, `${customerPath}/buildingIdLinks/${buildingId}`),
      true,
    ));
  }
  await assertFails(set(
    ref(member, `${customerPath}/buildingIdLinks/building_false`),
    false,
  ));
  await assertFails(set(
    ref(member, `${customerPath}/buildingIdLinks/building_1`),
    true,
  ));
  await assertFails(remove(
    ref(member, `${customerPath}/buildingIdLinks/building_1`),
  ));

  await assertSucceeds(set(
    ref(member, `${customerPath}/buildingIdLinks/building_member`),
    true,
  ));
  await assertSucceeds(set(
    ref(admin, `${customerPath}/buildingIdLinks/building_admin`),
    true,
  ));
  await assertFails(remove(
    ref(admin, `${customerPath}/buildingIdLinks/building_admin`),
  ));

  const linkedCustomer = (await assertSucceeds(get(ref(member, customerPath)))).val();
  await assertFails(set(ref(member, customerPath), {
    ...linkedCustomer,
    name: "whole-record overwrite must be rejected",
  }));

  const legacyPath = "crmCompany/data/customers/customer_legacy_unlinked";
  await assertSucceeds(set(ref(member, legacyPath), {
    id: "customer_legacy_unlinked",
    name: "Legacy compatible customer",
  }));
  await assertSucceeds(set(ref(member, legacyPath), {
    id: "customer_legacy_unlinked",
    name: "Legacy compatible customer updated",
  }));
  await assertSucceeds(remove(ref(member, legacyPath)));

  await assertSucceeds(update(ref(member, "crmCompany/data"), {
    "customers/customer_field_patch/id": "customer_field_patch",
    "customers/customer_field_patch/name": "Field-scoped customer",
  }));
  expect((await get(ref(member, "crmCompany/data/customers/customer_field_patch/name"))).val())
    .toBe("Field-scoped customer");
  await assertSucceeds(update(ref(member, "crmCompany/data"), {
    "customers/customer_field_patch/id": null,
    "customers/customer_field_patch/name": null,
  }));
  expect((await get(ref(member, "crmCompany/data/customers/customer_field_patch"))).exists())
    .toBe(false);
}

async function exerciseAtomicBuildingCreateWithCustomerLink(
  testEnvironment: RulesTestEnvironment,
) {
  const member = testEnvironment.authenticatedContext(
    "crm-member",
    crmClaims("member@bring.test"),
  ).database();
  const buildingId = "building_atomic_link";
  const requestId = "request_atomic_link";
  const auditId = "audit_atomic_link";
  const createdAt = "2026-08-09T00:00:02.000Z";
  const patch = {
    [`buildings/${buildingId}`]: {
      id: buildingId,
      name: "Atomic linked building",
      address: "Wonju atomic address",
      ownerCustomerId: "customer_1",
      entityVersion: 1,
      createdAt,
      createdByAuthUid: "crm-member",
      createdByOperatorId: "operator_kim",
      updatedAt: createdAt,
      updatedByAuthUid: "crm-member",
      updatedByOperatorId: "operator_kim",
      archivedAt: "",
      archivedByAuthUid: "",
      archivedByOperatorId: "",
    },
    [`customers/customer_1/buildingIdLinks/${buildingId}`]: true,
    [`canonicalReceipts/${requestId}`]: {
      scope: "sparkCanonicalCrmEntityV1",
      requestId,
      requestHash: "b".repeat(64),
      actorUid: "crm-member",
      result: { entityId: buildingId, entityVersion: 1 },
      createdAt,
    },
    [`canonicalAuditLogs/${auditId}`]: {
      id: auditId,
      scope: "sparkCanonicalCrmEntityV1",
      requestId,
      authUid: "crm-member",
      operatorId: "operator_kim",
      occurredAt: createdAt,
      action: "crm.canonical.buildings.create",
      entityType: "buildings",
      entityId: buildingId,
      beforeVersion: 0,
      afterVersion: 1,
      changedFields: ["ownerCustomerId"],
      reason: "atomic building create test",
    },
  };

  await assertSucceeds(update(ref(member, "crmCompany/data"), patch));
  expect((await get(ref(
    member,
    `crmCompany/data/customers/customer_1/buildingIdLinks/${buildingId}`,
  ))).val()).toBe(true);
  await assertFails(update(ref(member, "crmCompany/data"), patch));
}

beforeAll(async () => {
  if (!databaseEmulatorAvailable) return;
  environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    database: {
      host: "127.0.0.1",
      port: 9000,
      rules: await readFile(resolve("../database.rules.json"), "utf8"),
    },
  });
  cutoverEnvironment = await initializeTestEnvironment({
    projectId: CUTOVER_PROJECT_ID,
    database: {
      host: "127.0.0.1",
      port: 9000,
      rules: await readFile(
        resolve("tests/field/fixtures/database-cutover.rules.json"),
        "utf8",
      ),
    },
  });
});

describe("field media database rule source", () => {
  it("allows only claimed internal users to persist completed direct-Drive media", async () => {
    const source = JSON.parse(
      await readFile(resolve("../database.rules.json"), "utf8"),
    ) as { rules: { fieldPlatform: Record<string, unknown> } };
    const fieldPlatform = source.rules.fieldPlatform as Record<
      string,
      Record<string, unknown>
    >;
    const media = fieldPlatform.media;
    const sessions = fieldPlatform.captureSessions;

    expect(String(media[".write"])).toContain("auth.token.fieldPlatform === true");
    expect(String(media[".write"])).toContain("root.child('fieldPlatform/users')");
    expect(String(sessions[".write"])).toContain("auth.token.fieldPlatform === true");
    expect(fieldPlatform.auditLogs[".write"]).toBe(false);
    expect(fieldPlatform.driveSyncJobs[".write"]).toBe(false);
    expect(String((fieldPlatform.mapProjections.$buildingId as Record<string, unknown>)[".write"]))
      .toContain("auth.token.fieldPlatform === true");
    for (const collection of [
      "driveFolderLeases",
      "driveFolderCaches",
      "driveUploadSessions",
    ]) {
      expect(fieldPlatform[collection]).toEqual({
        ".read": false,
        ".write": false,
      });
    }
    expect(fieldPlatform.desktopHandoffs[".read"]).toBe(false);
    expect(fieldPlatform.desktopHandoffs[".write"]).toBe(false);
    expect(fieldPlatform.desktopHandoffs[".indexOn"]).toContain("expiresAt");
    expect(fieldPlatform.desktopHandoffRateLimits).toEqual({
      ".read": false,
      ".write": false,
    });
    expect(fieldPlatform.driveSyncAlerts[".write"]).toBe(false);
    expect(String(fieldPlatform.driveSyncAlerts[".read"])).toContain(
      "auth.token.fieldRole === 'admin'",
    );

    const mediaValidation = JSON.stringify(media);
    for (const state of ["finalized", "complete", "driveFileId"]) {
      expect(mediaValidation).toContain(state);
    }
    expect(mediaValidation).toContain("uploadProgress");
    expect(JSON.stringify(sessions)).toContain("status");
  });

  it("keeps CRM migration staging inaccessible to every client", async () => {
    const source = JSON.parse(
      await readFile(resolve("../database.rules.json"), "utf8"),
    ) as {
      rules: {
        crmMigrationStaging?: Record<string, unknown>;
      };
    };

    expect(source.rules.crmMigrationStaging).toEqual({
      ".read": false,
      ".write": false,
    });
  });

  it("defines a private create-only public marketing lead inbox", async () => {
    const source = JSON.parse(
      await readFile(resolve("../database.rules.json"), "utf8"),
    ) as { rules: { crmCompany?: Record<string, unknown> } };
    const crm = source.rules.crmCompany as Record<string, Record<string, unknown>>;
    const inbox = crm.marketingLeadInbox as Record<string, Record<string, unknown>>;
    const item = inbox.$requestId;

    expect(String(inbox[".read"])).toContain("crmCompany/access");
    expect(inbox[".write"]).toBe(false);
    expect(String(item[".write"])).toContain("!data.exists()");
    expect(String(item[".write"])).toContain("auth == null");
    expect(String(item[".validate"])).toContain("hasChildren");
    expect(String(item.phone[".validate"])).toContain("010-");
    expect(String(item.consent[".validate"])).toContain("true");
    expect(String(item.submittedAt[".validate"])).toContain("now");
    expect(item.$other[".validate"]).toBe(false);
  });

  it("isolates company CRM access and validates Spark-safe canonical writes for enabled members", async () => {
    const source = JSON.parse(
      await readFile(resolve("../database.rules.json"), "utf8"),
    ) as { rules: { crmCompany?: Record<string, unknown> } };
    const crm = source.rules.crmCompany as Record<string, Record<string, unknown>>;
    const access = crm.access as Record<string, Record<string, unknown>>;
    const userAccess = access.$uid;

    expect(crm).toBeDefined();
    expect(crm[".read"]).toBe(false);
    expect(crm[".write"]).toBe(false);
    expect(userAccess[".read"]).toContain("auth.uid === $uid");
    expect(userAccess[".write"]).toBe(false);
    for (const root of ["cases", "paymentCalendars", "caseSettings"]) {
      const readRule = String(crm[root][".read"]);
      const writeRule = String(crm[root][".write"]);
      expect(readRule).toContain("crmCompany/access");
      expect(readRule).toContain("enabled");
      expect(writeRule).toContain("role");
      expect(writeRule).toContain("admin");
      expect(writeRule).toContain("member");
    }
    const data = crm.data as Record<string, Record<string, unknown> | boolean | string>;
    expect(String(data[".read"])).toContain("auth.token.email");
    expect(data[".write"]).toBe(false);
    for (const canonical of ["buildings", "buildingUnits", "salesUnits"]) {
      expect((data[canonical] as Record<string, unknown>)[".write"]).toBe(false);
      const entityRule = (data[canonical] as Record<string, Record<string, unknown>>).$entityId;
      expect(String(entityRule[".write"])).toContain("newData.exists()");
      expect(String(entityRule[".write"])).toContain("auth.token.email");
      expect(String(entityRule[".validate"])).toContain("entityVersion");
      expect(String(entityRule[".validate"])).toContain("updatedByAuthUid");
      expect(String(entityRule[".validate"])).toContain("teamProfiles");
      expect(entityRule.$other).toEqual({ ".validate": false });
    }
    for (const immutable of ["canonicalReceipts", "canonicalAuditLogs"]) {
      expect(JSON.stringify(data[immutable])).toContain("!data.exists()");
      expect(JSON.stringify(data[immutable])).toContain("newData.exists()");
    }
    const customerRule = data.customers as Record<string, Record<string, unknown>>;
    const customer = customerRule.$customerId;
    const customerFieldWrite = String(
      (customer.$field as Record<string, unknown>)[".write"],
    );
    const buildingLink = (customer.buildingIdLinks as Record<string, Record<string, unknown>>).$buildingId;
    expect(customerRule[".write"]).toBeUndefined();
    expect(String(customer[".write"])).toContain("!data.child('buildingIdLinks').exists()");
    expect(customerFieldWrite).toContain("$field !== 'buildingIdLinks'");
    expect(customerFieldWrite).toContain("auth.token.email");
    expect(String(buildingLink[".write"])).toContain("!data.exists()");
    expect(String(buildingLink[".write"])).toContain("newData.val() === true");
    expect(String(buildingLink[".write"])).toContain("auth.token.email");
    expect(String(buildingLink[".validate"])).toContain("newData.isBoolean()");
    for (const writable of [
      "schemaVersion", "company", "updatedAt", "updatedBy",
      "activities", "contracts", "partnerVendors", "partnerQuotes", "tasks",
      "serviceRecords", "serviceContracts", "serviceSchedules", "securityAssets", "auditLogs",
      "securityIncidents", "salesProspects", "salesContacts", "salesActivities", "salesEvents",
      "salesOpportunities",
    ]) {
      const writeRule = String((data[writable] as Record<string, unknown>)[".write"]);
      expect(writeRule).toContain("auth.token.email");
      expect(writeRule).toContain("'admin'");
      expect(writeRule).toContain("'member'");
    }
    expect(crm.migration).toEqual({ ".read": false, ".write": false });
  });

  it("indexes bounded ad review queries and keeps package indexes server-owned", async () => {
    const source = JSON.parse(
      await readFile(resolve("../database.rules.json"), "utf8"),
    ) as { rules: { fieldPlatform: Record<string, unknown> } };
    const fieldPlatform = source.rules.fieldPlatform as Record<
      string,
      Record<string, unknown>
    >;

    expect(fieldPlatform.listings[".indexOn"]).toEqual(["buildingId", "status"]);
    expect(fieldPlatform.media[".indexOn"]).toEqual(["buildingId", "listingId"]);
    expect(fieldPlatform.adPackages[".indexOn"]).toEqual([
      "listingId",
      "generation/recoveryKey",
    ]);
    expect(fieldPlatform.driveSyncJobs[".indexOn"]).toEqual(["recoveryKey"]);
    expect(fieldPlatform.adPackageVersions).toEqual({
      ".read": false,
      ".write": false,
    });
    expect(fieldPlatform.adPackageLatest).toEqual({
      ".read": false,
      ".write": false,
    });
    expect(fieldPlatform.adPackageVersionClaims).toBeUndefined();
    expect(fieldPlatform.adPackageGenerationAlerts[".write"]).toBe(false);
    expect(String(fieldPlatform.adPackageGenerationAlerts[".read"]))
      .toContain("auth.token.fieldRole === 'admin'");
  });

  it("keeps registration drafts private to their authenticated owner", async () => {
    const source = JSON.parse(
      await readFile(resolve("../database.rules.json"), "utf8"),
    ) as { rules: { fieldPlatform: Record<string, unknown> } };
    const fieldPlatform = source.rules.fieldPlatform as Record<
      string,
      Record<string, unknown>
    >;
    const drafts = fieldPlatform.registrationDrafts as Record<string, unknown>;
    const ownerRule = drafts.$uid as Record<string, unknown>;
    const draftRule = ownerRule.$draftId as Record<string, unknown>;

    expect(String(ownerRule[".read"])).toContain("auth.uid === $uid");
    expect(String(draftRule[".write"])).toContain("auth.uid === $uid");
    expect(String(draftRule[".validate"])).toContain("ownerUid");
    expect(String(draftRule[".validate"])).toContain("draftVersion");
  });

  it("declares the entire FIELD v2 tree server-only with only the three query indexes", async () => {
    const source = JSON.parse(
      await readFile(resolve("../database.rules.json"), "utf8"),
    ) as {
      rules: {
        fieldPlatform: {
          v2: Record<string, unknown>;
        };
      };
    };
    const v2 = source.rules.fieldPlatform.v2 as Record<string, unknown>;
    const projections = v2.projections as Record<string, Record<string, unknown>>;
    const operatorJobs = projections.operatorJobs as Record<
      string,
      Record<string, unknown>
    >;

    expect(v2[".read"]).toBe(false);
    expect(v2[".write"]).toBe(false);
    expect(operatorJobs.$operatorId[".indexOn"]).toEqual(["updatedAt"]);
    expect(projections.unassigned[".indexOn"]).toEqual(["updatedAt"]);
    expect(projections.teamActive[".indexOn"]).toEqual(["activeOrderKey"]);
    expect(projections.teamKpis?.[".indexOn"]).toBeUndefined();
    expect(projections.teamVisitState?.[".indexOn"]).toBeUndefined();
  });

  it("keeps CRM FIELD summaries readable only through exact enabled CRM access", async () => {
    const source = JSON.parse(
      await readFile(resolve("../database.rules.json"), "utf8"),
    ) as { rules: { crmCompany: Record<string, Record<string, unknown>> } };
    const summaries = source.rules.crmCompany.fieldSummaries;
    const readRule = String(summaries[".read"]);

    expect(readRule).toContain("crmCompany/access");
    expect(readRule).toContain("auth.token.email");
    expect(readRule).toContain("'admin'");
    expect(readRule).toContain("'member'");
    expect(readRule).toContain("'viewer'");
    expect(summaries[".write"]).toBe(false);
  });

  it("keeps CRM operator profiles readable only through exact enabled CRM access", async () => {
    const source = JSON.parse(
      await readFile(resolve("../database.rules.json"), "utf8"),
    ) as { rules: { crmCompany: Record<string, Record<string, unknown>> } };
    const profiles = source.rules.crmCompany.teamProfiles;
    const readRule = String(profiles[".read"]);

    expect(readRule).toContain("crmCompany/access");
    expect(readRule).toContain("auth.token.email");
    expect(readRule).toContain("'admin'");
    expect(readRule).toContain("'member'");
    expect(readRule).toContain("'viewer'");
    expect(profiles[".write"]).toBe(false);
    for (const profile of Object.values(TEAM_PROFILES)) {
      expect(Object.keys(profile).sort()).toEqual([
        "active",
        "displayName",
        "sortOrder",
      ]);
    }
  });

  it("keeps the emulator cutover fixture identical to the production CRM data boundary", async () => {
    const fixturePath = resolve(
      "tests/field/fixtures/database-cutover.rules.json",
    );
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as {
      rules: {
        crmCompany: {
          data: Record<string, Record<string, unknown> | boolean | string>;
        };
      };
    };
    const firebaseConfig = await readFile(resolve("../firebase.json"), "utf8");
    const dataRules = fixture.rules.crmCompany.data;
    const production = JSON.parse(
      await readFile(resolve("../database.rules.json"), "utf8"),
    ) as { rules: { crmCompany: { data: Record<string, unknown> } } };

    expect(firebaseConfig).not.toContain("database-cutover.rules.json");
    expect(dataRules).toEqual(production.rules.crmCompany.data);
    expect(dataRules[".write"]).toBe(false);
    for (const canonical of ["buildings", "buildingUnits", "salesUnits"]) {
      expect((dataRules[canonical] as Record<string, unknown>)[".write"])
        .toBe(false);
      expect(JSON.stringify(dataRules[canonical])).toContain("entityVersion");
      expect(JSON.stringify(dataRules[canonical])).toContain("newData.exists()");
    }
    const fixtureCustomer = dataRules.customers as Record<string, Record<string, unknown>>;
    const fixtureCustomerRecord = fixtureCustomer.$customerId;
    const fixtureLink = (fixtureCustomerRecord.buildingIdLinks as Record<string, Record<string, unknown>>).$buildingId;
    expect(fixtureCustomer[".write"]).toBeUndefined();
    expect(String(fixtureCustomerRecord[".write"])).toContain("!newData.child('buildingIdLinks').exists()");
    expect(String(
      (fixtureCustomerRecord.$field as Record<string, unknown>)[".write"],
    )).toContain("$field !== 'buildingIdLinks'");
    expect(String(fixtureLink[".write"])).toContain("!data.exists()");
    expect(String(fixtureLink[".write"])).toContain("newData.val() === true");
    for (const legacy of [
      "activities",
      "contracts",
      "partnerVendors",
      "partnerQuotes",
      "tasks",
      "serviceRecords",
      "serviceContracts",
      "serviceSchedules",
      "securityAssets",
      "auditLogs",
      "securityIncidents",
      "salesProspects",
      "salesContacts",
      "salesActivities",
      "salesEvents",
      "salesOpportunities",
      "schemaVersion",
      "company",
      "updatedAt",
      "updatedBy",
    ]) {
      const writeRule = String(
        (dataRules[legacy] as Record<string, unknown>)[".write"],
      );
      expect(writeRule).toContain("'admin'");
      expect(writeRule).toContain("'member'");
    }
  });

  it("closes public case data and exposes only the public signage catalogue", async () => {
    const source = JSON.parse(
      await readFile(resolve("../database.rules.json"), "utf8"),
    ) as { rules: Record<string, Record<string, unknown>> };
    const rules = source.rules;
    for (const root of ["workflow", "caseSettings", "cases"]) {
      const readRule = String(rules[root][".read"]);
      const writeRule = String(rules[root][".write"]);
      expect(readRule).toContain("crmCompany/access");
      expect(readRule).toContain("'viewer'");
      expect(writeRule).toContain("auth.token.email");
      expect(writeRule).toContain("'admin'");
      expect(writeRule).toContain("'member'");
    }
    const crmData = (rules.crmCompany.data as Record<string, unknown>);
    expect(String(crmData[".read"])).toContain("'viewer'");
    const signage = rules.signage as Record<string, Record<string, unknown>>;
    expect(signage[".read"]).toBeUndefined();
    expect(signage[".write"]).toBeUndefined();
    expect(signage.consign[".read"]).toBe(true);
    expect(signage.settings[".read"]).toBe(true);
    expect(String(signage.orders[".read"])).toContain("crmCompany/access");
    const order = (signage.orders as Record<string, Record<string, unknown>>).$orderId;
    expect(String(order[".write"])).toContain("!data.exists()");
    expect(order.$other).toEqual({ ".validate": false });
  });
});

beforeEach(async () => {
  if (!databaseEmulatorAvailable) return;
  await environment.clearDatabase();
  await seed();
  await cutoverEnvironment.clearDatabase();
  await seedCutover();
});

afterAll(async () => {
  await environment?.cleanup();
  await cutoverEnvironment?.cleanup();
});

describe.runIf(databaseEmulatorAvailable)("fieldPlatform database rules", () => {
  it("accepts one private public lead while preventing reads, tampering and malformed CRM writes", async () => {
    const unauthenticated = environment.unauthenticatedContext().database();
    const admin = environment.authenticatedContext(
      "crm-admin",
      crmClaims("admin@bring.test"),
    ).database();
    const member = environment.authenticatedContext(
      "crm-member",
      crmClaims("member@bring.test"),
    ).database();
    const viewer = environment.authenticatedContext(
      "crm-viewer",
      crmClaims("viewer@bring.test"),
    ).database();
    const requestId = "lead_01JMARKETINGREQUEST000000001";
    const path = `crmCompany/marketingLeadInbox/${requestId}`;
    const lead = marketingLead(requestId);

    await assertSucceeds(set(ref(unauthenticated, path), lead));
    await assertFails(get(ref(unauthenticated, path)));
    await assertFails(update(ref(unauthenticated, path), { status: "closed" }));
    await assertFails(remove(ref(unauthenticated, path)));
    await assertFails(set(ref(unauthenticated, path), lead));

    await assertSucceeds(get(ref(admin, path)));
    await assertSucceeds(get(ref(member, path)));
    await assertSucceeds(get(ref(viewer, path)));
    await assertFails(update(ref(viewer, path), { status: "processing" }));
    await assertSucceeds(update(ref(member, path), { status: "processing" }));

    for (const [suffix, invalid] of [
      ["phone", { ...marketingLead(), phone: "02-123-4567" }],
      ["consent", { ...marketingLead(), consent: false }],
      ["service", { ...marketingLead(), sourcePath: "/building-care" }],
      ["extra", { ...marketingLead(), secret: "not allowed" }],
      ["time", { ...marketingLead(), submittedAt: Date.now() - 600_000 }],
    ] as const) {
      const invalidId = `lead_01JMARKETINGINVALID${suffix}00001`;
      await assertFails(set(
        ref(unauthenticated, `crmCompany/marketingLeadInbox/${invalidId}`),
        { ...invalid, requestId: invalidId },
      ));
    }
  });

  it("denies every client direct reads and writes anywhere under FIELD v2", async () => {
    const clients = [
      environment.unauthenticatedContext().database(),
      environment.authenticatedContext(
        "crm-admin",
        crmClaims("admin@bring.test"),
      ).database(),
      environment.authenticatedContext(
        "crm-member",
        crmClaims("member@bring.test"),
      ).database(),
      environment.authenticatedContext(
        "crm-viewer",
        crmClaims("viewer@bring.test"),
      ).database(),
      environment.authenticatedContext("staff-1", claims("staff")).database(),
      environment.authenticatedContext(
        "reviewer-1",
        claims("reviewer"),
      ).database(),
      environment.authenticatedContext("admin-1", claims("admin")).database(),
    ];
    const readPaths = [
      "config/release",
      "policies/policy_1",
      "workItems/job_1",
      "visits/visit_1",
      "captureSessions/session_1",
      "media/media_1",
      "uploadJobs/media_1",
      "reviews/review_1",
      "adPackages/package_1",
      "channelPublications/publication_1",
      "auditLogs/audit_1",
      "projections/operatorJobs/operator_kim",
      "projections/operatorJobs/operator_hwang",
      "projections/unassigned",
      "projections/teamActive",
      "projections/teamKpis",
      "projections/teamVisitState",
      "projections/map",
      "links/crmBuildings/building_1",
      "notifications/operator_kim",
      "candidates/candidate_1",
      "requestReceipts/create/request_1",
      "migrationRuns/run_1",
    ];
    const writePaths = [
      "config/release",
      "policies/policy_client",
      "workItems/job_client",
      "visits/visit_client",
      "captureSessions/session_client",
      "media/media_client",
      "uploadJobs/media_client",
      "reviews/review_client",
      "adPackages/package_client",
      "channelPublications/publication_client",
      "auditLogs/audit_client",
      "projections/operatorJobs/operator_kim/job_client",
      "projections/unassigned/job_client",
      "projections/teamActive/job_client",
      "projections/teamKpis/daily",
      "projections/teamVisitState/visit_client",
      "projections/map/building_client",
      "links/crmBuildings/building_client",
      "notifications/operator_kim/notification_client",
      "candidates/candidate_client",
      "requestReceipts/create/request_client",
      "migrationRuns/run_client",
    ];

    for (const database of clients) {
      for (const path of readPaths) {
        await assertFails(get(ref(database, `fieldPlatform/v2/${path}`)));
      }
      for (const path of writePaths) {
        await assertFails(set(ref(database, `fieldPlatform/v2/${path}`), {
          clientControlled: true,
        }));
      }
    }
  });

  it("enforces the production canonical cutover while preserving every noncanonical shared write", async () => {
    const admin = environment.authenticatedContext(
      "crm-admin",
      crmClaims("admin@bring.test"),
    ).database();
    const member = environment.authenticatedContext(
      "crm-member",
      crmClaims("member@bring.test"),
    ).database();
    const viewer = environment.authenticatedContext(
      "crm-viewer",
      crmClaims("viewer@bring.test"),
    ).database();
    const disabled = environment.authenticatedContext(
      "crm-disabled",
      crmClaims("disabled@bring.test"),
    ).database();

    for (const database of [admin, member, viewer]) {
      await assertSucceeds(get(ref(database, "crmCompany/data")));
    }
    for (const database of [admin, member, viewer, disabled]) {
      for (const [collection, existingId] of [
        ["buildings", "building_1"],
        ["buildingUnits", "building_unit_1"],
        ["salesUnits", "sales_unit_1"],
      ] as const) {
        await assertFails(update(ref(database, `crmCompany/data/${collection}/${existingId}`), {
          clientTamper: true,
        }));
        await assertFails(set(ref(database, `crmCompany/data/${collection}/client_record`), {
          id: "client_record",
        }));
        await assertFails(remove(ref(database, `crmCompany/data/${collection}/${existingId}`)));
      }
    }

    await assertFails(update(ref(member, "crmCompany/data"), {
      "customers/customer_atomic": { id: "customer_atomic", name: "Must roll back" },
      "buildings/building_atomic": { id: "building_atomic", name: "Canonical write" },
    }));
    const rolledBack = await assertSucceeds(
      get(ref(member, "crmCompany/data/customers/customer_atomic")),
    );
    expect(rolledBack.exists()).toBe(false);

    await assertSucceeds(update(ref(member, "crmCompany/data"), {
      schemaVersion: 3,
      company: { name: "BRING" },
      updatedAt: NOW,
      updatedBy: "crm-member",
      "customers/customer_cutover": { id: "customer_cutover" },
      "activities/activity_cutover": { id: "activity_cutover" },
      "contracts/contract_cutover": { id: "contract_cutover" },
      "partnerVendors/vendor_cutover": { id: "vendor_cutover" },
      "partnerQuotes/quote_cutover": { id: "quote_cutover" },
      "tasks/task_cutover": { id: "task_cutover" },
      "serviceRecords/service_record_cutover": { id: "service_record_cutover" },
      "serviceContracts/service_contract_cutover": { id: "service_contract_cutover" },
      "serviceSchedules/service_schedule_cutover": { id: "service_schedule_cutover" },
      "securityAssets/security_asset_cutover": { id: "security_asset_cutover" },
      "auditLogs/audit_cutover": { id: "audit_cutover" },
      "securityIncidents/incident_cutover": { id: "incident_cutover" },
      "salesProspects/prospect_cutover": { id: "prospect_cutover" },
      "salesContacts/contact_cutover": { id: "contact_cutover" },
      "salesActivities/sales_activity_cutover": { id: "sales_activity_cutover" },
      "salesEvents/event_cutover": { id: "event_cutover" },
      "salesOpportunities/opportunity_cutover": { id: "opportunity_cutover" },
    }));
    await assertSucceeds(get(ref(member, "crmCompany/data/serviceRecords/service_record_cutover")));
    await assertSucceeds(update(ref(admin, "crmCompany/data"), {
      updatedBy: "crm-admin",
      "customers/admin_customer": { id: "admin_customer" },
    }));
    await assertFails(update(ref(viewer, "crmCompany/data"), {
      "customers/viewer_customer": { id: "viewer_customer" },
      "tasks/viewer_task": { id: "viewer_task" },
    }));
    await assertFails(update(ref(disabled, "crmCompany/data"), {
      "customers/disabled_customer": { id: "disabled_customer" },
    }));
    await assertFails(get(ref(disabled, "crmCompany/data")));
  });

  it("keeps customer building links append-only while preserving ordinary and unlinked legacy customer writes", async () => {
    await exerciseCustomerBuildingLinkRules(environment);
  });

  it("accepts an atomic canonical building create with its narrow customer backlink", async () => {
    await exerciseAtomicBuildingCreateWithCustomerLink(environment);
  });

  it("protects operational roots and keeps public signage orders create-only", async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const database = context.database();
      await set(ref(database, "workflow"), { board: { title: "internal" } });
      await set(ref(database, "caseSettings"), { setting: true });
      await set(ref(database, "cases/case_1"), { id: "case_1", name: "private" });
      await set(ref(database, "signage/consign/product_1"), { name: "catalogue" });
      await set(ref(database, "signage/settings"), { footer: "public" });
    });

    const unauthenticated = environment.unauthenticatedContext().database();
    const admin = environment.authenticatedContext(
      "crm-admin",
      crmClaims("admin@bring.test"),
    ).database();
    const member = environment.authenticatedContext(
      "crm-member",
      crmClaims("member@bring.test"),
    ).database();
    const viewer = environment.authenticatedContext(
      "crm-viewer",
      crmClaims("viewer@bring.test"),
    ).database();
    const wrongEmail = environment.authenticatedContext(
      "crm-member",
      crmClaims("wrong@bring.test"),
    ).database();
    const invalidRole = environment.authenticatedContext(
      "crm-invalid-role",
      crmClaims("invalid@bring.test"),
    ).database();

    for (const path of ["workflow", "caseSettings", "cases", "signage/orders"]) {
      await assertFails(get(ref(unauthenticated, path)));
      await assertFails(get(ref(wrongEmail, path)));
      await assertFails(get(ref(invalidRole, path)));
      await assertSucceeds(get(ref(admin, path)));
      await assertSucceeds(get(ref(member, path)));
      await assertSucceeds(get(ref(viewer, path)));
    }
    await assertFails(get(ref(invalidRole, "crmCompany/data")));
    await assertFails(set(ref(unauthenticated, "cases/case_2"), { id: "case_2" }));
    await assertFails(set(ref(viewer, "cases/case_2"), { id: "case_2" }));
    await assertFails(set(ref(wrongEmail, "cases/case_2"), { id: "case_2" }));
    await assertSucceeds(set(ref(member, "cases/case_2"), { id: "case_2" }));

    await assertSucceeds(get(ref(unauthenticated, "signage/consign")));
    await assertSucceeds(get(ref(unauthenticated, "signage/settings")));
    const order = {
      productId: "product_1",
      productName: "상품",
      option: "",
      vendor: "",
      price: 1000,
      qty: 1,
      amount: 1000,
      name: "주문자",
      phone: "01012345678",
      receive: "배송",
      addr: "배송 주소",
      memo: "",
      status: "신규",
      createdAt: 1_787_000_000_000,
    };
    await assertSucceeds(set(ref(unauthenticated, "signage/orders/order_1"), order));
    await assertFails(update(ref(unauthenticated, "signage/orders/order_1"), { status: "변조" }));
    await assertFails(remove(ref(unauthenticated, "signage/orders/order_1")));
    await assertFails(set(ref(unauthenticated, "signage/orders/order_bad"), { ...order, secret: "extra" }));
    await assertSucceeds(update(ref(admin, "signage/orders/order_1"), { status: "확인" }));
  });

  it("allows exact enabled CRM roles to read summaries but never write them", async () => {
    for (const [uid, email] of [
      ["crm-admin", "admin@bring.test"],
      ["crm-member", "member@bring.test"],
      ["crm-viewer", "viewer@bring.test"],
    ] as const) {
      const database = environment.authenticatedContext(
        uid,
        crmClaims(email),
      ).database();
      await assertSucceeds(get(ref(database, "crmCompany/fieldSummaries")));
      await assertSucceeds(get(ref(database, "crmCompany/fieldSummaries/job_1")));
      await assertFails(update(
        ref(database, "crmCompany/fieldSummaries/job_1"),
        { workflowStatus: "approved" },
      ));
    }

    const rejectedReaders = [
      environment.unauthenticatedContext().database(),
      environment.authenticatedContext(
        "crm-member",
        crmClaims("wrong@bring.test"),
      ).database(),
      environment.authenticatedContext(
        "crm-disabled",
        crmClaims("disabled@bring.test"),
      ).database(),
      environment.authenticatedContext(
        "crm-invalid-role",
        crmClaims("invalid@bring.test"),
      ).database(),
    ];
    for (const database of rejectedReaders) {
      await assertFails(get(ref(database, "crmCompany/fieldSummaries/job_1")));
      await assertFails(set(ref(database, "crmCompany/fieldSummaries/job_client"), {
        fieldJobId: "job_client",
      }));
    }
  });

  it("allows exact enabled CRM roles to list operator profiles but never write them", async () => {
    for (const [uid, email] of [
      ["crm-admin", "admin@bring.test"],
      ["crm-member", "member@bring.test"],
      ["crm-viewer", "viewer@bring.test"],
    ] as const) {
      const database = environment.authenticatedContext(
        uid,
        crmClaims(email),
      ).database();
      const listSnapshot = await assertSucceeds(
        get(ref(database, "crmCompany/teamProfiles")),
      );
      expect(listSnapshot.val()).toEqual(TEAM_PROFILES);
      await assertSucceeds(
        get(ref(database, "crmCompany/teamProfiles/operator_kim")),
      );
      await assertFails(update(
        ref(database, "crmCompany/teamProfiles/operator_kim"),
        { active: false },
      ));
    }

    const rejectedReaders = [
      environment.unauthenticatedContext().database(),
      environment.authenticatedContext(
        "crm-member",
        crmClaims("wrong@bring.test"),
      ).database(),
      environment.authenticatedContext(
        "crm-disabled",
        crmClaims("disabled@bring.test"),
      ).database(),
      environment.authenticatedContext(
        "crm-invalid-role",
        crmClaims("invalid@bring.test"),
      ).database(),
    ];
    for (const database of rejectedReaders) {
      await assertFails(get(ref(database, "crmCompany/teamProfiles")));
      await assertFails(
        get(ref(database, "crmCompany/teamProfiles/operator_kim")),
      );
      await assertFails(set(
        ref(database, "crmCompany/teamProfiles/operator_client"),
        { displayName: "조작", active: true, sortOrder: 1 },
      ));
      await assertFails(
        get(ref(database, "fieldPlatform/v2/config/release")),
      );
    }
  });

  it("declares the indexes used by managed-map projection refreshes", async () => {
    const source = JSON.parse(
      await readFile(resolve("../database.rules.json"), "utf8"),
    ) as {
      rules: {
        fieldPlatform: {
          buildings: { ".indexOn"?: string[] };
          listings: { ".indexOn"?: string[] };
          media: { ".indexOn"?: string[] };
          adPackages: { ".indexOn"?: string[] };
          driveSyncJobs: { ".indexOn"?: string[] };
          captureSessions: { ".read"?: string };
          ownerNotes: {
            $buildingId: { ".indexOn"?: string[] };
          };
        };
      };
    };

    expect(source.rules.fieldPlatform.buildings[".indexOn"]).toEqual([
      "managementContract/status",
    ]);
    expect(source.rules.fieldPlatform.listings[".indexOn"]).toEqual([
      "buildingId",
      "status",
    ]);
    expect(source.rules.fieldPlatform.media[".indexOn"]).toEqual([
      "buildingId",
      "listingId",
    ]);
    expect(source.rules.fieldPlatform.adPackages[".indexOn"]).toEqual([
      "listingId",
      "generation/recoveryKey",
    ]);
    expect(source.rules.fieldPlatform.driveSyncJobs[".indexOn"]).toEqual([
      "recoveryKey",
    ]);
    expect(source.rules.fieldPlatform.ownerNotes.$buildingId[".indexOn"]).toEqual([
      "createdAt",
    ]);
    expect(source.rules.fieldPlatform.captureSessions[".read"]).toContain(
      "query.orderByChild === 'createdBy'",
    );
    expect(source.rules.fieldPlatform.captureSessions[".read"]).toContain(
      "query.equalTo === auth.uid",
    );
  });

  it("allows only current authority to read finalized media and capture sessions", async () => {
    const mediaPath = "fieldPlatform/media/media-1";
    const sessionPath =
      "fieldPlatform/captureSessions/11111111-1111-4111-8111-111111111111";

    for (const [uid, role] of [
      ["staff-1", "staff"],
      ["reviewer-1", "reviewer"],
      ["admin-1", "admin"],
    ] as const) {
      const database = environment.authenticatedContext(uid, claims(role)).database();
      await assertSucceeds(get(ref(database, mediaPath)));
      await assertSucceeds(get(ref(database, sessionPath)));
    }

    const unassigned = environment
      .authenticatedContext("staff-2", claims("staff"))
      .database();
    await assertFails(get(ref(unassigned, mediaPath)));
    await assertFails(get(ref(unassigned, sessionPath)));
    await assertSucceeds(get(ref(
      unassigned,
      "fieldPlatform/captureSessions/22222222-2222-4222-8222-222222222222",
    )));
  });

  it("keeps protected v1 records immutable while preserving allowed capture and map writes", async () => {
    for (const [uid, role] of [
      ["staff-1", "staff"],
      ["reviewer-1", "reviewer"],
      ["admin-1", "admin"],
    ] as const) {
      const database = environment.authenticatedContext(uid, claims(role)).database();
      await assertFails(update(ref(database, "fieldPlatform/media/media-1"), {
        uploadState: "failed",
      }));
      const captureUpdate = update(ref(
        database,
        "fieldPlatform/captureSessions/11111111-1111-4111-8111-111111111111",
      ), { status: "complete" });
      if (uid === "staff-1") {
        await assertSucceeds(captureUpdate);
      } else {
        await assertFails(captureUpdate);
      }
      await assertFails(set(ref(database, "fieldPlatform/auditLogs/client-event"), {
        action: "tampered",
      }));
      await assertFails(set(ref(database, "fieldPlatform/driveSyncJobs/client-job"), {
        status: "complete",
      }));
      const projectionUpdate = update(
        ref(database, "fieldPlatform/mapProjections/building-1"),
        { captureStatus: "complete" },
      );
      if (role === "reviewer") {
        await assertFails(projectionUpdate);
      } else {
        await assertSucceeds(projectionUpdate);
      }
    }
  });

  it("allows only assigned active staff and admins to read owner notes", async () => {
    const path = "fieldPlatform/ownerNotes/building-1/note_12345678";
    const assigned = environment
      .authenticatedContext("staff-1", claims("staff"))
      .database();
    const admin = environment
      .authenticatedContext("admin-1", claims("admin"))
      .database();

    await assertSucceeds(get(ref(assigned, path)));
    await assertSucceeds(get(ref(admin, path)));

    const denied = [
      environment.authenticatedContext("staff-2", claims("staff")).database(),
      environment.authenticatedContext("reviewer-1", claims("reviewer")).database(),
      environment.authenticatedContext("disabled-staff", claims("staff")).database(),
      environment.authenticatedContext("stale-admin", claims("admin")).database(),
      environment.authenticatedContext("staff-2", {
        ...claims("staff"),
        allFieldAccess: true,
      }).database(),
      environment.authenticatedContext("email-only", {
        email: "dpvld858@gmail.com",
        email_verified: true,
      }).database(),
    ];

    for (const database of denied) {
      await assertFails(get(ref(database, path)));
    }
  });

  it("denies collection-wide owner-note reads", async () => {
    for (const [uid, role] of [
      ["staff-1", "staff"],
      ["admin-1", "admin"],
    ] as const) {
      const database = environment.authenticatedContext(uid, claims(role)).database();
      await assertFails(get(ref(database, "fieldPlatform/ownerNotes")));
    }
  });

  it("allows assigned staff and admins to create/archive notes but blocks tampering", async () => {
    for (const [uid, role] of [
      ["staff-1", "staff"],
      ["admin-1", "admin"],
    ] as const) {
      const database = environment.authenticatedContext(uid, claims(role)).database();
      const existingPath = "fieldPlatform/ownerNotes/building-1/note_12345678";
      const newPath = `fieldPlatform/ownerNotes/building-1/note_${role}_new`;

      await assertSucceeds(set(ref(database, newPath), {
        id: `note_${role}_new`,
        buildingId: "building-1",
        body: "건물주 전달사항",
        recordedAt: NOW,
        createdAt: NOW,
        createdBy: uid,
        createdByName: role === "admin" ? "관리자" : "담당 직원",
      }));
      await assertSucceeds(update(ref(database, newPath), {
        archivedAt: "2026-08-09T03:00:00.000Z",
        archivedBy: uid,
      }));
      await assertFails(update(ref(database, existingPath), {
        body: "위조",
        createdAt: "2000-01-01T00:00:00.000Z",
      }));
      await assertFails(set(ref(database, existingPath), null));
    }

    const reviewer = environment
      .authenticatedContext("reviewer-1", claims("reviewer"))
      .database();
    const unassigned = environment
      .authenticatedContext("staff-2", claims("staff"))
      .database();
    for (const [database, id, uid] of [
      [reviewer, "note_reviewer_new", "reviewer-1"],
      [unassigned, "note_unassigned_new", "staff-2"],
    ] as const) {
      await assertFails(set(ref(database, `fieldPlatform/ownerNotes/building-1/${id}`), {
        id,
        buildingId: "building-1",
        body: "권한 없는 메모",
        recordedAt: NOW,
        createdAt: NOW,
        createdBy: uid,
        createdByName: "권한 없음",
      }));
    }
  });

  it("blocks unauthenticated access", async () => {
    const database = environment.unauthenticatedContext().database();
    await assertFails(get(ref(database, "fieldPlatform/buildings/building-1")));
    await assertFails(set(ref(database, "fieldPlatform/buildings/building-2"), building("building-2")));
  });

  it("preserves the current v1 staff write validation", async () => {
    const database = environment
      .authenticatedContext("staff-1", claims("staff"))
      .database();

    await assertFails(update(ref(database, "fieldPlatform/buildings/building-1"), {
      name: "수정된 테스트 빌딩",
      updatedBy: "staff-1",
    }));
    await assertSucceeds(set(ref(database, "fieldPlatform/listings/listing-2"), listing("listing-2")));
    await assertSucceeds(set(ref(database, "fieldPlatform/visits/visit-1"), {
      id: "visit-1",
      buildingId: "building-1",
      type: "initial",
      assignedUserId: "staff-1",
      createdAt: NOW,
      createdBy: "staff-1",
      updatedAt: NOW,
      updatedBy: "staff-1",
    }));
    await assertFails(set(ref(database, "fieldPlatform/media/media-1"), {
      id: "media-1",
      buildingId: "building-1",
      capturedBy: "staff-1",
      uploadState: "queued",
      driveSyncState: "queued",
    }));

    const otherBuilding = building("building-2");
    await environment.withSecurityRulesDisabled((context) =>
      set(ref(context.database(), "fieldPlatform/buildings/building-2"), otherBuilding),
    );
    await assertSucceeds(update(ref(database, "fieldPlatform/buildings/building-2"), {
      name: "Legacy staff update",
    }));
  });

  it.each([
    ["admin", "admin-1", "admin"],
    ["assigned staff", "staff-1", "staff"],
  ] as const)("denies an %s client from deleting a contracted building", async (_label, uid, role) => {
    const database = environment.authenticatedContext(uid, claims(role)).database();

    await assertFails(set(ref(database, "fieldPlatform/buildings/building-1"), null));
  });

  it("preserves admin creation and updates of buildings without a contract", async () => {
    const admin = environment.authenticatedContext("admin-1", claims("admin")).database();

    await assertSucceeds(set(
      ref(admin, "fieldPlatform/buildings/building-new"),
      building("building-new"),
    ));
    await assertSucceeds(update(ref(admin, "fieldPlatform/buildings/building-new"), {
      name: "새 미계약 건물",
    }));
  });

  it.each([
    ["unit", "fieldPlatform/units/unit-unassigned"],
    ["listing", "fieldPlatform/listings/listing-unassigned"],
    ["visit", "fieldPlatform/visits/visit-unassigned"],
    ["media", "fieldPlatform/media/media-unassigned"],
  ])("denies staff from reparenting an existing %s into an assigned building", async (_kind, path) => {
    const staff = environment.authenticatedContext("staff-1", claims("staff")).database();

    await assertFails(update(ref(staff, path), { buildingId: "building-1" }));
  });

  it("lets a claimed user read only their own user record while disabled", async () => {
    const disabled = environment
      .authenticatedContext("disabled-1", claims("admin"))
      .database();
    const admin = environment.authenticatedContext("admin-1", claims("admin")).database();

    const ownRecord = await assertSucceeds(
      get(ref(disabled, "fieldPlatform/users/disabled-1")),
    );
    expect(ownRecord.child("enabled").val()).toBe(false);
    await assertFails(get(ref(disabled, "fieldPlatform/users/staff-1")));
    await assertSucceeds(get(ref(admin, "fieldPlatform/users/disabled-1")));
  });

  it("keeps the self-record exception but denies cross-user reads with a stale admin token", async () => {
    const staleAdmin = environment
      .authenticatedContext("stale-admin", claims("admin"))
      .database();

    await assertSucceeds(get(ref(staleAdmin, "fieldPlatform/users/stale-admin")));
    await assertFails(get(ref(staleAdmin, "fieldPlatform/users/staff-1")));
  });

  it.each([
    ["building assignment", "fieldPlatform/buildingAssignments/building-1/staff-1"],
    ["secure-access assignment", "fieldPlatform/secureAccessAssignments/building-1/staff-1"],
    ["building", "fieldPlatform/buildings/building-1"],
    ["unit", "fieldPlatform/units/unit-1"],
    ["listing", "fieldPlatform/listings/listing-1"],
    ["visit", "fieldPlatform/visits/visit-1"],
    [
      "capture session",
      "fieldPlatform/captureSessions/11111111-1111-4111-8111-111111111111",
    ],
    ["media", "fieldPlatform/media/media-1"],
    ["secure access", "fieldPlatform/secureAccess/access-1"],
    ["ad package", "fieldPlatform/adPackages/package-1"],
    ["checklist template", "fieldPlatform/checklistTemplates/template-1"],
    ["checklist submission", "fieldPlatform/checklistSubmissions/submission-1"],
    ["audit log", "fieldPlatform/auditLogs/event-1"],
    ["drive-sync job", "fieldPlatform/driveSyncJobs/job-1"],
    ["map projection", "fieldPlatform/mapProjections/building-1"],
  ])("denies stale admin-token reads from the operational %s path", async (_label, path) => {
    const staleAdmin = environment
      .authenticatedContext("stale-admin", claims("admin"))
      .database();

    await assertFails(get(ref(staleAdmin, path)));
  });

  it.each([
    [
      "building",
      "update",
      "fieldPlatform/buildings/building-1",
      { name: "만료 토큰 조작" },
    ],
    [
      "unit",
      "set",
      "fieldPlatform/units/stale-unit",
      { id: "stale-unit", buildingId: "building-1", unitLabel: "401호" },
    ],
    [
      "listing",
      "set",
      "fieldPlatform/listings/stale-listing",
      {
        ...listing("stale-listing"),
        createdBy: "stale-admin",
        updatedBy: "stale-admin",
      },
    ],
    [
      "visit",
      "set",
      "fieldPlatform/visits/stale-visit",
      {
        id: "stale-visit",
        buildingId: "building-1",
        type: "initial",
        assignedUserId: "stale-admin",
      },
    ],
    [
      "media",
      "set",
      "fieldPlatform/media/stale-media",
      {
        id: "stale-media",
        buildingId: "building-1",
        capturedBy: "stale-admin",
        uploadState: "queued",
        driveSyncState: "queued",
      },
    ],
    [
      "secure access",
      "update",
      "fieldPlatform/secureAccess/access-1",
      { updatedBy: "stale-admin" },
    ],
    [
      "ad package",
      "update",
      "fieldPlatform/adPackages/package-1",
      { status: "reviewed", reviewerId: "stale-admin" },
    ],
    [
      "checklist template",
      "set",
      "fieldPlatform/checklistTemplates/stale-template",
      { id: "stale-template" },
    ],
    [
      "checklist submission",
      "set",
      "fieldPlatform/checklistSubmissions/stale-submission",
      { id: "stale-submission" },
    ],
  ] as const)(
    "denies stale admin-token writes to the operational %s path",
    async (_label, method, path, value) => {
      const staleAdmin = environment
        .authenticatedContext("stale-admin", claims("admin"))
        .database();

      if (method === "set") {
        await assertFails(set(ref(staleAdmin, path), value));
        return;
      }
      await assertFails(update(ref(staleAdmin, path), value));
    },
  );

  it("denies every operational read to a disabled user with valid-looking claims", async () => {
    const disabled = environment
      .authenticatedContext("disabled-1", claims("admin"))
      .database();
    const paths = [
      "fieldPlatform/buildingAssignments/building-1/disabled-1",
      "fieldPlatform/secureAccessAssignments/building-1/disabled-1",
      "fieldPlatform/buildings/building-1",
      "fieldPlatform/units/unit-1",
      "fieldPlatform/listings/listing-1",
      "fieldPlatform/visits/visit-1",
      "fieldPlatform/captureSessions/11111111-1111-4111-8111-111111111111",
      "fieldPlatform/media/media-1",
      "fieldPlatform/secureAccess/access-1",
      "fieldPlatform/adPackages/package-1",
      "fieldPlatform/checklistTemplates/template-1",
      "fieldPlatform/checklistSubmissions/submission-1",
      "fieldPlatform/auditLogs/event-1",
      "fieldPlatform/driveSyncJobs/job-1",
      "fieldPlatform/mapProjections/building-1",
    ];

    for (const path of paths) {
      await assertFails(get(ref(disabled, path)));
    }
  });

  it("denies operational writes to a disabled admin", async () => {
    const disabled = environment
      .authenticatedContext("disabled-1", claims("admin"))
      .database();

    await assertFails(update(ref(disabled, "fieldPlatform/buildings/building-1"), {
      name: "비활성 계정 조작",
    }));
    await assertFails(set(ref(disabled, "fieldPlatform/units/disabled-unit"), {
      id: "disabled-unit",
      buildingId: "building-1",
      unitLabel: "301호",
    }));
    await assertFails(set(ref(disabled, "fieldPlatform/listings/disabled-listing"), {
      ...listing("disabled-listing"),
      createdBy: "disabled-1",
      updatedBy: "disabled-1",
    }));
    await assertFails(set(ref(disabled, "fieldPlatform/visits/disabled-visit"), {
      id: "disabled-visit",
      buildingId: "building-1",
      type: "initial",
      assignedUserId: "disabled-1",
    }));
    await assertFails(set(ref(disabled, "fieldPlatform/media/disabled-media"), {
      id: "disabled-media",
      buildingId: "building-1",
      capturedBy: "disabled-1",
      uploadState: "queued",
      driveSyncState: "queued",
    }));
    await assertFails(update(ref(disabled, "fieldPlatform/secureAccess/access-1"), {
      updatedBy: "disabled-1",
    }));
    await assertFails(update(ref(disabled, "fieldPlatform/adPackages/package-1"), {
      status: "reviewed",
    }));
    await assertFails(set(ref(disabled, "fieldPlatform/checklistTemplates/template-2"), {
      id: "template-2",
    }));
    await assertFails(set(ref(disabled, "fieldPlatform/checklistSubmissions/submission-2"), {
      id: "submission-2",
    }));
  });

  it("allows enabled roles to read projections but keeps projections and receipts server-owned", async () => {
    for (const [uid, role] of [
      ["staff-1", "staff"],
      ["reviewer-1", "reviewer"],
      ["admin-1", "admin"],
    ] as const) {
      const database = environment.authenticatedContext(uid, claims(role)).database();
      await assertSucceeds(get(ref(database, "fieldPlatform/mapProjections/building-1")));
      await assertFails(set(
        ref(database, "fieldPlatform/mapProjections/building-1/name"),
        "조작",
      ));
      const receiptRead = get(
        ref(database, "fieldPlatform/registrationRequests/admin-1/request-1"),
      );
      if (uid === "admin-1") {
        await assertSucceeds(receiptRead);
      } else {
        await assertFails(receiptRead);
      }
      await assertFails(set(
        ref(database, `fieldPlatform/registrationRequests/${uid}/client-request`),
        { ok: true },
      ));
      await assertFails(get(
        ref(database, "fieldPlatform/managementContractRequests/admin-1/request-1"),
      ));
      await assertFails(set(
        ref(database, `fieldPlatform/managementContractRequests/${uid}/client-request`),
        { ok: true },
      ));
    }
  });

  it("keeps contracts immutable to staff while allowing admin approval transitions", async () => {
    const staff = environment.authenticatedContext("staff-1", claims("staff")).database();
    const admin = environment.authenticatedContext("admin-1", claims("admin")).database();

    await assertFails(update(
      ref(staff, "fieldPlatform/buildings/building-1/managementContract"),
      {
        status: "paused",
        updatedAt: "2026-08-10T00:00:00.000Z",
        updatedBy: "staff-1",
      },
    ));
    await assertSucceeds(update(
      ref(admin, "fieldPlatform/buildings/building-1/managementContract"),
      {
        status: "paused",
        updatedAt: "2026-08-10T00:00:00.000Z",
        updatedBy: "admin-1",
      },
    ));
    await assertFails(set(
      ref(admin, "fieldPlatform/buildings/building-1/managementContract"),
      null,
    ));
    await assertSucceeds(set(
      ref(admin, "fieldPlatform/buildings/building-legacy/managementContract"),
      managementContract("active"),
    ));
    await assertFails(update(
      ref(admin, "fieldPlatform/buildings/building-1/managementContract"),
      { clientWritable: true },
    ));
  });

  it("keeps legacy buildings without a management contract readable and editable as unmanaged", async () => {
    const admin = environment.authenticatedContext("admin-1", claims("admin")).database();

    const snapshot = await assertSucceeds(
      get(ref(admin, "fieldPlatform/buildings/building-legacy")),
    );
    expect(snapshot.child("managementContract").exists()).toBe(false);
    await assertSucceeds(update(ref(admin, "fieldPlatform/buildings/building-legacy"), {
      name: "미계약 건물",
      updatedBy: "admin-1",
    }));
  });

  it("accepts all five stored contract statuses when their shape is valid", async () => {
    const admin = environment.authenticatedContext("admin-1", claims("admin")).database();
    const statuses = ["none", "pending", "active", "paused", "ended"] as const;

    await environment.withSecurityRulesDisabled(async (context) => {
      for (const status of statuses) {
        await set(
          ref(context.database(), `fieldPlatform/buildings/valid-${status}`),
          {
            ...building(`valid-${status}`),
            managementContract: managementContract(status),
          },
        );
      }
    });

    for (const status of statuses) {
      await assertSucceeds(update(
        ref(admin, `fieldPlatform/buildings/valid-${status}`),
        { name: `유효-${status}` },
      ));
    }
  });

  it("rejects client updates that would preserve malformed stored contracts", async () => {
    const admin = environment.authenticatedContext("admin-1", claims("admin")).database();
    const malformedContracts = {
      status: { ...managementContract("active"), status: "approved" },
      startedOn: { ...managementContract("active"), startedOn: "2026-8-9" },
      endedOn: { ...managementContract("ended"), endedOn: "2026/12/31" },
      updatedBy: { ...managementContract("active"), updatedBy: "   " },
      updatedAt: { ...managementContract("active"), updatedAt: 1_786_233_600_000 },
    };

    await environment.withSecurityRulesDisabled(async (context) => {
      for (const [id, contract] of Object.entries(malformedContracts)) {
        await set(ref(context.database(), `fieldPlatform/buildings/invalid-${id}`), {
          ...building(`invalid-${id}`),
          managementContract: contract,
        });
      }
    });

    for (const id of Object.keys(malformedContracts)) {
      await assertFails(update(ref(admin, `fieldPlatform/buildings/invalid-${id}`), {
        name: `조작-${id}`,
      }));
    }
  });

  it.each([
    ["tab", "\t"],
    ["newline", "\n"],
    ["mixed whitespace", " \t\r\n"],
  ])("rejects client updates that preserve a %s-only contract actor", async (id, blankActor) => {
    const admin = environment.authenticatedContext("admin-1", claims("admin")).database();

    await environment.withSecurityRulesDisabled((context) =>
      set(ref(context.database(), `fieldPlatform/buildings/invalid-${id}`), {
        ...building(`invalid-${id}`),
        managementContract: {
          ...managementContract("active"),
          updatedBy: blankActor,
        },
      }),
    );

    await assertFails(update(ref(admin, `fieldPlatform/buildings/invalid-${id}`), {
      name: `조작-${id}`,
    }));
  });

  it("separates reviewer advertising access from secure access", async () => {
    const reviewer = environment
      .authenticatedContext("reviewer-1", claims("reviewer"))
      .database();
    const admin = environment.authenticatedContext("admin-1", claims("admin")).database();
    const assignedStaff = environment
      .authenticatedContext("staff-1", claims("staff"))
      .database();

    await assertSucceeds(get(ref(reviewer, "fieldPlatform/listings/listing-1")));
    await assertFails(update(ref(reviewer, "fieldPlatform/adPackages/package-1"), {
      status: "reviewed",
      reviewerId: "reviewer-1",
    }));
    await assertFails(update(ref(admin, "fieldPlatform/adPackages/package-1"), {
      status: "reviewed",
      reviewerId: "admin-1",
    }));
    await assertFails(get(ref(reviewer, "fieldPlatform/secureAccess/access-1")));
    await assertSucceeds(get(ref(admin, "fieldPlatform/secureAccess/access-1")));
    await assertSucceeds(get(ref(assignedStaff, "fieldPlatform/secureAccess/access-1")));
  });

  it("keeps server-owned logs and drive jobs client read-only", async () => {
    for (const [uid, role] of [
      ["staff-1", "staff"],
      ["reviewer-1", "reviewer"],
      ["admin-1", "admin"],
    ] as const) {
      const database = environment.authenticatedContext(uid, claims(role)).database();
      await assertFails(set(ref(database, "fieldPlatform/auditLogs/event-1"), { action: "tampered" }));
      await assertFails(set(ref(database, "fieldPlatform/driveSyncJobs/job-1"), { status: "complete" }));
    }
  });

  it("validates coordinates, listing status, and non-negative integer money", async () => {
    const database = environment.authenticatedContext("admin-1", claims("admin")).database();
    await assertFails(set(ref(database, "fieldPlatform/buildings/invalid"), {
      ...building("invalid"),
      latitude: 91,
      longitude: 181,
    }));
    await assertFails(set(ref(database, "fieldPlatform/listings/invalid-status"), {
      ...listing("invalid-status"),
      status: "published-by-client",
    }));
    await assertFails(set(ref(database, "fieldPlatform/listings/invalid-money"), {
      ...listing("invalid-money"),
      depositWon: -1,
      monthlyRentWon: 1.5,
    }));
  });
});

describe.runIf(databaseEmulatorAvailable)("future CRM cutover rules rehearsal", () => {
  it("keeps the fixture customer backlink contract identical in the emulator", async () => {
    await exerciseCustomerBuildingLinkRules(cutoverEnvironment);
    await exerciseAtomicBuildingCreateWithCustomerLink(cutoverEnvironment);
  });

  it("atomically rejects malformed canonical records in a parent PATCH", async () => {
    const member = cutoverEnvironment.authenticatedContext(
      "crm-member",
      crmClaims("member@bring.test"),
    ).database();

    await assertFails(update(ref(member, "crmCompany/data"), {
      "customers/customer_atomic": {
        id: "customer_atomic",
        name: "Must roll back",
      },
      "buildings/building_atomic": {
        id: "building_atomic",
        name: "Canonical write",
      },
    }));

    const snapshot = await assertSucceeds(
      get(ref(member, "crmCompany/data/customers/customer_atomic")),
    );
    expect(snapshot.exists()).toBe(false);
  });

  it("allows noncanonical parent PATCHes while malformed canonical records stay blocked", async () => {
    const member = cutoverEnvironment.authenticatedContext(
      "crm-member",
      crmClaims("member@bring.test"),
    ).database();

    await assertSucceeds(update(ref(member, "crmCompany/data"), {
      "customers/customer_cutover": {
        id: "customer_cutover",
        name: "Allowed legacy customer",
      },
      "tasks/task_cutover": {
        id: "task_cutover",
        title: "Allowed legacy task",
      },
    }));
    for (const canonical of ["buildings", "buildingUnits", "salesUnits"]) {
      await assertFails(set(
        ref(member, `crmCompany/data/${canonical}/client_record`),
        { id: "client_record" },
      ));
    }
  });

  it("accepts one child-scoped atomic Spark patch and rejects stale versions, deletion, and unknown fields", async () => {
    const member = cutoverEnvironment.authenticatedContext(
      "crm-member",
      crmClaims("member@bring.test"),
    ).database();
    const viewer = cutoverEnvironment.authenticatedContext(
      "crm-viewer",
      crmClaims("viewer@bring.test"),
    ).database();
    const current = (await assertSucceeds(get(ref(member, "crmCompany/data")))).val();
    const nextUnit = {
      ...current.buildingUnits.building_unit_1,
      status: "vacant",
      entityVersion: 2,
      updatedAt: "2026-08-09T00:00:01.000Z",
      updatedByAuthUid: "crm-member",
      updatedByOperatorId: "operator_kim",
    };
    const nextBuilding = {
      ...current.buildings.building_1,
      vacantUnitCount: 1,
      vacantUnits: ["101"],
      entityVersion: 2,
      updatedAt: "2026-08-09T00:00:01.000Z",
      updatedByAuthUid: "crm-member",
      updatedByOperatorId: "operator_kim",
    };
    const receipt = {
        scope: "sparkCanonicalCrmEntityV1",
        requestId: "request_1",
        requestHash: "a".repeat(64),
        actorUid: "crm-member",
        result: { entityId: "building_unit_1", entityVersion: 2 },
        createdAt: "2026-08-09T00:00:01.000Z",
    };
    const audit = {
        id: "audit_1",
        scope: "sparkCanonicalCrmEntityV1",
        requestId: "request_1",
        authUid: "crm-member",
        operatorId: "operator_kim",
        occurredAt: "2026-08-09T00:00:01.000Z",
        action: "crm.canonical.buildingUnits.update",
        entityType: "buildingUnits",
        entityId: "building_unit_1",
        beforeVersion: 1,
        afterVersion: 2,
        changedFields: ["status"],
        reason: "공실 확인",
    };

    const atomicPatch = {
      "buildingUnits/building_unit_1": nextUnit,
      "buildings/building_1": nextBuilding,
      "canonicalReceipts/request_1": receipt,
      "canonicalAuditLogs/audit_1": audit,
    };
    await assertSucceeds(update(ref(member, "crmCompany/data"), atomicPatch));
    expect((await get(ref(member, "crmCompany/data/tasks/task_1"))).val().title)
      .toBe("Legacy task");

    await assertFails(set(ref(member, "crmCompany/data/buildingUnits/building_unit_1"), {
      ...nextUnit,
      label: "stale overwrite",
    }));

    await assertFails(set(ref(member, "crmCompany/data/canonicalAuditLogs/audit_1"), null));
    await assertFails(set(ref(member, "crmCompany/data/buildingUnits/building_unit_1"), null));

    await assertFails(set(ref(member, "crmCompany/data/buildings/building_1"), {
      ...nextBuilding,
      clientTamper: true,
      entityVersion: 3,
    }));
    await assertFails(update(ref(viewer, "crmCompany/data"), atomicPatch));
    await assertFails(set(ref(member, "crmCompany/data"), current));
  });

  it("denies cutover writes from viewers and disabled members", async () => {
    const viewer = cutoverEnvironment.authenticatedContext(
      "crm-viewer",
      crmClaims("viewer@bring.test"),
    ).database();
    const disabled = cutoverEnvironment.authenticatedContext(
      "crm-disabled",
      crmClaims("disabled@bring.test"),
    ).database();

    for (const database of [viewer, disabled]) {
      await assertFails(update(ref(database, "crmCompany/data"), {
        "customers/forbidden": { id: "forbidden" },
        "tasks/forbidden": { id: "forbidden" },
      }));
    }
  });
});
