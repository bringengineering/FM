import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const registrations = vi.hoisted(() => {
  const secretValues = new Map<string, string>([
    ["DRIVE_CLIENT_ID", "client-id.apps.googleusercontent.com"],
    ["DRIVE_CLIENT_SECRET", "client-secret"],
    ["DRIVE_REFRESH_TOKEN", "refresh-token"],
    ["DRIVE_ROOT_FOLDER_ID", "root-1"],
    ["DRIVE_ROOT_MODE", "appCreated"],
  ]);
  const definedSecrets: Array<{ name: string; value(): string }> = [];
  const adminVerifyIdToken = vi.fn();
  const adminAuth = {
    verifyIdToken: adminVerifyIdToken,
    getUserByEmail: vi.fn(),
    createUser: vi.fn(),
    setCustomUserClaims: vi.fn(),
    createCustomToken: vi.fn(),
  };
  const getAuth = vi.fn(() => adminAuth);
  const transactionStates: unknown[] = [];
  const transactionPaths: string[] = [];
  const mutationPaths: string[] = [];
  const transactionCurrent = { value: null as unknown };
  const transactionRetryCurrent = { value: undefined as unknown };
  const pathValues = new Map<string, unknown>();
  const readSequences = new Map<string, unknown[]>();
  const unorderedQueryValPaths = new Set<string>();
  const queryCalls: Array<{
    path: string;
    orderByChild: string;
    equalTo?: unknown;
    startAt?: { value: unknown; key?: string };
    startAfter?: { value: unknown; key?: string };
    endAt?: { value: unknown; key?: string };
    limitToFirst?: number;
    limitToLast?: number;
  }> = [];
  const databaseTransaction = vi.fn(
    async (
      update: (current: unknown) => unknown,
      _onComplete: unknown,
      _applyLocally: unknown,
      path: string,
    ) => {
      const rootTransaction = path === "fieldPlatform" || path === "";
      const current = rootTransaction
        ? transactionCurrent.value
        : (pathValues.get(path) ?? null);
      if (rootTransaction && transactionRetryCurrent.value !== undefined) {
        update(current);
        transactionCurrent.value = transactionRetryCurrent.value;
        transactionRetryCurrent.value = undefined;
      }
      const effectiveCurrent = rootTransaction
        ? transactionCurrent.value
        : current;
      const state = update(effectiveCurrent);
      const committed = state !== undefined;
      if (committed) {
        if (rootTransaction) {
          transactionCurrent.value = state;
        } else {
          pathValues.set(path, state);
        }
        if (JSON.stringify(state) !== JSON.stringify(effectiveCurrent)) {
          mutationPaths.push(path);
        }
      }
      transactionStates.push(state);
      transactionPaths.push(path);
      return {
        committed,
        snapshot: {
          val: () => committed ? state : effectiveCurrent,
          exists: () => (committed ? state : effectiveCurrent) !== null,
        },
      };
    },
  );
  const fieldUser = {
    value: { enabled: true, role: "staff" } as unknown,
  };
  const databaseGet = vi.fn(async (path: string) => {
    const sequence = readSequences.get(path);
    const value = sequence && sequence.length > 0
      ? sequence.shift()
      : pathValues.has(path)
        ? pathValues.get(path)
        : path === "fieldPlatform/users/staff-1"
          ? fieldUser.value
          : undefined;
    return {
      val: () => value ?? null,
      exists: () => value !== undefined && value !== null,
    };
  });
  const databaseUpdate = vi.fn(async (path: string, patch: Record<string, unknown>) => {
    pathValues.set(path, { ...(pathValues.get(path) as object || {}), ...patch });
    mutationPaths.push(path);
  });
  const firebaseIntegerKey = (value: string): number | null => {
    if (!/^-?(0*)\d{1,10}$/u.test(value)) return null;
    const parsed = Number(value);
    return parsed >= -2_147_483_648 && parsed <= 2_147_483_647 ? parsed : null;
  };
  const firebaseKeyCompare = (left: string, right: string): number => {
    if (left === right) return 0;
    const leftInteger = firebaseIntegerKey(left);
    const rightInteger = firebaseIntegerKey(right);
    if (leftInteger !== null) {
      if (rightInteger === null) return -1;
      const difference = leftInteger - rightInteger;
      return difference === 0 ? left.length - right.length : difference;
    }
    if (rightInteger !== null) return 1;
    return left < right ? -1 : 1;
  };
  function queryFor(
    path: string,
    state: {
      orderByChild?: string;
      equalTo?: unknown;
      startAt?: { value: unknown; key?: string };
      startAfter?: { value: unknown; key?: string };
      endAt?: { value: unknown; key?: string };
      limitToFirst?: number;
      limitToLast?: number;
    } = {},
  ): Record<string, unknown> {
    const next = (patch: Partial<typeof state>) => queryFor(path, { ...state, ...patch });
    return {
      orderByChild: (child: string) => next({ orderByChild: child }),
      equalTo: (value: unknown) => next({ equalTo: value }),
      startAt: (value: unknown, key?: string) => next({
        startAt: { value, ...(key === undefined ? {} : { key }) },
      }),
      startAfter: (value: unknown, key?: string) => next({
        startAfter: { value, ...(key === undefined ? {} : { key }) },
      }),
      endAt: (value: unknown, key?: string) => next({
        endAt: { value, ...(key === undefined ? {} : { key }) },
      }),
      limitToFirst: (limit: number) => next({ limitToFirst: limit }),
      limitToLast: (limit: number) => next({ limitToLast: limit }),
      get: async () => {
        if (!state.orderByChild) return databaseGet(path);
        queryCalls.push({
          path,
          orderByChild: state.orderByChild,
          ...(state.equalTo === undefined ? {} : { equalTo: state.equalTo }),
          ...(state.startAt === undefined ? {} : { startAt: state.startAt }),
          ...(state.startAfter === undefined ? {} : { startAfter: state.startAfter }),
          ...(state.endAt === undefined ? {} : { endAt: state.endAt }),
          ...(state.limitToFirst === undefined ? {} : { limitToFirst: state.limitToFirst }),
          ...(state.limitToLast === undefined ? {} : { limitToLast: state.limitToLast }),
        });
        const raw = pathValues.get(path);
        const entries = (raw && typeof raw === "object"
          ? Object.entries(raw as Record<string, unknown>)
          : []).sort(([leftKey, leftValue], [rightKey, rightValue]) => {
            const leftChild = leftValue && typeof leftValue === "object"
              ? (leftValue as Record<string, unknown>)[state.orderByChild!]
              : undefined;
            const rightChild = rightValue && typeof rightValue === "object"
              ? (rightValue as Record<string, unknown>)[state.orderByChild!]
              : undefined;
            const childComparison = String(leftChild) < String(rightChild)
              ? -1
              : String(leftChild) > String(rightChild)
                ? 1
                : 0;
            return childComparison || firebaseKeyCompare(leftKey, rightKey);
          });
        const selected = entries.filter(([key, value]) => {
          if (!value || typeof value !== "object") return false;
          const child = (value as Record<string, unknown>)[state.orderByChild!];
          if (state.equalTo !== undefined && child !== state.equalTo) return false;
          if (state.startAt !== undefined) {
            const childComparison = String(child) < String(state.startAt.value)
              ? -1
              : String(child) > String(state.startAt.value)
                ? 1
                : 0;
            if (childComparison < 0) return false;
            if (childComparison === 0 && state.startAt.key !== undefined
              && firebaseKeyCompare(key, state.startAt.key) < 0) return false;
          }
          if (state.startAfter !== undefined) {
            const childComparison = String(child) < String(state.startAfter.value)
              ? -1
              : String(child) > String(state.startAfter.value)
                ? 1
                : 0;
            if (childComparison < 0) return false;
            if (childComparison === 0 && state.startAfter.key !== undefined
              && firebaseKeyCompare(key, state.startAfter.key) <= 0) return false;
            if (childComparison === 0 && state.startAfter.key === undefined) return false;
          }
          if (state.endAt !== undefined) {
            const childComparison = String(child) < String(state.endAt.value)
              ? -1
              : String(child) > String(state.endAt.value)
                ? 1
                : 0;
            if (childComparison > 0) return false;
            if (childComparison === 0 && state.endAt.key !== undefined
              && firebaseKeyCompare(key, state.endAt.key) > 0) return false;
          }
          return true;
        });
        const limited = state.limitToFirst === undefined
          ? state.limitToLast === undefined
            ? selected
            : selected.slice(-state.limitToLast)
          : selected.slice(0, state.limitToFirst);
        const value = Object.fromEntries(
          unorderedQueryValPaths.has(path) ? [...limited].reverse() : limited,
        );
        return {
          val: () => Object.keys(value).length === 0 ? null : value,
          exists: () => Object.keys(value).length > 0,
          forEach: (callback: (snapshot: { key: string; val(): unknown }) => unknown) => {
            for (const [key, childValue] of limited) {
              if (callback({ key, val: () => childValue }) === true) return true;
            }
            return false;
          },
        };
      },
    };
  }
  return {
    onCall: vi.fn((options: unknown, handler: unknown) => ({
      kind: "callable",
      options,
      handler,
    })),
    onRequest: vi.fn((options: unknown, handler: unknown) => ({
      kind: "request",
      options,
      handler,
    })),
    onValueWritten: vi.fn((options: unknown, handler: unknown) => ({
      kind: "database",
      options,
      handler,
    })),
    onValueCreated: vi.fn((options: unknown, handler: unknown) => ({
      kind: "database-created",
      options,
      handler,
    })),
    onSchedule: vi.fn((options: unknown, handler: unknown) => ({
      kind: "schedule",
      options,
      handler,
    })),
    defineSecret: vi.fn((name: string) => {
      const secret = {
        name,
        value: () => secretValues.get(name) ?? "",
      };
      definedSecrets.push(secret);
      return secret;
    }),
    initializeApp: vi.fn(),
    getAuth,
    adminAuth,
    adminVerifyIdToken,
    rebuildMapProjectionForBuilding: vi.fn(async () => undefined),
    databaseTransaction,
    databaseGet,
    databaseUpdate,
    databaseRef: vi.fn((path = "") => ({
      ...queryFor(path),
      transaction: (
        update: (current: unknown) => unknown,
        onComplete?: unknown,
        applyLocally?: unknown,
      ) => databaseTransaction(update, onComplete, applyLocally, path),
      update: (patch: Record<string, unknown>) => databaseUpdate(path, patch),
    })),
    storageFile: vi.fn((path: string) => ({
      name: path,
      getMetadata: vi.fn(async () => [{
        generation: "1",
        size: "1024",
        contentType: "image/jpeg",
        md5Hash: "md5",
        crc32c: "crc",
        metadata: {},
      }]),
      copy: vi.fn(async () => [{
        name: path,
        getMetadata: vi.fn(async () => [{ generation: "2" }]),
      }]),
      delete: vi.fn(async () => undefined),
      getSignedUrl: vi.fn(async () => ["https://signed.example/read"]),
    })),
    fieldUser,
    mutationPaths,
    pathValues,
    readSequences,
    unorderedQueryValPaths,
    transactionStates,
    transactionPaths,
    transactionCurrent,
    transactionRetryCurrent,
    queryCalls,
    definedSecrets,
    secretValues,
  };
});

vi.mock("firebase-admin/app", () => ({
  getApps: () => [],
  initializeApp: registrations.initializeApp,
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: registrations.getAuth,
}));

vi.mock("firebase-admin/database", () => ({
  getDatabase: () => ({ ref: registrations.databaseRef }),
  ServerValue: { TIMESTAMP: { ".sv": "timestamp" } },
}));

vi.mock("firebase-admin/storage", () => ({
  getStorage: () => ({
    bucket: () => ({ file: registrations.storageFile }),
  }),
}));

vi.mock("firebase-functions/v2/https", () => ({
  HttpsError: class MockHttpsError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  onCall: registrations.onCall,
  onRequest: registrations.onRequest,
}));

vi.mock("firebase-functions/v2/database", () => ({
  onValueCreated: registrations.onValueCreated,
  onValueWritten: registrations.onValueWritten,
}));

vi.mock("firebase-functions/v2/scheduler", () => ({
  onSchedule: registrations.onSchedule,
}));

vi.mock("firebase-functions/params", () => ({
  defineSecret: registrations.defineSecret,
}));

vi.mock("../src/field/rebuild-map-projection.js", () => ({
  rebuildMapProjectionForBuilding:
    registrations.rebuildMapProjectionForBuilding,
}));

import * as entrypoints from "../src/index.js";

interface RegisteredEntrypoint {
  kind: "callable" | "request" | "database" | "database-created" | "schedule";
  options: Record<string, unknown>;
  handler: unknown;
}

interface DatabaseWriteEvent {
  id: string;
  time: string;
  params: Record<string, string>;
  data: {
    before: { val(): unknown };
    after: { val(): unknown };
  };
}

type DatabaseWriteHandler = (event: DatabaseWriteEvent) => Promise<void>;

type CallableHandler = (request: unknown) => Promise<unknown>;
type RequestHandler = (request: unknown, response: unknown) => Promise<unknown>;

interface EventScopedProjectionDependencies {
  now(): string;
  setProjection(buildingId: string, projection: unknown): Promise<void>;
}

function registration(value: unknown): RegisteredEntrypoint {
  return value as RegisteredEntrypoint;
}

function databaseHandler(value: unknown): DatabaseWriteHandler {
  return registration(value).handler as DatabaseWriteHandler;
}

function callableHandler(value: unknown): CallableHandler {
  return registration(value).handler as CallableHandler;
}

function requestHandler(value: unknown): RequestHandler {
  return registration(value).handler as RequestHandler;
}

function validRegistrationData() {
  return {
    requestId: "request-1",
    draftId: "draft-1",
    building: {
      managementNumber: "MGMT-001",
      name: "Test building",
      roadAddress: "1 Test-ro, Wonju",
      latitude: 37.369,
      longitude: 127.928,
      elevator: true,
      parking: { available: true },
    },
    units: [{
      localId: "unit-1",
      unitLabel: "101",
      options: [],
      isVacant: true,
    }],
    listing: {
      depositWon: 3_000_000,
      monthlyRentWon: 350_000,
      maintenanceFeeWon: 50_000,
      maintenanceFeeItems: [],
      parkingDescription: "Available",
      petPolicy: "Ask owner",
      options: [],
    },
    primaryUnitLocalId: "unit-1",
    managementContract: { requested: false },
    ownerNoteDrafts: [{
      localId: "note_12345678",
      body: "Owner requested a follow-up",
      recordedAt: "2026-08-09T01:30:00.000Z",
    }],
  };
}

function validCallableRequest(data: unknown) {
  return {
    auth: {
      uid: "staff-1",
      token: {
        fieldPlatform: true,
        fieldRole: "staff",
        name: "Verified staff",
        auth_time: 1_723_181_696,
      },
    },
    data,
  };
}

function validReviewerCallableRequest(data: unknown) {
  return {
    auth: {
      uid: "reviewer-1",
      token: {
        fieldPlatform: true,
        fieldRole: "reviewer",
        name: "Verified reviewer",
        auth_time: 1_723_181_696,
      },
    },
    data,
  };
}

function seedFieldV2Access(
  role: "admin" | "member" | "viewer" = "member",
  releaseOverrides: Record<string, unknown> = {},
) {
  registrations.pathValues.set("crmCompany/access/shared_uid", {
    enabled: true,
    role,
    email: "team@bringcare.kr",
  });
  registrations.pathValues.set("crmCompany/teamProfiles/operator_kim", {
    active: true,
    displayName: "김현진",
    sortOrder: 1,
  });
  registrations.pathValues.set("crmCompany/teamProfiles/operator_hwang", {
    active: true,
    displayName: "황우중",
    sortOrder: 2,
  });
  registrations.pathValues.set("fieldPlatform/v2/config/release", {
    protocolVersion: 2,
    minDesktopVersion: "1.7.0",
    maxDesktopVersion: "2.0.0",
    minPwaVersion: "1.0.0",
    enabledOperatorIds: ["operator_kim", "operator_hwang"],
    v2WritesEnabled: true,
    canonicalCrmEnabled: false,
    safeMode: false,
    cutoverAt: null,
    ...releaseOverrides,
  });
  const seoulDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  registrations.pathValues.set("fieldPlatform/v2/projections/operatorKpis/operator_kim/current", {
    operatorId: "operator_kim",
    seoulDate,
    todayVisits: 0,
    capturePending: 0,
    uploadFailures: 0,
    reviewPending: 0,
    unassigned: 0,
    overdue: 0,
    adminActionRequired: 0,
    updatedAt: new Date().toISOString(),
  });
  registrations.pathValues.set("fieldPlatform/v2/projections/teamKpis/current", {
    seoulDate,
    todayVisits: 0,
    capturePending: 0,
    uploadFailures: 0,
    reviewPending: 0,
    unassigned: 0,
    overdue: 0,
    adminActionRequired: 0,
    updatedAt: new Date().toISOString(),
  });
}

function fieldV2WorkspaceItemsFromPaths(): Record<string, unknown> {
  const prefix = "fieldPlatform/v2/workItems/";
  return Object.fromEntries([...registrations.pathValues.entries()]
    .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
    .map(([path, value]) => [path.slice(prefix.length), value]));
}

function seedFieldV2WorkspaceRoot(
  role: "admin" | "member" | "viewer" = "member",
  options: {
    workItems?: Record<string, unknown>;
    projections?: Record<string, unknown>;
  } = {},
): void {
  registrations.transactionCurrent.value = {
    crmCompany: {
      access: {
        shared_uid: { enabled: true, role, email: "team@bringcare.kr" },
      },
      teamProfiles: {
        operator_kim: { active: true, displayName: "김현진", sortOrder: 1 },
        operator_hwang: { active: true, displayName: "황우중", sortOrder: 2 },
      },
    },
    fieldPlatform: {
      v2: {
        config: {
          release: registrations.pathValues.get("fieldPlatform/v2/config/release"),
        },
        workItems: options.workItems ?? fieldV2WorkspaceItemsFromPaths(),
        projections: options.projections ?? {},
      },
    },
  };
}

function validFieldV2Request(data: Record<string, unknown>) {
  return {
    auth: {
      uid: "shared_uid",
      token: {
        email: "team@bringcare.kr",
        email_verified: true,
      },
    },
    data: {
      protocolVersion: 2,
      clientKind: "pwa",
      buildVersion: "1.0.0",
      operatorId: "operator_kim",
      ...data,
    },
  };
}

function validOperatorSwitchRequest(overrides: Record<string, unknown> = {}) {
  return validFieldV2Request({
    requestId: "123e4567-e89b-42d3-a456-426614174000",
    operatorId: "operator_hwang",
    fromOperatorId: "operator_kim",
    toOperatorId: "operator_hwang",
    reason: "manual_switch",
    ...overrides,
  });
}

function operatorSwitchRatePath(): string {
  const key = createHash("sha256")
    .update("shared_uid")
    .digest("base64url")
    .slice(0, 43);
  return `fieldPlatform/v2/rateLimits/recordFieldOperatorSwitch/uid/${key}`;
}

function canonicalCrmRoot(role: "admin" | "member" | "viewer" = "member") {
  return {
    crmCompany: {
      access: {
        shared_uid: { enabled: true, role, email: "team@bringcare.kr" },
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
            ownerCustomerId: "customer_1",
            externalRefs: { fieldBuildingIds: ["field_building_1"] },
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
        },
        salesProspects: {},
        salesUnits: {},
      },
      fieldSummaries: {},
    },
    fieldPlatform: {
      v2: {
        config: {
          release: {
            protocolVersion: 2,
            minDesktopVersion: "1.7.0",
            maxDesktopVersion: "2.0.0",
            minPwaVersion: "1.0.0",
            enabledOperatorIds: ["operator_kim"],
            v2WritesEnabled: true,
            canonicalCrmEnabled: true,
            safeMode: false,
            cutoverAt: null,
          },
        },
        links: {
          crmBuildings: { building_1: "field_building_1" },
          crmBuildingUnits: {},
          crmSalesUnits: {},
        },
        workItems: {},
        requestReceipts: { commitCanonicalCrmEntity: {} },
        auditLogs: {},
      },
    },
  };
}

function seedCanonicalCrmAccess(role: "admin" | "member" | "viewer" = "member") {
  registrations.pathValues.set("crmCompany/access/shared_uid", {
    enabled: true,
    role,
    email: "team@bringcare.kr",
  });
  registrations.pathValues.set("crmCompany/teamProfiles/operator_kim", {
    active: true,
    displayName: "김현진",
    sortOrder: 1,
  });
}

function validCanonicalCrmBody(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: 2,
    clientKind: "desktop",
    buildVersion: "1.8.0",
    operatorId: "operator_kim",
    requestId: "123e4567-e89b-42d3-a456-426614174000",
    entityType: "buildingUnits",
    entityId: "unit_1",
    operation: "update",
    expectedVersion: 4,
    patch: { label: "203호" },
    reason: "현장 표기 확인",
    ...overrides,
  };
}

