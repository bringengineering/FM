// @vitest-environment node

import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { deleteApp, initializeApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signOut } from "firebase/auth";
import { get, ref, remove, set } from "firebase/database";
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PROJECT_ID = "demo-bring-cleaning-functions";
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const DATABASE_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
const FUNCTIONS_HOST = process.env.BRING_CLEANING_FUNCTIONS_EMULATOR_HOST;
const ENABLED = Boolean(AUTH_HOST && DATABASE_HOST && FUNCTIONS_HOST);
const email = `cleaning-${Date.now()}@bring.test`;
const customerId = "customer_integration_demo";
const buildingId = "building_integration_demo";
const requestId = randomUUID();

let environment: RulesTestEnvironment;
let app: ReturnType<typeof initializeApp>;
let idToken = "";
type CleaningRemoteClient = {
  session: { uid: string; email: string; role: string; mustChangePassword: boolean; idToken: string; expiresAt: number } | null;
  markSessionStarted(): unknown;
  createCleaningOrder(input: object): Promise<{ replayed: boolean; order: { id: string; revision: number; status: string }; wallboardProjectionUpdated: boolean }>;
  loadCleaningOrders(cursor?: { createdAt: string; id: string } | null): Promise<{ orders: Array<{ id: string; customerId: string; buildingId: string }>; hasMore: boolean; nextCursor: { createdAt: string; id: string } | null }>;
  transitionCleaningOrder(input: object): Promise<{ replayed: boolean; order: { id: string; revision: number; status: string }; wallboardProjectionUpdated: boolean }>;
  saveWorkOrder(input: object): Promise<Record<string, unknown>>;
  saveWorkReport(input: object): Promise<Record<string, unknown>>;
  loadCleaningQuoteSet(orderId: string): Promise<{ quoteSet: { latestRevision: number; latestQuoteId: string; revisions: Record<string, { status: string; totalAmount: number; reviewHistory: Array<{ action: string }> }> } | null }>;
  createCleaningQuoteRevision(input: object): Promise<{ replayed: boolean; quote: { id: string; revision: number; buildingId: string; previousQuoteId: string; totalAmount: number; status: string } }>;
  reviewCleaningQuote(input: object): Promise<{ replayed: boolean; quote: { id: string; revision: number; status: string; reviewHistory: Array<{ action: string }> } }>;
};
let remoteClient: CleaningRemoteClient;
let cleaningOrderIpc: {
  load(cursor?: { createdAt: string; id: string } | null): ReturnType<CleaningRemoteClient["loadCleaningOrders"]>;
  create(input: object): ReturnType<CleaningRemoteClient["createCleaningOrder"]>;
  transition(input: object): ReturnType<CleaningRemoteClient["transitionCleaningOrder"]>;
  loadQuotes(orderId: string): ReturnType<CleaningRemoteClient["loadCleaningQuoteSet"]>;
  createQuoteRevision(input: object): ReturnType<CleaningRemoteClient["createCleaningQuoteRevision"]>;
  reviewQuote(input: object): ReturnType<CleaningRemoteClient["reviewCleaningQuote"]>;
};

