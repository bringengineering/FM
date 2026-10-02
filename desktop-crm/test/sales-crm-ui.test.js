const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const Sales = require("../src/sales-core");
const Standards = require("../src/sales-standards");
const SalesUI = require("../src/sales-ui");

const sampleStore = {
  salesProspects: [Sales.createSalesProspect({
    id: "spr_1", name: "대학로 원룸", address: "원주시 우산동 1",
    owner: "황우중", priority: "high", stage: "listing_received",
    vacancyCount: 1, upcomingVacancyCount: 1, nextAction: "광고 게시 확인",
    nextActionAt: "2026-08-13T03:00:00.000Z"
  })],
  salesContacts: [Sales.createSalesContact({
    id: "sct_1", prospectId: "spr_1", name: "건물주", phone: "010-1111-2222",
    source: "building_sign", verifiedAt: "2026-08-10T00:00:00.000Z"
  })],
  salesUnits: [Sales.createSalesUnit({ id: "sun_1", prospectId: "spr_1", label: "201호", status: "vacant" })],
  salesActivities: [],
  salesEvents: [Sales.createSalesEvent({
    id: "sev_1", prospectId: "spr_1", unitId: "sun_1", type: "listing_received",
    evidenceType: "broker_handoff", evidenceNote: "이지부동산 접수 확인",
    occurredAt: "2026-08-12T00:00:00.000Z"
  })],
  salesOpportunities: [Sales.createSalesOpportunity({
    id: "sop_1", prospectId: "spr_1", serviceType: "waterproofing", stage: "quote_requested",
    requirements: "지하실 방수", owner: "김현진"
  })]
};

test("sales pipeline renders an evidence-backed building dashboard and all 13 stage controls", () => {
  const html = SalesUI.renderPipeline({
    store: sampleStore,
    stages: Sales.SALES_STAGES,
    kpis: Sales.calculateKpis(sampleStore),
    selectedStage: "all",
    query: "",
    now: "2026-08-13T12:00:00.000Z"
  });

  assert.match(html, /공실 해결로 첫 관계를 만들고/);
  assert.match(html, /대학로 원룸/);
  assert.match(html, /매물접수/);
  assert.match(html, /오늘 후속/);
  assert.equal((html.match(/data-sales-stage-filter=/g) || []).length, 14);
  assert.match(html, /data-sales-prospect-open="spr_1"/);
  assert.match(html, /data-action="new-sales-prospect"/);
  assert.match(html, /data-action="open-sales-standards"/);
});

test("prospect detail keeps contacts, units, activity, outcomes and add-on work under one building", () => {
  const html = SalesUI.renderProspectDetail({
    prospect: sampleStore.salesProspects[0],
    contacts: sampleStore.salesContacts,
    units: sampleStore.salesUnits,
    activities: sampleStore.salesActivities,
    events: sampleStore.salesEvents,
    opportunities: sampleStore.salesOpportunities,
    stages: Sales.SALES_STAGES,
    writable: true
  });

  for (const label of ["건물 기본정보", "연락처", "호실", "영업 활동", "완료 증거", "추가서비스"]) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /지하실 방수/);
  assert.match(html, /data-sales-add-contact="spr_1"/);
  assert.match(html, /data-sales-add-unit="spr_1"/);
  assert.match(html, /data-sales-add-activity="spr_1"/);
  assert.match(html, /data-sales-add-event="spr_1"/);
  assert.match(html, /data-sales-add-opportunity="spr_1"/);
});

test("standards center exposes every script and checklist with approval warnings", () => {
  const html = SalesUI.renderStandards({ standards: Standards, query: "" });
  assert.equal((html.match(/data-sales-script=/g) || []).length, 12);
  assert.equal((html.match(/data-sales-checklist=/g) || []).length, 8);
  assert.match(html, /검증기준문 S1/);
  assert.match(html, /법률검토/);
  assert.match(html, /계약률이 아니라 매물접수 관찰치/);
});

