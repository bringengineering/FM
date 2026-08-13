// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { get, ref, set, update } from "firebase/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const PROJECT_ID = "demo-bring-field-platform";
const NOW = "2026-08-09T00:00:00.000Z";

let environment: RulesTestEnvironment;
const databaseEmulatorAvailable = Boolean(
  process.env.FIREBASE_DATABASE_EMULATOR_HOST,
);

function claims(role: "staff" | "reviewer" | "admin") {
  return { fieldPlatform: true, fieldRole: role, email_verified: true };
}

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
    managementNumber: "BR-0001",
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
    });
  });
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
});

beforeEach(async () => {
  if (!databaseEmulatorAvailable) return;
  await environment.clearDatabase();
  await seed();
});

afterAll(async () => {
  await environment?.cleanup();
});

describe.runIf(databaseEmulatorAvailable)("fieldPlatform database rules", () => {
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

  it("keeps media, capture status, audit, outbox, and projection server-owned", async () => {
    for (const [uid, role] of [
      ["staff-1", "staff"],
      ["reviewer-1", "reviewer"],
      ["admin-1", "admin"],
    ] as const) {
      const database = environment.authenticatedContext(uid, claims(role)).database();
      await assertFails(update(ref(database, "fieldPlatform/media/media-1"), {
        uploadState: "failed",
      }));
      await assertFails(update(ref(
        database,
        "fieldPlatform/captureSessions/11111111-1111-4111-8111-111111111111",
      ), { status: "complete" }));
      await assertFails(set(ref(database, "fieldPlatform/auditLogs/client-event"), {
        action: "tampered",
      }));
      await assertFails(set(ref(database, "fieldPlatform/driveSyncJobs/client-job"), {
        status: "complete",
      }));
      await assertFails(update(ref(database, "fieldPlatform/mapProjections/building-1"), {
        captureStatus: "complete",
      }));
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

  it("lets staff update records only for assigned buildings", async () => {
    const database = environment
      .authenticatedContext("staff-1", claims("staff"))
      .database();

    await assertSucceeds(update(ref(database, "fieldPlatform/buildings/building-1"), {
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
    await assertFails(update(ref(database, "fieldPlatform/buildings/building-2"), { name: "차단" }));
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
      await assertFails(get(
        ref(database, "fieldPlatform/registrationRequests/admin-1/request-1"),
      ));
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