describe.runIf(ENABLED)("cleaning order authenticated Functions + Firebase emulator flow", () => {
  beforeAll(async () => {
    const authPort = Number(AUTH_HOST!.split(":").at(-1) || 9099);
    const databasePort = Number(DATABASE_HOST!.split(":").at(-1) || 9000);
    const functionsPort = Number(FUNCTIONS_HOST!.split(":").at(-1) || 5001);
    const emulatorOnlyFetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const target = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      if (target.protocol !== "http:" || target.hostname !== "127.0.0.1"
        || ![String(authPort), String(databasePort), String(functionsPort)].includes(target.port)) {
        throw new Error("Refusing to send CRM integration-test traffic outside the loopback Auth, Database, and Functions emulators.");
      }
      if (target.port === String(databasePort)) target.searchParams.set("ns", PROJECT_ID);
      return globalThis.fetch(target, init);
    };
    environment = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      database: {
        host: "127.0.0.1",
        port: databasePort,
        rules: await readFile(resolve("../database.rules.json"), "utf8"),
      },
    });

    app = initializeApp({ apiKey: "demo-api-key", authDomain: "localhost", projectId: PROJECT_ID }, `cleaning-integration-${Date.now()}`);
    const auth = getAuth(app);
    connectAuthEmulator(auth, `http://${AUTH_HOST}`);
    const credential = await createUserWithEmailAndPassword(auth, email, "LocalOnlyTest-Password-123!");
    const sendVerification = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=demo-api-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestType: "VERIFY_EMAIL", idToken: await credential.user.getIdToken() }),
    });
    expect(sendVerification.ok).toBe(true);
    const pendingCodes = await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/oobCodes`);
    const codes = (await pendingCodes.json() as { oobCodes?: Array<{ email: string; oobCode: string; requestType: string }> }).oobCodes || [];
    const verificationCode = codes.find(code => code.email === email && code.requestType === "VERIFY_EMAIL")?.oobCode;
    expect(verificationCode).toBeTruthy();
    const verifyResponse = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:update?key=demo-api-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oobCode: verificationCode }),
    });
    expect(verifyResponse.ok).toBe(true);
    expect((await verifyResponse.json() as { emailVerified?: boolean }).emailVerified).toBe(true);
    idToken = await credential.user.getIdToken(true);
    expect(idToken).not.toBe("");
    const require = createRequire(import.meta.url);
    const { FirebaseRemoteClient } = require("../../../desktop-crm/src/remote.js") as {
      FirebaseRemoteClient: new (options: Record<string, unknown>) => CleaningRemoteClient;
    };
    remoteClient = new FirebaseRemoteClient({
      Core: {}, fs: {}, safeStorage: {}, shell: {}, sessionFile: "", pendingFile: "",
      firebaseConfig: { databaseUrl: `http://127.0.0.1:${databasePort}` },
      fetchImpl: emulatorOnlyFetch,
      cleaningOrdersEndpoint: `http://${FUNCTIONS_HOST}/${PROJECT_ID}/asia-northeast3/cleaningOrdersApi`,
    });
    remoteClient.session = {
      uid: credential.user.uid,
      email,
      role: "admin",
      mustChangePassword: false,
      idToken,
      expiresAt: Date.now() + 60 * 60 * 1000,
    };
    remoteClient.markSessionStarted();
    const { createCleaningOrderIpcHandlers } = require("../../../desktop-crm/src/cleaning-order-ipc.js") as {
      createCleaningOrderIpcHandlers(dependencies: { getRemoteClient: () => CleaningRemoteClient; isLocalTestMode: () => boolean }): typeof cleaningOrderIpc;
    };
    cleaningOrderIpc = createCleaningOrderIpcHandlers({ getRemoteClient: () => remoteClient, isLocalTestMode: () => false });

    await environment.withSecurityRulesDisabled(async context => {
      const database = context.database();
      await Promise.all([
        remove(ref(database, "crmCompany/cleaningOrders")),
        remove(ref(database, "crmCompany/cleaningOrderQuotes")),
        remove(ref(database, "crmCompany/workReports")),
        remove(ref(database, "crmCompany/workOrders")),
        remove(ref(database, "crmCompany/wallboard/cleaningOperations")),
      ]);
      await set(ref(database, `crmCompany/access/${credential.user.uid}`), { enabled: true, email, role: "admin" });
      await set(ref(database, "crmCompany/access/crm-admin"), { enabled: true, email: "admin@bring.test", role: "admin" });
      await set(ref(database, `crmCompany/data/customers/${customerId}`), { id: customerId, buildingIds: [buildingId] });
      await set(ref(database, `crmCompany/data/buildings/${buildingId}`), { id: buildingId });
    });
  });

  afterAll(async () => {
    await environment?.cleanup();
    if (app) {
      await signOut(getAuth(app)).catch(() => undefined);
      await deleteApp(app);
    }
  });

  it("creates once through authenticated Functions, lists the result, and keeps raw storage client-denied", async () => {
    const endpoint = `http://${FUNCTIONS_HOST}/${PROJECT_ID}/asia-northeast3/cleaningOrdersApi`;
    const baselineProjection: { value: { total?: number; open?: number; completed?: number; byStatus?: { completed?: number } } | null } = { value: null };
    await environment.withSecurityRulesDisabled(async context => {
      baselineProjection.value = (await get(ref(context.database(), "crmCompany/wallboard/cleaningOperations"))).val() as typeof baselineProjection.value;
    });
    const createInput = {
      requestId,
      customerId,
      buildingId,
      serviceType: "stair_cleaning",
      title: "에뮬레이터 주문 연결 검증",
      desiredDate: "2026-09-26",
      description: "실제 운영 데이터가 아닌 로컬 에뮬레이터 전용",
    };
    const created = await cleaningOrderIpc.create(createInput);
    expect(created).toMatchObject({ replayed: false, order: { id: requestId, revision: 1, status: "received" }, wallboardProjectionUpdated: true });
    const replayedCreate = await cleaningOrderIpc.create(createInput);
    expect(replayedCreate).toMatchObject({ replayed: true, order: { id: requestId, revision: 1, status: "received" } });

    const listed = await cleaningOrderIpc.load();
    expect(listed.orders).toContainEqual(expect.objectContaining({ id: requestId, customerId, buildingId }));

    const transitionInput = {
      requestId: "9d95a940-1637-42b6-87ee-80e33a3ba6e8",
      orderId: requestId,
      expectedRevision: 1,
      nextStatus: "reviewing",
      note: "에뮬레이터 단계 변경 검증",
    };
    const transitioned = await cleaningOrderIpc.transition(transitionInput);
    expect(transitioned).toMatchObject({
      wallboardProjectionUpdated: true,
      replayed: false,
      order: { id: requestId, revision: 2, status: "reviewing" },
    });
    const replayedTransition = await cleaningOrderIpc.transition(transitionInput);
    expect(replayedTransition).toMatchObject({ replayed: true, order: { id: requestId, revision: 2, status: "reviewing" } });

    const crmDatabase = environment.authenticatedContext("crm-admin", { email: "admin@bring.test", email_verified: true }).database();
    const workOrderId = `work_${randomUUID()}`;
    const linkedWorkOrder = {
      id: workOrderId,
      title: "현장 청소 및 사진 확인",
      why: "접수된 청소 주문의 현장 작업을 진행합니다.",
      what: "요청 범위를 확인하고 작업 결과를 기록합니다.",
      doneWhen: "결과보고서와 증빙을 저장하고 검수를 요청합니다.",
      assigneeUid: "integration-worker",
      assigneeName: "테스트 담당자",
      projectId: "",
      track: "ops",
      cleaningOrderId: requestId,
      buildingId,
      startDate: "",
      dueDate: "2026-09-28",
      hours: 2,
      weight: 100,
      deliverableKind: "none",
      deliverable: "현장 결과보고",
      deliverableCount: 0,
      progress: 0,
      status: "assigned",
      reviewNote: "",
      latestProgressUpdateId: "",
      createdBy: "통합 테스트 관리자",
      createdAt: "2026-09-26T12:00:00.000Z",
      updatedAt: "2026-09-26T12:00:00.000Z",
      updatedBy: "crm-admin",
    };
    await remoteClient.saveWorkOrder(linkedWorkOrder);
    const savedWorkOrder = (await get(ref(crmDatabase, `crmCompany/workOrders/${workOrderId}`))).val();
    expect(savedWorkOrder).toMatchObject({ id: workOrderId, cleaningOrderId: requestId, buildingId, status: "assigned" });
    await assertFails(set(ref(crmDatabase, "crmCompany/workOrders/work_wrong_building"), {
      ...linkedWorkOrder,
      id: "work_wrong_building",
      buildingId: "another_building",
      cleaningOrderId: requestId,
    }));

    const reportId = `report_${randomUUID()}`;
    const linkedReport = {
      id: reportId,
      cleaningOrderId: requestId,
      buildingId,
      kind: "stairs",
      workDate: "2026-09-26",
      items: ["stairFloor", "handrail", "stairWindow", "light", "entrance", "recycle"].map(key => ({
        key,
        status: "partial",
      })),
      updatedAt: "2026-09-26T12:30:00.000Z",
      updatedBy: "crm-admin",
    };
    await remoteClient.saveWorkReport(linkedReport);
    const savedReport = (await get(ref(crmDatabase, `crmCompany/workReports/${reportId}`))).val();
    expect(savedReport).toMatchObject({
      id: reportId,
      cleaningOrderId: requestId,
      buildingId,
      kind: "stairs",
      category: "single",
      categoryEtc: "",
      ownerContact: "",
      followUp: "",
    });
    await assertFails(set(ref(crmDatabase, "crmCompany/workReports/report_wrong_building"), {
      ...linkedReport,
      id: "report_wrong_building",
      buildingId: "another_building",
    }));

    let expectedRevision = 2;
    for (const [index, nextStatus] of ["quote_pending", "approval_pending", "scheduled", "in_progress"].entries()) {
      await cleaningOrderIpc.transition({
        requestId: randomUUID(),
        orderId: requestId,
        expectedRevision,
        nextStatus,
        note: `합성 통합 테스트: ${nextStatus}`,
      });
      expectedRevision += 1;
    }

    const stairChecklist = ["stairFloor", "handrail", "stairWindow", "light", "entrance", "recycle"];
    const completedReport = {
      ...linkedReport,
      updatedAt: new Date().toISOString(),
      items: stairChecklist.map(key => ({
        key, label: key, status: "done",
        before: [{ id: `${key}-before`, driveFileId: `${key}-before-drive`, webViewLink: `https://drive.google.com/file/d/${key}-before-drive/view` }],
        after: [{ id: `${key}-after`, driveFileId: `${key}-after-drive`, webViewLink: `https://drive.google.com/file/d/${key}-after-drive/view` }],
      })),
    };
    await cleaningOrderIpc.transition({
      requestId: randomUUID(), orderId: requestId,
      expectedRevision, nextStatus: "review_pending", note: "보고서와 증빙 검수 요청",
    });
    expectedRevision += 1;
    await expect(cleaningOrderIpc.transition({
      requestId: randomUUID(), orderId: requestId,
      expectedRevision, nextStatus: "completed", note: "증빙 확인 전에는 막혀야 함",
    })).rejects.toThrow(/결과보고서/u);
    await cleaningOrderIpc.transition({
      requestId: randomUUID(), orderId: requestId,
      expectedRevision, nextStatus: "revision_requested", note: "필수 항목과 사진을 보완해 주세요.",
    });
    expectedRevision += 1;
    await cleaningOrderIpc.transition({
      requestId: randomUUID(), orderId: requestId,
      expectedRevision, nextStatus: "in_progress", note: "증거 자료 보완 재개",
    });
    expectedRevision += 1;
    completedReport.updatedAt = new Date().toISOString();
    await remoteClient.saveWorkReport(completedReport);
    await cleaningOrderIpc.transition({
      requestId: randomUUID(), orderId: requestId,
      expectedRevision, nextStatus: "review_pending", note: "보완 완료 후 재검수 요청",
    });
    expectedRevision += 1;
    const completed = await cleaningOrderIpc.transition({
      requestId: randomUUID(), orderId: requestId,
      expectedRevision, nextStatus: "completed", note: "체크리스트와 전후 사진 확인 완료",
    });
    expect(completed).toMatchObject({ order: { status: "completed", revision: expectedRevision + 1 } });
    await assertFails(set(ref(crmDatabase, `crmCompany/workReports/${reportId}`), {
      ...completedReport,
      updatedAt: new Date(Date.now() + 1000).toISOString(),
    }));

    const client = environment.authenticatedContext("integration-client", { email, email_verified: true }).database();
    await assertFails(get(ref(client, `crmCompany/cleaningOrders/${requestId}`)));

    await environment.withSecurityRulesDisabled(async context => {
      const stored = (await get(ref(context.database(), `crmCompany/cleaningOrders/${requestId}`))).val();
      expect(stored).toMatchObject({ id: requestId, revision: 11, customerId, buildingId, status: "completed" });
      const projection = (await get(ref(context.database(), "crmCompany/wallboard/cleaningOperations"))).val();
      expect(projection).toMatchObject({ schemaVersion: 1 });
      expect(projection.total).toBe((baselineProjection.value?.total || 0) + 1);
      expect(projection.completed).toBe((baselineProjection.value?.completed || 0) + 1);
      expect(projection.open).toBe(baselineProjection.value?.open || 0);
      expect(projection.byStatus.completed).toBe(projection.completed);
      expect(JSON.stringify(projection)).not.toMatch(new RegExp(`${customerId}|${buildingId}|${requestId}|${email}`, "u"));
    });
  }, 15_000);

  it("persists quote revisions through the authenticated IPC bridge and restricts final review to admins", async () => {
    const orderId = randomUUID();
    const createInput = {
      requestId: orderId,
      customerId,
      buildingId,
      serviceType: "stair_cleaning",
      title: "견적 서버 검증",
      desiredDate: "2026-09-28",
      description: "로컬 에뮬레이터 데이터",
    };
    await cleaningOrderIpc.create(createInput);
    for (const [index, nextStatus] of ["reviewing", "quote_pending"] .entries()) {
      await cleaningOrderIpc.transition({
        requestId: randomUUID(),
        orderId,
        expectedRevision: index + 1,
        nextStatus,
        note: "합성 통합 테스트 상태 전이",
      });
    }
    await environment.withSecurityRulesDisabled(async context => {
      const storedOrder = (await get(ref(context.database(), `crmCompany/cleaningOrders/${orderId}`))).val();
      expect(storedOrder).toMatchObject({ id: orderId, revision: 3, status: "quote_pending", buildingId });
    });

    const quoteSnapshot = {
      quoteDate: "2026-09-26",
      validUntil: "2026-10-03",
      recipient: "통합 테스트 고객",
      recipientPhone: "010-1234-5678",
      siteAddress: "테스트 주소",
      projectName: "공용부 계단 청소",
      service: "계단 청소",
      summary: "테스트 범위 내 청소 견적",
      items: [{ name: "계단 청소", detail: "공용 계단 1개 동", quantity: 2, unit: "회", unitPrice: 50000, note: "" }],
      taxIncluded: true,
      notes: [],
      company: {},
    };
    const quoteOneId = randomUUID();
    const quoteOneInput = { requestId: quoteOneId, orderId, expectedRevision: 0, quote: quoteSnapshot };
    let first;
    try {
      first = await cleaningOrderIpc.createQuoteRevision(quoteOneInput);
    } catch (error) {
      const storedQuoteSet = await environment.withSecurityRulesDisabled(async context =>
        (await get(ref(context.database(), `crmCompany/cleaningOrderQuotes/${orderId}`))).val());
      throw new Error(`${error instanceof Error ? error.message : String(error)}; quoteSet=${JSON.stringify(storedQuoteSet)}`);
    }
    expect(first).toMatchObject({ replayed: false, quote: { id: quoteOneId, revision: 1, buildingId, totalAmount: 100000, status: "pending_review" } });
    expect(await cleaningOrderIpc.createQuoteRevision(quoteOneInput)).toMatchObject({ replayed: true, quote: { revision: 1 } });

    const quoteSetAfterCreate = await cleaningOrderIpc.loadQuotes(orderId);
    expect(quoteSetAfterCreate.quoteSet).toMatchObject({ latestRevision: 1, latestQuoteId: quoteOneId });

    await environment.withSecurityRulesDisabled(async context => {
      await set(ref(context.database(), `crmCompany/access/${remoteClient.session!.uid}`), { enabled: true, email, role: "member" });
    });
    const forbiddenReview = await fetch(`http://${FUNCTIONS_HOST}/${PROJECT_ID}/asia-northeast3/cleaningOrdersApi`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ action: "quote-review", input: {
        requestId: randomUUID(), orderId, quoteId: quoteOneId,
        expectedRevision: 1, action: "approve", note: "구성원 승인 시도",
      } }),
    });
    expect(forbiddenReview.status).toBe(403);
    await environment.withSecurityRulesDisabled(async context => {
      await set(ref(context.database(), `crmCompany/access/${remoteClient.session!.uid}`), { enabled: true, email, role: "admin" });
    });

    const returned = await cleaningOrderIpc.reviewQuote({
      requestId: randomUUID(), orderId, quoteId: quoteOneId,
      expectedRevision: 1, action: "return", note: "범위 확인이 필요합니다.",
    });
    expect(returned).toMatchObject({ replayed: false, quote: { status: "returned", reviewHistory: [{ action: "return" }] } });
    const quoteTwoId = randomUUID();
    const second = await cleaningOrderIpc.createQuoteRevision({
      requestId: quoteTwoId, orderId, expectedRevision: 1,
      quote: { ...quoteSnapshot, summary: "수정된 견적 범위" },
    });
    expect(second).toMatchObject({ replayed: false, quote: { revision: 2, previousQuoteId: quoteOneId, status: "pending_review" } });
    const approved = await cleaningOrderIpc.reviewQuote({
      requestId: randomUUID(), orderId, quoteId: quoteTwoId,
      expectedRevision: 2, action: "approve", note: "확인 완료",
    });
    expect(approved).toMatchObject({ replayed: false, quote: { revision: 2, status: "admin_approved", reviewHistory: [{ action: "approve" }] } });
    const finalSet = await cleaningOrderIpc.loadQuotes(orderId);
    expect(finalSet.quoteSet).toMatchObject({ latestRevision: 2, latestQuoteId: quoteTwoId });
    expect(finalSet.quoteSet?.revisions[quoteOneId]).toMatchObject({ revision: 1, totalAmount: 100000, status: "returned" });
    expect(finalSet.quoteSet?.revisions[quoteTwoId]).toMatchObject({ revision: 2, totalAmount: 100000, status: "admin_approved" });
  }, 20_000);
});