test("prospect and evidence forms have visible labels and explicit save actions", () => {
  const prospectForm = SalesUI.renderProspectForm({ item: {}, crmBuildings: [], actor: "팀원" });
  const eventForm = SalesUI.renderEventForm({
    prospect: sampleStore.salesProspects[0],
    units: sampleStore.salesUnits,
    eventTypes: Standards.funnelEvents
  });

  assert.match(prospectForm, /<form[^>]+id="salesProspectForm"/);
  assert.match(prospectForm, /<span>건물명/);
  assert.match(prospectForm, /<span>주소/);
  assert.match(prospectForm, /건물 등록/);
  assert.match(eventForm, /<form[^>]+id="salesEventForm"/);
  assert.match(eventForm, /완료 증거/);
  assert.match(eventForm, /단계 완료 기록/);
});

test("desktop entry hides the pipeline menu while retaining sales modules inside the app", async () => {
  const html = await readFile(path.join(__dirname, "..", "src", "index.html"), "utf8");
  const app = await readFile(path.join(__dirname, "..", "src", "app.js"), "utf8");

  assert.equal((html.match(/data-view="pipeline"/g) || []).length, 0);
  assert.ok(html.indexOf("./sales-core.js") < html.indexOf("./sales-ui.js"));
  assert.ok(html.indexOf("./sales-standards.js") < html.indexOf("./sales-ui.js"));
  assert.ok(html.indexOf("./sales-ui.js") < html.indexOf("./app.js"));
  assert.match(html, /sales\.css/);
  assert.doesNotMatch(html, /sales-crm\.html/);
  assert.match(app, /store\.salesProspects/);
  assert.match(app, /new-sales-prospect/);
  assert.match(app, /salesProspectForm/);
  assert.doesNotMatch(app, /crm:sales-login|salesLogin/);
});

test("detail and event unit choices only include active records owned by the selected prospect", () => {
  const prospect = sampleStore.salesProspects[0];
  const shared = {
    contacts: [
      { id: "owned-contact", prospectId: prospect.id, name: "선택 건물 연락처" },
      { id: "foreign-contact", prospectId: "spr_2", name: "다른 건물 연락처" },
      { id: "orphan-contact", name: "소속 없는 연락처" }
    ],
    units: [
      { id: "owned-unit", prospectId: prospect.id, label: "선택 건물 201호", status: "vacant" },
      { id: "foreign-unit", prospectId: "spr_2", label: "다른 건물 301호", status: "vacant" },
      { id: "orphan-unit", label: "소속 없는 401호", status: "vacant" },
      { id: "archived-unit", prospectId: prospect.id, label: "보관된 501호", status: "vacant", archivedAt: "2026-08-01T00:00:00.000Z" }
    ],
    activities: [
      { id: "owned-activity", prospectId: prospect.id, summary: "선택 건물 활동" },
      { id: "foreign-activity", prospectId: "spr_2", summary: "다른 건물 활동" },
      { id: "orphan-activity", summary: "소속 없는 활동" }
    ],
    events: [
      { id: "owned-event", prospectId: prospect.id, type: "candidate_created", evidenceNote: "선택 건물 증거" },
      { id: "foreign-event", prospectId: "spr_2", type: "candidate_created", evidenceNote: "다른 건물 증거" },
      { id: "orphan-event", type: "candidate_created", evidenceNote: "소속 없는 증거" }
    ],
    opportunities: [
      { id: "owned-opportunity", prospectId: prospect.id, serviceType: "repair", requirements: "선택 건물 수리" },
      { id: "foreign-opportunity", prospectId: "spr_2", serviceType: "repair", requirements: "다른 건물 수리" },
      { id: "orphan-opportunity", serviceType: "repair", requirements: "소속 없는 수리" }
    ]
  };

  const detail = SalesUI.renderProspectDetail({ prospect, ...shared, stages: Sales.SALES_STAGES });
  for (const owned of ["선택 건물 연락처", "선택 건물 201호", "선택 건물 활동", "선택 건물 증거", "선택 건물 수리"]) {
    assert.match(detail, new RegExp(owned));
  }
  for (const unrelated of ["다른 건물", "소속 없는", "보관된 501호"]) {
    assert.doesNotMatch(detail, new RegExp(unrelated));
  }

  const form = SalesUI.renderEventForm({ prospect, units: shared.units, eventTypes: Standards.funnelEvents });
  assert.match(form, /value="owned-unit"/);
  assert.doesNotMatch(form, /foreign-unit|orphan-unit|archived-unit/);
});