function canonicalHttpRequest(
  body: unknown,
  overrides: Record<string, unknown> = {},
) {
  const headers: Record<string, string> = {
    authorization: "Bearer current-project-id-token",
    "content-type": "application/json",
    ...(isRecord(overrides.headers) ? overrides.headers as Record<string, string> : {}),
  };
  return {
    method: "POST",
    ip: "127.0.0.1",
    headers,
    rawBody: Buffer.from(JSON.stringify(body), "utf8"),
    get(name: string) {
      return headers[name.toLowerCase()];
    },
    ...overrides,
    headers,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function httpResponseHarness() {
  const state: { status: number; body: unknown; headers: Record<string, string> } = {
    status: 200,
    body: undefined,
    headers: {},
  };
  const response = {
    status(code: number) {
      state.status = code;
      return response;
    },
    set(name: string, value: string) {
      state.headers[name.toLowerCase()] = value;
      return response;
    },
    json(body: unknown) {
      state.body = body;
      return response;
    },
  };
  return { state, response };
}

function fieldV2WorkItem(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  };
  if (!Object.hasOwn(overrides, "sourceHash")) {
    const canonicalize = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(canonicalize);
      if (typeof value !== "object" || value === null) return value;
      const record = value as Record<string, unknown>;
      return Object.fromEntries(Object.keys(record).sort()
        .map((key) => [key, canonicalize(record[key])]));
    };
    item.sourceHash = createHash("sha256")
      .update(JSON.stringify(canonicalize({
        snapshot: item.sourceSnapshot,
        version: item.sourceVersion,
      })))
      .digest("hex");
  }
  const timestamp = "2026-08-14T02:00:00.000Z";
  const acceptedStatuses = ["accepted", "in_progress", "evidence_ready", "review_pending", "changes_requested", "approved", "completed"];
  const startedStatuses = ["in_progress", "evidence_ready", "review_pending", "changes_requested", "approved", "completed"];
  const evidenceStatuses = ["evidence_ready", "review_pending", "changes_requested", "approved", "completed"];
  const reviewStatuses = ["review_pending", "changes_requested", "approved"];
  if (acceptedStatuses.includes(String(item.workflowStatus)) && item.acceptedAt === undefined) item.acceptedAt = timestamp;
  if (startedStatuses.includes(String(item.workflowStatus)) && item.startedAt === undefined) item.startedAt = timestamp;
  if (evidenceStatuses.includes(String(item.workflowStatus)) && item.evidenceReadyAt === undefined) item.evidenceReadyAt = timestamp;
  if (reviewStatuses.includes(String(item.workflowStatus)) && item.reviewPendingAt === undefined) item.reviewPendingAt = timestamp;
  if (item.workflowStatus === "completed" && item.completedAt === undefined) item.completedAt = timestamp;
  if (item.workflowStatus === "cancelled" && item.cancelledAt === undefined) {
    item.cancelledAt = timestamp;
    item.cancelReason = "cancelled";
  }
  return item;
}

function fieldV2Visit(overrides: Record<string, unknown> = {}) {
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

function fieldV2TeamProjection(overrides: Record<string, unknown> = {}) {
  const item = fieldV2WorkItem(overrides);
  const priorityRank = { urgent: 0, high: 1, normal: 2, low: 3 } as const;
  return {
    fieldJobId: item.id,
    visitId: item.visitId,
    jobType: item.jobType,
    parentName: item.sourceSnapshot.parentName,
    address: item.sourceSnapshot.address,
    unitLabel: item.sourceSnapshot.unitLabel ?? null,
    assignedOperatorId: item.assignedOperatorId,
    dueDate: item.dueDate,
    priority: item.priority,
    workflowStatus: item.workflowStatus,
    uploadStatus: item.uploadStatus,
    mediaCount: item.mediaCount,
    uploadFailureCount: item.uploadFailureCount,
    adminActionRequired: item.adminActionRequired,
    updatedAt: item.updatedAt,
    activeOrderKey: `${item.dueDate}|${priorityRank[item.priority as keyof typeof priorityRank]}|${item.updatedAt}|${item.id}`,
  };
}

const AD_REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AD_SESSION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AD_MEDIA_IDS = Array.from({ length: 10 }, (_, index) =>
  `cccccccc-cccc-4ccc-8ccc-${String(index + 1).padStart(12, "0")}`,
);
const AD_ZONES = [
  ["exterior", "photo"],
  ["accessRoad", "photo"],
  ["commonEntrance", "photo"],
  ["roomOverview", "photo"],
  ["roomOverview", "photo"],
  ["windowDaylight", "photo"],
  ["kitchen", "photo"],
  ["bathroom", "photo"],
  ["boilerEquipment", "photo"],
  ["verticalVideo", "video"],
] as const;

function validAdMedia(id: string, index: number) {
  const [zone, kind] = AD_ZONES[index];
  const mimeType = kind === "photo" ? "image/jpeg" : "video/mp4";
  return {
    id,
    requestId: `request-${index}`,
    buildingId: "building-1",
    unitId: "unit-1",
    listingId: "listing-1",
    visitId: "visit-1",
    captureSessionId: AD_SESSION_ID,
    capturedBy: "staff-1",
    kind,
    zone,
    slotId: `slot-${index + 1}`,
    required: true,
    mimeType,
    sizeBytes: 2_048,
    capturedAt: `2026-08-10T04:${String(index).padStart(2, "0")}:00.000Z`,
    storagePath: `field-media-finalized/building-1/${id}.${kind === "photo" ? "jpg" : "mp4"}`,
    objectGeneration: String(1_000 + index),
    objectMd5Hash: "1B2M2Y8AsgTpgAmY7PhCfg==",
    uploadState: "finalized",
    uploadProgress: 100,
    driveSyncState: "queued",
    advertisingApproved: true,
    ...(kind === "video" ? { captureQualityState: "valid" } : {}),
  };
}

function validAdPlatformRoot() {
  return {
    buildings: {
      "building-1": {
        id: "building-1",
        managementNumber: "BR-001",
        name: "Bring House",
        roadAddress: "1 Bring-ro, Wonju",
        parking: { available: true },
      },
    },
    units: {
      "unit-1": {
        id: "unit-1",
        buildingId: "building-1",
        unitLabel: "201",
        options: [],
      },
    },
    listings: {
      "listing-1": {
        id: "listing-1",
        buildingId: "building-1",
        unitId: "unit-1",
        unitLabel: "201",
        status: "ready",
        advertisingApproved: true,
        depositWon: 5_000_000,
        monthlyRentWon: 450_000,
        maintenanceFeeWon: 50_000,
        maintenanceFeeItems: [],
        availableFrom: "2026-08-11",
        locationDescription: "near terminal",
        parkingDescription: "one car",
        petPolicy: "ask owner",
        options: [],
      },
    },
    captureSessions: {
      [AD_SESSION_ID]: {
        id: AD_SESSION_ID,
        buildingId: "building-1",
        unitId: "unit-1",
        listingId: "listing-1",
        status: "complete",
      },
    },
    media: Object.fromEntries(AD_MEDIA_IDS.map((id, index) => [id, validAdMedia(id, index)])),
    adPackages: {},
    adPackageVersions: {},
    auditLogs: {},
  };
}

function validCreateAdPackageData() {
  return {
    requestId: AD_REQUEST_ID,
    listingId: "listing-1",
    approvedMediaIds: [...AD_MEDIA_IDS],
    representativeMediaIds: [AD_MEDIA_IDS[0]],
  };
}

const OWNER_NOTE_PATH = "fieldPlatform/ownerNotes/building-1/note_12345678";
const OWNER_RATE_PATH =
  "fieldPlatform/serverState/rateLimits/ownerNotes/staff-1/1723181696/append";

function validOwnerNoteData() {
  return {
    buildingId: "building-1",
    localId: "note_12345678",
    body: "Owner requested a follow-up",
    recordedAt: "2026-08-09T01:30:00.000Z",
  };
}

function ownerNoteRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "note_12345678",
    buildingId: "building-1",
    body: "Owner requested a follow-up",
    recordedAt: "2026-08-09T01:30:00.000Z",
    createdAt: "2026-08-09T02:00:00.000Z",
    createdBy: "staff-1",
    createdByName: "Verified staff",
    ...overrides,
  };
}

function seedOwnerNoteAccess(role: "admin" | "staff" | "reviewer" = "staff") {
  registrations.fieldUser.value = { enabled: true, role };
  registrations.pathValues.set(
    `fieldPlatform/users/${role === "admin" ? "admin-1" : "staff-1"}`,
    { enabled: true, role },
  );
  const uid = role === "admin" ? "admin-1" : "staff-1";
  registrations.pathValues.set(`fieldPlatform/users/${uid}/enabled`, true);
  registrations.pathValues.set(`fieldPlatform/users/${uid}/displayName`,
    role === "admin" ? "Administrator" : "Verified staff");
  registrations.pathValues.set("fieldPlatform/buildings/building-1", { id: "building-1" });
  registrations.pathValues.set(
    `fieldPlatform/buildingAssignments/building-1/${uid}`,
    true,
  );
}

function validOwnerCallableRequest(
  data: unknown,
  role: "admin" | "staff" | "reviewer" = "staff",
) {
  const uid = role === "admin" ? "admin-1" : "staff-1";
  return {
    auth: {
      uid,
      token: {
        fieldPlatform: true,
        fieldRole: role,
        name: role === "admin" ? "Administrator" : "Verified staff",
        auth_time: 1_723_181_696,
      },
    },
    data,
  };
}

const EVENT_VERSION = {
  eventTime: "2026-08-09T12:00:02.000Z",
  revision: "database-event-2",
};

beforeEach(() => {
  registrations.adminVerifyIdToken.mockReset();
  registrations.rebuildMapProjectionForBuilding.mockClear();
  registrations.databaseRef.mockClear();
  registrations.databaseTransaction.mockClear();
  registrations.databaseGet.mockClear();
  registrations.databaseUpdate.mockClear();
  registrations.storageFile.mockClear();
  registrations.fieldUser.value = { enabled: true, role: "staff" };
  registrations.mutationPaths.length = 0;
  registrations.pathValues.clear();
  registrations.readSequences.clear();
  registrations.unorderedQueryValPaths.clear();
  registrations.transactionStates.length = 0;
  registrations.transactionPaths.length = 0;
  registrations.transactionCurrent.value = null;
  registrations.transactionRetryCurrent.value = undefined;
  registrations.queryCalls.length = 0;
  registrations.secretValues.set("DRIVE_CLIENT_ID", "client-id.apps.googleusercontent.com");
  registrations.secretValues.set("DRIVE_CLIENT_SECRET", "client-secret");
  registrations.secretValues.set("DRIVE_REFRESH_TOKEN", "refresh-token");
  registrations.secretValues.set("DRIVE_ROOT_FOLDER_ID", "root-1");
  registrations.secretValues.set("DRIVE_ROOT_MODE", "appCreated");
});

