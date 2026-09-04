import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, "../../desktop-crm/src/index.html");
const OUT = process.argv[2] || path.resolve(here, "out");
fs.mkdirSync(OUT, { recursive: true });

const store = {
  schemaVersion: 3,
  company: { name: "브링엔지니어링", ceo: "김대표", phone: "02-1234-5678" },
  customers: [
    { id: "c1", name: "한빛빌딩 관리단", phone: "010-2211-3344", memo: "정기 점검 고객", pipelineStage: "계약", buildingIds: ["b1"] },
    { id: "c2", name: "세종프라자", phone: "010-8899-1020", pipelineStage: "제안", buildingIds: ["b2"] },
    { id: "c3", name: "동백타워", phone: "010-5566-7788", pipelineStage: "상담", buildingIds: [] },
    { id: "c4", name: "그린오피스", phone: "010-3344-1122", pipelineStage: "리드", buildingIds: [] }
  ],
  buildings: [
    { id: "b1", name: "한빛빌딩", address: "서울 강남구 테헤란로 123", floors: 8, units: [
      { id: "u1", label: "201호", status: "임대중", area: "42㎡", rent: 1800000 },
      { id: "u2", label: "302호", status: "공실", area: "38㎡", rent: 1600000 },
      { id: "u3", label: "401호", status: "공실", area: "51㎡", rent: 2100000 }
    ] },
    { id: "b2", name: "세종프라자", address: "서울 마포구 월드컵북로 45", floors: 5, units: [
      { id: "u4", label: "101호", status: "임대중", area: "60㎡", rent: 2400000 }
    ] }
  ],
  contracts: [
    { id: "ct1", customerId: "c1", buildingId: "b1", title: "한빛빌딩 정기 미화", type: "정기관리", status: "진행", startDate: "2026-01-01", endDate: "2026-12-31", amount: 3600000 },
    { id: "ct2", customerId: "c2", buildingId: "b2", title: "세종프라자 소방점검", type: "단발", status: "검토", startDate: "2026-09-01", endDate: "2026-09-30", amount: 850000 }
  ],
  activities: [
    { id: "a1", customerId: "c1", type: "전화", memo: "9월 정기점검 일정 조율", createdAt: "2026-09-01T02:00:00.000Z" },
    { id: "a2", customerId: "c2", type: "방문", memo: "현장 실사 및 견적 협의", createdAt: "2026-09-02T05:30:00.000Z" }
  ],
  tasks: [
    { id: "t1", title: "세종프라자 견적서 발송", status: "진행", dueDate: "2026-09-06", customerId: "c2" },
    { id: "t2", title: "동백타워 첫 미팅 잡기", status: "대기", dueDate: "2026-09-08", customerId: "c3" }
  ],
  partnerVendors: [
    { id: "v1", name: "청우설비", industry: "설비", phone: "02-555-1212", memo: "야간 대응 가능" },
    { id: "v2", name: "한결미화", industry: "미화", phone: "02-777-3434" }
  ],
  partnerQuotes: [
    { id: "q1", vendorId: "v1", industry: "설비", title: "한빛빌딩 배관 보수", status: "접수", amount: 1200000 }
  ]
};

const stub = (data) => {
  window.bringCRM = {
    authState: async () => ({ required: false, user: { name: "김관리", email: "manager@bring.co.kr" } }),
    login: async () => ({ ok: true }),
    logout: async () => ({ ok: true }),
    changePassword: async () => ({ ok: true }),
    load: async () => data,
    save: async () => ({ ok: true, savedAt: new Date().toISOString() }),
    loadCanonicalBuildingUnits: async () => [],
    loadFieldSummaries: async () => [],
    loadDriveImportCandidates: async () => [],
    loadOperations: async () => ({ cases: [], payments: {}, caseSettings: {}, loadedAt: new Date().toISOString() }),
    loadWorkflowVendors: async () => [],
    loadFieldTeamProfiles: async () => [],
    dataPath: async () => "C:\\\\Users\\\\bring\\\\AppData\\\\Roaming\\\\bring-crm",
    updateState: async () => ({ status: "idle", currentVersion: "1.0.0" }),
    checkForUpdates: async () => ({ status: "idle" }),
    installUpdate: async () => ({ ok: true }),
    backup: async () => ({ ok: true }),
    restore: async () => ({ ok: true }),
    showFieldPlatform: async () => ({ ok: true }),
    hideFieldPlatform: async () => ({ ok: true }),
    setFieldBounds: async () => ({ ok: true }),
    fieldRequest: async () => ({ ok: true }),
    cancelFieldRequest: async () => ({ ok: true }),
    reconnectFieldPlatform: async () => ({ ok: true }),
    openExternal: async () => ({ ok: true }),
    lookupVendor: async () => ({ ok: false }),
    commitCanonicalCrmEntity: async () => ({ ok: true }),
    configureBuildingUnits: async () => ({ ok: true }),
    decideDriveImport: async () => ({ ok: true }),
    saveWorkflowCase: async () => ({ ok: true }),
    savePaymentOverride: async () => ({ ok: true }),
    savePaymentSchedule: async () => ({ ok: true }),
    deletePaymentSchedule: async () => ({ ok: true }),
    savePaymentBankBinding: async () => ({ ok: true }),
    runWorkflowAction: async () => ({ ok: true }),
    pickWorkflowFiles: async () => [],
    onShortcut: () => {},
    onAuthState: () => () => {},
    onSyncState: () => () => {},
    onUpdateState: () => () => {},
    onFieldEvent: () => () => {},
    onFieldState: () => () => {},
    onRemoteData: () => () => {},
    loginWithGoogle: async () => ({ ok: true })
  };
};

const VIEWS = process.env.VIEWS
  ? process.env.VIEWS.split(",")
  : ["dashboard", "customers", "buildings", "vacancies", "workManagement", "pipeline", "tasks", "contracts", "relationships", "partnerVendors", "partnerQuotes", "security", "settings"];

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.addInitScript(stub, store);
await page.goto(pathToFileURL(SRC).href);
await page.waitForSelector("#app:not(.app-locked)", { timeout: 15000 }).catch(() => console.log("app still locked"));
await page.waitForTimeout(900);

// 처음 사용 안내 모달이 뜨면 먼저 찍고 닫는다
if (await page.locator("#modal.open").count()) {
  await page.screenshot({ path: path.join(OUT, "00-guide-modal.png") });
  console.log("찍음: 00-guide-modal");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  if (await page.locator("#modal.open").count()) {
    const closer = page.locator('#modal [data-action="close-modal"], #modal button').last();
    if (await closer.count()) await closer.click({ force: true });
    await page.waitForTimeout(300);
  }
  await page.evaluate(() => {
    const m = document.getElementById("modal");
    if (m) { m.classList.remove("open"); m.setAttribute("aria-hidden", "true"); }
  });
}

for (const view of VIEWS) {
  const btn = page.locator(`.nav-item[data-view="${view}"]`);
  if (await btn.count()) {
    await btn.first().click();
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: path.join(OUT, `${view}.png`) });
  console.log("찍음:", view);
}
await browser.close();