test("Korean calendar dates preserve date-only input and convert timestamps at the UTC to KST midnight boundary", () => {
  const timestampProspect = {
    ...sampleStore.salesProspects[0],
    nextActionAt: "2026-08-13T15:30:00.000Z",
    lastActivityAt: "2026-08-12T15:30:00.000Z"
  };
  const timestampHtml = SalesUI.renderPipeline({
    store: { salesProspects: [timestampProspect] },
    stages: Sales.SALES_STAGES,
    kpis: {},
    now: "2026-08-13T14:30:00.000Z"
  });
  assert.match(timestampHtml, /예정/);
  assert.match(timestampHtml, /8월 14일/);
  assert.match(timestampHtml, /최근 활동[^<]*<\/span>\s*<time[^>]*>8월 13일 00:30<\/time>/);

  const dateOnlyHtml = SalesUI.renderPipeline({
    store: { salesProspects: [{ ...timestampProspect, nextActionAt: "2026-08-14", lastActivityAt: "" }] },
    stages: Sales.SALES_STAGES,
    kpis: {},
    now: "2026-08-13T15:30:00.000Z"
  });
  assert.match(dateOnlyHtml, /오늘/);
  assert.match(dateOnlyHtml, /8월 14일/);

  const form = SalesUI.renderProspectForm({ item: { nextActionAt: "2026-08-14" }, crmBuildings: [] });
  assert.match(form, /name="nextActionAt"[^>]+value="2026-08-14T00:00"/);
});

test("read-only pipeline omits every new-building action", () => {
  const html = SalesUI.renderPipeline({
    store: { salesProspects: [] },
    stages: Sales.SALES_STAGES,
    kpis: {},
    writable: false
  });

  assert.doesNotMatch(html, /data-action="new-sales-prospect"/);
  assert.match(html, /data-action="open-sales-standards"/);
});

test("owner dashboard exposes the full evidence funnel, period and team workload", () => {
  const kpis = {
    activeProspects: 11,
    contactedProspects: 10,
    respondedProspects: 9,
    qualifiedProspects: 8,
    meetingConfirmedProspects: 7,
    diagnosedProspects: 6,
    listingUnits: 5,
    adPublishedUnits: 4,
    leaseSignedUnits: 3,
    paidManagementProspects: 2,
    completedOpportunities: 2,
    revenueRecorded: 1230000,
    todayFollowUps: 2,
    overdueFollowUps: 1,
    activeProspectsByOwner: { 황우중: 4, 김현진: 3, 미지정: 4 }
  };
  const html = SalesUI.renderPipeline({
    store: sampleStore,
    stages: Sales.SALES_STAGES,
    kpis,
    periodLabel: "2026년 8월",
    boardMode: "focus"
  });

  for (const label of [
    "관리 대상 건물", "최초 접촉 시도", "응답 확인", "관심 확인", "미팅 확정", "현장 진단",
    "매물 접수", "광고 게시", "임대차 계약", "유료 관리", "부가서비스 완료", "기록 매출",
    "오늘 후속", "기한 지난 후속"
  ]) assert.match(html, new RegExp(label));
  assert.match(html, /2026년 8월/);
  assert.match(html, /1,230,000원/);
  assert.match(html, /담당자별 진행 건물/);
  assert.match(html, /황우중[^<]*<\/span>\s*<b>4건<\/b>/);
  assert.doesNotMatch(html, /접촉 완료/);
});

test("board mode controls switch between a focused list and a horizontally scrollable full 13-stage flow", () => {
  const focus = SalesUI.renderPipeline({
    store: sampleStore,
    stages: Sales.SALES_STAGES,
    kpis: {},
    boardMode: "focus"
  });
  assert.match(focus, /data-sales-board-mode="focus"[^>]+aria-pressed="true"/);
  assert.match(focus, /data-sales-board-mode="flow"[^>]+aria-pressed="false"/);
  assert.doesNotMatch(focus, /data-sales-flow-stage=/);

  const flow = SalesUI.renderPipeline({
    store: sampleStore,
    stages: Sales.SALES_STAGES,
    kpis: {},
    boardMode: "flow"
  });
  assert.match(flow, /class="sales-flow-board"/);
  assert.equal((flow.match(/data-sales-flow-stage=/g) || []).length, 13);
  assert.match(flow, /data-sales-board-mode="flow"[^>]+aria-pressed="true"/);
  assert.match(flow, /data-sales-flow-stage="listing_received"/);
  assert.match(flow, /대학로 원룸/);
});

