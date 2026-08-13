const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const modulePath = path.join(__dirname, "..", "src", "sales-standards.js");

test("sales standards expose the same API through CommonJS and the browser global", async () => {
  const standards = require(modulePath);
  const source = await readFile(modulePath, "utf8");
  const sandbox = {};

  vm.runInNewContext(source, sandbox);

  assert.equal(sandbox.BringSalesStandards.doctrine, standards.doctrine);
  assert.equal(sandbox.BringSalesStandards.scripts.length, 12);
  assert.equal(sandbox.BringSalesStandards.checklists.length, 8);
});

test("contains every S1-S12 script with source approval state and safety markers", () => {
  const { scripts } = require(modulePath);
  const expectedStatuses = {
    S1: "법률검토",
    S2: "법률검토",
    S3: "법률검토",
    S4: "초안",
    S5: "초안",
    S6: "법률검토",
    S7: "초안",
    S8: "초안",
    S9: "초안",
    S10: "법률검토",
    S11: "법률검토",
    S12: "초안",
  };

  assert.deepEqual(scripts.map(script => script.id), Object.keys(expectedStatuses));
  for (const script of scripts) {
    for (const field of [
      "id", "version", "name", "situation", "channel", "status", "objective", "text",
      "guardrails", "forbiddenPhrases", "nextStep", "event", "isApproved",
      "requiresLegalReview", "usageWarning",
    ]) {
      assert.ok(Object.hasOwn(script, field), `${script.id} is missing ${field}`);
    }
    assert.equal(script.status, expectedStatuses[script.id]);
    assert.equal(script.isApproved, false);
    assert.equal(script.requiresLegalReview, script.status === "법률검토");
    assert.match(script.usageWarning, /대외 실사용 금지/);
    assert.ok(script.text.trim().length > 0);
    assert.ok(script.guardrails.length > 0);
    assert.ok(script.forbiddenPhrases.length > 0);
  }

  const s1 = scripts[0];
  assert.equal(s1.version, "1.0");
  assert.equal(s1.name, "검증기준문 S1");
  assert.equal(s1.situation, "공실 확인 문자");
  assert.equal(s1.channel, "문자");
  assert.match(s1.text, /건물주분께는 별도의 중개보수를 받지 않으며/);
  assert.deepEqual(s1.forbiddenPhrases, [
    "무조건 임대됩니다",
    "오늘만 무료",
    "수신거부해도 다시 연락드리겠습니다",
  ]);
  assert.equal(s1.event, "response_received");
});

test("contains every CL01-CL08 checklist and its required-item rules", () => {
  const { checklists } = require(modulePath);
  const expected = [
    ["CL01", "건물조사", 5, 5],
    ["CL02", "최초접촉", 5, 5],
    ["CL03", "상담", 6, 5],
    ["CL04", "현장진단", 6, 5],
    ["CL05", "대표인계", 6, 5],
    ["CL06", "후속조치", 5, 3],
    ["CL07", "광고등록 준비", 5, 5],
    ["CL08", "거절·수신거부 처리", 4, 4],
  ];

  assert.deepEqual(
    checklists.map(checklist => [
      checklist.id,
      checklist.title,
      checklist.items.length,
      checklist.items.filter(item => item.required).length,
    ]),
    expected,
  );

  for (const checklist of checklists) {
    assert.ok(checklist.purpose);
    assert.ok(checklist.completionRule);
    for (const item of checklist.items) {
      assert.deepEqual(Object.keys(item), ["id", "label", "required"]);
      assert.equal(typeof item.required, "boolean");
    }
  }
});

test("provides the complete sales code catalogs", () => {
  const { catalogs } = require(modulePath);
  const ids = key => catalogs[key].map(item => item.id);

  assert.deepEqual(ids("responseCodes"), ["R1", "R2", "R3", "R4", "R5", "R6"]);
  assert.deepEqual(ids("channels"), ["CH_SMS", "CH_CALL", "CH_VISIT", "CH_BROKER", "CH_KARROT", "CH_BLOG", "CH_SHOP"]);
  assert.deepEqual(ids("contactSources"), ["SRC_BUILDING", "SRC_REFERRAL", "SRC_BROKER", "SRC_INBOUND"]);
  assert.deepEqual(ids("results"), ["RES_ACTIVE", "RES_HOLD", "RES_WON", "RES_LOST"]);
  assert.deepEqual(ids("failureReasons"), ["FAIL_NO_NEED", "FAIL_NO_CONSENT", "FAIL_PRICE", "FAIL_EXISTING_VENDOR", "FAIL_LEGAL_GATE", "FAIL_OTHER"]);
  assert.deepEqual(ids("services"), ["SV_RENTAL", "SV_MANAGEMENT", "SV_CLEAN", "SV_REPAIR", "SV_VENDOR"]);
  assert.deepEqual(ids("opportunityStatuses"), ["OPP_VACANT", "OPP_SCHEDULED", "OPP_AD_PROGRESS", "OPP_QUOTE", "OPP_UNCONFIRMED"]);
});

