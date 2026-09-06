// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { get, ref, remove, serverTimestamp, set, update } from "firebase/database";
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

function crmPasswordClaims(
  email: string,
  emailVerified = true,
  signInProvider: "password" | "google.com" = "password",
) {
  return {
    email,
    email_verified: emailVerified,
    firebase: { sign_in_provider: signInProvider },
  };
}

const CRM_ACCESS = {
  "crm-admin": {
    enabled: true,
    email: "admin@bring.test",
    role: "admin",
    officeAdmin: true,
    operatorId: "operator_kim",
  },
  "crm-standard-admin": {
    enabled: true,
    email: "standard-admin@bring.test",
    role: "admin",
    operatorId: "operator_kim",
  },
  "crm-member": {
    enabled: true,
    email: "member@bring.test",
    role: "member",
    operatorId: "operator_kim",
    mustChangePassword: true,
  },
  "crm-viewer": {
    enabled: true,
    email: "viewer@bring.test",
    role: "viewer",
    operatorId: "operator_kim",
  },
  "crm-legacy-member": { enabled: true, email: "legacy@bring.test", role: "member", operatorId: "operator_kim" },
  "crm-marketing": { enabled: true, email: "marketing@bring.test", role: "member", marketingRole: "marketing", operatorId: "operator_kim" },
  "crm-marketing-two": { enabled: true, email: "marketing-two@bring.test", role: "member", marketingRole: "marketing", operatorId: "operator_kim" },
  "crm-sales": { enabled: true, email: "sales@bring.test", role: "member", marketingRole: "sales", operatorId: "operator_kim" },
  "crm-marketing-disabled": { enabled: false, email: "marketing-disabled@bring.test", role: "member", marketingRole: "marketing", operatorId: "operator_kim" },
  "crm-marketing-password-change": { enabled: true, email: "marketing-password@bring.test", role: "member", marketingRole: "marketing", operatorId: "operator_kim", mustChangePassword: true },
  "crm-disabled": {
    enabled: false,
    email: "disabled@bring.test",
    role: "member",
    operatorId: "operator_kim",
  },
  "crm-office-disabled": {
    enabled: false,
    email: "office-disabled@bring.test",
    role: "admin",
    officeAdmin: true,
    operatorId: "operator_kim",
  },
  "crm-office-pending": {
    enabled: true,
    email: "office-pending@bring.test",
    role: "admin",
    officeAdmin: true,
    mustChangePassword: true,
    operatorId: "operator_kim",
  },
  "crm-invalid-role": {
    enabled: true,
    email: "invalid@bring.test",
    role: "owner",
    operatorId: "operator_kim",
  },
} as const;

const DRIVE_IMPORT_CANDIDATES = {
  drive_file_1: {
    id: "drive_file_1",
    driveFileId: "drive_file_1",
    status: "pending",
  },
} as const;

const CRM_DATA = {
  buildings: { building_1: {
    id: "building_1",
    buildingNo: "BLD-001",
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
      driveImportCandidates: DRIVE_IMPORT_CANDIDATES,
      teamProfiles: TEAM_PROFILES,
      fieldSummaries: {
        job_1: {
          fieldJobId: "job_1",
          workflowStatus: "assigned",
          updatedAt: NOW,
        },
      },
      marketing: { aggregates: { "2026-08": { id: "2026-08", date: "2026-08-31", spend: 1000, impressions: 20, clicks: 3, platformLeads: 1, version: 1, updatedAtMs: 1788141600000 } } },
    });
  });
}

async function seedCutover() {
  await cutoverEnvironment.withSecurityRulesDisabled(async (context) => {
    await set(ref(context.database(), "crmCompany"), {
      access: CRM_ACCESS,
      driveImportCandidates: DRIVE_IMPORT_CANDIDATES,
      teamProfiles: TEAM_PROFILES,
      data: CRM_DATA,
    });
  });
}

async function exerciseDriveImportCandidateRules(
  testEnvironment: RulesTestEnvironment,
) {
  for (const [uid, email] of [
    ["crm-admin", "admin@bring.test"],
    ["crm-member", "member@bring.test"],
    ["crm-viewer", "viewer@bring.test"],
  ] as const) {
    const database = testEnvironment.authenticatedContext(
      uid,
      crmClaims(email),
    ).database();
    const listSnapshot = await assertSucceeds(
      get(ref(database, "crmCompany/driveImportCandidates")),
    );
    expect(listSnapshot.val()).toEqual(DRIVE_IMPORT_CANDIDATES);
    await assertSucceeds(
      get(ref(database, "crmCompany/driveImportCandidates/drive_file_1")),
    );
    await assertFails(set(
      ref(database, `crmCompany/driveImportCandidates/client_${uid}`),
      { id: `client_${uid}`, driveFileId: `client_${uid}`, status: "pending" },
    ));
    await assertFails(update(
      ref(database, "crmCompany/driveImportCandidates/drive_file_1"),
      { status: "approved" },
    ));
    await assertFails(remove(
      ref(database, "crmCompany/driveImportCandidates/drive_file_1"),
    ));
  }

  const rejectedReaders = [
    testEnvironment.unauthenticatedContext().database(),
    testEnvironment.authenticatedContext(
      "crm-member",
      crmClaims("wrong@bring.test"),
    ).database(),
    testEnvironment.authenticatedContext(
      "crm-disabled",
      crmClaims("disabled@bring.test"),
    ).database(),
    testEnvironment.authenticatedContext(
      "crm-invalid-role",
      crmClaims("invalid@bring.test"),
    ).database(),
  ];
  for (const database of rejectedReaders) {
    await assertFails(get(
      ref(database, "crmCompany/driveImportCandidates/drive_file_1"),
    ));
    await assertFails(set(
      ref(database, "crmCompany/driveImportCandidates/client_forbidden"),
      { id: "client_forbidden" },
    ));
  }
}