test("prospect detail exposes evidence links and record audit context without new edit actions", () => {
  const html = SalesUI.renderProspectDetail({
    prospect: { ...sampleStore.salesProspects[0], createdBy: "대표", createdAt: "2026-08-12T15:30:00.000Z", updatedBy: "김현진", updatedAt: "2026-08-13T01:00:00.000Z" },
    contacts: [],
    units: sampleStore.salesUnits,
    activities: [{
      id: "act_1", prospectId: "spr_1", channel: "sms", result: "replied", summary: "공실 1실 확인",
      owner: "황우중", scriptId: "S1", scriptVersion: "1.0", occurredAt: "2026-08-12T15:30:00.000Z",
      createdBy: "황우중", createdAt: "2026-08-12T15:31:00.000Z"
    }],
    events: [{
      id: "evt_1", prospectId: "spr_1", unitId: "sun_1", type: "listing_received",
      evidenceType: "broker_handoff", evidenceNote: "중개법인 접수 확인", evidenceUrl: "https://example.com/evidence",
      owner: "대표", occurredAt: "2026-08-13T01:00:00.000Z", createdBy: "대표", createdAt: "2026-08-13T01:01:00.000Z"
    }],
    opportunities: [{
      id: "opp_1", prospectId: "spr_1", serviceType: "waterproofing", requirements: "지하 방수",
      stage: "work_completed", vendorId: "vendor_1", quoteId: "quote_1", workflowCaseId: "case_1",
      evidenceUrl: "https://example.com/work", owner: "김현진", workCompletedAt: "2026-08-13T02:00:00.000Z",
      createdBy: "김현진", createdAt: "2026-08-12T02:00:00.000Z"
    }],
    stages: Sales.SALES_STAGES,
    writable: false
  });

  assert.match(html, /증거 보기/);
  assert.match(html, /href="https:\/\/example\.com\/evidence"/);
  assert.match(html, /중개법인 전달 확인|broker_handoff/);
  assert.match(html, /S1[^<]*·[^<]*v1\.0/);
  assert.match(html, /기록 황우중/);
  assert.match(html, /업체 vendor_1/);
  assert.match(html, /견적 quote_1/);
  assert.match(html, /업무 case_1/);
  assert.match(html, /작업 증거/);
  assert.doesNotMatch(html, /data-sales-edit-(?:activity|event)/);
});

test("evidence records show approved Korean evidence labels and app-routable links", () => {
  const evidenceTypes = [
    ["broker_handoff", "중개법인 전달 확인"],
    ["broker_confirmation", "협력 공인중개사 계약완료 확인"],
    ["management_start", "유료관리 시작 확인"],
    ["service_contract", "관리 서비스 계약서"]
  ];
  const html = SalesUI.renderProspectDetail({
    prospect: sampleStore.salesProspects[0],
    contacts: [],
    units: sampleStore.salesUnits,
    activities: [],
    events: evidenceTypes.map(([evidenceType], index) => ({
      id: `evt_${index}`,
      prospectId: "spr_1",
      type: index === 0 ? "listing_received" : index === 1 ? "lease_signed" : "paid_management_started",
      evidenceType,
      evidenceNote: `증거 ${index + 1}`,
      evidenceUrl: `https://example.com/evidence/${index + 1}`,
      occurredAt: `2026-08-13T0${index}:00:00.000Z`
    })),
    opportunities: [],
    stages: Sales.SALES_STAGES,
    writable: false
  });

  for (const [code, label] of evidenceTypes) {
    assert.match(html, new RegExp(label));
    assert.doesNotMatch(html, new RegExp(`>${code}<`));
  }
  assert.equal((html.match(/data-sales-evidence-link=/g) || []).length, evidenceTypes.length);
  assert.match(html, /data-sales-evidence-link="https:\/\/example\.com\/evidence\/1"/);
});