test("defines every evidence-backed funnel event", () => {
  const { funnelEvents } = require(modulePath);
  const expectedEvents = [
    "building_surveyed", "valid_contact_found", "contact_attempted", "response_received",
    "qualified_interest", "meeting_booked", "diagnosis_completed", "listing_intake",
    "ad_posted", "tenant_inquiry", "property_visit", "lease_signed",
    "paid_management_started", "addon_opportunity_created", "quote_requested",
    "quote_approved", "work_completed", "addon_revenue_booked",
  ];

  assert.deepEqual(funnelEvents.map(item => item.event), expectedEvents);
  assert.deepEqual(Object.keys(funnelEvents[0]), ["event", "label", "evidence"]);
  assert.deepEqual(funnelEvents[0], {
    event: "building_surveyed",
    label: "건물조사",
    evidence: "건물ID·주소·유형·수요거점",
  });
  assert.deepEqual(funnelEvents.at(-1), {
    event: "addon_revenue_booked",
    label: "추가매출",
    evidence: "작업완료 후 발행·입금 또는 미수금 매출기록",
  });
  assert.ok(funnelEvents.every(item => item.label && item.evidence));
});

test("keeps the vacancy-first doctrine and labels the PoC baseline correctly", () => {
  const { doctrine, pocBaseline } = require(modulePath);

  assert.equal(doctrine, "공실 해결로 첫 관계를 만들고, 임대관리 성과를 보여준 뒤 청소·수리·건물관리로 확장한다.");
  assert.equal(pocBaseline.sampleContactCount, 50);
  assert.deepEqual(pocBaseline.listingIntakeCountRange, [5, 6]);
  assert.deepEqual(pocBaseline.listingIntakeRateRange, [0.10, 0.12]);
  assert.equal(pocBaseline.metricName, "매물접수 반응률");
  assert.equal(pocBaseline.mustNotCallThis, "임대차계약률");
  assert.match(pocBaseline.note, /50건 접촉.*5~6건.*10~12%/);
  assert.match(pocBaseline.note, /임대차계약률이 아니다/);
  assert.match(pocBaseline.caveat, /응답률·계약률 기준값으로 사용하지 않는다/);
});

test("defines representative principles, handoff gates, safe language and KPI formulas", () => {
  const { governance, principles, handoffRules, phraseGuidance, metricDefinitions } = require(modulePath);

  assert.equal(governance.version, "1.0");
  assert.match(governance.externalUseRule, /대표 승인.*법률검토/);

  assert.deepEqual(principles.map(item => item.id), ["P1", "P2", "P3", "P4", "P5", "P6"]);
  assert.ok(principles.every(item => item.title && item.rule && item.ownerQuestion));

  assert.deepEqual(handoffRules.map(item => item.id), ["H1", "H2", "H3", "H4", "H5", "H6"]);
  assert.ok(handoffRules.every(item => item.from && item.to && item.trigger && item.requiredEvidence.length));
  assert.match(handoffRules.find(item => item.id === "H2").trigger, /법률|계약|매물/);

  assert.ok(phraseGuidance.length >= 6);
  assert.ok(phraseGuidance.every(item => item.forbidden && item.safe && item.reason));
  assert.ok(phraseGuidance.some(item => item.forbidden === "법적으로 문제없습니다" && /공인중개사/.test(item.safe)));

  const metricIds = metricDefinitions.map(item => item.id);
  for (const id of [
    "activeProspects", "contactedProspects", "respondedProspects", "qualifiedProspects",
    "meetingProspects", "diagnosedProspects", "listingUnits", "adsPublished",
    "leasesSigned", "paidManagement", "completedOpportunities", "revenueRecorded",
    "todayFollowUps", "overdueFollowUps",
  ]) assert.ok(metricIds.includes(id), `missing metric ${id}`);
  assert.ok(metricDefinitions.every(item => item.label && item.formula && item.unit && item.evidence));
});