async function exerciseServiceRecordRules(
  testEnvironment: RulesTestEnvironment,
) {
  const record = (
    id: string,
    buildingId: string,
    values: Record<string, unknown> = {},
  ) => ({
    id,
    buildingId,
    title: "건물 업무 일정",
    status: "planned",
    scheduledDate: "2026-08-21",
    createdAt: NOW,
    updatedAt: NOW,
    ...values,
  });

  const commitMeta = (
    sequence: number,
    updatedByAuthUid: string,
    updatedAt = NOW,
    calendarCommitVersion = 1,
  ) => {
    const hex = sequence.toString(16);
    const requestSuffix = hex.padStart(12, "0").slice(-12);
    return {
      calendarCommitRequestId: `00000000-0000-4000-8000-${requestSuffix}`,
      calendarCommitHash: hex.padStart(64, "0").slice(-64),
      calendarAuditId: `audit_schedule_00000000000040008000${requestSuffix}`,
      calendarCommitVersion,
      updatedByAuthUid,
      updatedAt,
    };
  };

  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const database = context.database();
    await update(ref(database, "crmCompany/data"), {
      "buildings/building_archived": {
        ...CRM_DATA.buildings.building_1,
        id: "building_archived",
        buildingNo: "BLD-ARCHIVED",
        name: "Archived building",
        archivedAt: NOW,
      },
      "buildings/constructor": {
        ...CRM_DATA.buildings.building_1,
        id: "constructor",
        buildingNo: "BLD-RESERVED",
        name: "Reserved key building",
      },
      "serviceRecords/service_record_active": record(
        "service_record_active",
        "building_1",
      ),
      "serviceRecords/service_record_archived": record(
        "service_record_archived",
        "building_archived",
      ),
      "serviceRecords/service_record_missing": record(
        "service_record_missing",
        "building_missing",
      ),
      "serviceRecords/service_record_cancelled": record(
        "service_record_cancelled",
        "building_1",
        { status: "cancelled" },
      ),
      "serviceRecords/service_record_invalid_version": record(
        "service_record_invalid_version",
        "building_1",
        { calendarCommitVersion: "legacy-invalid" },
      ),
    });
  });

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
  const rejectedWriters = [
    testEnvironment.unauthenticatedContext().database(),
    viewer,
    testEnvironment.authenticatedContext(
      "crm-member",
      crmClaims("wrong@bring.test"),
    ).database(),
    testEnvironment.authenticatedContext(
      "crm-disabled",
      crmClaims("disabled@bring.test"),
    ).database(),
  ];

  await assertSucceeds(set(
    ref(admin, "crmCompany/data/serviceRecords/schedule_admin"),
    record("schedule_admin", "building_1", commitMeta(1, "crm-admin")),
  ));
  await assertSucceeds(set(
    ref(member, "crmCompany/data/serviceRecords/schedule_member"),
    record("schedule_member", "building_1", commitMeta(2, "crm-member")),
  ));
  await assertFails(set(
    ref(member, "crmCompany/data/serviceRecords/schedule_without_commit_meta"),
    record("schedule_without_commit_meta", "building_1"),
  ));
  await assertFails(set(
    ref(member, "crmCompany/data/serviceRecords/schedule_bad_request_id"),
    record("schedule_bad_request_id", "building_1", {
      ...commitMeta(10, "crm-member"),
      calendarCommitRequestId: "not-a-uuid-v4",
    }),
  ));
  await assertFails(set(
    ref(member, "crmCompany/data/serviceRecords/schedule_bad_hash"),
    record("schedule_bad_hash", "building_1", {
      ...commitMeta(11, "crm-member"),
      calendarCommitHash: "g".repeat(64),
    }),
  ));
  await assertFails(set(
    ref(member, "crmCompany/data/serviceRecords/schedule_bad_audit_id"),
    record("schedule_bad_audit_id", "building_1", {
      ...commitMeta(12, "crm-member"),
      calendarAuditId: "audit/schedule/unsafe",
    }),
  ));
  await assertFails(set(
    ref(member, "crmCompany/data/serviceRecords/schedule_wrong_actor"),
    record("schedule_wrong_actor", "building_1", commitMeta(13, "crm-admin")),
  ));
  await assertFails(set(
    ref(member, "crmCompany/data/serviceRecords/schedule_bad_updated_at"),
    record("schedule_bad_updated_at", "building_1", commitMeta(
      14,
      "crm-member",
      "2026/08/21 09:00",
    )),
  ));
  await assertFails(set(
    ref(member, "crmCompany/data/serviceRecords/schedule_bad_initial_version"),
    record("schedule_bad_initial_version", "building_1", commitMeta(
      15,
      "crm-member",
      NOW,
      2,
    )),
  ));
  await assertFails(set(
    ref(member, "crmCompany/data/serviceRecords/schedule_archived"),
    record("schedule_archived", "building_archived", commitMeta(16, "crm-member")),
  ));
  await assertFails(set(
    ref(member, "crmCompany/data/serviceRecords/schedule_missing"),
    record("schedule_missing", "building_missing", commitMeta(17, "crm-member")),
  ));

  await assertFails(update(
    ref(member, "crmCompany/data/serviceRecords/service_record_active"),
    { title: "메타 없는 legacy 부분 수정", updatedAt: "2026-08-21T00:30:00.000Z" },
  ));
  await assertFails(set(
    ref(member, "crmCompany/data/serviceRecords/service_record_active"),
    record("service_record_active", "building_1", {
      title: "메타 없는 legacy 전체 수정",
      updatedAt: "2026-08-21T00:40:00.000Z",
    }),
  ));
  await assertSucceeds(update(
    ref(member, "crmCompany/data/serviceRecords/service_record_active"),
    {
      title: "활성 건물 일정 수정",
      ...commitMeta(20, "crm-member", "2026-08-21T01:00:00.000Z"),
    },
  ));
  await assertSucceeds(update(
    ref(member, "crmCompany/data/serviceRecords/service_record_archived"),
    {
      title: "보관 건물의 기존 이력 수정",
      ...commitMeta(21, "crm-member", "2026-08-21T02:00:00.000Z"),
    },
  ));
  await assertSucceeds(update(
    ref(member, "crmCompany/data/serviceRecords/service_record_missing"),
    {
      title: "삭제된 건물의 기존 이력 수정",
      ...commitMeta(22, "crm-member", "2026-08-21T03:00:00.000Z"),
    },
  ));
  await assertFails(update(
    ref(member, "crmCompany/data/serviceRecords/service_record_cancelled"),
    {
      title: "취소 이력 수정 시도",
      ...commitMeta(18, "crm-member", "2026-08-21T03:30:00.000Z"),
    },
  ));
  await assertSucceeds(update(
    ref(member, "crmCompany/data/serviceRecords/service_record_invalid_version"),
    {
      title: "잘못된 legacy 버전의 첫 CAS",
      ...commitMeta(19, "crm-member", "2026-08-21T03:40:00.000Z"),
    },
  ));

  const versionOneSnapshot = await assertSucceeds(get(
    ref(member, "crmCompany/data/serviceRecords/service_record_active"),
  ));
  const versionOneRecord = versionOneSnapshot.val() as Record<string, unknown>;
  await assertSucceeds(update(
    ref(member, "crmCompany/data/serviceRecords/service_record_active"),
    {
      title: "활성 건물 일정 2차 수정",
      ...commitMeta(23, "crm-member", "2026-08-21T04:00:00.000Z", 2),
    },
  ));
  await assertFails(update(
    ref(member, "crmCompany/data/serviceRecords/service_record_active"),
    { title: "메타 없는 구버전 부분 수정" },
  ));
  await assertFails(update(
    ref(member, "crmCompany/data/serviceRecords/service_record_active"),
    {
      title: "버전 증가를 생략한 marker-only 수정",
      ...commitMeta(24, "crm-member", "2026-08-21T05:00:00.000Z", 2),
    },
  ));
  await assertFails(update(
    ref(member, "crmCompany/data/serviceRecords/service_record_active"),
    {
      title: "뒤처진 버전의 부분 수정",
      ...commitMeta(25, "crm-member", "2026-08-21T06:00:00.000Z", 1),
    },
  ));
  await assertFails(set(
    ref(member, "crmCompany/data/serviceRecords/service_record_active"),
    { ...versionOneRecord, title: "뒤처진 CAS 전체 덮어쓰기" },
  ));
  const activeSnapshot = await assertSucceeds(get(
    ref(member, "crmCompany/data/serviceRecords/service_record_active"),
  ));
  const activeRecord = activeSnapshot.val() as Record<string, unknown>;
  await assertFails(update(
    ref(member, "crmCompany/data/serviceRecords/service_record_active"),
    {
      title: "request marker 재사용",
      ...commitMeta(28, "crm-member", "2026-08-21T06:10:00.000Z", 3),
      calendarCommitRequestId: activeRecord.calendarCommitRequestId,
    },
  ));
  await assertFails(update(
    ref(member, "crmCompany/data/serviceRecords/service_record_active"),
    {
      title: "hash marker 재사용",
      ...commitMeta(29, "crm-member", "2026-08-21T06:20:00.000Z", 3),
      calendarCommitHash: activeRecord.calendarCommitHash,
    },
  ));
  await assertFails(update(
    ref(member, "crmCompany/data/serviceRecords/service_record_active"),
    {
      title: "updatedAt marker 재사용",
      ...commitMeta(30, "crm-member", String(activeRecord.updatedAt), 3),
    },
  ));
  await assertFails(update(
    ref(member, "crmCompany/data/serviceRecords/service_record_active"),
    {
      title: "audit marker 재사용",
      ...commitMeta(31, "crm-member", "2026-08-21T06:30:00.000Z", 3),
      calendarAuditId: activeRecord.calendarAuditId,
    },
  ));
  await assertFails(set(
    ref(member, "crmCompany/data/serviceRecords/service_record_active"),
    {
      ...activeRecord,
      buildingId: "building_archived",
      ...commitMeta(26, "crm-member", "2026-08-21T07:00:00.000Z", 3),
    },
  ));
  await assertFails(set(
    ref(member, "crmCompany/data/serviceRecords/service_record_active"),
    {
      ...activeRecord,
      buildingId: "building_missing",
      ...commitMeta(27, "crm-member", "2026-08-21T08:00:00.000Z", 3),
    },
  ));
  await assertFails(remove(
    ref(member, "crmCompany/data/serviceRecords/service_record_active"),
  ));
  await assertFails(set(
    ref(member, "crmCompany/data/serviceRecords/id_mismatch"),
    record("different_id", "building_1", commitMeta(33, "crm-member")),
  ));
  await assertFails(set(
    ref(member, "crmCompany/data/serviceRecords/reserved_building"),
    record("reserved_building", "constructor", commitMeta(34, "crm-member")),
  ));
  await assertFails(set(
    ref(member, "crmCompany/data/serviceRecords/constructor"),
    record("constructor", "building_1", commitMeta(35, "crm-member")),
  ));

  for (const database of rejectedWriters) {
    await assertFails(set(
      ref(database, "crmCompany/data/serviceRecords/rejected_schedule"),
      record("rejected_schedule", "building_1", commitMeta(40, "crm-member")),
    ));
    await assertFails(update(
      ref(database, "crmCompany/data/serviceRecords/service_record_active"),
      { title: "허용되지 않은 변경" },
    ));
    await assertFails(remove(
      ref(database, "crmCompany/data/serviceRecords/service_record_active"),
    ));
  }
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

  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const database = context.database();
    const linkedBuilding = (id: string, ownerCustomerId: string) => ({
      ...CRM_DATA.buildings.building_1,
      id,
      buildingNo: `BLD-${id}`,
      name: id,
      ownerCustomerId,
    });
    await update(ref(database, "crmCompany/data"), {
      "customers/customer_other_owner": { id: "customer_other_owner", name: "Other owner" },
      "buildings/building_member": linkedBuilding("building_member", "customer_1"),
      "buildings/building_admin": linkedBuilding("building_admin", "customer_1"),
      "buildings/building_other_owner": linkedBuilding("building_other_owner", "customer_other_owner"),
    });
  });

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
    ref(member, `${customerPath}/buildingIdLinks/building_missing`),
    true,
  ));
  await assertFails(set(
    ref(member, `${customerPath}/buildingIdLinks/building_other_owner`),
    true,
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
  await assertFails(set(ref(member, `${customerPath}/id`), "customer_changed"));
  await assertFails(remove(ref(member, `${customerPath}/id`)));
  await assertFails(set(
    ref(member, `${customerPath}/archivedAt`),
    "2026-08-09T00:00:08.000Z",
  ));
  expect((await get(ref(member, `${customerPath}/id`))).val()).toBe("customer_1");
  expect((await get(ref(member, `${customerPath}/archivedAt`))).exists()).toBe(false);

  const linkedCustomer = (await assertSucceeds(get(ref(member, customerPath)))).val();
  await assertFails(set(ref(member, customerPath), {
    ...linkedCustomer,
    name: "whole-record overwrite must be rejected",
  }));

  const legacyPath = "crmCompany/data/customers/customer_legacy_unlinked";
  await assertFails(set(ref(member, `${legacyPath}_missing_id`), {
    name: "Customer id is required",
  }));
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

async function exerciseCustomerPhotoRules(testEnvironment: RulesTestEnvironment) {
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
  const dataUrl = "data:image/jpeg;base64,/9j/2Q==";
  const photo = (uid: string) => ({
    dataUrl,
    size: dataUrl.length,
    updatedAt: NOW,
    updatedBy: uid,
  });

  for (const database of [admin, member, viewer]) {
    await assertSucceeds(get(ref(database, "crmCompany/customerPhotos")));
  }
  for (const database of [unauthenticated, disabled, wrongEmail]) {
    await assertFails(get(ref(database, "crmCompany/customerPhotos")));
  }

  await assertFails(set(
    ref(viewer, "crmCompany/customerPhotos/customer_1"),
    photo("crm-viewer"),
  ));
  await assertFails(set(
    ref(member, "crmCompany/customerPhotos/customer_missing"),
    photo("crm-member"),
  ));
  await assertFails(set(
    ref(member, "crmCompany/customerPhotos/constructor"),
    photo("crm-member"),
  ));
  await assertFails(set(
    ref(member, "crmCompany/customerPhotos/customer_1"),
    { ...photo("crm-member"), size: dataUrl.length - 1 },
  ));
  await assertFails(set(
    ref(member, "crmCompany/customerPhotos/customer_1"),
    { ...photo("crm-member"), extra: true },
  ));
  const fakeDataUrl = "data:image/jpeg;base64,QUJD";
  await assertFails(set(
    ref(member, "crmCompany/customerPhotos/customer_1"),
    { ...photo("crm-member"), dataUrl: fakeDataUrl, size: fakeDataUrl.length },
  ));
  const oversizedDataUrl = `data:image/jpeg;base64,/9j/${"A".repeat(20000)}`;
  await assertFails(set(
    ref(member, "crmCompany/customerPhotos/customer_1"),
    { ...photo("crm-member"), dataUrl: oversizedDataUrl, size: oversizedDataUrl.length },
  ));

  await assertSucceeds(set(
    ref(member, "crmCompany/data/customers/customer_photo_target"),
    { id: "customer_photo_target", name: "Photo target" },
  ));

  for (const customerId of ["customer_atomic_delete", "customer_atomic_archive"]) {
    await assertSucceeds(set(
      ref(member, `crmCompany/data/customers/${customerId}`),
      { id: customerId, name: "Atomic lifecycle target" },
    ));
  }
  await assertFails(update(ref(member, "crmCompany"), {
    "data/customers/customer_atomic_delete": null,
    "customerPhotos/customer_atomic_delete": photo("crm-member"),
  }));
  await assertFails(update(ref(member, "crmCompany"), {
    "data/customers/customer_atomic_archive/archivedAt": NOW,
    "customerPhotos/customer_atomic_archive": photo("crm-member"),
  }));
  expect((await get(ref(member, "crmCompany/data/customers/customer_atomic_delete"))).exists()).toBe(true);
  expect((await get(ref(member, "crmCompany/data/customers/customer_atomic_archive/archivedAt"))).exists()).toBe(false);
  expect((await get(ref(member, "crmCompany/customerPhotos/customer_atomic_delete"))).exists()).toBe(false);
  expect((await get(ref(member, "crmCompany/customerPhotos/customer_atomic_archive"))).exists()).toBe(false);

  await assertSucceeds(set(
    ref(member, "crmCompany/customerPhotos/customer_photo_target"),
    photo("crm-member"),
  ));
  expect((await assertSucceeds(get(
    ref(viewer, "crmCompany/customerPhotos/customer_photo_target"),
  ))).val()).toEqual(photo("crm-member"));
  await assertFails(remove(
    ref(member, "crmCompany/data/customers/customer_photo_target"),
  ));
  await assertFails(set(
    ref(member, "crmCompany/data/customers/customer_photo_target/archivedAt"),
    NOW,
  ));
  await assertSucceeds(remove(
    ref(member, "crmCompany/customerPhotos/customer_photo_target"),
  ));
  await assertSucceeds(set(
    ref(member, "crmCompany/data/customers/customer_photo_target/archivedAt"),
    NOW,
  ));
  await assertFails(set(
    ref(admin, "crmCompany/customerPhotos/customer_photo_target"),
    photo("crm-admin"),
  ));
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
      address: "강원특별자치도 원주시 중앙로 1",
      roadAddress: "강원특별자치도 원주시 중앙로 1",
      jibunAddress: "강원특별자치도 원주시 중앙동 1-1",
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

  const missingBacklink: Record<string, unknown> = { ...patch };
  delete missingBacklink[`customers/customer_1/buildingIdLinks/${buildingId}`];
  await assertFails(update(ref(member, "crmCompany/data"), missingBacklink));
  expect((await get(ref(member, `crmCompany/data/buildings/${buildingId}`))).exists())
    .toBe(false);
  expect((await get(ref(member, `crmCompany/data/canonicalReceipts/${requestId}`))).exists())
    .toBe(false);
  expect((await get(ref(member, `crmCompany/data/canonicalAuditLogs/${auditId}`))).exists())
    .toBe(false);

  await assertSucceeds(update(ref(member, "crmCompany/data"), patch));
  expect((await get(ref(
    member,
    `crmCompany/data/customers/customer_1/buildingIdLinks/${buildingId}`,
  ))).val()).toBe(true);
  await assertFails(update(ref(member, "crmCompany/data"), patch));
}

async function exerciseExistingBuildingOwnerLinkRules(
  testEnvironment: RulesTestEnvironment,
) {
  const member = testEnvironment.authenticatedContext(
    "crm-member",
    crmClaims("member@bring.test"),
  ).database();
  const ownerlessBuilding = (id: string, ownerCustomerId?: string) => ({
    id,
    name: `Ownerless ${id}`,
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
    ...(ownerCustomerId === undefined ? {} : { ownerCustomerId }),
  });
  const missingOwner = ownerlessBuilding("building_owner_missing");
  const emptyOwner = ownerlessBuilding("building_owner_empty", "");
  const legacyOwned = ownerlessBuilding("building_owner_legacy", "customer_legacy_owner");
  const prelinkedOwner = ownerlessBuilding("building_owner_prelinked");
  const pathOwner = ownerlessBuilding("building_owner_path");
  const archivedOwner = ownerlessBuilding("building_owner_archived");

  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const database = context.database();
    await update(ref(database, "crmCompany/data"), {
      "buildings/building_owner_missing": missingOwner,
      "buildings/building_owner_empty": emptyOwner,
      "buildings/building_owner_legacy": legacyOwned,
      "buildings/building_owner_prelinked": prelinkedOwner,
      "buildings/building_owner_path": pathOwner,
      "buildings/building_owner_archived": archivedOwner,
      "customers/customer_first_owner": { id: "customer_first_owner", name: "첫 건물주" },
      "customers/customer_second_owner": { id: "customer_second_owner", name: "다른 건물주" },
      "customers/customer_legacy_owner": { id: "customer_legacy_owner", name: "기존 건물주", buildingIds: ["building_owner_legacy"] },
      "customers/customer_prelinked": { id: "customer_prelinked", name: "과거 선점 고객", buildingIdLinks: { building_owner_prelinked: true } },
      "customers/customer_path_base": { id: "customer_path_base", name: "경로 주입 기준 고객" },
      "customers/customer_archived_owner": { id: "customer_archived_owner", name: "보관 고객", archivedAt: "2026-08-08T00:00:00.000Z" },
    });
  });

  await assertFails(update(ref(member, "crmCompany/data"), {
    "buildings/building_owner_prelinked": {
      ...prelinkedOwner,
      ownerCustomerId: "customer_prelinked",
      entityVersion: 2,
      updatedAt: "2026-08-09T00:00:02.100Z",
    },
  }));
  expect((await get(ref(member, "crmCompany/data/buildings/building_owner_prelinked/ownerCustomerId"))).exists())
    .toBe(false);

  await assertFails(update(ref(member, "crmCompany/data"), {
    "buildings/building_owner_path": {
      ...pathOwner,
      ownerCustomerId: "customer_path_base/nested",
      entityVersion: 2,
      updatedAt: "2026-08-09T00:00:02.200Z",
    },
    "customers/customer_path_base/nested/id": "customer_path_base/nested",
    "customers/customer_path_base/nested/buildingIdLinks/building_owner_path": true,
  }));
  expect((await get(ref(member, "crmCompany/data/buildings/building_owner_path/ownerCustomerId"))).exists())
    .toBe(false);
  expect((await get(ref(member, "crmCompany/data/customers/customer_path_base/nested"))).exists())
    .toBe(false);

  await assertFails(update(ref(member, "crmCompany/data"), {
    "buildings/building_owner_archived": {
      ...archivedOwner,
      ownerCustomerId: "customer_archived_owner",
      entityVersion: 2,
      updatedAt: "2026-08-09T00:00:02.300Z",
    },
    "customers/customer_archived_owner/buildingIdLinks/building_owner_archived": true,
  }));
  expect((await get(ref(member, "crmCompany/data/buildings/building_owner_archived/ownerCustomerId"))).exists())
    .toBe(false);

  const linkedMissing = {
    ...missingOwner,
    ownerCustomerId: "customer_first_owner",
    entityVersion: 2,
    updatedAt: "2026-08-09T00:00:03.000Z",
  };
  await assertFails(set(
    ref(member, "crmCompany/data/customers/customer_first_owner/buildingIdLinks/building_owner_missing"),
    true,
  ));
  await assertFails(update(ref(member, "crmCompany/data"), {
    "buildings/building_owner_missing": linkedMissing,
  }));
  expect((await get(ref(member, "crmCompany/data/buildings/building_owner_missing/ownerCustomerId"))).exists())
    .toBe(false);

  await assertSucceeds(update(ref(member, "crmCompany/data"), {
    "buildings/building_owner_missing": linkedMissing,
    "customers/customer_first_owner/buildingIdLinks/building_owner_missing": true,
  }));
  expect((await get(ref(member, "crmCompany/data/buildings/building_owner_missing/ownerCustomerId"))).val())
    .toBe("customer_first_owner");
  await assertFails(set(
    ref(member, "crmCompany/data/customers/customer_second_owner/buildingIdLinks/building_owner_missing"),
    true,
  ));

  const linkedEmpty = {
    ...emptyOwner,
    ownerCustomerId: "customer_second_owner",
    entityVersion: 2,
    updatedAt: "2026-08-09T00:00:04.000Z",
  };
  await assertSucceeds(update(ref(member, "crmCompany/data"), {
    "buildings/building_owner_empty": linkedEmpty,
    "customers/customer_second_owner/buildingIdLinks/building_owner_empty": true,
  }));

  await assertFails(update(ref(member, "crmCompany/data"), {
    "buildings/building_owner_missing": {
      ...linkedMissing,
      ownerCustomerId: "customer_second_owner",
      entityVersion: 3,
      updatedAt: "2026-08-09T00:00:05.000Z",
    },
    "customers/customer_second_owner/buildingIdLinks/building_owner_missing": true,
  }));
  expect((await get(ref(member, "crmCompany/data/customers/customer_second_owner/buildingIdLinks/building_owner_missing"))).exists())
    .toBe(false);
  expect((await get(ref(member, "crmCompany/data/buildings/building_owner_missing/ownerCustomerId"))).val())
    .toBe("customer_first_owner");

  await assertFails(update(ref(member, "crmCompany/data"), {
    "buildings/building_owner_missing": {
      ...linkedMissing,
      ownerCustomerId: "",
      entityVersion: 3,
      updatedAt: "2026-08-09T00:00:06.000Z",
    },
  }));

  await assertSucceeds(update(ref(member, "crmCompany/data"), {
    "buildings/building_owner_legacy": {
      ...legacyOwned,
      name: "Legacy owner remains compatible",
      entityVersion: 2,
      updatedAt: "2026-08-09T00:00:07.000Z",
    },
  }));
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

  it("binds customer photos and complaint parties to post-write invariants", async () => {
    const source = JSON.parse(
      await readFile(resolve("../database.rules.json"), "utf8"),
    ) as { rules: Record<string, Record<string, unknown>> };
    const crm = source.rules.crmCompany as Record<string, Record<string, unknown>>;
    const data = crm.data as Record<string, Record<string, unknown>>;
    const customers = data.customers as Record<string, Record<string, unknown>>;
    const customer = customers.$customerId;
    const customerField = customer.$field as Record<string, unknown>;
    const photos = crm.customerPhotos as Record<string, Record<string, unknown>>;
    const photo = photos.$customerId;

    expect(String(customer[".write"])).toContain("newData.parent().parent().parent().child('customerPhotos')");
    expect(String(customerField[".write"])).toContain("newData.parent().parent().parent().parent().child('customerPhotos')");
    expect(String(photo[".write"])).toContain("newData.parent().parent().child('data').child('customers')");
    expect(String(photo[".validate"])).toContain("[/]9j[/]");

    for (const cases of [crm.cases, source.rules.cases]) {
      const validation = String((cases.$caseId as Record<string, unknown>)[".validate"]);
      expect(validation).toContain("newData.child('caseParty').val() === '건물주'");
      expect(validation).toContain("newData.child('caseParty').val() === '브링'");
      expect(validation).toContain("data.exists()");
    }
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
    const buildingValidation = String(
      (data.buildings as Record<string, Record<string, unknown>>).$entityId[".validate"],
    );
    expect(buildingValidation).toContain("data.child('ownerCustomerId').val() === ''");
    expect(buildingValidation).toContain("newData.child('ownerCustomerId').val() === data.child('ownerCustomerId').val()");
    expect(buildingValidation).toContain("matches(/^[A-Za-z0-9_-]+$/)");
    expect(buildingValidation).toContain("child('buildingIdLinks').child($entityId).val() === true");
    expect(buildingValidation).toContain("!root.child('crmCompany/data/customers')");
    expect(buildingValidation).toContain("child('archivedAt').val() === ''");
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
    expect(String(customer[".write"])).toContain("newData.child('id').val() === $customerId");
    expect(customerFieldWrite).toContain("$field !== 'buildingIdLinks'");
    expect(customerFieldWrite).toContain("$field !== 'id'");
    expect(customerFieldWrite).toContain("$field !== 'archivedAt'");
    expect(customerFieldWrite).toContain("data.parent().child('buildingIdLinks').exists()");
    expect(customerFieldWrite).toContain("auth.token.email");
    expect(String(buildingLink[".write"])).toContain("!data.exists()");
    expect(String(buildingLink[".write"])).toContain("newData.val() === true");
    expect(String(buildingLink[".write"])).toContain("auth.token.email");
    expect(String(buildingLink[".write"])).toContain("child('buildings').child($buildingId).child('ownerCustomerId').val() === $customerId");
    expect(String(buildingLink[".write"])).toContain("child('archivedAt').val() === ''");
    expect(String(buildingLink[".validate"])).toContain("newData.isBoolean()");
    const serviceRecords = data.serviceRecords as Record<string, Record<string, unknown> | boolean>;
    const serviceRecord = serviceRecords.$serviceRecordId as Record<string, unknown>;
    const serviceRecordValidation = String(serviceRecord[".validate"]);
    expect(serviceRecords[".write"]).toBe(false);
    expect(String(serviceRecord[".write"])).toContain("newData.exists()");
    expect(String(serviceRecord[".write"])).toContain("auth.token.email");
    expect(String(serviceRecord[".write"])).toContain("'admin'");
    expect(String(serviceRecord[".write"])).toContain("'member'");
    expect(String(serviceRecord[".write"])).toContain("data.child('status').val() !== 'cancelled'");
    expect(serviceRecordValidation).toContain("newData.child('id').val() === $serviceRecordId");
    expect(serviceRecordValidation).toContain("matches(/^[A-Za-z0-9_-]+$/)");
    expect(serviceRecordValidation).toContain("newData.child('calendarCommitRequestId').val().matches(/^[0-9A-Fa-f]{8}-");
    expect(serviceRecordValidation).toContain("newData.child('calendarCommitHash').val().matches(/^[0-9A-Fa-f]{64}$/)");
    expect(serviceRecordValidation).toContain("newData.child('calendarAuditId').val().matches(/^audit_schedule_[0-9A-Fa-f]{32}$/)");
    expect(serviceRecordValidation).toContain("newData.child('updatedByAuthUid').val() === auth.uid");
    expect(serviceRecordValidation).toContain("newData.child('updatedAt').val().matches(/^[0-9]{4}-");
    expect(serviceRecordValidation).toContain("newData.child('calendarCommitVersion').val() === 1");
    expect(serviceRecordValidation).toContain("!data.child('calendarCommitVersion').isNumber()");
    expect(serviceRecordValidation).toContain("newData.child('calendarCommitVersion').val() === data.child('calendarCommitVersion').val() + 1");
    expect(serviceRecordValidation).toContain("newData.child('calendarCommitVersion').val() <= 9007199254740991");
    expect(serviceRecordValidation).toContain("newData.child('calendarCommitRequestId').val() !== data.child('calendarCommitRequestId').val()");
    expect(serviceRecordValidation).toContain("newData.child('calendarCommitHash').val() !== data.child('calendarCommitHash').val()");
    expect(serviceRecordValidation).toContain("newData.child('calendarAuditId').val() !== data.child('calendarAuditId').val()");
    expect(serviceRecordValidation).toContain("newData.child('updatedAt').val() !== data.child('updatedAt').val()");
    expect(serviceRecordValidation).toContain("data.child('buildingId').val() === newData.child('buildingId').val()");
    expect(serviceRecordValidation).toContain("child('buildings').child(newData.child('buildingId').val())");
    expect(serviceRecordValidation).toContain("child('archivedAt').val() === ''");
    for (const writable of [
      "schemaVersion", "company", "updatedAt", "updatedBy",
      "activities", "contracts", "partnerVendors", "partnerQuotes", "tasks",
      "serviceContracts", "serviceSchedules", "securityAssets", "auditLogs",
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

  it("keeps Drive import candidates read-only behind exact CRM access in both rule sets", async () => {
    const production = JSON.parse(
      await readFile(resolve("../database.rules.json"), "utf8"),
    ) as { rules: { crmCompany: Record<string, Record<string, unknown>> } };
    const cutover = JSON.parse(
      await readFile(
        resolve("tests/field/fixtures/database-cutover.rules.json"),
        "utf8",
      ),
    ) as { rules: { crmCompany: Record<string, Record<string, unknown>> } };
    const productionRule = production.rules.crmCompany.driveImportCandidates;
    const cutoverRule = cutover.rules.crmCompany.driveImportCandidates;
    const readRule = String(productionRule[".read"]);

    expect(productionRule).toEqual(cutoverRule);
    expect(readRule).toContain("crmCompany/access");
    expect(readRule).toContain("enabled");
    expect(readRule).toContain("auth.token.email");
    expect(readRule).toContain("'admin'");
    expect(readRule).toContain("'member'");
    expect(readRule).toContain("'viewer'");
    expect(productionRule[".write"]).toBe(false);
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

  it("allows only a verified password user to clear their own first-password gate", async () => {
    const production = JSON.parse(
      await readFile(resolve("../database.rules.json"), "utf8"),
    ) as { rules: { crmCompany: { access: Record<string, unknown> } } };
    const cutover = JSON.parse(
      await readFile(
        resolve("tests/field/fixtures/database-cutover.rules.json"),
        "utf8",
      ),
    ) as { rules: { crmCompany: { access: Record<string, unknown> } } };
    const access = production.rules.crmCompany.access as {
      $uid: {
        ".write": boolean;
        mustChangePassword: { ".write": string; ".validate": string };
      };
    };
    const gate = access.$uid.mustChangePassword;
    const productionUidWithoutDisplayName = {
      ...(access.$uid as unknown as Record<string, unknown>),
    };
    delete productionUidWithoutDisplayName.displayName;

    expect({ ...access, $uid: productionUidWithoutDisplayName })
      .toEqual(cutover.rules.crmCompany.access);
    expect(access.$uid[".write"]).toBe(false);
    expect(gate[".write"]).toContain("auth.uid === $uid");
    expect(gate[".write"]).toContain("email_verified === true");
    expect(gate[".write"]).toContain("sign_in_provider === 'password'");
    expect(gate[".write"]).toContain("child('enabled').val() === true");
    expect(gate[".write"]).toContain("child('email').val() === auth.token.email");
    expect(gate[".write"]).toContain("data.val() === true");
    expect(gate[".write"]).toContain("newData.val() === false");
    expect(gate[".validate"]).toBe("newData.isBoolean()");
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
    const buildingFields = ((dataRules.buildings as Record<string, unknown>).$entityId as Record<string, unknown>);
    expect(buildingFields).toHaveProperty("roadAddress");
    expect(buildingFields).toHaveProperty("jibunAddress");
    expect(String(buildingFields[".validate"])).toContain("address').val() === newData.child('roadAddress').val()");
    expect(String(buildingFields[".validate"])).toContain("address').val() === newData.child('jibunAddress').val()");
    expect(String(buildingFields[".validate"])).toContain("child('buildingIdLinks').child($entityId).val() === true");
    expect(String(buildingFields[".validate"])).toContain("matches(/^[A-Za-z0-9_-]+$/)");
    expect(String(buildingFields[".validate"])).toContain("!root.child('crmCompany/data/customers')");
    const fixtureCustomer = dataRules.customers as Record<string, Record<string, unknown>>;
    const fixtureCustomerRecord = fixtureCustomer.$customerId;
    const fixtureLink = (fixtureCustomerRecord.buildingIdLinks as Record<string, Record<string, unknown>>).$buildingId;
    expect(fixtureCustomer[".write"]).toBeUndefined();
    expect(String(fixtureCustomerRecord[".write"])).toContain("!newData.child('buildingIdLinks').exists()");
    expect(String(fixtureCustomerRecord[".write"])).toContain("newData.child('id').val() === $customerId");
    expect(String(
      (fixtureCustomerRecord.$field as Record<string, unknown>)[".write"],
    )).toContain("$field !== 'buildingIdLinks'");
    expect(String(
      (fixtureCustomerRecord.$field as Record<string, unknown>)[".write"],
    )).toContain("$field !== 'id'");
    expect(String(
      (fixtureCustomerRecord.$field as Record<string, unknown>)[".write"],
    )).toContain("$field !== 'archivedAt'");
    expect(String(fixtureLink[".write"])).toContain("!data.exists()");
    expect(String(fixtureLink[".write"])).toContain("newData.val() === true");
    expect(String(fixtureLink[".write"])).toContain("child('buildings').child($buildingId).child('ownerCustomerId').val() === $customerId");
    expect(String(fixtureLink[".write"])).toContain("child('archivedAt').val() === ''");
    const fixtureServiceRecords = dataRules.serviceRecords as Record<string, Record<string, unknown> | boolean>;
    const fixtureServiceRecord = fixtureServiceRecords.$serviceRecordId as Record<string, unknown>;
    const fixtureServiceRecordValidation = String(fixtureServiceRecord[".validate"]);
    expect(fixtureServiceRecords[".write"]).toBe(false);
    expect(String(fixtureServiceRecord[".write"])).toContain("newData.exists()");
    expect(String(fixtureServiceRecord[".write"])).toContain("data.child('status').val() !== 'cancelled'");
    expect(fixtureServiceRecordValidation).toContain("newData.child('id').val() === $serviceRecordId");
    expect(fixtureServiceRecordValidation).toContain("newData.child('calendarCommitRequestId').val().matches(/^[0-9A-Fa-f]{8}-");
    expect(fixtureServiceRecordValidation).toContain("newData.child('calendarCommitHash').val().matches(/^[0-9A-Fa-f]{64}$/)");
    expect(fixtureServiceRecordValidation).toContain("newData.child('calendarAuditId').val().matches(/^audit_schedule_[0-9A-Fa-f]{32}$/)");
    expect(fixtureServiceRecordValidation).toContain("newData.child('updatedByAuthUid').val() === auth.uid");
    expect(fixtureServiceRecordValidation).toContain("!data.child('calendarCommitVersion').isNumber()");
    expect(fixtureServiceRecordValidation).toContain("newData.child('calendarCommitVersion').val() === data.child('calendarCommitVersion').val() + 1");
    expect(fixtureServiceRecordValidation).toContain("newData.child('calendarCommitRequestId').val() !== data.child('calendarCommitRequestId').val()");
    expect(fixtureServiceRecordValidation).toContain("newData.child('calendarAuditId').val() !== data.child('calendarAuditId').val()");
    expect(fixtureServiceRecordValidation).toContain("data.child('buildingId').val() === newData.child('buildingId').val()");
    expect(fixtureServiceRecordValidation).toContain("child('archivedAt').val() === ''");
    for (const legacy of [
      "activities",
      "contracts",
      "partnerVendors",
      "partnerQuotes",
      "tasks",
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
  it("keeps the company quote supplier fixed, readable by clean staff, and writable only by admins", async () => {
    const path = "crmCompany/quoteSupplier";
    const admin = environment.authenticatedContext(
      "crm-admin",
      crmClaims("admin@bring.test"),
    ).database();
    const standardAdmin = environment.authenticatedContext(
      "crm-standard-admin",
      crmClaims("standard-admin@bring.test"),
    ).database();
    const member = environment.authenticatedContext(
      "crm-legacy-member",
      crmClaims("legacy@bring.test"),
    ).database();
    const viewer = environment.authenticatedContext(
      "crm-viewer",
      crmClaims("viewer@bring.test"),
    ).database();
    const record = (version: number, updatedByAuthUid: string) => ({
      businessName: "테스트 상호",
      representative: "테스트 대표",
      registrationNumber: "123-45-67890",
      version,
      updatedAtMs: serverTimestamp(),
      updatedByAuthUid,
    });

    await assertSucceeds(set(ref(admin, path), record(1, "crm-admin")));
    for (const database of [admin, standardAdmin, member, viewer]) {
      await assertSucceeds(get(ref(database, path)));
    }

    const rejected = [
      environment.unauthenticatedContext().database(),
      environment.authenticatedContext("crm-member", crmClaims("member@bring.test")).database(),
      environment.authenticatedContext("crm-disabled", crmClaims("disabled@bring.test")).database(),
      environment.authenticatedContext("crm-viewer", crmClaims("wrong@bring.test")).database(),
      environment.authenticatedContext("crm-admin", crmPasswordClaims("admin@bring.test", false)).database(),
    ];
    for (const database of rejected) {
      await assertFails(get(ref(database, path)));
      await assertFails(set(ref(database, path), record(2, "crm-admin")));
    }
    await assertFails(set(ref(member, path), record(2, "crm-legacy-member")));
    await assertFails(set(ref(viewer, path), record(2, "crm-viewer")));
    await assertSucceeds(set(ref(standardAdmin, path), record(2, "crm-standard-admin")));
    await assertFails(set(ref(standardAdmin, path), record(2, "crm-standard-admin")));
    await assertFails(set(ref(standardAdmin, path), { ...record(3, "crm-standard-admin"), unexpected: true }));
    await assertFails(set(ref(standardAdmin, path), { ...record(3, "crm-standard-admin"), registrationNumber: "1234567890" }));
    await assertFails(set(ref(standardAdmin, path), { ...record(3, "crm-standard-admin"), businessName: "" }));
    await assertFails(set(ref(standardAdmin, path), { ...record(3, "crm-standard-admin"), businessName: " 앞 공백" }));
    await assertFails(set(ref(standardAdmin, path), { ...record(3, "crm-standard-admin"), representative: "정상처럼\u202E보이는 이름" }));
    await assertFails(remove(ref(standardAdmin, path)));
  });

  it("lets only the verified password user clear their own first-password gate", async () => {
    const gatePath = "crmCompany/access/crm-member/mustChangePassword";
    const authorized = environment.authenticatedContext(
      "crm-member",
      crmPasswordClaims("member@bring.test"),
    ).database();
    const rejected = [
      environment.unauthenticatedContext().database(),
      environment.authenticatedContext(
        "crm-admin",
        crmPasswordClaims("admin@bring.test"),
      ).database(),
      environment.authenticatedContext(
        "crm-member",
        crmPasswordClaims("wrong@bring.test"),
      ).database(),
      environment.authenticatedContext(
        "crm-member",
        crmPasswordClaims("member@bring.test", false),
      ).database(),
      environment.authenticatedContext(
        "crm-member",
        crmPasswordClaims("member@bring.test", true, "google.com"),
      ).database(),
      environment.authenticatedContext(
        "crm-member",
        crmClaims("member@bring.test"),
      ).database(),
    ];

    for (const database of rejected) {
      await assertFails(set(ref(database, gatePath), false));
    }
    await assertFails(set(ref(authorized, gatePath), true));
    await assertFails(update(ref(authorized, "crmCompany/access/crm-member"), {
      mustChangePassword: false,
      role: "admin",
    }));
    await assertSucceeds(set(ref(authorized, gatePath), false));
    expect((await assertSucceeds(get(ref(authorized, gatePath)))).val()).toBe(false);
    await assertFails(set(ref(authorized, gatePath), true));
    await assertFails(remove(ref(authorized, gatePath)));
  });

  it("lets only a clean office administrator set canonical staff display names", async () => {
    const displayNamePath = "crmCompany/access/crm-viewer/displayName";
    const ownDisplayNamePath = "crmCompany/access/crm-admin/displayName";
    const officeAdmin = environment.authenticatedContext(
      "crm-admin",
      crmClaims("admin@bring.test"),
    ).database();
    const ordinaryMember = environment.authenticatedContext(
      "crm-legacy-member",
      crmClaims("legacy@bring.test"),
    ).database();
    const viewer = environment.authenticatedContext(
      "crm-viewer",
      crmClaims("viewer@bring.test"),
    ).database();
    const deniedWriters = [
      environment.unauthenticatedContext().database(),
      ordinaryMember,
      viewer,
      environment.authenticatedContext(
        "crm-standard-admin",
        crmClaims("standard-admin@bring.test"),
      ).database(),
      environment.authenticatedContext(
        "crm-admin",
        crmClaims("wrong@bring.test"),
      ).database(),
      environment.authenticatedContext(
        "crm-office-disabled",
        crmClaims("office-disabled@bring.test"),
      ).database(),
      environment.authenticatedContext(
        "crm-office-pending",
        crmClaims("office-pending@bring.test"),
      ).database(),
    ];

    for (const database of deniedWriters) {
      await assertFails(set(ref(database, displayNamePath), "허용되지 않은 이름"));
    }

    await assertSucceeds(set(ref(officeAdmin, displayNamePath), "황우중"));
    await assertSucceeds(set(ref(officeAdmin, displayNamePath), "황우중 매니저"));
    await assertSucceeds(set(ref(officeAdmin, ownDisplayNamePath), "김현진 관리자"));
    expect((await assertSucceeds(get(ref(officeAdmin, displayNamePath)))).val()).toBe("황우중 매니저");
    expect((await assertSucceeds(get(ref(ordinaryMember, displayNamePath)))).val()).toBe("황우중 매니저");
    expect((await assertSucceeds(get(ref(ordinaryMember, ownDisplayNamePath)))).val()).toBe("김현진 관리자");
    expect((await assertSucceeds(get(ref(viewer, displayNamePath)))).val()).toBe("황우중 매니저");
    expect((await assertSucceeds(get(ref(viewer, ownDisplayNamePath)))).val()).toBe("김현진 관리자");

    await assertFails(set(ref(officeAdmin, displayNamePath), ""));
    await assertFails(set(ref(officeAdmin, displayNamePath), " 앞 공백"));
    await assertFails(set(ref(officeAdmin, displayNamePath), "뒤 공백 "));
    await assertFails(set(ref(officeAdmin, displayNamePath), "줄바꿈\n이름"));
    await assertFails(set(ref(officeAdmin, displayNamePath), "줄\u2028구분 이름"));
    await assertFails(set(ref(officeAdmin, displayNamePath), "문단\u2029구분 이름"));
    await assertFails(set(ref(officeAdmin, displayNamePath), "정상처럼\u202E보이는 이름"));
    await assertFails(set(ref(officeAdmin, displayNamePath), "숨김\u200D문자"));
    await assertFails(set(ref(officeAdmin, displayNamePath), "가".repeat(81)));
    await assertFails(remove(ref(officeAdmin, displayNamePath)));
    await assertFails(set(ref(ordinaryMember, "crmCompany/access/crm-legacy-member/displayName"), "일반 구성원 본인 변경"));
    await assertFails(set(ref(viewer, "crmCompany/access/crm-viewer/displayName"), "조회자 본인 변경"));
    await assertFails(set(ref(officeAdmin, "crmCompany/access/missing-user/displayName"), "없는 사용자"));
    await assertFails(set(ref(officeAdmin, "crmCompany/access/crm-disabled/displayName"), "비활성 사용자"));
    await assertFails(set(ref(officeAdmin, "crmCompany/access/crm-office-pending/displayName"), "비밀번호 변경 대기 사용자"));
    await assertFails(set(ref(officeAdmin, "crmCompany/access/crm-invalid-role/displayName"), "비Office 사용자"));
    await assertFails(update(ref(officeAdmin, "crmCompany/access/crm-viewer"), {
      displayName: "권한 변조",
      role: "admin",
    }));
    expect((await assertSucceeds(get(ref(officeAdmin, "crmCompany/access/crm-viewer/role")))).val()).toBe("viewer");
    expect((await assertSucceeds(get(ref(officeAdmin, displayNamePath)))).val()).toBe("황우중 매니저");
    expect((await assertSucceeds(get(ref(officeAdmin, ownDisplayNamePath)))).val()).toBe("김현진 관리자");
  });

  it("freezes an approval once it is decided", async () => {
    // 승인받은 지출의 금액이 나중에 바뀔 수 있으면 결재 기록이 아무 의미가 없다.
    const admin = environment.authenticatedContext("crm-admin", crmClaims("admin@bring.test")).database();
    const member = environment.authenticatedContext("crm-member", crmClaims("member@bring.test")).database();
    const viewer = environment.authenticatedContext("crm-viewer", crmClaims("viewer@bring.test")).database();

    const target = "crmCompany/officeApprovals/crm-viewer/ap-1";
    const request = {
      id: "ap-1",
      userId: "crm-viewer",
      kind: "expense",
      title: "청소 세제 구매",
      amount: 120000,
      vendor: "",
      dueDate: "",
      content: "",
      attachmentUrl: "",
      status: "requested",
      decidedBy: "",
      decidedAt: "",
      decisionNote: "",
      createdAt: "2026-09-06T00:00:00.000Z",
    };

    // 상신은 언제나 대기로만. 스스로 승인한 채로 올리는 길을 막는다.
    await assertFails(set(ref(viewer, target), { ...request, status: "approved", decidedBy: "본인" }));
    await assertSucceeds(set(ref(viewer, target), request));

    // 남의 칸에 대신 올리지 못하고, 남의 결재를 읽지도 못한다.
    await assertFails(set(ref(member, "crmCompany/officeApprovals/crm-viewer/ap-2"), request));
    await assertFails(get(ref(member, target)));
    await assertFails(get(ref(member, "crmCompany/officeApprovals")));

    // 상신자는 승인하지 못한다.
    await assertFails(set(ref(viewer, target), { ...request, status: "approved", decidedBy: "김현진" }));
    // 취소는 되지만, 금액을 바꾸면서 취소할 수는 없다.
    await assertFails(set(ref(viewer, target), { ...request, amount: 12000, status: "cancelled" }));

    // 반려에는 사유가 있어야 한다.
    await assertFails(set(ref(admin, target), { ...request, status: "rejected", decidedBy: "김현진" }));

    // 관리자가 승인한다.
    await assertSucceeds(set(ref(admin, target), {
      ...request, status: "approved", decidedBy: "김현진", decidedAt: "2026-09-06T01:00:00.000Z",
    }));

    // 정해진 뒤에는 아무도 못 고친다 — 관리자도, 상신자도.
    await assertFails(set(ref(admin, target), {
      ...request, amount: 20000, status: "approved", decidedBy: "김현진", decidedAt: "2026-09-06T01:00:00.000Z",
    }));
    await assertFails(set(ref(viewer, target), { ...request, status: "cancelled" }));
    // 지우지도 못한다.
    await assertFails(remove(ref(admin, target)));
  });

  it("rejects unknown fields and bad amounts on approvals", async () => {
    const viewer = environment.authenticatedContext("crm-viewer", crmClaims("viewer@bring.test")).database();
    const base = {
      userId: "crm-viewer",
      kind: "general",
      title: "비품 정리",
      amount: 0,
      status: "requested",
      createdAt: "2026-09-06T00:00:00.000Z",
    };
    // 결재는 한 번 올리면 그 칸을 다시 쓰지 못한다. 그래서 경우마다 새 번호로
    // 올려 본다 — 같은 번호로 다시 쓰면 "내용이 틀려서" 가 아니라 "이미
    // 있어서" 막히는 것이라, 검사가 무엇을 확인했는지 알 수 없게 된다.
    const at = (id: string) => `crmCompany/officeApprovals/crm-viewer/${id}`;
    const record = (id: string, patch: Record<string, unknown> = {}) => ({ ...base, id, ...patch });

    await assertSucceeds(set(ref(viewer, at("ok-1")), record("ok-1")));

    // 원 단위 정수만. 소수점이 붙은 원화는 없다.
    await assertFails(set(ref(viewer, at("bad-1")), record("bad-1", { amount: 1000.5 })));
    await assertFails(set(ref(viewer, at("bad-2")), record("bad-2", { amount: -1000 })));
    await assertFails(set(ref(viewer, at("bad-3")), record("bad-3", { amount: "120000" })));
    // 모르는 종류와 모르는 칸은 막는다.
    await assertFails(set(ref(viewer, at("bad-4")), record("bad-4", { kind: "bribe" })));
    await assertFails(set(ref(viewer, at("bad-5")), record("bad-5", { secret: "x" })));
    // id 를 다른 것으로 적어 다른 결재인 척할 수 없다.
    await assertFails(set(ref(viewer, at("bad-6")), record("ap-9")));
    // 첨부는 https 만.
    await assertFails(set(ref(viewer, at("bad-7")), record("bad-7", { attachmentUrl: "http://x.test/a" })));
    await assertSucceeds(set(ref(viewer, at("ok-2")), record("ok-2", { attachmentUrl: "https://x.test/a" })));

    // 올린 뒤에는 같은 칸을 다시 쓰지 못한다. 고치려면 취소하고 다시 올린다.
    await assertFails(set(ref(viewer, at("ok-1")), record("ok-1", { title: "다른 제목" })));
  });

  it("lets only administrators author projects and never delete one", async () => {
    // 프로젝트가 사라지면 그 아래 지시들이 갈 곳을 잃는다.
    const admin = environment.authenticatedContext("crm-admin", crmClaims("admin@bring.test")).database();
    const member = environment.authenticatedContext("crm-legacy-member", crmClaims("legacy@bring.test")).database();
    const at = (id: string) => `crmCompany/projects/${id}`;
    const project = (id: string, patch: Record<string, unknown> = {}) => ({
      id,
      name: "브링 케어",
      owner: "브링엔지니어링",
      goal: "",
      status: "active",
      startDate: "2026-07-03",
      endDate: "2026-08-28",
      createdAt: "2026-09-06T00:00:00.000Z",
      updatedAt: "2026-09-06T00:00:00.000Z",
      updatedBy: "crm-admin",
      ...patch,
    });

    await assertSucceeds(set(ref(admin, at("p1")), project("p1")));
    // 팀원은 읽지만 만들지는 못한다.
    await assertSucceeds(get(ref(member, at("p1"))));
    await assertFails(set(ref(member, at("p2")), { ...project("p2"), updatedBy: "crm-legacy-member" }));
    // 이름이 없으면 목록에서 무엇인지 알 수 없다.
    await assertFails(set(ref(admin, at("p3")), project("p3", { name: "" })));
    // 시작일이 종료일보다 늦으면 간트에서 막대가 거꾸로 그려진다.
    await assertFails(set(ref(admin, at("p4")), project("p4", { startDate: "2026-09-01", endDate: "2026-08-01" })));
    await assertFails(set(ref(admin, at("p5")), project("p5", { budget: 1000 })));
    await assertFails(remove(ref(admin, at("p1"))));
  });

  it("keeps a work order's schedule and progress in a shape the chart can draw", async () => {
    const admin = environment.authenticatedContext("crm-admin", crmClaims("admin@bring.test")).database();
    const at = (id: string) => `crmCompany/workOrders/${id}`;
    const order = (id: string, patch: Record<string, unknown> = {}) => ({
      id,
      title: "건물지도",
      why: "현장에서 동 호수를 못 찾아 헤맵니다.",
      what: "도면을 받아 층별 지도를 만듭니다.",
      doneWhen: "층별 지도 PDF 가 올라오면 끝입니다.",
      assigneeUid: "crm-legacy-member",
      assigneeName: "황우중",
      projectId: "p1",
      track: "tech",
      startDate: "2026-06-29",
      dueDate: "2026-07-03",
      progress: 98,
      status: "doing",
      reviewNote: "",
      createdBy: "대표",
      createdAt: "2026-09-06T00:00:00.000Z",
      updatedAt: "2026-09-06T00:00:00.000Z",
      updatedBy: "crm-admin",
      ...patch,
    });

    await assertSucceeds(set(ref(admin, at("g1")), order("g1")));
    // 시작일이 마감일보다 늦으면 막대가 거꾸로 그려진다.
    await assertFails(set(ref(admin, at("g2")), order("g2", { startDate: "2026-07-10", dueDate: "2026-07-03" })));
    // 진행률은 0~100 정수만. 소수점을 두면 두 사람이 다른 숫자를 본다.
    await assertFails(set(ref(admin, at("g3")), order("g3", { progress: 130 })));
    await assertFails(set(ref(admin, at("g4")), order("g4", { progress: 12.5 })));
    await assertFails(set(ref(admin, at("g5")), order("g5", { progress: "80" })));
    // 모르는 구분은 막는다. 칸이 늘어나면 표가 흩어진다.
    await assertFails(set(ref(admin, at("g6")), order("g6", { track: "sales" })));
    // 날짜가 없어도 지시는 남는다. 날짜를 안 정한 일이야말로 먼저 손봐야 한다.
    await assertSucceeds(set(ref(admin, at("g7")), order("g7", { startDate: "", dueDate: "", progress: 0 })));
  });

  it("lets anyone who works own the supply catalogue and never delete an item", async () => {
    // 품목을 지우면 그 품목에 달린 과거 기록의 이름이 사라진다. 안 쓰는
    // 것은 active 를 내려 목록 아래로 보낸다.
    const admin = environment.authenticatedContext("crm-admin", crmClaims("admin@bring.test")).database();
    const member = environment.authenticatedContext("crm-legacy-member", crmClaims("legacy@bring.test")).database();
    const viewer = environment.authenticatedContext("crm-viewer", crmClaims("viewer@bring.test")).database();
    const at = (id: string) => `crmCompany/supplyItems/${id}`;
    const item = (id: string, patch: Record<string, unknown> = {}) => ({
      id,
      name: "락스 4L",
      category: "clean",
      spec: "4L",
      unit: "통",
      minStock: 5,
      location: "사무실 창고 2번칸",
      vendor: "자재상",
      note: "",
      active: true,
      createdAt: "2026-09-06T00:00:00.000Z",
      updatedAt: "2026-09-06T00:00:00.000Z",
      updatedBy: "crm-admin",
      ...patch,
    });

    await assertSucceeds(set(ref(admin, at("s1")), item("s1")));
    // 무엇이 창고에 있는지는 팀 전체가 안다. 감출 것이 아니다.
    await assertSucceeds(get(ref(member, at("s1"))));
    await assertSucceeds(get(ref(member, "crmCompany/supplyItems")));
    // 창고를 채우는 사람이 등록한다. 대표만 등록하게 하면 등록이 안 된다.
    await assertSucceeds(set(ref(member, at("s2")), { ...item("s2"), updatedBy: "crm-legacy-member" }));
    // 조회 전용 계정은 보기만 한다. 그건 그 계정의 뜻이다.
    await assertFails(set(ref(viewer, at("s8")), { ...item("s8"), updatedBy: "crm-viewer" }));
    // 이름과 단위가 없으면 목록에서 무엇인지, 몇 개인지 알 수 없다.
    await assertFails(set(ref(admin, at("s3")), item("s3", { name: "" })));
    await assertFails(set(ref(admin, at("s4")), item("s4", { unit: "" })));
    // 모르는 분류는 막는다. 분류가 늘어나면 창고 칸이 흩어진다.
    await assertFails(set(ref(admin, at("s5")), item("s5", { category: "우리끼리" })));
    // 남은 수량을 품목에 적어 두는 길을 막는다. 그 숫자는 기록에서 센다.
    await assertFails(set(ref(admin, at("s6")), item("s6", { stock: 12 })));
    // 단가는 여기 못 적는다. 지금은 팀 전체가 보지만 노드는 갈라 둔다 —
    // 다시 닫아야 할 날이 오면 규칙 한 줄로 닫히게 하려고.
    await assertFails(set(ref(admin, at("s7")), item("s7", { unitPrice: 3200 })));
    // 지우는 것은 아무도 못 한다.
    await assertFails(remove(ref(member, at("s1"))));
    await assertFails(remove(ref(admin, at("s1"))));
  });

  it("keeps the supply ledger append-only and lets anyone who works book stock in", async () => {
    const admin = environment.authenticatedContext("crm-admin", crmClaims("admin@bring.test")).database();
    const member = environment.authenticatedContext("crm-legacy-member", crmClaims("legacy@bring.test")).database();
    const viewer = environment.authenticatedContext("crm-viewer", crmClaims("viewer@bring.test")).database();

    await assertSucceeds(set(ref(admin, "crmCompany/supplyItems/m1"), {
      id: "m1", name: "마대", category: "clean", unit: "장", minStock: 10, active: true,
      createdAt: "2026-09-06T00:00:00.000Z", updatedAt: "2026-09-06T00:00:00.000Z", updatedBy: "crm-admin",
    }));

    const at = (id: string) => `crmCompany/supplyMoves/${id}`;
    const move = (id: string, uid: string, patch: Record<string, unknown> = {}) => ({
      id,
      itemId: "m1",
      kind: "out",
      qty: 2,
      date: "2026-09-06",
      buildingId: "",
      reason: "",
      byName: "황우중",
      createdAt: "2026-09-06T00:00:00.000Z",
      createdBy: uid,
      ...patch,
    });

    // 쓴 사람이 그 자리에서 적는다.
    await assertSucceeds(set(ref(member, at("v1")), move("v1", "crm-legacy-member")));
    // 조회 전용 계정은 재고를 못 움직인다.
    await assertFails(set(ref(viewer, at("v2")), move("v2", "crm-viewer")));
    // 남의 이름으로 적지 못한다.
    await assertFails(set(ref(member, at("v3")), move("v3", "crm-admin")));

    // 입고와 실사도 받는 사람·세는 사람이 그 자리에서 적는다.
    await assertSucceeds(set(ref(member, at("v4")), move("v4", "crm-legacy-member", { kind: "in", qty: 20 })));
    await assertSucceeds(set(ref(member, at("v5")), move("v5", "crm-legacy-member", { kind: "adjust", qty: 7, reason: "재고조사" })));
    await assertSucceeds(set(ref(admin, at("v6")), move("v6", "crm-admin", { kind: "in", qty: 20 })));
    await assertSucceeds(set(ref(admin, at("v7")), move("v7", "crm-admin", { kind: "adjust", qty: 7, reason: "재고조사" })));
    // 조회 전용 계정은 어느 종류도 못 적는다.
    await assertFails(set(ref(viewer, at("v17")), move("v17", "crm-viewer", { kind: "in", qty: 5 })));

    // 폐기와 실사는 이유가 있어야 한다. 없으면 나중에 왜 줄었는지 모른다.
    await assertFails(set(ref(member, at("v8")), move("v8", "crm-legacy-member", { kind: "disposal", qty: 1 })));
    await assertSucceeds(set(ref(member, at("v9")), move("v9", "crm-legacy-member", { kind: "disposal", qty: 1, reason: "찢어짐" })));
    await assertFails(set(ref(admin, at("v10")), move("v10", "crm-admin", { kind: "adjust", qty: 0 })));
    // 실사만 0 을 받는다. "세어 보니 하나도 없었다" 는 뜻이 있는 숫자다.
    await assertSucceeds(set(ref(admin, at("v11")), move("v11", "crm-admin", { kind: "adjust", qty: 0, reason: "다 씀" })));
    await assertFails(set(ref(member, at("v12")), move("v12", "crm-legacy-member", { qty: 0 })));

    // 없는 품목에 붙은 기록은 어느 화면에서도 안 보인다.
    await assertFails(set(ref(member, at("v13")), move("v13", "crm-legacy-member", { itemId: "없음" })));
    // 수량은 숫자다. 문자열이 들어오면 합계가 이어붙는다.
    await assertFails(set(ref(member, at("v14")), move("v14", "crm-legacy-member", { qty: "2" })));
    await assertFails(set(ref(member, at("v15")), move("v15", "crm-legacy-member", { kind: "steal" })));
    await assertFails(set(ref(member, at("v16")), move("v16", "crm-legacy-member", { memo: "x" })));

    // 한 번 적은 기록은 못 고친다. 고칠 수 있는 장부는 장부가 아니다.
    await assertFails(set(ref(member, at("v1")), move("v1", "crm-legacy-member", { qty: 99 })));
    await assertFails(set(ref(admin, at("v1")), move("v1", "crm-admin", { qty: 99 })));
    // 지우는 것은 관리자만. 오타 하나가 영원히 남으면 아무도 안 적는다.
    await assertFails(remove(ref(member, at("v1"))));
    await assertSucceeds(remove(ref(admin, at("v1"))));
  });

  it("keeps supply unit prices in their own node even though the team can read them", async () => {
    // 대표가 팀 전체에게 열라고 정했다. 그래도 품목 안으로 합치지 않는다 —
    // Firebase 는 부모가 읽기를 허용하면 자식에서 못 막으므로, 다시 닫아야
    // 할 날이 오면 노드가 갈려 있어야 규칙 한 줄로 닫힌다.
    const admin = environment.authenticatedContext("crm-admin", crmClaims("admin@bring.test")).database();
    const member = environment.authenticatedContext("crm-legacy-member", crmClaims("legacy@bring.test")).database();
    const viewer = environment.authenticatedContext("crm-viewer", crmClaims("viewer@bring.test")).database();

    await assertSucceeds(set(ref(admin, "crmCompany/supplyItems/c1"), {
      id: "c1", name: "실리콘", category: "consumable", unit: "개", minStock: 0, active: true,
      createdAt: "2026-09-06T00:00:00.000Z", updatedAt: "2026-09-06T00:00:00.000Z", updatedBy: "crm-admin",
    }));

    const target = "crmCompany/supplyCosts/c1";
    const cost = {
      itemId: "c1",
      unitPrice: 3200,
      pricedAt: "2026-09-01",
      updatedAt: "2026-09-06T00:00:00.000Z",
      updatedBy: "crm-admin",
    };
    await assertSucceeds(set(ref(admin, target), cost));
    await assertSucceeds(get(ref(admin, target)));
    // 값을 아는 사람이 적고, 팀 전체가 읽는다.
    await assertSucceeds(get(ref(member, target)));
    await assertSucceeds(get(ref(viewer, target)));
    await assertSucceeds(get(ref(member, "crmCompany/supplyCosts")));
    await assertSucceeds(set(ref(member, target), { ...cost, updatedBy: "crm-legacy-member" }));
    // 조회 전용 계정은 읽되 못 고친다.
    await assertFails(set(ref(viewer, target), { ...cost, updatedBy: "crm-viewer" }));
    // 음수 단가는 어디서도 뜻이 없다.
    await assertFails(set(ref(admin, target), { ...cost, unitPrice: -100 }));
    await assertFails(set(ref(admin, target), { ...cost, vendorSecret: "x" }));
    // 지우는 길은 없다 — 품목과 같다.
    await assertFails(remove(ref(admin, target)));
  });

  it("keeps HR records readable only by the person and administrators", async () => {
    // 입사일·계약형태는 그 사람 것이다. 옆자리 동료가 볼 이유가 없다.
    const admin = environment.authenticatedContext("crm-admin", crmClaims("admin@bring.test")).database();
    const member = environment.authenticatedContext("crm-member", crmClaims("member@bring.test")).database();
    const viewer = environment.authenticatedContext("crm-viewer", crmClaims("viewer@bring.test")).database();
    const anonymous = environment.unauthenticatedContext().database();

    const target = "crmCompany/officeMembers/crm-viewer";
    const record = {
      userId: "crm-viewer",
      hireDate: "2024-03-01",
      employmentType: "regular",
      updatedAt: "2026-09-06T00:00:00.000Z",
      updatedBy: "crm-admin",
    };

    // 관리자만 쓴다. 본인도 자기 인사기록을 못 고친다 — 입사일을 스스로
    // 바꿀 수 있으면 연차 발생일수를 스스로 늘릴 수 있다.
    await assertSucceeds(set(ref(admin, target), record));
    await assertFails(set(ref(viewer, target), { ...record, hireDate: "2020-01-01", updatedBy: "crm-viewer" }));

    // 본인은 읽는다. 회사가 무엇을 들고 있는지 알아야 한다.
    await assertSucceeds(get(ref(viewer, target)));
    // 동료는 못 읽는다.
    await assertFails(get(ref(member, target)));
    await assertFails(get(ref(member, "crmCompany/officeMembers")));
    await assertFails(get(ref(anonymous, target)));
    // 전체 명부는 관리자만.
    await assertSucceeds(get(ref(admin, "crmCompany/officeMembers")));
  });

  it("refuses resident registration numbers and unknown fields in HR records", async () => {
    // 개인정보보호법 24조의2 — 법령 근거 없이 주민번호를 처리할 수 없다.
    // 화면에서 막는 것만으로는 부족하다. 서버가 판단해야 진짜로 막힌다.
    const admin = environment.authenticatedContext("crm-admin", crmClaims("admin@bring.test")).database();
    const target = "crmCompany/officeMembers/crm-member";
    const base = {
      userId: "crm-member",
      updatedAt: "2026-09-06T00:00:00.000Z",
      updatedBy: "crm-admin",
    };

    await assertSucceeds(set(ref(admin, target), base));

    // 비고란에 적어도 막힌다. 칸이 없으면 사람은 비고란에 적는다.
    await assertFails(set(ref(admin, target), { ...base, note: "900101-1234567" }));
    await assertFails(set(ref(admin, target), { ...base, emergencyContact: "9001011234567" }));
    // 전화번호는 통과한다. 너무 많이 잡으면 검사를 꺼 달라고 하게 된다.
    await assertSucceeds(set(ref(admin, target), { ...base, phone: "010-1234-5678" }));

    // 칸을 새로 지어내는 길도 막는다.
    await assertFails(set(ref(admin, target), { ...base, residentNumber: "900101-1234567" }));
    await assertFails(set(ref(admin, target), { ...base, salary: 3000000 }));

    // 근로계약서 보관 위치는 https 만 받는다.
    await assertFails(set(ref(admin, target), { ...base, contractFileUrl: "http://drive.google.com/x" }));
    await assertSucceeds(set(ref(admin, target), { ...base, contractFileUrl: "https://drive.google.com/x" }));

    // 지우는 길은 없다. 근로계약서는 3년 보관 의무가 있다.
    await assertFails(remove(ref(admin, target)));
  });

  it("keeps leave requests private to the person and their administrator", async () => {
    // 휴가 사유는 근태보다 사적이다. 같은 회사 사람이라고 서로 볼 수 있으면
    // 아무도 솔직한 사유를 적지 않는다.
    const admin = environment.authenticatedContext("crm-admin", crmClaims("admin@bring.test")).database();
    const member = environment.authenticatedContext("crm-member", crmClaims("member@bring.test")).database();
    const viewer = environment.authenticatedContext("crm-viewer", crmClaims("viewer@bring.test")).database();
    const anonymous = environment.unauthenticatedContext().database();

    const mine = "crmCompany/officeLeave/crm-viewer/req-1";
    const request = {
      userId: "crm-viewer",
      type: "annual",
      startDate: "2026-10-05",
      endDate: "2026-10-07",
      status: "requested",
      days: 3,
      reason: "가족 여행",
    };

    // 본인은 자기 칸에 신청한다.
    await assertSucceeds(set(ref(viewer, mine), request));
    await assertSucceeds(get(ref(viewer, mine)));

    // 남의 휴가는 못 본다. 같은 일반 구성원이어도 마찬가지다.
    await assertFails(get(ref(member, mine)));
    await assertFails(get(ref(member, "crmCompany/officeLeave/crm-viewer")));
    // 남의 칸에 대신 신청하지도 못한다.
    await assertFails(set(ref(member, "crmCompany/officeLeave/crm-viewer/req-2"), request));
    // userId 를 바꿔 자기 칸에 남의 것처럼 넣는 것도 막는다.
    await assertFails(set(ref(member, "crmCompany/officeLeave/crm-member/req-3"), {
      ...request, userId: "crm-viewer",
    }));

    // 관리자는 본다. 승인해야 하기 때문이다.
    await assertSucceeds(get(ref(admin, mine)));
    await assertSucceeds(get(ref(admin, "crmCompany/officeLeave")));
    await assertSucceeds(update(ref(admin, mine), { status: "approved", decidedBy: "김현진" }));

    // 전체 목록은 관리자만. 일반 구성원은 못 본다.
    await assertFails(get(ref(member, "crmCompany/officeLeave")));
    await assertFails(get(ref(viewer, "crmCompany/officeLeave")));
    await assertFails(get(ref(anonymous, mine)));

    // 필수 항목이 빠진 신청은 저장되지 않는다.
    await assertFails(set(ref(viewer, "crmCompany/officeLeave/crm-viewer/req-4"), { userId: "crm-viewer" }));
  });

  it("blocks a member from approving their own leave or editing an approved one", async () => {
    // 규칙이 권한의 경계다. 앱을 우회해 토큰으로 직접 써도 승인을 만들 수 없어야 한다.
    const admin = environment.authenticatedContext("crm-admin", crmClaims("admin@bring.test")).database();
    const viewer = environment.authenticatedContext("crm-viewer", crmClaims("viewer@bring.test")).database();

    const base = {
      userId: "crm-viewer", type: "annual",
      startDate: "2026-11-02", endDate: "2026-11-04", days: 3,
    };

    // 처음부터 승인 상태로 만들 수 없다.
    await assertFails(set(ref(viewer, "crmCompany/officeLeave/crm-viewer/self-1"), { ...base, status: "approved" }));
    // 결정 항목을 스스로 넣을 수 없다.
    await assertFails(set(ref(viewer, "crmCompany/officeLeave/crm-viewer/self-2"), {
      ...base, status: "requested", decidedBy: "김현진",
    }));

    const path = "crmCompany/officeLeave/crm-viewer/self-3";
    await assertSucceeds(set(ref(viewer, path), { ...base, status: "requested" }));
    // 신청을 스스로 승인할 수 없다.
    await assertFails(set(ref(viewer, path), { ...base, status: "approved", decidedBy: "본인" }));
    // 취소하면서 기간이나 일수를 바꿀 수 없다 — 승인 이력이 흐려진다.
    await assertFails(set(ref(viewer, path), { ...base, endDate: "2026-11-10", days: 9, status: "cancelled" }));
    // 취소 자체는 된다.
    await assertSucceeds(set(ref(viewer, path), { ...base, status: "cancelled" }));

    // 이미 처리된 신청은 관리자도 다시 처리하지 못한다. 두 관리자가 동시에
    // 눌러도 나중 것이 앞선 결정을 덮지 않는다.
    const decided = "crmCompany/officeLeave/crm-viewer/self-4";
    await assertSucceeds(set(ref(viewer, decided), { ...base, status: "requested" }));
    await assertSucceeds(set(ref(admin, decided), { ...base, status: "approved", decidedBy: "김현진" }));
    await assertFails(set(ref(admin, decided), { ...base, status: "rejected", decidedBy: "다른관리자" }));
    // 정한 사람 없이 승인할 수도 없다.
    const noDecider = "crmCompany/officeLeave/crm-viewer/self-5";
    await assertSucceeds(set(ref(viewer, noDecider), { ...base, status: "requested" }));
    await assertFails(set(ref(admin, noDecider), { ...base, status: "approved", decidedBy: "" }));
  });

  it("keeps each year's confirmed grant separate", async () => {
    // uid 하나에 두면 내년 확정이 올해 것을 지운다.
    const admin = environment.authenticatedContext("crm-admin", crmClaims("admin@bring.test")).database();
    const viewer = environment.authenticatedContext("crm-viewer", crmClaims("viewer@bring.test")).database();

    const grant = (year: string, days: number) => ({
      userId: "crm-viewer", year, days, confirmedBy: "김현진", confirmedAt: `${year}-01-02T00:00:00.000Z`,
    });
    await assertSucceeds(set(ref(admin, "crmCompany/officeLeaveGrants/crm-viewer/2026"), grant("2026", 15)));
    await assertSucceeds(set(ref(admin, "crmCompany/officeLeaveGrants/crm-viewer/2027"), grant("2027", 16)));
    // 2027 을 넣어도 2026 이 남아 있어야 한다.
    expect((await assertSucceeds(get(ref(viewer, "crmCompany/officeLeaveGrants/crm-viewer/2026")))).val()).toMatchObject({ days: 15 });

    // 칸 이름과 안의 연도가 어긋나면 저장되지 않는다.
    await assertFails(set(ref(admin, "crmCompany/officeLeaveGrants/crm-viewer/2028"), grant("2026", 15)));
    await assertFails(set(ref(admin, "crmCompany/officeLeaveGrants/crm-viewer/올해"), grant("올해", 15)));
    // 본인은 여전히 못 쓴다.
    await assertFails(set(ref(viewer, "crmCompany/officeLeaveGrants/crm-viewer/2026"), grant("2026", 30)));
  });

  it("lets only an administrator set the confirmed leave grant", async () => {
    // 발생일수는 관리자가 확정한 값이 진실이다. 본인이 고칠 수 있으면
    // 잔여가 스스로 늘어난다.
    const admin = environment.authenticatedContext("crm-admin", crmClaims("admin@bring.test")).database();
    const viewer = environment.authenticatedContext("crm-viewer", crmClaims("viewer@bring.test")).database();
    const member = environment.authenticatedContext("crm-member", crmClaims("member@bring.test")).database();

    // 확정은 uid 아래 연도별로 쌓인다.
    const grantPath = "crmCompany/officeLeaveGrants/crm-viewer/2026";
    const grant = { userId: "crm-viewer", year: "2026", days: 15, confirmedBy: "김현진", confirmedAt: "2026-01-02T00:00:00.000Z" };

    await assertSucceeds(set(ref(admin, grantPath), grant));
    // 본인은 자기 것을 볼 수만 있다.
    await assertSucceeds(get(ref(viewer, grantPath)));
    await assertFails(set(ref(viewer, grantPath), { ...grant, days: 30 }));
    // 남의 것은 보지도 못한다.
    await assertFails(get(ref(member, grantPath)));
    await assertFails(get(ref(viewer, "crmCompany/officeLeaveGrants")));
  });

  it("keeps BIRNG OFFICE attendance and messages private while granting only explicit office administrators team access", async () => {
    const admin = environment.authenticatedContext(
      "crm-admin",
      crmClaims("admin@bring.test"),
    ).database();
    const standardAdmin = environment.authenticatedContext(
      "crm-standard-admin",
      crmClaims("standard-admin@bring.test"),
    ).database();
    const viewer = environment.authenticatedContext(
      "crm-viewer",
      crmClaims("viewer@bring.test"),
    ).database();
    const unverifiedViewer = environment.authenticatedContext(
      "crm-viewer",
      crmPasswordClaims("viewer@bring.test", false),
    ).database();
    const passwordPending = environment.authenticatedContext(
      "crm-member",
      crmClaims("member@bring.test"),
    ).database();
    const disabled = environment.authenticatedContext(
      "crm-disabled",
      crmClaims("disabled@bring.test"),
    ).database();
    const wrongEmail = environment.authenticatedContext(
      "crm-viewer",
      crmClaims("wrong@bring.test"),
    ).database();
    const thirdParty = environment.authenticatedContext(
      "crm-legacy-member",
      crmClaims("legacy@bring.test"),
    ).database();
    const invalidRole = environment.authenticatedContext(
      "crm-invalid-role",
      crmClaims("invalid@bring.test"),
    ).database();
    const anonymous = environment.unauthenticatedContext().database();

    await assertSucceeds(get(ref(viewer, "crmCompany/access")));
    await assertSucceeds(get(ref(admin, "crmCompany/access")));
    await assertFails(get(ref(passwordPending, "crmCompany/access")));
    await assertFails(get(ref(disabled, "crmCompany/access")));
    await assertFails(get(ref(anonymous, "crmCompany/access")));

    const workDate = "2026-08-31";
    const attendancePath = `crmCompany/officeAttendance/crm-viewer/${workDate}`;
    const attendance = {
      id: `crm-viewer_${workDate}`,
      userId: "crm-viewer",
      workDate,
      checkInAt: "2026-08-31T00:03:00.000Z",
      checkOutAt: "",
      createdAt: "2026-08-31T00:03:00.000Z",
      updatedAt: "2026-08-31T00:03:00.000Z",
    };
    await assertSucceeds(set(ref(viewer, attendancePath), attendance));
    await assertFails(get(ref(unverifiedViewer, attendancePath)));
    await assertFails(set(
      ref(unverifiedViewer, "crmCompany/officeAttendance/crm-viewer/2026-09-01"),
      {
        ...attendance,
        id: "crm-viewer_2026-09-01",
        workDate: "2026-09-01",
        checkInAt: "2026-09-01T00:03:00.000Z",
        createdAt: "2026-09-01T00:03:00.000Z",
        updatedAt: "2026-09-01T00:03:00.000Z",
      },
    ));
    await assertFails(update(ref(unverifiedViewer, attendancePath), {
      checkOutAt: "2026-08-31T09:04:00.000Z",
      updatedAt: "2026-08-31T09:04:00.000Z",
    }));
    await assertSucceeds(get(ref(viewer, attendancePath)));
    await assertSucceeds(get(ref(admin, "crmCompany/officeAttendance")));
    await assertFails(get(ref(standardAdmin, "crmCompany/officeAttendance")));
    await assertFails(get(ref(viewer, "crmCompany/officeAttendance")));
    await assertFails(get(ref(viewer, `crmCompany/officeAttendance/crm-admin/${workDate}`)));
    await assertFails(set(
      ref(viewer, `crmCompany/officeAttendance/crm-admin/${workDate}`),
      { ...attendance, id: `crm-admin_${workDate}`, userId: "crm-admin" },
    ));
    await assertFails(set(ref(viewer, attendancePath), {
      ...attendance,
      checkInAt: "2026-08-31T00:04:00.000Z",
    }));
    await assertFails(update(ref(viewer, attendancePath), { extra: true }));
    await assertSucceeds(update(ref(viewer, attendancePath), {
      checkOutAt: "2026-08-31T09:05:00.000Z",
      updatedAt: "2026-08-31T09:05:00.000Z",
    }));
    await assertFails(update(ref(viewer, attendancePath), {
      checkOutAt: "2026-08-31T09:06:00.000Z",
      updatedAt: "2026-08-31T09:06:00.000Z",
    }));
    await assertFails(remove(ref(viewer, attendancePath)));

    const messageId = "msg_test0001";
    const message = {
      id: messageId,
      senderId: "crm-viewer",
      receiverId: "crm-admin",
      message: "근태 확인 부탁드립니다.",
      readAt: "",
      createdAt: "2026-08-31T09:10:00.000Z",
    };

    const invalidSenderId = "msg_invalidrole01";
    const invalidSenderMessage = {
      ...message,
      id: invalidSenderId,
      senderId: "crm-invalid-role",
      receiverId: "crm-admin",
    };
    await assertFails(update(ref(invalidRole, "crmCompany/officeMailbox"), {
      [`crm-invalid-role/crm-admin/${invalidSenderId}`]: invalidSenderMessage,
      [`crm-admin/crm-invalid-role/${invalidSenderId}`]: invalidSenderMessage,
    }));

    const invalidReceiverId = "msg_invalidrecv01";
    const invalidReceiverMessage = {
      ...message,
      id: invalidReceiverId,
      receiverId: "crm-invalid-role",
    };
    await assertFails(update(ref(viewer, "crmCompany/officeMailbox"), {
      [`crm-viewer/crm-invalid-role/${invalidReceiverId}`]: invalidReceiverMessage,
      [`crm-invalid-role/crm-viewer/${invalidReceiverId}`]: invalidReceiverMessage,
    }));

    const preReadId = "msg_preread0001";
    const preReadMessage = {
      ...message,
      id: preReadId,
      readAt: "2026-08-31T09:09:00.000Z",
    };
    await assertFails(update(ref(viewer, "crmCompany/officeMailbox"), {
      [`crm-viewer/crm-admin/${preReadId}`]: preReadMessage,
      [`crm-admin/crm-viewer/${preReadId}`]: preReadMessage,
    }));

    await assertSucceeds(update(ref(viewer, "crmCompany/officeMailbox"), {
      [`crm-viewer/crm-admin/${messageId}`]: message,
      [`crm-admin/crm-viewer/${messageId}`]: message,
    }));
    await assertSucceeds(get(ref(viewer, "crmCompany/officeMailbox/crm-viewer")));
    await assertSucceeds(get(ref(admin, "crmCompany/officeMailbox/crm-admin")));
    await assertFails(get(ref(viewer, "crmCompany/officeMailbox/crm-admin")));
    await assertFails(get(ref(standardAdmin, "crmCompany/officeMailbox/crm-viewer")));
    await assertFails(update(ref(viewer, "crmCompany/officeMailbox"), {
      [`crm-viewer/crm-admin/${messageId}/readAt`]: "2026-08-31T09:11:00.000Z",
      [`crm-admin/crm-viewer/${messageId}/readAt`]: "2026-08-31T09:11:00.000Z",
    }));
    await assertSucceeds(update(ref(admin, "crmCompany/officeMailbox"), {
      [`crm-viewer/crm-admin/${messageId}/readAt`]: "2026-08-31T09:12:00.000Z",
      [`crm-admin/crm-viewer/${messageId}/readAt`]: "2026-08-31T09:12:00.000Z",
    }));
    expect((await get(ref(admin, `crmCompany/officeMailbox/crm-admin/crm-viewer/${messageId}/readAt`))).val())
      .toBe("2026-08-31T09:12:00.000Z");

    type OfficeFileOverrides = {
      attachment?: Record<string, unknown>;
      file?: Record<string, unknown>;
      mailbox?: Record<string, unknown>;
      senderMirror?: Record<string, unknown>;
      receiverMirror?: Record<string, unknown>;
      senderId?: string;
      receiverId?: string;
      omitReceiverMirror?: boolean;
      omitSenderMirror?: boolean;
    };
    const attachmentBytes = Buffer.from("hello", "utf8");
    const attachmentHash = "a".repeat(64);
    const buildOfficeFileCreate = (id: string, overrides: OfficeFileOverrides = {}) => {
      const senderId = overrides.senderId || "crm-viewer";
      const receiverId = overrides.receiverId || "crm-admin";
      const attachment = {
        fileId: id,
        fileName: "업무자료.txt",
        extension: "txt",
        mimeType: "text/plain",
        size: attachmentBytes.length,
        sha256: attachmentHash,
        ...overrides.attachment,
      };
      const file = {
        id,
        senderId,
        receiverId,
        fileName: "업무자료.txt",
        extension: "txt",
        mimeType: "text/plain",
        size: attachmentBytes.length,
        sha256: attachmentHash,
        bodyBase64: attachmentBytes.toString("base64"),
        createdAt: "2026-08-31T09:20:00.000Z",
        ...overrides.file,
      };
      const mailboxMessage = {
        id,
        senderId,
        receiverId,
        message: "[파일] 업무자료.txt",
        attachment,
        readAt: "",
        createdAt: "2026-08-31T09:20:00.000Z",
        ...overrides.mailbox,
      };
      const senderMirror = { ...mailboxMessage, ...overrides.senderMirror };
      const receiverMirror = { ...mailboxMessage, ...overrides.receiverMirror };
      const patch: Record<string, unknown> = {
        [`officeMessageFiles/${id}`]: file,
      };
      if (!overrides.omitSenderMirror) {
        patch[`officeMailbox/${senderId}/${receiverId}/${id}`] = senderMirror;
      }
      if (!overrides.omitReceiverMirror) {
        patch[`officeMailbox/${receiverId}/${senderId}/${id}`] = receiverMirror;
      }
      return { attachment, file, mailboxMessage, senderMirror, receiverMirror, patch };
    };

    const fileId = "msg_file0001";
    const validFileCreate = buildOfficeFileCreate(fileId);
    await assertSucceeds(update(ref(viewer, "crmCompany"), validFileCreate.patch));

    const filePath = `crmCompany/officeMessageFiles/${fileId}`;
    await assertSucceeds(get(ref(viewer, filePath)));
    await assertSucceeds(get(ref(admin, filePath)));
    await assertFails(get(ref(viewer, "crmCompany/officeMessageFiles")));
    await assertFails(get(ref(admin, "crmCompany/officeMessageFiles")));
    await assertFails(get(ref(anonymous, filePath)));
    await assertFails(get(ref(wrongEmail, filePath)));
    await assertFails(get(ref(disabled, filePath)));
    await assertFails(get(ref(passwordPending, filePath)));
    await assertFails(get(ref(thirdParty, filePath)));

    const fileOnly = buildOfficeFileCreate("msg_fileonly01");
    await assertFails(
      set(ref(viewer, "crmCompany/officeMessageFiles/msg_fileonly01"), fileOnly.file),
    );

    const oneMirror = buildOfficeFileCreate("msg_onemirror01", {
      omitReceiverMirror: true,
    });
    await assertFails(update(ref(viewer, "crmCompany"), oneMirror.patch));

    const invalidRoleReceiver = buildOfficeFileCreate("msg_invalidfile01", {
      receiverId: "crm-invalid-role",
    });
    await assertFails(update(ref(viewer, "crmCompany"), invalidRoleReceiver.patch));

    const invalidRoleSender = buildOfficeFileCreate("msg_invalidsend01", {
      senderId: "crm-invalid-role",
    });
    await assertFails(update(ref(invalidRole, "crmCompany"), invalidRoleSender.patch));

    const divergentMessage = buildOfficeFileCreate("msg_diffmessage01", {
      receiverMirror: { message: "수신자에게만 다른 내용" },
    });
    await assertFails(update(ref(viewer, "crmCompany"), divergentMessage.patch));

    const divergentMirrorCreatedAt = buildOfficeFileCreate("msg_difftime0001", {
      receiverMirror: { createdAt: "2026-08-31T09:20:01.000Z" },
    });
    await assertFails(update(ref(viewer, "crmCompany"), divergentMirrorCreatedAt.patch));

    const divergentFileCreatedAt = buildOfficeFileCreate("msg_filetime0001", {
      file: { createdAt: "2026-08-31T09:20:01.000Z" },
    });
    await assertFails(update(ref(viewer, "crmCompany"), divergentFileCreatedAt.patch));

    const attachmentPreRead = buildOfficeFileCreate("msg_filepreread1", {
      mailbox: { readAt: "2026-08-31T09:20:01.000Z" },
    });
    await assertFails(update(ref(viewer, "crmCompany"), attachmentPreRead.patch));

    const metadataMismatch = buildOfficeFileCreate("msg_mismatch01", {
      file: { sha256: "b".repeat(64) },
    });
    await assertFails(update(ref(viewer, "crmCompany"), metadataMismatch.patch));

    const receiverCreate = buildOfficeFileCreate("msg_receiver01");
    await assertFails(update(ref(admin, "crmCompany"), receiverCreate.patch));

    const oversizedBytes = Buffer.alloc(5 * 1024 * 1024 + 1, 0x61);
    const oversized = buildOfficeFileCreate("msg_oversized01", {
      attachment: { size: oversizedBytes.length },
      file: {
        size: oversizedBytes.length,
        bodyBase64: oversizedBytes.toString("base64"),
      },
    });
    await assertFails(update(ref(viewer, "crmCompany"), oversized.patch));

    const invalidBase64 = buildOfficeFileCreate("msg_base64bad01", {
      attachment: { size: 3 },
      file: { size: 3, bodyBase64: "%%%%" },
    });
    await assertFails(update(ref(viewer, "crmCompany"), invalidBase64.patch));

    const invalidName = buildOfficeFileCreate("msg_namebad01", {
      attachment: { fileName: "../업무자료.txt" },
      file: { fileName: "../업무자료.txt" },
    });
    await assertFails(update(ref(viewer, "crmCompany"), invalidName.patch));

    const backslashName = buildOfficeFileCreate("msg_backslash01", {
      attachment: { fileName: "업무\\자료.txt" },
      file: { fileName: "업무\\자료.txt" },
    });
    await assertFails(update(ref(viewer, "crmCompany"), backslashName.patch));

    const controlCharacterName = buildOfficeFileCreate("msg_control01", {
      attachment: { fileName: "업무\u0001자료.txt" },
      file: { fileName: "업무\u0001자료.txt" },
    });
    await assertFails(update(ref(viewer, "crmCompany"), controlCharacterName.patch));

    const unsafeNames = [
      ["msg_reservedcon1", "CON.txt"],
      ["msg_reservedprn1", "prn.TXT"],
      ["msg_reservedaux1", "AUX.txt"],
      ["msg_reservednul1", "nul.txt"],
      ["msg_reservedcom1", "COM1.txt"],
      ["msg_reservedlpt1", "lPt9.TxT"],
      ["msg_leadspace01", " 업무자료.txt"],
      ["msg_tailspace01", "업무자료.txt "],
      ["msg_taildot0001", "업무자료.txt."],
      ["msg_bidiname001", "업무\u202E자료.txt"],
      ["msg_formatname1", "업무\u200D자료.txt"],
      ["msg_lineformat1", "업무\u2028자료.txt"],
      ["msg_paraformat1", "업무\u2029자료.txt"],
      ["msg_extmismatch", "업무자료.pdf"],
    ] as const;
    for (const [id, fileName] of unsafeNames) {
      const unsafeName = buildOfficeFileCreate(id, {
        attachment: { fileName },
        file: { fileName },
      });
      await assertFails(update(ref(viewer, "crmCompany"), unsafeName.patch));
    }

    const uppercaseExtension = buildOfficeFileCreate("msg_uppercase01", {
      attachment: { fileName: "업무자료.TXT" },
      file: { fileName: "업무자료.TXT" },
    });
    await assertSucceeds(update(ref(viewer, "crmCompany"), uppercaseExtension.patch));

    const invalidMime = buildOfficeFileCreate("msg_mimebad01", {
      attachment: { mimeType: "application/octet-stream" },
      file: { mimeType: "application/octet-stream" },
    });
    await assertFails(update(ref(viewer, "crmCompany"), invalidMime.patch));

    await assertFails(update(ref(viewer, filePath), { fileName: "변경.txt" }));
    await assertFails(remove(ref(viewer, filePath)));

    await assertFails(
      update(ref(viewer, "crmCompany/officeMailbox"), {
        [`crm-viewer/crm-admin/${fileId}/readAt`]: "2026-08-31T09:25:00.000Z",
        [`crm-admin/crm-viewer/${fileId}/readAt`]: "2026-08-31T09:25:00.000Z",
      }),
    );
    await assertFails(
      update(ref(admin, "crmCompany/officeMailbox"), {
        [`crm-viewer/crm-admin/${fileId}/attachment/fileName`]: "변조.txt",
        [`crm-viewer/crm-admin/${fileId}/readAt`]: "2026-08-31T09:25:00.000Z",
        [`crm-admin/crm-viewer/${fileId}/attachment/fileName`]: "변조.txt",
        [`crm-admin/crm-viewer/${fileId}/readAt`]: "2026-08-31T09:25:00.000Z",
      }),
    );
    await assertFails(
      update(ref(admin, "crmCompany/officeMailbox"), {
        [`crm-admin/crm-viewer/${fileId}/readAt`]: "2026-08-31T09:24:00.000Z",
      }),
    );
    await assertFails(
      update(ref(admin, "crmCompany/officeMailbox"), {
        [`crm-viewer/crm-admin/${fileId}/readAt`]: "2026-08-31T09:24:00.000Z",
        [`crm-admin/crm-viewer/${fileId}/readAt`]: "2026-08-31T09:24:01.000Z",
      }),
    );
    await assertSucceeds(
      update(ref(admin, "crmCompany/officeMailbox"), {
        [`crm-viewer/crm-admin/${fileId}/readAt`]: "2026-08-31T09:25:00.000Z",
        [`crm-admin/crm-viewer/${fileId}/readAt`]: "2026-08-31T09:25:00.000Z",
      }),
    );
    const storedAttachment = await get(
      ref(admin, `crmCompany/officeMailbox/crm-admin/crm-viewer/${fileId}/attachment`),
    );
    expect(storedAttachment.val()).toEqual(validFileCreate.attachment);

    await assertFails(set(
      ref(passwordPending, "crmCompany/officeAttendance/crm-member/2026-08-31"),
      { ...attendance, id: "crm-member_2026-08-31", userId: "crm-member" },
    ));
    await assertFails(get(ref(anonymous, attendancePath)));
  }, 60_000);

  it("allows only atomic, audited office-admin attendance corrections", async () => {
    const officeAdmin = environment.authenticatedContext(
      "crm-admin",
      crmClaims("admin@bring.test"),
    ).database();
    const standardAdmin = environment.authenticatedContext(
      "crm-standard-admin",
      crmClaims("standard-admin@bring.test"),
    ).database();
    const member = environment.authenticatedContext(
      "crm-legacy-member",
      crmClaims("legacy@bring.test"),
    ).database();
    const viewer = environment.authenticatedContext(
      "crm-viewer",
      crmClaims("viewer@bring.test"),
    ).database();
    const unverifiedOfficeAdmin = environment.authenticatedContext(
      "crm-admin",
      crmPasswordClaims("admin@bring.test", false),
    ).database();
    const wrongEmailOfficeAdmin = environment.authenticatedContext(
      "crm-admin",
      crmClaims("wrong@bring.test"),
    ).database();
    const disabledOfficeAdmin = environment.authenticatedContext(
      "crm-office-disabled",
      crmClaims("office-disabled@bring.test"),
    ).database();
    const pendingOfficeAdmin = environment.authenticatedContext(
      "crm-office-pending",
      crmClaims("office-pending@bring.test"),
    ).database();
    const anonymous = environment.unauthenticatedContext().database();

    const workDate = "2026-09-01";
    const attendancePath = `crmCompany/officeAttendance/crm-viewer/${workDate}`;
    const initialAttendance = {
      id: `crm-viewer_${workDate}`,
      userId: "crm-viewer",
      workDate,
      checkInAt: "2026-09-01T00:10:00.000Z",
      checkOutAt: "",
      createdAt: "2026-09-01T00:10:00.000Z",
      updatedAt: "2026-09-01T00:10:00.000Z",
    };
    await assertSucceeds(set(ref(viewer, attendancePath), initialAttendance));

    type AttendanceRecord = typeof initialAttendance & {
      correctionVersion?: number;
      lastCorrectionId?: string;
      lastCorrectionRequestId?: string;
      lastCorrectionHash?: string;
      correctedAtMs?: number | ReturnType<typeof serverTimestamp>;
      correctedBy?: string;
    };
    type CorrectionInput = {
      actorUid: string;
      requestId: string;
      hashChar: string;
      before: AttendanceRecord;
      afterCheckInAt: string;
      afterCheckOutAt: string;
      afterUpdatedAt: string;
      reason?: string;
    };
    const buildCorrection = ({
      actorUid,
      requestId,
      hashChar,
      before,
      afterCheckInAt,
      afterCheckOutAt,
      afterUpdatedAt,
      reason = "관리자 요청에 따른 출퇴근 시간 정정",
    }: CorrectionInput) => {
      const auditId = `attcorr_${requestId}`;
      const requestHash = hashChar.repeat(64);
      const beforeVersion = before.correctionVersion || 0;
      const occurredAtMs = serverTimestamp();
      const record: AttendanceRecord = {
        ...before,
        checkInAt: afterCheckInAt,
        checkOutAt: afterCheckOutAt,
        updatedAt: afterUpdatedAt,
        correctionVersion: beforeVersion + 1,
        lastCorrectionId: auditId,
        lastCorrectionRequestId: requestId,
        lastCorrectionHash: requestHash,
        correctedAtMs: occurredAtMs,
        correctedBy: actorUid,
      };
      const audit = {
        id: auditId,
        requestId,
        requestHash,
        actorAuthUid: actorUid,
        targetUserId: before.userId,
        workDate: before.workDate,
        reason,
        beforeCheckInAt: before.checkInAt,
        beforeCheckOutAt: before.checkOutAt,
        afterCheckInAt,
        afterCheckOutAt,
        expectedUpdatedAt: before.updatedAt,
        beforeUpdatedAt: before.updatedAt,
        afterUpdatedAt,
        beforeVersion,
        afterVersion: beforeVersion + 1,
        occurredAtMs,
      };
      return {
        audit,
        auditId,
        patch: {
          [`officeAttendance/${before.userId}/${before.workDate}`]: record,
          [`officeAttendanceAudits/${auditId}`]: audit,
        },
        record,
      };
    };

    const deniedActors = [
      { database: anonymous, actorUid: "crm-admin" },
      { database: standardAdmin, actorUid: "crm-standard-admin" },
      { database: member, actorUid: "crm-legacy-member" },
      { database: viewer, actorUid: "crm-viewer" },
      { database: unverifiedOfficeAdmin, actorUid: "crm-admin" },
      { database: wrongEmailOfficeAdmin, actorUid: "crm-admin" },
      { database: disabledOfficeAdmin, actorUid: "crm-office-disabled" },
      { database: pendingOfficeAdmin, actorUid: "crm-office-pending" },
    ];
    for (const { database, actorUid } of deniedActors) {
      const denied = buildCorrection({
        actorUid,
        requestId: "11111111-1111-4111-8111-111111111111",
        hashChar: "1",
        before: initialAttendance,
        afterCheckInAt: "2026-09-01T00:15:00.000Z",
        afterCheckOutAt: "",
        afterUpdatedAt: "2026-09-01T00:15:00.000Z",
      });
      await assertFails(update(ref(database, "crmCompany"), denied.patch));
    }

    const first = buildCorrection({
      actorUid: "crm-admin",
      requestId: "22222222-2222-4222-8222-222222222222",
      hashChar: "2",
      before: initialAttendance,
      afterCheckInAt: "2026-09-01T00:15:00.000Z",
      afterCheckOutAt: "",
      afterUpdatedAt: "2026-09-01T00:15:00.000Z",
    });

    await assertFails(set(
      ref(officeAdmin, `crmCompany/officeAttendance/crm-viewer/${workDate}`),
      first.record,
    ));
    await assertFails(set(
      ref(officeAdmin, `crmCompany/officeAttendanceAudits/${first.auditId}`),
      first.audit,
    ));

    const tamperedHash = {
      ...first.patch,
      [`officeAttendanceAudits/${first.auditId}`]: {
        ...first.audit,
        requestHash: "f".repeat(64),
      },
    };
    await assertFails(update(ref(officeAdmin, "crmCompany"), tamperedHash));

    const tamperedImmutableRecord = {
      ...first.patch,
      [`officeAttendance/crm-viewer/${workDate}`]: {
        ...first.record,
        createdAt: "2026-09-01T00:11:00.000Z",
      },
    };
    await assertFails(update(ref(officeAdmin, "crmCompany"), tamperedImmutableRecord));

    const missingRecord = buildCorrection({
      actorUid: "crm-admin",
      requestId: "33333333-3333-4333-8333-333333333333",
      hashChar: "3",
      before: {
        ...initialAttendance,
        id: "crm-viewer_2026-09-02",
        workDate: "2026-09-02",
      },
      afterCheckInAt: "2026-09-02T00:15:00.000Z",
      afterCheckOutAt: "",
      afterUpdatedAt: "2026-09-02T00:15:00.000Z",
    });
    await assertFails(update(ref(officeAdmin, "crmCompany"), missingRecord.patch));

    await assertSucceeds(update(ref(officeAdmin, "crmCompany"), first.patch));
    await assertSucceeds(get(ref(officeAdmin, "crmCompany/officeAttendanceAudits")));
    await assertFails(get(ref(standardAdmin, "crmCompany/officeAttendanceAudits")));
    await assertFails(get(ref(viewer, `crmCompany/officeAttendanceAudits/${first.auditId}`)));

    const afterFirst = (await get(ref(officeAdmin, attendancePath))).val() as AttendanceRecord;
    expect(afterFirst.correctionVersion).toBe(1);
    expect(afterFirst.lastCorrectionId).toBe(first.auditId);
    expect(afterFirst.correctedBy).toBe("crm-admin");
    expect(typeof afterFirst.correctedAtMs).toBe("number");

    await assertSucceeds(update(ref(viewer, attendancePath), {
      checkOutAt: "2026-09-01T09:00:00.000Z",
      updatedAt: "2026-09-01T09:00:00.000Z",
    }));
    const checkedOut = (await get(ref(officeAdmin, attendancePath))).val() as AttendanceRecord;
    expect(checkedOut.correctionVersion).toBe(1);
    expect(checkedOut.lastCorrectionId).toBe(first.auditId);

    const concurrentBefore = checkedOut;
    const second = buildCorrection({
      actorUid: "crm-admin",
      requestId: "44444444-4444-4444-8444-444444444444",
      hashChar: "4",
      before: concurrentBefore,
      afterCheckInAt: concurrentBefore.checkInAt,
      afterCheckOutAt: "2026-09-01T09:05:00.000Z",
      afterUpdatedAt: "2026-09-01T09:05:00.000Z",
      reason: "퇴근 기록 오분 정정",
    });
    const staleConcurrent = buildCorrection({
      actorUid: "crm-admin",
      requestId: "55555555-5555-4555-8555-555555555555",
      hashChar: "5",
      before: concurrentBefore,
      afterCheckInAt: concurrentBefore.checkInAt,
      afterCheckOutAt: "2026-09-01T09:06:00.000Z",
      afterUpdatedAt: "2026-09-01T09:06:00.000Z",
      reason: "동시 수정 충돌 확인",
    });
    await assertSucceeds(update(ref(officeAdmin, "crmCompany"), second.patch));
    await assertFails(update(ref(officeAdmin, "crmCompany"), staleConcurrent.patch));
    await assertFails(update(ref(officeAdmin, "crmCompany"), second.patch));

    const afterSecond = (await get(ref(officeAdmin, attendancePath))).val() as AttendanceRecord;
    const clearCompletedCheckout = buildCorrection({
      actorUid: "crm-admin",
      requestId: "66666666-6666-4666-8666-666666666666",
      hashChar: "6",
      before: afterSecond,
      afterCheckInAt: afterSecond.checkInAt,
      afterCheckOutAt: "",
      afterUpdatedAt: "2026-09-01T09:07:00.000Z",
    });
    await assertFails(update(ref(officeAdmin, "crmCompany"), clearCompletedCheckout.patch));

    const reversedTime = buildCorrection({
      actorUid: "crm-admin",
      requestId: "77777777-7777-4777-8777-777777777777",
      hashChar: "7",
      before: afterSecond,
      afterCheckInAt: "2026-09-01T10:00:00.000Z",
      afterCheckOutAt: "2026-09-01T09:05:00.000Z",
      afterUpdatedAt: "2026-09-01T10:00:00.000Z",
    });
    await assertFails(update(ref(officeAdmin, "crmCompany"), reversedTime.patch));

    const unsafeReason = buildCorrection({
      actorUid: "crm-admin",
      requestId: "88888888-8888-4888-8888-888888888888",
      hashChar: "8",
      before: afterSecond,
      afterCheckInAt: afterSecond.checkInAt,
      afterCheckOutAt: "2026-09-01T09:08:00.000Z",
      afterUpdatedAt: "2026-09-01T09:08:00.000Z",
      reason: "숨김\u202E문자",
    });
    await assertFails(update(ref(officeAdmin, "crmCompany"), unsafeReason.patch));

    await assertFails(remove(ref(officeAdmin, attendancePath)));
    await assertFails(remove(ref(officeAdmin, `crmCompany/officeAttendanceAudits/${first.auditId}`)));
    await assertFails(update(ref(officeAdmin, `crmCompany/officeAttendanceAudits/${first.auditId}`), {
      reason: "기존 감사 기록 변조",
    }));
  }, 60_000);

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
      "serviceRecords/service_record_cutover": {
        id: "service_record_cutover",
        buildingId: "building_1",
        title: "Cutover service record",
        status: "planned",
        scheduledDate: "2026-08-21",
        createdAt: NOW,
        updatedAt: NOW,
        updatedByAuthUid: "crm-member",
        calendarCommitRequestId: "00000000-0000-4000-8000-000000000100",
        calendarCommitHash: "1".padStart(64, "0"),
        calendarAuditId: "audit_schedule_00000000000040008000000000000100",
        calendarCommitVersion: 1,
      },
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

  it("stores only bounded thumbnails for existing active customers and prevents photo orphans", async () => {
    await exerciseCustomerPhotoRules(environment);
  });

  it("allows exact CRM roles to read Drive import candidates and denies every client write", async () => {
    await exerciseDriveImportCandidateRules(environment);
  });

  it("allows building-bound service records without deleting history or targeting archived buildings", async () => {
    await exerciseServiceRecordRules(environment);
  });

  it("accepts an atomic canonical building create with its narrow customer backlink", async () => {
    await exerciseAtomicBuildingCreateWithCustomerLink(environment);
  });

  it("allows only an atomic first owner link and keeps an assigned owner immutable", async () => {
    await exerciseExistingBuildingOwnerLinkRules(environment);
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
    await assertFails(set(ref(member, "cases/case_2"), { id: "case_2" }));
    await assertFails(set(ref(member, "cases/case_2"), { id: "case_2", caseParty: "외부" }));
    await assertSucceeds(set(ref(member, "cases/case_2"), { id: "case_2", caseParty: "건물주" }));
    await assertFails(update(ref(member, "cases/case_2"), { caseParty: "" }));
    await assertSucceeds(update(ref(member, "cases/case_1"), { summary: "legacy unclassified edit" }));
    await assertFails(set(ref(member, "crmCompany/cases/company_case_1"), { id: "company_case_1" }));
    await assertSucceeds(set(ref(member, "crmCompany/cases/company_case_1"), { id: "company_case_1", caseParty: "브링" }));

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

const MARKETING_REQUEST = "123e4567-e89b-42d3-a456-426614174000";
const MARKETING_AUDIT = "audit_123e4567_e89b_42d3_a456_426614174000";
const MARKETING_RECEIPT = "request_123e4567_e89b_42d3_a456_426614174000";
const MARKETING_HASH = "a".repeat(64);
const SERVER_TIME = { ".sv": "timestamp" } as const;

function marketingRecord(id: string, actorUid: string, version = 1) {
  return {
    id, date: "2026-08-31", channel: "naver_blog", accountName: "bring", campaignId: "campaign_1", campaignName: "검색", adGroup: "group", keyword: "청소", contentId: "content_1", contentTitle: "글", service: "consulting", region: "원주",
    spend: 1000, impressions: 20, clicks: 3, phoneClicks: 1, chatClicks: 0, directionsClicks: 0, saves: 0, platformLeads: 1, note: "정상", sourceType: "manual",
    version, createdAtMs: SERVER_TIME, createdByAuthUid: actorUid, createdByOperatorId: "operator_kim", updatedAtMs: SERVER_TIME, updatedByAuthUid: actorUid, updatedByOperatorId: "operator_kim",
    lastAction: "create", lastAuditId: MARKETING_AUDIT, lastReceiptId: MARKETING_RECEIPT, lastRequestId: MARKETING_REQUEST, lastRequestHash: MARKETING_HASH,
  };
}

function marketingAudit(id: string, actorUid: string, action = "create") {
  return { id: MARKETING_AUDIT, actorAuthUid: actorUid, operatorId: "operator_kim", actorIdentifier: `${actorUid}@bring.test`, action, recordId: id, occurredAtMs: SERVER_TIME, beforeVersion: action === "create" ? 0 : 1, afterVersion: action === "create" ? 1 : 2, requestId: MARKETING_REQUEST, requestHash: MARKETING_HASH, beforeSpend: action === "create" ? 0 : 1000, afterSpend: 1000 };
}

function marketingReceipt(id: string, actorUid: string, action = "create", resultRecord: Record<string, unknown> = marketingRecord(id, actorUid)) {
  return { id: MARKETING_RECEIPT, actorAuthUid: actorUid, operatorId: "operator_kim", action, recordId: id, occurredAtMs: SERVER_TIME, beforeVersion: action === "create" ? 0 : 1, afterVersion: action === "create" ? 1 : 2, requestId: MARKETING_REQUEST, requestHash: MARKETING_HASH, resultRecord };
}

function marketingAtomic(id: string, actorUid: string, record: Record<string, unknown> = marketingRecord(id, actorUid), action = "create") {
  return { [`daily/${id}`]: record, [`audits/${MARKETING_AUDIT}`]: marketingAudit(id, actorUid, action), [`receipts/${MARKETING_RECEIPT}`]: marketingReceipt(id, actorUid, action) };
}

function attributionRecord(actorUid: string, version = 1, keyword = "draft") {
  return { keyword, _version: version, _updatedAtMs: { ".sv": "timestamp" }, _updatedByAuthUid: actorUid, _updatedByOperatorId: "operator_kim" };
}

async function attributionRest(database: any, path: string, options: { method?: string; etag?: string; body?: unknown } = {}) {
  const repo = database._repo || database._repoInternal || database._delegate?._repoInternal;
  const token = await (repo.authTokenProvider_ || repo.authTokenProvider).getToken(false);
  const url = `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}/${path}.json?ns=${PROJECT_ID}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${token.accessToken}` };
  if (!options.method) headers["X-Firebase-ETag"] = "true";
  if (options.etag) headers["If-Match"] = options.etag;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(url, { method: options.method || "GET", headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const text = await response.text();
  return { status: response.status, etag: response.headers.get("etag") || "", value: text ? JSON.parse(text) : null };
}

describe.runIf(databaseEmulatorAvailable)("marketing database rules", () => {
  it("accepts only paired, validated budget evidence and mirrors it in the immutable receipt", async () => {
    const marketing = environment.authenticatedContext("crm-marketing", crmClaims("marketing@bring.test")).database();
    const viewer = environment.authenticatedContext("crm-viewer", crmClaims("viewer@bring.test")).database();
    const atomicBudget = (id: string, actorUid: string, budget: number, validatedAtMs: number) => {
      const record = { ...marketingRecord(id, actorUid), dailyBudget: budget, budgetValidatedAtMs: validatedAtMs };
      return {
        ...marketingAtomic(id, actorUid, record),
        [`receipts/${MARKETING_RECEIPT}`]: marketingReceipt(id, actorUid, "create", record),
      };
    };

    const missingPair = marketingRecord("budget_missing_pair", "crm-marketing") as ReturnType<typeof marketingRecord> & { dailyBudget?: number };
    missingPair.dailyBudget = 1250;
    await assertFails(update(ref(marketing, "crmCompany/marketing"), {
      ...marketingAtomic("budget_missing_pair", "crm-marketing", missingPair),
      [`receipts/${MARKETING_RECEIPT}`]: marketingReceipt("budget_missing_pair", "crm-marketing", "create", missingPair),
    }));
    await assertFails(update(ref(marketing, "crmCompany/marketing"), atomicBudget("budget_zero", "crm-marketing", 0, Date.now() - 1000)));
    await assertFails(update(ref(marketing, "crmCompany/marketing"), atomicBudget("budget_future", "crm-marketing", 1250, Date.now() + 86_400_000)));
    await assertFails(update(ref(viewer, "crmCompany/marketing"), atomicBudget("budget_viewer", "crm-viewer", 1250, Date.now() - 1000)));

    const tampered = atomicBudget("budget_tampered", "crm-marketing", 1250, Date.now() - 1000);
    const receiptKey = `receipts/${MARKETING_RECEIPT}`;
    tampered[receiptKey] = { ...tampered[receiptKey], resultRecord: { ...tampered[receiptKey].resultRecord, dailyBudget: 1251 } };
    await assertFails(update(ref(marketing, "crmCompany/marketing"), tampered));

    await assertSucceeds(update(ref(marketing, "crmCompany/marketing"), atomicBudget("budget_valid", "crm-marketing", 1250, Date.now() - 1000)));
    const daily = (await get(ref(marketing, "crmCompany/marketing/daily/budget_valid"))).val();
    const receipt = (await get(ref(marketing, `crmCompany/marketing/receipts/${MARKETING_RECEIPT}`))).val();
    expect(receipt.resultRecord.dailyBudget).toBe(daily.dailyBudget);
    expect(receipt.resultRecord.budgetValidatedAtMs).toBe(daily.budgetValidatedAtMs);
  });

  it("performs exact child stale-ETag CAS with review before retry", async () => {
    await environment.withSecurityRulesDisabled(async context => set(ref(context.database(), "cases/case_cas"), { id: "case_cas", caseParty: "브링", title: "keep" }));
    const firstClient = environment.authenticatedContext("crm-marketing", crmClaims("marketing@bring.test")).database();
    const secondClient = environment.authenticatedContext("crm-marketing-two", crmClaims("marketing-two@bring.test")).database();
    const firstRead = await attributionRest(firstClient, "cases/case_cas/marketing");
    const secondRead = await attributionRest(secondClient, "cases/case_cas/marketing");
    expect(firstRead.status).toBe(200); expect(secondRead.etag).toBe(firstRead.etag);
    const firstWrite = await attributionRest(firstClient, "cases/case_cas/marketing", { method: "PUT", etag: firstRead.etag, body: attributionRecord("crm-marketing", 1, "first") });
    expect(firstWrite.status).toBe(200);
    const staleWrite = await attributionRest(secondClient, "cases/case_cas/marketing", { method: "PUT", etag: secondRead.etag, body: attributionRecord("crm-marketing-two", 1, "stale") });
    expect(staleWrite.status).toBe(412);
    const reviewed = await attributionRest(secondClient, "cases/case_cas/marketing");
    expect(reviewed.value.keyword).toBe("first"); expect(reviewed.value._version).toBe(1);
    const retry = await attributionRest(secondClient, "cases/case_cas/marketing", { method: "PUT", etag: reviewed.etag, body: attributionRecord("crm-marketing-two", 2, "reviewed") });
    expect(retry.status).toBe(200);
    const current = await attributionRest(firstClient, "cases/case_cas/marketing");
    expect(current.value.keyword).toBe("reviewed"); expect(current.value._version).toBe(2);
  });

  it("limits marketing-only CRM writes to exact attribution children and marketing daily", async () => {
    await environment.withSecurityRulesDisabled(async context => {
      await set(ref(context.database(), "cases/case_marketing"), { id: "case_marketing", caseParty: "브링", title: "keep" });
      await set(ref(context.database(), "crmCompany/data/customers/customer_sales"), { id: "customer_sales", name: "keep" });
    });
    const database = environment.authenticatedContext("crm-marketing", crmClaims("marketing@bring.test")).database();
    await assertFails(update(ref(database, "crmCompany/data"), { updatedAt: NOW, "tasks/forged": { id: "forged" } }));
    await assertFails(update(ref(database, "crmCompany/data/buildings/building_1"), { memo: "forged" }));
    await assertFails(set(ref(database, "paymentCalendars/crm-marketing/forged"), { amount: 1 }));
    await assertFails(update(ref(database, "cases/case_marketing"), { title: "forged" }));
    await assertSucceeds(set(ref(database, "crmCompany/data/customers/customer_1/marketing"), { ...attributionRecord("crm-marketing"), firstSource: "naver_blog", validLead: true }));
    await assertFails(update(ref(database, "crmCompany/data/customers/customer_1"), { name: "forged", marketingUpdatedAt: NOW }));
    await assertSucceeds(set(ref(database, "cases/case_marketing/marketing"), { ...attributionRecord("crm-marketing"), firstSource: "referral", validLead: false, invalidReason: "spam" }));
    await assertFails(update(ref(database, "cases/case_marketing"), { title: "forged", marketingUpdatedBy: "crm-marketing" }));
    const admin = environment.authenticatedContext("crm-admin", crmClaims("admin@bring.test")).database();
    await assertSucceeds(set(ref(admin, "cases/case_marketing/marketing"), { ...attributionRecord("crm-admin", 2), keyword: "admin" }));
    const sales = environment.authenticatedContext("crm-sales", crmClaims("sales@bring.test")).database();
    await assertSucceeds(set(ref(sales, "crmCompany/data/customers/customer_sales/marketing"), attributionRecord("crm-sales")));
    for (const [uid, email] of [["crm-marketing-disabled", "marketing-disabled@bring.test"], ["crm-marketing-password-change", "marketing-password@bring.test"], ["crm-viewer", "viewer@bring.test"]] as const) {
      await assertFails(set(ref(environment.authenticatedContext(uid, crmClaims(email)).database(), "crmCompany/data/customers/customer_1/marketing"), attributionRecord(uid)));
    }
    await assertFails(set(ref(environment.authenticatedContext("crm-marketing", crmClaims("wrong@bring.test")).database(), "crmCompany/data/customers/customer_1/marketing"), attributionRecord("crm-marketing")));
  });

  it("allows active admin and marketing atomic writes and viewer reads while denying other writers and identities", async () => {
    const admin = environment.authenticatedContext("crm-admin", crmClaims("admin@bring.test")).database();
    await assertSucceeds(update(ref(admin, "crmCompany/marketing"), marketingAtomic("admin_daily", "crm-admin")));
    await assertSucceeds(get(ref(environment.authenticatedContext("crm-marketing", crmClaims("marketing@bring.test")).database(), "crmCompany/marketing/daily")));
    for (const [uid, email] of [["crm-sales", "sales@bring.test"], ["crm-viewer", "viewer@bring.test"], ["crm-marketing-disabled", "marketing-disabled@bring.test"]] as const) {
      const database = environment.authenticatedContext(uid, crmClaims(email)).database();
      await assertFails(update(ref(database, "crmCompany/marketing"), marketingAtomic(`${uid}_daily`, uid)));
    }
    for (const [uid, email] of [["crm-sales", "sales@bring.test"], ["crm-viewer", "viewer@bring.test"], ["crm-legacy-member", "legacy@bring.test"]] as const) {
      const database = environment.authenticatedContext(uid, crmClaims(email)).database();
      await assertFails(get(ref(database, "crmCompany/marketing/daily")));
      await assertFails(get(ref(database, "crmCompany/marketing/audits")));
      await assertFails(get(ref(database, "crmCompany/marketing/receipts")));
      await assertSucceeds(get(ref(database, "crmCompany/marketing/aggregates")));
      await assertSucceeds(get(ref(database, "crmCompany/data")));
    }
    await assertFails(get(ref(environment.unauthenticatedContext().database(), "crmCompany/marketing/daily")));
    await assertFails(get(ref(environment.authenticatedContext("crm-marketing", crmClaims("wrong@bring.test")).database(), "crmCompany/marketing/daily")));
  });

  it("enforces exact schema, server time, create version and atomic linkage", async () => {
    const marketing = environment.authenticatedContext("crm-marketing", crmClaims("marketing@bring.test")).database();
    await assertSucceeds(update(ref(marketing, "crmCompany/marketing"), marketingAtomic("daily_valid", "crm-marketing")));
    await assertFails(update(ref(marketing, "crmCompany/marketing"), marketingAtomic("daily_extra", "crm-marketing", { ...marketingRecord("daily_extra", "crm-marketing"), privateMemo: "secret" })));
    await assertFails(update(ref(marketing, "crmCompany/marketing"), marketingAtomic("daily_bad_version", "crm-marketing", marketingRecord("daily_bad_version", "crm-marketing", 2))));
    await assertFails(update(ref(marketing, "crmCompany/marketing"), marketingAtomic("daily_forged_time", "crm-marketing", { ...marketingRecord("daily_forged_time", "crm-marketing"), createdAtMs: 1, updatedAtMs: 1 })));
    await assertFails(set(ref(marketing, `crmCompany/marketing/audits/${MARKETING_AUDIT}`), marketingAudit("standalone", "crm-marketing")));
    await assertFails(set(ref(marketing, `crmCompany/marketing/receipts/${MARKETING_RECEIPT}`), marketingReceipt("standalone", "crm-marketing")));
    await assertFails(update(ref(marketing, "crmCompany/marketing"), { ...marketingAtomic("daily_mismatch", "crm-marketing"), [`receipts/${MARKETING_RECEIPT}`]: { ...marketingReceipt("other", "crm-marketing") } }));
    const forgedSnapshot = marketingRecord("daily_forged_snapshot", "crm-marketing");
    await assertFails(update(ref(marketing, "crmCompany/marketing"), {
      ...marketingAtomic("daily_forged_snapshot", "crm-marketing"),
      [`receipts/${MARKETING_RECEIPT}`]: marketingReceipt(
        "daily_forged_snapshot",
        "crm-marketing",
        "create",
        { ...forgedSnapshot, spend: forgedSnapshot.spend + 1 },
      ),
    }));
  });

  it("binds audit spend values to the previous and proposed daily record", async () => {
    const marketing = environment.authenticatedContext("crm-marketing", crmClaims("marketing@bring.test")).database();
    const lowBefore = marketingAtomic("audit_before_tamper", "crm-marketing");
    lowBefore[`audits/${MARKETING_AUDIT}`] = { ...marketingAudit("audit_before_tamper", "crm-marketing"), beforeSpend: 1 };
    await assertFails(update(ref(marketing, "crmCompany/marketing"), lowBefore));
    const highAfter = marketingAtomic("audit_after_tamper", "crm-marketing");
    highAfter[`audits/${MARKETING_AUDIT}`] = { ...marketingAudit("audit_after_tamper", "crm-marketing"), afterSpend: 999 };
    await assertFails(update(ref(marketing, "crmCompany/marketing"), highAfter));
  });

  it("keeps pre-provisioned sanitized aggregates client read-only because this release has no trusted derivation service", async () => {
    const aggregate = { id: "2026-09", date: "2026-09-01", spend: 1000, impressions: 20, clicks: 3, platformLeads: 1, version: 1, updatedAtMs: SERVER_TIME };
    for (const [uid, email] of [["crm-admin", "admin@bring.test"], ["crm-marketing", "marketing@bring.test"], ["crm-sales", "sales@bring.test"], ["crm-viewer", "viewer@bring.test"], ["crm-marketing-disabled", "marketing-disabled@bring.test"]] as const) {
      const database = environment.authenticatedContext(uid, crmClaims(email)).database();
      await assertFails(set(ref(database, "crmCompany/marketing/aggregates/client-create"), { ...aggregate, id: "client-create" }));
      await assertFails(update(ref(database, "crmCompany/marketing/aggregates/2026-08"), { spend: 2 }));
      await assertFails(remove(ref(database, "crmCompany/marketing/aggregates/2026-08")));
    }
    for (const [uid, email] of [["crm-admin", "admin@bring.test"], ["crm-marketing", "marketing@bring.test"], ["crm-sales", "sales@bring.test"], ["crm-viewer", "viewer@bring.test"]] as const) {
      await assertSucceeds(get(ref(environment.authenticatedContext(uid, crmClaims(email)).database(), "crmCompany/marketing/aggregates/2026-08")));
    }
    await assertFails(get(ref(environment.authenticatedContext("crm-marketing-disabled", crmClaims("marketing-disabled@bring.test")).database(), "crmCompany/marketing/aggregates/2026-08")));
    await assertFails(get(ref(environment.unauthenticatedContext().database(), "crmCompany/marketing/aggregates/2026-08")));
  });

  it("requires exact monotonic update and immutable identity and creation actor", async () => {
    const marketing = environment.authenticatedContext("crm-marketing", crmClaims("marketing@bring.test")).database();
    await assertSucceeds(update(ref(marketing, "crmCompany/marketing"), marketingAtomic("daily_update", "crm-marketing")));
    const existing = (await get(ref(marketing, "crmCompany/marketing/daily/daily_update"))).val();
    const request2 = "223e4567-e89b-42d3-a456-426614174000", audit2 = "audit_223e4567_e89b_42d3_a456_426614174000", receipt2 = "request_223e4567_e89b_42d3_a456_426614174000", hash2 = "b".repeat(64);
    const next = { ...existing, spend: 1200, version: 2, updatedAtMs: SERVER_TIME, lastAction: "update", lastAuditId: audit2, lastReceiptId: receipt2, lastRequestId: request2, lastRequestHash: hash2 };
    const audit = { ...marketingAudit("daily_update", "crm-marketing", "update"), id: audit2, afterSpend: 1200, requestId: request2, requestHash: hash2 };
    const receipt = { ...marketingReceipt("daily_update", "crm-marketing", "update", next), id: receipt2, requestId: request2, requestHash: hash2 };
    await assertSucceeds(update(ref(marketing, "crmCompany/marketing"), { "daily/daily_update": next, [`audits/${audit2}`]: audit, [`receipts/${receipt2}`]: receipt }));
    await assertFails(update(ref(marketing, "crmCompany/marketing"), { "daily/daily_update": { ...next, spend: 1300, updatedAtMs: SERVER_TIME } }));
    await assertFails(update(ref(marketing, "crmCompany/marketing"), { "daily/daily_update": { ...next, version: 3, createdByAuthUid: "forged", updatedAtMs: SERVER_TIME } }));
  });

  it("allows one archive transition then makes the record immutable and denies hard delete", async () => {
    const marketing = environment.authenticatedContext("crm-marketing", crmClaims("marketing@bring.test")).database();
    await assertSucceeds(update(ref(marketing, "crmCompany/marketing"), marketingAtomic("daily_archive", "crm-marketing")));
    const existing = (await get(ref(marketing, "crmCompany/marketing/daily/daily_archive"))).val();
    const request2 = "223e4567-e89b-42d3-a456-426614174000", audit2 = "audit_223e4567_e89b_42d3_a456_426614174000", receipt2 = "request_223e4567_e89b_42d3_a456_426614174000", hash2 = "b".repeat(64);
    const archived = { ...existing, version: 2, updatedAtMs: SERVER_TIME, archivedAtMs: SERVER_TIME, archivedByAuthUid: "crm-marketing", archivedByOperatorId: "operator_kim", lastAction: "archive", lastAuditId: audit2, lastReceiptId: receipt2, lastRequestId: request2, lastRequestHash: hash2 };
    const audit = { ...marketingAudit("daily_archive", "crm-marketing", "archive"), id: audit2, requestId: request2, requestHash: hash2 };
    const receipt = { ...marketingReceipt("daily_archive", "crm-marketing", "archive", archived), id: receipt2, requestId: request2, requestHash: hash2 };
    await assertSucceeds(update(ref(marketing, "crmCompany/marketing"), { "daily/daily_archive": archived, [`audits/${audit2}`]: audit, [`receipts/${receipt2}`]: receipt }));
    await assertFails(remove(ref(marketing, "crmCompany/marketing/daily/daily_archive")));
    await assertFails(update(ref(marketing, "crmCompany/marketing/daily/daily_archive"), { note: "post archive" }));
  });

  it("keeps audit and receipt immutable after their atomic creation", async () => {
    const marketing = environment.authenticatedContext("crm-marketing", crmClaims("marketing@bring.test")).database();
    await assertSucceeds(update(ref(marketing, "crmCompany/marketing"), marketingAtomic("daily_immutable", "crm-marketing")));
    for (const path of [`audits/${MARKETING_AUDIT}`, `receipts/${MARKETING_RECEIPT}`]) {
      await assertFails(update(ref(marketing, `crmCompany/marketing/${path}`), { requestHash: "c".repeat(64) }));
      await assertFails(remove(ref(marketing, `crmCompany/marketing/${path}`)));
    }
  });
});

describe.runIf(databaseEmulatorAvailable)("future CRM cutover rules rehearsal", () => {
  it("keeps the fixture customer backlink contract identical in the emulator", async () => {
    await exerciseCustomerBuildingLinkRules(cutoverEnvironment);
    await exerciseAtomicBuildingCreateWithCustomerLink(cutoverEnvironment);
  });

  it("keeps the Drive import candidate boundary identical in the emulator", async () => {
    await exerciseDriveImportCandidateRules(cutoverEnvironment);
  });

  it("keeps the building-bound service record boundary identical in the emulator", async () => {
    await exerciseServiceRecordRules(cutoverEnvironment);
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
    await assertFails(set(ref(member, "crmCompany/data/buildings/building_1"), {
      ...nextBuilding,
      buildingNo: "BLD-CHANGED",
      entityVersion: 3,
      updatedAt: "2026-08-09T00:00:02.000Z",
    }));
    await assertFails(update(ref(viewer, "crmCompany/data"), atomicPatch));
    await assertFails(set(ref(member, "crmCompany/data"), current));
  });

  it("keeps the compatibility address aligned with road-name then jibun addresses", async () => {
    const member = cutoverEnvironment.authenticatedContext(
      "crm-member",
      crmClaims("member@bring.test"),
    ).database();
    const current = (await assertSucceeds(get(ref(
      member,
      "crmCompany/data/buildings/building_1",
    )))).val();
    const roadAddress = "강원특별자치도 원주시 중앙로 1";
    const jibunAddress = "강원특별자치도 원주시 중앙동 1-1";
    const roadAligned = {
      ...current,
      address: roadAddress,
      roadAddress,
      jibunAddress,
      entityVersion: 2,
      updatedAt: "2026-08-09T00:00:01.000Z",
      updatedByAuthUid: "crm-member",
      updatedByOperatorId: "operator_kim",
    };
    await assertSucceeds(set(
      ref(member, "crmCompany/data/buildings/building_1"),
      roadAligned,
    ));

    const jibunFallback = {
      ...roadAligned,
      address: jibunAddress,
      roadAddress: "",
      entityVersion: 3,
      updatedAt: "2026-08-09T00:00:02.000Z",
    };
    await assertSucceeds(set(
      ref(member, "crmCompany/data/buildings/building_1"),
      jibunFallback,
    ));
    await assertFails(set(
      ref(member, "crmCompany/data/buildings/building_1"),
      {
        ...jibunFallback,
        address: "강원특별자치도 원주시 잘못된로 9",
        entityVersion: 4,
        updatedAt: "2026-08-09T00:00:03.000Z",
      },
    ));
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