test("resume history and every stored evidence code render as Korean business labels", () => {
  const evidenceTypes = [
    ["resume_reason", "영업 재개 사유"],
    ["note", "확인 메모"],
    ["url", "증거 링크"],
    ["crm_record", "CRM 등록 기록"]
  ];
  const html = SalesUI.renderProspectDetail({
    prospect: sampleStore.salesProspects[0],
    contacts: [], units: [], activities: [], opportunities: [], stages: Sales.SALES_STAGES,
    events: evidenceTypes.map(([evidenceType], index) => ({
      id: `evt_code_${index}`,
      prospectId: "spr_1",
      type: index === 0 ? "prospect_resumed" : "prospect_created",
      resumeStage: index === 0 ? "replied" : "",
      evidenceType,
      evidenceNote: `확인 ${index + 1}`,
      occurredAt: `2026-08-13T0${index}:00:00.000Z`
    })),
    writable: false
  });

  assert.match(html, />영업 재개<\/strong>/);
  for (const [code, label] of evidenceTypes) {
    assert.match(html, new RegExp(label));
    assert.doesNotMatch(html, new RegExp(`>${code}<`));
  }
  assert.doesNotMatch(html, /증거 유형 미입력/);
});

test("event history offers archive and restore without permanent deletion only to writers", () => {
  const events = [
    { id: "evt_active", prospectId: "spr_1", type: "listing_received", evidenceNote: "활성 증거", occurredAt: "2026-08-13T01:00:00.000Z" },
    { id: "evt_archived", prospectId: "spr_1", type: "ad_published", evidenceNote: "보관 증거", occurredAt: "2026-08-13T02:00:00.000Z", archivedAt: "2026-08-13T03:00:00.000Z" }
  ];
  const input = {
    prospect: sampleStore.salesProspects[0], contacts: [], units: [], activities: [], events, opportunities: [], stages: Sales.SALES_STAGES
  };
  const writable = SalesUI.renderProspectDetail({ ...input, writable: true });
  assert.match(writable, /data-sales-event-archive="evt_active"/);
  assert.match(writable, /data-sales-event-restore="evt_archived"/);
  assert.match(writable, /data-sales-prospect-id="spr_1"/);
  assert.match(writable, /보관됨/);
  assert.doesNotMatch(writable, /data-sales-event-delete|>삭제</);

  const readOnly = SalesUI.renderProspectDetail({ ...input, writable: false });
  assert.match(readOnly, /보관 증거/);
  assert.doesNotMatch(readOnly, /data-sales-event-(?:archive|restore)/);
});

test("activity history offers archive and restore without permanent deletion only to writers", () => {
  const activities = [
    { id: "act_active", prospectId: "spr_1", channel: "call", result: "replied", summary: "활성 활동", occurredAt: "2026-08-13T01:00:00.000Z" },
    { id: "act_archived", prospectId: "spr_1", channel: "sms", result: "follow_up", summary: "보관 활동", occurredAt: "2026-08-13T02:00:00.000Z", archivedAt: "2026-08-13T03:00:00.000Z" }
  ];
  const input = {
    prospect: sampleStore.salesProspects[0], contacts: [], units: [], activities, events: [], opportunities: [], stages: Sales.SALES_STAGES
  };
  const writable = SalesUI.renderProspectDetail({ ...input, writable: true });
  assert.match(writable, /data-sales-activity-archive="act_active"/);
  assert.match(writable, /data-sales-activity-restore="act_archived"/);
  assert.match(writable, /보관 활동/);
  assert.match(writable, /보관됨/);
  assert.doesNotMatch(writable, /data-sales-activity-delete|>삭제</);

  const readOnly = SalesUI.renderProspectDetail({ ...input, writable: false });
  assert.match(readOnly, /보관 활동/);
  assert.doesNotMatch(readOnly, /data-sales-activity-(?:archive|restore)/);
});