describe("Firebase entrypoint metadata", () => {
  it.each([
    ["blank body", (data: ReturnType<typeof validRegistrationData>) => {
      data.ownerNoteDrafts[0].body = "   ";
    }],
    ["duplicate IDs", (data: ReturnType<typeof validRegistrationData>) => {
      data.ownerNoteDrafts.push({ ...data.ownerNoteDrafts[0] });
    }],
    ["more than 100 drafts", (data: ReturnType<typeof validRegistrationData>) => {
      data.ownerNoteDrafts = Array.from({ length: 101 }, (_, index) => ({
        ...data.ownerNoteDrafts[0],
        localId: `note_${String(index).padStart(8, "0")}`,
      }));
    }],
    ["noncanonical recordedAt", (data: ReturnType<typeof validRegistrationData>) => {
      data.ownerNoteDrafts[0].recordedAt = "2026-08-09T01:30:00Z";
    }],
  ])("maps an initial owner-note %s to invalid-argument", async (_label, mutate) => {
    const data = validRegistrationData();
    mutate(data);

    await expect(
      callableHandler(entrypoints.saveFieldRegistration)(
        validCallableRequest(data),
      ),
    ).rejects.toMatchObject({
      code: "invalid-argument",
      message: "field_invalid_registration",
    });
  });

  it("derives the note actor name and decimal session ID only from verified claims", async () => {
    const actor = await entrypoints.requireFieldActor({
      auth: {
        uid: "staff-1",
        token: {
          fieldPlatform: true,
          fieldRole: "staff",
          name: "인증된 이름",
          auth_time: 1_723_181_696,
        },
      },
      data: {
        tokenDisplayName: "위조 이름",
        sessionId: "위조 세션",
      },
    } as never);

    expect(actor).toEqual({
      uid: "staff-1",
      role: "staff",
      enabled: true,
      tokenDisplayName: "인증된 이름",
      sessionId: "1723181696",
    });
    expect(registrations.databaseRef).toHaveBeenCalledWith(
      "fieldPlatform/users/staff-1",
    );
  });

  it("exports all field callables with their exact App Check options", () => {
    for (const callable of [
      entrypoints.createDesktopFieldHandoff,
      entrypoints.exchangeDesktopFieldHandoff,
    ]) {
      expect(registration(callable)).toMatchObject({
        kind: "callable",
        options: {
          region: "asia-northeast3",
          cors: [
            "https://bring-fm.web.app",
            "https://bring-fm.firebaseapp.com",
          ],
        },
      });
    }

    expect(registration(entrypoints.saveFieldRegistration)).toMatchObject({
      kind: "callable",
      options: {
        region: "asia-northeast3",
        enforceAppCheck: true,
      },
    });
    expect(registration(entrypoints.saveFieldRegistration).options).toEqual({
      region: "asia-northeast3",
      enforceAppCheck: true,
    });

    expect(registration(entrypoints.setManagementContractStatus)).toMatchObject({
      kind: "callable",
      options: {
        region: "asia-northeast3",
        enforceAppCheck: true,
      },
    });
    expect(
      registration(entrypoints.setManagementContractStatus).options,
    ).toEqual({
      region: "asia-northeast3",
      enforceAppCheck: true,
    });

    expect(registration(entrypoints.startFieldCaptureSession)).toMatchObject({
      kind: "callable",
      options: {
        region: "asia-northeast3",
        enforceAppCheck: true,
        consumeAppCheckToken: true,
      },
    });
    expect(registration(entrypoints.startFieldCaptureSession).options).toEqual({
      region: "asia-northeast3",
      enforceAppCheck: true,
      consumeAppCheckToken: true,
    });

    for (const callable of [
      entrypoints.finalizeFieldMedia,
      entrypoints.getFieldMediaAccess,
      entrypoints.excludeFieldMedia,
      entrypoints.listFieldCaptureWorkspace,
      entrypoints.createAdPackage,
      entrypoints.listAdPackageReviewCandidates,
    ]) {
      expect(registration(callable)).toMatchObject({
        kind: "callable",
        options: {
          region: "asia-northeast3",
          enforceAppCheck: true,
          consumeAppCheckToken: true,
        },
      });
      expect(registration(callable).options).toEqual({
        region: "asia-northeast3",
        enforceAppCheck: true,
        consumeAppCheckToken: true,
      });
    }

    for (const callable of [
      entrypoints.appendOwnerNote,
      entrypoints.archiveOwnerNote,
    ]) {
      expect(registration(callable)).toMatchObject({
        kind: "callable",
        options: {
          region: "asia-northeast3",
          enforceAppCheck: true,
        },
      });
      expect(registration(callable).options).toEqual({
        region: "asia-northeast3",
        enforceAppCheck: true,
      });
    }


    for (const callable of [
      entrypoints.createFieldJobs,
      entrypoints.claimFieldJob,
      entrypoints.assignFieldJob,
      entrypoints.changeFieldVisit,
      entrypoints.transitionFieldJob,
      entrypoints.recordFieldOperatorSwitch,
      entrypoints.listFieldOperationsWorkspace,
    ]) {
      expect(registration(callable)).toMatchObject({
        kind: "callable",
        options: {
          region: "asia-northeast3",
          enforceAppCheck: true,
        },
      });
      expect(registration(callable).options).toEqual({
        region: "asia-northeast3",
        enforceAppCheck: true,
      });
    }
  });

  it.each([
    ["create malformed", entrypoints.createFieldJobs, null],
    ["claim missing operator", entrypoints.claimFieldJob, { requestId: "bad" }],
    ["assign valid-shaped", entrypoints.assignFieldJob, validFieldV2Request({
      requestId: "123e4567-e89b-42d3-a456-426614174000",
      jobId: "job_1",
      assignedOperatorId: null,
      reason: "reassign",
    }).data],
    ["change empty", entrypoints.changeFieldVisit, {}],
    ["transition non-record", entrypoints.transitionFieldJob, "bad"],
    ["operator switch malformed", entrypoints.recordFieldOperatorSwitch, null],
    ["workspace missing operator", entrypoints.listFieldOperationsWorkspace, {
      protocolVersion: 2,
      clientKind: "pwa",
      buildVersion: "1.0.0",
    }],
  ])("rejects unauthenticated v2 %s before payload or database access", async (
    _label,
    callable,
    data,
  ) => {
    registrations.databaseRef.mockClear();
    await expect(callableHandler(callable)({ data })).rejects.toMatchObject({
      code: "unauthenticated",
      message: "field_auth_required",
    });
    expect(registrations.databaseRef).not.toHaveBeenCalled();
  });

  it("records a viewer operator switch with one root transaction and a bounded UID rate limit", async () => {
    seedFieldV2Access("viewer");
    seedFieldV2WorkspaceRoot("viewer");

    const result = await callableHandler(entrypoints.recordFieldOperatorSwitch)(
      validOperatorSwitchRequest(),
    ) as Record<string, unknown>;

    expect(result).toMatchObject({
      requestId: "123e4567-e89b-42d3-a456-426614174000",
      fromOperatorId: "operator_kim",
      toOperatorId: "operator_hwang",
      reason: "manual_switch",
      recordedAt: expect.any(String),
      repeated: false,
    });
    expect(registrations.transactionPaths.filter((path) => path === "")).toHaveLength(1);
    expect(registrations.transactionPaths).toContain(operatorSwitchRatePath());
    const root = registrations.transactionCurrent.value as any;
    expect(Object.keys(root.fieldPlatform.v2.auditLogs)).toHaveLength(1);
    expect(root.fieldPlatform.v2.requestReceipts.recordFieldOperatorSwitch)
      .toHaveProperty("123e4567-e89b-42d3-a456-426614174000");
    expect(root.fieldPlatform.v2).not.toHaveProperty("selectedOperator");
    expect(root.crmCompany).not.toHaveProperty("selectedOperator");
  });

  it("rejects malformed switch data before profile, release, rate-limit, or root access", async () => {
    registrations.databaseRef.mockClear();
    const request = validOperatorSwitchRequest({ secretToken: "must-not-leak" });
    await expect(callableHandler(entrypoints.recordFieldOperatorSwitch)(request))
      .rejects.toMatchObject({
        code: "invalid-argument",
        message: "field_operator_switch_input_invalid",
      });
    expect(registrations.databaseRef).not.toHaveBeenCalled();
  });

  it("fails closed when access changes between preflight and the root transaction", async () => {
    seedFieldV2Access("viewer");
    seedFieldV2WorkspaceRoot("member");
    await expect(callableHandler(entrypoints.recordFieldOperatorSwitch)(
      validOperatorSwitchRequest(),
    )).rejects.toMatchObject({
      code: "permission-denied",
      message: "field_access_forbidden",
    });
    expect(registrations.transactionPaths.filter((path) => path === "")).toHaveLength(1);
    const root = registrations.transactionCurrent.value as any;
    expect(root.fieldPlatform.v2).not.toHaveProperty("auditLogs");
    expect(root.fieldPlatform.v2).not.toHaveProperty("requestReceipts");
  });

  it("allows exact replay during safe mode but blocks a new switch request", async () => {
    seedFieldV2Access("viewer");
    seedFieldV2WorkspaceRoot("viewer");
    const first = await callableHandler(entrypoints.recordFieldOperatorSwitch)(
      validOperatorSwitchRequest(),
    ) as Record<string, unknown>;
    const safeRelease = {
      ...(registrations.pathValues.get("fieldPlatform/v2/config/release") as object),
      safeMode: true,
    };
    registrations.pathValues.set("fieldPlatform/v2/config/release", safeRelease);
    (registrations.transactionCurrent.value as any)
      .fieldPlatform.v2.config.release = safeRelease;

    await expect(callableHandler(entrypoints.recordFieldOperatorSwitch)(
      validOperatorSwitchRequest(),
    )).resolves.toEqual({ ...first, repeated: true });
    await expect(callableHandler(entrypoints.recordFieldOperatorSwitch)(
      validOperatorSwitchRequest({
        requestId: "223e4567-e89b-42d3-a456-426614174000",
      }),
    )).rejects.toMatchObject({
      code: "failed-precondition",
      message: "field_safe_mode_read_only",
    });
    const root = registrations.transactionCurrent.value as any;
    expect(Object.keys(root.fieldPlatform.v2.auditLogs)).toHaveLength(1);
  });

  it("maps request-ID hash conflicts without changing the first audit", async () => {
    seedFieldV2Access("viewer");
    seedFieldV2WorkspaceRoot("viewer");
    await callableHandler(entrypoints.recordFieldOperatorSwitch)(
      validOperatorSwitchRequest(),
    );
    await expect(callableHandler(entrypoints.recordFieldOperatorSwitch)(
      validOperatorSwitchRequest({ reason: "desktop_navigation" }),
    )).rejects.toMatchObject({
      code: "already-exists",
      message: "field_request_id_conflict",
    });
    const root = registrations.transactionCurrent.value as any;
    expect(Object.keys(root.fieldPlatform.v2.auditLogs)).toHaveLength(1);
  });

  it("maps the operator-switch UID rate limit and never opens the root transaction", async () => {
    seedFieldV2Access("viewer");
    seedFieldV2WorkspaceRoot("viewer");
    registrations.pathValues.set(operatorSwitchRatePath(), {
      windowStartedAt: Date.now(),
      count: 60,
    });

    await expect(callableHandler(entrypoints.recordFieldOperatorSwitch)(
      validOperatorSwitchRequest(),
    )).rejects.toMatchObject({
      code: "resource-exhausted",
      message: "field_operator_switch_rate_limited",
    });
    expect(registrations.transactionPaths).not.toContain("");
  });

  it("creates v2 work from current CRM auth with one atomic root transaction", async () => {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    seedFieldV2Access();
    registrations.pathValues.set("crmCompany/data/salesProspects/prospect_1", {
      id: "prospect_1",
      name: "상지 원룸",
      address: "강원 원주시 상지대길 1",
      updatedAt: "2026-08-14T01:00:00.000Z",
      archivedAt: null,
    });
    registrations.pathValues.set("crmCompany/data/salesUnits/sales_unit_1", {
      id: "sales_unit_1",
      prospectId: "prospect_1",
      label: "101호",
      deposit: 3_000_000,
      rent: 350_000,
      maintenanceFee: 50_000,
      updatedAt: "2026-08-14T01:30:00.000Z",
      archivedAt: null,
    });
    registrations.transactionCurrent.value = {
      crmCompany: {
        access: {
          shared_uid: { enabled: true, role: "member", email: "team@bringcare.kr" },
        },
        teamProfiles: {
          operator_kim: { active: true, displayName: "김현진" },
        },
        data: {
          salesProspects: {
            prospect_1: registrations.pathValues.get("crmCompany/data/salesProspects/prospect_1"),
          },
          salesUnits: {
            sales_unit_1: registrations.pathValues.get("crmCompany/data/salesUnits/sales_unit_1"),
          },
        },
      },
      fieldPlatform: {
        v2: {
          config: { release: registrations.pathValues.get("fieldPlatform/v2/config/release") },
        },
      },
    };

    const result = await callableHandler(entrypoints.createFieldJobs)(
      validFieldV2Request({
        requestId: "123e4567-e89b-42d3-a456-426614174000",
        jobType: "vacancy_capture",
        crmSalesProspectId: "prospect_1",
        crmSalesUnitIds: ["sales_unit_1"],
        dueDate: today,
        priority: "normal",
        assignedOperatorId: null,
        authUid: "attacker_uid",
        email: "attacker@example.com",
      }),
    ) as { visitId: string; jobIds: string[]; repeated: boolean };

    expect(result).toMatchObject({ repeated: false });
    expect(result.jobIds).toHaveLength(1);
    expect(registrations.transactionPaths).toContain("");
    const root = registrations.transactionCurrent.value as Record<string, unknown>;
    expect(root).toHaveProperty(`fieldPlatform.v2.visits.${result.visitId}`);
    expect(root).toHaveProperty(`fieldPlatform.v2.workItems.${result.jobIds[0]}`);
    expect(root).toHaveProperty(`fieldPlatform.v2.projections.teamActive.${result.jobIds[0]}`);
    expect(root).toHaveProperty(`fieldPlatform.v2.projections.teamVisitState.${result.visitId}`, {
      visitId: result.visitId,
      seoulDate: today,
      activeTodayItemCount: 1,
      updatedAt: expect.any(String),
    });
    expect(root).toHaveProperty("fieldPlatform.v2.projections.teamKpis.current", {
      seoulDate: today,
      todayVisits: 1,
      capturePending: 1,
      uploadFailures: 0,
      reviewPending: 0,
      unassigned: 1,
      overdue: 0,
      adminActionRequired: 0,
      updatedAt: expect.any(String),
    });
    expect(root).toHaveProperty("fieldPlatform.v2.projections.operatorKpis.operator_kim.current", {
      operatorId: "operator_kim",
      seoulDate: today,
      todayVisits: 0,
      capturePending: 0,
      uploadFailures: 0,
      reviewPending: 0,
      unassigned: 0,
      overdue: 0,
      adminActionRequired: 0,
      updatedAt: expect.any(String),
    });
    expect(root).toHaveProperty(`crmCompany.fieldSummaries.${result.jobIds[0]}`);
    expect(registrations.databaseRef).not.toHaveBeenCalledWith(
      "fieldPlatform/users/shared_uid",
    );
  });

  it("updates team KPI and visit aggregates atomically when a job is claimed then cancelled", async () => {
    seedFieldV2Access();
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const item = fieldV2WorkItem({ dueDate: today });
    const visit = fieldV2Visit({ dueDate: today });
    registrations.transactionCurrent.value = {
      crmCompany: {
        access: { shared_uid: { enabled: true, role: "member", email: "team@bringcare.kr" } },
        teamProfiles: { operator_kim: { active: true, displayName: "operator" } },
      },
      fieldPlatform: { v2: {
        config: { release: registrations.pathValues.get("fieldPlatform/v2/config/release") },
        workItems: { job_1: item },
        visits: { visit_1: visit },
        projections: {
          unassigned: { job_1: fieldV2TeamProjection({ dueDate: today }) },
          teamActive: { job_1: fieldV2TeamProjection({ dueDate: today }) },
          teamKpis: { current: {
            seoulDate: today,
            todayVisits: 1,
            capturePending: 1,
            uploadFailures: 0,
            reviewPending: 0,
            unassigned: 1,
            overdue: 0,
            adminActionRequired: 0,
            updatedAt: item.updatedAt,
          } },
          teamVisitState: { visit_1: {
            visitId: "visit_1",
            seoulDate: today,
            activeTodayItemCount: 1,
            updatedAt: item.updatedAt,
          } },
        },
      } },
    };

    await callableHandler(entrypoints.claimFieldJob)(validFieldV2Request({
      requestId: "123e4567-e89b-42d3-a456-426614174000",
      jobId: "job_1",
    }));
    let root = registrations.transactionCurrent.value as any;
    expect(root.fieldPlatform.v2.projections.teamKpis.current).toMatchObject({
      seoulDate: today,
      todayVisits: 1,
      capturePending: 1,
      unassigned: 0,
    });
    expect(root.fieldPlatform.v2.projections.operatorKpis.operator_kim.current)
      .toMatchObject({
        operatorId: "operator_kim",
        seoulDate: today,
        todayVisits: 1,
        capturePending: 1,
        unassigned: 0,
      });
    expect(root.fieldPlatform.v2.projections.teamVisitState.visit_1.activeTodayItemCount).toBe(1);

    await callableHandler(entrypoints.transitionFieldJob)(validFieldV2Request({
      requestId: "223e4567-e89b-42d3-a456-426614174000",
      jobId: "job_1",
      toStatus: "cancelled",
      reason: "owner withdrew the request",
    }));
    root = registrations.transactionCurrent.value as any;
    expect(root.fieldPlatform.v2.projections.teamKpis.current).toMatchObject({
      seoulDate: today,
      todayVisits: 0,
      capturePending: 0,
      unassigned: 0,
    });
    expect(root.fieldPlatform.v2.projections.teamVisitState.visit_1).toBeNull();
    expect(root.fieldPlatform.v2.projections.teamActive.job_1).toBeNull();
  });

  it("moves authoritative operator KPIs exactly once across an assignment transfer", async () => {
    seedFieldV2Access();
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const item = fieldV2WorkItem({
      assignedOperatorId: "operator_kim",
      workflowStatus: "assigned",
      dueDate: today,
    });
    const visit = fieldV2Visit({ assignedOperatorId: "operator_kim", dueDate: today });
    const zeroKpis = {
      todayVisits: 0,
      capturePending: 0,
      uploadFailures: 0,
      reviewPending: 0,
      unassigned: 0,
      overdue: 0,
      adminActionRequired: 0,
    };
    registrations.transactionCurrent.value = {
      crmCompany: {
        access: { shared_uid: { enabled: true, role: "member", email: "team@bringcare.kr" } },
        teamProfiles: {
          operator_kim: { active: true, displayName: "김현진" },
          operator_hwang: { active: true, displayName: "황우중" },
        },
      },
      fieldPlatform: { v2: {
        config: { release: registrations.pathValues.get("fieldPlatform/v2/config/release") },
        workItems: { job_1: item },
        visits: { visit_1: visit },
        projections: {
          operatorJobs: { operator_kim: { job_1: fieldV2TeamProjection(item) } },
          teamActive: { job_1: fieldV2TeamProjection(item) },
          teamKpis: { current: {
            seoulDate: today,
            todayVisits: 1,
            capturePending: 1,
            uploadFailures: 0,
            reviewPending: 0,
            unassigned: 0,
            overdue: 0,
            adminActionRequired: 0,
            updatedAt: item.updatedAt,
          } },
          teamVisitState: { visit_1: {
            visitId: "visit_1",
            seoulDate: today,
            activeTodayItemCount: 1,
            updatedAt: item.updatedAt,
          } },
          operatorKpis: {
            operator_kim: { current: {
              operatorId: "operator_kim",
              seoulDate: today,
              todayVisits: 1,
              capturePending: 1,
              uploadFailures: 0,
              reviewPending: 0,
              unassigned: 0,
              overdue: 0,
              adminActionRequired: 0,
              updatedAt: item.updatedAt,
            } },
            operator_hwang: { current: {
              operatorId: "operator_hwang",
              seoulDate: today,
              ...zeroKpis,
              updatedAt: item.updatedAt,
            } },
          },
          operatorVisitState: {
            operator_kim: { visit_1: {
              operatorId: "operator_kim",
              visitId: "visit_1",
              seoulDate: today,
              activeTodayItemCount: 1,
              updatedAt: item.updatedAt,
            } },
          },
        },
      } },
    };
    const request = validFieldV2Request({
      requestId: "333e4567-e89b-42d3-a456-426614174000",
      jobId: "job_1",
      assignedOperatorId: "operator_hwang",
      reason: "현장 일정 조정",
    });

    await expect(callableHandler(entrypoints.assignFieldJob)(request))
      .resolves.toMatchObject({ assignedOperatorId: "operator_hwang" });
    const root = registrations.transactionCurrent.value as any;
    expect(root.fieldPlatform.v2.projections.operatorKpis.operator_kim.current)
      .toMatchObject({ ...zeroKpis, operatorId: "operator_kim", seoulDate: today });
    expect(root.fieldPlatform.v2.projections.operatorKpis.operator_hwang.current)
      .toMatchObject({
        operatorId: "operator_hwang",
        seoulDate: today,
        todayVisits: 1,
        capturePending: 1,
        unassigned: 0,
      });
    expect(root.fieldPlatform.v2.projections.operatorVisitState.operator_kim.visit_1).toBeNull();
    expect(root.fieldPlatform.v2.projections.operatorVisitState.operator_hwang.visit_1)
      .toMatchObject({ activeTodayItemCount: 1 });

    const aggregatesBeforeReplay = structuredClone({
      kpis: root.fieldPlatform.v2.projections.operatorKpis,
      visits: root.fieldPlatform.v2.projections.operatorVisitState,
    });
    registrations.pathValues.set(
      "fieldPlatform/v2/requestReceipts/assignFieldJob/333e4567-e89b-42d3-a456-426614174000",
      root.fieldPlatform.v2.requestReceipts.assignFieldJob[
        "333e4567-e89b-42d3-a456-426614174000"
      ],
    );
    await callableHandler(entrypoints.assignFieldJob)(request);
    expect({
      kpis: root.fieldPlatform.v2.projections.operatorKpis,
      visits: root.fieldPlatform.v2.projections.operatorVisitState,
    }).toEqual(aggregatesBeforeReplay);

    await callableHandler(entrypoints.assignFieldJob)(validFieldV2Request({
      requestId: "633e4567-e89b-42d3-a456-426614174000",
      jobId: "job_1",
      assignedOperatorId: null,
      reason: "미배정 업무함으로 회수",
    }));
    const unassignedProjections = (registrations.transactionCurrent.value as any)
      .fieldPlatform.v2.projections;
    expect(unassignedProjections.operatorKpis.operator_hwang.current)
      .toMatchObject({ ...zeroKpis, operatorId: "operator_hwang", seoulDate: today });
    expect(unassignedProjections.teamKpis.current).toMatchObject({ unassigned: 1 });
  });

  it("keeps one operator visit count when one of two jobs in the visit changes status", async () => {
    seedFieldV2Access();
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const first = fieldV2WorkItem({
      assignedOperatorId: "operator_kim",
      workflowStatus: "assigned",
      dueDate: today,
    });
    const second = fieldV2WorkItem({
      id: "job_2",
      crmSalesUnitId: "sales_unit_2",
      assignedOperatorId: "operator_kim",
      workflowStatus: "assigned",
      dueDate: today,
      sourceSnapshot: {
        ...fieldV2WorkItem().sourceSnapshot,
        unitId: "sales_unit_2",
        unitLabel: "102호",
      },
    });
    registrations.transactionCurrent.value = {
      crmCompany: {
        access: { shared_uid: { enabled: true, role: "member", email: "team@bringcare.kr" } },
        teamProfiles: { operator_kim: { active: true, displayName: "김현진" } },
      },
      fieldPlatform: { v2: {
        config: { release: registrations.pathValues.get("fieldPlatform/v2/config/release") },
        workItems: { job_1: first, job_2: second },
        visits: { visit_1: fieldV2Visit({
          workItemIds: ["job_1", "job_2"],
          assignedOperatorId: "operator_kim",
          dueDate: today,
        }) },
        projections: {
          teamKpis: { current: {
            seoulDate: today,
            todayVisits: 1,
            capturePending: 2,
            uploadFailures: 0,
            reviewPending: 0,
            unassigned: 0,
            overdue: 0,
            adminActionRequired: 0,
            updatedAt: first.updatedAt,
          } },
          teamVisitState: { visit_1: {
            visitId: "visit_1",
            seoulDate: today,
            activeTodayItemCount: 2,
            updatedAt: first.updatedAt,
          } },
          operatorKpis: { operator_kim: { current: {
            operatorId: "operator_kim",
            seoulDate: today,
            todayVisits: 1,
            capturePending: 2,
            uploadFailures: 0,
            reviewPending: 0,
            unassigned: 0,
            overdue: 0,
            adminActionRequired: 0,
            updatedAt: first.updatedAt,
          } } },
          operatorVisitState: { operator_kim: { visit_1: {
            operatorId: "operator_kim",
            visitId: "visit_1",
            seoulDate: today,
            activeTodayItemCount: 2,
            updatedAt: first.updatedAt,
          } } },
        },
      } },
    };

    await callableHandler(entrypoints.transitionFieldJob)(validFieldV2Request({
      requestId: "433e4567-e89b-42d3-a456-426614174000",
      jobId: "job_1",
      toStatus: "accepted",
    }));
    const projections = (registrations.transactionCurrent.value as any)
      .fieldPlatform.v2.projections;
    expect(projections.operatorKpis.operator_kim.current)
      .toMatchObject({ todayVisits: 1, capturePending: 2 });
    expect(projections.operatorVisitState.operator_kim.visit_1)
      .toMatchObject({ activeTodayItemCount: 2 });

    const tomorrow = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(Date.now() + 86_400_000));
    await callableHandler(entrypoints.changeFieldVisit)(validFieldV2Request({
      requestId: "533e4567-e89b-42d3-a456-426614174000",
      visitId: "visit_1",
      dueDate: tomorrow,
      reason: "방문 일정 변경",
    }));
    const changedProjections = (registrations.transactionCurrent.value as any)
      .fieldPlatform.v2.projections;
    expect(changedProjections.operatorKpis.operator_kim.current)
      .toMatchObject({ todayVisits: 0, capturePending: 2 });
    expect(changedProjections.operatorVisitState.operator_kim.visit_1).toBeNull();
  });

  it("atomically rolls a prior-day team aggregate forward on the first mutation after KST midnight", async () => {
    seedFieldV2Access();
    const now = new Date();
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const yesterday = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(now.getTime() - 86_400_000));
    const item = fieldV2WorkItem({ dueDate: today });
    registrations.transactionCurrent.value = {
      crmCompany: {
        access: { shared_uid: { enabled: true, role: "member", email: "team@bringcare.kr" } },
        teamProfiles: { operator_kim: { active: true, displayName: "operator" } },
      },
      fieldPlatform: { v2: {
        config: { release: registrations.pathValues.get("fieldPlatform/v2/config/release") },
        workItems: { job_1: item },
        visits: { visit_1: fieldV2Visit({ dueDate: today }) },
        projections: {
          teamKpis: { current: {
            seoulDate: yesterday,
            todayVisits: 9,
            capturePending: 9,
            uploadFailures: 9,
            reviewPending: 9,
            unassigned: 9,
            overdue: 9,
            adminActionRequired: 9,
            updatedAt: item.updatedAt,
          } },
          teamVisitState: { visit_1: {
            visitId: "visit_1",
            seoulDate: yesterday,
            activeTodayItemCount: 9,
            updatedAt: item.updatedAt,
          } },
          operatorKpis: { operator_kim: { current: {
            operatorId: "operator_kim",
            seoulDate: yesterday,
            todayVisits: 9,
            capturePending: 9,
            uploadFailures: 9,
            reviewPending: 9,
            unassigned: 0,
            overdue: 9,
            adminActionRequired: 9,
            updatedAt: item.updatedAt,
          } } },
          operatorVisitState: { operator_kim: { visit_1: {
            operatorId: "operator_kim",
            visitId: "visit_1",
            seoulDate: yesterday,
            activeTodayItemCount: 9,
            updatedAt: item.updatedAt,
          } } },
        },
      } },
    };

    await expect(callableHandler(entrypoints.claimFieldJob)(validFieldV2Request({
      requestId: "123e4567-e89b-42d3-a456-426614174000",
      jobId: "job_1",
    }))).resolves.toMatchObject({ workflowStatus: "assigned" });
    const aggregate = (registrations.transactionCurrent.value as any)
      .fieldPlatform.v2.projections;
    expect(aggregate.teamKpis.current).toMatchObject({
      seoulDate: today,
      todayVisits: 1,
      capturePending: 1,
      uploadFailures: 0,
      reviewPending: 0,
      unassigned: 0,
      overdue: 0,
      adminActionRequired: 0,
    });
    expect(aggregate.teamVisitState.visit_1).toMatchObject({
      visitId: "visit_1",
      seoulDate: today,
      activeTodayItemCount: 1,
    });
    expect(aggregate.operatorKpis.operator_kim.current).toMatchObject({
      operatorId: "operator_kim",
      seoulDate: today,
      todayVisits: 1,
      capturePending: 1,
      uploadFailures: 0,
      reviewPending: 0,
      unassigned: 0,
      overdue: 0,
      adminActionRequired: 0,
    });
    expect(aggregate.operatorVisitState.operator_kim.visit_1).toMatchObject({
      operatorId: "operator_kim",
      visitId: "visit_1",
      seoulDate: today,
      activeTodayItemCount: 1,
    });
  });

  it("uses transaction-time KST date when a claim crosses midnight after its patch was built", async () => {
    const originalTransaction = registrations.databaseTransaction.getMockImplementation()!;
    vi.useFakeTimers();
    try {
      const beforeMidnight = new Date("2026-08-14T14:59:59.999Z");
      const afterMidnight = new Date("2026-08-14T15:00:00.001Z");
      vi.setSystemTime(beforeMidnight);
      seedFieldV2Access("member");
      const item = fieldV2WorkItem({ dueDate: "2026-08-15" });
      registrations.transactionCurrent.value = {
        crmCompany: {
          access: { shared_uid: { enabled: true, role: "member", email: "team@bringcare.kr" } },
          teamProfiles: { operator_kim: { active: true, displayName: "김현진" } },
        },
        fieldPlatform: { v2: {
          config: { release: registrations.pathValues.get("fieldPlatform/v2/config/release") },
          workItems: { job_1: item },
          visits: { visit_1: fieldV2Visit({ dueDate: "2026-08-15" }) },
          projections: { teamKpis: { current: {
            seoulDate: "2026-08-14",
            todayVisits: 0,
            capturePending: 1,
            uploadFailures: 0,
            reviewPending: 0,
            unassigned: 1,
            overdue: 0,
            adminActionRequired: 0,
            updatedAt: beforeMidnight.toISOString(),
          } } },
        } },
      };
      let rootTransactions = 0;
      registrations.databaseTransaction.mockImplementation(async (...args: any[]) => {
        if (args[3] === "" && ++rootTransactions === 1) vi.setSystemTime(afterMidnight);
        return originalTransaction(...args as Parameters<typeof originalTransaction>);
      });

      await callableHandler(entrypoints.claimFieldJob)(validFieldV2Request({
        requestId: "723e4567-e89b-42d3-a456-426614174000",
        jobId: "job_1",
      }));

      const projections = (registrations.transactionCurrent.value as any)
        .fieldPlatform.v2.projections;
      expect(projections.teamKpis.current).toMatchObject({
        seoulDate: "2026-08-15",
        todayVisits: 1,
        capturePending: 1,
        unassigned: 0,
        updatedAt: afterMidnight.toISOString(),
      });
      expect(projections.operatorKpis.operator_kim.current)
        .toMatchObject({ seoulDate: "2026-08-15", todayVisits: 1 });
    } finally {
      registrations.databaseTransaction.mockImplementation(originalTransaction);
      vi.useRealTimers();
    }
  });

  it("fails closed instead of rolling a future-dated KPI aggregate backward", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-14T01:00:00.000Z"));
      seedFieldV2Access("member");
      const item = fieldV2WorkItem({ dueDate: "2026-08-14" });
      registrations.transactionCurrent.value = {
        crmCompany: {
          access: { shared_uid: { enabled: true, role: "member", email: "team@bringcare.kr" } },
          teamProfiles: { operator_kim: { active: true, displayName: "김현진" } },
        },
        fieldPlatform: { v2: {
          config: { release: registrations.pathValues.get("fieldPlatform/v2/config/release") },
          workItems: { job_1: item },
          visits: { visit_1: fieldV2Visit({ dueDate: "2026-08-14" }) },
          projections: { teamKpis: { current: {
            seoulDate: "2026-08-15",
            todayVisits: 0,
            capturePending: 1,
            uploadFailures: 0,
            reviewPending: 0,
            unassigned: 1,
            overdue: 0,
            adminActionRequired: 0,
            updatedAt: "2026-08-14T15:00:00.000Z",
          } } },
        } },
      };

      await expect(callableHandler(entrypoints.claimFieldJob)(validFieldV2Request({
        requestId: "823e4567-e89b-42d3-a456-426614174000",
        jobId: "job_1",
      }))).rejects.toMatchObject({
        code: "failed-precondition",
        message: "field_kpi_stale",
      });
      expect((registrations.transactionCurrent.value as any)
        .fieldPlatform.v2.workItems.job_1.workflowStatus).toBe("requested");
    } finally {
      vi.useRealTimers();
    }
  });

  it("atomically replays creation before CRM reads but blocks a currently disabled account", async () => {
    seedFieldV2Access();
    const building = {
      id: "building_1",
      name: "building",
      address: "Wonju 1",
      updatedAt: "2026-08-14T01:00:00.000Z",
      archivedAt: null,
    };
    registrations.pathValues.set("crmCompany/data/buildings/building_1", building);
    registrations.transactionCurrent.value = {
      crmCompany: {
        access: { shared_uid: { enabled: true, role: "member", email: "team@bringcare.kr" } },
        teamProfiles: { operator_kim: { active: true, displayName: "operator" } },
        data: { buildings: { building_1: building } },
      },
      fieldPlatform: { v2: {
        config: { release: registrations.pathValues.get("fieldPlatform/v2/config/release") },
      } },
    };
    const request = validFieldV2Request({
      requestId: "123e4567-e89b-42d3-a456-426614174000",
      jobType: "maintenance_inspection",
      crmBuildingId: "building_1",
      dueDate: "2026-08-15",
      priority: "normal",
      assignedOperatorId: null,
    });
    const first = await callableHandler(entrypoints.createFieldJobs)(request) as Record<string, unknown>;

    seedFieldV2Access("viewer", { safeMode: true });
    const root = registrations.transactionCurrent.value as any;
    root.crmCompany.access.shared_uid.role = "viewer";
    root.fieldPlatform.v2.config.release = registrations.pathValues.get("fieldPlatform/v2/config/release");
    registrations.pathValues.delete("crmCompany/data/buildings/building_1");
    registrations.databaseRef.mockClear();
    await expect(callableHandler(entrypoints.createFieldJobs)(request)).resolves.toEqual({
      ...first,
      repeated: true,
    });
    expect(registrations.databaseRef).not.toHaveBeenCalledWith(
      "crmCompany/data/buildings/building_1",
    );

    root.crmCompany.access.shared_uid.enabled = false;
    await expect(callableHandler(entrypoints.createFieldJobs)(request)).rejects.toMatchObject({
      code: "permission-denied",
      message: "field_access_forbidden",
    });
  });

  it("rejects a CRM source archived between preload and the atomic create commit", async () => {
    seedFieldV2Access();
    registrations.pathValues.set("crmCompany/data/buildings/building_1", {
      id: "building_1",
      name: "브링빌",
      address: "강원 원주시 중앙로 1",
      updatedAt: "2026-08-14T01:00:00.000Z",
      archivedAt: null,
    });
    registrations.transactionCurrent.value = {
      crmCompany: {
        access: {
          shared_uid: { enabled: true, role: "member", email: "team@bringcare.kr" },
        },
        teamProfiles: {
          operator_kim: { active: true, displayName: "김현진" },
        },
        data: {
          buildings: {
            building_1: registrations.pathValues.get("crmCompany/data/buildings/building_1"),
          },
        },
      },
      fieldPlatform: {
        v2: {
          config: { release: registrations.pathValues.get("fieldPlatform/v2/config/release") },
        },
      },
    };
    registrations.transactionRetryCurrent.value = {
      crmCompany: {
        access: {
          shared_uid: { enabled: true, role: "member", email: "team@bringcare.kr" },
        },
        teamProfiles: {
          operator_kim: { active: true, displayName: "김현진" },
        },
        data: {
          buildings: {
            building_1: {
              id: "building_1",
              name: "브링빌",
              address: "강원 원주시 중앙로 1",
              updatedAt: "2026-08-14T01:01:00.000Z",
              archivedAt: "2026-08-14T01:01:00.000Z",
            },
          },
        },
      },
      fieldPlatform: {
        v2: {
          config: { release: registrations.pathValues.get("fieldPlatform/v2/config/release") },
        },
      },
    };
    await expect(callableHandler(entrypoints.createFieldJobs)(validFieldV2Request({
      requestId: "123e4567-e89b-42d3-a456-426614174000",
      jobType: "maintenance_inspection",
      crmBuildingId: "building_1",
      dueDate: "2026-08-15",
      priority: "normal",
      assignedOperatorId: null,
    }))).rejects.toMatchObject({
      code: "failed-precondition",
      message: "field_crm_reference_changed",
    });
  });

  it("rejects an atomic same-request receipt race with a different request hash", async () => {
    seedFieldV2Access();
    registrations.pathValues.set("crmCompany/data/buildings/building_1", {
      id: "building_1",
      name: "브링빌",
      address: "강원 원주시 중앙로 1",
      updatedAt: "2026-08-14T01:00:00.000Z",
      archivedAt: null,
    });
    registrations.transactionCurrent.value = {
      crmCompany: {
        access: { shared_uid: { enabled: true, role: "member", email: "team@bringcare.kr" } },
        teamProfiles: { operator_kim: { active: true, displayName: "김현진" } },
        data: { buildings: { building_1: registrations.pathValues.get("crmCompany/data/buildings/building_1") } },
      },
      fieldPlatform: { v2: { config: { release: registrations.pathValues.get("fieldPlatform/v2/config/release") } } },
    };
    registrations.transactionRetryCurrent.value = {
      ...(registrations.transactionCurrent.value as Record<string, unknown>),
      fieldPlatform: {
        v2: {
          config: { release: registrations.pathValues.get("fieldPlatform/v2/config/release") },
          requestReceipts: {
            createFieldJobs: {
              "123e4567-e89b-42d3-a456-426614174000": {
                scope: "createFieldJobs",
                requestId: "123e4567-e89b-42d3-a456-426614174000",
                requestHash: "f".repeat(64),
                result: { visitId: "visit_attacker", jobIds: ["job_attacker"] },
                createdAt: "2026-08-14T01:01:00.000Z",
              },
            },
          },
        },
      },
    };
    await expect(callableHandler(entrypoints.createFieldJobs)(validFieldV2Request({
      requestId: "123e4567-e89b-42d3-a456-426614174000",
      jobType: "maintenance_inspection",
      crmBuildingId: "building_1",
      dueDate: "2026-08-15",
      priority: "normal",
      assignedOperatorId: null,
    }))).rejects.toMatchObject({
      code: "already-exists",
      message: "field_request_id_conflict",
    });
  });

  it("fails closed when a malformed same-hash receipt wins between preflight and transaction", async () => {
    seedFieldV2Access();
    const root = {
      crmCompany: {
        access: { shared_uid: { enabled: true, role: "member", email: "team@bringcare.kr" } },
        teamProfiles: { operator_kim: { active: true, displayName: "김현진" } },
      },
      fieldPlatform: { v2: {
        config: { release: registrations.pathValues.get("fieldPlatform/v2/config/release") },
        workItems: { job_1: fieldV2WorkItem() },
        visits: { visit_1: fieldV2Visit() },
      } },
    };
    const request = validFieldV2Request({
      requestId: "123e4567-e89b-42d3-a456-426614174000",
      jobId: "job_1",
    });
    registrations.transactionCurrent.value = structuredClone(root);
    await callableHandler(entrypoints.claimFieldJob)(request);
    const validReceipt = (registrations.transactionCurrent.value as any)
      .fieldPlatform.v2.requestReceipts.claimFieldJob[
        "123e4567-e89b-42d3-a456-426614174000"
      ];

    registrations.transactionCurrent.value = structuredClone(root);
    registrations.transactionRetryCurrent.value = {
      ...structuredClone(root),
      fieldPlatform: { v2: {
        ...(structuredClone(root) as any).fieldPlatform.v2,
        requestReceipts: { claimFieldJob: {
          "123e4567-e89b-42d3-a456-426614174000": {
            ...validReceipt,
            result: { arbitrary: true },
          },
        } },
      } },
    };
    registrations.pathValues.delete(
      "fieldPlatform/v2/requestReceipts/claimFieldJob/123e4567-e89b-42d3-a456-426614174000",
    );

    await expect(callableHandler(entrypoints.claimFieldJob)(request))
      .rejects.toMatchObject({
        code: "failed-precondition",
        message: "field_request_receipt_invalid",
    });
  });

  it("rejects a malformed operation result in a preliminary exact receipt", async () => {
    seedFieldV2Access();
    const root = {
      crmCompany: {
        access: { shared_uid: { enabled: true, role: "member", email: "team@bringcare.kr" } },
        teamProfiles: { operator_kim: { active: true, displayName: "김현진" } },
      },
      fieldPlatform: { v2: {
        config: { release: registrations.pathValues.get("fieldPlatform/v2/config/release") },
        workItems: { job_1: fieldV2WorkItem() },
        visits: { visit_1: fieldV2Visit() },
      } },
    };
    const request = validFieldV2Request({
      requestId: "123e4567-e89b-42d3-a456-426614174000",
      jobId: "job_1",
    });
    registrations.transactionCurrent.value = structuredClone(root);
    await callableHandler(entrypoints.claimFieldJob)(request);
    const receipt = (registrations.transactionCurrent.value as any)
      .fieldPlatform.v2.requestReceipts.claimFieldJob[
        "123e4567-e89b-42d3-a456-426614174000"
      ];
    registrations.pathValues.set(
      "fieldPlatform/v2/requestReceipts/claimFieldJob/123e4567-e89b-42d3-a456-426614174000",
      { ...receipt, result: { arbitrary: true } },
    );
    registrations.transactionCurrent.value = structuredClone(root);

    await expect(callableHandler(entrypoints.claimFieldJob)(request))
      .rejects.toMatchObject({
        code: "failed-precondition",
        message: "field_request_receipt_invalid",
      });
    expect(registrations.transactionCurrent.value).toEqual(root);
  });

  it("replays an old claim receipt without rolling a newer accepted item backward", async () => {
    seedFieldV2Access();
    registrations.transactionCurrent.value = {
      crmCompany: {
        access: {
          shared_uid: { enabled: true, role: "member", email: "team@bringcare.kr" },
        },
        teamProfiles: { operator_kim: { active: true, displayName: "김현진" } },
      },
      fieldPlatform: { v2: {
        config: { release: registrations.pathValues.get("fieldPlatform/v2/config/release") },
        workItems: { job_1: fieldV2WorkItem() },
        visits: { visit_1: fieldV2Visit() },
      } },
    };
    const request = validFieldV2Request({
      requestId: "123e4567-e89b-42d3-a456-426614174000",
      jobId: "job_1",
    });
    const first = await callableHandler(entrypoints.claimFieldJob)(request) as Record<string, unknown>;
    expect(first.workflowStatus).toBe("assigned");

    const root = registrations.transactionCurrent.value as any;
    const receipt = root.fieldPlatform.v2.requestReceipts.claimFieldJob[
      "123e4567-e89b-42d3-a456-426614174000"
    ];
    const accepted = {
      ...root.fieldPlatform.v2.workItems.job_1,
      workflowStatus: "accepted",
      acceptedAt: "2026-08-14T02:05:00.000Z",
      updatedAt: "2026-08-14T02:05:00.000Z",
    };
    root.fieldPlatform.v2.workItems.job_1 = accepted;
    registrations.pathValues.set(
      "fieldPlatform/v2/requestReceipts/claimFieldJob/123e4567-e89b-42d3-a456-426614174000",
      receipt,
    );
    seedFieldV2Access("member", { safeMode: true, minPwaVersion: "9.0.0" });
    const mutationsBeforeReplay = registrations.mutationPaths.length;

    await expect(callableHandler(entrypoints.claimFieldJob)(request))
      .resolves.toMatchObject({ workflowStatus: "assigned" });
    expect(root.fieldPlatform.v2.workItems.job_1.workflowStatus).toBe("accepted");
    expect(registrations.mutationPaths).toHaveLength(mutationsBeforeReplay);
  });

  it.each([
    ["disabled access", { enabled: false, role: "member", email: "team@bringcare.kr" }, true],
    ["email mismatch", { enabled: true, role: "member", email: "other@bringcare.kr" }, true],
    ["viewer role", { enabled: true, role: "viewer", email: "team@bringcare.kr" }, false],
  ] as const)("checks current account state before exact replay with %s", async (
    _label,
    currentAccess,
    shouldReject,
  ) => {
    seedFieldV2Access("member");
    registrations.transactionCurrent.value = {
      crmCompany: {
        access: {
          shared_uid: { enabled: true, role: "member", email: "team@bringcare.kr" },
        },
        teamProfiles: { operator_kim: { active: true, displayName: "김현진" } },
      },
      fieldPlatform: { v2: {
        config: { release: registrations.pathValues.get("fieldPlatform/v2/config/release") },
        workItems: { job_1: fieldV2WorkItem() },
        visits: { visit_1: fieldV2Visit() },
      } },
    };
    const request = validFieldV2Request({
      requestId: "123e4567-e89b-42d3-a456-426614174000",
      jobId: "job_1",
    });
    await callableHandler(entrypoints.claimFieldJob)(request);
    const receipt = (registrations.transactionCurrent.value as any)
      .fieldPlatform.v2.requestReceipts.claimFieldJob[
        "123e4567-e89b-42d3-a456-426614174000"
      ];
    registrations.pathValues.set(
      "fieldPlatform/v2/requestReceipts/claimFieldJob/123e4567-e89b-42d3-a456-426614174000",
      receipt,
    );
    registrations.transactionCurrent.value = {
      crmCompany: {
        access: { shared_uid: currentAccess },
        teamProfiles: { operator_kim: { active: true, displayName: "김현진" } },
      },
      fieldPlatform: { v2: {
        config: { release: registrations.pathValues.get("fieldPlatform/v2/config/release") },
        requestReceipts: { claimFieldJob: {
          "123e4567-e89b-42d3-a456-426614174000": receipt,
        } },
      } },
    };
    seedFieldV2Access("member", { safeMode: true });

    const promise = callableHandler(entrypoints.claimFieldJob)(request);
    if (shouldReject) {
      await expect(promise).rejects.toMatchObject({
        code: "permission-denied",
        message: "field_access_forbidden",
      });
    } else {
      await expect(promise).resolves.toMatchObject({ workflowStatus: "assigned" });
    }
  });

  it.each([
    ["safe mode enabled", { role: "member", safeMode: true }, "field_safe_mode_read_only"],
    ["access downgraded", { role: "viewer", safeMode: false }, "field_mutation_forbidden"],
    ["operator disabled", { role: "member", safeMode: false, active: false }, "field_operator_inactive"],
  ] as const)("revalidates current root mutation authority when %s after preflight", async (
    _label,
    changed,
    expectedCode,
  ) => {
    seedFieldV2Access("member");
    const release = {
      ...(registrations.pathValues.get("fieldPlatform/v2/config/release") as Record<string, unknown>),
      safeMode: changed.safeMode,
    };
    registrations.transactionCurrent.value = {
      crmCompany: {
        access: {
          shared_uid: {
            enabled: true,
            role: changed.role,
            email: "team@bringcare.kr",
          },
        },
        teamProfiles: {
          operator_kim: {
            active: "active" in changed ? changed.active : true,
            displayName: "김현진",
          },
        },
      },
      fieldPlatform: { v2: {
        config: { release },
        workItems: { job_1: fieldV2WorkItem() },
        visits: { visit_1: fieldV2Visit() },
      } },
    };

    await expect(callableHandler(entrypoints.claimFieldJob)(validFieldV2Request({
      requestId: "123e4567-e89b-42d3-a456-426614174000",
      jobId: "job_1",
    }))).rejects.toMatchObject({ message: expectedCode });
    expect((registrations.transactionCurrent.value as any)
      .fieldPlatform.v2.workItems.job_1.workflowStatus).toBe("requested");
  });

  it("uses the current root release instead of a stale preflight safe-mode snapshot", async () => {
    seedFieldV2Access("member", { safeMode: true });
    const currentRelease = {
      ...(registrations.pathValues.get("fieldPlatform/v2/config/release") as Record<string, unknown>),
      safeMode: false,
    };
    registrations.transactionCurrent.value = {
      crmCompany: {
        access: { shared_uid: { enabled: true, role: "member", email: "team@bringcare.kr" } },
        teamProfiles: { operator_kim: { active: true, displayName: "operator" } },
      },
      fieldPlatform: { v2: {
        config: { release: currentRelease },
        workItems: { job_1: fieldV2WorkItem() },
        visits: { visit_1: fieldV2Visit() },
      } },
    };

    await expect(callableHandler(entrypoints.claimFieldJob)(validFieldV2Request({
      requestId: "123e4567-e89b-42d3-a456-426614174000",
      jobId: "job_1",
    }))).resolves.toMatchObject({ workflowStatus: "assigned" });
  });

  it("fails closed for viewer mutation and safe mode without committing root writes", async () => {
    const data = {
      requestId: "123e4567-e89b-42d3-a456-426614174000",
      jobType: "maintenance_inspection",
      crmBuildingId: "building_1",
      dueDate: "2026-08-15",
      priority: "normal",
      assignedOperatorId: null,
    };
    seedFieldV2Access("viewer");
    await expect(callableHandler(entrypoints.createFieldJobs)(validFieldV2Request(data)))
      .rejects.toMatchObject({ code: "permission-denied", message: "field_mutation_forbidden" });
    expect(registrations.transactionPaths).toContain("");
    expect(registrations.transactionCurrent.value).toBeNull();

    registrations.pathValues.clear();
    registrations.transactionPaths.length = 0;
    seedFieldV2Access("member", { safeMode: true });
    registrations.pathValues.set("crmCompany/data/buildings/building_1", {
      id: "building_1",
      name: "브링빌",
      address: "강원 원주시 중앙로 1",
      updatedAt: "2026-08-14T01:00:00.000Z",
      archivedAt: null,
    });
    registrations.transactionCurrent.value = {
      crmCompany: {
        access: { shared_uid: { enabled: true, role: "member", email: "team@bringcare.kr" } },
        teamProfiles: { operator_kim: { active: true, displayName: "operator" } },
        data: { buildings: {
          building_1: registrations.pathValues.get("crmCompany/data/buildings/building_1"),
        } },
      },
      fieldPlatform: { v2: {
        config: { release: registrations.pathValues.get("fieldPlatform/v2/config/release") },
      } },
    };
    const safeRoot = structuredClone(registrations.transactionCurrent.value);
    await expect(callableHandler(entrypoints.createFieldJobs)(validFieldV2Request(data)))
      .rejects.toMatchObject({ code: "failed-precondition", message: "field_safe_mode_read_only" });
    expect(registrations.transactionPaths).toContain("");
    expect(registrations.transactionCurrent.value).toEqual(safeRoot);
  });

  it("does not trust payload identity when the authenticated email is wrong", async () => {
    seedFieldV2Access();
    const request = validFieldV2Request({
      requestId: "123e4567-e89b-42d3-a456-426614174000",
      jobType: "maintenance_inspection",
      crmBuildingId: "building_1",
      dueDate: "2026-08-15",
      priority: "normal",
      assignedOperatorId: null,
      authUid: "shared_uid",
      email: "team@bringcare.kr",
    });
    request.auth.token.email = "wrong@example.com";
    await expect(callableHandler(entrypoints.createFieldJobs)(request))
      .rejects.toMatchObject({ code: "permission-denied", message: "field_access_forbidden" });
  });

  it("maps malformed authoritative CRM records to a stable invalid-argument error", async () => {
    seedFieldV2Access();
    registrations.pathValues.set("crmCompany/data/buildings/building_1", {
      id: "building_1",
      name: "x".repeat(513),
      address: "강원 원주시",
      updatedAt: "2026-08-14T01:00:00.000Z",
      archivedAt: null,
    });
    await expect(callableHandler(entrypoints.createFieldJobs)(validFieldV2Request({
      requestId: "123e4567-e89b-42d3-a456-426614174000",
      jobType: "maintenance_inspection",
      crmBuildingId: "building_1",
      dueDate: "2026-08-15",
      priority: "normal",
      assignedOperatorId: null,
    }))).rejects.toMatchObject({
      code: "invalid-argument",
      message: "field_crm_reference_invalid",
    });
  });

  it("lets a viewer read only the operator workspace and never queries unassigned", async () => {
    seedFieldV2Access("viewer");
    seedFieldV2WorkspaceRoot("viewer");
    await expect(callableHandler(entrypoints.listFieldOperationsWorkspace)(
      validFieldV2Request({}),
    )).resolves.toEqual({
      items: [],
      kpis: {
        todayVisits: 0,
        capturePending: 0,
        uploadFailures: 0,
        reviewPending: 0,
        unassigned: 0,
        overdue: 0,
        adminActionRequired: 0,
      },
      scope: "personal",
      nextCursor: null,
    });
    expect(registrations.databaseRef).not.toHaveBeenCalledWith(
      "fieldPlatform/v2/projections/unassigned",
    );
    expect(registrations.databaseRef).not.toHaveBeenCalledWith(
      "fieldPlatform/v2/projections/operatorKpis/operator_kim/current",
    );
    expect(registrations.databaseRef).not.toHaveBeenCalledWith(
      "fieldPlatform/v2/projections/teamKpis/current",
    );
    expect(registrations.transactionPaths).toContain("");
  });

  it("keeps a nonzero personal KPI when a bounded stale page is empty but resumable", async () => {
    seedFieldV2Access("viewer");
    const staleProjections: Record<string, unknown> = {};
    for (let number = 1; number <= 3; number += 1) {
      const id = `stale_${number}`;
      staleProjections[id] = {
        fieldJobId: id,
        updatedAt: `2026-08-14T0${number}:00:00.000Z`,
      };
      registrations.pathValues.set(`fieldPlatform/v2/workItems/${id}`, fieldV2WorkItem({
        id,
        visitId: `visit_${id}`,
        assignedOperatorId: "operator_hwang",
        workflowStatus: "assigned",
      }));
    }
    registrations.pathValues.set(
      "fieldPlatform/v2/projections/operatorJobs/operator_kim",
      staleProjections,
    );
    const authoritativeItem = fieldV2WorkItem({
      id: "authoritative_job",
      visitId: "visit_authoritative",
      assignedOperatorId: "operator_kim",
      workflowStatus: "assigned",
      dueDate: "2099-01-01",
    });
    seedFieldV2WorkspaceRoot("viewer", {
      workItems: { authoritative_job: authoritativeItem },
    });

    const workspace = await callableHandler(entrypoints.listFieldOperationsWorkspace)(
      validFieldV2Request({ limit: 1 }),
    ) as { items: unknown[]; nextCursor: string | null; kpis: Record<string, number> };
    expect(workspace.items).toEqual([]);
    expect(workspace.nextCursor).toEqual(expect.any(String));
    expect(workspace.kpis).toMatchObject({
      todayVisits: 0,
      capturePending: 1,
      overdue: 0,
    });
  });

  it("rebuilds a selected operator's stale KPI on the first read after KST midnight", async () => {
    seedFieldV2Access("viewer");
    const now = new Date();
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const yesterday = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(now.getTime() - 86_400_000));
    const item = fieldV2WorkItem({
      assignedOperatorId: "operator_kim",
      workflowStatus: "assigned",
      dueDate: today,
    });
    const staleKpis = {
      operatorId: "operator_kim",
      seoulDate: yesterday,
      todayVisits: 0,
      capturePending: 1,
      uploadFailures: 0,
      reviewPending: 0,
      unassigned: 0,
      overdue: 0,
      adminActionRequired: 0,
      updatedAt: item.updatedAt,
    };
    registrations.pathValues.set("fieldPlatform/v2/projections/operatorJobs/operator_kim", {
      job_1: { fieldJobId: "job_1", updatedAt: item.updatedAt },
    });
    registrations.pathValues.set("fieldPlatform/v2/workItems/job_1", item);
    registrations.pathValues.set(
      "fieldPlatform/v2/projections/operatorKpis/operator_kim/current",
      staleKpis,
    );
    registrations.transactionCurrent.value = {
      crmCompany: {
        access: { shared_uid: { enabled: true, role: "viewer", email: "team@bringcare.kr" } },
        teamProfiles: { operator_kim: { active: true, displayName: "김현진" } },
      },
      fieldPlatform: { v2: {
        config: { release: registrations.pathValues.get("fieldPlatform/v2/config/release") },
        workItems: { job_1: item },
        projections: { operatorKpis: { operator_kim: { current: staleKpis } } },
      } },
    };

    await expect(callableHandler(entrypoints.listFieldOperationsWorkspace)(
      validFieldV2Request({ limit: 10 }),
    )).resolves.toMatchObject({
      kpis: {
        todayVisits: 1,
        capturePending: 1,
        unassigned: 0,
      },
    });
    expect((registrations.transactionCurrent.value as any)
      .fieldPlatform.v2.projections.operatorKpis.operator_kim.current)
      .toMatchObject({ operatorId: "operator_kim", seoulDate: today, todayVisits: 1 });
  });

  it("does not roll an already-current KPI backward when a read crosses KST midnight", async () => {
    vi.useFakeTimers();
    try {
      const beforeMidnight = new Date("2026-08-14T14:59:59.999Z");
      const afterMidnight = new Date("2026-08-14T15:00:00.001Z");
      vi.setSystemTime(beforeMidnight);
      seedFieldV2Access("viewer");
      const aggregate = {
        operatorId: "operator_kim",
        seoulDate: "2026-08-15",
        todayVisits: 0,
        capturePending: 0,
        uploadFailures: 0,
        reviewPending: 0,
        unassigned: 0,
        overdue: 0,
        adminActionRequired: 0,
        updatedAt: afterMidnight.toISOString(),
      };
      seedFieldV2WorkspaceRoot("viewer", {
        projections: {
          operatorKpis: { operator_kim: { current: aggregate } },
        },
      });
      const snapshot = (value: unknown) => ({
        val: () => value,
        exists: () => value !== null && value !== undefined,
      });
      registrations.databaseGet
        .mockImplementationOnce(async () => snapshot({
          enabled: true,
          role: "viewer",
          email: "team@bringcare.kr",
        }))
        .mockImplementationOnce(async () => snapshot({
          active: true,
          displayName: "김현진",
        }))
        .mockImplementationOnce(async () => {
          const release = registrations.pathValues.get("fieldPlatform/v2/config/release");
          vi.setSystemTime(afterMidnight);
          return snapshot(release);
        });

      await expect(callableHandler(entrypoints.listFieldOperationsWorkspace)(
        validFieldV2Request({}),
      )).resolves.toMatchObject({
        kpis: { todayVisits: 0, capturePending: 0, unassigned: 0 },
      });
      expect(registrations.transactionPaths).toContain("");
      expect((registrations.transactionCurrent.value as any)
        .fieldPlatform.v2.projections.operatorKpis.operator_kim.current.seoulDate)
        .toBe("2026-08-15");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rebuilds stale operator and team KPIs together for a member after KST midnight", async () => {
    seedFieldV2Access("member");
    const now = new Date();
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const yesterday = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(now.getTime() - 86_400_000));
    const assigned = fieldV2WorkItem({
      assignedOperatorId: "operator_kim",
      workflowStatus: "assigned",
      dueDate: today,
    });
    const unassigned = fieldV2WorkItem({
      id: "job_2",
      crmSalesUnitId: "sales_unit_2",
      dueDate: today,
      sourceSnapshot: {
        ...fieldV2WorkItem().sourceSnapshot,
        unitId: "sales_unit_2",
        unitLabel: "102호",
      },
    });
    const zeroKpis = {
      todayVisits: 0,
      capturePending: 0,
      uploadFailures: 0,
      reviewPending: 0,
      unassigned: 0,
      overdue: 0,
      adminActionRequired: 0,
    };
    const staleOperatorKpis = {
      operatorId: "operator_kim",
      seoulDate: yesterday,
      ...zeroKpis,
      updatedAt: assigned.updatedAt,
    };
    const staleTeamKpis = {
      seoulDate: yesterday,
      ...zeroKpis,
      updatedAt: assigned.updatedAt,
    };
    registrations.pathValues.set("fieldPlatform/v2/projections/operatorJobs/operator_kim", {
      job_1: { fieldJobId: "job_1", updatedAt: assigned.updatedAt },
    });
    registrations.pathValues.set("fieldPlatform/v2/projections/unassigned", {
      job_2: { fieldJobId: "job_2", updatedAt: unassigned.updatedAt },
    });
    registrations.pathValues.set("fieldPlatform/v2/workItems/job_1", assigned);
    registrations.pathValues.set("fieldPlatform/v2/workItems/job_2", unassigned);
    registrations.pathValues.set(
      "fieldPlatform/v2/projections/operatorKpis/operator_kim/current",
      staleOperatorKpis,
    );
    registrations.pathValues.set("fieldPlatform/v2/projections/teamKpis/current", staleTeamKpis);
    registrations.transactionCurrent.value = {
      crmCompany: {
        access: { shared_uid: { enabled: true, role: "member", email: "team@bringcare.kr" } },
        teamProfiles: { operator_kim: { active: true, displayName: "김현진" } },
      },
      fieldPlatform: { v2: {
        config: { release: registrations.pathValues.get("fieldPlatform/v2/config/release") },
        workItems: { job_1: assigned, job_2: unassigned },
        projections: {
          operatorKpis: { operator_kim: { current: staleOperatorKpis } },
          teamKpis: { current: staleTeamKpis },
        },
      } },
    };

    await expect(callableHandler(entrypoints.listFieldOperationsWorkspace)(
      validFieldV2Request({ limit: 10 }),
    )).resolves.toMatchObject({
      kpis: {
        todayVisits: 1,
        capturePending: 1,
        unassigned: 1,
      },
    });
    const projections = (registrations.transactionCurrent.value as any)
      .fieldPlatform.v2.projections;
    expect(projections.operatorKpis.operator_kim.current)
      .toMatchObject({ seoulDate: today, todayVisits: 1, capturePending: 1 });
    expect(projections.teamKpis.current)
      .toMatchObject({ seoulDate: today, todayVisits: 1, capturePending: 2, unassigned: 1 });
  });

  it("retries a torn operator/team KPI read and returns one root-atomic snapshot", async () => {
    seedFieldV2Access("member");
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const item = fieldV2WorkItem({
      assignedOperatorId: "operator_kim",
      workflowStatus: "assigned",
      dueDate: "2099-01-01",
    });
    const operatorAfter = {
      operatorId: "operator_kim",
      seoulDate: today,
      todayVisits: 0,
      capturePending: 1,
      uploadFailures: 0,
      reviewPending: 0,
      unassigned: 0,
      overdue: 0,
      adminActionRequired: 0,
      updatedAt: "2026-08-14T02:00:00.000Z",
    };
    const teamBefore = {
      seoulDate: today,
      todayVisits: 0,
      capturePending: 1,
      uploadFailures: 0,
      reviewPending: 0,
      unassigned: 1,
      overdue: 0,
      adminActionRequired: 0,
      updatedAt: "2026-08-14T01:00:00.000Z",
    };
    const teamAfter = { ...teamBefore, unassigned: 0, updatedAt: operatorAfter.updatedAt };
    registrations.readSequences.set(
      "fieldPlatform/v2/projections/operatorKpis/operator_kim/current",
      [operatorAfter, operatorAfter],
    );
    registrations.readSequences.set(
      "fieldPlatform/v2/projections/teamKpis/current",
      [teamBefore, teamAfter],
    );
    registrations.pathValues.set("fieldPlatform/v2/projections/operatorJobs/operator_kim", {
      job_1: { fieldJobId: "job_1", updatedAt: item.updatedAt },
    });
    registrations.pathValues.set("fieldPlatform/v2/workItems/job_1", item);
    registrations.transactionCurrent.value = {
      crmCompany: {
        access: { shared_uid: { enabled: true, role: "member", email: "team@bringcare.kr" } },
        teamProfiles: { operator_kim: { active: true, displayName: "김현진" } },
      },
      fieldPlatform: { v2: {
        config: { release: registrations.pathValues.get("fieldPlatform/v2/config/release") },
        workItems: { job_1: item },
        projections: {
          operatorKpis: { operator_kim: { current: operatorAfter } },
          teamKpis: { current: teamAfter },
        },
      } },
    };

    await expect(callableHandler(entrypoints.listFieldOperationsWorkspace)(
      validFieldV2Request({}),
    )).resolves.toMatchObject({
      kpis: { capturePending: 1, unassigned: 0 },
    });
    expect(registrations.transactionPaths).toContain("");
  });

  it("treats the bounded page as an independent read-committed view, never as a KPI source", async () => {
    seedFieldV2Access("viewer");
    const laterItem = fieldV2WorkItem({
      assignedOperatorId: "operator_kim",
      workflowStatus: "assigned",
      dueDate: "2099-01-01",
    });
    registrations.pathValues.set("fieldPlatform/v2/projections/operatorJobs/operator_kim", {
      job_1: { fieldJobId: "job_1", updatedAt: laterItem.updatedAt },
    });
    registrations.pathValues.set("fieldPlatform/v2/workItems/job_1", laterItem);
    seedFieldV2WorkspaceRoot("viewer", { workItems: {} });

    const workspace = await callableHandler(entrypoints.listFieldOperationsWorkspace)(
      validFieldV2Request({ limit: 10 }),
    );

    expect(workspace.items).toHaveLength(1);
    expect(workspace.kpis).toMatchObject({ capturePending: 0, unassigned: 0 });
    expect(registrations.transactionPaths).toContain("");
  });

  it("initializes an authoritative zero KPI for a selected operator with no assignments", async () => {
    seedFieldV2Access("viewer");
    registrations.pathValues.delete(
      "fieldPlatform/v2/projections/operatorKpis/operator_kim/current",
    );
    registrations.transactionCurrent.value = {
      crmCompany: {
        access: { shared_uid: { enabled: true, role: "viewer", email: "team@bringcare.kr" } },
        teamProfiles: { operator_kim: { active: true, displayName: "김현진" } },
      },
      fieldPlatform: { v2: {
        config: { release: registrations.pathValues.get("fieldPlatform/v2/config/release") },
        workItems: {},
        projections: {},
      } },
    };

    await expect(callableHandler(entrypoints.listFieldOperationsWorkspace)(
      validFieldV2Request({}),
    )).resolves.toMatchObject({
      kpis: {
        todayVisits: 0,
        capturePending: 0,
        uploadFailures: 0,
        reviewPending: 0,
        unassigned: 0,
        overdue: 0,
        adminActionRequired: 0,
      },
    });
    expect((registrations.transactionCurrent.value as any)
      .fieldPlatform.v2.projections.operatorKpis.operator_kim.current)
      .toMatchObject({ operatorId: "operator_kim", todayVisits: 0, unassigned: 0 });
  });

  it("returns one authoritative personal KPI snapshot unchanged across pages", async () => {
    seedFieldV2Access("viewer");
    registrations.pathValues.set("fieldPlatform/v2/projections/operatorJobs/operator_kim", {
      job_1: { fieldJobId: "job_1", updatedAt: "2026-08-14T01:00:00.000Z" },
      job_2: { fieldJobId: "job_2", updatedAt: "2026-08-14T02:00:00.000Z" },
    });
    registrations.pathValues.set("fieldPlatform/v2/workItems/job_1", fieldV2WorkItem({
      id: "job_1",
      visitId: "visit_1",
      assignedOperatorId: "operator_kim",
      workflowStatus: "assigned",
      dueDate: "2099-01-01",
    }));
    registrations.pathValues.set("fieldPlatform/v2/workItems/job_2", fieldV2WorkItem({
      id: "job_2",
      visitId: "visit_2",
      assignedOperatorId: "operator_kim",
      workflowStatus: "assigned",
      dueDate: "2099-01-01",
      sourceSnapshot: {
        ...fieldV2WorkItem().sourceSnapshot,
        unitId: "sales_unit_2",
        unitLabel: "102호",
      },
      crmSalesUnitId: "sales_unit_2",
    }));
    seedFieldV2WorkspaceRoot("viewer");

    const first = await callableHandler(entrypoints.listFieldOperationsWorkspace)(
      validFieldV2Request({ limit: 1 }),
    ) as { kpis: Record<string, number>; nextCursor: string };
    const second = await callableHandler(entrypoints.listFieldOperationsWorkspace)(
      validFieldV2Request({ limit: 1, cursor: first.nextCursor }),
    ) as { kpis: Record<string, number> };
    expect(first.kpis).toEqual(second.kpis);
    expect(first.kpis).toMatchObject({
      todayVisits: 0,
      capturePending: 2,
      uploadFailures: 0,
    });
  });

  it("defines member personal KPIs as selected-operator workload plus the team unassigned count", async () => {
    seedFieldV2Access("member");
    const assigned = fieldV2WorkItem({
      id: "assigned_job",
      visitId: "visit_assigned",
      assignedOperatorId: "operator_kim",
      workflowStatus: "assigned",
      dueDate: "2099-01-01",
    });
    const unassigned = fieldV2WorkItem({
      id: "unassigned_job",
      visitId: "visit_unassigned",
      assignedOperatorId: null,
      workflowStatus: "requested",
      dueDate: "2099-01-01",
    });
    seedFieldV2WorkspaceRoot("member", {
      workItems: { assigned_job: assigned, unassigned_job: unassigned },
    });

    await expect(callableHandler(entrypoints.listFieldOperationsWorkspace)(
      validFieldV2Request({ limit: 10 }),
    )).resolves.toMatchObject({
      kpis: {
        todayVisits: 0,
        capturePending: 1,
        uploadFailures: 0,
        reviewPending: 0,
        unassigned: 1,
        overdue: 0,
        adminActionRequired: 0,
      },
    });
  });

  it("fails closed when the authoritative personal KPI is malformed", async () => {
    seedFieldV2Access("viewer");
    const aggregate = registrations.pathValues.get(
      "fieldPlatform/v2/projections/operatorKpis/operator_kim/current",
    ) as Record<string, unknown>;
    const malformed = { ...aggregate, overdue: -1 };
    registrations.pathValues.set(
      "fieldPlatform/v2/projections/operatorKpis/operator_kim/current",
      malformed,
    );
    registrations.transactionCurrent.value = {
      crmCompany: {
        access: { shared_uid: { enabled: true, role: "viewer", email: "team@bringcare.kr" } },
        teamProfiles: { operator_kim: { active: true, displayName: "김현진" } },
      },
      fieldPlatform: { v2: {
        config: { release: registrations.pathValues.get("fieldPlatform/v2/config/release") },
        workItems: {},
        projections: { operatorKpis: { operator_kim: { current: malformed } } },
      } },
    };
    await expect(callableHandler(entrypoints.listFieldOperationsWorkspace)(
      validFieldV2Request({}),
    )).rejects.toMatchObject({
      code: "failed-precondition",
      message: "field_kpi_stale",
    });
  });

  it("fails closed when an otherwise valid personal KPI contains an unknown field", async () => {
    seedFieldV2Access("viewer");
    const aggregate = {
      ...(registrations.pathValues.get(
        "fieldPlatform/v2/projections/operatorKpis/operator_kim/current",
      ) as Record<string, unknown>),
      unexpected: true,
    };
    registrations.pathValues.set(
      "fieldPlatform/v2/projections/operatorKpis/operator_kim/current",
      aggregate,
    );
    registrations.transactionCurrent.value = {
      crmCompany: {
        access: { shared_uid: { enabled: true, role: "viewer", email: "team@bringcare.kr" } },
        teamProfiles: { operator_kim: { active: true, displayName: "김현진" } },
      },
      fieldPlatform: { v2: {
        config: { release: registrations.pathValues.get("fieldPlatform/v2/config/release") },
        workItems: {},
        projections: { operatorKpis: { operator_kim: { current: aggregate } } },
      } },
    };

    await expect(callableHandler(entrypoints.listFieldOperationsWorkspace)(
      validFieldV2Request({}),
    )).rejects.toMatchObject({
      code: "failed-precondition",
      message: "field_kpi_stale",
    });
  });

  it.each([
    ["email changed", {
      access: { enabled: true, role: "viewer", email: "other@bringcare.kr" },
      profile: { active: true, displayName: "김현진" },
      release: {},
    }],
    ["profile disabled", {
      access: { enabled: true, role: "viewer", email: "team@bringcare.kr" },
      profile: { active: false, displayName: "김현진" },
      release: {},
    }],
    ["operator removed from release", {
      access: { enabled: true, role: "viewer", email: "team@bringcare.kr" },
      profile: { active: true, displayName: "김현진" },
      release: { enabledOperatorIds: ["operator_hwang"] },
    }],
  ] as const)("revalidates personal workspace authority when %s after preflight", async (
    _label,
    changed,
  ) => {
    seedFieldV2Access("viewer");
    const release = {
      ...(registrations.pathValues.get("fieldPlatform/v2/config/release") as Record<string, unknown>),
      ...changed.release,
    };
    registrations.transactionCurrent.value = {
      crmCompany: {
        access: { shared_uid: changed.access },
        teamProfiles: { operator_kim: changed.profile },
      },
      fieldPlatform: { v2: {
        config: { release },
        workItems: {},
        projections: { operatorKpis: { operator_kim: { current:
          registrations.pathValues.get(
            "fieldPlatform/v2/projections/operatorKpis/operator_kim/current",
          ) } } },
      } },
    };

    await expect(callableHandler(entrypoints.listFieldOperationsWorkspace)(
      validFieldV2Request({}),
    )).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("lets a member combine mine and unassigned while filtering stale reassigned projections", async () => {
    seedFieldV2Access("member");
    registrations.pathValues.set("fieldPlatform/v2/projections/operatorJobs/operator_kim", {
      stale_job: { fieldJobId: "stale_job", updatedAt: "2026-08-14T01:00:00.000Z" },
    });
    registrations.pathValues.set("fieldPlatform/v2/projections/unassigned", {
      free_job: { fieldJobId: "free_job", updatedAt: "2026-08-14T02:00:00.000Z" },
    });
    registrations.pathValues.set("fieldPlatform/v2/workItems/stale_job", fieldV2WorkItem({
      id: "stale_job",
      visitId: "visit_stale",
      assignedOperatorId: "operator_hwang",
      workflowStatus: "assigned",
    }));
    registrations.pathValues.set("fieldPlatform/v2/workItems/free_job", fieldV2WorkItem({
      id: "free_job",
      visitId: "visit_free",
      assignedOperatorId: null,
      workflowStatus: "requested",
    }));
    seedFieldV2WorkspaceRoot("member");

    const workspace = await callableHandler(entrypoints.listFieldOperationsWorkspace)(
      validFieldV2Request({ limit: 10 }),
    ) as { items: Array<{ id: string }> };
    expect(workspace.items.map((item) => item.id)).toEqual(["free_job"]);
    expect(registrations.databaseRef).toHaveBeenCalledWith(
      "fieldPlatform/v2/projections/unassigned",
    );
  });

  it("does not let a stale personal projection consume the requested page", async () => {
    seedFieldV2Access("member");
    registrations.pathValues.set("fieldPlatform/v2/projections/operatorJobs/operator_kim", {
      a_stale: { fieldJobId: "a_stale", updatedAt: "2026-08-14T01:00:00.000Z" },
      z_valid: { fieldJobId: "z_valid", updatedAt: "2026-08-14T02:00:00.000Z" },
    });
    registrations.pathValues.set("fieldPlatform/v2/workItems/a_stale", fieldV2WorkItem({
      id: "a_stale",
      visitId: "visit_stale",
      assignedOperatorId: "operator_hwang",
      workflowStatus: "assigned",
    }));
    registrations.pathValues.set("fieldPlatform/v2/workItems/z_valid", fieldV2WorkItem({
      id: "z_valid",
      visitId: "visit_valid",
      assignedOperatorId: "operator_kim",
      workflowStatus: "assigned",
    }));
    seedFieldV2WorkspaceRoot("member");

    const workspace = await callableHandler(entrypoints.listFieldOperationsWorkspace)(
      validFieldV2Request({ limit: 1 }),
    ) as { items: Array<{ id: string }> };
    expect(workspace.items.map((item) => item.id)).toEqual(["z_valid"]);
  });

  it("uses current assignment when stale mine and current unassigned projections overlap", async () => {
    seedFieldV2Access("member");
    registrations.pathValues.set("fieldPlatform/v2/projections/operatorJobs/operator_kim", {
      job_overlap: { fieldJobId: "job_overlap", updatedAt: "2026-08-14T01:00:00.000Z" },
    });
    registrations.pathValues.set("fieldPlatform/v2/projections/unassigned", {
      job_overlap: { fieldJobId: "job_overlap", updatedAt: "2026-08-14T02:00:00.000Z" },
    });
    registrations.pathValues.set("fieldPlatform/v2/workItems/job_overlap", fieldV2WorkItem({
      id: "job_overlap",
      visitId: "visit_overlap",
      assignedOperatorId: null,
      workflowStatus: "requested",
    }));
    seedFieldV2WorkspaceRoot("member");

    const workspace = await callableHandler(entrypoints.listFieldOperationsWorkspace)(
      validFieldV2Request({ limit: 1 }),
    ) as { items: Array<{ id: string }> };
    expect(workspace.items.map((item) => item.id)).toEqual(["job_overlap"]);
  });

  it("continues a bounded personal workspace page with a stable projection cursor", async () => {
    seedFieldV2Access("viewer");
    registrations.pathValues.set("fieldPlatform/v2/projections/operatorJobs/operator_kim", {
      job_1: { fieldJobId: "job_1", updatedAt: "2026-08-14T01:00:00.000Z" },
      job_2: { fieldJobId: "job_2", updatedAt: "2026-08-14T02:00:00.000Z" },
      job_3: { fieldJobId: "job_3", updatedAt: "2026-08-14T03:00:00.000Z" },
    });
    for (const number of [1, 2, 3]) {
      registrations.pathValues.set(`fieldPlatform/v2/workItems/job_${number}`, fieldV2WorkItem({
        id: `job_${number}`,
        visitId: `visit_${number}`,
        assignedOperatorId: "operator_kim",
        workflowStatus: "assigned",
      }));
    }
    seedFieldV2WorkspaceRoot("viewer");

    const first = await callableHandler(entrypoints.listFieldOperationsWorkspace)(
      validFieldV2Request({ limit: 1 }),
    ) as { items: Array<{ id: string }>; nextCursor: string | null };
    expect(first.items.map((item) => item.id)).toEqual(["job_1"]);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = await callableHandler(entrypoints.listFieldOperationsWorkspace)(
      validFieldV2Request({ limit: 1, cursor: first.nextCursor }),
    ) as { items: Array<{ id: string }> };
    expect(second.items.map((item) => item.id)).toEqual(["job_2"]);
    expect(registrations.queryCalls).toContainEqual(expect.objectContaining({
      path: "fieldPlatform/v2/projections/operatorJobs/operator_kim",
      startAfter: { value: "2026-08-14T01:00:00.000Z", key: "job_1" },
      limitToFirst: 3,
    }));
  });

  it("advances through an adversarial stale prefix until personal work is reachable", async () => {
    seedFieldV2Access("viewer");
    const projections: Record<string, unknown> = {};
    for (let number = 1; number <= 5; number += 1) {
      const id = `stale_${number}`;
      projections[id] = {
        fieldJobId: id,
        updatedAt: `2026-08-14T0${number}:00:00.000Z`,
      };
      registrations.pathValues.set(`fieldPlatform/v2/workItems/${id}`, fieldV2WorkItem({
        id,
        visitId: `visit_${id}`,
        assignedOperatorId: "operator_hwang",
        workflowStatus: "assigned",
      }));
    }
    projections.valid_job = {
      fieldJobId: "valid_job",
      updatedAt: "2026-08-14T06:00:00.000Z",
    };
    registrations.pathValues.set("fieldPlatform/v2/workItems/valid_job", fieldV2WorkItem({
      id: "valid_job",
      visitId: "visit_valid",
      assignedOperatorId: "operator_kim",
      workflowStatus: "assigned",
    }));
    registrations.pathValues.set(
      "fieldPlatform/v2/projections/operatorJobs/operator_kim",
      projections,
    );
    seedFieldV2WorkspaceRoot("viewer");

    let cursor: string | null = null;
    const seen: string[] = [];
    for (let page = 0; page < 4; page += 1) {
      const workspace = await callableHandler(entrypoints.listFieldOperationsWorkspace)(
        validFieldV2Request({
          limit: 1,
          ...(cursor === null ? {} : { cursor }),
        }),
      ) as { items: Array<{ id: string }>; nextCursor: string | null };
      seen.push(...workspace.items.map((item) => item.id));
      cursor = workspace.nextCursor;
      if (seen.length > 0 || cursor === null) break;
    }
    expect(seen).toEqual(["valid_job"]);
  });

  it.each(["__proto__", "prototype", "constructor"])(
    "rejects a reserved workspace projection key %s before any item lookup",
    async (reserved) => {
      seedFieldV2Access("member");
      registrations.pathValues.set("fieldPlatform/v2/projections/unassigned", {
        [reserved]: { fieldJobId: reserved, updatedAt: "2026-08-14T02:00:00.000Z" },
      });
      registrations.databaseRef.mockClear();
      await expect(callableHandler(entrypoints.listFieldOperationsWorkspace)(
        validFieldV2Request({ limit: 10 }),
      )).rejects.toMatchObject({
        code: "unavailable",
        message: "field_workspace_invalid",
      });
      expect(registrations.databaseRef).not.toHaveBeenCalledWith(
        `fieldPlatform/v2/workItems/${reserved}`,
      );
      expect(Object.prototype).not.toHaveProperty("polluted");
    },
  );

  it("paginates the admin team projection with a bounded query and stored whole-team KPI", async () => {
    seedFieldV2Access("admin");
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const workItems = Object.fromEntries([1, 2, 3].map((number) => {
      const id = `job_${number}`;
      return [id, fieldV2WorkItem({
        id,
        visitId: `visit_${number}`,
        dueDate: `2099-01-0${number}`,
        updatedAt: `2026-08-14T0${number}:00:00.000Z`,
      })];
    }));
    const projections = Object.fromEntries(Object.entries(workItems)
      .map(([id, item]) => [id, fieldV2TeamProjection(item as Record<string, unknown>)]));
    registrations.pathValues.set("fieldPlatform/v2/projections/teamActive", projections);
    registrations.unorderedQueryValPaths.add("fieldPlatform/v2/projections/teamActive");
    const teamKpis = {
      seoulDate: today,
      todayVisits: 0,
      capturePending: 3,
      uploadFailures: 0,
      reviewPending: 0,
      unassigned: 3,
      overdue: 0,
      adminActionRequired: 0,
      updatedAt: "2026-08-14T03:00:00.000Z",
    };
    registrations.pathValues.set("fieldPlatform/v2/projections/teamKpis/current", teamKpis);
    seedFieldV2WorkspaceRoot("admin", {
      workItems,
      projections: { teamKpis: { current: teamKpis } },
    });

    const first = await callableHandler(entrypoints.listFieldOperationsWorkspace)(
      validFieldV2Request({ scope: "team", limit: 2 }),
    ) as { items: Array<{ fieldJobId: string }>; nextCursor: string; kpis: Record<string, number> };
    expect(first.items.map((item) => item.fieldJobId)).toEqual(["job_1", "job_2"]);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(first.kpis.capturePending).toBe(3);
    expect(Object.keys(first.kpis).sort()).toEqual([
      "adminActionRequired",
      "capturePending",
      "overdue",
      "reviewPending",
      "todayVisits",
      "unassigned",
      "uploadFailures",
    ]);
    expect(registrations.queryCalls).toContainEqual({
      path: "fieldPlatform/v2/projections/teamActive",
      orderByChild: "activeOrderKey",
      limitToFirst: 3,
    });
    expect(registrations.databaseRef).not.toHaveBeenCalledWith(
      expect.stringMatching(/^fieldPlatform\/v2\/workItems\//u),
    );

    const second = await callableHandler(entrypoints.listFieldOperationsWorkspace)(
      validFieldV2Request({ scope: "team", limit: 2, cursor: first.nextCursor }),
    ) as { items: Array<{ fieldJobId: string }>; nextCursor: string | null };
    expect(second.items.map((item) => item.fieldJobId)).toEqual(["job_3"]);
    expect(second.nextCursor).toBeNull();
  });

  it.each(["stale", "missing"] as const)(
    "rebuilds a %s team KPI from authoritative work on the admin's first team read",
    async (aggregateState) => {
      seedFieldV2Access("admin");
      const now = new Date();
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now);
      const yesterday = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(now.getTime() - 86_400_000));
      const item = fieldV2WorkItem({ dueDate: today });
      const stale = {
        seoulDate: yesterday,
        todayVisits: 9,
        capturePending: 9,
        uploadFailures: 9,
        reviewPending: 9,
        unassigned: 9,
        overdue: 9,
        adminActionRequired: 9,
        updatedAt: item.updatedAt,
      };
      if (aggregateState === "stale") {
        registrations.pathValues.set("fieldPlatform/v2/projections/teamKpis/current", stale);
      } else {
        registrations.pathValues.delete("fieldPlatform/v2/projections/teamKpis/current");
      }
      registrations.pathValues.set("fieldPlatform/v2/projections/teamActive", {
        job_1: fieldV2TeamProjection(item),
      });
      registrations.transactionCurrent.value = {
        crmCompany: {
          access: { shared_uid: { enabled: true, role: "admin", email: "team@bringcare.kr" } },
          teamProfiles: { operator_kim: { active: true, displayName: "김현진" } },
        },
        fieldPlatform: { v2: {
          config: { release: registrations.pathValues.get("fieldPlatform/v2/config/release") },
          workItems: { job_1: item },
          projections: aggregateState === "stale" ? {
            teamKpis: { current: stale },
            teamVisitState: { visit_1: {
              visitId: "visit_1",
              seoulDate: yesterday,
              activeTodayItemCount: 9,
              updatedAt: item.updatedAt,
            } },
          } : {},
        } },
      };

      await expect(callableHandler(entrypoints.listFieldOperationsWorkspace)(
        validFieldV2Request({ scope: "team" }),
      )).resolves.toMatchObject({
        kpis: {
          todayVisits: 1,
          capturePending: 1,
          unassigned: 1,
        },
      });
      expect((registrations.transactionCurrent.value as any)
        .fieldPlatform.v2.projections.teamKpis.current)
        .toMatchObject({ seoulDate: today, todayVisits: 1, capturePending: 1, unassigned: 1 });
    },
  );

  it("denies a team response when the current root role was downgraded after preflight", async () => {
    seedFieldV2Access("admin");
    registrations.transactionCurrent.value = {
      crmCompany: {
        access: { shared_uid: { enabled: true, role: "viewer", email: "team@bringcare.kr" } },
        teamProfiles: { operator_kim: { active: true, displayName: "김현진" } },
      },
      fieldPlatform: { v2: {
        config: { release: registrations.pathValues.get("fieldPlatform/v2/config/release") },
        workItems: {},
        projections: { teamKpis: { current:
          registrations.pathValues.get("fieldPlatform/v2/projections/teamKpis/current") } },
      } },
    };

    await expect(callableHandler(entrypoints.listFieldOperationsWorkspace)(
      validFieldV2Request({ scope: "team" }),
    )).rejects.toMatchObject({
      code: "permission-denied",
      message: "field_access_forbidden",
    });
  });

  it.each([
    ["invalid updatedAt", { updatedAt: "not-an-iso-timestamp" }],
    ["unknown field", { unexpected: true }],
  ] as const)("fails closed for a team KPI with %s", async (_label, override) => {
    seedFieldV2Access("admin");
    const aggregate = {
      ...(registrations.pathValues.get(
        "fieldPlatform/v2/projections/teamKpis/current",
      ) as Record<string, unknown>),
      ...override,
    };
    registrations.pathValues.set("fieldPlatform/v2/projections/teamKpis/current", aggregate);
    registrations.transactionCurrent.value = {
      crmCompany: {
        access: { shared_uid: { enabled: true, role: "admin", email: "team@bringcare.kr" } },
        teamProfiles: { operator_kim: { active: true, displayName: "김현진" } },
      },
      fieldPlatform: { v2: {
        config: { release: registrations.pathValues.get("fieldPlatform/v2/config/release") },
        workItems: {},
        projections: { teamKpis: { current: aggregate } },
      } },
    };

    await expect(callableHandler(entrypoints.listFieldOperationsWorkspace)(
      validFieldV2Request({ scope: "team" }),
    )).rejects.toMatchObject({
      code: "failed-precondition",
      message: "field_kpi_stale",
    });
  });

  it("maps a malformed versioned team cursor to invalid-argument", async () => {
    seedFieldV2Access("admin");
    await expect(callableHandler(entrypoints.listFieldOperationsWorkspace)(
      validFieldV2Request({ scope: "team", cursor: "not-a-valid-cursor" }),
    )).rejects.toMatchObject({
      code: "invalid-argument",
      message: "field_workspace_cursor_invalid",
    });
  });

  it.each([
    [
      "building",
      entrypoints.rebuildMapProjectionOnBuildingWrite,
      "/fieldPlatform/buildings/{buildingId}",
    ],
    [
      "listing",
      entrypoints.rebuildMapProjectionOnListingWrite,
      "/fieldPlatform/listings/{listingId}",
    ],
    [
      "media",
      entrypoints.rebuildMapProjectionOnMediaWrite,
      "/fieldPlatform/media/{mediaId}",
    ],
  ])("exports the %s projection trigger with exact RTDB options", (_name, value, ref) => {
    expect(registration(value)).toMatchObject({ kind: "database" });
    expect(registration(value).options).toEqual({
      ref,
      instance: "bring-fm-hj-default-rtdb",
      region: "asia-southeast1",
    });
  });

  it("binds the five Drive runtime secrets to the retried create trigger", () => {
    expect(registrations.defineSecret.mock.calls.map(([name]) => name)).toEqual([
      "DRIVE_CLIENT_ID",
      "DRIVE_CLIENT_SECRET",
      "DRIVE_REFRESH_TOKEN",
      "DRIVE_ROOT_FOLDER_ID",
      "DRIVE_ROOT_MODE",
    ]);
    expect(registration(entrypoints.syncFieldMediaToDrive)).toMatchObject({
      kind: "database-created",
      options: {
        ref: "/fieldPlatform/driveSyncJobs/{jobId}",
        instance: "bring-fm-hj-default-rtdb",
        region: "asia-southeast1",
        retry: true,
        timeoutSeconds: 540,
        memory: "1GiB",
        maxInstances: 10,
        concurrency: 4,
      },
    });
    expect(
      (registration(entrypoints.syncFieldMediaToDrive).options.secrets as Array<{
        name: string;
      }>).map((secret) => secret.name),
    ).toEqual([
      "DRIVE_CLIENT_ID",
      "DRIVE_CLIENT_SECRET",
      "DRIVE_REFRESH_TOKEN",
      "DRIVE_ROOT_FOLDER_ID",
      "DRIVE_ROOT_MODE",
    ]);
  });

  it("registers bounded five-minute Drive recovery with the same secrets", () => {
    expect(registration(entrypoints.recoverFieldMediaDriveSync)).toMatchObject({
      kind: "schedule",
      options: {
        schedule: "every 5 minutes",
        timeZone: "Asia/Seoul",
        region: "asia-southeast1",
        retryCount: 0,
        timeoutSeconds: 540,
        memory: "1GiB",
        maxInstances: 1,
        concurrency: 1,
      },
    });
    expect(
      (registration(entrypoints.recoverFieldMediaDriveSync).options.secrets as Array<{
        name: string;
      }>).map((secret) => secret.name),
    ).toEqual([
      "DRIVE_CLIENT_ID",
      "DRIVE_CLIENT_SECRET",
      "DRIVE_REFRESH_TOKEN",
      "DRIVE_ROOT_FOLDER_ID",
      "DRIVE_ROOT_MODE",
    ]);
  });

  it("registers retried ad-package generation and bounded recovery with the five Drive secrets", () => {
    expect(registration(entrypoints.generateFieldAdPackageToDrive)).toMatchObject({
      kind: "database-created",
      options: {
        ref: "/fieldPlatform/adPackages/{packageId}",
        instance: "bring-fm-hj-default-rtdb",
        region: "asia-southeast1",
        retry: true,
        timeoutSeconds: 540,
        memory: "1GiB",
        maxInstances: 5,
        concurrency: 2,
      },
    });
    expect(registration(entrypoints.recoverFieldAdPackageGeneration)).toMatchObject({
      kind: "schedule",
      options: {
        schedule: "every 5 minutes",
        timeZone: "Asia/Seoul",
        region: "asia-southeast1",
        retryCount: 0,
        timeoutSeconds: 540,
        memory: "1GiB",
        maxInstances: 1,
        concurrency: 1,
      },
    });
    for (const value of [
      entrypoints.generateFieldAdPackageToDrive,
      entrypoints.recoverFieldAdPackageGeneration,
    ]) {
      expect((registration(value).options.secrets as Array<{ name: string }>)
        .map((secret) => secret.name)).toEqual([
          "DRIVE_CLIENT_ID",
          "DRIVE_CLIENT_SECRET",
          "DRIVE_REFRESH_TOKEN",
          "DRIVE_ROOT_FOLDER_ID",
          "DRIVE_ROOT_MODE",
        ]);
    }
  });

  it("claims then records an alertable safe failure when OAuth runtime config is invalid", async () => {
    const mediaId = "22222222-2222-4222-8222-222222222222";
    registrations.secretValues.set("DRIVE_REFRESH_TOKEN", "sensitive-refresh-token");
    registrations.secretValues.set("DRIVE_ROOT_MODE", "invalid-mode");
    registrations.transactionCurrent.value = {
      media: {
        [mediaId]: {
          id: mediaId,
          buildingId: "building-1",
          storagePath: `field-media-finalized/building-1/${mediaId}.jpg`,
          objectGeneration: "1740000000000001",
          driveSyncState: "queued",
        },
      },
      driveSyncJobs: {
        [mediaId]: {
          id: mediaId,
          mediaId,
          buildingId: "building-1",
          storagePath: `field-media-finalized/building-1/${mediaId}.jpg`,
          objectGeneration: "1740000000000001",
          status: "queued",
          attemptCount: 0,
          createdAt: "2026-08-10T03:00:00.000Z",
          updatedAt: "2026-08-10T03:00:00.000Z",
        },
      },
    };
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T04:00:00.000Z"));
    try {
      await expect((registration(entrypoints.syncFieldMediaToDrive).handler as (
        event: { params: { jobId: string } },
      ) => Promise<void>)({ params: { jobId: mediaId } })).rejects.toThrow(
        "drive_sync_retryable",
      );
    } finally {
      vi.useRealTimers();
    }

    expect(registrations.transactionPaths.filter((path) => path === "fieldPlatform"))
      .toHaveLength(2);
    expect(registrations.transactionCurrent.value).toMatchObject({
      driveSyncJobs: {
        [mediaId]: {
          status: "failed",
          lastErrorCode: "drive_oauth_config_invalid",
        },
      },
      driveSyncAlerts: {
        [mediaId]: {
          mediaId,
          status: "open",
          code: "drive_oauth_config_invalid",
        },
      },
    });
    expect(JSON.stringify(registrations.transactionCurrent.value)).not.toContain(
      "sensitive-refresh-token",
    );
  });

  it("scans Drive recovery jobs by three indexed statuses with hard limits", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T04:00:00.000Z"));
    try {
      await expect(
        (registration(entrypoints.recoverFieldMediaDriveSync).handler as (
          event: { scheduleTime: string },
        ) => Promise<void>)({ scheduleTime: "2026-08-10T03:00:00.000Z" }),
      ).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }

    expect(registrations.queryCalls).toEqual([
      {
        path: "fieldPlatform/driveSyncJobs",
        orderByChild: "recoveryKey",
        startAt: { value: "queued|" },
        endAt: { value: "queued|\uf8ff" },
        limitToFirst: 20,
      },
      {
        path: "fieldPlatform/driveSyncJobs",
        orderByChild: "recoveryKey",
        startAt: { value: "failed|" },
        endAt: { value: "failed|2026-08-10T04:00:00.000Z|\uf8ff" },
        limitToFirst: 20,
      },
      {
        path: "fieldPlatform/driveSyncJobs",
        orderByChild: "recoveryKey",
        startAt: { value: "syncing|" },
        endAt: { value: "syncing|2026-08-10T04:00:00.000Z|\uf8ff" },
        limitToFirst: 20,
      },
    ]);
  });

  it("registers the canonical CRM endpoint as a regional POST-only surface without CORS", () => {
    expect(registration(entrypoints.commitCanonicalCrmEntity)).toMatchObject({
      kind: "request",
      options: { region: "asia-northeast3", cors: false },
    });
  });

  it("commits a canonical entity after current-project auth and bounded IP and UID rate limits", async () => {
    seedCanonicalCrmAccess();
    registrations.adminVerifyIdToken.mockResolvedValueOnce({
      uid: "shared_uid",
      email: "team@bringcare.kr",
      email_verified: true,
    });
    registrations.transactionCurrent.value = canonicalCrmRoot();
    const output = httpResponseHarness();

    await requestHandler(entrypoints.commitCanonicalCrmEntity)(
      canonicalHttpRequest(validCanonicalCrmBody()),
      output.response,
    );

    expect(output.state.status).toBe(200);
    expect(output.state.body).toMatchObject({
      ok: true,
      result: {
        entityType: "buildingUnits",
        entityId: "unit_1",
        entityVersion: 5,
        repeated: false,
      },
    });
    expect(registrations.adminVerifyIdToken).toHaveBeenCalledWith(
      "current-project-id-token",
      true,
    );
    expect(registrations.transactionPaths.filter(path => path === "")).toHaveLength(1);
    expect(registrations.transactionPaths).toEqual(expect.arrayContaining([
      expect.stringMatching(/^fieldPlatform\/v2\/rateLimits\/commitCanonicalCrmEntity\/ip\//),
      expect.stringMatching(/^fieldPlatform\/v2\/rateLimits\/commitCanonicalCrmEntity\/uid\//),
      "",
    ]));
    expect((registrations.transactionCurrent.value as any)
      .crmCompany.data.buildingUnits.unit_1).toMatchObject({
      label: "203호",
      entityVersion: 5,
    });
  });

  it.each([
    ["non-POST", canonicalHttpRequest(validCanonicalCrmBody(), { method: "GET" }), 405, "crm_method_not_allowed"],
    ["non-JSON", canonicalHttpRequest(validCanonicalCrmBody(), { headers: { "content-type": "text/plain", authorization: "Bearer current-project-id-token" } }), 400, "crm_json_required"],
    ["missing raw body", { ...canonicalHttpRequest(validCanonicalCrmBody()), rawBody: undefined }, 400, "crm_body_invalid"],
    ["oversized body", { ...canonicalHttpRequest(validCanonicalCrmBody()), rawBody: Buffer.alloc(32_769, 65) }, 413, "crm_body_too_large"],
    ["missing bearer", canonicalHttpRequest(validCanonicalCrmBody(), { headers: { "content-type": "application/json", authorization: "" } }), 401, "crm_auth_required"],
  ])("rejects canonical HTTP %s before canonical mutation", async (_label, request, status, code) => {
    const output = httpResponseHarness();
    await requestHandler(entrypoints.commitCanonicalCrmEntity)(request, output.response);
    expect(output.state).toMatchObject({
      status,
      body: { ok: false, error: { code } },
    });
    expect(registrations.transactionPaths.filter(path => path === "")).toHaveLength(0);
  });

  it("rejects unverified tokens without exposing verifier details", async () => {
    registrations.adminVerifyIdToken.mockResolvedValueOnce({
      uid: "shared_uid",
      email: "team@bringcare.kr",
      email_verified: false,
    });
    const output = httpResponseHarness();
    await requestHandler(entrypoints.commitCanonicalCrmEntity)(
      canonicalHttpRequest(validCanonicalCrmBody()),
      output.response,
    );
    expect(output.state).toMatchObject({
      status: 401,
      body: { ok: false, error: { code: "crm_auth_required" } },
    });
    expect(JSON.stringify(output.state.body)).not.toContain("current-project-id-token");
  });

  it("maps bounded endpoint rate exhaustion to HTTP 429", async () => {
    registrations.pathValues.set(
      "fieldPlatform/v2/rateLimits/commitCanonicalCrmEntity/ip/" + createHash("sha256").update("127.0.0.1").digest("base64url").slice(0, 43),
      { windowStartedAt: Date.now(), count: 120 },
    );
    const output = httpResponseHarness();
    await requestHandler(entrypoints.commitCanonicalCrmEntity)(
      canonicalHttpRequest(validCanonicalCrmBody()),
      output.response,
    );
    expect(output.state).toMatchObject({
      status: 429,
      body: { ok: false, error: { code: "crm_rate_limited" } },
    });
    expect(registrations.adminVerifyIdToken).not.toHaveBeenCalled();
  });

  it("returns a stable 503 without leaking patches when the canonical transaction is unavailable", async () => {
    seedCanonicalCrmAccess();
    registrations.adminVerifyIdToken.mockResolvedValueOnce({
      uid: "shared_uid",
      email: "team@bringcare.kr",
      email_verified: true,
    });
    registrations.transactionCurrent.value = canonicalCrmRoot();
    registrations.databaseTransaction
      .mockImplementationOnce(async (update, _complete, _local, path) => {
        const state = update(null);
        registrations.transactionPaths.push(path);
        return { committed: true, snapshot: { val: () => state, exists: () => true } };
      })
      .mockImplementationOnce(async (update, _complete, _local, path) => {
        const state = update(null);
        registrations.transactionPaths.push(path);
        return { committed: true, snapshot: { val: () => state, exists: () => true } };
      })
      .mockRejectedValueOnce(new Error("database unavailable: patch=secret"));
    const output = httpResponseHarness();
    await requestHandler(entrypoints.commitCanonicalCrmEntity)(
      canonicalHttpRequest(validCanonicalCrmBody()),
      output.response,
    );
    expect(output.state).toMatchObject({
      status: 503,
      body: { ok: false, error: { code: "crm_service_unavailable" } },
    });
    expect(JSON.stringify(output.state.body)).not.toContain("patch");
    expect(JSON.stringify(output.state.body)).not.toContain("secret");
  });

  it("registers the handoff cleanup schedule and all entrypoints", () => {
    expect(entrypoints.provisionFieldUser).toBeDefined();
    expect(registration(entrypoints.provisionFieldUser)).toMatchObject({
      kind: "callable",
      options: { region: "asia-northeast3" },
    });
    expect(registration(entrypoints.cleanupDesktopFieldHandoffs)).toMatchObject({
      kind: "schedule",
      options: {
        schedule: "every 60 minutes",
        timeZone: "Asia/Seoul",
        region: "asia-northeast3",
      },
    });
    expect(registrations.initializeApp).toHaveBeenCalledTimes(1);
    expect(registrations.initializeApp).toHaveBeenCalledWith();
    expect(registrations.initializeApp).not.toHaveBeenCalledWith(
      { projectId: "bring-fm-hj" },
      "crm-auth-verifier",
    );
    expect(registrations.getAuth).toHaveBeenCalledTimes(1);
    expect(registrations.getAuth).toHaveBeenCalledWith();
    expect(registrations.onCall).toHaveBeenCalledTimes(21);
    expect(registrations.onRequest).toHaveBeenCalledTimes(1);
    expect(registrations.onValueWritten).toHaveBeenCalledTimes(3);
    expect(registrations.onValueCreated).toHaveBeenCalledTimes(2);
    expect(registrations.onSchedule).toHaveBeenCalledTimes(3);
  });

  it("verifies desktop handoff tokens with the current default Firebase Auth", async () => {
    registrations.adminVerifyIdToken.mockResolvedValueOnce({
      uid: "crm-current-user",
      email: "team@bringcare.kr",
      email_verified: true,
      name: "브링케어 팀",
    });

    await expect(callableHandler(entrypoints.createDesktopFieldHandoff)({
      data: { crmIdToken: "current-project-id-token" },
      rawRequest: { ip: "127.0.0.1" },
    })).rejects.toMatchObject({
      code: "permission-denied",
      message: "desktop_handoff_not_allowed",
    });

    expect(registrations.adminVerifyIdToken)
      .toHaveBeenCalledWith("current-project-id-token");
  });

  it("scans package recovery by the nested composite index with live time and hard limits", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T06:00:00.000Z"));
    try {
      await expect((registration(entrypoints.recoverFieldAdPackageGeneration).handler as (
        event: { scheduleTime: string },
      ) => Promise<void>)({ scheduleTime: "1999-01-01T00:00:00.000Z" }))
        .resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }

    expect(registrations.queryCalls).toEqual([
      {
        path: "fieldPlatform/adPackages",
        orderByChild: "generation/recoveryKey",
        startAt: { value: "reviewed|" },
        endAt: { value: "reviewed|2026-08-10T06:00:00.000Z|\uf8ff" },
        limitToFirst: 8,
      },
      {
        path: "fieldPlatform/adPackages",
        orderByChild: "generation/recoveryKey",
        startAt: { value: "failed|" },
        endAt: { value: "failed|2026-08-10T06:00:00.000Z|\uf8ff" },
        limitToFirst: 8,
      },
      {
        path: "fieldPlatform/adPackages",
        orderByChild: "generation/recoveryKey",
        startAt: { value: "generating|" },
        endAt: { value: "generating|2026-08-10T06:00:00.000Z|\uf8ff" },
        limitToFirst: 8,
      },
    ]);
  });

  it("commits an ad package with exactly one fieldPlatform root transaction", async () => {
    registrations.pathValues.set("fieldPlatform/users/reviewer-1", {
      enabled: true,
      role: "reviewer",
    });
    registrations.pathValues.set("fieldPlatform/users/reviewer-1/enabled", true);
    registrations.transactionCurrent.value = validAdPlatformRoot();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T05:00:00.000Z"));
    try {
      await expect(callableHandler(entrypoints.createAdPackage)(
        validReviewerCallableRequest(validCreateAdPackageData()),
      )).resolves.toEqual({
        packageId: `ad-package-${AD_REQUEST_ID}`,
        listingId: "listing-1",
        version: 1,
        status: "reviewed",
      });

      expect(registrations.transactionPaths.filter((path) => path === "fieldPlatform"))
        .toEqual(["fieldPlatform"]);
      expect(registrations.transactionPaths).toContain(
        "fieldPlatform/rateLimits/createPackage/reviewer-1/1723181696",
      );
      expect(registrations.transactionPaths).not.toContain(
        "fieldPlatform/rateLimits/createPackage/reviewer-1/listing-1",
      );
      expect(registrations.databaseUpdate).not.toHaveBeenCalledWith(
        "",
        expect.objectContaining({
          [`fieldPlatform/adPackages/ad-package-${AD_REQUEST_ID}`]: expect.anything(),
        }),
      );
      expect(registrations.transactionCurrent.value).toMatchObject({
        adPackageVersions: { "listing-1": 1 },
        adPackageLatest: {
          "listing-1": `ad-package-${AD_REQUEST_ID}`,
        },
        adPackages: {
          [`ad-package-${AD_REQUEST_ID}`]: {
            requestId: AD_REQUEST_ID,
            status: "reviewed",
          },
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("revalidates transaction retry state and commits nothing when listing becomes stale", async () => {
    registrations.pathValues.set("fieldPlatform/users/reviewer-1", {
      enabled: true,
      role: "reviewer",
    });
    registrations.pathValues.set("fieldPlatform/users/reviewer-1/enabled", true);
    registrations.transactionCurrent.value = validAdPlatformRoot();
    const stale = validAdPlatformRoot();
    stale.listings["listing-1"].status = "closed";
    registrations.transactionRetryCurrent.value = stale;

    await expect(callableHandler(entrypoints.createAdPackage)(
      validReviewerCallableRequest(validCreateAdPackageData()),
    )).rejects.toMatchObject({
      code: "failed-precondition",
      message: "ad_package_listing_incomplete",
    });
    expect(registrations.transactionPaths.filter((path) => path === "fieldPlatform"))
      .toEqual([]);
    expect(registrations.transactionCurrent.value).not.toHaveProperty(
      `adPackages.ad-package-${AD_REQUEST_ID}`,
    );
  });

  it("lists review candidates through bounded indexed queries and point reads", async () => {
    registrations.pathValues.set("fieldPlatform/users/reviewer-1", {
      enabled: true,
      role: "reviewer",
    });
    registrations.pathValues.set("fieldPlatform/users/reviewer-1/enabled", true);
    const root = validAdPlatformRoot();
    (root.listings["listing-1"] as Record<string, unknown>).ownerPhone = "SECRET-OWNER";
    registrations.pathValues.set("fieldPlatform/listings", root.listings);
    const sharedMedia = structuredClone(root.media);
    delete (sharedMedia[AD_MEDIA_IDS[0]] as Record<string, unknown>).unitId;
    delete (sharedMedia[AD_MEDIA_IDS[0]] as Record<string, unknown>).listingId;
    registrations.pathValues.set("fieldPlatform/media", sharedMedia);
    registrations.pathValues.set("fieldPlatform/adPackages", {
      "ad-package-old": {
        id: "ad-package-old",
        listingId: "listing-1",
        version: 1,
        representativeMediaIds: [AD_MEDIA_IDS[0]],
        allApprovedMediaIds: AD_MEDIA_IDS,
        status: "complete",
        driveFolderId: "SECRET-DRIVE",
      },
    });
    registrations.pathValues.set(
      "fieldPlatform/adPackageLatest/listing-1",
      "ad-package-latest",
    );
    registrations.pathValues.set(
      "fieldPlatform/adPackages/ad-package-latest",
      {
        id: "ad-package-latest",
        listingId: "listing-1",
        version: 99,
        representativeMediaIds: [AD_MEDIA_IDS[1]],
        allApprovedMediaIds: AD_MEDIA_IDS,
        status: "reviewed",
        driveFolderId: "SECRET-LATEST-DRIVE",
      },
    );
    registrations.pathValues.set(
      "fieldPlatform/buildings/building-1",
      { ...root.buildings["building-1"], commonDoorPassword: "SECRET-DOOR" },
    );
    registrations.pathValues.set("fieldPlatform/units/unit-1", root.units["unit-1"]);
    registrations.pathValues.set(
      `fieldPlatform/captureSessions/${AD_SESSION_ID}`,
      root.captureSessions[AD_SESSION_ID],
    );

    const result = await callableHandler(entrypoints.listAdPackageReviewCandidates)(
      validReviewerCallableRequest(undefined),
    );

    expect(result).toMatchObject({
      candidates: [{
        listing: { id: "listing-1", status: "ready" },
        building: { id: "building-1" },
        unit: { id: "unit-1" },
        media: expect.arrayContaining([
          expect.objectContaining({ id: AD_MEDIA_IDS[0] }),
        ]),
        captureSessions: [{ id: AD_SESSION_ID, status: "complete" }],
        packages: [
          { id: "ad-package-latest", version: 99 },
          { id: "ad-package-old", version: 1 },
        ],
      }],
    });
    expect((result as { candidates: Array<{ media: unknown[] }> }).candidates[0].media)
      .toHaveLength(10);
    expect(JSON.stringify(result)).not.toMatch(/SECRET-/);
    expect(registrations.queryCalls).toEqual(expect.arrayContaining([
      { path: "fieldPlatform/listings", orderByChild: "status", equalTo: "reviewPending", limitToFirst: 50 },
      { path: "fieldPlatform/listings", orderByChild: "status", equalTo: "ready", limitToFirst: 50 },
      { path: "fieldPlatform/listings", orderByChild: "status", equalTo: "advertising", limitToFirst: 50 },
      { path: "fieldPlatform/media", orderByChild: "listingId", equalTo: "listing-1", limitToFirst: 100 },
      { path: "fieldPlatform/media", orderByChild: "buildingId", equalTo: "building-1", limitToFirst: 100 },
      { path: "fieldPlatform/adPackages", orderByChild: "listingId", equalTo: "listing-1", limitToLast: 20 },
    ]));
    expect(registrations.transactionPaths).toContain(
      "fieldPlatform/rateLimits/reviewCandidates/reviewer-1/1723181696",
    );
    expect(registrations.databaseGet).toHaveBeenCalledWith(
      "fieldPlatform/adPackageLatest/listing-1",
    );
    expect(registrations.databaseGet).toHaveBeenCalledWith(
      "fieldPlatform/adPackages/ad-package-latest",
    );
    for (const path of [
      "fieldPlatform/listings",
      "fieldPlatform/buildings",
      "fieldPlatform/units",
      "fieldPlatform/media",
      "fieldPlatform/adPackages",
      "fieldPlatform/captureSessions",
    ]) {
      expect(registrations.databaseGet).not.toHaveBeenCalledWith(path);
    }

    const paged = await callableHandler(entrypoints.listAdPackageReviewCandidates)(
      validReviewerCallableRequest({ cursor: "listing-0" }),
    );
    expect((paged as { candidates: unknown[] }).candidates).toHaveLength(1);
    expect(registrations.queryCalls).toEqual(expect.arrayContaining([
      {
        path: "fieldPlatform/listings",
        orderByChild: "status",
        startAfter: { value: "reviewPending", key: "listing-0" },
        endAt: { value: "reviewPending" },
        limitToFirst: 50,
      },
      {
        path: "fieldPlatform/listings",
        orderByChild: "status",
        startAfter: { value: "ready", key: "listing-0" },
        endAt: { value: "ready" },
        limitToFirst: 50,
      },
      {
        path: "fieldPlatform/listings",
        orderByChild: "status",
        startAfter: { value: "advertising", key: "listing-0" },
        endAt: { value: "advertising" },
        limitToFirst: 50,
      },
    ]));
  });

  it("blocks staff from review candidates before any listing query", async () => {
    registrations.pathValues.set("fieldPlatform/users/staff-1", {
      enabled: true,
      role: "staff",
    });
    registrations.pathValues.set("fieldPlatform/users/staff-1/enabled", true);

    await expect(callableHandler(entrypoints.listAdPackageReviewCandidates)(
      validCallableRequest({}),
    )).rejects.toMatchObject({
      code: "permission-denied",
      message: "ad_package_forbidden",
    });
    expect(registrations.queryCalls).toEqual([]);
  });

  it("returns assigned capture workspace data through one protected rate-limited callable", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
    registrations.pathValues.set("fieldPlatform/buildingAssignments", {
      "building-1": { "staff-1": true },
      "foreign-building": { "other-staff": true },
    });
    registrations.pathValues.set("fieldPlatform/buildings", {
      "building-1": {
        id: "building-1",
        name: "관리 건물",
        managementContract: { status: "active" },
      },
      "foreign-building": {
        id: "foreign-building",
        name: "미배정 건물",
        managementContract: { status: "active" },
      },
    });
    registrations.pathValues.set("fieldPlatform/units", {
      "unit-1": { id: "unit-1", buildingId: "building-1", unitLabel: "201호" },
    });
    registrations.pathValues.set("fieldPlatform/listings", {
      "listing-1": {
        id: "listing-1",
        buildingId: "building-1",
        unitId: "unit-1",
        unitLabel: "201호",
        status: "capturing",
      },
    });
    registrations.pathValues.set("fieldPlatform/captureSessions", {
      "11111111-1111-4111-8111-111111111111": {
        id: "11111111-1111-4111-8111-111111111111",
        requestId: "22222222-2222-4222-8222-222222222222",
        buildingId: "building-1",
        unitId: "unit-1",
        listingId: "listing-1",
        visitId: "33333333-3333-4333-8333-333333333333",
        createdBy: "staff-1",
        status: "open",
        createdAt: "2026-08-09T09:00:00.000Z",
        updatedAt: "2026-08-09T09:30:00.000Z",
      },
    });

    await expect(callableHandler(entrypoints.listFieldCaptureWorkspace)(
      validCallableRequest({}),
    )).resolves.toEqual({
      targets: [
        {
          id: "management:building-1:unit-1",
          buildingId: "building-1",
          buildingName: "관리 건물",
          unitId: "unit-1",
          unitLabel: "201호",
          source: "management",
        },
        {
          id: "advertising:listing-1",
          buildingId: "building-1",
          buildingName: "관리 건물",
          unitId: "unit-1",
          unitLabel: "201호",
          listingId: "listing-1",
          source: "advertising",
        },
      ],
      openSessions: [expect.objectContaining({
        id: "11111111-1111-4111-8111-111111111111",
        createdBy: "staff-1",
        status: "open",
      })],
    });
    expect(registrations.transactionPaths).toContain(
      "fieldPlatform/rateLimits/captureWorkspace/staff-1/1723181696",
    );
    expect(registrations.databaseRef).not.toHaveBeenCalledWith(
      "fieldPlatform/buildings/foreign-building",
    );
    now.mockRestore();
  });

  it("rejects unauthenticated capture workspace reads before database access", async () => {
    await expect(callableHandler(entrypoints.listFieldCaptureWorkspace)({
      data: {},
    })).rejects.toMatchObject({
      code: "unauthenticated",
      message: "field_auth_required",
    });
    expect(registrations.databaseGet).not.toHaveBeenCalled();
  });

  it.each([
    ["start", entrypoints.startFieldCaptureSession],
    ["finalize", entrypoints.finalizeFieldMedia],
    ["access", entrypoints.getFieldMediaAccess],
    ["exclude", entrypoints.excludeFieldMedia],
    ["workspace", entrypoints.listFieldCaptureWorkspace],
    ["ad review candidates", entrypoints.listAdPackageReviewCandidates],
  ])("rejects a consumed limited-use App Check token for %s", async (_name, callable) => {
    await expect(callableHandler(callable)({
      ...validCallableRequest({}),
      app: { alreadyConsumed: true },
    })).rejects.toMatchObject({
      code: "unauthenticated",
      message: "field_app_check_replayed",
    });
  });

  it("rate-limits media access by UID/media and signs only the finalized path", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    registrations.pathValues.set("fieldPlatform/users/staff-1/enabled", true);
    registrations.pathValues.set(
      "fieldPlatform/buildingAssignments/b1/staff-1",
      true,
    );
    registrations.pathValues.set("fieldPlatform/media/media-1", {
      id: "media-1",
      buildingId: "b1",
      uploadState: "finalized",
      storagePath: "field-media-finalized/b1/media-1.jpg",
    });

    await expect(callableHandler(entrypoints.getFieldMediaAccess)(
      validCallableRequest({ mediaId: "media-1" }),
    )).resolves.toEqual({
      url: "https://signed.example/read",
      expiresAt: "1970-01-01T00:05:01.000Z",
    });
    expect(registrations.transactionPaths).toContain(
      "fieldPlatform/rateLimits/mediaAccess/staff-1/media-1",
    );
    expect(registrations.storageFile).toHaveBeenCalledWith(
      "field-media-finalized/b1/media-1.jpg",
    );
    now.mockRestore();
  });

  it("maps a media rate-limit rejection without reaching Storage", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    registrations.pathValues.set(
      "fieldPlatform/rateLimits/mediaAccess/staff-1/media-1",
      { windowStartedAt: 1_000, count: 120 },
    );
    await expect(callableHandler(entrypoints.getFieldMediaAccess)(
      validCallableRequest({ mediaId: "media-1" }),
    )).rejects.toMatchObject({
      code: "resource-exhausted",
      message: "field_rate_limit_exceeded",
    });
    expect(registrations.storageFile).not.toHaveBeenCalled();
    now.mockRestore();
  });

  it("creates an owner note through one current-or-candidate transaction", async () => {
    seedOwnerNoteAccess();

    const result = await callableHandler(entrypoints.appendOwnerNote)(
      validOwnerCallableRequest(validOwnerNoteData()),
    );

    expect(result).toEqual({
      note: expect.objectContaining({
        id: "note_12345678",
        buildingId: "building-1",
        body: "Owner requested a follow-up",
        createdBy: "staff-1",
        createdByName: "Verified staff",
      }),
    });
    expect(registrations.transactionPaths).toContain(OWNER_NOTE_PATH);
    expect(registrations.pathValues.get(OWNER_NOTE_PATH)).toEqual(
      (result as { note: unknown }).note,
    );
  });

  it("uses a bounded current-session rate key when auth_time is unavailable", async () => {
    seedOwnerNoteAccess();
    const request = validOwnerCallableRequest(validOwnerNoteData());
    delete (request.auth.token as { auth_time?: number }).auth_time;

    await callableHandler(entrypoints.appendOwnerNote)(request);

    expect(registrations.transactionPaths).toContain(
      "fieldPlatform/serverState/rateLimits/ownerNotes/staff-1/current/append",
    );
    expect(registrations.transactionPaths.join("\n")).not.toContain("undefined");
  });

  it("returns an id conflict without overwriting the transaction winner", async () => {
    seedOwnerNoteAccess();
    const winner = ownerNoteRecord({ body: "Concurrent winner" });
    registrations.readSequences.set(OWNER_NOTE_PATH, [null]);
    registrations.pathValues.set(OWNER_NOTE_PATH, winner);

    await expect(callableHandler(entrypoints.appendOwnerNote)(
      validOwnerCallableRequest(validOwnerNoteData()),
    )).rejects.toMatchObject({
      code: "already-exists",
      message: "owner_note_id_conflict",
    });

    expect(registrations.pathValues.get(OWNER_NOTE_PATH)).toEqual(winner);
    expect(registrations.mutationPaths).not.toContain(OWNER_NOTE_PATH);
  });

  it("rejects a malformed append transaction winner without mutation", async () => {
    seedOwnerNoteAccess();
    const malformedWinner = ownerNoteRecord({ createdAt: "not-a-date" });
    registrations.readSequences.set(OWNER_NOTE_PATH, [null]);
    registrations.pathValues.set(OWNER_NOTE_PATH, malformedWinner);

    await expect(callableHandler(entrypoints.appendOwnerNote)(
      validOwnerCallableRequest(validOwnerNoteData()),
    )).rejects.toMatchObject({
      code: "internal",
      message: "owner_note_internal",
    });

    expect(registrations.pathValues.get(OWNER_NOTE_PATH)).toEqual(malformedWinner);
    expect(registrations.mutationPaths).not.toContain(OWNER_NOTE_PATH);
  });

  it("accepts an auth-boundary colon UID through append persistence", async () => {
    const uid = "staff:wonju";
    registrations.pathValues.set(`fieldPlatform/users/${uid}`, {
      enabled: true,
      role: "staff",
    });
    registrations.pathValues.set(`fieldPlatform/users/${uid}/enabled`, true);
    registrations.pathValues.set(
      `fieldPlatform/users/${uid}/displayName`,
      "Verified staff",
    );
    registrations.pathValues.set("fieldPlatform/buildings/building-1", {
      id: "building-1",
    });
    registrations.pathValues.set(
      `fieldPlatform/buildingAssignments/building-1/${uid}`,
      true,
    );

    const result = await callableHandler(entrypoints.appendOwnerNote)({
      auth: {
        uid,
        token: {
          fieldPlatform: true,
          fieldRole: "staff",
          name: "Verified staff",
          auth_time: 1_723_181_696,
        },
      },
      data: validOwnerNoteData(),
    });

    expect(result).toEqual({
      note: expect.objectContaining({ createdBy: uid }),
    });
    expect(registrations.pathValues.get(OWNER_NOTE_PATH)).toMatchObject({
      createdBy: uid,
    });
    expect(registrations.transactionPaths).toContain(OWNER_NOTE_PATH);
  });

  it("rejects malformed stored state on the append pre-read", async () => {
    seedOwnerNoteAccess();
    const malformedStored = ownerNoteRecord({
      createdByName: "Bad\u007fname",
    });
    registrations.pathValues.set(OWNER_NOTE_PATH, malformedStored);

    await expect(callableHandler(entrypoints.appendOwnerNote)(
      validOwnerCallableRequest(validOwnerNoteData()),
    )).rejects.toMatchObject({
      code: "internal",
      message: "owner_note_internal",
    });

    expect(registrations.pathValues.get(OWNER_NOTE_PATH)).toEqual(malformedStored);
    expect(registrations.transactionPaths).not.toContain(OWNER_NOTE_PATH);
  });

  it("strips extra stored fields from an idempotent append response", async () => {
    seedOwnerNoteAccess();
    registrations.pathValues.set(OWNER_NOTE_PATH, ownerNoteRecord({
      ignoredServerField: "must not escape",
    }));

    const result = await callableHandler(entrypoints.appendOwnerNote)(
      validOwnerCallableRequest(validOwnerNoteData()),
    );

    expect(result).toEqual({ note: ownerNoteRecord() });
    expect(result).not.toHaveProperty("note.ignoredServerField");
    expect(registrations.transactionPaths).not.toContain(OWNER_NOTE_PATH);
  });

  it("preserves and returns the first archive winner in a transaction race", async () => {
    seedOwnerNoteAccess("admin");
    const active = ownerNoteRecord({ createdBy: "staff-1" });
    const winner = ownerNoteRecord({
      createdBy: "staff-1",
      archivedAt: "2026-08-09T02:30:00.000Z",
      archivedBy: "admin-winner",
    });
    registrations.readSequences.set(OWNER_NOTE_PATH, [active]);
    registrations.pathValues.set(OWNER_NOTE_PATH, winner);

    await expect(callableHandler(entrypoints.archiveOwnerNote)(
      validOwnerCallableRequest(
        { buildingId: "building-1", noteId: "note_12345678" },
        "admin",
      ),
    )).resolves.toEqual({
      archivedAt: "2026-08-09T02:30:00.000Z",
      archivedBy: "admin-winner",
    });

    expect(registrations.pathValues.get(OWNER_NOTE_PATH)).toEqual(winner);
    expect(registrations.mutationPaths).not.toContain(OWNER_NOTE_PATH);
  });

  it("never recreates a note deleted between the archive read and transaction", async () => {
    seedOwnerNoteAccess("admin");
    registrations.readSequences.set(OWNER_NOTE_PATH, [ownerNoteRecord()]);

    await expect(callableHandler(entrypoints.archiveOwnerNote)(
      validOwnerCallableRequest(
        { buildingId: "building-1", noteId: "note_12345678" },
        "admin",
      ),
    )).rejects.toMatchObject({
      code: "not-found",
      message: "owner_note_not_found",
    });

    expect(registrations.pathValues.has(OWNER_NOTE_PATH)).toBe(false);
    expect(registrations.mutationPaths).not.toContain(OWNER_NOTE_PATH);
  });

  it("rejects malformed archive transaction state without mutating it", async () => {
    seedOwnerNoteAccess("admin");
    const malformedWinner = ownerNoteRecord({
      archivedAt: "2026-08-09T02:30:00.000Z",
    });
    registrations.readSequences.set(OWNER_NOTE_PATH, [ownerNoteRecord()]);
    registrations.pathValues.set(OWNER_NOTE_PATH, malformedWinner);

    await expect(callableHandler(entrypoints.archiveOwnerNote)(
      validOwnerCallableRequest(
        { buildingId: "building-1", noteId: "note_12345678" },
        "admin",
      ),
    )).rejects.toMatchObject({
      code: "internal",
      message: "owner_note_internal",
    });

    expect(registrations.pathValues.get(OWNER_NOTE_PATH)).toEqual(malformedWinner);
    expect(registrations.mutationPaths).not.toContain(OWNER_NOTE_PATH);
  });

  it("maps archive role and input failures without mutating a note", async () => {
    seedOwnerNoteAccess("reviewer");
    registrations.pathValues.set(OWNER_NOTE_PATH, ownerNoteRecord());

    await expect(callableHandler(entrypoints.archiveOwnerNote)(
      validOwnerCallableRequest(
        { buildingId: "building-1", noteId: "note_12345678" },
        "reviewer",
      ),
    )).rejects.toMatchObject({
      code: "permission-denied",
      message: "owner_note_archive_forbidden",
    });

    seedOwnerNoteAccess("admin");
    await expect(callableHandler(entrypoints.archiveOwnerNote)(
      validOwnerCallableRequest(
        { buildingId: "bad/path", noteId: "note_12345678" },
        "admin",
      ),
    )).rejects.toMatchObject({
      code: "invalid-argument",
      message: "owner_note_building_id_invalid",
    });
    expect(registrations.mutationPaths).not.toContain(OWNER_NOTE_PATH);
  });

  it.each([
    ["unsafe input", "invalid-argument", "owner_note_building_id_invalid"],
    ["unassigned staff", "permission-denied", "owner_note_forbidden"],
    ["reviewer", "permission-denied", "owner_note_forbidden"],
    ["rate limit", "resource-exhausted", "owner_note_rate_limited"],
    ["missing building", "not-found", "owner_note_building_not_found"],
  ])("maps %s and performs no owner-note mutation", async (scenario, code, message) => {
    const role = scenario === "reviewer" ? "reviewer" : "staff";
    seedOwnerNoteAccess(role);
    let data = validOwnerNoteData();
    if (scenario === "unsafe input") data = { ...data, buildingId: "bad/path" };
    if (scenario === "unassigned staff") {
      registrations.pathValues.set(
        "fieldPlatform/buildingAssignments/building-1/staff-1",
        false,
      );
    }
    if (scenario === "rate limit") {
      registrations.pathValues.set(OWNER_RATE_PATH, {
        windowStartedAt: Date.now(),
        count: 30,
      });
    }
    if (scenario === "missing building") {
      registrations.pathValues.delete("fieldPlatform/buildings/building-1");
    }

    await expect(callableHandler(entrypoints.appendOwnerNote)(
      validOwnerCallableRequest(data, role),
    )).rejects.toMatchObject({ code, message });

    expect(registrations.pathValues.has(OWNER_NOTE_PATH)).toBe(false);
    expect(registrations.mutationPaths).not.toContain(OWNER_NOTE_PATH);
  });

  it("maps disabled authentication and unexpected database failures safely", async () => {
    seedOwnerNoteAccess();
    registrations.pathValues.set("fieldPlatform/users/staff-1", {
      enabled: false,
      role: "staff",
    });
    await expect(callableHandler(entrypoints.appendOwnerNote)(
      validOwnerCallableRequest(validOwnerNoteData()),
    )).rejects.toMatchObject({
      code: "permission-denied",
      message: "field_access_denied",
    });
    expect(registrations.mutationPaths).not.toContain(OWNER_NOTE_PATH);

    registrations.databaseGet.mockRejectedValueOnce(new Error("database_offline"));
    await expect(callableHandler(entrypoints.appendOwnerNote)(
      validOwnerCallableRequest(validOwnerNoteData()),
    )).rejects.toMatchObject({
      code: "internal",
      message: "owner_note_internal",
    });
  });

  it("maps malformed atomic archive results to internal, not invalid-argument", async () => {
    seedOwnerNoteAccess("admin");
    registrations.readSequences.set(OWNER_NOTE_PATH, [ownerNoteRecord()]);
    registrations.pathValues.set(OWNER_NOTE_PATH, ownerNoteRecord({
      archivedAt: "not-a-date",
      archivedBy: "admin-winner",
    }));

    await expect(callableHandler(entrypoints.archiveOwnerNote)(
      validOwnerCallableRequest(
        { buildingId: "building-1", noteId: "note_12345678" },
        "admin",
      ),
    )).rejects.toMatchObject({
      code: "internal",
      message: "owner_note_internal",
    });
  });

  it("rebuilds from transaction-current state instead of an obsolete pre-read candidate", async () => {
    await databaseHandler(
      entrypoints.rebuildMapProjectionOnBuildingWrite,
    )({
      id: EVENT_VERSION.revision,
      time: EVENT_VERSION.eventTime,
      params: { buildingId: "building-1" },
      data: {
        before: { val: () => null },
        after: { val: () => null },
      },
    });

    expect(
      registrations.rebuildMapProjectionForBuilding,
    ).toHaveBeenCalledWith("building-1", expect.any(Object));
    const call = registrations.rebuildMapProjectionForBuilding.mock.calls[0];
    expect(call).toHaveLength(2);
    const dependencies = call[1] as EventScopedProjectionDependencies;
    expect(dependencies.now()).toBe(EVENT_VERSION.eventTime);

    registrations.transactionCurrent.value = {
      buildings: {
        "building-1": {
          id: "building-1",
          name: "Current paused building",
          roadAddress: "1 Current-ro, Wonju",
          latitude: 37.369,
          longitude: 127.928,
          managementContract: {
            status: "paused",
            startedOn: "2026-08-01",
            updatedAt: "2026-08-09T12:00:03.000Z",
            updatedBy: "admin-1",
          },
        },
      },
      listings: {},
      media: {},
    };
    await dependencies.setProjection("building-1", {
      buildingId: "building-1",
      name: "Obsolete active projection",
      roadAddress: "1 Old-ro, Wonju",
      latitude: 37.369,
      longitude: 127.928,
      markerStatus: "managed",
      vacancyCount: 0,
      approvedRentSummary: "obsolete",
      parkingSummary: "obsolete",
      captureStatus: "notStarted",
      updatedAt: "2026-08-09T12:00:01.000Z",
    });

    expect(registrations.databaseRef).toHaveBeenCalledWith("fieldPlatform");
    expect(registrations.databaseTransaction).toHaveBeenCalledTimes(1);
    expect(registrations.transactionStates[0]).not.toHaveProperty(
      "mapProjections.building-1",
    );
    expect(registrations.transactionStates[0]).not.toHaveProperty(
      "mapProjectionVersions",
    );
  });

  it.each([
    ["listing", entrypoints.rebuildMapProjectionOnListingWrite],
    ["media", entrypoints.rebuildMapProjectionOnMediaWrite],
  ])(
    "refreshes both distinct path-safe building IDs once for a %s move",
    async (_name, trigger) => {
      const handler = databaseHandler(trigger);
      await handler({
        id: EVENT_VERSION.revision,
        time: EVENT_VERSION.eventTime,
        params: {},
        data: {
          before: { val: () => ({ buildingId: "building-before" }) },
          after: { val: () => ({ buildingId: "building-after" }) },
        },
      });

      expect(
        registrations.rebuildMapProjectionForBuilding.mock.calls.map(
          ([buildingId]) => buildingId,
        ),
      ).toEqual(["building-before", "building-after"]);
      expect(
        registrations.rebuildMapProjectionForBuilding,
      ).toHaveBeenCalledTimes(2);
      for (const call of registrations.rebuildMapProjectionForBuilding.mock.calls) {
        expect(call).toHaveLength(2);
        expect(
          (call[1] as EventScopedProjectionDependencies).now(),
        ).toBe(EVENT_VERSION.eventTime);
      }

      registrations.rebuildMapProjectionForBuilding.mockClear();
      await handler({
        id: EVENT_VERSION.revision,
        time: EVENT_VERSION.eventTime,
        params: {},
        data: {
          before: { val: () => ({ buildingId: "building-same" }) },
          after: { val: () => ({ buildingId: "building-same" }) },
        },
      });
      expect(
        registrations.rebuildMapProjectionForBuilding,
      ).toHaveBeenCalledTimes(1);
      expect(
        registrations.rebuildMapProjectionForBuilding,
      ).toHaveBeenCalledWith("building-same", expect.any(Object));
    },
  );

  it("ignores reversed CloudEvent IDs at the same timestamp", async () => {
    const handler = databaseHandler(
      entrypoints.rebuildMapProjectionOnBuildingWrite,
    );
    registrations.transactionCurrent.value = {
      buildings: {
        "building-1": {
          id: "building-1",
          name: "Authoritative same-time building",
          roadAddress: "1 Current-ro, Wonju",
          latitude: 37.369,
          longitude: 127.928,
          managementContract: {
            status: "active",
            startedOn: "2026-08-01",
            updatedAt: "2026-08-09T12:00:06.000Z",
            updatedBy: "admin-1",
          },
        },
      },
      listings: {},
      media: {},
    };

    for (const id of ["zzzz-event", "aaaa-event"]) {
      await handler({
        id,
        time: "2026-08-09T12:00:06.123456Z",
        params: { buildingId: "building-1" },
        data: {
          before: { val: () => null },
          after: { val: () => null },
        },
      });
      const call = registrations.rebuildMapProjectionForBuilding.mock.calls.at(-1);
      expect(call).toHaveLength(2);
      await (call?.[1] as EventScopedProjectionDependencies).setProjection(
        "building-1",
        { name: `obsolete-${id}` },
      );
    }

    expect(registrations.transactionCurrent.value).toMatchObject({
      mapProjections: {
        "building-1": {
          name: "Authoritative same-time building",
          updatedAt: "2026-08-09T12:00:06.123456Z",
        },
      },
    });
    expect(registrations.transactionCurrent.value).not.toHaveProperty(
      "mapProjectionVersions",
    );
  });
});
