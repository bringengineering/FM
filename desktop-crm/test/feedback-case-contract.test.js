const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Core = require("../src/core");
const { FirebaseRemoteClient } = require("../src/remote");

const appSource = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
const coreSource = fs.readFileSync(path.join(__dirname, "../src/core.js"), "utf8");
const remoteSource = fs.readFileSync(path.join(__dirname, "../src/remote.js"), "utf8");
const intakeSource = fs.readFileSync(path.join(__dirname, "../../apps-script/complaint-intake-to-firebase.gs"), "utf8");

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `${startMarker} should exist`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `${endMarker} should follow ${startMarker}`);
  return source.slice(start, end);
}

test("complaints expose an explicit owner/BRING party enum in create and edit flows", () => {
  const renderCaseDetail = sourceBetween(appSource, "function renderWorkflowCaseDetail", "function renderWorkflowCaseTrashDetail");
  const createCaseEditor = sourceBetween(appSource, "function workflowCaseEditor", "const SALES_SOURCE_LABELS");
  const caseSave = sourceBetween(remoteSource, "async saveWorkflowCase", "async savePaymentOverride");

  assert.match(appSource, /let casePartyFilter\s*=\s*["']전체["']/);
  assert.match(createCaseEditor, /caseParty/);
  assert.match(renderCaseDetail, /caseParty/);
  assert.match(appSource, /["']건물주["'][\s\S]{0,120}["']브링["']/);
  assert.match(caseSave, /caseParty\s*:\s*\d+/);
  assert.match(caseSave, /\[[^\]]*["']건물주["'][^\]]*["']브링["'][^\]]*\]\.includes\([^)]*caseParty[^)]*\)/);
});

test("complaint party filtering keeps legacy records visible and labels them unclassified", () => {
  const renderCases = sourceBetween(appSource, "function renderCases", "function renderWorkflowCaseDetail");

  assert.match(renderCases, /casePartyFilter\s*===\s*["']전체["']/);
  assert.match(renderCases, /casePartyFilter/);
  assert.match(renderCases, /caseParty/);
  assert.match(renderCases, /미분류/);
  assert.match(renderCases, /data-case-party-filter/);

  // Older cases have no caseParty. They must not be silently reassigned to either side.
  assert.doesNotMatch(appSource, /(?:item|fields|raw)\.caseParty\s*=\s*["'](?:건물주|브링)["']/);
  assert.doesNotMatch(remoteSource, /patch\.caseParty\s*=\s*["'](?:건물주|브링)["']/);
});

test("contract tabs derive recurring versus single from billingCycle", () => {
  const renderContracts = sourceBetween(appSource, "function renderContracts", "function relationshipState");

  assert.match(appSource, /let contractPaymentModeFilter\s*=/);
  assert.match(renderContracts, /contractPaymentModeFilter/);
  assert.match(renderContracts, /정기 납부/);
  assert.match(renderContracts, /단건 계약/);
  assert.match(renderContracts, /billingCycle\s*===\s*["']건별["']/);
  assert.match(renderContracts, /data-contract-payment-mode-filter/);

  // A false branch must classify monthly, annual, missing, and other legacy values as recurring.
  assert.match(
    renderContracts,
    /billingCycle\s*===\s*["']건별["']\s*\?\s*["'](?:single|단건 계약)["']\s*:\s*["'](?:recurring|정기 납부)["']/
  );
});

test("single-contract tabs do not introduce a second persisted contract kind", () => {
  const createContract = sourceBetween(coreSource, "function createContract", "function createPartnerQuote");
  const contractSubmit = sourceBetween(appSource, 'form.id === "contractForm"', 'form.id === "customerForm"');

  assert.match(createContract, /billingCycle\s*:\s*["']월 정기["']/);
  assert.match(contractSubmit, /billingCycle\s*:\s*raw\.billingCycle/);
  assert.doesNotMatch(createContract, /\b(?:contractKind|paymentMode|contractPaymentMode)\s*:/);
  assert.doesNotMatch(contractSubmit, /\b(?:contractKind|paymentMode|contractPaymentMode)\s*:/);
});

test("contract save safely normalizes fields hidden by unselected contract types", () => {
  const contractSubmit = sourceBetween(appSource, 'form.id === "contractForm"', 'form.id === "customerForm"');
  for (const field of ["serviceFrequency", "managementTarget", "feeMethod", "memo", "scope", "owner"]) {
    assert.match(contractSubmit, new RegExp(`String\\(raw\\.${field} \\|\\| ""\\)\\.trim\\(\\)`));
  }
  assert.doesNotMatch(contractSubmit, /raw\.(?:serviceFrequency|managementTarget|feeMethod|memo|scope|owner)\.trim\(\)/);
});

test("single-contract tab reuses the existing one-off settlement fields and flows", () => {
  const contractEditor = sourceBetween(appSource, "function contractEditor", "function industryChecklistFields");
  const contractSubmit = sourceBetween(appSource, 'form.id === "contractForm"', 'form.id === "customerForm"');

  assert.match(contractEditor, /oneOff\s*\|\|\s*contractPaymentModeFilter\s*===\s*["']single["']/);
  assert.match(contractEditor, /editing\s*\?\s*editing\.billingCycle\s*===\s*["']건별["']/);
  assert.match(contractEditor, /billingCycle\s*:\s*isOneOff\s*\?\s*["']건별["']\s*:\s*["']월 정기["']/);
  for (const fieldName of ["workDate", "paymentDueDate", "vendorCost", "collectionStatus", "vendorPaymentStatus"]) {
    assert.match(contractEditor, new RegExp(`(?:field|selectField)\\([^\\n]+["']${fieldName}["']`));
    assert.match(contractSubmit, new RegExp(`raw\\.${fieldName}`));
  }
  assert.match(contractSubmit, /raw\.billingCycle\s*===\s*["']건별["'][\s\S]{0,160}raw\.workDate[\s\S]{0,80}raw\.paymentDueDate/);
  assert.match(contractSubmit, /contractPaymentModeFilter\s*=\s*item\.billingCycle\s*===\s*["']건별["']\s*\?\s*["']single["']\s*:\s*["']recurring["']/);
  assert.match(appSource, /action\s*===\s*["']new-one-off-contract["'][\s\S]{0,80}contractEditor\(["']["']\s*,\s*true\)/);
});

test("recurring contracts hide and discard one-off settlement values", () => {
  const contractEditor = sourceBetween(appSource, "function contractEditor", "function industryChecklistFields");
  const contractSubmit = sourceBetween(appSource, 'form.id === "contractForm"', 'form.id === "customerForm"');
  const recurring = Core.normalizeContract({
    id: "regular_contract",
    billingCycle: "월 정기",
    workDate: "2026-08-01",
    paymentDueDate: "2026-08-05",
    vendorCost: 100,
    grossProfit: 200,
    collectionStatus: "입금 완료",
    vendorPaymentStatus: "지급 완료"
  });

  assert.match(contractEditor, /data-one-off-contract-fields/);
  assert.match(contractEditor, /isOneOff\s*\?\s*["']{2}\s*:\s*["']hidden["']/);
  assert.match(appSource, /function refreshContractPaymentFields[\s\S]*?section\.hidden\s*=\s*!oneOff/);
  assert.match(contractSubmit, /oneOffContract[\s\S]*?else for \(const fieldName of \[[^\]]*workDate[^\]]*vendorPaymentStatus/);
  for (const field of ["workDate", "paymentDueDate", "vendorCost", "grossProfit", "collectionStatus", "vendorPaymentStatus"]) {
    assert.equal(Object.hasOwn(recurring, field), false, `${field} must not remain on a recurring contract`);
  }
});

test("automatic customer complaint intake is classified as building-owner authored", () => {
  const payload = sourceBetween(intakeSource, "function buildCasePayload_", "function writeAnalysisToSheet_");
  assert.match(payload, /caseParty\s*:\s*["']건물주["']/);
});

function workflowCaseClient(calls) {
  const client = new FirebaseRemoteClient({
    Core,
    databaseRoot: "crmCompany",
    firebaseConfig: { apiKey: "test-key", databaseUrl: "https://example.invalid" },
    fs: {},
    safeStorage: {},
    shell: {},
    sessionFile: "session.json",
    pendingFile: "pending.json",
    readLocalStore: async () => Core.blankStore(),
    writeLocalStore: async () => {},
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined });
      return { ok: true, status: 200, text: async () => "" };
    }
  });
  client.session = {
    idToken: "test-token",
    refreshToken: "test-refresh",
    expiresAt: Date.now() + 60_000,
    uid: "uid-admin",
    email: "admin@bring.local",
    displayName: "관리자",
    role: "admin",
    mustChangePassword: false
  };
  return client;
}

test("remote case creation requires a party while legacy unclassified edits may omit it", async () => {
  const calls = [];
  const client = workflowCaseClient(calls);

  await assert.rejects(
    client.saveWorkflowCase({ create: true, fields: { name: "신규 민원", building: "테스트 건물" } }),
    error => error && error.code === "INVALID_CASE_PARTY"
  );
  await assert.rejects(
    client.saveWorkflowCase({ create: true, fields: { caseParty: "외부", name: "신규 민원", building: "테스트 건물" } }),
    error => error && error.code === "INVALID_CASE_PARTY"
  );
  await assert.rejects(
    client.saveWorkflowCase({ caseKey: "classified_case_01", fields: { caseParty: "", summary: "분류 삭제 시도" } }),
    error => error && error.code === "INVALID_CASE_PARTY"
  );
  assert.equal(calls.length, 0);

  const legacy = await client.saveWorkflowCase({ caseKey: "legacy_case_01", fields: { summary: "기존 미분류 민원 수정" } });
  assert.equal(Object.prototype.hasOwnProperty.call(legacy.patch, "caseParty"), false);
  assert.equal(calls.length, 1);
});