test("paused or closed prospects expose an explicit resume action only to writers", () => {
  const input = {
    prospect: { ...sampleStore.salesProspects[0], stage: "paused_closed" },
    contacts: [], units: [], activities: [], events: [], opportunities: [], stages: Sales.SALES_STAGES
  };
  const writable = SalesUI.renderProspectDetail({ ...input, writable: true });
  assert.match(writable, /data-sales-resume-prospect="spr_1"[^>]*>영업 재개</);

  const readOnly = SalesUI.renderProspectDetail({ ...input, writable: false });
  assert.doesNotMatch(readOnly, /data-sales-resume-prospect/);

  const active = SalesUI.renderProspectDetail({ ...input, prospect: sampleStore.salesProspects[0], writable: true });
  assert.doesNotMatch(active, /data-sales-resume-prospect/);
});

test("standards center renders optional operating principles, handoff, safer wording, metrics and approval version", () => {
  const html = SalesUI.renderStandards({ standards: Standards, query: "" });

  for (const value of [
    "운영 원칙", "공실을 첫 문제로 푼다", "팀 인계 기준", "고객 질문 원문",
    "금지 표현과 안전한 대안", "공실 조건을 확인한 뒤 가능한 모집 절차와 진행상황을 안내드리겠습니다",
    "측정 지표", "기간 안에 유효한 contact_attempted 완료증거가 있는 건물의 고유 수",
    "검토본 · 문서 버전 1.0", "대표 승인 및 법률검토 진행 중", "대외 문자·전화·광고 문구는 대표 승인"
  ]) assert.match(html, new RegExp(value));
  assert.doesNotMatch(html, /승인본 1\.0/);
  assert.equal((html.match(/data-sales-script=/g) || []).length, 12);
  assert.equal((html.match(/data-sales-checklist=/g) || []).length, 8);
  assert.doesNotMatch(html, /BRING SALES STANDARD|PoC/);
});

test("sales typography keeps owner-facing text readable and muted text at WCAG AA contrast", async () => {
  const css = await readFile(path.join(__dirname, "..", "src", "sales.css"), "utf8");
  const fontSizes = [...css.matchAll(/font-size:\s*(\d+)px/g)].map(match => Number(match[1]));
  assert.ok(fontSizes.every(size => size >= 13), `found undersized text: ${fontSizes.filter(size => size < 13).join(", ")}`);
  assert.match(css, /\.sales-crm\s*\{[^}]*font-size:\s*16px/s);

  function channel(hex) {
    const value = Number.parseInt(hex, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }
  function contrast(hex) {
    const rgb = hex.slice(1).match(/.{2}/g).map(channel);
    const luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    return 1.05 / (luminance + 0.05);
  }
  const muted = css.match(/--sales-text-muted:\s*(#[0-9a-f]{6})/i)?.[1];
  assert.ok(muted && contrast(muted) >= 4.5, `muted contrast was ${muted ? contrast(muted) : "missing"}`);
});

test("sales forms fit inside the existing modal without a horizontal scrollbar", async () => {
  const css = await readFile(path.join(__dirname, "..", "src", "sales.css"), "utf8");
  assert.match(css, /\.sales-form\s*\{[^}]*width:\s*100%[^}]*max-width:\s*860px/s);
  assert.doesNotMatch(css, /\.sales-form\s*\{[^}]*width:\s*min\(860px,\s*92vw\)/s);
  assert.match(css, /\.sales-form-grid\s*>\s*\*\s*\{[^}]*min-width:\s*0/s);
});

test("archived sales history preserves full text contrast without whole-row opacity", async () => {
  const css = await readFile(path.join(__dirname, "..", "src", "sales.css"), "utf8");
  const archivedRule = css.match(/\.sales-timeline li\.archived\s*\{([^}]*)\}/s)?.[1] || "";
  assert.ok(archivedRule, "archived history styling is missing");
  assert.doesNotMatch(archivedRule, /opacity\s*:/);
  assert.match(archivedRule, /background\s*:/);
  assert.match(archivedRule, /(?:border|box-shadow)\s*:/);
  assert.match(css, /\.sales-timeline li\.archived\s*>\s*time\s*\{[^}]*color\s*:[^;}]+[^}]*font-weight\s*:/s);
  assert.match(css, /\.sales-timeline li\.archived\s+\.sales-state-label\s*\{[^}]*color\s*:/s);
});
