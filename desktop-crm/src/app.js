(() => {
  "use strict";

  const Core = window.BringCore;
  const Sales = window.BringSalesCore;
  const SalesUI = window.BringSalesUI;
  const SalesStandards = window.BringSalesStandards;
  const DriveImportUI = window.BringDriveImportUI;
  const WorkManagement = window.BringWorkManagement;
  const WorkCalendar = window.BringWorkCalendar;
  const ServiceOperationsUI = window.BringServiceOperationsUI;
  const api = window.bringCRM;
  const main = document.getElementById("main");
  const modal = document.getElementById("modal");
  const modalContent = document.getElementById("modalContent");
  const drawer = document.getElementById("drawer");
  const drawerContent = document.getElementById("drawerContent");
  const confirmationLayer = document.getElementById("confirmationLayer");
  const confirmationCard = document.getElementById("confirmationCard");
  const confirmationContent = document.getElementById("confirmationContent");
  const toastEl = document.getElementById("toast");
  const searchEl = document.getElementById("globalSearch");
  const appShell = document.getElementById("app");
  const loginGate = document.getElementById("loginGate");
  const loginTitle = document.getElementById("loginTitle");
  const loginDescription = document.getElementById("loginDescription");
  const loginForm = document.getElementById("emailLoginForm");
  const googleLoginButton = document.getElementById("googleLoginButton");
  const loginEmail = document.getElementById("loginEmail");
  const loginPassword = document.getElementById("loginPassword");
  const loginButton = document.getElementById("emailLoginButton");
  const passwordChangeForm = document.getElementById("passwordChangeForm");
  const passwordChangeButton = document.getElementById("passwordChangeButton");
  const newPassword = document.getElementById("newPassword");
  const confirmPassword = document.getElementById("confirmPassword");
  const loginMessage = document.getElementById("loginMessage");
  const userPill = document.getElementById("userPill");
  const updateButton = document.getElementById("updateButton");
  const primaryActionButton = document.getElementById("primaryActionButton");
  const fieldOperatorControl = document.getElementById("fieldOperatorControl");
  const fieldOperatorSelect = document.getElementById("fieldOperatorSelect");

  let store = Core.blankStore();
  let currentView = "dashboard";
  let lastRenderedView = null;
  let selectedCustomerId = "";
  let selectedBuildingId = "";
  let selectedVacancyBuildingId = "";
  let vacancyStatusFilter = "attention";
  let vacancyUnitQuery = "";
  const vacancyUnitSaveLocks = new Set();
  const buildingScheduleCommitLocks = new Set();
  let selectedSalesProspectId = "";
  let selectedCustomerDrawerMode = "customer";
  let saveTimer = null;
  let toastTimer = null;
  let activeConfirmation = null;
  let customerSalesStageFilter = "all";
  let salesStageFilter = "all";
  let salesBoardMode = "focus";
  let contractTypeFilter = "전체";
  let contractStatusFilter = "전체";
  let partnerVendorIndustryFilter = "전체 업종";
  let partnerQuoteIndustryFilter = "전체 업종";
  let partnerQuoteStatusFilter = "전체";
  let taskStatusFilter = "전체";
  let workFilters = { status: "all", buildingId: "all", serviceType: "all" };
  let workCalendarMonth = Core.dayKey().slice(0, 7);
  let workCalendarDate = Core.dayKey();
  let workCalendarBuildingId = "all";
  let workCalendarQuery = "";
  let securityTab = "assets";
  let dataPath = "";
  let currentAuth = { required: true, user: null, error: "" };
  let currentSync = { status: "offline", message: "서버 연결 확인 중" };
  let currentUpdate = { status: "disabled", currentVersion: "", availableVersion: "", percent: 0, message: "" };
  let queuedSave = null;
  let saveInFlight = false;
  let pendingRemoteStore = null;
  let synchronizedStore = null;
  let appInitialized = false;
  let overlayRefreshPromise = null;
  let driveImportCandidates = [];
  let driveImportRefreshPromise = null;
  let driveImportRefreshSequence = 0;
  let authGeneration = 0;
  let buildingLookupSequence = 0;
  let loginInProgress = false;
  let operations = { cases: [], payments: {}, caseSettings: {}, loadedAt: "" };
  let operationsLoading = false;
  let operationsError = "";
  let workflowVendors = [];
  let workflowVendorError = "";
  let workflowActionKey = "";
  let paymentMonth = Core.dayKey().slice(0, 7);
  let paymentBuildingFilter = "all";
  let paymentMode = "recurring";
  let selectedCaseKey = "";
  let openCaseStepKey = "";
  let caseListMode = "active";
  let fieldTeamProfiles = [];
  let fieldProfilesAvailable = false;
  let fieldProfilesError = "";
  let selectedFieldOperatorId = "";
  let fieldConnectionState = { status: "idle", message: "현장 업무를 준비하고 있습니다.", ready: false, pendingUploads: { count: 0, risk: "none" } };
  let fieldNavigationState = { route: "/field?embedded=crm", selectedJobId: "", filter: {}, scrollTop: 0, search: "" };
  let fieldResizeObserver = null;
  let fieldOpenGeneration = 0;
  let fieldReauthInProgress = false;
  let fieldSearchTimer = null;
  let crmSearchValue = "";
  const sessionViewedCustomers = new Set();

  const viewMeta = {
    dashboard: ["오늘의 업무", "한눈에 보기"],
    cases: ["접수부터 사후관리까지", "케이스"],
    payments: ["건물별 납부 예정과 입금 확인", "입금 캘린더"],
    customers: ["고객 정보", "고객 관리"],
    buildings: ["건물별 업무를 한곳에서", "건물 관리"],
    vacancies: ["층별 호실과 입퇴실 예정", "공실 현황"],
    buildingCalendar: ["건물별 일정을 날짜로 확인", "업무일정 캘린더"],
    workManagement: ["예정부터 완료·비용·증빙까지", "작업관리"],
    fieldOperations: ["BRING FIELD", "현장 업무"],
    consultations: ["전화·방문·미팅 내용", "상담 기록"],
    pipeline: ["건물 발굴부터 유료관리 전환까지", "영업 관리"],
    contracts: ["유형별 계약 조건과 기간", "계약 관리"],
    relationships: ["계약 후에도 이어지는 관계", "계약 고객 관리"],
    partnerVendors: ["연락할 업체 정보를 한곳에서", "연락 업체"],
    partnerQuotes: ["가격과 상담 내용을 한곳에서", "업체 상담"],
    tasks: ["놓치지 말아야 할 후속조치", "영업 할 일"],
    security: ["운영매뉴얼 DATA-01", "정보·열쇠 관리"],
    settings: ["프로그램 관리", "설정"]
  };

  const BUILDING_MAINTENANCE_ITEMS = Core.BUILDING_MAINTENANCE_INCLUDES;
  const BUILDING_ROOM_LAYOUTS = Core.BUILDING_ROOM_TYPES;
  const BUILDING_ROOM_OPTIONS = Core.BUILDING_ROOM_OPTIONS;
  const VACANCY_STATUS_ORDER = Object.freeze(["all", "vacant", "move_out_scheduled", "occupied", "maintenance", "unknown"]);
  const VACANCY_STATUS_LABELS = Object.freeze({
    all: "전체", occupied: "입주 중", vacant: "공실", move_out_scheduled: "공실 예정", maintenance: "정비 중", unknown: "확인 필요"
  });
  const VACANCY_FILTER_ORDER = Object.freeze(["all", "attention", "vacant", "move_out_scheduled", "occupied", "maintenance", "unknown"]);
  const VACANCY_FILTER_LABELS = Object.freeze({ ...VACANCY_STATUS_LABELS, attention: "공실·예정" });

  const INDUSTRY_CHECKLISTS = Object.freeze({
    "누수": [
      ["symptom", "누수 위치·증상 확인"], ["inspectionFee", "탐지비 별도 여부"], ["noFind", "미탐지 시 비용"],
      ["meter", "계량기 구조·추가비용"], ["pressure", "압력검사 포함"], ["repair", "배관 보수 범위"],
      ["finish", "타일·마감 포함"], ["travel", "출장비"], ["warranty", "A/S·재탐지 보증"]
    ],
    "설비·배관": [
      ["site", "배관 위치·재질 확인"], ["diagnosis", "내시경·압력검사"], ["labor", "공임 분리"], ["material", "자재비 분리"],
      ["replacement", "교체 범위"], ["finish", "마감 복구"], ["travel", "출장비"], ["warranty", "하자보증"]
    ],
    "전기·조명": [
      ["license", "전기 자격·등록 확인"], ["diagnosis", "고장 진단비"], ["labor", "공임 분리"], ["material", "자재·제품비 분리"],
      ["breaker", "차단기·배선 범위"], ["disposal", "기존 제품 폐기"], ["travel", "출장비"], ["warranty", "하자보증"]
    ],
    "청소": [
      ["area", "면적·호실 수 확인"], ["scope", "청소 범위"], ["window", "창틀·유리 포함"], ["kitchen", "주방·화장실 포함"],
      ["waste", "폐기물 처리"], ["pollution", "심한 오염 추가비"], ["supplies", "약품·장비 포함"], ["revisit", "재방문 기준"]
    ],
    "타일·방수": [
      ["area", "시공 면적 확인"], ["demolition", "기존 마감 철거"], ["waterproof", "방수층 범위"], ["material", "자재 등급"],
      ["waste", "폐기물 처리"], ["curing", "양생 기간"], ["finish", "마감 복구"], ["warranty", "누수·들뜸 보증"]
    ],
    "도배·장판": [
      ["area", "평수·벽면 상태"], ["removal", "기존 마감 철거"], ["material", "자재 등급"], ["mold", "곰팡이·결로 처리"],
      ["furniture", "가구 이동"], ["waste", "폐기물 처리"], ["schedule", "시공 기간"], ["warranty", "들뜸·하자보증"]
    ],
    "보일러·냉난방": [
      ["model", "제품 모델·용량"], ["diagnosis", "점검비"], ["parts", "부품비·공임 분리"], ["removal", "기존 제품 철거"],
      ["installation", "설치·배관 포함"], ["efficiency", "에너지효율"], ["travel", "출장비"], ["warranty", "제조사·시공 A/S"]
    ],
    "소방": [
      ["license", "전문업 등록 확인"], ["scope", "점검 범위"], ["legal", "법정점검 해당 여부"], ["report", "점검 보고서"],
      ["replacement", "교체 품목·단가"], ["schedule", "처리 일정"], ["insurance", "배상책임보험"], ["followup", "재점검 조건"]
    ],
    "CCTV·보안": [
      ["equipment", "카메라·녹화기 사양"], ["installation", "설치·배선비"], ["storage", "영상 저장기간"], ["remote", "원격 확인"],
      ["notice", "개인정보 안내판"], ["network", "인터넷 비용"], ["maintenance", "유지보수비"], ["warranty", "장비·시공 A/S"]
    ],
    "방역": [
      ["area", "면적·대상 해충"], ["chemical", "사용 약제"], ["safety", "인체·반려동물 안전"], ["visits", "방문 횟수"],
      ["revisit", "재방문 기준"], ["certificate", "소독증명서"], ["schedule", "작업 시간"], ["warranty", "효과 보증기간"]
    ],
    "폐기물": [
      ["volume", "물량·중량 확인"], ["vehicle", "차량 규격"], ["loading", "상차 인력 포함"], ["transport", "운반비 포함"],
      ["processing", "처리비 포함"], ["stairs", "계단·거리 추가비"], ["certificate", "처리 확인서"], ["schedule", "수거 일정"]
    ],
    "기타": [
      ["scope", "작업 범위"], ["diagnosis", "점검·상담비"], ["labor", "공임"], ["material", "자재비"],
      ["travel", "출장비"], ["schedule", "작업 일정"], ["warranty", "A/S 조건"], ["documents", "영수증·증빙"]
    ]
  });

  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const attr = esc;
  const initials = value => String(value || "고객").replace(/\s/g, "").slice(0, 1).toUpperCase();
  const customerPhoneText = value => Core.formatPhone(value);
  const formattedPhoneInputSelector = "#customerForm [data-customer-phone], #partnerVendorForm [data-partner-vendor-phone]";

  function customerPhoneSearchKey(value) {
    const text = String(value || "").normalize("NFKC").trim();
    if (!text || !/^[+\d\s().-]+$/.test(text)) return "";
    const formatted = customerPhoneText(text);
    const digits = Core.normalizePhone(formatted);
    if (digits.startsWith("00")) return "";
    if (digits.length < 3 || !digits.startsWith("0") && !/^1(?:5|6|8)/.test(digits)) return "";
    if (text.startsWith("+") && formatted === text) return "";
    return digits;
  }

  function customerPhoneCandidateKey(value) {
    return Core.canonicalPhoneKey(value) || Core.normalizePhone(value);
  }

  function customerPhoneCaret(formatted, digitOffset) {
    if (!digitOffset) return 0;
    let seenDigits = 0;
    for (let index = 0; index < formatted.length; index += 1) {
      if (/\d/.test(formatted[index])) seenDigits += 1;
      if (seenDigits === digitOffset) return index + 1;
    }
    return formatted.length;
  }

  function formatCustomerPhoneInput(input) {
    const original = String(input && input.value || "");
    const selectionStart = Number.isInteger(input && input.selectionStart) ? input.selectionStart : original.length;
    const selectionEnd = Number.isInteger(input && input.selectionEnd) ? input.selectionEnd : selectionStart;
    const digitsBeforeStart = Core.normalizePhone(original.slice(0, selectionStart).normalize("NFKC")).length;
    const digitsBeforeEnd = Core.normalizePhone(original.slice(0, selectionEnd).normalize("NFKC")).length;
    const formatted = customerPhoneText(original);
    if (formatted === original) return;
    input.value = formatted;
    if (typeof input.setSelectionRange !== "function") return;
    const formattedDigits = Core.normalizePhone(formatted).length;
    input.setSelectionRange(
      customerPhoneCaret(formatted, Math.min(digitsBeforeStart, formattedDigits)),
      customerPhoneCaret(formatted, Math.min(digitsBeforeEnd, formattedDigits))
    );
  }

  function deleteCustomerPhoneDigit(input, direction) {
    const value = String(input && input.value || "");
    const selectionStart = input && input.selectionStart;
    const selectionEnd = input && input.selectionEnd;
    if (!Number.isInteger(selectionStart) || selectionStart !== selectionEnd) return false;
    const separatorIndex = direction === "backward" ? selectionStart - 1 : selectionStart;
    if (value[separatorIndex] !== "-" || Core.formatPhone(Core.normalizePhone(value)) !== value || !/^\d{2,4}(?:-\d{1,4}){1,2}$/.test(value)) return false;
    const digitOffset = Core.normalizePhone(value.slice(0, selectionStart)).length;
    const removeIndex = direction === "backward" ? digitOffset - 1 : digitOffset;
    const digits = Core.normalizePhone(value);
    if (removeIndex < 0 || removeIndex >= digits.length) return false;
    const nextDigits = `${digits.slice(0, removeIndex)}${digits.slice(removeIndex + 1)}`;
    const formatted = customerPhoneText(nextDigits);
    input.value = formatted;
    const nextDigitOffset = direction === "backward" ? Math.max(0, digitOffset - 1) : digitOffset;
    const caret = customerPhoneCaret(formatted, Math.min(nextDigitOffset, Core.normalizePhone(formatted).length));
    input.setSelectionRange(caret, caret);
    return true;
  }
  const krw = value => `${Core.money(value).toLocaleString("ko-KR")}원`;
  const compactMoney = value => {
    const amount = Core.money(value);
    if (amount >= 100000000) return `${(amount / 100000000).toFixed(amount % 100000000 ? 1 : 0)}억`;
    if (amount >= 10000) return `${Math.round(amount / 10000).toLocaleString("ko-KR")}만`;
    return amount.toLocaleString("ko-KR");
  };
  const moneyRange = (minimum, maximum, emptyText) => {
    const min = Core.money(minimum);
    const max = Core.money(maximum);
    if (!min && !max) return emptyText || "미확인";
    if (min && max && min === max) return krw(min);
    if (min && max) return `${krw(min)} ~ ${krw(max)}`;
    return min ? `${krw(min)} 이상` : `${krw(max)} 이하`;
  };
  const allPartnerVendorRows = () => Array.isArray(store.partnerVendors) ? store.partnerVendors.filter(Boolean) : [];
  const partnerVendorRows = () => allPartnerVendorRows().filter(item => item.active !== false);
  const partnerVendorName = item => String(item && (item.vendor || item.name) || "").trim();
  const partnerVendorById = id => partnerVendorRows().find(item => String(item.id) === String(id || "")) || null;
  const newPartnerVendor = values => {
    if (typeof Core.createPartnerVendor === "function") return Core.createPartnerVendor(values || {});
    const now = new Date().toISOString();
    return Object.assign({
      id: `pvd_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      vendor: "", industry: "기타", service: "", category: "", phone: "", phoneLabel: "",
      alternatePhone: "", alternatePhoneLabel: "", quoteUrl: "", region: "원주", memo: "",
      createdAt: now, updatedAt: now
    }, values || {});
  };
  const partnerIndustry = item => item && (item.industry || (String(item.category || "").includes("누수") ? "누수" : "기타")) || "기타";
  const partnerPhoneText = item => [
    item && item.phone && `${item.phoneLabel ? `${item.phoneLabel} ` : ""}${customerPhoneText(item.phone)}`,
    item && item.alternatePhone && `${item.alternatePhoneLabel ? `${item.alternatePhoneLabel} ` : ""}${customerPhoneText(item.alternatePhone)}`
  ].filter(Boolean).join(" · ") || "연락처 미입력";
  const partnerVendorForQuote = quote => {
    if (!quote) return null;
    const direct = partnerVendorById(quote.vendorId);
    if (direct) return direct;
    const phone = Core.normalizePhone(quote.phone);
    if (phone) {
      const byPhone = partnerVendorRows().filter(item => [item.phone, item.alternatePhone].some(value => Core.normalizePhone(value) === phone));
      if (byPhone.length === 1) return byPhone[0];
    }
    const name = Core.normalizeText(quote.vendor);
    if (!name) return null;
    const byName = partnerVendorRows().filter(item => Core.normalizeText(partnerVendorName(item)) === name);
    if (byName.length === 1) return byName[0];
    return byName.find(item => partnerIndustry(item) === partnerIndustry(quote)) || null;
  };
  const partnerQuoteVendorView = quote => {
    const vendor = partnerVendorForQuote(quote);
    if (!vendor) return quote || {};
    return Object.assign({}, quote || {}, {
      vendor: partnerVendorName(vendor) || quote.vendor,
      phone: vendor.phone || quote.phone,
      phoneLabel: vendor.phoneLabel || quote.phoneLabel,
      alternatePhone: vendor.alternatePhone || quote.alternatePhone,
      alternatePhoneLabel: vendor.alternatePhoneLabel || quote.alternatePhoneLabel,
      quoteUrl: vendor.quoteUrl || quote.quoteUrl,
      region: vendor.region || quote.region,
      service: vendor.service || vendor.category || quote.service,
      industry: quote.industry || vendor.industry
    });
  };
  const partnerQuotesForVendor = vendor => store.partnerQuotes.filter(quote => {
    if (quote.vendorId) return String(quote.vendorId) === String(vendor.id);
    return partnerVendorForQuote(quote) === vendor;
  });
  const checklistCount = item => {
    const checklist = item && item.checklist && typeof item.checklist === "object" ? item.checklist : {};
    const rows = INDUSTRY_CHECKLISTS[partnerIndustry(item)] || INDUSTRY_CHECKLISTS["기타"];
    return { done: rows.filter(([key]) => checklist[key] === true).length, total: rows.length };
  };
  const dateText = value => {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  };
  const shortDate = value => {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
  };
  const datetimeValue = value => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  };
  const customerById = id => store.customers.find(item => item.id === id) || null;
  const buildingById = id => store.buildings.find(item => item.id === id) || null;
  const customerBuildings = customer => {
    if (!customer) return [];
    const linkedIds = new Set(Core.customerBuildingIds(customer));
    return store.buildings.filter(building => linkedIds.has(building.id) || building.ownerCustomerId === customer.id);
  };
  const salesStageById = stageId => (Sales.SALES_STAGES || []).find(stage => stage.id === stageId) || null;
  const customerSalesStateLabel = Object.freeze({
    "no-building": "건물 미연결",
    "unregistered": "영업 미등록",
    "needs-review": "연결 확인 필요",
    "mixed": "건물별 단계 다름"
  });
  const customerSalesMatchLabel = Object.freeze({ crmBuildingId: "명시 연결", crmCustomerId: "고객 연결", address: "주소 일치", name: "이름 일치" });

  function customerSalesProgress(customer) {
    const buildings = customerBuildings(customer);
    if (!buildings.length) return { stateId: "no-building", label: customerSalesStateLabel["no-building"], rows: [], filterIds: ["no-building"] };
    const activeProspects = (store.salesProspects || []).filter(item => item && !item.archivedAt);
    const contactProspectIds = buildings.length === 1 ? new Set((store.salesContacts || [])
      .filter(item => item && !item.archivedAt && String(item.crmCustomerId || "") === String(customer.id))
      .map(item => String(item.prospectId || "")).filter(Boolean)) : new Set();
    const rows = buildings.map(building => {
      const explicit = activeProspects.filter(item => String(item.crmBuildingId || "") === String(building.id));
      let result = explicit.length === 1
        ? { prospect: explicit[0], matchedBy: "crmBuildingId", ambiguous: false }
        : explicit.length > 1
          ? { prospect: null, matchedBy: "crmBuildingId", ambiguous: true }
          : null;
      if (!result && contactProspectIds.size) {
        const contacts = activeProspects.filter(item => contactProspectIds.has(String(item.id || "")));
        const safeContacts = contacts.filter(item => !item.crmBuildingId || String(item.crmBuildingId) === String(building.id));
        if (contacts.some(item => item.crmBuildingId && String(item.crmBuildingId) !== String(building.id)) || safeContacts.length > 1) {
          result = { prospect: null, matchedBy: "crmCustomerId", ambiguous: true };
        } else if (safeContacts.length === 1) {
          result = { prospect: safeContacts[0], matchedBy: "crmCustomerId", ambiguous: false };
        }
      }
      if (!result) result = Sales.matchProspectToCrmBuilding(activeProspects, building, store.buildings);
      const stage = result.prospect ? salesStageById(result.prospect.stage) : null;
      return { building, prospect: result.prospect || null, stage, matchedBy: result.matchedBy, ambiguous: result.ambiguous };
    });
    const matched = rows.filter(row => row.prospect && row.stage);
    const hasAmbiguous = rows.some(row => row.ambiguous);
    const stageIds = [...new Set(matched.map(row => row.stage.id))];
    const rowFilterIds = rows.map(row => row.stage ? row.stage.id : row.ambiguous ? "needs-review" : "unregistered");
    let stateId = "unregistered";
    if (hasAmbiguous) stateId = "needs-review";
    else if (matched.length && (matched.length !== rows.length || stageIds.length > 1)) stateId = "mixed";
    else if (stageIds.length === 1) stateId = stageIds[0];
    const stage = salesStageById(stateId);
    return {
      stateId,
      label: stage ? stage.label : customerSalesStateLabel[stateId] || "영업 미등록",
      rows,
      filterIds: [...new Set([stateId, ...rowFilterIds])]
    };
  }

  const customerSalesStageBadge = progress => {
    const item = progress || { stateId: "unregistered", label: "영업 미등록", rows: [] };
    const detail = (item.rows || []).map(row => `${row.building.name || "건물명 미입력"} · ${row.stage ? row.stage.label : row.ambiguous ? "연결 확인 필요" : "영업 미등록"}`).join("\n");
    return `<span class="customer-sales-stage ${item.stateId === "needs-review" ? "warning" : ["unregistered", "no-building"].includes(item.stateId) ? "unlinked" : item.stateId === "mixed" ? "mixed" : "linked"}" data-customer-sales-stage="${attr(item.stateId)}" title="${attr(detail || item.label)}">${esc(item.label)}</span>`;
  };
  const customerIsRelationshipCustomer = customer => Boolean(customer && (customer.stage === "계약 확정" || customerSalesProgress(customer).filterIds.includes("paid_management")));
  const customerActivities = id => store.activities.filter(item => item.customerId === id).sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
  const customerTasks = id => store.tasks.filter(item => item.customerId === id).sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)));
  const dueKey = value => value ? Core.dayKey(value) : "";
  const todayKey = () => Core.dayKey();
  const addDaysIso = (value, days) => {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return "";
    date.setDate(date.getDate() + (Number(days) || 0));
    return date.toISOString();
  };
  const beginRelationship = customer => {
    if (!customerIsRelationshipCustomer(customer)) return;
    customer.relationshipCycleDays = Number(customer.relationshipCycleDays) || 30;
    customer.relationshipStartedAt = customer.relationshipStartedAt || new Date().toISOString();
    customer.relationshipNextContactAt = customer.relationshipNextContactAt || addDaysIso(new Date(), customer.relationshipCycleDays);
    customer.relationshipNextAction = customer.relationshipNextAction || "계약 후 만족도 확인";
  };
  const priorityClass = priority => `<span class="priority-badge ${priority === "높음" ? "high" : priority === "낮음" ? "low" : "normal"}">${esc(priority || "보통")}</span>`;
  const empty = (title, detail, button) => `<div class="empty-state"><div><strong>${esc(title)}</strong><p>${esc(detail)}</p>${button || ""}</div></div>`;

  function showToast(message, type) {
    clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.className = `toast show ${type || ""}`;
    toastTimer = setTimeout(() => { toastEl.className = "toast"; }, 2800);
  }

  function updateUpdaterUI(state) {
    currentUpdate = Object.assign({}, currentUpdate, state || {});
    if (!updateButton) return;
    if (currentUpdate.status === "disabled") {
      updateButton.hidden = true;
      return;
    }
    updateButton.hidden = false;
    updateButton.className = `update-button ${currentUpdate.status === "ready" ? "ready" : currentUpdate.status === "error" ? "error" : ""}`;
    if (currentUpdate.status === "checking") updateButton.textContent = "업데이트 확인 중…";
    else if (currentUpdate.status === "downloading") updateButton.textContent = `업데이트 받는 중 ${currentUpdate.percent || 0}%`;
    else if (currentUpdate.status === "ready") updateButton.textContent = `새 버전 ${currentUpdate.availableVersion || ""} 재시작`;
    else if (currentUpdate.status === "waiting") updateButton.textContent = `v${currentUpdate.currentVersion || ""} 자동 확인 대기`;
    else if (currentUpdate.status === "error") updateButton.textContent = "업데이트 재확인";
    else updateButton.textContent = `v${currentUpdate.currentVersion || ""} 최신 확인`;
    updateButton.title = currentUpdate.message || "새 버전 확인";
    updateButton.disabled = currentUpdate.status === "checking" || currentUpdate.status === "downloading" || currentUpdate.status === "waiting";
  }

  function cloneStore(value) {
    return Core.sanitizeStore(JSON.parse(JSON.stringify(value || store)));
  }

  function preserveRendererOverlays(value, fallback) {
    const source = value && typeof value === "object" ? value : {};
    const previous = fallback && typeof fallback === "object" ? fallback : {};
    const overlays = {};
    ["buildingUnits", "fieldSummaries"].forEach(collection => {
      overlays[collection] = Object.prototype.hasOwnProperty.call(source, collection)
        ? source[collection]
        : previous[collection];
    });
    return Core.sanitizeRendererStore(Object.assign({}, source, overlays));
  }

  function currentAuthUid() {
    return String(currentAuth && currentAuth.user && currentAuth.user.uid || "");
  }

  function fieldOperatorStorageKey() {
    return `bring-crm:field-operator:${currentAuthUid() || "signed-out"}`;
  }

  function fieldRouteStorageKey() {
    return `bring-crm:field-route:${currentAuthUid() || "signed-out"}`;
  }

  function saveFieldNavigationState() {
    try {
      sessionStorage.setItem(fieldRouteStorageKey(), JSON.stringify(fieldNavigationState));
    } catch (_error) {}
  }

  function restoreFieldNavigationState() {
    const fallback = { route: "/field?embedded=crm", selectedJobId: "", filter: {}, scrollTop: 0, search: "" };
    try {
      const parsed = JSON.parse(sessionStorage.getItem(fieldRouteStorageKey()) || "null");
      if (!parsed || typeof parsed !== "object" || typeof parsed.route !== "string" || !parsed.route.startsWith("/field")) return fallback;
      return {
        route: parsed.route.slice(0, 1024),
        selectedJobId: /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(String(parsed.selectedJobId || "")) ? String(parsed.selectedJobId || "") : "",
        filter: parsed.filter && typeof parsed.filter === "object" && !Array.isArray(parsed.filter) ? parsed.filter : {},
        scrollTop: Number.isInteger(parsed.scrollTop) && parsed.scrollTop >= 0 ? Math.min(parsed.scrollTop, 10000000) : 0,
        search: String(parsed.search || "").slice(0, 256),
      };
    } catch (_error) {
      return fallback;
    }
  }

  function activeFieldOperator() {
    return fieldTeamProfiles.find(profile => profile.active === true && profile.id === selectedFieldOperatorId) || null;
  }

  function readStoredFieldOperatorId() {
    try {
      const raw = localStorage.getItem(fieldOperatorStorageKey());
      if (!raw || raw.length > 512) return "";
      const stored = JSON.parse(raw);
      if (!stored || typeof stored !== "object" || Array.isArray(stored)) return "";
      const keys = Object.keys(stored).sort();
      if (keys.length !== 2 || keys[0] !== "operatorId" || keys[1] !== "selectedAt") return "";
      if (typeof stored.operatorId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(stored.operatorId)) return "";
      if (typeof stored.selectedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(stored.selectedAt)) return "";
      const selectedAt = Date.parse(stored.selectedAt);
      if (!Number.isFinite(selectedAt) || selectedAt < Date.UTC(2020, 0, 1) || selectedAt > Date.now() + 5 * 60_000) return "";
      return stored.operatorId;
    } catch (_error) {
      return "";
    }
  }

  function renderFieldOperatorControl() {
    if (!fieldOperatorSelect || !fieldOperatorControl) return;
    fieldOperatorControl.hidden = false;
    const selected = activeFieldOperator();
    fieldOperatorSelect.innerHTML = `<option value="">${fieldProfilesAvailable ? "작업자를 선택해 주세요" : "작업자 명단 확인 필요"}</option>${fieldTeamProfiles.map(profile => `<option value="${attr(profile.id)}" ${profile.id === selectedFieldOperatorId ? "selected" : ""}>${esc(profile.name)}</option>`).join("")}`;
    fieldOperatorSelect.disabled = !fieldProfilesAvailable || !fieldTeamProfiles.length;
    fieldOperatorSelect.setAttribute("aria-label", selected ? `현재 작업자 ${selected.name}` : "현재 작업자 선택");
  }

  async function loadFieldTeamProfiles() {
    fieldProfilesAvailable = false;
    fieldProfilesError = "";
    fieldTeamProfiles = [];
    selectedFieldOperatorId = "";
    try {
      const result = await api.loadFieldTeamProfiles();
      fieldProfilesAvailable = result && result.available === true;
      fieldProfilesError = String(result && result.error || "");
      fieldTeamProfiles = (result && Array.isArray(result.profiles) ? result.profiles : []).filter(profile => profile && profile.active === true && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(String(profile.id || "")))
        .map(profile => ({ id: String(profile.id), name: String(profile.displayName || "작업자"), sortOrder: Number.isInteger(profile.sortOrder) ? profile.sortOrder : 999999, active: true }))
        .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "ko"));
      const storedId = readStoredFieldOperatorId();
      if (fieldTeamProfiles.some(profile => profile.id === storedId)) selectedFieldOperatorId = storedId;
    } catch (error) {
      fieldProfilesError = error && error.message || "작업자 명단을 불러오지 못했습니다.";
    }
    renderFieldOperatorControl();
    return fieldTeamProfiles;
  }

  function setCurrentAuth(value) {
    const previousUid = currentAuthUid();
    currentAuth = value || currentAuth;
    if (previousUid !== currentAuthUid()) {
      authGeneration += 1;
      overlayRefreshPromise = null;
      driveImportCandidates = [];
      driveImportRefreshPromise = null;
      driveImportRefreshSequence += 1;
      fieldOpenGeneration += 1;
      fieldTeamProfiles = [];
      fieldProfilesAvailable = false;
      selectedFieldOperatorId = "";
      fieldNavigationState = restoreFieldNavigationState();
    }
    return currentAuth;
  }

  async function refreshRendererOverlays(renderAfter = true) {
    if (overlayRefreshPromise) return overlayRefreshPromise;
    const generation = authGeneration;
    const uid = currentAuthUid();
    const refreshPromise = Promise.all([
      api.loadCanonicalBuildingUnits(),
      api.loadFieldSummaries(),
    ]).then(([buildingUnits, fieldSummaries]) => {
      if (generation !== authGeneration || uid !== currentAuthUid()) return null;
      const overlays = Core.sanitizeRendererOverlays({ buildingUnits, fieldSummaries });
      const merge = value => value ? Core.sanitizeRendererStore(Object.assign({}, value, overlays)) : value;
      store = merge(store);
      synchronizedStore = merge(synchronizedStore);
      pendingRemoteStore = merge(pendingRemoteStore);
      queuedSave = merge(queuedSave);
      if (renderAfter && appInitialized) render();
      return overlays;
    }).finally(() => {
      if (overlayRefreshPromise === refreshPromise) overlayRefreshPromise = null;
    });
    overlayRefreshPromise = refreshPromise;
    return overlayRefreshPromise;
  }

  async function refreshDriveImportCandidates(options) {
    const settings = Object.assign({ renderAfter: true, force: false }, options || {});
    if (currentView !== "buildings" || typeof api.loadDriveImportCandidates !== "function") return null;
    if (driveImportRefreshPromise && !settings.force) return driveImportRefreshPromise;
    const generation = authGeneration;
    const uid = currentAuthUid();
    if (!uid) return null;
    const sequence = ++driveImportRefreshSequence;
    const refreshPromise = Promise.resolve()
      .then(() => api.loadDriveImportCandidates())
      .then(candidates => {
        if (generation !== authGeneration || uid !== currentAuthUid() || sequence !== driveImportRefreshSequence || currentView !== "buildings") return null;
        driveImportCandidates = DriveImportUI.sanitizeCandidates(candidates);
        if (settings.renderAfter && appInitialized) {
          renderBuildings();
          pageMeta();
        }
        return driveImportCandidates;
      })
      .finally(() => {
        if (driveImportRefreshPromise === refreshPromise) driveImportRefreshPromise = null;
      });
    driveImportRefreshPromise = refreshPromise;
    return refreshPromise;
  }

  function requestDriveImportCandidatesRefresh() {
    if (currentView !== "buildings") return;
    void refreshDriveImportCandidates().catch(() => undefined);
  }

  function ensureSalesStore(target) {
    const value = target || store;
    ["salesProspects", "salesContacts", "salesUnits", "salesActivities", "salesEvents", "salesOpportunities"]
      .forEach(collection => { if (!Array.isArray(value[collection])) value[collection] = []; });
    return value;
  }

  const sharedStoreCollections = [
    "customers", "buildings", "activities", "contracts", "partnerVendors", "partnerQuotes", "tasks",
    "serviceRecords", "serviceContracts", "serviceSchedules",
    "securityAssets", "auditLogs", "securityIncidents",
    "salesProspects", "salesContacts", "salesUnits", "salesActivities", "salesEvents", "salesOpportunities"
  ];
  const sameStoredValue = (left, right) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  const recordsById = items => new Map((Array.isArray(items) ? items : []).filter(item => item && item.id).map(item => [String(item.id), item]));

  function rebaseLocalStore(localValue, baseValue, remoteValue) {
    const local = cloneStore(localValue);
    const base = cloneStore(baseValue || Core.blankStore());
    const remote = cloneStore(remoteValue);
    const merged = cloneStore(remote);
    sharedStoreCollections.forEach(collection => {
      const localMap = recordsById(local[collection]);
      const baseMap = recordsById(base[collection]);
      const mergedMap = recordsById(remote[collection]);
      new Set([...localMap.keys(), ...baseMap.keys()]).forEach(id => {
        const localHas = localMap.has(id);
        const baseHas = baseMap.has(id);
        if (localHas === baseHas && sameStoredValue(localMap.get(id), baseMap.get(id))) return;
        if (localHas) mergedMap.set(id, localMap.get(id));
        else mergedMap.delete(id);
      });
      merged[collection] = [...mergedMap.values()];
    });
    if (!sameStoredValue(local.company, base.company)) merged.company = local.company;
    merged.settings = local.settings;
    return cloneStore(merged);
  }

  function showLogin(message, isError) {
    appShell.classList.add("app-locked");
    appShell.setAttribute("aria-hidden", "true");
    loginGate.hidden = false;
    loginForm.hidden = false;
    passwordChangeForm.hidden = true;
    loginTitle.textContent = "공용 CRM 로그인";
    loginDescription.innerHTML = "허용된 회사 이메일과 비밀번호로 로그인하면<br>CRM과 BRING FIELD를 함께 사용할 수 있습니다.";
    loginMessage.textContent = message || currentAuth.error || "허용된 회사 이메일과 비밀번호를 입력해 주세요.";
    loginMessage.className = `login-message${isError ? " error" : ""}`;
    loginEmail.readOnly = false;
    loginEmail.disabled = false;
    loginPassword.readOnly = false;
    loginPassword.disabled = false;
    loginButton.disabled = false;
    googleLoginButton.hidden = true;
    googleLoginButton.disabled = false;
    setTimeout(() => (loginEmail.value.trim() ? loginPassword : loginEmail).focus(), 0);
  }

  function showPasswordChange(auth, message, isError) {
    setCurrentAuth(auth);
    appShell.classList.add("app-locked");
    appShell.setAttribute("aria-hidden", "true");
    loginGate.hidden = false;
    loginForm.hidden = true;
    googleLoginButton.hidden = true;
    passwordChangeForm.hidden = false;
    loginTitle.textContent = "새 비밀번호 설정";
    loginDescription.innerHTML = "처음 로그인하셨습니다.<br>안전한 새 비밀번호를 설정한 후 CRM을 시작하세요.";
    const user = currentAuth.user || {};
    document.getElementById("passwordUserName").textContent = user.displayName || user.email || "사용자";
    document.getElementById("passwordUserEmail").textContent = user.email || "";
    loginMessage.textContent = message || "임시 비밀번호를 새 비밀번호로 변경해 주세요.";
    loginMessage.className = `login-message${isError ? " error" : ""}`;
    passwordChangeButton.disabled = false;
    setTimeout(() => newPassword.focus(), 0);
  }

  function showApplication(auth) {
    setCurrentAuth(auth);
    loginGate.hidden = true;
    appShell.classList.remove("app-locked");
    appShell.setAttribute("aria-hidden", "false");
    const user = currentAuth.user;
    userPill.hidden = !user;
    if (user) {
      document.getElementById("currentUserName").textContent = user.displayName || user.email || "사용자";
      document.getElementById("currentUserEmail").textContent = user.email || "";
    }
  }

  function updateSyncUI(state) {
    currentSync = Object.assign({}, currentSync, state || {});
    const dot = document.getElementById("connectionDot");
    const label = document.getElementById("connectionLabel");
    const saved = document.getElementById("lastSaved");
    dot.className = ["syncing", "pending", "offline"].includes(currentSync.status) ? currentSync.status : "";
    label.textContent = currentSync.message || (currentSync.status === "connected" ? "공용 서버 연결됨" : "서버 연결 확인 중");
    if (currentSync.updatedAt) saved.textContent = `최신 반영 ${dateText(currentSync.updatedAt)}`;
  }

  function applyRemoteStore(data) {
    const next = preserveRendererOverlays(data, store);
    if (saveTimer || saveInFlight || modal.classList.contains("open") || drawer.classList.contains("open") || confirmationLayer.classList.contains("open")) {
      pendingRemoteStore = next;
      return;
    }
    const currentTime = Date.parse(store.updatedAt || 0) || 0;
    const nextTime = Date.parse(next.updatedAt || 0) || 0;
    if (nextTime && currentTime && nextTime < currentTime) return;
    store = next;
    ensureSalesStore(store);
    synchronizedStore = cloneStore(next);
    render();
    if (selectedCustomerId) {
      if (!customerById(selectedCustomerId)) closeDrawer();
      else if (selectedCustomerDrawerMode === "relationship") renderRelationshipDrawer(selectedCustomerId);
      else renderCustomerDrawer(selectedCustomerId);
    }
    if (selectedSalesProspectId) {
      if (!salesProspectById(selectedSalesProspectId)) closeDrawer();
      else renderSalesProspectDrawer(selectedSalesProspectId);
    }
  }

  function flushPendingRemote() {
    if (!pendingRemoteStore || saveTimer || saveInFlight || modal.classList.contains("open") || drawer.classList.contains("open") || confirmationLayer.classList.contains("open")) return;
    const next = pendingRemoteStore;
    pendingRemoteStore = null;
    applyRemoteStore(next);
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    queuedSave = cloneStore(store);
    if (saveInFlight) {
      saveTimer = null;
      return;
    }
    saveTimer = setTimeout(saveStore, 350);
  }

  function logAudit(values) {
    const user = currentAuth && currentAuth.user || {};
    store.auditLogs.unshift(Core.createAuditLog(Object.assign({}, values || {}, {
      actor: user.displayName || user.email || store.settings.owner || "담당자",
      actorUid: user.uid || "",
      actorEmail: user.email || ""
    })));
  }

  function canWriteCRM() {
    return (!currentAuth.required && !currentAuth.enforceRoles) || ["admin", "member"].includes(currentAuth.user && currentAuth.user.role);
  }

  function canAdministerSecurity() {
    return (!currentAuth.required && !currentAuth.enforceRoles) || currentAuth.user && currentAuth.user.role === "admin";
  }

  function deferCanonicalMutation(label) {
    if (!canWriteCRM()) {
      showToast("조회 전용 계정은 내용을 변경할 수 없습니다.", "error");
      return true;
    }
    if (!activeFieldOperator()) {
      showToast(fieldProfilesAvailable ? `${label} 변경 전 현재 작업자를 선택해 주세요.` : (fieldProfilesError || "작업자 명단을 확인할 수 없어 변경을 잠시 막았습니다."), "error");
      fieldOperatorSelect?.focus();
      return true;
    }
    return false;
  }

  function buildCanonicalBuildingPatch(values = {}) {
    const aliases = Array.isArray(values.aliases) ? [...new Set(values.aliases.map(value => String(value || "").trim()).filter(Boolean))] : [];
    const paymentBuildingIds = Array.isArray(values.paymentBuildingIds) ? [...new Set(values.paymentBuildingIds.map(value => String(value || "").trim()).filter(Boolean))] : [];
    const stringList = value => Array.isArray(value) ? [...new Set(value.map(item => String(item || "").trim()).filter(Boolean))] : [];
    return {
      name: String(values.name || "").trim(),
      ownerCustomerId: String(values.ownerCustomerId || ""),
      type: String(values.type || ""),
      status: String(values.status || ""),
      address: String(values.address || "").trim(),
      roadAddress: String(values.roadAddress || "").trim(),
      jibunAddress: String(values.jibunAddress || "").trim(),
      unitCount: Number(values.unitCount) || 0,
      rentDeposit: Core.nonNegativeInteger(values.rentDeposit),
      monthlyRent: Core.nonNegativeInteger(values.monthlyRent),
      maintenanceFee: Core.nonNegativeInteger(values.maintenanceFee),
      maintenanceIncludes: stringList(values.maintenanceIncludes),
      maintenanceIncludeOther: String(values.maintenanceIncludeOther || "").trim(),
      vacantUnitCount: Core.nonNegativeInteger(values.vacantUnitCount),
      vacantUnits: stringList(values.vacantUnits),
      roomTypes: stringList(values.roomTypes),
      roomTypeOther: String(values.roomTypeOther || "").trim(),
      roomOptions: stringList(values.roomOptions),
      roomOptionOther: String(values.roomOptionOther || "").trim(),
      manager: String(values.manager || "").trim(),
      memo: String(values.memo || "").trim(),
      aliases,
      externalRefs: { paymentBuildingIds },
    };
  }

  function buildCanonicalBuildingUnitPatch(values = {}) {
    const floorOrder = Number(values.floorOrder);
    const unitOrder = Number(values.unitOrder);
    return {
      crmBuildingId: String(values.buildingId || ""),
      label: String(values.label || "").trim(),
      floorLabel: String(values.floorLabel || "").trim(),
      floorOrder: Number.isFinite(floorOrder) ? Math.max(-1000, Math.min(1000, Math.trunc(floorOrder))) : 0,
      unitOrder: Number.isFinite(unitOrder) ? Math.max(0, Math.min(100000, Math.trunc(unitOrder))) : 0,
      status: String(values.status || ""),
      moveOutAt: String(values.moveOutAt || ""),
      availableFrom: String(values.availableFrom || ""),
      memo: String(values.memo || "").trim(),
    };
  }

  function buildCanonicalSalesUnitPatch(values = {}) {
    const patch = {
      prospectId: String(values.prospectId || ""),
      label: String(values.label || "").trim(),
      status: String(values.status || ""),
      moveOutAt: String(values.moveOutAt || ""),
      availableFrom: String(values.availableFrom || ""),
      deposit: Number(values.deposit) || 0,
      rent: Number(values.rent) || 0,
      maintenanceFee: Number(values.maintenanceFee) || 0,
      photoUrl: String(values.photoUrl || "").trim(),
      evidenceUrl: String(values.evidenceUrl || "").trim(),
      note: String(values.note || "").trim(),
    };
    const crmBuildingUnitId = String(values.crmBuildingUnitId || "").trim();
    if (crmBuildingUnitId) patch.crmBuildingUnitId = crmBuildingUnitId;
    return patch;
  }

  async function commitCanonicalEntity({ entityType, entityId, operation, expectedVersion, patch, reason }) {
    if (deferCanonicalMutation(entityType === "buildings" ? "건물" : entityType === "buildingUnits" ? "건물 호실" : "영업 호실")) return null;
    const commitGeneration = authGeneration;
    const commitUid = currentAuthUid();
    const result = await api.commitCanonicalCrmEntity({
      requestId: crypto.randomUUID(),
      entityType,
      entityId,
      operation,
      expectedVersion: Number(expectedVersion) || 0,
      operatorId: selectedFieldOperatorId,
      reason: String(reason || "CRM에서 변경").slice(0, 500),
      patch: patch && typeof patch === "object" ? patch : {},
    });
    if (!result || commitGeneration !== authGeneration || commitUid !== currentAuthUid()) throw new Error("로그인 세션이 변경되어 결과를 반영하지 않았습니다.");
    try {
      const latest = await api.load();
      if (commitGeneration !== authGeneration || commitUid !== currentAuthUid()) throw new Error("로그인 세션이 변경되어 결과를 반영하지 않았습니다.");
      store = preserveRendererOverlays(latest, store);
      ensureSalesStore(store);
      synchronizedStore = cloneStore(store);
      await refreshRendererOverlays(false).catch(() => undefined);
    } catch (_error) {
      if (commitGeneration !== authGeneration || commitUid !== currentAuthUid()) throw new Error("로그인 세션이 변경되어 결과를 반영하지 않았습니다.");
      if (typeof showToast === "function") showToast("저장은 완료됐지만 최신 화면을 불러오지 못했습니다. 연결되면 자동으로 반영합니다.", "warning");
      void api.load().then(latest => {
        if (commitGeneration !== authGeneration || commitUid !== currentAuthUid()) return;
        store = preserveRendererOverlays(latest, store);
        ensureSalesStore(store);
        synchronizedStore = cloneStore(store);
        return refreshRendererOverlays(false);
      }).catch(() => undefined);
    }
    return result;
  }

  function replaceServiceRecord(snapshot, record) {
    if (!snapshot || !record || !record.id) return;
    const records = Array.isArray(snapshot.serviceRecords) ? snapshot.serviceRecords.slice() : [];
    const index = records.findIndex(item => item && item.id === record.id);
    const next = structuredClone(record);
    if (index >= 0) records[index] = next;
    else records.push(next);
    snapshot.serviceRecords = records;
  }

  function alignCommittedServiceRecord(record) {
    [store, synchronizedStore, queuedSave, pendingRemoteStore].forEach(snapshot => replaceServiceRecord(snapshot, record));
  }

  function alignAuthoritativeServiceRecords(latest) {
    if (!latest || !Array.isArray(latest.serviceRecords)) return;
    const records = structuredClone(latest.serviceRecords);
    const buildings = Array.isArray(latest.buildings) ? structuredClone(latest.buildings) : null;
    [store, synchronizedStore, queuedSave, pendingRemoteStore].forEach(snapshot => {
      if (!snapshot) return;
      snapshot.serviceRecords = structuredClone(records);
      if (buildings) snapshot.buildings = structuredClone(buildings);
    });
  }

  function buildingScheduleCommitValues(values) {
    const source = values && typeof values === "object" ? values : {};
    const type = ["inspection", "repair", "cleaning", "stair_cleaning", "grounds_cutting", "meeting", "other"].includes(source.serviceType) ? source.serviceType : "other";
    const status = ["planned", "in_progress", "completed"].includes(source.status) ? source.status : "planned";
    return {
      buildingId: String(source.buildingId || ""),
      title: String(source.title || WorkManagement.typeLabel(type)).trim(),
      scheduledDate: String(source.scheduledDate || ""),
      startTime: String(source.startTime || ""),
      endTime: String(source.endTime || ""),
      status,
      serviceType: type,
      owner: String(source.owner || "").trim(),
      summary: String(source.summary || "").trim(),
      completedAt: status === "completed" ? String(source.completedAt || todayKey()) : "",
      amount: Core.nonNegativeInteger(source.amount),
      vendorName: String(source.vendorName || "").trim(),
      evidenceUrl: String(source.evidenceUrl || "").trim(),
    };
  }

  const serviceRecordErrorText = result => ({
    BUILDING_SCHEDULE_CONFLICT: "다른 사용자가 먼저 일정을 변경했습니다. 최신 내용을 반영했으니 다시 확인해 주세요.",
    BUILDING_SCHEDULE_NOT_FOUND: "일정이 이미 변경되었거나 찾을 수 없습니다. 최신 내용을 확인해 주세요.",
    BUILDING_SCHEDULE_BUILDING_UNAVAILABLE: "선택한 건물이 보관되었거나 삭제되어 일정을 연결할 수 없습니다.",
    BUILDING_SCHEDULE_STATE_INVALID: "현재 일정 상태에서는 요청한 변경을 할 수 없습니다.",
    BUILDING_SCHEDULE_READ_ONLY: "조회 전용 계정은 일정을 변경할 수 없습니다.",
    BUILDING_SCHEDULE_INVALID: "건물·일정명·날짜·시간을 다시 확인해 주세요.",
    BUILDING_SCHEDULE_SESSION_CHANGED: "로그인 사용자가 변경되어 일정을 저장하지 않았습니다.",
    SESSION_CHANGED: "로그인 사용자가 변경되어 일정을 저장하지 않았습니다.",
  })[String(result && result.code || "")] || "일정을 저장하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.";

  async function commitBuildingScheduleRecord(input, formOrControl) {
    const recordId = String(input && input.recordId || "");
    if (!recordId || buildingScheduleCommitLocks.has(recordId)) return { ok: false, code: "BUILDING_SCHEDULE_IN_FLIGHT" };
    const commitGeneration = authGeneration;
    const commitUid = currentAuthUid();
    const control = formOrControl && formOrControl.matches && formOrControl.matches("form")
      ? formOrControl.querySelector('[type="submit"]')
      : formOrControl;
    buildingScheduleCommitLocks.add(recordId);
    if (formOrControl && formOrControl.dataset) formOrControl.dataset.submitting = "true";
    if (control) control.disabled = true;
    try {
      let result;
      try {
        result = await api.commitBuildingSchedule(input);
      } catch (_error) {
        result = { ok: false, code: "BUILDING_SCHEDULE_FAILED" };
      }
      if (commitGeneration !== authGeneration || commitUid !== currentAuthUid()) return { ok: false, code: "SESSION_CHANGED", stale: true };
      if (result && result.ok === true && result.record) {
        alignCommittedServiceRecord(result.record);
        return result;
      }
      if (["BUILDING_SCHEDULE_CONFLICT", "BUILDING_SCHEDULE_NOT_FOUND", "BUILDING_SCHEDULE_BUILDING_UNAVAILABLE"].includes(String(result && result.code || ""))) {
        try {
          const latest = await api.load();
          if (commitGeneration === authGeneration && commitUid === currentAuthUid()) alignAuthoritativeServiceRecords(latest);
        } catch (_error) { /* live stream will retry the authoritative refresh */ }
      }
      return result && typeof result === "object" ? result : { ok: false, code: "BUILDING_SCHEDULE_FAILED" };
    } finally {
      buildingScheduleCommitLocks.delete(recordId);
      if (formOrControl && formOrControl.isConnected && formOrControl.dataset) formOrControl.dataset.submitting = "false";
      if (control && control.isConnected) control.disabled = false;
    }
  }

  function containsProhibitedSecret(value) {
    return Core.findProhibitedSecrets(value).length > 0;
  }

  function requireSecurityPermission(adminOnly) {
    const allowed = adminOnly ? canAdministerSecurity() : canWriteCRM();
    if (!allowed) showToast(adminOnly ? "권한 설정은 관리자만 변경할 수 있습니다." : "조회 전용 계정은 내용을 변경할 수 없습니다.", "error");
    return allowed;
  }

  function showWelcomeGuide() {
    modalContent.innerHTML = `<div class="welcome-guide"><div class="welcome-guide-top"><div class="welcome-logo"><img src="./assets/bring-logo.png" alt="BRING 로고"></div><span>처음 오셨나요?</span><h2>BRING CRM은 이 순서로 사용하세요</h2><p>건물을 기준으로 고객·계약·케이스·입금을 이어서 관리합니다.</p></div><div class="welcome-steps"><article><i>1</i><div><b>고객과 건물을 등록합니다</b><span>고객 정보에서 시작하거나 건물 관리에서 바로 등록하세요.</span></div></article><article><i>2</i><div><b>건물에서 케이스를 시작합니다</b><span>건물 상세의 새 케이스를 누르면 건물 정보가 자동 연결됩니다.</span></div></article><article><i>3</i><div><b>계약과 입금을 확인합니다</b><span>같은 건물의 계약·진행 업무·납부 일정을 한 화면에서 확인하세요.</span></div></article></div><div class="welcome-extra"><b>연락 업체·업체 상담</b><span>업체 링크로 기본정보를 먼저 등록하고, 저장된 업체를 선택해 안내 가격과 상담 내용을 기록하세요.</span></div><div class="welcome-actions"><button class="secondary-button" data-action="finish-guide">안내 닫기</button><button class="primary-button" data-action="guide-new-customer">고객 등록부터 시작 →</button></div></div>`;
    openModal();
  }

  function finishWelcomeGuide(startCustomer) {
    store.settings.onboardingComplete = true;
    scheduleSave();
    closeModal();
    if (startCustomer) customerEditor("");
  }

  async function saveStore() {
    if (saveInFlight) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    let payload = queuedSave || cloneStore(store);
    queuedSave = null;
    let rebasedRemote = false;
    if (pendingRemoteStore) {
      const remote = pendingRemoteStore;
      pendingRemoteStore = null;
      payload = rebaseLocalStore(payload, synchronizedStore, remote);
      store = rebaseLocalStore(store, synchronizedStore, remote);
      synchronizedStore = cloneStore(remote);
      rebasedRemote = true;
    }
    payload.updatedAt = new Date().toISOString();
    saveInFlight = true;
    try {
      const result = await api.save(payload);
      const saved = preserveRendererOverlays(result.data, payload);
      synchronizedStore = cloneStore(saved);
      if (!queuedSave) store = cloneStore(saved);
      if (!result.pending) await refreshRendererOverlays(false).catch(() => undefined);
      updateSyncUI(result.pending ? { status: "pending", message: "서버 연결 시 자동 저장됩니다." } : { status: "connected", message: "공용 서버와 동기화됨", updatedAt: store.updatedAt });
      if (rebasedRemote) {
        render();
        if (selectedCustomerId) {
          if (!customerById(selectedCustomerId)) closeDrawer();
          else if (!drawer.classList.contains("open")) {
            if (selectedCustomerDrawerMode === "relationship") renderRelationshipDrawer(selectedCustomerId);
            else renderCustomerDrawer(selectedCustomerId);
          }
        }
      }
    } catch (error) {
      showToast(`저장 실패: ${error.message}`, "error");
      updateSyncUI({ status: "offline", message: "서버 저장을 확인해 주세요." });
    } finally {
      saveInFlight = false;
      if (queuedSave) {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveStore, 50);
      } else flushPendingRemote();
    }
  }

  function demoStore() {
    const data = Core.blankStore();
    data.settings.onboardingComplete = true;
    const now = new Date();
    const date = offset => new Date(now.getTime() + offset * 86400000).toISOString();
    const customers = [
      Core.createCustomer({ name: "이정우", company: "혁신타워", phone: "010-2451-8832", type: "건물주", stage: "계약 중", priority: "높음", source: "대표 상담", interestServices: ["건물관리", "누수 대응"], currentIssue: "상가 천장 누수와 정기관리 문의", nextAction: "비교견적 전달", nextContactAt: date(0), lastContactAt: date(-1), expectedValue: 4800000, tags: ["원주", "상가"], owner: "김현진" }),
      Core.createCustomer({ name: "박서연", company: "무실스테이", phone: "010-7320-1164", type: "건물주", stage: "상담 중", priority: "보통", source: "소개", interestServices: ["입주청소", "시설점검"], currentIssue: "다가구 공실 정비와 청소 협력 요청", nextAction: "현장 사진 확인", nextContactAt: date(-1), lastContactAt: date(-3), expectedValue: 2400000, tags: ["다가구"], owner: "김현진" }),
      Core.createCustomer({ name: "원주에셋 주식회사", company: "원주에셋", phone: "033-745-2190", type: "법인", stage: "상담 완료", priority: "높음", source: "홈페이지", interestServices: ["통합관리", "월간리포트"], currentIssue: "관리 건물 3개 통합 운영 검토", nextAction: "제안서 초안 발송", nextContactAt: date(1), lastContactAt: date(-2), expectedValue: 12600000, tags: ["법인", "다건물"], owner: "김현진" }),
      Core.createCustomer({ name: "김도윤", company: "단계동 102", phone: "010-3084-5671", type: "건물주", stage: "상담 준비", priority: "낮음", source: "카카오채널", interestServices: ["민원관리"], currentIssue: "세입자 민원 응대 문의", nextAction: "서비스 안내 전화", nextContactAt: date(0), expectedValue: 390000, tags: ["단계동"], owner: "김현진" })
    ];
    const buildings = customers.slice(0, 3).map((customer, index) => Core.createBuilding({
      name: ["혁신타워", "무실스테이", "원주에셋 중앙빌딩"][index],
      address: ["원주시 반곡동 1901-2", "원주시 무실동 1720-4", "원주시 중앙동 84-1"][index],
      type: ["상가", "다가구", "빌딩"][index], ownerCustomerId: customer.id,
      status: ["견적중", "현장방문", "영업후보"][index], unitCount: [12, 9, 24][index]
    }));
    buildings.forEach((building, index) => { customers[index].buildingIds = [building.id]; });
    data.customers = customers;
    data.buildings = buildings;
    data.contracts = [
      Core.createContract({ id: "ctr_demo_clean", type: "청소", name: "무실스테이 공실 정기청소", customerId: customers[1].id, buildingId: buildings[1].id, startDate: Core.dayKey(date(-40)), endDate: Core.dayKey(date(325)), amount: 450000, billingCycle: "건별", status: "진행 중", scope: "공실 퇴실청소·공용부 정리", serviceFrequency: "공실 발생 시", owner: "김현진" }),
      Core.createContract({ id: "ctr_demo_building", type: "건물관리", name: "혁신타워 종합관리", customerId: customers[0].id, buildingId: buildings[0].id, startDate: Core.dayKey(date(-120)), endDate: Core.dayKey(date(245)), amount: 1200000, billingCycle: "월 정기", status: "진행 중", scope: "시설점검·민원응대·업체관리", unitCount: 12, owner: "김현진" }),
      Core.createContract({ id: "ctr_demo_realty", type: "부동산관리", name: "원주에셋 임대관리", customerId: customers[2].id, buildingId: buildings[2].id, startDate: Core.dayKey(date(-20)), endDate: Core.dayKey(date(345)), amount: 800000, billingCycle: "월 정기", status: "계약 준비", scope: "공실·임대차·입금 현황 관리", managementTarget: "상가·사무실 임대관리", feeMethod: "월 고정 관리비", owner: "김현진" })
    ];
    data.activities = [
      Core.createActivity({ customerId: customers[0].id, type: "전화", occurredAt: date(-1), summary: "누수 현장 증상과 방문 가능시간 확인", result: "업체 비교견적 요청 진행", owner: "김현진" }),
      Core.createActivity({ customerId: customers[1].id, type: "방문", occurredAt: date(-3), summary: "공실 3개 호실 상태 확인", result: "청소와 조명 교체 견적 필요", owner: "김현진" }),
      Core.createActivity({ customerId: customers[2].id, type: "미팅", occurredAt: date(-2), summary: "통합관리 요구사항 1차 미팅", result: "건물별 운영현황 제안서 요청", owner: "김현진" })
    ];
    data.partnerQuotes = [
      Core.createPartnerQuote({ id: "pqt_leak_01", industry: "누수", scenario: "원주 누수 탐지·시공 가상견적", service: "누수 탐지·시공", vendor: "달인누수탐지", quoteUrl: "https://naver.me/FG3ERBn5", status: "상담 완료", inspectionMin: 400000, inspectionMax: 400000, constructionMin: 600000, constructionMax: 1200000, totalMin: 1000000, totalMax: 1600000, noFindPolicy: "미탐지 시 비용 없음", consultationContent: "상황·위치에 따라 가격 편차가 크다고 안내함", memo: "상황·위치에 따라 편차 큼", checklist: { inspectionFee: true, noFind: true }, receivedAt: todayKey(), consultedAt: todayKey(), owner: "김현진" }),
      Core.createPartnerQuote({ id: "pqt_leak_02", industry: "누수", scenario: "원주 누수 탐지·시공 가상견적", service: "누수 탐지·시공", vendor: "누수달인", quoteUrl: "https://naver.me/xFL6oSbn", status: "상담 완료", inspectionMin: 400000, inspectionMax: 400000, constructionMin: 800000, constructionMax: 1200000, totalMin: 1200000, totalMax: 1600000, noFindPolicy: "미확인", consultationContent: "미탐지 조건과 출장비는 추가 확인이 필요함", memo: "미탐지 조건과 출장비 추가 확인 필요", checklist: { inspectionFee: true }, receivedAt: todayKey(), consultedAt: todayKey(), owner: "김현진" }),
      Core.createPartnerQuote({ id: "pqt_leak_03", industry: "누수", scenario: "원주 누수 탐지·시공 가상견적", service: "누수 탐지·시공", vendor: "프로원누수테크", quoteUrl: "https://naver.me/502wNPPP", status: "상담 완료", inspectionMin: 300000, inspectionMax: 300000, constructionPricing: "총비용에 포함", travelPolicy: "포함", totalMin: 700000, totalMax: 1000000, noFindPolicy: "미탐지 시 비용 없음", includedWork: "압력검사·배관 보수·타일", consultationContent: "탐지비와 시공비를 합친 전체 비용 기준으로 안내함", memo: "3번만 시공비가 아니라 전체 총비용 기준", checklist: { inspectionFee: true, noFind: true, pressure: true, repair: true, finish: true, travel: true }, receivedAt: todayKey(), consultedAt: todayKey(), owner: "김현진" }),
      Core.createPartnerQuote({ id: "pqt_leak_04", industry: "누수", scenario: "원주 누수 탐지·시공 가상견적", service: "배관 누수 탐지·시공", vendor: "누수", quoteUrl: "https://naver.me/GFB7oiqR", status: "상담 완료", inspectionMin: 300000, inspectionMax: 300000, constructionMin: 400000, constructionMax: 500000, travelMin: 50000, travelMax: 100000, totalMin: 750000, totalMax: 900000, noFindPolicy: "미확인", consultationContent: "세대별 계량기가 있으면 차단하며 탐지할 수 있고 배관 상태에 따라 추가 비용이 생길 수 있음", memo: "배관 누수 기준. 집마다 계량기가 있으면 하나씩 잠가 탐지 가능. 계량기가 하나로 묶여 있거나 배관 누수가 아니면 추가비용 발생 가능", checklist: { inspectionFee: true, meter: true, travel: true }, receivedAt: todayKey(), consultedAt: todayKey(), owner: "김현진" }),
      Core.createPartnerQuote({ id: "pqt_leak_05", industry: "누수", scenario: "원주 누수 탐지·시공 가상견적", service: "누수 탐지·시공", vendor: "누수탐지", quoteUrl: "https://naver.me/xUZNE2Z5", status: "상담 완료", inspectionMin: 200000, inspectionMax: 300000, constructionPricing: "현장 상황에 따라 변동", travelPolicy: "0원", priceNegotiable: true, consultationContent: "시공비는 현장 확인 후 결정하며 가격 협의가 가능함", memo: "시공비는 현장 상황에 따라 다르며 가격 협의 가능", checklist: { inspectionFee: true, travel: true }, receivedAt: todayKey(), consultedAt: todayKey(), owner: "김현진" })
    ];
    data.partnerVendors = data.partnerQuotes.map(quote => newPartnerVendor({
      id: `pvd_${quote.id}`, vendor: quote.vendor, industry: quote.industry, service: quote.service,
      category: quote.service, phone: quote.phone, phoneLabel: quote.phoneLabel,
      alternatePhone: quote.alternatePhone, alternatePhoneLabel: quote.alternatePhoneLabel,
      quoteUrl: quote.quoteUrl, region: quote.region || "원주"
    }));
    data.partnerQuotes.forEach((quote, index) => { quote.vendorId = data.partnerVendors[index].id; });
    data.tasks = [
      Core.createTask({ customerId: customers[0].id, title: "누수 비교견적 2건 전달", dueAt: todayKey(), priority: "높음", owner: "김현진" }),
      Core.createTask({ customerId: customers[1].id, title: "현장 사진 정리", dueAt: todayKey(), priority: "보통", owner: "김현진" }),
      Core.createTask({ customerId: customers[2].id, title: "통합관리 제안서 초안", dueAt: Core.dayKey(date(1)), priority: "높음", owner: "김현진" })
    ];
    const demoActor = { email: "demo@invalid.local" };
    data.salesProspects = [
      Sales.createSalesProspect({ id: "spr_demo_01", name: "데모 원룸 A", address: "가상주소 A · 화면검증용", region: "원주 데모권역", source: "building_sign", owner: "황우중", priority: "high", stage: "listing_received", vacancyCount: 1, upcomingVacancyCount: 1, lastActivityAt: date(-1), nextAction: "광고 게시 증거 확인", nextActionAt: date(0) }, demoActor),
      Sales.createSalesProspect({ id: "spr_demo_02", name: "데모 다가구 B", address: "가상주소 B · 화면검증용", region: "원주 데모권역", source: "broker", owner: "김현진", priority: "normal", stage: "first_contact", vacancyCount: 2, upcomingVacancyCount: 0, lastActivityAt: date(-3), nextAction: "건물주 답변 확인", nextActionAt: date(-1) }, demoActor),
      Sales.createSalesProspect({ id: "spr_demo_03", name: "데모 관리건물 C", address: "가상주소 C · 화면검증용", region: "원주 데모권역", source: "referral", owner: "대표", priority: "normal", stage: "paid_management", vacancyCount: 0, upcomingVacancyCount: 1, lastActivityAt: date(-2), nextAction: "첫 월간 관리보고 준비", nextActionAt: date(2) }, demoActor)
    ];
    data.salesContacts = [
      Sales.createSalesContact({ id: "sct_demo_01", prospectId: "spr_demo_01", name: "데모 건물주", role: "owner", phone: "000-0000-0000", source: "building_sign", sourceEvidence: "화면검증용 가상 연락처", verifiedAt: date(-10) }, demoActor),
      Sales.createSalesContact({ id: "sct_demo_02", prospectId: "spr_demo_02", name: "데모 담당자", role: "owner", phone: "000-0000-0000", source: "broker", sourceEvidence: "화면검증용 가상 연락처", verifiedAt: date(-5) }, demoActor)
    ];
    data.salesUnits = [
      Sales.createSalesUnit({ id: "sun_demo_01", prospectId: "spr_demo_01", label: "데모 201호", status: "vacant", deposit: 3000000, rent: 350000, maintenanceFee: 50000, note: "화면검증용 가상 호실" }, demoActor),
      Sales.createSalesUnit({ id: "sun_demo_02", prospectId: "spr_demo_02", label: "데모 301호", status: "vacant", note: "화면검증용 가상 호실" }, demoActor),
      Sales.createSalesUnit({ id: "sun_demo_03", prospectId: "spr_demo_03", label: "데모 101호", status: "upcoming", moveOutAt: date(12), note: "화면검증용 가상 호실" }, demoActor)
    ];
    data.salesActivities = [
      Sales.createSalesActivity({ id: "sac_demo_01", prospectId: "spr_demo_01", contactId: "sct_demo_01", type: "call", result: "replied", occurredAt: date(-1), summary: "공실 매물접수 범위 확인", responseText: "광고 등록 진행 요청", scriptId: "S3", scriptVersion: "1.0", nextAction: "광고 게시 증거 확인", nextActionAt: date(0), owner: "황우중" }, { prospects: data.salesProspects, contacts: data.salesContacts, units: data.salesUnits, opportunities: data.salesOpportunities, actor: demoActor }),
      Sales.createSalesActivity({ id: "sac_demo_02", prospectId: "spr_demo_02", contactId: "sct_demo_02", type: "sms", result: "follow_up", occurredAt: date(-3), summary: "공실 여부 확인 문자 발송", scriptId: "S1", scriptVersion: "1.0", nextAction: "건물주 답변 확인", nextActionAt: date(-1), owner: "김현진" }, { prospects: data.salesProspects, contacts: data.salesContacts, units: data.salesUnits, opportunities: data.salesOpportunities, actor: demoActor })
    ];
    const demoEvent = values => Sales.createSalesEvent(Object.assign({ evidenceType: "demo_record", evidenceNote: "화면검증용 가상 완료 증거", occurredAt: date(-2), owner: "데모 담당자" }, values), { prospects: data.salesProspects, contacts: data.salesContacts, units: data.salesUnits, opportunities: data.salesOpportunities, actor: demoActor });
    data.salesEvents = [
      demoEvent({ id: "sev_demo_01", prospectId: "spr_demo_01", type: "prospect_created", occurredAt: date(-12) }),
      demoEvent({ id: "sev_demo_02", prospectId: "spr_demo_01", contactId: "sct_demo_01", type: "contact_verified", occurredAt: date(-10) }),
      demoEvent({ id: "sev_demo_03", prospectId: "spr_demo_01", type: "contact_attempted", channel: "call", result: "replied", occurredAt: date(-9) }),
      demoEvent({ id: "sev_demo_04", prospectId: "spr_demo_01", type: "reply_received", occurredAt: date(-8) }),
      demoEvent({ id: "sev_demo_05", prospectId: "spr_demo_01", type: "interest_qualified", occurredAt: date(-7) }),
      demoEvent({ id: "sev_demo_06", prospectId: "spr_demo_01", type: "meeting_confirmed", occurredAt: date(-6) }),
      demoEvent({ id: "sev_demo_07", prospectId: "spr_demo_01", type: "diagnosis_completed", occurredAt: date(-4) }),
      demoEvent({ id: "sev_demo_08", prospectId: "spr_demo_01", unitId: "sun_demo_01", type: "listing_received", occurredAt: date(-2), evidenceType: "broker_handoff", evidenceNote: "화면검증용 매물접수 확인" }),
      demoEvent({ id: "sev_demo_09", prospectId: "spr_demo_02", type: "prospect_created", occurredAt: date(-6) }),
      demoEvent({ id: "sev_demo_10", prospectId: "spr_demo_02", contactId: "sct_demo_02", type: "contact_verified", occurredAt: date(-5) }),
      demoEvent({ id: "sev_demo_11", prospectId: "spr_demo_02", type: "contact_attempted", channel: "sms", result: "follow_up", occurredAt: date(-3) }),
      demoEvent({ id: "sev_demo_12", prospectId: "spr_demo_03", type: "prospect_created", occurredAt: date(-20) }),
      demoEvent({ id: "sev_demo_13", prospectId: "spr_demo_03", type: "paid_management_started", occurredAt: date(-2), managementStartedAt: date(-2), serviceScope: "공실·입퇴실 일정과 민원 접수", evidenceType: "management_start", evidenceNote: "화면검증용 유료관리 시작 확인" })
    ];
    data.salesOpportunities = [
      Sales.createSalesOpportunity({ id: "sop_demo_01", prospectId: "spr_demo_01", unitId: "sun_demo_01", serviceType: "waterproofing", stage: "quote_requested", requirements: "데모 지하실 방수 견적", owner: "김현진", dueAt: date(3), quoteAmount: 850000 }, demoActor),
      Sales.createSalesOpportunity({ id: "sop_demo_02", prospectId: "spr_demo_03", serviceType: "common_cleaning", stage: "revenue_recorded", requirements: "데모 공용부 청소", owner: "황우중", revenueAmount: 70000, evidenceNote: "화면검증용 매출 기록" }, demoActor)
    ];
    return data;
  }

  function pageMeta() {
    const meta = viewMeta[currentView] || viewMeta.dashboard;
    document.getElementById("pageEyebrow").textContent = meta[0];
    document.getElementById("pageTitle").textContent = meta[1];
    document.querySelectorAll(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.view === currentView));
    document.getElementById("navCaseCount").textContent = activeCases().length;
    document.getElementById("navPaymentCount").textContent = paymentRows("all").filter(item => item.status === "overdue" || item.status === "manual_unpaid" || item.status === "review").length;
    document.getElementById("navCustomerCount").textContent = store.customers.length;
    document.getElementById("navBuildingCount").textContent = store.buildings.length;
    document.getElementById("navVacancyCount").textContent = vacancyNavigationCount();
    document.getElementById("navConsultationCount").textContent = store.activities.length;
    document.getElementById("navContractCount").textContent = store.contracts.filter(item => item.status !== "종료").length;
    document.getElementById("navRelationshipCount").textContent = store.customers.filter(customerIsRelationshipCustomer).length;
    document.getElementById("navPartnerVendorCount").textContent = partnerVendorRows().length;
    document.getElementById("navPartnerQuoteCount").textContent = store.partnerQuotes.filter(item => item.status !== "제외").length;
    document.getElementById("navTaskCount").textContent = store.tasks.filter(item => item.status !== "완료" && item.status !== "취소").length;
    document.body.classList.toggle("crm-read-only", !canWriteCRM());
    const fieldView = currentView === "fieldOperations";
    const calendarView = currentView === "buildingCalendar";
    searchEl.placeholder = fieldView ? "현장 업무 검색" : calendarView ? "건물명·일정 검색" : currentView === "vacancies" ? "건물명·주소 검색" : "고객·건물·연락처 검색";
    searchEl.value = fieldView ? fieldNavigationState.search : calendarView ? workCalendarQuery : crmSearchValue;
    primaryActionButton.hidden = fieldView && !canWriteCRM();
    if (fieldView) {
      primaryActionButton.dataset.action = "new-field-job";
      primaryActionButton.textContent = "＋ 현장 업무 (준비 중)";
    } else if (currentView === "workManagement") {
      primaryActionButton.hidden = !canWriteCRM();
      primaryActionButton.dataset.action = "new-work-record";
      primaryActionButton.textContent = "＋ 새 작업";
    } else if (calendarView) {
      primaryActionButton.hidden = !canWriteCRM();
      if (canWriteCRM()) {
        primaryActionButton.dataset.action = "new-building-schedule";
        primaryActionButton.textContent = "＋ 일정 추가";
      } else {
        delete primaryActionButton.dataset.action;
        primaryActionButton.textContent = "";
      }
    } else if (currentView === "vacancies") {
      const vacancyBuildings = (store.buildings || []).filter(building => building && !building.archivedAt);
      if (!vacancyBuildings.some(building => building.id === selectedVacancyBuildingId)) selectedVacancyBuildingId = vacancyBuildings[0]?.id || "";
      primaryActionButton.hidden = true;
    } else {
      primaryActionButton.hidden = false;
      primaryActionButton.dataset.action = "new-customer";
      primaryActionButton.textContent = "＋ 새 고객";
    }
    fieldOperatorControl.hidden = !["fieldOperations", "buildings", "vacancies", "pipeline"].includes(currentView);
    if (!fieldOperatorControl.hidden) renderFieldOperatorControl();
  }

  function finishViewRender(renderedView) {
    const viewChanged = lastRenderedView !== null && lastRenderedView !== renderedView;
    lastRenderedView = renderedView;
    if (viewChanged && main) main.scrollTop = 0;
  }

  function render() {
    pageMeta();
    if (currentView === "dashboard") renderDashboard();
    else if (currentView === "cases") renderCases();
    else if (currentView === "payments") renderPayments();
    else if (currentView === "customers") renderCustomers();
    else if (currentView === "buildings") renderBuildings();
    else if (currentView === "vacancies") renderVacancies();
    else if (currentView === "buildingCalendar") renderBuildingCalendar();
    else if (currentView === "workManagement") renderWorkManagement();
    else if (currentView === "fieldOperations") renderFieldOperations();
    else if (currentView === "consultations") renderConsultations();
    else if (currentView === "pipeline") renderPipeline();
    else if (currentView === "contracts") renderContracts();
    else if (currentView === "relationships") renderRelationships();
    else if (currentView === "partnerVendors") renderPartnerVendors();
    else if (currentView === "partnerQuotes") renderPartnerQuotes();
    else if (currentView === "tasks") renderTasks();
    else if (currentView === "security") renderSecurity();
    else renderSettings();
    finishViewRender(currentView);
  }

  function renderFieldOperations() {
    const selected = activeFieldOperator();
    const disconnected = ["disconnected", "timeout", "error"].includes(fieldConnectionState.status);
    const authRequired = fieldConnectionState.status === "auth-required";
    const blocked = disconnected || authRequired;
    const currentEmail = String(currentAuth.user && currentAuth.user.email || "").trim();
    const operatorMessage = fieldProfilesAvailable
      ? selected ? `현재 작업자: ${selected.name}` : "현장 업무를 등록하거나 변경하려면 현재 작업자를 선택해 주세요."
      : fieldProfilesError || "작업자 명단을 확인할 수 없습니다. 조회는 가능하지만 등록·변경은 잠시 막힙니다.";
    const title = authRequired
      ? "Google 계정을 다시 연결해 주세요"
      : disconnected ? "현장 업무 연결을 확인해 주세요" : "현장 업무를 불러오고 있습니다";
    const action = authRequired
      ? `<button type="button" class="primary-button field-google-reauth-button" data-action="reauthenticate-field-google"${fieldReauthInProgress ? " disabled" : ""}>${fieldReauthInProgress ? "Google 계정 확인 중…" : "Google 계정으로 다시 연결"}</button>`
      : disconnected ? `<button type="button" class="secondary-button" data-action="reconnect-field">다시 연결</button>` : "";
    main.innerHTML = `<section id="fieldWorkspaceState" class="field-workspace-state" data-state="${attr(fieldConnectionState.status)}">
      <div class="field-state-card" role="status" aria-live="polite">
        <span class="field-state-mark" aria-hidden="true"></span>
        <div><b>${esc(title)}</b><p>${esc(fieldConnectionState.message || "잠시만 기다려 주세요.")}</p>${authRequired ? `<span class="field-auth-account"><strong>현재 CRM 계정</strong><em>${esc(currentEmail || "로그인된 CRM 계정")}</em></span>` : ""}<small>${esc(operatorMessage)}</small></div>
        ${action}
      </div>
    </section>`;
    void measureFieldWorkspace();
    if (!blocked) {
      const generation = ++fieldOpenGeneration;
      requestAnimationFrame(() => { void openFieldOperations(generation); });
    }
  }

  async function measureFieldWorkspace() {
    const rect = main.getBoundingClientRect();
    let result = { ok: false, code: "FIELD_BOUNDS_INVALID" };
    if (rect.width > 0 && rect.height > 0) {
      try {
        result = await api.setFieldBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
      } catch (_error) {}
    }
    if (!fieldResizeObserver && typeof ResizeObserver === "function") {
      fieldResizeObserver = new ResizeObserver(() => {
        if (currentView === "fieldOperations") void measureFieldWorkspace();
      });
      fieldResizeObserver.observe(main);
    }
    return result;
  }

  async function openFieldOperations(generation) {
    fieldConnectionState = Object.assign({}, fieldConnectionState, { status: "connecting", message: "현장 업무에 연결하고 있습니다.", ready: false });
    await measureFieldWorkspace();
    const result = await api.showFieldPlatform(Object.assign({}, fieldNavigationState, { operatorId: selectedFieldOperatorId }));
    if (generation !== fieldOpenGeneration || currentView !== "fieldOperations") return;
    if (!result.ok) {
      fieldConnectionState = Object.assign({}, fieldConnectionState, { status: result.code === "FIELD_BRIDGE_TIMEOUT" ? "timeout" : "disconnected", message: result.error || "현장 업무에 연결하지 못했습니다.", ready: false });
      renderFieldOperations();
    }
  }

  async function sendFieldCommand(command, args = {}) {
    if (!canWriteCRM()) {
      showToast("조회 전용 계정은 현장 업무를 변경할 수 없습니다.", "error");
      return null;
    }
    if (!activeFieldOperator()) {
      showToast(fieldProfilesAvailable ? "현재 작업자를 먼저 선택해 주세요." : (fieldProfilesError || "작업자 명단을 확인할 수 없습니다."), "error");
      fieldOperatorSelect?.focus();
      return null;
    }
    const response = await api.fieldRequest({
      protocolVersion: 2,
      type: "field.command",
      requestId: crypto.randomUUID(),
      payload: { command, operatorId: selectedFieldOperatorId, args },
    });
    if (!response || response.ok === false || response.payload && response.payload.ok === false) {
      showToast("현장 업무 요청을 처리하지 못했습니다. 연결 상태를 확인해 주세요.", "error");
      return null;
    }
    return response;
  }

  async function sendFieldNavigation() {
    return api.fieldRequest({
      protocolVersion: 2,
      type: "field.navigate",
      requestId: crypto.randomUUID(),
      payload: Object.assign({}, fieldNavigationState, { operatorId: selectedFieldOperatorId }),
    });
  }

  async function navigateFromField(entityType, entityId) {
    saveFieldNavigationState();
    if (["buildings", "buildingUnits"].includes(entityType)) {
      if (entityType === "buildingUnits") {
        const unit = Object.values(store.buildingUnits || {}).find(item => item && String(item.id) === entityId);
        selectedBuildingId = String(unit && (unit.crmBuildingId || unit.buildingId) || "");
      } else selectedBuildingId = entityId;
      currentView = "buildings";
    } else if (["salesProspects", "salesUnits"].includes(entityType)) {
      if (entityType === "salesUnits") selectedSalesProspectId = String(salesUnitById(entityId)?.prospectId || "");
      else selectedSalesProspectId = entityId;
      currentView = "pipeline";
    } else if (entityType === "workflowCases") {
      selectedCaseKey = entityId;
      currentView = "cases";
    } else if (entityType === "tasks") currentView = "tasks";
    else return;
    fieldOpenGeneration += 1;
    await api.hideFieldPlatform();
    render();
    if (currentView === "buildings") requestDriveImportCandidatesRefresh();
  }

  function renderDashboard() {
    const stats = Core.calculateDashboard(store, new Date(), []);
    const today = todayKey();
    const customerProgressRows = store.customers.map(customer => ({ customer, progress: customerSalesProgress(customer) }));
    const activeCustomers = customerProgressRows.filter(item => item.progress.stateId !== "paused_closed").map(item => item.customer);
    stats.todayContacts = activeCustomers.filter(customer => dueKey(customer.nextContactAt) === today).length;
    stats.overdueContacts = activeCustomers.filter(customer => customer.nextContactAt && dueKey(customer.nextContactAt) < today).length;
    stats.pipelineValue = activeCustomers.reduce((sum, customer) => sum + Core.money(customer.expectedValue), 0);
    const focus = activeCustomers.filter(customer => customer.nextContactAt && dueKey(customer.nextContactAt) <= today)
      .sort((a, b) => String(a.nextContactAt).localeCompare(String(b.nextContactAt))).slice(0, 8);
    const stageCounts = (Sales.SALES_STAGES || []).map(stage => ({ stage: stage.label, count: customerProgressRows.filter(item => item.progress.filterIds.includes(stage.id)).length }));
    const maxStage = Math.max(1, ...stageCounts.map(item => item.count));
    const recent = [...store.activities].sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt))).slice(0, 4);
    const owner = store.settings.owner || "담당자";
    const focusMessage = stats.overdueContacts
      ? `늦어진 연락 ${stats.overdueContacts}건을 먼저 확인해 주세요.`
      : stats.todayContacts
        ? `오늘 연락할 고객이 ${stats.todayContacts}명 있습니다.`
        : "오늘 예정된 연락은 없습니다. 여유 있게 다음 업무를 준비하세요.";
    main.innerHTML = `
      <section class="today-brief">
        <div><span class="brief-kicker">TODAY</span><h2>${esc(owner)}님, ${esc(focusMessage)}</h2><p>고객 연락과 영업 후속 업무를 한 화면에서 확인할 수 있습니다.</p></div>
        <div class="brief-actions"><span class="brief-value">예상 매출 <b>${esc(compactMoney(stats.pipelineValue))}원</b></span><button class="secondary-button" data-view="tasks">할 일 보기</button><button class="primary-button" data-action="new-customer">＋ 고객 등록</button></div>
      </section>
      ${store.customers.length === 0 ? `<section class="starter-map"><div><span>처음 시작하기</span><h3>먼저 고객 한 명을 등록해 보세요</h3><p>고객과 건물을 연결하면 영업 관리의 건물 단계가 자동으로 표시됩니다.</p></div><div class="starter-steps"><b class="active">1 고객 등록</b><i>→</i><b>2 건물 연결</b><i>→</i><b>3 영업 단계 확인</b></div><button class="primary-button" data-action="new-customer">고객 등록하기 →</button></section>` : ""}
      <div class="kpi-grid">
        ${kpi("전체 고객", stats.totalCustomers, "등록된 고객 수", "#55aee8")}
        ${kpi("오늘 연락할 고객", stats.todayContacts, "오늘 연락 예정", "#5cc9d8", stats.todayContacts ? "good" : "")}
        ${kpi("늦어진 연락", stats.overdueContacts, "우선 확인 필요", "#f47d86", stats.overdueContacts ? "alert" : "")}
        ${kpi("진행 중인 할 일", stats.openTasks, `기한 지난 업무 ${stats.overdueTasks}건`, "#79a9ee", stats.overdueTasks ? "alert" : "")}
      </div>
      <div class="dashboard-grid">
        <section class="panel">
          <div class="panel-head"><div><h3>오늘 먼저 볼 고객</h3><p>고객을 누르면 상세 내용과 상담 기록을 볼 수 있어요.</p></div><button class="text-button" data-view="customers">전체 고객 보기 →</button></div>
          <div class="panel-body focus-list">
            ${focus.length ? focus.map(customer => { const overdue = dueKey(customer.nextContactAt) < today; return `<div class="focus-row ${overdue ? "overdue" : ""}" data-customer-open="${attr(customer.id)}"><i class="signal"></i><div><strong>${esc(customer.name)}</strong><span>${esc(customer.company || customer.type || "고객")}</span></div><p>${esc(customer.nextAction || customer.currentIssue || "후속조치 확인")}</p><time><b>${overdue ? "지연" : "오늘"}</b>${esc(dateText(customer.nextContactAt))}</time></div>`; }).join("") : `<div class="simple-empty"><b>오늘 연락할 고객이 없습니다</b><span>새 고객을 등록하거나 다음 연락일을 지정해 보세요.</span></div>`}
          </div>
        </section>
        <div class="panel-stack">
          <section class="panel">
            <div class="panel-head"><div><h3>연결 고객의 건물 영업 단계</h3><p>영업 관리에 연결된 건물 기준입니다.</p></div><button class="text-button" data-view="pipeline">영업 관리 →</button></div>
            <div class="panel-body pipeline-mini">${stageCounts.filter(item => item.count).map(item => `<div class="pipeline-line"><span>${esc(item.stage)}</span><div class="mini-bar"><i style="width:${Math.max(12, item.count / maxStage * 100)}%"></i></div><b>${item.count}명</b></div>`).join("") || `<div class="simple-empty compact"><b>영업 건물과 연결된 고객이 없습니다</b></div>`}</div>
          </section>
          <section class="panel">
            <div class="panel-head"><div><h3>최근 상담 기록</h3><p>최근에 고객과 나눈 내용을 확인하세요.</p></div></div>
            <div class="panel-body activity-feed">
              ${recent.length ? recent.map(activity => { const customer = customerById(activity.customerId); return `<div class="activity-item" data-customer-open="${attr(activity.customerId)}"><i class="activity-icon">${activityIcon(activity.type)}</i><div><strong>${esc(customer && customer.name || "연결 고객 없음")} · ${esc(activity.type)}</strong><p>${esc(activity.summary || activity.result || "기록 내용 없음")}</p></div><time>${esc(shortDate(activity.occurredAt))}</time></div>`; }).join("") : `<div class="text-muted" style="padding:18px;text-align:center;font-size:10px">상담 기록을 추가하면 여기에 표시됩니다.</div>`}
            </div>
          </section>
        </div>
      </div>`;
  }

  function kpi(label, value, foot, accent, className) {
    return `<article class="kpi-card ${className || ""}" style="--accent:${accent}"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${esc(value)}</div><div class="kpi-foot">${esc(foot)}</div></article>`;
  }

  const activeCases = () => (operations.cases || []).filter(item => item && item.deleted !== true && item.archived !== true);
  const trashCases = () => (operations.cases || []).filter(item => item && item.deleted === true);
  const workflowCaseKey = item => String(item && (item.firebaseKey || item.id) || "");
  const workflowCaseByKey = key => activeCases().find(item => workflowCaseKey(item) === String(key || ""));
  const workflowCaseByAnyKey = key => (operations.cases || []).find(item => workflowCaseKey(item) === String(key || ""));
  const paymentRows = buildingId => {
    const selectedId = buildingId || paymentBuildingFilter;
    if (!selectedId || selectedId === "all") return Core.paymentMonthRows(operations.payments || {}, paymentMonth, todayKey(), "all");
    const building = buildingById(selectedId);
    if (!building) return Core.paymentMonthRows(operations.payments || {}, paymentMonth, todayKey(), selectedId);
    return Core.paymentMonthRows(operations.payments || {}, paymentMonth, todayKey(), "all").filter(row => scheduleBelongsToBuilding(row.schedule, building));
  };
  const paymentStatusLabel = status => status === "paid" ? "입금완료" : status === "overdue" || status === "manual_unpaid" ? "미입금" : status === "review" ? "확인필요" : "입금예정";
  const paymentBuildings = () => {
    const map = new Map();
    const bankBindings = operations.payments && operations.payments.bankBindings || {};
    (store.buildings || []).filter(Boolean).forEach(building => {
      const bindingEntry = paymentBindingEntryForBuilding(building);
      map.set(building.id, { id: building.id, name: building.name || "건물명 미입력", address: building.address || "", unitCount: Number(building.unitCount) || 0, scheduleCount: 0, units: new Set(), accountConnected: !!(bindingEntry && bindingEntry.binding && bindingEntry.binding.accountRef), crmBuildingId: building.id });
    });
    Object.values(operations.payments && operations.payments.schedules || {}).forEach(schedule => {
      if (!schedule || !schedule.buildingId) return;
      const linked = storeBuildingForPaymentSchedule(schedule);
      const canonicalId = linked ? linked.id : String(schedule.buildingId);
      if (!map.has(canonicalId)) map.set(canonicalId, { id: canonicalId, name: schedule.buildingName || "건물명 미입력", address: schedule.buildingAddress || "", unitCount: 0, scheduleCount: 0, units: new Set(), accountConnected: !!bankBindings[schedule.buildingId], crmBuildingId: "" });
      const item = map.get(canonicalId);
      item.scheduleCount += 1;
      if (schedule.unit) item.units.add(String(schedule.unit));
    });
    return [...map.values()].map(item => Object.assign({}, item, { unitCount: item.unitCount || item.units.size, units: undefined })).sort((left, right) => left.name.localeCompare(right.name, "ko"));
  };
  const paymentMonthLabel = value => {
    const match = String(value || "").match(/^(\d{4})-(\d{2})$/);
    return match ? `${match[1]}년 ${Number(match[2])}월` : value;
  };
  const shiftPaymentMonth = amount => {
    const [year, month] = paymentMonth.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1 + Number(amount || 0), 1));
    paymentMonth = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const paymentCalendarDays = monthKey => {
    const [year, month] = monthKey.split("-").map(Number);
    const first = new Date(Date.UTC(year, month - 1, 1));
    const start = new Date(Date.UTC(year, month - 1, 1 - first.getUTCDay()));
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start.getTime() + index * 86400000);
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
    });
  };

  async function refreshOperations(options) {
    const settings = options || {};
    if (operationsLoading) return;
    operationsLoading = true;
    operationsError = "";
    if (!settings.silent && (currentView === "cases" || currentView === "payments" || currentView === "buildings")) render();
    try {
      const loaded = await api.loadOperations();
      operations = {
        cases: Array.isArray(loaded && loaded.cases) ? loaded.cases : [],
        payments: loaded && loaded.payments && typeof loaded.payments === "object" ? loaded.payments : {},
        caseSettings: loaded && loaded.caseSettings && typeof loaded.caseSettings === "object" ? loaded.caseSettings : {},
        loadedAt: loaded && loaded.loadedAt || new Date().toISOString()
      };
      if (currentView === "cases" && !workflowVendors.length) {
        const directory = await api.loadWorkflowVendors({ force: false });
        if (directory && directory.ok) {
          workflowVendors = Array.isArray(directory.vendors) ? directory.vendors : [];
          workflowVendorError = "";
        } else workflowVendorError = directory && directory.error || "최신 업체 목록을 불러오지 못했습니다.";
      }
      const availableCases = caseListMode === "trash" ? trashCases() : activeCases();
      if (!availableCases.some(item => workflowCaseKey(item) === selectedCaseKey)) selectedCaseKey = workflowCaseKey(availableCases[0]);
    } catch (error) {
      operationsError = error.message || "업무 자료를 불러오지 못했습니다.";
    } finally {
      operationsLoading = false;
    }
    pageMeta();
    if (settings.render !== false && (currentView === "cases" || currentView === "payments" || currentView === "buildings")) render();
  }

  function renderCases() {
    const query = Core.normalizeText(searchEl.value);
    const sourceCases = caseListMode === "trash" ? trashCases() : activeCases();
    const cases = sourceCases.filter(item => !query || Core.normalizeText([item.ticketNo, item.receiptNo, item.name, item.building, item.room, item.issueType, item.grade, item.summary].join(" ")).includes(query));
    if (operationsLoading && !operations.loadedAt) {
      main.innerHTML = `<div class="operations-loading">공용 케이스를 불러오고 있습니다…</div>`;
      return;
    }
    if (cases.length && !cases.some(item => workflowCaseKey(item) === selectedCaseKey)) selectedCaseKey = workflowCaseKey(cases[0]);
    const selected = cases.find(item => workflowCaseKey(item) === selectedCaseKey) || null;
    const detail = selected
      ? (caseListMode === "trash" ? renderWorkflowCaseTrashDetail(selected) : renderWorkflowCaseDetail(selected))
      : `<div class="case-detail-empty"><strong>${query ? "검색 결과가 없습니다" : caseListMode === "trash" ? "휴지통이 비어 있습니다" : "등록된 케이스가 없습니다"}</strong><span>${query ? "다른 검색어를 입력해 주세요." : caseListMode === "trash" ? "휴지통으로 이동한 케이스가 여기에 표시됩니다." : "새 케이스를 등록해 업무를 시작하세요."}</span>${caseListMode === "trash" ? `<button class="secondary-button" data-case-list-mode="active">케이스 목록으로 돌아가기</button>` : `<button class="primary-button" data-action="new-workflow-case">＋ 새 케이스</button>`}</div>`;
    main.innerHTML = `<section class="operations-hero case-hero"><div><span>BRING CRM에서 직접 처리합니다</span><h2>접수부터 사후관리까지 17단계 케이스</h2><p>업무흐름빌더와 같은 공용 데이터를 사용하며, 이동하지 않고 이 화면에서 수정·처리합니다.</p></div><div class="operations-actions"><button class="secondary-button" data-action="refresh-operations">↻ 새로고침</button><button class="primary-button" data-action="new-workflow-case">＋ 새 케이스</button></div></section>
      <nav class="payment-mode-tabs" aria-label="입금 관리 구분"><button type="button" class="active" data-payment-mode="recurring">정기 납부</button><button type="button" data-payment-mode="oneOff">단건 계약</button></nav>
      ${operationsError ? `<div class="info-box" style="margin-top:12px;color:#c6535f">${esc(operationsError)}</div>` : ""}
      <section class="case-workspace"><aside class="case-browser"><header><div><b>${caseListMode === "trash" ? "휴지통" : "케이스 목록"}</b><span>${cases.length}건</span></div><small>${caseListMode === "trash" ? "복원할 케이스를 선택하세요." : "선택하면 오른쪽에서 바로 처리됩니다."}</small></header><div class="case-browser-mode"><button type="button" class="${caseListMode === "trash" ? "" : "active"}" data-case-list-mode="${caseListMode === "trash" ? "active" : "trash"}">${caseListMode === "trash" ? `← 케이스 목록 (${activeCases().length})` : `휴지통 (${trashCases().length})`}</button></div><div class="case-browser-list">${cases.length ? cases.map(item => {
        const progress = Core.workflowProgress(item);
        const urgency = String(item.urgency || "보통");
        const urgencyClass = urgency.includes("긴급") ? "urgent" : urgency.includes("확인") ? "review" : "";
        const caseKey = workflowCaseKey(item);
        const listNote = caseListMode === "trash" ? `이동 ${dateText(item.deletedAt)}${item.deletedBy ? ` · ${item.deletedBy}` : ""}` : progress.current;
        return `<article class="case-card case-list-card ${caseKey === selectedCaseKey ? "selected" : ""} ${caseListMode === "trash" ? "trash" : ""}" data-case-select="${attr(caseKey)}"><div class="case-list-title"><strong>${esc(item.ticketNo || item.receiptNo || item.id || "케이스")}</strong><span class="case-urgency ${caseListMode === "trash" ? "trash" : urgencyClass}">${caseListMode === "trash" ? "휴지통" : esc(urgency)}</span></div><p>${esc([item.name, item.building, item.room].filter(Boolean).join(" · ") || "고객·건물 정보 미입력")}</p><div class="case-list-progress"><i><span style="width:${progress.percent}%"></span></i><b>${progress.done}/${progress.total}</b></div><small>${esc(listNote)}</small></article>`;
      }).join("") : `<div class="case-list-empty">표시할 케이스가 없습니다.</div>`}</div></aside><section class="case-detail-panel">${detail}</section></section>`;
  }

  function renderWorkflowCaseDetail(item) {
    const caseKey = workflowCaseKey(item);
    const progress = Core.workflowProgress(item);
    const statuses = item.status || {};
    const notes = item.note || {};
    const option = (value, current, label) => `<option value="${attr(value)}" ${String(value) === String(current) ? "selected" : ""}>${esc(label || value)}</option>`;
    const input = (label, name, value, placeholder) => `<label class="field"><span>${esc(label)}</span><input name="${attr(name)}" value="${attr(value || "")}" placeholder="${attr(placeholder || "")}"></label>`;
    const select = (label, name, values, value) => `<label class="field"><span>${esc(label)}</span><select name="${attr(name)}">${values.map(entry => option(entry, value)).join("")}</select></label>`;
    const linkedBuilding = buildingById(item.crmBuildingId || item.buildingId) || uniqueBuildingNameMatch(item.building);
    const linkedCustomer = customerById(item.crmCustomerId) || Core.matchWorkflowCustomer(item, store.customers);
    const buildingLinkField = `<label class="field"><span>등록 건물 연결</span><select name="crmBuildingId" data-case-building-select><option value="">직접 입력·미연결</option>${store.buildings.map(building => `<option value="${attr(building.id)}" ${linkedBuilding && linkedBuilding.id === building.id ? "selected" : ""}>${esc(buildingChoiceLabel(building))}</option>`).join("")}</select></label>`;
    const customerLinkField = `<label class="field"><span>요청자·연락 고객 연결</span><select name="crmCustomerId" data-case-customer-select><option value="">직접 입력·미연결</option>${store.customers.map(customer => `<option value="${attr(customer.id)}" ${linkedCustomer && linkedCustomer.id === customer.id ? "selected" : ""}>${esc(customer.name || customer.id)}${customer.type ? ` · ${esc(customer.type)}` : ""}</option>`).join("")}</select></label>`;
    return `<header class="case-detail-head"><div><span>${esc(item.issueType || item.grade || "업무 유형 미입력")}</span><h2>${esc(item.ticketNo || item.receiptNo || item.id || "케이스")}</h2><p>${esc([item.name, item.building, item.room].filter(Boolean).join(" · ") || "기본 정보를 입력해 주세요.")}</p></div><div class="case-detail-head-actions"><button type="button" class="case-trash-action" data-case-trash="${attr(caseKey)}">휴지통으로 이동</button><div class="case-detail-progress"><strong>${progress.percent}%</strong><span>${progress.done}/${progress.total}단계 완료</span></div></div></header>
      <div class="case-detail-scroll"><form id="workflowCaseBasicForm" data-case-key="${attr(caseKey)}"><div class="case-block-head"><div><b>기본 정보</b><span>수정 후 저장을 누르면 공용 케이스에 즉시 반영됩니다.</span></div><button class="secondary-button">기본 정보 저장</button></div><div class="case-basic-grid">${customerLinkField}${input("고객명", "name", item.name, "예: 홍길동")}${input("연락처", "phone", item.phone, "010-0000-0000")}${input("이메일", "email", item.email, "name@example.com")}${buildingLinkField}${input("건물", "building", item.building, "건물명")}${input("호실", "room", item.room, "예: 302호")}${input("주소", "address", item.address, "건물 주소")}${input("업무 유형", "issueType", item.issueType, "예: 누수")}${select("긴급도", "urgency", ["보통", "확인 필요", "긴급"], item.urgency || "보통")}${select("관리 등급", "grade", ["라이트", "스탠다드", "프리미엄"], item.grade || "스탠다드")}<label class="field case-summary-field"><span>접수 내용</span><textarea name="summary" placeholder="민원·요청 내용을 입력하세요.">${esc(item.summary || "")}</textarea></label></div></form>
      <section class="case-steps-section"><div class="case-block-head"><div><b>17단계 업무 진행</b><span>상태를 바꾸거나 단계 메모를 남기면 이 화면에서 바로 저장됩니다.</span></div><div class="case-current-label"><span>현재</span><b>${esc(progress.current)}</b></div></div><div class="case-progress-track case-detail-track"><i style="width:${progress.percent}%"></i></div><div class="workflow-case-steps">${Core.WORKFLOW_STEPS.map((label, index) => {
        const stepKey = `c${index + 1}`;
        const status = statuses[stepKey] || "wait";
        const note = notes[stepKey] || "";
        const isOpen = openCaseStepKey === stepKey;
        const statusText = status === "done" ? "완료" : status === "doing" ? "진행 중" : "대기";
        return `<article class="workflow-case-step ${attr(status)}"><div class="case-step-main"><i>${index + 1}</i><div><b>${esc(label)}</b>${note ? `<span>${esc(note)}</span>` : `<span>단계 메모 없음</span>`}</div><select data-case-step-status="${attr(stepKey)}" data-case-key="${attr(caseKey)}" aria-label="${esc(label)} 상태">${option("wait", status, "대기")}${option("doing", status, "진행 중")}${option("done", status, "완료")}</select><button class="case-note-button ${note ? "has" : ""}" data-case-note-toggle="${attr(stepKey)}" title="상세 내용 ${isOpen ? "숨기기" : "열기"}">${isOpen ? "숨기기" : "열기"}</button></div>${isOpen ? `<div class="case-step-expanded">${renderWorkflowCaseStepDetails(item, stepKey)}<form class="case-step-note-form" data-case-key="${attr(caseKey)}" data-step-key="${attr(stepKey)}"><div class="case-step-note-title"><b>단계 메모</b><span>처리 내용·업체·금액·일정·결과를 자유롭게 기록하세요.</span></div><textarea name="stepNote" placeholder="이 단계에서 처리한 내용을 기록하세요.">${esc(note)}</textarea><div><span>${esc(statusText)} · 모든 사용자에게 공유</span><button class="secondary-button">메모 저장</button></div></form></div>` : ""}</article>`;
      }).join("")}</div></section></div>`;
  }

  function renderWorkflowCaseTrashDetail(item) {
    const caseKey = workflowCaseKey(item);
    const progress = Core.workflowProgress(item);
    const statuses = item.status || {};
    const notes = item.note || {};
    const values = [
      ["고객명", item.name], ["연락처", item.phone], ["이메일", item.email],
      ["건물", item.building], ["호실", item.room], ["주소", item.address],
      ["업무 유형", item.issueType], ["긴급도", item.urgency], ["접수 내용", item.summary]
    ];
    return `<header class="case-detail-head case-trash-head"><div><span>휴지통 케이스</span><h2>${esc(item.ticketNo || item.receiptNo || item.id || "케이스")}</h2><p>${esc([item.name, item.building, item.room].filter(Boolean).join(" · ") || "기본 정보 미입력")}</p></div><div class="case-detail-head-actions"><div class="case-trash-head-buttons"><button type="button" class="secondary-button" data-case-restore="${attr(caseKey)}">케이스 복원</button><button type="button" class="case-permanent-delete" data-case-delete="${attr(caseKey)}">영구 삭제</button></div><div class="case-detail-progress"><strong>${progress.percent}%</strong><span>${progress.done}/${progress.total}단계 완료</span></div></div></header>
      <div class="case-detail-scroll case-trash-detail"><section class="case-trash-notice"><div><b>휴지통으로 이동된 케이스입니다.</b><span>${esc(dateText(item.deletedAt))} · ${esc(item.deletedBy || "사용자 미확인")}</span></div><button type="button" class="primary-button" data-case-restore="${attr(caseKey)}">복원하기</button></section>
      <section class="case-readonly-section"><header><div><b>케이스 정보</b><span>휴지통에서는 내용을 수정할 수 없습니다.</span></div></header><div class="case-readonly-grid">${values.map(([label, value]) => `<div><b>${esc(label)}</b><span>${esc(value || "-")}</span></div>`).join("")}</div></section>
      <section class="case-readonly-section"><header><div><b>17단계 진행 기록</b><span>복원하면 기존 상태와 메모가 그대로 유지됩니다.</span></div></header><div class="case-trash-steps">${Core.WORKFLOW_STEPS.map((label, index) => {
        const stepKey = `c${index + 1}`;
        const status = statuses[stepKey] || "wait";
        const statusText = status === "done" ? "완료" : status === "doing" ? "진행 중" : "대기";
        return `<article class="${attr(status)}"><i>${index + 1}</i><div><b>${esc(label)}</b><span>${esc(notes[stepKey] || "메모 없음")}</span></div><em>${esc(statusText)}</em></article>`;
      }).join("")}</div></section></div>`;
  }

  const caseObjectValues = value => Array.isArray(value) ? value.filter(Boolean) : value && typeof value === "object" ? Object.values(value).filter(Boolean) : [];
  const caseFirst = (...values) => values.find(value => value !== undefined && value !== null && String(value).trim() !== "") ?? "";
  const caseDisplayValue = value => {
    if (value === true) return "예";
    if (value === false) return "아니오";
    if (Array.isArray(value)) return value.map(caseDisplayValue).filter(Boolean).join(" · ");
    if (value && typeof value === "object") return caseFirst(value.statusText, value.name, value.fileName, value.label, value.status, value.message) || "자료 있음";
    return String(value ?? "").trim();
  };
  const caseDetailGrid = (title, rows) => {
    const visible = rows.map(([label, value]) => [label, caseDisplayValue(value)]).filter(([, value]) => value);
    if (!visible.length) return "";
    return `<section class="case-extra-block"><header>${esc(title)}</header><div class="case-extra-grid">${visible.map(([label, value]) => `<div><b>${esc(label)}</b><span>${esc(value)}</span></div>`).join("")}</div></section>`;
  };
  const caseTextPanel = (title, text, className) => String(text || "").trim() ? `<section class="case-extra-block"><header>${esc(title)}</header><pre class="case-extra-text ${className || ""}">${esc(String(text).trim())}</pre></section>` : "";
  const caseResourceLinks = (title, resources) => {
    const links = resources.map(resource => {
      if (!resource) return null;
      if (typeof resource === "string") return /^https?:\/\//i.test(resource) ? { label: "자료 열기", url: resource } : null;
      const url = caseFirst(resource.fileUrl, resource.driveUrl, resource.url, resource.webViewLink, resource.sheetUrl, resource.shortDecisionUrl, resource.decisionUrl);
      if (!/^https?:\/\//i.test(String(url || ""))) return null;
      return { label: caseFirst(resource.label, resource.fileName, resource.originalFileName, resource.name, "자료 열기"), url };
    }).filter(Boolean);
    if (!links.length) return "";
    return `<section class="case-extra-block"><header>${esc(title)}</header><div class="case-resource-links">${links.map(link => `<button type="button" data-case-resource-link="${attr(link.url)}">${esc(link.label)} ↗</button>`).join("")}</div></section>`;
  };
  const caseMoneyText = value => {
    const amount = Core.money(value);
    return amount ? `${amount.toLocaleString("ko-KR")}원` : "";
  };
  const caseReceiptPreview = item => [
    "[BRING Care]", "민원이 접수되었습니다.",
    `접수번호: ${item.ticketNo || item.id || "미발급"}`,
    item.building ? `건물: ${item.building}` : "",
    item.room ? `호실: ${item.room}` : "",
    item.issueType ? `문제: ${item.issueType}` : "",
    "확인 후 안내드리겠습니다."
  ].filter(Boolean).join("\n");
  const caseVendorRequestPreview = item => [
    "[BRING Care 견적서 회신 요청]", "", "안녕하세요. BRING Care입니다.",
    "아래 현장 내용을 확인하신 후 작업 가능 여부와 견적서를 회신 부탁드립니다.", "",
    "■ 민원 내용", `- 증상: ${item.summary || item.issueType || "접수 내용 확인 필요"}`,
    `- 방문 가능 시간대: ${item.visitTime || item.visitDate || "일정 협의"}`, "",
    "■ 회신 요청 내용", "- 작업 가능 여부", "- 예상 작업 내용", "- 총 견적금액", "- 방문 가능 일정", "",
    "■ 첨부 요청", "- 견적서", "- 사업자등록증 사본", "", "확인 후 회신 부탁드립니다."
  ].join("\n");
  const caseVendorRows = item => {
    const fromSelections = caseObjectValues(item.vendorSelections);
    const fromSelected = caseObjectValues(item.selectedVendors);
    const values = [...fromSelections, ...fromSelected];
    const seen = new Set();
    return values.filter(vendor => {
      const key = typeof vendor === "string" ? vendor : caseFirst(vendor.id, vendor.name, vendor.phone, JSON.stringify(vendor));
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const caseVendorPanel = vendors => {
    if (!vendors.length) return "";
    return `<section class="case-extra-block"><header>선택 업체 ${vendors.length}곳</header><div class="case-vendor-list">${vendors.map(vendor => typeof vendor === "string" ? `<article><b>${esc(vendor)}</b></article>` : `<article><b>${esc(caseFirst(vendor.name, vendor.company, "업체명 미입력"))}</b><span>${esc([vendor.category || vendor.type, vendor.phone, vendor.address].filter(Boolean).join(" · ") || "연락처 미입력")}</span>${vendor.map || vendor.url ? `<button type="button" data-case-resource-link="${attr(vendor.map || vendor.url)}">업체 정보 ↗</button>` : ""}</article>`).join("")}</div></section>`;
  };
  const CASE_VENDOR_CATEGORY_MAP = Object.freeze({
    "누수": ["누수·배관"], "누수·배관": ["누수·배관"], "누수·방수": ["누수·배관", "방수·코킹"], "배관": ["누수·배관"],
    "전기": ["전기·조명"], "전기·조명": ["전기·조명"], "도배": ["도배공사"], "도배공사": ["도배공사"],
    "방수": ["방수·코킹"], "타일·방수": ["타일공사", "방수·코킹"], "타일": ["타일공사"], "타일공사": ["타일공사"],
    "도어락": ["문·창호·도어락"], "창호": ["문·창호·도어락"], "문": ["문·창호·도어락"],
    "보일러": ["냉난방·보일러"], "에어컨": ["냉난방·에어컨"], "청소": ["청소·위생"], "방역": ["청소·위생"],
    "소방": ["소방·안전"], "소방·안전": ["소방·안전"]
  });
  const normalizedVendorKey = value => String(value || "").replace(/\s+/g, "").replace(/[ㆍ・]/g, "·");
  const caseVendorCategories = item => {
    const source = normalizedVendorKey(item.vendorType || item.issueType);
    const direct = [...new Set(workflowVendors.map(vendor => vendor.category).filter(Boolean))].find(category => normalizedVendorKey(category) === source);
    return [...new Set([...(CASE_VENDOR_CATEGORY_MAP[source] || []), direct].filter(Boolean))];
  };
  const workflowVendorId = vendor => String(vendor && (vendor.id || [vendor.category, vendor.no, vendor.name, vendor.phone].join("_")) || "").replace(/[.#$\[\]\/]/g, "_").slice(0, 120);
  const caseVendorCandidates = item => {
    const categories = caseVendorCategories(item);
    return workflowVendors.filter(vendor => categories.includes(vendor.category)).slice(0, 30);
  };
  const caseVendorPicker = item => {
    const selected = new Set(caseVendorRows(item).map(workflowVendorId));
    const candidates = caseVendorCandidates(item);
    if (!candidates.length) return `<section class="case-extra-block"><header>업체 선택</header><div class="case-extra-empty">${esc(workflowVendorError || `${item.vendorType || item.issueType || "현재 분류"}에 맞는 업체를 찾지 못했습니다.`)} <button type="button" class="text-button" data-action="refresh-workflow-vendors">업체 목록 새로고침</button></div></section>`;
    return `<section class="case-extra-block case-vendor-picker"><header><span>업체 선택</span><small>동일 조건으로 견적을 요청할 업체를 체크하세요.</small></header><div class="case-vendor-options">${candidates.map(vendor => {
      const id = workflowVendorId(vendor);
      const checked = selected.has(id) || caseVendorRows(item).some(current => current.name === vendor.name && current.phone === vendor.phone);
      return `<article class="case-vendor-option ${checked ? "selected" : ""}"><label><input type="checkbox" data-case-vendor-select="${attr(id)}" data-case-key="${attr(workflowCaseKey(item))}" data-vendor-json="${attr(JSON.stringify(vendor))}" ${checked ? "checked" : ""}><span><b>${esc(vendor.name)}</b><small>${esc([vendor.category, vendor.type, vendor.phone].filter(Boolean).join(" · ") || "연락처 미입력")}</small></span></label>${vendor.map ? `<button type="button" data-case-resource-link="${attr(vendor.map)}">정보 ↗</button>` : ""}</article>`;
    }).join("")}</div></section>`;
  };
  const caseQuoteRows = item => Object.entries(item.quoteFiles || {}).map(([id, quote]) => Object.assign({ storedId: id, id }, quote || {})).filter(Boolean);
  const caseQuotePanel = item => {
    const quotes = caseQuoteRows(item);
    if (!quotes.length) return "";
    return `<section class="case-extra-block"><header>등록 견적서 ${quotes.length}건</header><div class="case-quote-list">${quotes.map((quote, index) => {
      const supplier = quote.supplier || quote.bringQuoteSupplier || {};
      const name = caseFirst(supplier.name, quote.vendorName, quote.company, quote.fileName, `견적 ${index + 1}`);
      const amount = caseMoneyText(caseFirst(quote.bringQuoteTotalAmount, quote.confirmedTotalAmount, quote.totalAmount, quote.total, quote.amount));
      const url = caseFirst(quote.fileUrl, quote.driveUrl, quote.url, quote.webViewLink);
      const quoteId = caseFirst(quote.storedId, quote.id);
      const confirmed = Boolean(caseFirst(quote.bringQuoteTotalAmount, quote.confirmedTotalAmount, quote.totalAmount));
      return `<article class="case-quote-card"><div><b>${esc(name)}</b><span>${esc([amount, quote.statusText || quote.status].filter(Boolean).join(" · ") || "금액 확인 필요")}</span></div><div class="case-quote-actions">${!confirmed ? `<input data-quote-amount-input="${attr(quoteId)}" inputmode="numeric" placeholder="합계금액"><button type="button" data-case-quote-confirm="${attr(quoteId)}" data-case-key="${attr(workflowCaseKey(item))}">금액 확정</button>` : ""}${url ? `<button type="button" data-case-resource-link="${attr(url)}">견적서 열기 ↗</button>` : ""}</div></article>`;
    }).join("")}</div></section>`;
  };
  const casePhotoPanel = (item, title) => {
    const photos = [...caseObjectValues(item.workPhotoFiles), ...caseObjectValues(item.photos)];
    if (!photos.length) return "";
    return `<section class="case-extra-block"><header>${esc(title || "등록 사진")} ${photos.length}장</header><div class="case-photo-list">${photos.map((photo, index) => {
      const phase = photo.phase === "before" ? "작업 전" : photo.phase === "after" ? "작업 후" : "현장";
      const url = caseFirst(photo.fileUrl, photo.driveUrl, photo.url, photo.webViewLink);
      return `<article><div><b>${esc(caseFirst(photo.fileName, photo.name, `사진 ${index + 1}`))}</b><span>${esc(phase)}</span></div>${url ? `<button type="button" data-case-resource-link="${attr(url)}">사진 열기 ↗</button>` : ""}</article>`;
    }).join("")}</div></section>`;
  };

  const caseOwnerRecommendationMessage = (item, quote, supplier, amount) => [
    "[BRING Care 추천 견적 안내]", "", `${item.name || "건물주"}님, 요청하신 유지보수 건의 추천 견적을 안내드립니다.`, "",
    `접수번호: ${item.ticketNo || item.id || "미발급"}`,
    `추천 업체: ${caseFirst(supplier && supplier.name, quote && quote.vendorName, "업체 확인 필요")}`,
    `최종 금액: ${caseMoneyText(amount) || "금액 확인 필요"}`,
    "", "첨부 견적과 승인 링크를 확인해 주세요."
  ].join("\n");
  const caseActionButton = (item, action, label, options) => {
    const settings = options || {};
    const key = `${workflowCaseKey(item)}:${action}`;
    const busy = workflowActionKey === key;
    return `<button type="button" class="${settings.secondary ? "secondary-button" : "primary-button"}" data-workflow-action="${attr(action)}" data-case-key="${attr(workflowCaseKey(item))}" ${settings.disabled || busy ? "disabled" : ""}>${busy ? "처리 중…" : esc(label)}</button>`;
  };
  const renderCaseStepActions = (item, stepKey, context) => {
    const details = context || {};
    const vendors = details.vendors || [];
    const quotes = details.quotes || [];
    const recommended = details.recommended || {};
    const supplier = details.supplier || {};
    const recommendedAmount = details.recommendedAmount;
    if (stepKey === "c2") {
      const sent = /완료|success|sent/i.test(String(caseFirst(item.sms && item.sms.status, item.complaintReceiptSms && item.complaintReceiptSms.status)));
      return `<section class="case-action-panel"><div><b>접수확인 문자</b><span>발송 전 수신번호와 문구를 확인합니다.</span></div>${caseActionButton(item, "sendComplaintReceiptSms", sent ? "접수확인 문자 다시 발송" : "접수확인 문자 발송")}</section>`;
    }
    if (stepKey === "c5") {
      return `${caseVendorPicker(item)}<section class="case-action-panel"><div><b>선택 업체에 견적 요청</b><span>${vendors.length ? `${vendors.length}곳에 같은 문구와 현장 사진을 MMS로 보냅니다.` : "위에서 발송할 업체를 먼저 선택하세요."}</span></div>${caseActionButton(item, "sendVendorEstimateMms", "업체 MMS 발송", { disabled: !vendors.length })}</section>`;
    }
    if (stepKey === "c6") {
      const businessFiles = caseObjectValues(item.businessRegistrationFiles);
      return `<section class="case-action-panel case-action-panel-stack"><div><b>견적 자료 등록</b><span>파일은 1개당 5MB 이하이며 Drive와 공용 케이스에 저장됩니다.</span></div><div class="case-action-buttons"><button type="button" class="primary-button" data-case-upload="quote" data-case-key="${attr(workflowCaseKey(item))}">＋ 견적서 업로드</button><button type="button" class="secondary-button" data-case-upload="business-registration" data-case-key="${attr(workflowCaseKey(item))}">＋ 사업자등록증 업로드</button></div>${businessFiles.length ? `<small>사업자등록증 ${businessFiles.length}건 등록됨</small>` : ""}</section>`;
    }
    if (stepKey === "c8") {
      const hasQuote = Boolean(caseFirst(recommended.id, recommended.storedId));
      const sent = /완료|success|sent/i.test(String(caseFirst(item.ownerRecommendationMms && item.ownerRecommendationMms.status, item.ownerRecommendationMms && item.ownerRecommendationMms.statusText)));
      return `<section class="case-action-panel case-action-panel-stack"><div><b>건물주 추천·승인 요청</b><span>${hasQuote ? `${caseFirst(supplier.name, recommended.vendorName, "추천 업체")} · ${caseMoneyText(recommendedAmount) || "금액 확인 필요"}` : "먼저 ⑥에서 견적 금액을 확정해 주세요."}</span></div><div class="case-action-buttons">${caseActionButton(item, "getOwnerRecommendationPreview", "추천 이미지 준비", { secondary: true, disabled: !hasQuote })}${caseActionButton(item, "ensureOwnerDecisionLink", "승인 링크 준비", { secondary: true, disabled: !hasQuote })}${caseActionButton(item, "sendOwnerRecommendationMms", "건물주 MMS 발송", { disabled: !hasQuote })}${sent ? caseActionButton(item, "confirmOwnerRecommendationMms", "문자 수신 확인", { secondary: true }) : ""}</div></section>`;
    }
    if (stepKey === "c10") {
      const confirmed = item.paymentStatus === "confirmed";
      return `<section class="case-action-panel"><div><b>관리자 입금 확인</b><span>${confirmed ? "입금 확인이 완료되어 업체 연결·일정 단계로 진행합니다." : "실제 사업자계좌 입금내역을 확인한 뒤에만 눌러 주세요."}</span></div>${confirmed ? `<span class="case-action-done">확인 완료</span>` : caseActionButton(item, "confirmCasePayment", "입금 확인")}</section>`;
    }
    if (stepKey === "c13") {
      return `<section class="case-action-panel case-action-panel-stack"><div><b>작업 전·후 사진 업로드</b><span>사진을 구분해 올리면 B/A 보고서 참고 영역에도 함께 반영됩니다.</span></div><div class="case-action-buttons"><button type="button" class="secondary-button" data-case-upload="work-photo" data-photo-phase="before" data-case-key="${attr(workflowCaseKey(item))}">＋ 작업 전 사진</button><button type="button" class="primary-button" data-case-upload="work-photo" data-photo-phase="after" data-case-key="${attr(workflowCaseKey(item))}">＋ 작업 후 사진</button></div></section>`;
    }
    return "";
  };

  function renderWorkflowCaseStepDetails(item, stepKey) {
    const sms = item.complaintReceiptSms || item.sms || {};
    const vendorMms = item.vendorEstimateMms || {};
    const recommendation = item.recommendation || {};
    const ownerMms = item.ownerRecommendationMms || {};
    const decision = item.ownerDecision || {};
    const account = item.paymentAccount || {};
    const vendors = caseVendorRows(item);
    const quotes = caseQuoteRows(item);
    const recommended = quotes.find(quote => String(caseFirst(quote.id, quote.storedId)) === String(recommendation.quoteId || "")) || quotes
      .filter(quote => Core.money(caseFirst(quote.bringQuoteTotalAmount, quote.confirmedTotalAmount, quote.totalAmount, quote.total, quote.amount)) > 0)
      .sort((left, right) => Core.money(caseFirst(left.bringQuoteTotalAmount, left.confirmedTotalAmount, left.totalAmount, left.total, left.amount)) - Core.money(caseFirst(right.bringQuoteTotalAmount, right.confirmedTotalAmount, right.totalAmount, right.total, right.amount)))[0] || {};
    const supplier = recommended.supplier || recommended.bringQuoteSupplier || recommendation.supplier || {};
    const recommendedAmount = caseFirst(recommended.bringQuoteTotalAmount, recommended.confirmedTotalAmount, recommended.totalAmount, recommendation.bringTotalAmount, decision.bringTotalAmount);
    const commonFiles = [item.sheetUrl, ...(caseObjectValues(item.photos)), ...(caseObjectValues(item.contractMatch && item.contractMatch.candidates))];
    let content = "";
    if (stepKey === "c1") {
      content += caseDetailGrid("접수 정보", [["접수번호", item.ticketNo || item.id], ["고객명", item.name], ["연락처", item.phone], ["건물·호실", [item.building, item.room].filter(Boolean).join(" · ")], ["주소", item.address], ["문제 유형", item.issueType], ["방문 가능", item.visitTime || item.visitDate], ["접수 시각", item.receivedAt || item.createdAt]]);
      content += caseTextPanel("접수 내용", item.summary);
      content += caseResourceLinks("접수 원본·사진", commonFiles);
    } else if (stepKey === "c2") {
      content += caseDetailGrid("접수확인 발송 상태", [["발송 상태", caseFirst(sms.statusText, sms.status, item.automationState && item.automationState.receiptSms && item.automationState.receiptSms.status)], ["발송 시각", caseFirst(sms.sentAt, sms.at)], ["수신 연락처", item.phone], ["처리 결과", caseFirst(sms.message, sms.result)]]);
      content += caseTextPanel("발송 문구 미리보기", caseReceiptPreview(item), "message");
    } else if (stepKey === "c3") {
      content += caseDetailGrid("상담 확인 정보", [["고객", item.name], ["연락처", item.phone], ["문제 유형", item.issueType], ["방문 가능", item.visitTime || item.visitDate], ["현장 사진", caseObjectValues(item.photos).length ? `${caseObjectValues(item.photos).length}장` : ""]]);
      content += caseTextPanel("상담 요약·요청 내용", item.summary);
      content += caseTextPanel("판단 근거", item.analysisReason);
      content += caseResourceLinks("상담 원본", commonFiles);
    } else if (stepKey === "c4") {
      content += caseDetailGrid("민원·요청 분류", [["업체 분류", item.vendorType || item.issueType], ["긴급도", item.urgency], ["현장·견적", item.requiresSiteVisit || (item.urgency === "긴급" ? "현장 확인 필요" : "필요 여부 확인")], ["계약 상태", item.statusValue], ["문제 유형", item.issueType]]);
      content += caseTextPanel("분류 근거", item.analysisReason || item.summary);
    } else if (stepKey === "c5") {
      content += caseDetailGrid("업체 견적 요청 상태", [["업체 분류", item.vendorType || item.issueType], ["선택 업체", vendors.length ? `${vendors.length}곳` : ""], ["MMS 상태", caseFirst(vendorMms.statusText, vendorMms.status)], ["요청 시각", caseFirst(vendorMms.requestedAt, vendorMms.sentAt, vendorMms.at)], ["처리 결과", caseFirst(vendorMms.message, vendorMms.result)]]);
      content += caseVendorPanel(vendors);
      content += caseTextPanel("발송 문구 미리보기", caseVendorRequestPreview(item), "message");
    } else if (stepKey === "c6") {
      content += caseQuotePanel(item);
      content += caseDetailGrid("견적 비교 요약", [["등록 견적", quotes.length ? `${quotes.length}건` : ""], ["추천 견적", recommendation.vendorName || supplier.name], ["추천 금액", caseMoneyText(recommendedAmount)]]);
    } else if (stepKey === "c7") {
      content += caseDetailGrid("최적 추천", [["추천 업체", caseFirst(supplier.name, recommendation.vendorName)], ["공급가액", caseMoneyText(caseFirst(recommended.bringQuoteSupplyAmount, recommended.supplyAmount))], ["부가세", caseMoneyText(caseFirst(recommended.bringQuoteVatAmount, recommended.vatAmount))], ["최종금액", caseMoneyText(recommendedAmount)], ["추천 사유", caseFirst(recommendation.reason, recommendation.statusText)]]);
      content += caseResourceLinks("추천 견적서", [recommended]);
    } else if (stepKey === "c8") {
      content += caseDetailGrid("건물주 추천 발송", [["발송 상태", caseFirst(ownerMms.statusText, ownerMms.status)], ["건물주 연락처", caseFirst(ownerMms.phone, decision.ownerPhone, item.ownerPhone)], ["추천 업체", caseFirst(supplier.name, recommendation.vendorName, decision.vendorName)], ["최종금액", caseMoneyText(recommendedAmount)], ["발송 시각", caseFirst(ownerMms.sentAt, ownerMms.requestedAt, ownerMms.at)]]);
      content += caseTextPanel("건물주 발송 내용", caseFirst(ownerMms.message, ownerMms.preview && ownerMms.preview.message));
      content += caseResourceLinks("추천 이미지·승인 링크", [ownerMms, ownerMms.preview || {}, decision]);
    } else if (stepKey === "c9") {
      const decisionLabel = decision.status === "approved_payment" ? "승인하고 입금 진행" : decision.status === "request_other_quote" ? "다른 견적 요청" : "건물주 응답 대기";
      content += caseDetailGrid("승인·입금 응답", [["응답 상태", decisionLabel], ["추천 업체", caseFirst(decision.vendorName, supplier.name)], ["최종금액", caseMoneyText(recommendedAmount)], ["응답 시각", decision.decidedAt], ["응답자", decision.decidedBy]]);
      content += caseResourceLinks("모바일 승인 자료", [decision]);
    } else if (stepKey === "c10") {
      content += caseDetailGrid("입금 확인", [["입금 상태", item.paymentStatus === "confirmed" ? "입금 확인 완료" : caseFirst(item.paymentStatus, "관리자 확인 대기")], ["입금 계좌", account.accountNumber], ["예금주", account.accountHolder], ["확인 금액", caseMoneyText(caseFirst(item.paymentExpectedAmount, recommendedAmount))], ["확인 시각", caseFirst(item.paymentConfirmedAt, item.paymentConfirmation && item.paymentConfirmation.confirmedAt)], ["확인 담당자", item.paymentConfirmedBy]]);
    } else if (stepKey === "c11") {
      const schedule = item.vendorSchedule || item.workSchedule || item.schedule || {};
      content += caseDetailGrid("업체 연결·일정", [["연결 업체", caseFirst(schedule.vendorName, schedule.company, item.connectedVendor, supplier.name)], ["업체 연락처", caseFirst(schedule.phone, supplier.phone)], ["방문·공사 일정", caseFirst(schedule.visitAt, schedule.workAt, schedule.date, item.workDate)], ["담당자", caseFirst(schedule.owner, item.assignee)], ["일정 상태", caseFirst(schedule.statusText, schedule.status)]]);
    } else if (stepKey === "c12") {
      const inspection = item.inspectionChecklist || item.inspection || {};
      content += caseDetailGrid("공사 진행·점검", [["공사 상태", caseFirst(inspection.statusText, inspection.status, item.workStatus)], ["시작일", caseFirst(inspection.startedAt, item.workStartedAt)], ["완료 예정", caseFirst(inspection.dueAt, item.workDueAt)], ["점검 항목", caseObjectValues(inspection.items || inspection.checklist).length ? `${caseObjectValues(inspection.items || inspection.checklist).length}개` : ""], ["현장 담당", caseFirst(inspection.owner, item.assignee)]]);
      content += caseResourceLinks("점검표", [inspection]);
    } else if (stepKey === "c13") {
      content += casePhotoPanel(item, "작업 전·후 사진");
    } else if (stepKey === "c14") {
      const report = item.baReport || item.report || {};
      content += caseDetailGrid("B/A 보고서", [["보고서 상태", caseFirst(report.statusText, report.status)], ["작성일", caseFirst(report.createdAt, report.updatedAt)], ["작성자", report.owner], ["작업 사진", caseObjectValues(item.workPhotoFiles).length ? `${caseObjectValues(item.workPhotoFiles).length}장` : ""]]);
      content += caseResourceLinks("보고서 파일", [report, ...caseObjectValues(item.reportFiles)]);
      content += casePhotoPanel(item, "보고서 참고 사진");
    } else if (stepKey === "c15") {
      const settlement = item.settlement || item.settlementEvidence || {};
      content += caseDetailGrid("정산·증빙", [["정산 상태", caseFirst(settlement.statusText, settlement.status)], ["정산 금액", caseMoneyText(caseFirst(settlement.amount, item.settlementAmount))], ["정산일", caseFirst(settlement.settledAt, settlement.date)], ["증빙 수", caseObjectValues(item.evidenceFiles || settlement.files).length ? `${caseObjectValues(item.evidenceFiles || settlement.files).length}건` : ""]]);
      content += caseResourceLinks("정산 증빙", [...caseObjectValues(item.evidenceFiles), ...caseObjectValues(settlement.files)]);
    } else if (stepKey === "c16") {
      const report = item.monthlyReport || {};
      content += caseDetailGrid("월간 리포트", [["리포트 상태", caseFirst(report.statusText, report.status)], ["대상 월", caseFirst(report.month, item.reportMonth)], ["생성일", caseFirst(report.createdAt, report.updatedAt)], ["담당자", report.owner]]);
      content += caseResourceLinks("월간 리포트 파일", [report, ...caseObjectValues(item.monthlyReportFiles)]);
    } else if (stepKey === "c17") {
      const care = item.maintenance || item.aftercare || {};
      content += caseDetailGrid("유지관리·사후관리", [["관리 상태", caseFirst(care.statusText, care.status)], ["다음 점검일", caseFirst(care.nextCheckAt, item.nextMaintenanceAt)], ["담당자", caseFirst(care.owner, item.assignee)], ["고객 만족도", caseFirst(care.satisfaction, item.satisfaction)], ["후속 조치", caseFirst(care.nextAction, item.nextAction)]]);
      content += caseTextPanel("사후관리 내용", caseFirst(care.note, item.aftercareNote));
    }
    content += renderCaseStepActions(item, stepKey, { vendors, quotes, recommended, supplier, recommendedAmount });
    return content || `<div class="case-extra-empty">이 단계에 연결된 상세 자료가 아직 없습니다. 아래 단계 메모에 처리 내용을 기록하세요.</div>`;
  }

  function renderOneOffPayments() {
    const rows = Core.oneOffContractRows(store.contracts, paymentMonth, paymentBuildingFilter);
    const totals = Core.oneOffContractTotals(rows.map(row => row.contract));
    const buildings = paymentBuildings();
    const days = paymentCalendarDays(paymentMonth);
    main.innerHTML = `<section class="operations-hero payment-operations-hero"><div><span>단건 작업의 매출과 비용을 함께 봅니다</span><h2>단건 계약 입금 캘린더</h2><p>예초·청소·도배·폐기물 처리의 입금 예정일과 실제 수익을 관리하세요.</p></div><div class="operations-actions"><button class="primary-button" data-action="new-one-off-contract">＋ 단건 계약</button></div></section>
      <nav class="payment-mode-tabs" aria-label="입금 관리 구분"><button type="button" data-payment-mode="recurring">정기 납부</button><button type="button" class="active" data-payment-mode="oneOff">단건 계약</button></nav>
      <div class="operations-kpis"><div class="operations-kpi"><span>단건 계약</span><b>${totals.count}건</b><small>${esc(paymentMonthLabel(paymentMonth))}</small></div><div class="operations-kpi"><span>받을 금액</span><b>${esc(krw(totals.revenue))}</b><small>고객 청구액</small></div><div class="operations-kpi"><span>업체 지급액</span><b>${esc(krw(totals.cost))}</b><small>작업 원가</small></div><div class="operations-kpi" style="--wash:#edf9f5"><span>예상 수익</span><b>${esc(krw(totals.profit))}</b><small>받을 금액 - 지급액</small></div></div>
      <div class="payment-toolbar"><div class="payment-month-switch"><button data-payment-month="-1" aria-label="이전 달">‹</button><b>${esc(paymentMonthLabel(paymentMonth))}</b><button data-payment-month="1" aria-label="다음 달">›</button></div><label class="payment-building-filter"><span>건물</span><select data-payment-building-filter><option value="all">전체 건물</option>${buildings.map(item => `<option value="${attr(item.id)}" ${paymentBuildingFilter === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select></label></div>
      <section class="payment-calendar"><div class="payment-weekdays">${["일", "월", "화", "수", "목", "금", "토"].map(day => `<div>${day}</div>`).join("")}</div><div class="payment-days">${days.map(date => { const dayRows = rows.filter(row => row.dueDate === date); return `<div class="payment-day ${date.slice(0, 7) === paymentMonth ? "" : "out"}"><div class="payment-daynum">${Number(date.slice(-2))}</div>${dayRows.map(row => `<button class="payment-event ${attr(row.status)}" data-contract-edit="${attr(row.contract.id)}"><b>${esc(row.contract.name)}</b><span>${esc(krw(row.contract.amount))} · 수익 ${esc(krw(row.contract.grossProfit))}</span></button>`).join("")}</div>`; }).join("")}</div></section>
      ${rows.length ? `<div class="data-table-wrap one-off-table"><table class="data-table"><thead><tr><th>작업일</th><th>고객·건물</th><th>작업</th><th>받을 금액</th><th>업체 지급</th><th>예상 수익</th><th>입금·지급 상태</th></tr></thead><tbody>${rows.map(row => { const contract = row.contract; const customer = customerById(contract.customerId); const building = buildingById(contract.buildingId); return `<tr data-contract-edit="${attr(contract.id)}"><td>${esc(contract.workDate)}</td><td>${esc(customer?.name || "고객 미연결")}<br><small>${esc(building?.name || "건물 미연결")}</small></td><td><strong>${esc(contract.name)}</strong></td><td>${esc(krw(contract.amount))}</td><td>${esc(krw(contract.vendorCost))}</td><td><strong>${esc(krw(contract.grossProfit))}</strong></td><td>${esc(contract.collectionStatus)} · ${esc(contract.vendorPaymentStatus)}</td></tr>`; }).join("")}</tbody></table></div>` : empty("이번 달 단건 계약이 없습니다", "단건 계약을 등록하면 입금 예정일에 자동으로 표시됩니다.", `<button class="primary-button" data-action="new-one-off-contract">＋ 단건 계약 등록</button>`)}`;
  }

  function renderPayments() {
    if (paymentMode === "oneOff") return renderOneOffPayments();
    const buildings = paymentBuildings();
    if (paymentBuildingFilter !== "all" && !buildings.some(item => item.id === paymentBuildingFilter)) paymentBuildingFilter = "all";
    const selectedBuilding = buildings.find(item => item.id === paymentBuildingFilter) || null;
    const rows = paymentRows();
    const paid = rows.filter(item => item.status === "paid");
    const overdue = rows.filter(item => item.status === "overdue" || item.status === "manual_unpaid");
    const review = rows.filter(item => item.status === "review");
    const expectedAmount = rows.reduce((sum, item) => sum + Core.money(item.schedule.amount), 0);
    const paidAmount = paid.reduce((sum, item) => sum + Core.money(item.schedule.amount), 0);
    const days = paymentCalendarDays(paymentMonth);
    const sheetSync = operations.payments && operations.payments.sheetSync || {};
    const bankSync = operations.payments && operations.payments.bankSync || {};
    if (operationsLoading && !operations.loadedAt) {
      main.innerHTML = `<div class="operations-loading">공용 입금 캘린더를 불러오고 있습니다…</div>`;
      return;
    }
    main.innerHTML = `<section class="operations-hero payment-operations-hero"><div><span>BRING CRM에서 직접 처리합니다</span><h2>예정일·입금내역·미입금 안내를 한곳에서 관리하세요</h2><p>세입자 자료 동기화부터 입금 확인, 카카오 알림톡까지 이 화면에서 처리합니다.</p></div><div class="operations-actions payment-operation-actions"><button class="secondary-button" data-payment-sheet-open>세입자 관리대장</button><button class="secondary-button payment-bank-connect-button" data-payment-bank-selected>팝빌 계좌 연결</button><button class="secondary-button" data-action="new-payment-schedule">＋ 납부 일정</button><button class="secondary-button" data-payment-action="syncPaymentBuildings">↻ 건물 갱신</button><button class="secondary-button" data-payment-action="syncPaymentSchedules">↻ 세입자 반영</button><button class="primary-button" data-payment-action="syncPopbillBankTransactions">은행 입금 조회</button></div></section>
      ${operationsError ? `<div class="info-box" style="margin-top:12px;color:#c6535f">${esc(operationsError)}</div>` : ""}
      <div class="payment-sync-strip"><span><i class="${sheetSync.ok === false ? "bad" : sheetSync.updatedAt ? "good" : ""}"></i>세입자 자료 ${sheetSync.updatedAt ? `최근 ${esc(shortDate(sheetSync.updatedAt))} · ${Number(sheetSync.count) || 0}명` : "동기화 대기"}</span><span><i class="${bankSync.status === "error" ? "bad" : bankSync.updatedAt ? "good" : ""}"></i>은행 입금 ${bankSync.updatedAt ? `최근 ${esc(shortDate(bankSync.updatedAt))} · ${Number(bankSync.transactionCount) || 0}건` : "조회 대기"}</span><button type="button" data-action="refresh-operations">화면 새로고침</button></div>
      <div class="operations-kpis"><div class="operations-kpi"><span>이번 달 예정</span><b>${rows.length}건</b><small>${esc(krw(expectedAmount))}</small></div><div class="operations-kpi" style="--wash:#edf9f5"><span>입금 완료</span><b>${paid.length}건</b><small>${esc(krw(paidAmount))}</small></div><div class="operations-kpi" style="--wash:#fff2f3"><span>미입금</span><b>${overdue.length}건</b><small>납부일 경과·수동 확인</small></div><div class="operations-kpi" style="--wash:#fff9eb"><span>확인 필요</span><b>${review.length}건</b><small>중복·수동 검토</small></div></div>
      <div class="payment-toolbar"><div class="payment-month-switch"><button data-payment-month="-1" aria-label="이전 달">‹</button><b>${esc(paymentMonthLabel(paymentMonth))}</b><button data-payment-month="1" aria-label="다음 달">›</button></div><div class="payment-selected-building"><span>현재 보는 건물</span><b>${esc(selectedBuilding ? selectedBuilding.name : "전체 건물")}</b></div><label class="payment-building-filter payment-mobile-filter"><span>건물</span><select data-payment-building-filter><option value="all">전체 건물</option>${buildings.map(item => `<option value="${attr(item.id)}" ${paymentBuildingFilter === item.id ? "selected" : ""}>${esc([item.name, item.address].filter(Boolean).join(" · "))}</option>`).join("")}</select></label></div>
      <section class="payment-calendar-layout"><aside class="payment-building-panel"><header><div><b>건물별 캘린더</b><span>건물을 누르면 일정이 바뀌어요.</span></div><em>${buildings.length}곳</em></header><div class="payment-building-list"><button type="button" class="payment-building-card ${paymentBuildingFilter === "all" ? "selected" : ""}" data-payment-building-id="all"><div><b>전체 건물</b><span>모든 납부 일정을 함께 봅니다.</span></div><em>${paymentRows("all").length}건</em></button>${buildings.map(building => `<button type="button" class="payment-building-card ${paymentBuildingFilter === building.id ? "selected" : ""}" data-payment-building-id="${attr(building.id)}"><div><b>${esc(building.name)}</b><span>${esc(building.address || `${building.unitCount || building.scheduleCount || 0}개 호실·일정`)}</span><small class="${building.accountConnected ? "connected" : ""}">${building.accountConnected ? `계좌 연결 · ${building.scheduleCount}건` : `계좌 미연결 · ${building.scheduleCount}건`}</small></div><em>${building.unitCount || building.scheduleCount || 0}</em></button>`).join("")}</div></aside><div class="payment-calendar-main">
      ${rows.length ? `<section class="payment-calendar"><div class="payment-weekdays">${["일", "월", "화", "수", "목", "금", "토"].map(day => `<div>${day}</div>`).join("")}</div><div class="payment-days">${days.map(date => {
        const dayRows = rows.filter(item => item.dueDate === date);
        return `<div class="payment-day ${date.slice(0, 7) === paymentMonth ? "" : "out"} ${date === todayKey() ? "today" : ""}"><div class="payment-daynum">${Number(date.slice(-2))}</div>${dayRows.slice(0, 2).map(row => `<button class="payment-event ${attr(row.status)}" data-payment-event="${attr(row.schedule.id)}"><b>${esc([row.schedule.buildingName, row.schedule.unit].filter(Boolean).join(" · ") || row.schedule.tenantName || "납부 일정")}</b><span>${esc(krw(row.schedule.amount))} · ${esc(paymentStatusLabel(row.status))}</span></button>`).join("")}${dayRows.length > 2 ? `<span class="payment-more">＋ ${dayRows.length - 2}건</span>` : ""}</div>`;
      }).join("")}</div></section>` : `<div class="payment-calendar"><div class="payment-empty-note">${esc(paymentMonthLabel(paymentMonth))}에 ${selectedBuilding ? `${esc(selectedBuilding.name)} 건물의` : "등록된"} 납부 일정이 없습니다.<br>${selectedBuilding ? "다른 건물을 선택하거나 납부 일정을 추가해 주세요." : "위의 세입자 반영을 눌러 관리대장 자료를 가져오세요."}</div></div>`}</div></section>`;
  }

  function paymentStatusEditor(scheduleId) {
    const row = paymentRows().find(item => item.schedule.id === scheduleId);
    if (!row) return;
    const schedule = row.schedule;
    const current = row.override && row.override.status || "auto";
    const record = operations.payments && operations.payments.rentSms && operations.payments.rentSms[paymentMonth] && operations.payments.rentSms[paymentMonth][schedule.id] || null;
    const eligible = row.dueDate === todayKey() || row.status === "overdue" || row.status === "manual_unpaid";
    const transaction = row.matchedTransaction;
    modalContent.innerHTML = `<div class="modal-head"><div><h2>입금 일정 상세</h2><p>${esc([schedule.buildingName, schedule.unit].filter(Boolean).join(" · "))}</p></div><button class="close-button" data-action="close-modal">×</button></div><form id="paymentStatusForm" class="modal-body" data-schedule-id="${attr(schedule.id)}" data-month="${attr(paymentMonth)}"><div class="payment-detail-tools"><button type="button" class="secondary-button" data-payment-schedule-edit="${attr(schedule.id)}">일정 정보 수정</button><button type="button" class="secondary-button" data-payment-bank-edit="${attr(schedule.buildingId || "")}">입금계좌 연결</button></div><div class="payment-status-summary"><div><span>세입자</span><b>${esc(schedule.tenantName || "미입력")}</b></div><div><span>연락처</span><b>${esc(schedule.tenantPhone || "미입력")}</b></div><div><span>예상 입금자명</span><b>${esc(schedule.payerName || "미입력")}</b></div><div><span>납부 예정일</span><b>${esc(row.dueDate)}</b></div><div><span>예정 금액</span><b>${esc(krw(schedule.amount))}</b></div><div><span>현재 상태</span><b>${esc(paymentStatusLabel(row.status))}</b></div></div>${transaction ? `<section class="payment-match-box"><b>자동 일치 입금내역</b><span>${esc(transaction.date || "")} · ${esc(transaction.payerName || "입금자 미입력")} · ${esc(krw(transaction.amount))}</span></section>` : ""}<section class="payment-reminder-box"><div><b>미입금 안내</b><span>${record ? `${esc(record.status || "발송 기록 있음")} · ${esc(dateText(record.sentAt))}` : eligible ? "납부 당일 또는 미입금 일정에 알림톡을 보낼 수 있습니다." : "납부 당일부터 발송할 수 있습니다."}</span></div><div><button type="button" class="primary-button" data-payment-action="sendPaymentReminderSms" data-schedule-id="${attr(schedule.id)}" ${!eligible || !schedule.tenantPhone ? "disabled" : ""}>${record && record.ok ? "알림톡 다시 발송" : "카카오 알림톡 발송"}</button>${record && record.provider === "kakao_alimtalk" && record.messageId ? `<button type="button" class="secondary-button" data-payment-action="getPaymentReminderDeliveryStatus" data-schedule-id="${attr(schedule.id)}">전달 결과 확인</button>` : ""}</div></section><div class="form-grid">${selectField("입금 상태", "status", ["auto", "paid", "manual_unpaid", "review"], current, value => ({ auto: `자동판정 사용 · 현재 ${paymentStatusLabel(row.status)}`, paid: "입금완료", manual_unpaid: "미입금", review: "확인필요" })[value])}${areaField("변경 사유", "reason", row.override && row.override.reason || "", "wide")}</div><div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">취소</button><button class="primary-button">상태 저장</button></div></form>`;
    openModal();
  }

  function paymentScheduleEditor(scheduleId) {
    const schedule = scheduleId && operations.payments && operations.payments.schedules && operations.payments.schedules[scheduleId] || {};
    const buildings = paymentBuildings();
    const linkedBuilding = storeBuildingForPaymentSchedule(schedule);
    const selectedBuildingId = linkedBuilding && linkedBuilding.id || schedule.buildingId || "";
    modalContent.innerHTML = `<div class="modal-head"><div><h2>${scheduleId ? "납부 일정 수정" : "새 납부 일정"}</h2><p>입력한 일정은 모든 CRM 사용자의 입금 캘린더에 바로 반영됩니다.</p></div><button class="close-button" data-action="close-modal">×</button></div><form id="paymentScheduleForm" class="modal-body" data-schedule-id="${attr(scheduleId || "")}" data-original-building-id="${attr(schedule.buildingId || "")}"><div class="info-box">세입자 이름·연락처·예상 입금자명·금액을 정확히 입력하면 은행 입금내역 자동 일치 정확도가 높아집니다.</div><div class="form-grid" style="margin-top:14px">${selectField("등록된 건물", "buildingId", ["", ...buildings.map(item => item.id)], selectedBuildingId, id => id ? ([buildings.find(item => item.id === id)?.name, buildings.find(item => item.id === id)?.address].filter(Boolean).join(" · ") || id) : "직접 입력")}${field("건물명 *", "buildingName", schedule.buildingName || "", "text", "예: 우산오피스텔")}${field("호실", "unit", schedule.unit || "", "text", "예: 302호")}${field("세입자명 *", "tenantName", schedule.tenantName || "", "text", "예: 홍길동")}${field("세입자 연락처", "tenantPhone", schedule.tenantPhone || "", "text", "010-0000-0000")}${field("예상 입금자명", "payerName", schedule.payerName || "", "text", "통장에 표시될 이름")}${field("월 납부금액 *", "amount", schedule.amount || "", "text", "원 단위")}${field("매월 납부일 *", "dueDay", schedule.dueDay || 1, "number", "1~31")}${field("시작 월 *", "startMonth", schedule.startMonth || paymentMonth, "month")}${field("종료 월", "endMonth", schedule.endMonth || "", "month")}${selectField("사용 상태", "active", ["true", "false"], schedule.active === false ? "false" : "true", value => value === "true" ? "사용 중" : "종료")}</div><div class="form-actions">${scheduleId && schedule.source === "crm" ? `<button type="button" class="danger-outline-button form-delete-left" data-payment-schedule-delete="${attr(scheduleId)}">일정 삭제</button>` : ""}<button type="button" class="secondary-button" data-action="close-modal">취소</button><button class="primary-button">${scheduleId ? "일정 수정 저장" : "납부 일정 등록"}</button></div></form>`;
    openModal();
  }

  function paymentBankBindingEditor(buildingId) {
    const buildings = paymentBuildings();
    const building = buildings.find(item => item.id === buildingId) || buildings.find(item => {
      const crmBuilding = buildingById(item.crmBuildingId || item.id);
      return !!crmBuilding && (crmBuilding.externalRefs && crmBuilding.externalRefs.paymentBuildingIds || []).includes(String(buildingId));
    });
    const accounts = operations.payments && operations.payments.bankSync && Array.isArray(operations.payments.bankSync.accounts) ? operations.payments.bankSync.accounts : [];
    const bindingEntry = paymentBindingEntryForBuilding(building && building.crmBuildingId || buildingId);
    const binding = bindingEntry.binding || {};
    const bindingId = bindingEntry.key || buildingId;
    modalContent.innerHTML = `<div class="modal-head"><div><h2>입금계좌 연결</h2><p>${esc(building && building.name || "건물")}</p></div><button class="close-button" data-action="close-modal">×</button></div><form id="paymentBankBindingForm" class="modal-body" data-building-id="${attr(bindingId)}" data-building-name="${attr(building && building.name || "")}"><div class="info-box">계좌번호 전체는 CRM에 저장하지 않습니다. 팝빌에 등록된 안전한 계좌 식별정보와 끝 4자리만 연결합니다.</div><div class="payment-bank-options">${accounts.length ? accounts.map(account => `<label><input type="radio" name="accountRef" value="${attr(account.accountRef)}" data-bank-code="${attr(account.bankCode || "")}" data-account-name="${attr(account.accountName || "")}" data-account-last4="${attr(account.accountLast4 || "")}" ${binding.accountRef === account.accountRef ? "checked" : ""}><span><b>${esc(account.accountName || "등록계좌")}</b><small>${esc(account.bankCode || "은행")} · 끝 ${esc(account.accountLast4 || "----")}</small></span></label>`).join("") : `<div class="case-extra-empty">연결할 팝빌 계좌가 없습니다. 먼저 입금 캘린더에서 “은행 입금 조회”를 눌러 주세요.</div>`}</div><div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">취소</button>${binding.accountRef ? `<button type="button" class="danger-button" data-payment-bank-unlink="${attr(bindingId)}">연결 해제</button>` : ""}<button class="primary-button" ${!accounts.length ? "disabled" : ""}>계좌 연결 저장</button></div></form>`;
    openModal();
  }

  function recommendedQuoteForWorkflow(item) {
    const quotes = caseQuoteRows(item);
    const recommendation = item.recommendation || {};
    return quotes.find(quote => String(caseFirst(quote.id, quote.storedId)) === String(recommendation.quoteId || "")) || quotes
      .filter(quote => Core.money(caseFirst(quote.bringQuoteTotalAmount, quote.confirmedTotalAmount, quote.totalAmount, quote.total, quote.amount)) > 0)
      .sort((left, right) => Core.money(caseFirst(left.bringQuoteTotalAmount, left.confirmedTotalAmount, left.totalAmount, left.total, left.amount)) - Core.money(caseFirst(right.bringQuoteTotalAmount, right.confirmedTotalAmount, right.totalAmount, right.total, right.amount)))[0] || null;
  }

  async function executeCaseWorkflowAction(button) {
    const item = workflowCaseByKey(button.dataset.caseKey);
    const action = button.dataset.workflowAction;
    if (!item || !action) return;
    const caseId = item.ticketNo || item.id || button.dataset.caseKey;
    const vendors = caseVendorRows(item);
    const quote = recommendedQuoteForWorkflow(item);
    const quoteId = quote && caseFirst(quote.storedId, quote.id) || "";
    const supplier = quote && (quote.supplier || quote.bringQuoteSupplier) || {};
    const amount = quote && caseFirst(quote.bringQuoteTotalAmount, quote.confirmedTotalAmount, quote.totalAmount, quote.amount);
    const confirmations = {
      sendComplaintReceiptSms: { title: "접수확인 문자를 발송할까요?", description: "수신번호와 발송 내용을 확인해 주세요.", target: item.phone || "연락처 미입력", message: caseReceiptPreview(item), confirmLabel: "문자 발송" },
      sendVendorEstimateMms: { title: "업체에 견적 요청을 발송할까요?", description: `선택한 ${vendors.length}개 업체에 같은 내용을 MMS로 보냅니다.`, target: vendors.map(vendor => `${vendor.name || "업체"} · ${vendor.phone || "번호 미입력"}`).join("\n"), confirmLabel: "MMS 발송" },
      sendOwnerRecommendationMms: { title: "추천 견적을 발송할까요?", description: "건물주에게 보낼 내용을 확인해 주세요.", message: caseOwnerRecommendationMessage(item, quote, supplier, amount), confirmLabel: "추천 견적 발송" },
      confirmOwnerRecommendationMms: { title: "문자 수신 결과를 확인할까요?", description: "건물주에게 보낸 추천 문자의 전달 결과를 조회합니다.", confirmLabel: "수신 결과 확인" },
      confirmCasePayment: { title: "입금 확인을 완료할까요?", description: "실제 사업자계좌의 입금내역을 확인했을 때만 진행하세요.", warning: "확인하면 업체 연결·일정 단계로 넘어갑니다.", confirmLabel: "입금 확인 완료", tone: "success" }
    };
    if (confirmations[action] && !await requestConfirmation(confirmations[action])) return;
    const payload = { action, caseId };
    if (action === "sendComplaintReceiptSms") {
      payload.force = (item.status || {}).c2 === "done";
      payload.contact = { name: item.name || "", phone: item.phone || "", building: item.building || "", address: item.address || "", room: item.room || "", issueType: item.issueType || "", visitTime: item.visitTime || item.visitDate || "", summary: item.summary || "" };
    } else if (action === "sendVendorEstimateMms") {
      payload.vendors = vendors;
      payload.message = caseVendorRequestPreview(item).replace("■ 회신 요청 내용", `회신 이메일: ${operations.caseSettings.vendorQuoteReplyEmail || "bringengineering1008@gmail.com"}\n\n■ 회신 요청 내용`);
    } else if (["getOwnerRecommendationPreview", "ensureOwnerDecisionLink", "sendOwnerRecommendationMms"].includes(action)) {
      payload.quoteId = quoteId;
      payload.message = caseOwnerRecommendationMessage(item, quote, supplier, amount);
      const preview = item.ownerRecommendationMms && item.ownerRecommendationMms.preview || {};
      if (action === "sendOwnerRecommendationMms") {
        payload.imageFileId = preview.imageFileId || "";
        payload.imageDesignVersion = preview.imageDesignVersion || "";
      }
    }
    workflowActionKey = `${workflowCaseKey(item)}:${action}`;
    renderCases();
    try {
      const result = await api.runWorkflowAction(payload);
      if (!result.ok) throw new Error(result.error || "업무 실행에 실패했습니다.");
      await refreshOperations({ silent: true, render: false });
      renderCases();
      showToast({ sendComplaintReceiptSms: "접수확인 문자 발송을 처리했습니다.", sendVendorEstimateMms: "선택 업체에 견적 요청을 처리했습니다.", getOwnerRecommendationPreview: "추천 이미지 준비를 요청했습니다.", ensureOwnerDecisionLink: "건물주 승인 링크를 준비했습니다.", sendOwnerRecommendationMms: "건물주 추천 MMS를 발송했습니다.", confirmOwnerRecommendationMms: "건물주 문자 수신 결과를 확인했습니다.", confirmCasePayment: "입금 확인을 완료했습니다." }[action] || "업무를 처리했습니다.", "success");
    } catch (error) {
      showToast(error.message || "업무를 처리하지 못했습니다.", "error");
    } finally {
      workflowActionKey = "";
      renderCases();
    }
  }

  async function uploadCaseFiles(button) {
    const item = workflowCaseByKey(button.dataset.caseKey);
    if (!item) return;
    const kind = button.dataset.caseUpload;
    const picked = await api.pickWorkflowFiles({ kind });
    if (!picked.ok) {
      if (!picked.canceled) showToast(picked.error || "파일을 선택하지 못했습니다.", "error");
      return;
    }
    const originalText = button.textContent;
    button.disabled = true;
    const vendors = caseVendorRows(item);
    const vendor = vendors[0] || {};
    try {
      for (let index = 0; index < picked.files.length; index += 1) {
        button.textContent = `업로드 중 ${index + 1}/${picked.files.length}`;
        const payload = { caseId: item.ticketNo || item.id || button.dataset.caseKey, file: picked.files[index] };
        if (kind === "quote") Object.assign(payload, { action: "uploadQuoteFile", vendorId: vendor.id || "", vendorName: vendor.name || "업체 확인 필요", vendor, vendors, amount: "", memo: "" });
        else if (kind === "business-registration") Object.assign(payload, { action: "uploadBusinessRegistration", vendors });
        else Object.assign(payload, { action: "uploadWorkPhoto", phase: button.dataset.photoPhase === "before" ? "before" : "after" });
        const result = await api.runWorkflowAction(payload);
        if (!result.ok) throw new Error(result.error || `${picked.files[index].fileName} 업로드에 실패했습니다.`);
      }
      await refreshOperations({ silent: true, render: false });
      renderCases();
      showToast(`${picked.files.length}개 파일을 공용 케이스에 업로드했습니다.`, "success");
    } catch (error) {
      showToast(error.message || "파일을 업로드하지 못했습니다.", "error");
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  async function confirmWorkflowQuoteAmount(button) {
    const item = workflowCaseByKey(button.dataset.caseKey);
    const quoteId = button.dataset.caseQuoteConfirm;
    const input = [...document.querySelectorAll("[data-quote-amount-input]")].find(element => element.dataset.quoteAmountInput === quoteId);
    const amount = Core.money(input && input.value);
    if (!item || !quoteId || amount < 1000) return showToast("합계금액을 1,000원 이상으로 입력해 주세요.", "error");
    if (!await requestConfirmation({ title: "견적 금액을 확정할까요?", description: "확정한 금액으로 BRING 양식 견적서를 생성합니다.", target: `${amount.toLocaleString("ko-KR")}원`, warning: "확정하기 전에 입력한 합계금액을 다시 확인해 주세요.", confirmLabel: "금액 확정" })) return;
    button.disabled = true;
    button.textContent = "확정 중…";
    const result = await api.runWorkflowAction({ action: "confirmQuoteAmount", caseId: item.ticketNo || item.id || button.dataset.caseKey, quoteId, totalAmount: amount });
    if (!result.ok) { button.disabled = false; button.textContent = "금액 확정"; return showToast(result.error || "견적 금액을 확정하지 못했습니다.", "error"); }
    await refreshOperations({ silent: true, render: false });
    renderCases();
    showToast("견적 금액을 확정하고 BRING 양식 생성을 요청했습니다.", "success");
  }

  async function executePaymentAction(button) {
    const action = button.dataset.paymentAction;
    const scheduleId = button.dataset.scheduleId || "";
    const row = scheduleId ? paymentRows().find(item => item.schedule.id === scheduleId) : null;
    const record = row && operations.payments && operations.payments.rentSms && operations.payments.rentSms[paymentMonth] && operations.payments.rentSms[paymentMonth][scheduleId];
    if (action === "sendPaymentReminderSms" && row) {
      if (!await requestConfirmation({ title: "카카오 알림톡을 발송할까요?", description: "세입자와 납부 정보를 확인해 주세요.", target: `${row.schedule.tenantName || "세입자"} · ${row.schedule.tenantPhone || "연락처 미입력"}`, message: `${row.schedule.buildingName || ""} ${row.schedule.unit || ""}\n${krw(row.schedule.amount)}`, confirmLabel: "알림톡 발송" })) return;
    }
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = "처리 중…";
    const payload = { action };
    if (row) Object.assign(payload, { scheduleId, month: paymentMonth, status: row.status, force: action === "sendPaymentReminderSms" && Boolean(record && record.ok) });
    if (action === "syncPopbillBankTransactions") payload.force = true;
    const result = await api.runWorkflowAction(payload);
    if (!result.ok) {
      button.disabled = false; button.textContent = originalText;
      return showToast(result.error || "입금 업무를 처리하지 못했습니다.", "error");
    }
    await refreshOperations({ silent: true, render: false });
    if (scheduleId && modal.classList.contains("open")) paymentStatusEditor(scheduleId);
    else renderPayments();
    showToast(action === "sendPaymentReminderSms" ? "카카오 알림톡 발송을 요청했습니다." : action === "getPaymentReminderDeliveryStatus" ? "알림톡 전달 결과를 확인했습니다." : "입금 자료를 최신 상태로 반영했습니다.", "success");
  }

  function filteredCustomers() {
    const query = Core.normalizeText(searchEl.value);
    const phoneQuery = customerPhoneSearchKey(searchEl.value);
    return store.customers.filter(customer => {
      const progress = customerSalesProgress(customer);
      if (customerSalesStageFilter !== "all" && !progress.filterIds.includes(customerSalesStageFilter)) return false;
      if (!query) return true;
      const buildings = customerBuildings(customer).map(item => `${item.name} ${item.address}`).join(" ");
      const sales = [progress.label, ...progress.rows.map(row => `${row.stage && row.stage.label || ""} ${row.prospect && row.prospect.name || ""}`)].join(" ");
      return Core.normalizeText([customer.name, customer.company, customer.phone, customer.email, customer.address, customer.currentIssue, buildings, sales, (customer.tags || []).join(" ")].join(" ")).includes(query)
        || (phoneQuery && customerPhoneCandidateKey(customer.phone).includes(phoneQuery));
    }).sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  }

  function renderCustomers() {
    const customers = filteredCustomers();
    const filters = [
      { id: "all", label: "전체" },
      { id: "no-building", label: "건물 미연결" },
      { id: "unregistered", label: "영업 미등록" },
      { id: "needs-review", label: "연결 확인 필요" },
      { id: "mixed", label: "건물별 단계 다름" },
      ...(Sales.SALES_STAGES || []).map(stage => ({ id: stage.id, label: stage.label }))
    ];
    main.innerHTML = `
      <div class="toolbar customer-sales-toolbar">
        <div class="customer-sales-filter-wrap"><label class="customer-sales-filter"><span>건물 영업 단계</span><select data-customer-sales-stage-filter>${filters.map(filter => `<option value="${attr(filter.id)}" ${customerSalesStageFilter === filter.id ? "selected" : ""}>${esc(filter.label)}</option>`).join("")}</select></label><p>고객이 연결된 건물과 영업 관리 건물이 일치하면 단계가 자동으로 표시됩니다.</p></div>
        <button class="secondary-button" data-action="new-customer">＋ 고객 등록</button>
      </div>
      ${customers.length ? `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>고객</th><th>연락처</th><th>연결 건물</th><th>건물 영업 단계</th><th>다음 할 일</th><th>연락 예정</th><th>중요도</th></tr></thead><tbody>${customers.map(customerRow).join("")}</tbody></table></div>` : empty("조건에 맞는 고객이 없습니다", "새 고객을 등록하거나 영업 단계 조건을 바꿔보세요.", `<button class="primary-button" data-action="new-customer">＋ 첫 고객 등록</button>`)}`;
  }

  function customerRow(customer) {
    const buildings = customerBuildings(customer);
    const building = buildings[0];
    const buildingLabel = building ? `${building.name || "건물명 미입력"}${buildings.length > 1 ? ` 외 ${buildings.length - 1}곳` : ""}` : "미연결";
    const progress = customerSalesProgress(customer);
    return `<tr data-customer-open="${attr(customer.id)}"><td><div class="customer-cell"><i class="avatar">${esc(initials(customer.name))}</i><div><strong>${esc(customer.name || "이름 미입력")}</strong><span>${esc(customer.company || customer.type || customer.customerNo || "")}</span></div></div></td><td>${esc(customerPhoneText(customer.phone) || "-")}</td><td>${esc(buildingLabel)}</td><td>${customerSalesStageBadge(progress)}</td><td>${esc(customer.nextAction || "-")}</td><td>${esc(dateText(customer.nextContactAt))}</td><td>${priorityClass(customer.priority)}</td></tr>`;
  }

  const buildingCustomers = building => store.customers.filter(customer => customer.id === building.ownerCustomerId || Core.customerBuildingIds(customer).includes(building.id));
  const buildingContracts = building => store.contracts.filter(contract => String(contract.buildingId || "") === String(building.id));
  const buildingNames = building => [building && building.name, ...(building && building.aliases || [])].map(Core.normalizeText).filter(Boolean);
  const buildingAddressKeys = building => [...new Set([
    building && building.address,
    building && building.roadAddress,
    building && building.jibunAddress,
  ].map(Core.normalizeText).filter(Boolean))];
  const buildingChoiceLabel = building => [building && building.name || "건물명 미입력", building && (building.address || building.buildingNo)].filter(Boolean).join(" · ");
  const uniqueBuildingNameMatch = (name, address) => {
    const normalized = Core.normalizeText(name);
    if (!normalized) return null;
    const matches = store.buildings.filter(building => buildingNames(building).includes(normalized));
    const normalizedAddress = Core.normalizeText(address);
    if (normalizedAddress) {
      const addressMatches = matches.filter(building => buildingAddressKeys(building).includes(normalizedAddress));
      if (addressMatches.length === 1) return addressMatches[0];
      return null;
    }
    return matches.length === 1 ? matches[0] : null;
  };
  const storeBuildingForPaymentSchedule = schedule => buildingById(schedule && schedule.buildingId)
    || (store.buildings || []).find(building => (building.externalRefs && building.externalRefs.paymentBuildingIds || []).includes(String(schedule && schedule.buildingId || "")))
    || uniqueBuildingNameMatch(schedule && schedule.buildingName, schedule && schedule.buildingAddress);
  const caseBelongsToBuilding = (item, building) => {
    const linkedId = String(item && (item.crmBuildingId || item.buildingId) || "");
    if (linkedId) return linkedId === String(building.id);
    return uniqueBuildingNameMatch(item && item.building, item && (item.buildingAddress || item.address))?.id === building.id;
  };
  const scheduleBelongsToBuilding = (schedule, building) => {
    if (String(schedule && schedule.buildingId || "") === String(building.id)) return true;
    if ((building.externalRefs && building.externalRefs.paymentBuildingIds || []).includes(String(schedule && schedule.buildingId || ""))) return true;
    return uniqueBuildingNameMatch(schedule && schedule.buildingName, schedule && schedule.buildingAddress)?.id === building.id;
  };
  const paymentBindingEntryForBuilding = buildingOrId => {
    const building = typeof buildingOrId === "string" ? buildingById(buildingOrId) : buildingOrId;
    const id = String(building && building.id || buildingOrId || "");
    const bindings = operations.payments && operations.payments.bankBindings || {};
    const candidateIds = [id, ...(building && building.externalRefs && building.externalRefs.paymentBuildingIds || []).map(String)];
    const key = candidateIds.find(candidateId => bindings[candidateId]);
    return key ? { key, binding: bindings[key] } : { key: id, binding: {} };
  };
  const paymentFilterIdForBuilding = building => String(building && building.id || "all");
  const buildingCases = building => activeCases().filter(item => caseBelongsToBuilding(item, building));
  const buildingUnitsForBuilding = building => (store.buildingUnits || []).filter(item => item && String(item.crmBuildingId || item.buildingId || "") === String(building.id));
  const buildingPaymentRows = building => Core.paymentMonthRows(operations.payments || {}, paymentMonth, todayKey(), "all").filter(row => scheduleBelongsToBuilding(row.schedule, building));
  const buildingStatusBadge = status => `<span class="contract-status ${status === "관리중" ? "active" : status === "보류" ? "closed" : "preparing"}">${esc(status || "상태 미입력")}</span>`;
  const buildingArray = value => Array.isArray(value) ? value.map(item => String(item || "").trim()).filter(Boolean) : [];
  const buildingListSummary = (value, otherValue) => {
    const values = buildingArray(value);
    const other = String(otherValue || "").trim();
    const labels = values.filter(item => item !== "기타");
    if (values.includes("기타") || other) labels.push(other ? `기타: ${other}` : "기타");
    return labels.join(" · ") || "미입력";
  };
  const buildingMoneySummary = value => Core.money(value) > 0 ? krw(value) : "미입력";

  const activeBuildingUnitsForBuilding = building => buildingUnitsForBuilding(building).filter(item => !item.archivedAt);
  const vacancyUnitStatus = unit => VACANCY_STATUS_ORDER.includes(String(unit && unit.status || "")) && unit.status !== "all" ? unit.status : "unknown";
  const normalizeVacancyUnitLabel = value => String(value || "").normalize("NFKC").trim().toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
  const legacyVacancyLabels = building => new Set(buildingArray(building && building.vacantUnits).map(normalizeVacancyUnitLabel));

  function vacancyLegacyMigrationState(building) {
    const formalUnits = activeBuildingUnitsForBuilding(building);
    const formalActiveLabels = new Set(formalUnits.map(unit => normalizeVacancyUnitLabel(unit.label || unit.unitLabel)).filter(Boolean));
    const formalVacantLabels = new Set(formalUnits
      .filter(unit => vacancyUnitStatus(unit) === "vacant")
      .map(unit => normalizeVacancyUnitLabel(unit.label || unit.unitLabel))
      .filter(Boolean));
    const namedByLabel = new Map();
    buildingArray(building && building.vacantUnits).forEach(label => {
      const normalized = normalizeVacancyUnitLabel(label);
      if (normalized && !namedByLabel.has(normalized)) namedByLabel.set(normalized, label);
    });
    const namedLabels = [...namedByLabel.values()];
    const unmatchedNamedLabels = [...namedByLabel.entries()].filter(([normalized]) => !formalVacantLabels.has(normalized)).map(([, label]) => label);
    const missingNamedLabels = [...namedByLabel.entries()].filter(([normalized]) => !formalActiveLabels.has(normalized)).map(([, label]) => label);
    const statusConflictNamedLabels = [...namedByLabel.entries()]
      .filter(([normalized]) => formalActiveLabels.has(normalized) && !formalVacantLabels.has(normalized))
      .map(([, label]) => label);
    const legacyVacantCount = Math.max(Core.nonNegativeInteger(building && building.vacantUnitCount), namedByLabel.size);
    const unnamedCount = Math.max(0, legacyVacantCount - namedByLabel.size);
    const formalVacantCount = formalUnits.filter(unit => vacancyUnitStatus(unit) === "vacant").length;
    return {
      formalUnits,
      namedLabels,
      unmatchedNamedLabels,
      missingNamedLabels,
      statusConflictNamedLabels,
      unnamedCount,
      formalVacantCount,
      requiredVacantCount: legacyVacantCount,
      unresolvedCount: Math.max(unmatchedNamedLabels.length, legacyVacantCount - formalVacantCount, 0),
    };
  }

  function inferredVacancyFloorLabel(unit) {
    const stored = String(unit && unit.floorLabel || "").trim();
    if (stored) return stored;
    const label = String(unit && (unit.label || unit.unitLabel) || "").normalize("NFKC").trim();
    const basement = label.match(/^(?:b|지하\s*)(\d+)/i);
    if (basement) return `B${Number(basement[1])}`;
    const number = label.match(/(\d+)/);
    if (number) {
      const roomNumber = Number(number[1]);
      if (roomNumber >= 100) return `${Math.floor(roomNumber / 100)}층`;
    }
    return "층 미확인";
  }

  function vacancyFloorOrder(unit, floorLabel) {
    const stored = Number(unit && unit.floorOrder);
    if (Number.isFinite(stored) && stored !== 0) return Math.max(-1000, Math.min(1000, Math.trunc(stored)));
    const label = String(floorLabel || inferredVacancyFloorLabel(unit)).trim();
    const basement = label.match(/^(?:b|지하\s*)(\d+)/i);
    if (basement) return Math.max(-1000, -Number(basement[1]));
    const number = label.match(/-?\d+/);
    if (number) return Math.max(-1000, Math.min(1000, Number(number[0])));
    if (/옥탑|roof/i.test(label)) return 999;
    return 1000;
  }

  function vacancyUnitOrder(unit) {
    const stored = Number(unit && unit.unitOrder);
    if (Number.isFinite(stored) && stored > 0) return Math.trunc(stored);
    const number = String(unit && (unit.label || unit.unitLabel) || "").match(/(\d+)(?!.*\d)/);
    return number ? Number(number[1]) : 999999;
  }

  function sortedVacancyUnits(units) {
    return [...units].sort((left, right) => {
      const leftFloor = inferredVacancyFloorLabel(left);
      const rightFloor = inferredVacancyFloorLabel(right);
      return vacancyFloorOrder(left, leftFloor) - vacancyFloorOrder(right, rightFloor)
        || leftFloor.localeCompare(rightFloor, "ko", { numeric: true })
        || vacancyUnitOrder(left) - vacancyUnitOrder(right)
        || String(left.label || left.unitLabel || "").localeCompare(String(right.label || right.unitLabel || ""), "ko", { numeric: true });
    });
  }

  function vacancySummaryForBuilding(building) {
    const units = activeBuildingUnitsForBuilding(building);
    const counts = { total: units.length, occupied: 0, vacant: 0, move_out_scheduled: 0, maintenance: 0, unknown: 0, formal: units.length > 0 };
    if (units.length) units.forEach(unit => { counts[vacancyUnitStatus(unit)] += 1; });
    else {
      const legacyCount = Math.max(Core.nonNegativeInteger(building && building.vacantUnitCount), buildingArray(building && building.vacantUnits).length);
      counts.total = Math.max(Core.nonNegativeInteger(building && building.unitCount), legacyCount);
      counts.vacant = legacyCount;
      counts.unknown = Math.max(0, counts.total - legacyCount);
    }
    counts.actionable = counts.vacant + counts.move_out_scheduled;
    return counts;
  }

  function vacancyNavigationCount() {
    return (store.buildings || []).filter(building => building && !building.archivedAt)
      .reduce((total, building) => total + vacancySummaryForBuilding(building).actionable, 0);
  }

  const vacancyStatusBadge = status => `<span class="vacancy-status ${attr(status)}">${esc(VACANCY_STATUS_LABELS[status] || VACANCY_STATUS_LABELS.unknown)}</span>`;

  function renderBuildings() {
    const query = Core.normalizeText(searchEl.value);
    const phoneQuery = customerPhoneSearchKey(searchEl.value);
    const buildings = [...store.buildings]
      .filter(building => !building.archivedAt)
      .filter(building => {
        const customers = buildingCustomers(building);
        return !query || Core.normalizeText([building.name, building.address, building.roadAddress, building.jibunAddress, building.type, building.status, building.buildingNo, building.manager, customers.map(item => `${item.name} ${item.phone}`).join(" ")].join(" ")).includes(query)
          || (phoneQuery && customers.some(customer => customerPhoneCandidateKey(customer.phone).includes(phoneQuery)));
      })
      .sort((left, right) => (left.status === "관리중" ? -1 : 0) - (right.status === "관리중" ? -1 : 0) || String(left.name || "").localeCompare(String(right.name || ""), "ko"));
    if (buildings.length && !buildings.some(item => item.id === selectedBuildingId)) selectedBuildingId = buildings[0].id;
    const building = buildings.find(item => item.id === selectedBuildingId) || null;
    main.innerHTML = `${DriveImportUI.renderReviewPanel(driveImportCandidates, currentAuth.user || {})}<section class="building-hub-hero"><div><span>건물 기준으로 연결된 업무를 확인합니다</span><h2>고객·계약·케이스·입금을 한곳에서 봅니다</h2><p>이름이 같아도 섞이지 않도록 건물 고유 ID를 기준으로 연결합니다.</p></div><button class="primary-button" data-action="new-building">＋ 건물 등록</button></section>
      <section class="building-hub-layout"><aside class="building-hub-browser"><header><b>건물 목록</b><span>${buildings.length}곳</span></header><div class="building-hub-list">${buildings.length ? buildings.map(item => {
        const customers = buildingCustomers(item);
        const cases = buildingCases(item);
        return `<button type="button" class="building-hub-card ${item.id === selectedBuildingId ? "selected" : ""}" data-building-open="${attr(item.id)}"><div><strong>${esc(item.name || "건물명 미입력")}</strong><em>${esc(item.status || "미입력")}</em></div><p>${esc(item.address || "주소 미입력")}</p><small>${esc(customers[0]?.name || "고객 미연결")} · 진행 케이스 ${cases.length}건</small></button>`;
      }).join("") : `<div class="building-hub-empty">${query ? "검색 조건에 맞는 건물이 없습니다." : "등록된 건물이 없습니다."}<br>건물을 먼저 등록해 업무를 연결하세요.</div>`}</div></aside><section class="building-hub-detail">${building ? renderBuildingDetail(building) : `<div class="case-detail-empty"><strong>${query ? "건물을 찾지 못했습니다" : "첫 건물을 등록해 주세요"}</strong><span>건물을 등록하면 고객·계약·케이스·입금 현황이 이곳에 모입니다.</span><button class="primary-button" data-action="new-building">＋ 건물 등록</button></div>`}</section></section>${renderArchivedBuildings()}`;
  }

  function renderArchivedBuildings() {
    const archived = (store.buildings || []).filter(item => item && item.archivedAt);
    if (!archived.length) return "";
    return `<details class="sales-crm sales-archived-panel"><summary><span>보관된 건물</span><b>${archived.length}곳</b></summary><div class="sales-archived-list">${archived.map(item => `<article><div><strong>${esc(item.name || "건물명 미입력")}</strong><p>${esc(item.address || "주소 미입력")} · ${esc(dateText(item.archivedAt))}</p></div>${canWriteCRM() ? `<button type="button" class="mini-button return" data-building-restore="${attr(item.id)}">복원</button>` : ""}</article>`).join("")}</div></details>`;
  }

  function driveImportCandidateById(id) {
    return driveImportCandidates.find(item => item.id === String(id || "")) || null;
  }

  function driveImportApprovalEditor(id) {
    const item = driveImportCandidateById(id);
    if (!item || !canAdministerSecurity()) return showToast("관리자만 Drive 자료를 승인할 수 있습니다.", "error");
    const value = item.suggested;
    modalContent.innerHTML = `<div class="modal-head"><div><h2>Drive 건물 검토</h2><p>${esc(item.fileName)}</p></div><button class="close-button" data-action="close-modal">×</button></div><form id="driveImportApprovalForm" class="modal-body" data-drive-file-id="${attr(item.id)}"><div class="info-box">Drive 원본과 대조한 값만 승인해 주세요. 전화번호·임대조건·출입정보는 자동 등록하지 않습니다.</div><div class="form-grid" style="margin-top:14px">${field("건물명 *", "name", value.name, "text")}${field("주소 *", "address", value.address, "text")}${field("담당자", "manager", value.manager, "text")}${field("건물 유형", "type", value.type, "text")}${field("상태", "status", value.status, "text")}${field("호실 수", "unitCount", value.unitCount, "number")}${field("확인 메모", "memo", value.memo, "text")}</div><div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">취소</button><button type="submit" class="primary-button">승인하여 건물 등록</button></div></form>`;
    openModal();
  }

  function driveImportRejectionEditor(id) {
    const item = driveImportCandidateById(id);
    if (!item || !canAdministerSecurity()) return showToast("관리자만 Drive 자료를 반려할 수 있습니다.", "error");
    modalContent.innerHTML = `<div class="modal-head"><div><h2>Drive 자료 반려</h2><p>${esc(item.fileName)}</p></div><button class="close-button" data-action="close-modal">×</button></div><form id="driveImportRejectionForm" class="modal-body" data-drive-file-id="${attr(item.id)}"><label class="field full"><span>반려 사유 *</span><textarea name="reason" rows="4" maxlength="500" required placeholder="예: 주소 원본 재확인 필요"></textarea></label><div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">취소</button><button type="submit" class="danger-button">반려 기록</button></div></form>`;
    openModal();
  }

  function renderBuildingDetail(building) {
    const customers = buildingCustomers(building);
    const owner = customerById(building.ownerCustomerId) || customers[0] || null;
    const contracts = buildingContracts(building).sort((a, b) => String(a.endDate || "9999").localeCompare(String(b.endDate || "9999")));
    const cases = buildingCases(building).sort((a, b) => String(b.updatedAt || b.receivedAt || "").localeCompare(String(a.updatedAt || a.receivedAt || "")));
    const rows = buildingPaymentRows(building);
    const activeContracts = contracts.filter(item => item.status !== "종료");
    const openCases = cases.filter(item => Core.workflowProgress(item).done < Core.WORKFLOW_STEPS.length);
    const overdueRows = rows.filter(item => item.status === "overdue" || item.status === "manual_unpaid" || item.status === "review");
    const amount = rows.reduce((sum, row) => sum + Core.money(row.schedule.amount), 0);
    const contractRecords = contracts.slice(0, 5).map(contract => `<div class="building-detail-record clickable" data-contract-edit="${attr(contract.id)}"><div><b>${esc(contract.name || `${contractTypes(contract).join("·")} 계약`)}</b><span>${esc(`${contract.status || "상태 미입력"} · ${contractDateText(contract.startDate)} ~ ${contractEndDateText(contract.endDate)}`)}</span></div><em>${esc(Core.money(contract.amount) ? krw(contract.amount) : contract.billingCycle || "금액 미입력")}</em></div>`).join("");
    const caseRecords = cases.slice(0, 6).map(item => {
      const progress = Core.workflowProgress(item);
      return `<div class="building-detail-record clickable" data-building-case-open="${attr(workflowCaseKey(item))}"><div><b>${esc(item.ticketNo || item.receiptNo || item.id || "케이스")}</b><span>${esc([item.room, item.issueType, progress.current].filter(Boolean).join(" · ") || "업무 내용 미입력")}</span></div><em class="${String(item.urgency || "").includes("긴급") ? "warning" : ""}">${progress.percent}%</em></div>`;
    }).join("");
    const paymentRecords = rows.slice(0, 6).map(row => `<div class="building-detail-record clickable" data-building-payment-open="${attr(row.schedule.id)}" data-building-payment-id="${attr(building.id)}"><div><b>${esc([row.schedule.unit, row.schedule.tenantName].filter(Boolean).join(" · ") || "납부 일정")}</b><span>${esc(`${row.dueDate} · ${paymentStatusLabel(row.status)}`)}</span></div><em class="${row.status === "overdue" || row.status === "manual_unpaid" || row.status === "review" ? "warning" : ""}">${esc(krw(row.schedule.amount))}</em></div>`).join("");
    const allUnits = buildingUnitsForBuilding(building);
    const units = allUnits.filter(item => !item.archivedAt);
    const archivedUnits = allUnits.filter(item => item.archivedAt);
    const unitRecords = units.map(item => `<button type="button" class="building-detail-record clickable building-unit-record" data-building-unit-edit="${attr(item.id)}" data-building-id="${attr(building.id)}"><div><b>${esc(item.label || item.unitLabel || "호실명 미입력")}</b><span>${esc([inferredVacancyFloorLabel(item), VACANCY_STATUS_LABELS[vacancyUnitStatus(item)], item.memo].filter(Boolean).join(" · "))}</span></div><em>수정</em></button>`).join("");
    const archivedUnitRecords = archivedUnits.length ? `<details class="building-units-archived"><summary>보관된 호실 ${archivedUnits.length}개</summary>${archivedUnits.map(item => `<div class="building-detail-record"><div><b>${esc(item.label || item.unitLabel || "호실")}</b><span>${esc(dateText(item.archivedAt))}</span></div>${canWriteCRM() ? `<button type="button" class="mini-button return" data-building-unit-restore="${attr(item.id)}" data-building-id="${attr(building.id)}">복원</button>` : ""}</div>`).join("")}</details>` : "";
    const customerRecords = customers.map(customer => `<div class="building-detail-record clickable" data-customer-open="${attr(customer.id)}"><div><b>${esc(customer.name || "이름 미입력")}${customer.id === building.ownerCustomerId ? " · 건물주" : ""}</b><span>${esc([customer.type, customerPhoneText(customer.phone), customer.company].filter(Boolean).join(" · ") || "연락처 미입력")}</span></div><em>고객 보기</em></div>`).join("");
    const vacancySummary = vacancySummaryForBuilding(building);
    const vacantUnits = vacancySummary.formal ? units.filter(item => vacancyUnitStatus(item) === "vacant").map(item => item.label || item.unitLabel).filter(Boolean) : buildingArray(building.vacantUnits);
    const vacancyLabel = `${vacancySummary.vacant.toLocaleString("ko-KR")}개`;
    const vacancySubline = [vacantUnits.join(", "), vacancySummary.move_out_scheduled ? `공실 예정 ${vacancySummary.move_out_scheduled}개` : ""].filter(Boolean).join(" · ") || "호실 미입력";
    const rentalSummary = `<section class="building-detail-section building-rental-detail wide"><header><b>임대·공실 정보</b><button type="button" class="mini-button" data-building-vacancies="${attr(building.id)}">공실 현황 보기</button></header><div class="building-detail-body"><div class="building-rental-facts"><div><span>보증금</span><b>${esc(buildingMoneySummary(building.rentDeposit))}</b></div><div><span>월세</span><b>${esc(buildingMoneySummary(building.monthlyRent))}</b></div><div><span>관리비</span><b>${esc(buildingMoneySummary(building.maintenanceFee))}</b></div><div><span>공실</span><b>${esc(vacancyLabel)}</b><small>${esc(vacancySubline)}</small></div></div><div class="building-rental-lines"><div><b>관리비 포함</b><span>${esc(buildingListSummary(building.maintenanceIncludes, building.maintenanceIncludeOther))}</span></div><div><b>구조</b><span>${esc(buildingListSummary(building.roomTypes, building.roomTypeOther))}</span></div><div><b>호실 옵션</b><span>${esc(buildingListSummary(building.roomOptions, building.roomOptionOther))}</span></div></div></div></section>`;
    const primaryAddress = building.roadAddress || building.address || building.jibunAddress || "주소 미입력";
    const secondaryAddress = building.jibunAddress && Core.normalizeText(building.jibunAddress) !== Core.normalizeText(primaryAddress) ? ` · 지번 ${building.jibunAddress}` : "";
    return `<header class="building-hub-detail-head"><div class="building-hub-title"><span>${esc(building.buildingNo || building.id)}</span><h2>${esc(building.name || "건물명 미입력")}</h2><p>${esc(primaryAddress)}${esc(secondaryAddress)}</p></div><div class="building-hub-head-actions"><button class="secondary-button" data-building-edit="${attr(building.id)}">건물 정보 수정</button><button class="secondary-button" data-building-vacancies="${attr(building.id)}">공실 현황</button><button class="secondary-button" data-building-payments="${attr(building.id)}">입금 캘린더</button><button class="primary-button" data-building-new-case="${attr(building.id)}">＋ 새 케이스</button></div></header>
      <div class="building-hub-detail-scroll"><div class="building-hub-kpis"><div class="building-hub-kpi"><span>연결 고객</span><b>${customers.length}명</b><small>${esc(owner ? `대표 ${owner.name}` : "건물주 연결 필요")}</small></div><div class="building-hub-kpi"><span>진행 계약</span><b>${activeContracts.length}건</b><small>${esc(activeContracts.length ? contractTypes(activeContracts[0]).join("·") : "활성 계약 없음")}</small></div><div class="building-hub-kpi"><span>진행 케이스</span><b>${openCases.length}건</b><small>${esc(openCases[0] ? Core.workflowProgress(openCases[0]).current : "진행 업무 없음")}</small></div><div class="building-hub-kpi ${overdueRows.length ? "alert" : ""}"><span>이번 달 입금</span><b>${rows.length}건</b><small>${esc(overdueRows.length ? `확인 필요 ${overdueRows.length}건` : amount ? `예정 ${krw(amount)}` : "납부 일정 없음")}</small></div></div>
      <div class="building-identity-strip"><div><b>건물 유형</b><span>${esc(building.type || "미입력")}</span></div><div><b>운영 상태</b><span>${buildingStatusBadge(building.status)}</span></div><div><b>호실 수</b><span>${vacancySummary.formal ? `${vacancySummary.total.toLocaleString("ko-KR")}개` : Number(building.unitCount) ? `${Number(building.unitCount).toLocaleString("ko-KR")}개` : "미입력"}</span></div><div><b>담당자</b><span>${esc(building.manager || "미입력")}</span></div></div>
      <div class="building-detail-grid">${rentalSummary}<section class="building-detail-section"><header><b>연결 고객</b><span>${customers.length}명</span></header><div class="building-detail-body">${customerRecords || `<div class="building-detail-empty">연결된 고객이 없습니다. 건물 정보 수정에서 건물주를 선택하세요.</div>`}</div></section><section class="building-detail-section"><header><b>건물 호실</b><button type="button" class="mini-button" data-building-unit-add="${attr(building.id)}">＋ 호실</button></header><div class="building-detail-body">${unitRecords || `<div class="building-detail-empty">등록된 호실이 없습니다.</div>`}${archivedUnitRecords}</div></section><section class="building-detail-section"><header><b>계약</b><span>${contracts.length}건</span></header><div class="building-detail-body">${contractRecords || `<div class="building-detail-empty">연결된 계약이 없습니다.</div>`}</div></section><section class="building-detail-section"><header><b>케이스</b><span>${cases.length}건</span></header><div class="building-detail-body">${caseRecords || `<div class="building-detail-empty">연결된 케이스가 없습니다.</div>`}</div></section><section class="building-detail-section"><header><b>${esc(paymentMonthLabel(paymentMonth))} 입금 일정</b><span>${rows.length}건</span></header><div class="building-detail-body">${paymentRecords || `<div class="building-detail-empty">이번 달 납부 일정이 없습니다.</div>`}</div></section>${building.memo ? `<section class="building-detail-section wide"><header><b>건물 메모</b><span>공용 정보</span></header><div class="building-detail-body"><div class="building-detail-record"><div><b>관리 참고사항</b><span>${esc(building.memo)}</span></div></div></div></section>` : ""}</div></div>`;
    main.querySelector(".building-detail-grid")?.insertAdjacentHTML("afterbegin", ServiceOperationsUI.renderBuildingServices(building, store));
  }

  function vacancyUnitSearchText(unit) {
    return Core.normalizeText([
      unit && (unit.label || unit.unitLabel), inferredVacancyFloorLabel(unit),
      VACANCY_STATUS_LABELS[vacancyUnitStatus(unit)], unit && (unit.availableFrom || unit.moveOutAt), unit && unit.memo
    ].filter(Boolean).join(" "));
  }

  function renderVacancyUnitCard(unit, building) {
    const status = vacancyUnitStatus(unit);
    const label = unit.label || unit.unitLabel || "호실명 미입력";
    const availableFrom = String(unit.availableFrom || unit.moveOutAt || "").slice(0, 10);
    const pastDue = status === "move_out_scheduled" && /^\d{4}-\d{2}-\d{2}$/.test(availableFrom) && availableFrom < todayKey();
    const saving = vacancyUnitSaveLocks.has(String(unit.id || ""));
    const meta = status === "move_out_scheduled"
      ? availableFrom ? `${shortDate(availableFrom)} 공실 예정${pastDue ? " · 날짜 확인 필요" : ""}` : "공실 예정일 미입력"
      : String(unit.memo || "").trim() || (status === "unknown" ? "상태를 확인해 주세요" : "");
    const statusControl = canWriteCRM()
      ? `<select class="vacancy-quick-status ${attr(status)}" data-vacancy-status-select data-building-id="${attr(building.id)}" data-unit-id="${attr(unit.id)}" data-current-status="${attr(status)}" aria-label="${attr(`${label} 상태 변경`)}" ${saving ? "disabled aria-busy=\"true\"" : ""}>${["occupied", "vacant", "move_out_scheduled", "maintenance", "unknown"].map(value => `<option value="${attr(value)}" ${value === status ? "selected" : ""}>${esc(VACANCY_STATUS_LABELS[value])}</option>`).join("")}</select>`
      : vacancyStatusBadge(status);
    return `<article class="vacancy-unit-card ${attr(status)} ${pastDue ? "date-warning" : ""} ${saving ? "saving" : ""}" data-vacancy-unit="${attr(unit.id)}" ${saving ? "aria-busy=\"true\"" : ""}><header><strong>${esc(label)}</strong>${statusControl}</header>${meta ? `<p>${esc(meta)}</p>` : ""}${status === "move_out_scheduled" && unit.memo ? `<small>${esc(unit.memo)}</small>` : ""}<footer><span>${esc(inferredVacancyFloorLabel(unit))}${saving ? " · 저장 중" : ""}</span>${canWriteCRM() ? `<button type="button" class="mini-button" data-vacancy-unit-edit="${attr(unit.id)}" data-building-id="${attr(building.id)}" ${saving ? "disabled" : ""}>상세 수정</button>` : ""}</footer></article>`;
  }

  function renderVacancyDetail(building, query) {
    const units = sortedVacancyUnits(activeBuildingUnitsForBuilding(building));
    const summary = vacancySummaryForBuilding(building);
    const filteredUnits = units.filter(unit => {
      const status = vacancyUnitStatus(unit);
      const matchesStatus = vacancyStatusFilter === "all" || status === vacancyStatusFilter
        || (vacancyStatusFilter === "attention" && ["vacant", "move_out_scheduled"].includes(status));
      return matchesStatus && (!query || vacancyUnitSearchText(unit).includes(query));
    });
    const grouped = new Map();
    filteredUnits.forEach(unit => {
      const floorLabel = inferredVacancyFloorLabel(unit);
      const key = `${vacancyFloorOrder(unit, floorLabel)}::${floorLabel}`;
      if (!grouped.has(key)) grouped.set(key, { floorLabel, floorOrder: vacancyFloorOrder(unit, floorLabel), units: [] });
      grouped.get(key).units.push(unit);
    });
    const floors = [...grouped.values()].sort((left, right) => left.floorOrder - right.floorOrder || left.floorLabel.localeCompare(right.floorLabel, "ko", { numeric: true }));
    const statusTabs = VACANCY_FILTER_ORDER.map(filter => {
      const count = filter === "attention" ? summary.actionable : filter === "all" ? summary.total : summary[filter];
      return `<button type="button" class="${vacancyStatusFilter === filter ? "active" : ""}" data-vacancy-filter="${attr(filter)}" aria-pressed="${vacancyStatusFilter === filter}"><span>${esc(VACANCY_FILTER_LABELS[filter])}</span><b>${Number(count || 0).toLocaleString("ko-KR")}</b></button>`;
    }).join("");
    const formalMismatch = summary.formal && Number(building.unitCount) > 0 && Number(building.unitCount) !== summary.total;
    const legacyLabels = buildingArray(building.vacantUnits);
    const legacyMigration = vacancyLegacyMigrationState(building);
    const floorMarkup = floors.map(floor => {
      const floorCounts = ["occupied", "vacant", "move_out_scheduled", "maintenance", "unknown"].reduce((counts, status) => {
        counts[status] = floor.units.filter(unit => vacancyUnitStatus(unit) === status).length;
        return counts;
      }, {});
      const floorSummary = vacancyStatusFilter === "attention"
        ? [["vacant", "공실"], ["move_out_scheduled", "공실 예정"]].filter(([status]) => floorCounts[status]).map(([status, label]) => `${label} ${floorCounts[status]}`).join(" · ")
        : vacancyStatusFilter === "all"
          ? floorCounts.occupied === floor.units.length
            ? "모두 입주 중"
            : [["occupied", "입주 중"], ["vacant", "공실"], ["move_out_scheduled", "공실 예정"], ["maintenance", "정비 중"], ["unknown", "확인 필요"]].filter(([status]) => floorCounts[status]).map(([status, label]) => `${label} ${floorCounts[status]}`).join(" · ")
          : `${VACANCY_FILTER_LABELS[vacancyStatusFilter]} ${floor.units.length.toLocaleString("ko-KR")}`;
      return `<section class="vacancy-floor-card" data-vacancy-floor="${attr(floor.floorLabel)}"><header><div><h3>${esc(floor.floorLabel)}</h3><span>표시 ${floor.units.length.toLocaleString("ko-KR")}개</span></div><p>${esc(floorSummary)}</p></header><div class="vacancy-unit-grid">${floor.units.map(unit => renderVacancyUnitCard(unit, building)).join("")}</div></section>`;
    }).join("");
    const emptyMarkup = summary.formal
      ? `<div class="vacancy-detail-empty"><b>${query ? "검색 조건에 맞는 호실이 없습니다" : vacancyStatusFilter === "attention" ? "현재 공실과 공실 예정 호실이 없습니다" : "선택한 상태의 호실이 없습니다"}</b><span>${query ? "호실 검색어를 지우거나 다른 검색어를 입력해 주세요." : vacancyStatusFilter === "attention" ? "모든 호실을 확인하려면 전체 필터를 선택하세요." : "상단에서 전체 상태를 선택해 모든 호실을 확인하세요."}</span></div>`
      : `<div class="vacancy-detail-empty legacy"><b>층·호실 설정이 필요합니다</b><span>${legacyLabels.length ? `기존 공실 메모: ${esc(legacyLabels.join(", "))}` : "위의 층·호실 설정에서 층과 층별 호실 수를 입력하면 공실 현황을 시작할 수 있습니다."}</span></div>`;
    const kpis = [
      ["attention", "attention", "확인할 공실", summary.actionable, "공실 + 공실 예정"],
      ["vacant", "vacant", "현재 공실", summary.vacant, "즉시 확인할 호실"],
      ["move_out_scheduled", "upcoming", "공실 예정", summary.move_out_scheduled, "예정일 확인 필요"],
      ["all", "", "전체 호실", summary.total, summary.formal ? `등록된 층 ${new Set(units.map(inferredVacancyFloorLabel)).size}개` : "기존 건물 정보 기준"],
    ].map(([filter, className, label, count, description]) => `<button type="button" class="${className} ${vacancyStatusFilter === filter ? "active" : ""}" data-vacancy-filter="${attr(filter)}" aria-pressed="${vacancyStatusFilter === filter}"><span>${esc(label)}</span><b>${Number(count || 0).toLocaleString("ko-KR")}</b><small>${esc(description)}</small></button>`).join("");
    return `<header class="vacancy-detail-head"><div><span>${esc(building.buildingNo || building.id)}</span><h2>${esc(building.name || "건물명 미입력")}</h2><p>${esc(building.address || "주소 미입력")}</p></div>${canWriteCRM() ? `<button type="button" class="secondary-button" data-vacancy-configure="${attr(building.id)}">층·호실 설정</button>` : ""}</header><div class="vacancy-detail-scroll"><div class="vacancy-kpis" data-vacancy-kpis>${kpis}</div>${formalMismatch ? `<div class="vacancy-count-warning">건물 정보의 전체 호실 ${Number(building.unitCount).toLocaleString("ko-KR")}개와 등록된 정식 호실 ${summary.total.toLocaleString("ko-KR")}개가 다릅니다. 층·호실 설정을 확인해 주세요.</div>` : ""}${legacyMigration.unresolvedCount ? `<div class="vacancy-count-warning" data-vacancy-legacy-resolution>정식 공실로 옮기지 않은 기존 공실이 ${legacyMigration.unresolvedCount.toLocaleString("ko-KR")}실 있습니다.${legacyMigration.missingNamedLabels.length ? ` 아직 없는 호실: ${esc(legacyMigration.missingNamedLabels.join(", "))}.` : ""}${legacyMigration.statusConflictNamedLabels.length ? ` 상태 변경 필요: ${esc(legacyMigration.statusConflictNamedLabels.join(", "))}. 해당 호실 단건 수정에서 먼저 공실로 변경해 주세요.` : ""}${legacyMigration.unnamedCount ? ` 기존 기록 중 호실명 미지정 ${legacyMigration.unnamedCount.toLocaleString("ko-KR")}실.` : ""} 층·호실 설정에서 실제 호실로 지정해 주세요.</div>` : ""}<div class="vacancy-unit-tools"><label><span>호실 검색</span><input type="search" data-vacancy-unit-search value="${attr(vacancyUnitQuery)}" placeholder="호실명·층·메모 검색" autocomplete="off"></label>${vacancyUnitQuery ? `<button type="button" class="secondary-button" data-vacancy-search-clear>검색 지우기</button>` : ""}</div><nav class="vacancy-status-tabs" aria-label="호실 상태 필터">${statusTabs}</nav><p class="vacancy-result-summary" aria-live="polite">${query ? `검색 결과 ${filteredUnits.length.toLocaleString("ko-KR")}개 호실` : `${VACANCY_FILTER_LABELS[vacancyStatusFilter]} ${filteredUnits.length.toLocaleString("ko-KR")}개 호실`}</p><div class="vacancy-floor-list">${floorMarkup || emptyMarkup}</div></div>`;
  }

  function renderVacancies() {
    const buildingQuery = Core.normalizeText(searchEl.value);
    let unitQuery = Core.normalizeText(vacancyUnitQuery);
    const buildings = (store.buildings || []).filter(building => building && !building.archivedAt)
      .filter(building => {
        if (!buildingQuery) return true;
        const buildingText = Core.normalizeText([building.name, building.address, building.roadAddress, building.jibunAddress, building.buildingNo, building.manager].join(" "));
        return buildingText.includes(buildingQuery);
      })
      .sort((left, right) => (left.status === "관리중" ? -1 : 0) - (right.status === "관리중" ? -1 : 0)
        || String(left.name || "").localeCompare(String(right.name || ""), "ko"));
    if (buildings.length && !buildings.some(building => building.id === selectedVacancyBuildingId)) {
      selectedVacancyBuildingId = buildings[0].id;
      vacancyUnitQuery = "";
      unitQuery = "";
    }
    const building = buildings.find(item => item.id === selectedVacancyBuildingId) || null;
    const buildingCards = buildings.map(item => {
      const summary = vacancySummaryForBuilding(item);
      return `<button type="button" class="vacancy-building-card ${item.id === selectedVacancyBuildingId ? "selected" : ""}" data-vacancy-building="${attr(item.id)}" aria-pressed="${item.id === selectedVacancyBuildingId}"><div><strong>${esc(item.name || "건물명 미입력")}</strong><em>${summary.actionable.toLocaleString("ko-KR")}</em></div><p>${esc(item.address || "주소 미입력")}</p><small>전체 ${summary.total.toLocaleString("ko-KR")} · 공실 ${summary.vacant.toLocaleString("ko-KR")} · 예정 ${summary.move_out_scheduled.toLocaleString("ko-KR")}${summary.formal ? "" : " · 설정 필요"}</small></button>`;
    }).join("");
    main.innerHTML = `<section class="vacancy-hero" data-vacancy-view><div><span>건물별 공실 체크</span><h2>층마다 입주·공실·공실 예정 호실을 확인합니다</h2><p>왼쪽 건물 목록에서 건물을 고르고, 오른쪽에서 필요한 호실을 빠르게 확인하고 변경하세요.</p></div></section><section class="vacancy-layout"><aside class="vacancy-building-browser"><header><div><b>건물 목록</b><span>확인할 건물을 선택하세요.</span></div><em>${buildings.length.toLocaleString("ko-KR")}곳</em></header><div class="vacancy-building-list">${buildingCards || `<div class="vacancy-building-empty">${buildingQuery ? "검색 조건에 맞는 건물이 없습니다." : "등록된 건물이 없습니다."}</div>`}</div></aside><section class="vacancy-detail">${building ? renderVacancyDetail(building, unitQuery) : `<div class="vacancy-detail-empty"><b>${buildingQuery ? "건물을 찾지 못했습니다" : "건물을 먼저 등록해 주세요"}</b><span>건물 관리에 등록된 건물을 기준으로 층과 호실을 설정합니다.</span></div>`}</section></section>`;
  }

  function vacancyConfigurationDraft(building) {
    const groups = new Map();
    const legacyMigration = vacancyLegacyMigrationState(building);
    const formalUnits = legacyMigration.formalUnits;
    const sourceUnits = [
      ...formalUnits,
      ...legacyMigration.missingNamedLabels.map(label => ({ id: "", label, status: "vacant" }))
    ];
    sortedVacancyUnits(sourceUnits).forEach(unit => {
      const floorLabel = inferredVacancyFloorLabel(unit);
      const floorOrder = vacancyFloorOrder(unit, floorLabel);
      const key = `${floorOrder}::${floorLabel}`;
      if (!groups.has(key)) groups.set(key, { key: crypto.randomUUID(), floorLabel, floorOrder, units: [] });
      groups.get(key).units.push({
        entityId: formalUnits.length ? unit.id : "",
        expectedVersion: formalUnits.length ? Number(unit.entityVersion) || 0 : 0,
        label: unit.label || unit.unitLabel || "",
        status: vacancyUnitStatus(unit)
      });
    });
    const floors = [...groups.values()];
    return floors.length ? floors : [{ key: crypto.randomUUID(), floorLabel: "1층", floorOrder: 1, units: [] }];
  }

  function captureVacancyConfiguration(form) {
    return [...form.querySelectorAll("[data-vacancy-floor-row]")].map(row => ({
      key: row.dataset.floorKey,
      floorLabel: String(row.querySelector("[data-vacancy-floor-label]")?.value || "").trim(),
      floorOrder: Number(row.querySelector("[data-vacancy-floor-order]")?.value) || 0,
      units: [...row.querySelectorAll("[data-vacancy-unit-label]")].map(input => ({
        entityId: input.dataset.entityId || "",
        expectedVersion: Number(input.dataset.expectedVersion) || 0,
        label: String(input.value || "").trim(),
        status: (() => {
          const selected = input.closest("label")?.querySelector("[data-vacancy-unit-status]")?.value || input.dataset.status;
          return VACANCY_STATUS_ORDER.includes(selected) && selected !== "all" ? selected : "unknown";
        })()
      }))
    }));
  }

  function generatedVacancyUnitLabel(floorLabel, unitNumber) {
    const label = String(floorLabel || "").normalize("NFKC").trim();
    const basement = label.match(/^(?:b|지하\s*)(\d+)/i);
    if (basement) return `B${Number(basement[1])}${String(unitNumber).padStart(2, "0")}호`;
    const floorNumber = label.match(/-?\d+/);
    if (floorNumber && Number(floorNumber[0]) > 0) return `${Number(floorNumber[0])}${String(unitNumber).padStart(2, "0")}호`;
    return `${label || "호실"}-${unitNumber}호`;
  }

  function renderVacancyConfigurationPreview(form) {
    const preview = form.querySelector("[data-vacancy-configuration-preview]");
    if (!preview) return;
    const floors = captureVacancyConfiguration(form);
    const units = floors.flatMap(floor => floor.units.map((unit, index) => ({ ...unit, floorLabel: floor.floorLabel, unitOrder: index + 1 })));
    preview.innerHTML = `<header><div><b>구성 미리보기</b><span>${floors.filter(floor => floor.units.length).length}개 층 · ${units.length}개 호실</span></div><em>기존 ${units.filter(unit => unit.entityId).length} · 신규 ${units.filter(unit => !unit.entityId).length}</em></header><div>${units.length ? units.map(unit => `<span class="${attr(unit.status)}">${esc(unit.floorLabel)} · ${esc(unit.label || "호실명 필요")}</span>`).join("") : `<p>층별 호실 수를 입력하고 자동 라벨을 만들어 주세요.</p>`}</div>`;
  }

  function renderVacancyConfigurationFloors(form, floors) {
    form._vacancyFloorDrafts = floors;
    const list = form.querySelector("[data-vacancy-floor-list]");
    list.innerHTML = floors.map(floor => {
      const hasExisting = floor.units.some(unit => unit.entityId);
      return `<article class="vacancy-config-floor" data-vacancy-floor-row data-floor-key="${attr(floor.key)}"><header><label><span>층명</span><input data-vacancy-floor-label value="${attr(floor.floorLabel)}" placeholder="예: 2층, B1"></label><label class="vacancy-advanced-field"><span>고급 · 정렬 순서</span><input data-vacancy-floor-order type="number" min="-1000" max="1000" value="${attr(floor.floorOrder)}" step="1"></label><label><span>호실 수</span><input data-vacancy-floor-count type="number" min="0" max="200" value="${attr(floor.units.length)}" inputmode="numeric"></label><div><button type="button" class="secondary-button" data-vacancy-auto-label="${attr(floor.key)}">호실 자동 생성</button><button type="button" class="record-delete-button" data-vacancy-floor-remove="${attr(floor.key)}" ${hasExisting ? "disabled title=\"기존 호실이 있는 층은 제거할 수 없습니다\"" : ""}>층 제거</button></div></header><div class="vacancy-config-labels">${floor.units.length ? floor.units.map((unit, index) => `<label><span>${index + 1}</span><input data-vacancy-unit-label data-entity-id="${attr(unit.entityId || "")}" data-expected-version="${attr(unit.expectedVersion || 0)}" data-status="${attr(unit.status || "unknown")}" value="${attr(unit.label)}" ${unit.entityId ? "readonly title=\"기존 호실명은 호실 단건 수정에서 변경하세요\"" : ""}>${unit.entityId ? `<em>${esc(VACANCY_STATUS_LABELS[unit.status] || "기존")}</em>` : `<select data-vacancy-unit-status aria-label="${attr(`${unit.label || `${index + 1}번`} 상태`)}">${["unknown", "occupied", "vacant", "maintenance"].map(status => `<option value="${status}" ${status === unit.status ? "selected" : ""}>${esc(VACANCY_STATUS_LABELS[status])}</option>`).join("")}</select>`}</label>`).join("") : `<p>호실 수를 입력한 뒤 호실 자동 생성을 눌러 주세요.</p>`}</div></article>`;
    }).join("");
    renderVacancyConfigurationPreview(form);
  }

  function vacancyConfigurationEditor(buildingId) {
    if (deferCanonicalMutation("층·호실 구성")) return;
    const building = buildingById(buildingId);
    if (!building || building.archivedAt) return showToast("건물을 찾지 못했습니다.", "error");
    const initialFloors = vacancyConfigurationDraft(building);
    const legacyMigration = vacancyLegacyMigrationState(building);
    modalContent.innerHTML = `<div class="modal-head"><div><h2>층·호실 설정</h2><p>${esc(building.name || "건물")}의 실제 층과 호실을 등록합니다.</p></div><button class="close-button" data-action="close-modal">×</button></div><form id="vacancyConfigurationForm" class="modal-body vacancy-config-form" data-building-id="${attr(building.id)}"><div class="info-box">기존 호실과 상태는 그대로 보존합니다. 이 화면에서 빠진 기존 호실도 자동 보관되지 않습니다.</div>${legacyMigration.unresolvedCount ? `<div class="vacancy-legacy-warning" data-vacancy-legacy-resolution>정식 공실로 옮기지 않은 기존 공실이 ${legacyMigration.unresolvedCount.toLocaleString("ko-KR")}실 있습니다.${legacyMigration.missingNamedLabels.length ? ` 아직 없는 호실 ${esc(legacyMigration.missingNamedLabels.join(", "))}은 아래에 공실로 미리 넣었습니다.` : ""}${legacyMigration.statusConflictNamedLabels.length ? ` ${esc(legacyMigration.statusConflictNamedLabels.join(", "))}은 이미 정식 호실이지만 현재 공실이 아닙니다. 해당 호실 단건 수정에서 먼저 공실로 변경해 주세요.` : ""}${legacyMigration.unnamedCount ? ` 호실명 없는 ${legacyMigration.unnamedCount.toLocaleString("ko-KR")}실은 임의로 만들지 않습니다.` : ""} 실제 호실을 추가해 총 ${legacyMigration.requiredVacantCount.toLocaleString("ko-KR")}실을 ‘공실’로 지정해야 저장할 수 있습니다.</div>` : ""}<section class="vacancy-floor-builder"><header><div><b>층 설정</b><span>지상 층 수를 한 번에 만들거나 층을 직접 추가하세요.</span></div><label><span>지상 층 수</span><input data-vacancy-floor-total type="number" min="1" max="200" value="${Math.max(1, initialFloors.filter(floor => floor.floorOrder > 0 && floor.floorOrder < 999).length)}"></label><button type="button" class="secondary-button" data-vacancy-floor-range>1층부터 만들기</button><button type="button" class="secondary-button" data-vacancy-floor-add>＋ 층 추가</button></header><div data-vacancy-floor-list></div></section><section class="vacancy-config-preview" data-vacancy-configuration-preview></section><div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">취소</button><button type="submit" class="primary-button">층·호실 설정 저장</button></div></form>`;
    openModal();
    const form = document.getElementById("vacancyConfigurationForm");
    renderVacancyConfigurationFloors(form, initialFloors);
    setTimeout(() => form.querySelector("[data-vacancy-floor-label]")?.focus(), 30);
  }

  function isVacancyConfigurationConflict(value) {
    const text = [value && value.code, value && value.errorCode, value && value.error, value && value.message]
      .filter(Boolean).join(" ").toLocaleLowerCase("ko-KR");
    return text.includes("crm_entity_version_conflict") || text.includes("crm_building_unit_label_conflict")
      || text.includes("version conflict") || text.includes("버전 충돌") || text.includes("최신 버전")
      || text.includes("최신 내용을 다시 불러온 뒤 저장") || text.includes("같은 건물에 동일한 호실명이 이미 있습니다");
  }

  async function recoverVacancyConfigurationConflict(buildingId) {
    await refreshRendererOverlays(false).catch(() => undefined);
    selectedBuildingId = buildingId;
    selectedVacancyBuildingId = buildingId;
    vacancyStatusFilter = "attention";
    closeModal();
    currentView = "vacancies";
    render();
    showToast("다른 컴퓨터의 호실 변경을 반영했습니다. 층·호실 구성을 다시 열어 확인해 주세요.", "error");
  }

  function renderWorkManagement() {
    const model = WorkManagement.buildModel(store, { month: Core.dayKey().slice(0, 7), today: Core.dayKey() });
    main.innerHTML = WorkManagement.renderDashboard(model, { canWrite: canWriteCRM(), filters: workFilters });
    Object.entries(workFilters).forEach(([key, value]) => {
      const field = main.querySelector(`[data-work-filter="${key}"]`);
      if (field) field.value = value;
    });
  }

  function renderBuildingCalendar() {
    const model = WorkCalendar.buildModel(store, {
      month: workCalendarMonth,
      selectedDate: workCalendarDate,
      buildingId: workCalendarBuildingId,
      query: workCalendarQuery,
      today: todayKey(),
    });
    workCalendarMonth = model.month;
    workCalendarDate = model.selectedDate;
    workCalendarBuildingId = model.buildingId;
    main.innerHTML = WorkCalendar.render(model, { canWrite: canWriteCRM() });
  }

  function buildingScheduleEditor(recordId, defaultDate) {
    if (!canWriteCRM()) return showToast("조회 전용 계정은 일정을 등록하거나 변경할 수 없습니다.", "error");
    const existing = String(recordId || "") ? store.serviceRecords.find(record => record.id === recordId) : null;
    if (recordId && !existing) return showToast("일정 정보를 찾지 못했습니다. 최신 화면을 확인해 주세요.", "error");
    const activeBuildings = store.buildings.filter(building => building && !building.archivedAt);
    if (!existing && !activeBuildings.length) {
      showToast("일정을 등록하려면 건물 관리에서 건물을 먼저 등록해 주세요.", "error");
      return;
    }
    const linkedBuilding = existing && buildingById(existing.buildingId);
    const buildingOptions = [...activeBuildings];
    if (existing && existing.buildingId && !buildingOptions.some(building => building.id === existing.buildingId)) {
      buildingOptions.push(linkedBuilding || { id: existing.buildingId, name: "연결 기록이 남아 있는 건물", archivedAt: "missing" });
    }
    const defaultBuildingId = existing && existing.buildingId
      || (workCalendarBuildingId !== "all" && activeBuildings.some(building => building.id === workCalendarBuildingId) ? workCalendarBuildingId : "");
    const item = existing || {
      id: `service_${crypto.randomUUID()}`, buildingId: defaultBuildingId, title: "", serviceType: "inspection", status: "planned",
      scheduledDate: defaultDate || workCalendarDate || todayKey(), startTime: "", endTime: "", owner: store.settings && store.settings.owner || "김현진", summary: "",
    };
    const statusOptions = ["planned", "in_progress", "completed"];
    const typeOptions = ["inspection", "repair", "cleaning", "stair_cleaning", "grounds_cutting", "meeting", "other"];
    modalContent.innerHTML = `<div class="modal-head"><div><h2>${existing ? "업무 일정 수정" : "업무 일정 추가"}</h2><p>건물을 먼저 선택하고 해당 건물에서 진행할 일정을 등록합니다.</p></div><button class="close-button" data-action="close-modal" aria-label="일정 창 닫기">×</button></div><form id="buildingScheduleForm" class="modal-body" data-schedule-id="${attr(item.id)}" data-schedule-create="${existing ? "false" : "true"}" data-request-id="${attr(crypto.randomUUID())}" data-opened-updated-at="${attr(existing && existing.updatedAt || "")}" data-opened-commit-version="${Number(existing && existing.calendarCommitVersion) || 0}" data-auth-generation="${authGeneration}" data-auth-uid="${attr(currentAuthUid())}"><div class="info-box">등록한 일정은 업무일정 캘린더와 작업관리 화면에 함께 표시됩니다.</div><div class="form-grid work-calendar-form-grid">${selectField("건물 *", "buildingId", ["", ...buildingOptions.map(building => building.id)], item.buildingId || "", id => {
      if (!id) return "건물을 선택해 주세요";
      const building = buildingOptions.find(candidate => candidate.id === id) || buildingById(id);
      return `${building && building.name || id}${building && building.archivedAt ? " · 보관된 건물" : building && building.address ? ` · ${building.address}` : ""}`;
    })}${field("일정명 *", "title", item.title || "", "text", "예: 소방시설 정기 점검")}${field("날짜 *", "scheduledDate", item.scheduledDate || defaultDate || todayKey(), "date")}${field("시작 시간", "startTime", item.startTime || "", "time")}${field("종료 시간", "endTime", item.endTime || "", "time")}${selectField("진행 상태", "status", statusOptions, statusOptions.includes(item.status) ? item.status : "planned", value => WorkManagement.statusLabel(value))}${selectField("업무 종류", "serviceType", typeOptions, typeOptions.includes(item.serviceType) ? item.serviceType : "other", value => WorkManagement.typeLabel(value))}${field("담당자", "owner", item.owner || store.settings && store.settings.owner || "김현진")}${areaField("메모", "summary", item.summary || "", "wide")}</div><div class="form-actions">${existing && !["completed", "cancelled"].includes(existing.status) ? `<button type="button" class="danger-outline-button form-delete-left" data-work-calendar-cancel="${attr(existing.id)}">일정 취소</button>` : ""}<button type="button" class="secondary-button" data-action="close-modal">닫기</button><button class="primary-button" type="submit">${existing ? "일정 수정 저장" : "일정 등록"}</button></div></form>`;
    openModal();
    const form = document.getElementById("buildingScheduleForm");
    if (form && form.elements.buildingId) form.elements.buildingId.required = true;
    if (form && form.elements.title) { form.elements.title.required = true; form.elements.title.maxLength = 160; }
    if (form && form.elements.scheduledDate) form.elements.scheduledDate.required = true;
    if (form && form.elements.owner) form.elements.owner.maxLength = 120;
    if (form && form.elements.summary) form.elements.summary.maxLength = 2000;
    setTimeout(() => form && (form.elements.buildingId || form.elements.title)?.focus(), 30);
  }

  function workRecordEditor(recordId) {
    if (!canWriteCRM()) return showToast("조회 전용 계정은 작업을 기록할 수 없습니다.", "error");
    const existing = store.serviceRecords.find(record => record.id === recordId) || null;
    if (recordId && !existing) return showToast("작업 정보를 찾지 못했습니다. 최신 화면을 확인해 주세요.", "error");
    const activeBuildings = store.buildings.filter(building => building && !building.archivedAt);
    if (!existing && !activeBuildings.length) return showToast("작업을 등록하려면 건물 관리에서 건물을 먼저 등록해 주세요.", "error");
    const linkedBuilding = existing && buildingById(existing.buildingId);
    const buildingOptions = [...activeBuildings];
    if (existing && existing.buildingId && !buildingOptions.some(building => building.id === existing.buildingId)) {
      buildingOptions.push(linkedBuilding || { id: existing.buildingId, name: "연결 기록이 남아 있는 건물", archivedAt: "missing" });
    }
    const item = existing || { id: `service_${crypto.randomUUID()}`, buildingId: selectedBuildingId || activeBuildings[0]?.id || "", title: "", serviceType: "grounds_cutting", status: "planned", scheduledDate: "", startTime: "", endTime: "", completedAt: "", amount: 0, vendorName: "", owner: store.settings && store.settings.owner || "김현진", summary: "", evidenceUrl: "" };
    const cancelled = item.status === "cancelled";
    modalContent.innerHTML = `<div class="modal-head"><div><h2>${existing ? "작업 상세·수정" : "새 작업 등록"}</h2><p>건물별 작업 일정·비용·완료 증빙을 공용 CRM에 기록합니다.</p></div><button class="close-button" data-action="close-modal">×</button></div><form id="workRecordForm" class="modal-body" data-work-id="${attr(item.id)}" data-work-create="${existing ? "false" : "true"}" data-request-id="${attr(crypto.randomUUID())}" data-opened-updated-at="${attr(existing && existing.updatedAt || "")}" data-opened-commit-version="${Number(existing && existing.calendarCommitVersion) || 0}" data-auth-generation="${authGeneration}" data-auth-uid="${attr(currentAuthUid())}">${cancelled ? `<div class="info-box">취소된 작업은 기록 보호를 위해 내용을 변경할 수 없습니다.</div>` : ""}<div class="form-grid">${selectField("건물 *", "buildingId", buildingOptions.map(building => building.id), item.buildingId, id => (buildingOptions.find(building => building.id === id) || {}).name || id)}${field("작업명", "title", item.title || WorkManagement.typeLabel(item.serviceType))}${selectField("작업 종류", "serviceType", ["grounds_cutting", "stair_cleaning", "cleaning", "repair", "inspection", "meeting", "other"], item.serviceType, value => WorkManagement.typeLabel(value))}${selectField("상태", "status", cancelled ? ["cancelled"] : ["planned", "in_progress", "completed"], item.status, value => WorkManagement.statusLabel(value))}${field("예정일", "scheduledDate", item.scheduledDate || "", "date")}${field("시작 시간", "startTime", item.startTime || "", "time")}${field("종료 시간", "endTime", item.endTime || "", "time")}${field("완료일", "completedAt", item.completedAt || "", "date")}${field("비용", "amount", item.amount || "", "number", "원 단위")}${field("담당 업체", "vendorName", item.vendorName || "")}${field("담당자", "owner", item.owner || store.settings && store.settings.owner || "김현진")}${field("Drive 증빙 URL", "evidenceUrl", item.evidenceUrl || "", "url", "https://drive.google.com/...")}${areaField("작업 내용·다음 행동", "summary", item.summary || "", "wide")}</div><div class="form-actions">${existing && !["completed", "cancelled"].includes(existing.status) ? `<button type="button" class="danger-outline-button form-delete-left" data-work-record-cancel="${attr(existing.id)}">작업 취소</button>` : ""}<button type="button" class="secondary-button" data-action="close-modal">닫기</button>${cancelled ? "" : `<button class="primary-button">공용 CRM에 저장</button>`}</div></form>`;
    openModal();
    const form = document.getElementById("workRecordForm");
    if (form && form.elements.buildingId) form.elements.buildingId.required = true;
    if (form && form.elements.title) form.elements.title.maxLength = 160;
    if (form && form.elements.owner) form.elements.owner.maxLength = 120;
    if (form && form.elements.vendorName) form.elements.vendorName.maxLength = 160;
    if (form && form.elements.summary) form.elements.summary.maxLength = 2000;
    if (cancelled && form) [...form.elements].forEach(control => { if (control.name) control.disabled = true; });
  }

  function renderConsultations() {
    const activities = [...store.activities].sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
    main.innerHTML = `<div class="section-head"><div><h2>고객과 나눈 내용을 기록합니다</h2><p>전화·문자·방문·미팅 내용을 남기면 다음 상담 때 바로 확인할 수 있습니다.</p></div><div class="section-head-actions"><button class="primary-button" data-action="new-consultation">＋ 상담 기록</button></div></div>${activities.length ? `<div class="data-table-wrap"><table class="data-table consultation-table"><thead><tr><th>상담일</th><th>고객</th><th>방식</th><th>상담 내용</th><th>결과·다음 할 일</th><th>담당자</th><th>관리</th></tr></thead><tbody>${activities.map(activity => { const customer = customerById(activity.customerId); return `<tr data-customer-open="${attr(activity.customerId)}"><td>${esc(dateText(activity.occurredAt))}</td><td><strong>${esc(customer && customer.name || "연결 고객 없음")}</strong></td><td><span class="activity-method">${activityIcon(activity.type)} ${esc(activity.type)}</span></td><td>${esc(activity.summary || "-")}</td><td>${esc(activity.result || activity.nextAction || "-")}</td><td>${esc(activity.owner || "-")}</td><td><button type="button" class="record-delete-button" data-activity-delete="${attr(activity.id)}">삭제</button></td></tr>`; }).join("")}</tbody></table></div>` : empty("아직 상담 기록이 없습니다", "첫 상담 내용을 기록하면 고객별 이력이 자동으로 쌓입니다.", `<button class="primary-button" data-action="new-consultation">＋ 첫 상담 기록</button>`)}`;
  }

  function renderPipeline() {
    ensureSalesStore();
    const now = new Date().toISOString();
    const kpis = Sales.calculateKpis(store, { now });
    main.innerHTML = SalesUI.renderPipeline({
      store,
      stages: Sales.SALES_STAGES,
      kpis,
      periodLabel: "전체 기간 누계",
      ownerCounts: kpis.activeProspectsByOwner || kpis.activeByOwner || {},
      selectedStage: salesStageFilter,
      boardMode: salesBoardMode,
      query: searchEl.value,
      now,
      writable: canWriteCRM()
    }) + renderArchivedSalesProspects();
  }

  function renderArchivedSalesProspects() {
    const archived = (store.salesProspects || []).filter(item => item && item.archivedAt);
    if (!archived.length) return "";
    return `<details class="sales-crm sales-archived-panel"><summary><span>보관된 영업 대상</span><b>${archived.length}건</b></summary><div class="sales-archived-list">${archived.map(item => `<article><div><strong>${esc(item.name || "이름 없는 건물")}</strong><p>${esc(item.address || "주소 미입력")} · ${esc(dateText(item.archivedAt))}</p></div><div class="row-actions"><button type="button" class="mini-button" data-sales-prospect-open="${attr(item.id)}">기록 보기</button>${canWriteCRM() ? `<button type="button" class="mini-button return" data-sales-prospect-restore="${attr(item.id)}">복원</button>` : ""}</div></article>`).join("")}</div></details>`;
  }

  const contractStatusTone = status => ({ "계약 준비": "preparing", "진행 중": "active", "종료 예정": "ending", "종료": "closed" })[status] || "preparing";
  const contractTypes = contract => Core.normalizeContractTypes(contract);
  const contractDateText = value => {
    if (!value) return "미입력";
    const day = Core.dayKey(value);
    return day ? `${day.replaceAll("-", ". ")}.` : "미입력";
  };
  const contractEndDateText = value => value ? contractDateText(value) : "종료일 미정";
  const contractTypeDetail = contract => {
    const types = contractTypes(contract);
    return [...new Set([
      contract.scope,
      types.includes("청소") ? contract.serviceFrequency : "",
      types.includes("건물관리") && contract.unitCount ? `${Number(contract.unitCount).toLocaleString("ko-KR")}개 호실` : "",
      types.includes("부동산관리") ? contract.managementTarget : "",
      types.includes("부동산관리") ? contract.feeMethod : ""
    ].filter(Boolean))].join(" · ");
  };

  function renderContracts() {
    const query = Core.normalizeText(searchEl.value);
    const contracts = [...store.contracts]
      .filter(item => contractTypeFilter === "전체" || contractTypes(item).includes(contractTypeFilter))
      .filter(item => contractStatusFilter === "전체" || item.status === contractStatusFilter)
      .filter(item => {
        const customer = customerById(item.customerId);
        const building = buildingById(item.buildingId);
        return !query || Core.normalizeText([item.contractNo, item.name, contractTypes(item).join(" "), item.status, item.owner, item.scope, customer && customer.name, building && building.name].join(" ")).includes(query);
      })
      .sort((a, b) => (a.status === "종료") - (b.status === "종료") || String(a.endDate || "9999").localeCompare(String(b.endDate || "9999")));
    const active = store.contracts.filter(item => item.status === "진행 중").length;
    const preparing = store.contracts.filter(item => item.status === "계약 준비").length;
    const ending = store.contracts.filter(item => item.status === "종료 예정").length;
    const monthly = store.contracts.filter(item => item.status !== "종료" && item.billingCycle === "월 정기").reduce((sum, item) => sum + Core.money(item.amount), 0);
    main.innerHTML = `<section class="contract-hero"><div><span>계약 조건과 기간을 한곳에서 관리합니다</span><h2>청소·건물관리·부동산관리 계약</h2><p>계약 유형을 선택하고 고객·건물·기간·금액·업무 범위를 기록하세요.</p></div><button class="primary-button" data-action="new-contract">＋ 새 계약</button></section>
      <div class="contract-kpi-grid">${kpi("진행 중", active, "현재 운영 계약", "#4fb99b")}${kpi("계약 준비", preparing, "확정 전 계약", "#55aee8")}${kpi("종료 예정", ending, "종료·갱신 확인", "#efb84f")}${kpi("월 정기 금액", compactMoney(monthly), "진행 계약 기준", "#55c3d1")}</div>
      <div class="contract-toolbar"><div class="contract-type-filters">${["전체", ...Core.CONTRACT_TYPES].map(type => `<button type="button" class="filter-chip ${contractTypeFilter === type ? "active" : ""}" data-contract-type-filter="${attr(type)}">${esc(type)}</button>`).join("")}</div><label><span>계약 상태</span><select data-contract-status-filter>${["전체", ...Core.CONTRACT_STATUSES].map(status => `<option ${contractStatusFilter === status ? "selected" : ""}>${esc(status)}</option>`).join("")}</select></label></div>
      ${contracts.length ? `<section class="contract-list">${contracts.map(contract => {
        const customer = customerById(contract.customerId);
        const building = buildingById(contract.buildingId);
        const types = contractTypes(contract);
        const detail = contractTypeDetail(contract);
        return `<article class="contract-card ${contractStatusTone(contract.status)}" data-contract-edit="${attr(contract.id)}" tabindex="0"><header><div class="contract-card-badges">${types.map(type => `<span class="contract-type">${esc(type)}</span>`).join("")}<span class="contract-status ${contractStatusTone(contract.status)}">${esc(contract.status)}</span></div><span class="contract-number">${esc(contract.contractNo || contract.id)}</span></header><h3>${esc(contract.name || `${types.join("·")} 계약`)}</h3><p class="contract-linked">${esc(customer && customer.name || "고객 미연결")} · ${esc(building && building.name || "건물 미연결")}</p><div class="contract-facts"><div><span>계약 기간</span><b>${esc(contractDateText(contract.startDate))} ~ ${esc(contractEndDateText(contract.endDate))}</b></div><div><span>계약 금액</span><b>${esc(Core.money(contract.amount) ? krw(contract.amount) : "미입력")}</b><small>${esc(contract.billingCycle || "납부 방식 미입력")}</small></div><div><span>담당자</span><b>${esc(contract.owner || "미입력")}</b></div></div><div class="contract-scope"><span>업무 범위</span><p>${esc(detail || "업무 범위가 아직 입력되지 않았습니다.")}</p></div><footer><span>${esc(contract.memo || "계약 메모 없음")}</span><button type="button" class="secondary-button" data-contract-edit="${attr(contract.id)}">상세·수정</button></footer></article>`;
      }).join("")}</section>` : empty("조건에 맞는 계약이 없습니다", "새 계약을 등록하거나 다른 유형·상태를 선택해 주세요.", `<button class="primary-button" data-action="new-contract">＋ 첫 계약 등록</button>`)}`;
  }

  function relationshipState(customer) {
    const nextKey = dueKey(customer.relationshipNextContactAt);
    const today = todayKey();
    if (!nextKey) return { label: "일정 미등록", tone: "unscheduled" };
    if (nextKey < today) return { label: "연락 지연", tone: "overdue" };
    if (nextKey === today) return { label: "오늘 연락", tone: "today" };
    const remaining = Math.ceil((new Date(`${nextKey}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000);
    if (remaining <= 7) return { label: `${remaining}일 후 연락`, tone: "soon" };
    return { label: "관계 유지 중", tone: "active" };
  }

  function renderRelationships() {
    const customers = store.customers.filter(customerIsRelationshipCustomer)
      .sort((a, b) => String(a.relationshipNextContactAt || "9999").localeCompare(String(b.relationshipNextContactAt || "9999")));
    const today = todayKey();
    const overdue = customers.filter(customer => dueKey(customer.relationshipNextContactAt) && dueKey(customer.relationshipNextContactAt) < today).length;
    const dueToday = customers.filter(customer => dueKey(customer.relationshipNextContactAt) === today).length;
    const unplanned = customers.filter(customer => !customer.relationshipNextContactAt).length;
    main.innerHTML = `<section class="relationship-hero"><div><span>계약이 끝이 아니라 관계의 시작입니다</span><h2>계약 고객에게 잊지 않고 다시 연락합니다</h2><p>카드를 누르면 고객별 후속 연락 이력과 새 기록 입력 화면이 열립니다.</p></div><button class="secondary-button" data-view="pipeline">영업 관리 보기 →</button></section>
      <div class="relationship-kpi-grid">${kpi("관리 고객", customers.length, "유료관리 전환 고객", "#55aee8")}${kpi("오늘 연락", dueToday, "오늘 확인할 고객", "#efb84f")}${kpi("연락 지연", overdue, "예정일이 지난 고객", "#e66c78")}${kpi("일정 미등록", unplanned, "다음 연락일 필요", "#54b99c")}</div>
      ${customers.length ? `<section class="relationship-list">${customers.map(customer => {
        const state = relationshipState(customer);
        const lastActivity = customerActivities(customer.id)[0];
        const lastContact = customer.relationshipLastContactAt || customer.lastContactAt || (lastActivity && lastActivity.occurredAt) || "";
        return `<article class="relationship-card" data-relationship-open="${attr(customer.id)}" tabindex="0"><header><i class="avatar">${esc(initials(customer.name))}</i><div><h3>${esc(customer.name)}</h3><p>${esc([customer.company, customerPhoneText(customer.phone)].filter(Boolean).join(" · ") || "연락처 미입력")}</p></div><span class="relationship-state ${state.tone}">${esc(state.label)}</span></header><div class="relationship-facts"><div><span>마지막 연락</span><b>${esc(lastContact ? dateText(lastContact) : "기록 없음")}</b></div><div><span>다음 연락</span><b>${esc(customer.relationshipNextContactAt ? dateText(customer.relationshipNextContactAt) : "일정 미등록")}</b></div><div><span>다음 할 일</span><b>${esc(customer.relationshipNextAction || "후속 계획 미등록")}</b></div><div><span>연락 주기</span><b>${Number(customer.relationshipCycleDays) || 30}일마다</b></div></div>${customer.relationshipNote ? `<p class="relationship-note">${esc(customer.relationshipNote)}</p>` : ""}<footer><button class="primary-button" data-relationship-followup="${attr(customer.id)}">＋ 후속 연락 기록</button><button class="secondary-button" data-relationship-plan="${attr(customer.id)}">연락 계획 설정</button><span class="relationship-open-hint">상세·기록 보기 →</span></footer></article>`;
      }).join("")}</section>` : empty("유료관리 전환 고객이 없습니다", "영업 관리에서 연결 건물을 ‘유료관리 전환’ 단계로 진행하면 이곳에 자동으로 나타납니다.", `<button class="primary-button" data-view="pipeline">영업 관리로 이동 →</button>`)}`;
  }

  function partnerQuoteBadge(status) {
    const tone = status === "협력 후보" ? "candidate" : status === "상담 완료" ? "received" : status === "제외" ? "excluded" : status === "상담 중" ? "requested" : "planned";
    return `<span class="partner-quote-status ${tone}">${esc(status || "연락 예정")}</span>`;
  }

  function partnerVendorSummaryMarkup(vendor, emptyText) {
    if (!vendor) return `<div class="partner-vendor-summary empty"><b>연락 업체를 선택해 주세요.</b><span>${esc(emptyText || "저장된 업체를 선택하면 연락처와 업체 링크가 표시됩니다.")}</span></div>`;
    return `<div class="partner-vendor-summary"><div><span class="industry-badge">${esc(partnerIndustry(vendor))}</span><h3>${esc(partnerVendorName(vendor) || "업체명 미입력")}</h3><p>${esc(vendor.service || vendor.category || "작업 내용 미입력")}</p></div><div><span>연락처</span><b>${esc(partnerPhoneText(vendor))}</b><small>${esc([vendor.region, vendor.quoteUrl ? "업체 링크 등록됨" : "업체 링크 미등록"].filter(Boolean).join(" · "))}</small></div></div>`;
  }

  function renderPartnerVendors() {
    const query = Core.normalizeText(searchEl.value);
    const phoneQuery = customerPhoneSearchKey(searchEl.value);
    const vendors = partnerVendorRows()
      .filter(item => partnerVendorIndustryFilter === "전체 업종" || partnerIndustry(item) === partnerVendorIndustryFilter)
      .filter(item => !query
        || Core.normalizeText([partnerVendorName(item), item.phone, item.alternatePhone, item.region, partnerIndustry(item), item.service, item.category, item.memo].join(" ")).includes(query)
        || phoneQuery && [item.phone, item.alternatePhone].some(value => customerPhoneCandidateKey(value).includes(phoneQuery)))
      .sort((a, b) => partnerVendorName(a).localeCompare(partnerVendorName(b), "ko"));
    const linkedQuotes = store.partnerQuotes.filter(item => partnerVendorForQuote(item)).length;
    const withPhone = partnerVendorRows().filter(item => item.phone || item.alternatePhone).length;
    const withLink = partnerVendorRows().filter(item => item.quoteUrl).length;
    main.innerHTML = `<section class="partner-vendor-hero"><div><span>연락처와 업체 페이지를 먼저 등록합니다</span><h2>상담할 업체 정보를 관리합니다</h2><p>업체 링크를 붙여 넣으면 공개된 업체명·연락처·업종·작업 내용을 자동으로 채웁니다.</p></div><div class="partner-hero-actions"><button class="secondary-button" data-view="partnerQuotes">업체 상담 보기 →</button><button class="primary-button" data-action="new-partner-vendor">＋ 연락 업체 등록</button></div></section>
      <div class="quote-kpi-grid partner-vendor-kpis">${kpi("등록 업체", partnerVendorRows().length, "상담할 업체 기본정보", "#55aee8")}${kpi("연락처 확인", withPhone, "전화번호가 있는 업체", "#48b995", withPhone ? "good" : "")}${kpi("업체 링크", withLink, "홈페이지·지도 링크", "#55c3d1")}${kpi("연결 상담", linkedQuotes, "업체를 선택한 상담 기록", "#e8b855")}</div>
      <div class="partner-vendor-toolbar"><label><span>업종 선택</span><select data-partner-vendor-industry-filter>${["전체 업종", ...Core.PARTNER_INDUSTRIES].map(industry => `<option ${industry === partnerVendorIndustryFilter ? "selected" : ""}>${esc(industry)}</option>`).join("")}</select></label><span>업체 카드를 누르면 기본정보를 수정할 수 있습니다.</span></div>
      ${vendors.length ? `<div class="partner-vendor-list">${vendors.map(vendor => {
        const quotes = partnerQuotesForVendor(vendor);
        const recent = [...quotes].sort((a, b) => String(b.consultedAt || b.receivedAt || b.contactedAt || b.createdAt).localeCompare(String(a.consultedAt || a.receivedAt || a.contactedAt || a.createdAt)))[0];
        return `<article class="partner-vendor-card" data-partner-vendor-edit="${attr(vendor.id)}"><header><div><span class="industry-badge">${esc(partnerIndustry(vendor))}</span><h3>${esc(partnerVendorName(vendor) || "업체명 미입력")}</h3><p>${esc(vendor.service || vendor.category || "작업 내용 미입력")}</p></div><button type="button" class="quote-card-edit" data-partner-vendor-edit="${attr(vendor.id)}">업체 수정</button></header><div class="partner-vendor-contact"><div><span>연락처</span><b>${esc(partnerPhoneText(vendor))}</b></div><div><span>지역</span><b>${esc(vendor.region || "미입력")}</b></div></div><footer><span>상담 ${quotes.length}건${recent ? ` · 최근 ${esc(shortDate(recent.consultedAt || recent.receivedAt || recent.contactedAt))}` : ""}</span>${vendor.quoteUrl ? `<button type="button" data-partner-vendor-link="${attr(vendor.quoteUrl)}">업체 페이지 열기 ↗</button>` : `<small>업체 링크 미등록</small>`}</footer></article>`;
      }).join("")}</div>` : empty("등록된 연락 업체가 없습니다", "업체 링크를 붙여 넣어 업체 기본정보를 먼저 저장하세요.", `<button class="primary-button" data-action="new-partner-vendor">＋ 첫 연락 업체 등록</button>`)}`;
  }

  function renderPartnerQuotes() {
    const query = Core.normalizeText(searchEl.value);
    const phoneQuery = customerPhoneSearchKey(searchEl.value);
    const quotes = [...store.partnerQuotes]
      .filter(item => partnerQuoteIndustryFilter === "전체 업종" || partnerIndustry(partnerQuoteVendorView(item)) === partnerQuoteIndustryFilter)
      .filter(item => partnerQuoteStatusFilter === "전체" || item.status === partnerQuoteStatusFilter)
      .filter(item => { const vendor = partnerQuoteVendorView(item); return !query
        || Core.normalizeText([item.scenario, vendor.vendor, vendor.phone, vendor.alternatePhone, vendor.region, partnerIndustry(vendor), vendor.service, item.includedWork, item.consultationContent, item.memo].join(" ")).includes(query)
        || phoneQuery && [vendor.phone, vendor.alternatePhone].some(value => customerPhoneCandidateKey(value).includes(phoneQuery)); })
      .sort((a, b) => String(b.consultedAt || b.receivedAt || b.contactedAt || b.createdAt).localeCompare(String(a.consultedAt || a.receivedAt || a.contactedAt || a.createdAt)));
    const scoped = store.partnerQuotes.filter(item => partnerQuoteIndustryFilter === "전체 업종" || partnerIndustry(partnerQuoteVendorView(item)) === partnerQuoteIndustryFilter);
    const candidates = scoped.filter(item => item.status === "협력 후보").length;
    const completed = scoped.filter(item => item.status === "상담 완료" || item.status === "협력 후보").length;
    const waiting = scoped.filter(item => item.status === "연락 예정" || item.status === "상담 중").length;
    main.innerHTML = `
      <section class="partner-quote-hero">
        <div><span>고객과 연결되지 않는 협력업체 상담 기록</span><h2>업체별 가격과 상담 내용을 관리합니다</h2><p>같은 가상 작업 조건으로 문의하고 안내 가격·상담 내용·확인 항목을 기록하세요.</p></div>
        <div class="partner-hero-actions"><button class="secondary-button" data-view="partnerVendors">연락 업체 관리</button><button class="primary-button" data-action="new-partner-quote">＋ 업체 상담 기록</button></div>
      </section>
      <div class="quote-kpi-grid">
        ${kpi("상담 업체", scoped.filter(item => item.status !== "제외").length, partnerQuoteIndustryFilter, "#55aee8")}
        ${kpi("상담 대기", waiting, "연락 예정·상담 중", "#e8b855", waiting ? "alert" : "")}
        ${kpi("상담 완료", completed, "상담 완료·협력 후보", "#48b995", completed ? "good" : "")}
        ${kpi("협력 후보", candidates, "우선 검토할 업체", "#55c3d1", candidates ? "good" : "")}
      </div>
      <div class="quote-filter-bar"><label><span>업종 선택</span><select data-partner-industry-filter>${["전체 업종", ...Core.PARTNER_INDUSTRIES].map(industry => `<option ${industry === partnerQuoteIndustryFilter ? "selected" : ""}>${esc(industry)}</option>`).join("")}</select></label><div class="filter-group">${["전체", ...Core.PARTNER_QUOTE_STATUSES].map(status => `<button class="filter-chip ${partnerQuoteStatusFilter === status ? "active" : ""}" data-partner-quote-filter="${attr(status)}">${esc(status)}</button>`).join("")}</div><span>업체 카드를 누르면 상담 내용을 수정할 수 있습니다.</span></div>
      ${quotes.length ? `<div class="partner-quote-list">${quotes.map(item => {
        const vendor = partnerQuoteVendorView(item);
        const checks = checklistCount(item);
        const consultationContent = item.consultationContent || item.memo || "";
        const priceMin = item.totalMin || item.quotedAmount || item.constructionMin;
        const priceMax = item.totalMax || item.quotedAmount || item.constructionMax;
        const price = moneyRange(priceMin, priceMax, item.constructionPricing || "미확인");
        const consultedAt = item.consultedAt || item.receivedAt || item.contactedAt;
        return `<article class="partner-quote-card" data-partner-quote-edit="${attr(item.id)}">
          <header class="quote-card-head">
            <div class="quote-card-company"><div class="quote-card-badges"><span class="industry-badge">${esc(partnerIndustry(vendor))}</span>${partnerQuoteBadge(item.status)}</div><h3>${esc(vendor.vendor || "업체명 미입력")}</h3><p>${esc(item.scenario || "문의한 작업 조건 미입력")}</p><div class="quote-card-contact"><span>${esc(partnerPhoneText(vendor))}</span>${vendor.quoteUrl ? `<button type="button" data-partner-quote-link="${attr(vendor.quoteUrl)}">업체 페이지 열기 ↗</button>` : ""}</div></div>
            <div class="quote-card-total"><span>안내 가격</span><strong>${esc(price)}</strong><small>${item.priceNegotiable ? "가격 협의 가능" : "업체가 상담 중 안내한 금액"}</small></div>
            <button type="button" class="quote-card-edit" data-partner-quote-edit="${attr(item.id)}">상담 수정</button>
          </header>
          <section class="quote-card-consultation"><b>상담 내용</b><p>${esc(consultationContent || "아직 입력된 상담 내용이 없습니다.")}</p></section>
          <div class="quote-card-meta"><div><span>최근 상담일</span><strong>${esc(consultedAt ? shortDate(consultedAt) : "미등록")}</strong></div><div><span>담당자</span><strong>${esc(item.owner || "미등록")}</strong></div><div><span>작업 내용</span><strong>${esc(vendor.service || vendor.category || item.service || item.category || "미입력")}</strong></div><div class="quote-card-check"><span>확인 항목</span><strong>${checks.done} / ${checks.total}</strong><small>${checks.done === checks.total ? "모든 항목 확인" : `${checks.total - checks.done}개 추가 확인`}</small></div></div>
          ${item.memo && item.memo !== consultationContent ? `<footer class="quote-card-note"><b>추가 비고</b><p>${esc(item.memo)}</p></footer>` : ""}
        </article>`;
      }).join("")}</div>` : empty("조건에 맞는 업체 상담 기록이 없습니다", "업종을 선택하거나 업체와 나눈 상담 내용을 입력해 보세요.", `<button class="primary-button" data-action="new-partner-quote">＋ 첫 업체 상담 기록</button>`)}`;
  }

  function renderTasks() {
    const today = todayKey();
    const tasks = [...store.tasks].filter(task => taskStatusFilter === "전체" || (taskStatusFilter === "완료" ? task.status === "완료" : task.status !== "완료" && task.status !== "취소"))
      .sort((a, b) => (a.status === "완료") - (b.status === "완료") || String(a.dueAt).localeCompare(String(b.dueAt)));
    main.innerHTML = `<section class="task-workspace"><div class="toolbar task-toolbar"><div class="filter-group">${["전체", "열린 업무", "완료"].map(filter => `<button class="filter-chip ${taskStatusFilter === filter ? "active" : ""}" data-task-filter="${filter}">${filter}</button>`).join("")}</div><button class="secondary-button" data-action="new-task">＋ 할 일 추가</button></div>
      ${tasks.length ? `<div class="task-list">${tasks.map(task => {
        const customer = customerById(task.customerId);
        const due = dueKey(task.dueAt);
        const overdue = task.status !== "완료" && !!due && due < today;
        const dueState = !due ? "일정 미정" : overdue ? "기한 지남" : task.status === "완료" ? "완료됨" : due === today ? "오늘까지" : "예정";
        return `<div class="task-row ${task.status === "완료" ? "done" : ""} ${overdue ? "overdue" : ""}"><button class="task-check" data-task-toggle="${attr(task.id)}" title="${task.status === "완료" ? "완료 취소" : "완료 처리"}" aria-label="${task.status === "완료" ? "완료 취소" : "완료 처리"}">${task.status === "완료" ? "✓" : ""}</button><div class="task-title"><strong>${esc(task.title)}</strong><span>${esc(task.category || "업무")} · ${esc(task.note || "메모 없음")}</span></div><div class="task-meta task-customer"><span class="task-meta-label">연결 고객</span><button type="button" class="task-customer-button" data-customer-open="${attr(task.customerId)}">${esc(customer && customer.name || "공통 업무")}</button></div><div class="task-meta task-due"><span class="task-meta-label">기한</span><time datetime="${attr(due)}"><b>${esc(due ? shortDate(task.dueAt) : "미정")}</b><small>${esc(dueState)}</small></time></div><div class="task-meta task-owner"><span class="task-meta-label">담당자</span><strong>${esc(task.owner || "미입력")}</strong></div><div class="task-meta task-priority"><span class="task-meta-label">우선순위</span>${priorityClass(task.priority)}</div><button type="button" class="record-delete-button task-delete-button" data-task-delete="${attr(task.id)}">삭제</button></div>`;
      }).join("")}</div>` : empty("할 일이 없습니다", "고객별 후속조치를 등록하면 오늘 할 일에서 관리할 수 있습니다.", `<button class="primary-button" data-action="new-task">＋ 할 일 추가</button>`)}</section>`;
  }

  function renderSecurity() {
    const stats = Core.calculateSecurityStatus(store, new Date());
    const tabs = [
      ["assets", "열쇠·문서", store.securityAssets.length],
      ["access", "서버 권한", 3],
      ["audit", "사용 기록", store.auditLogs.length],
      ["incidents", "사고 보고", stats.openIncidents]
    ];
    main.innerHTML = `
      <section class="security-hero">
        <div class="security-hero-icon">◆</div><div><span>운영매뉴얼 DATA-01 적용</span><h2>열쇠와 개인정보 기록을 한곳에서 관리합니다</h2><p>누가 가지고 있는지, 언제 돌려받는지, 누가 정보를 사용했는지만 기록하세요.</p></div>
        ${canWriteCRM() ? `<div class="security-hero-actions"><button class="primary-button" data-action="new-security-asset">＋ 열쇠·문서 등록</button></div>` : ""}
      </section>
      <div class="security-kpi-grid">
        ${securityKpi("등록된 열쇠·문서", stats.totalAssets, "현재 관리 중", "blue")}
        ${securityKpi("다른 사람이 보유 중", stats.checkedOut, "보유자와 반납일 확인", "cyan")}
        ${securityKpi("반납·파기 확인", stats.overdueAssets + stats.expiringRecords, "기한이 지난 항목", stats.overdueAssets + stats.expiringRecords ? "red" : "green")}
        ${securityKpi("확인할 사고", stats.openIncidents, "조치가 끝나지 않은 사고", stats.openIncidents ? "red" : "green")}
      </div>
      <div class="security-tabs">${tabs.map(([id, label, count]) => `<button class="security-tab ${securityTab === id ? "active" : ""}" data-security-tab="${id}"><span>${label}</span><em>${count}</em></button>`).join("")}</div>
      ${renderSecurityContent()}`;
  }

  function securityKpi(label, value, foot, tone) {
    return `<article class="security-kpi ${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(foot)}</small></article>`;
  }

  function renderSecurityContent() {
    if (securityTab === "access") return renderAccessRoles();
    if (securityTab === "audit") return renderAuditLogs();
    if (securityTab === "incidents") return renderIncidents();
    return renderSecurityAssets();
  }

  function renderSecurityAssets() {
    const today = todayKey();
    const items = [...store.securityAssets].sort((a, b) => (a.status === "분실" ? -1 : b.status === "분실" ? 1 : 0) || String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    return `<section class="security-panel"><div class="security-panel-head"><div><h3>열쇠·카드·중요 문서 목록</h3><p>어디에 있고 누가 가지고 있는지 기록합니다. 실제 비밀번호나 주민등록번호는 입력하지 마세요.</p></div>${canWriteCRM() ? `<button class="primary-button" data-action="new-security-asset">＋ 열쇠·문서 등록</button>` : ""}</div>
      ${items.length ? `<div class="security-table-wrap"><table class="security-table"><thead><tr><th>종류</th><th>이름·보관 위치</th><th>사용 건물</th><th>누가 가지고 있나요?</th><th>현재 상태</th><th>확인할 날짜</th><th>정보 중요도</th><th></th></tr></thead><tbody>${items.map(item => { const building = buildingById(item.buildingId); const inactive = item.status === "폐기" || item.status === "무효"; const overdue = item.status === "대여중" && item.dueAt && dueKey(item.dueAt) < today; const retentionDue = !inactive && item.retentionUntil && dueKey(item.retentionUntil) <= today; return `<tr class="${overdue || retentionDue || item.status === "분실" ? "security-row-alert" : ""}"><td><b>${esc(item.type)}</b><span>${esc(item.assetNo)}</span></td><td><strong>${esc(item.label || "이름 미입력")}</strong><span>${esc(item.storageLocation || "보관 위치 미입력")}</span></td><td>${esc(building && building.name || "공통")}<span>${esc(item.room || "-")}</span></td><td>${esc(item.holder || "보관 담당자")}</td><td>${securityStatusBadge(item.status, overdue)}</td><td>${esc(shortDate(item.dueAt || item.retentionUntil))}${overdue ? `<span class="danger-text">반납 지연</span>` : retentionDue ? `<span class="danger-text">파기 여부 확인</span>` : ""}</td><td><span class="sensitivity ${item.sensitivity === "고위험" ? "high" : ""}">${esc(item.sensitivity || "제한")}</span></td><td><div class="row-actions">${canWriteCRM() && !inactive ? `<button class="mini-button" data-security-edit="${attr(item.id)}">수정</button>${item.status === "대여중" ? `<button class="mini-button return" data-security-return="${attr(item.id)}">반납</button>` : ""}<button class="mini-button danger" data-security-dispose="${attr(item.id)}">무효·폐기</button>` : ""}</div></td></tr>`; }).join("")}</tbody></table></div>` : empty("등록된 열쇠나 문서가 없습니다", "열쇠·출입카드·계약서가 어디에 있는지 등록해 보세요.", canWriteCRM() ? `<button class="primary-button" data-action="new-security-asset">＋ 첫 열쇠·문서 등록</button>` : "")}</section>`;
  }

  function securityStatusBadge(status, overdue) {
    const tone = overdue || status === "분실" ? "danger" : status === "대여중" ? "working" : status === "폐기" || status === "무효" ? "muted" : "safe";
    return `<span class="security-status ${tone}">${overdue ? "반납 지연" : esc(status || "보관중")}</span>`;
  }

  function renderAccessRoles() {
    const policies = [
      { name: "관리자", scope: "회사 전체 업무 정보", values: [true, true, true, true] },
      { name: "업무 담당자", scope: "회사 전체 업무 정보", values: [true, true, false, false] },
      { name: "조회 전용", scope: "회사 전체 업무 정보", values: [true, false, false, false] }
    ];
    return `<section class="security-panel"><div class="security-panel-head"><div><h3>서버에서 실제 적용되는 권한</h3><p>로그인 계정의 역할에 따라 서버가 보기와 변경을 허용하거나 차단합니다.</p></div></div><div class="plain-guide"><b>계정 역할 변경</b><span>권한표를 화면에서 임의로 바꾸지 않습니다. 입사·퇴사·협력 종료 시 서버 관리자가 허용 계정을 변경합니다.</span></div><div class="permission-table-wrap"><table class="permission-table"><thead><tr><th>로그인 역할</th><th>볼 수 있는 범위</th><th>보기</th><th>내용 바꾸기</th><th>암호화 백업</th><th>권한·보안 설정</th></tr></thead><tbody>${policies.map(policy => `<tr><td><strong>${policy.name}</strong></td><td>${policy.scope}</td>${policy.values.map(value => `<td><span class="permission-check ${value ? "yes" : "no"}">${value ? "✓ 허용" : "— 차단"}</span></td>`).join("")}</tr>`).join("")}</tbody></table></div><div class="security-rule-grid"><div><b>필요한 계정만</b><span>회사에서 허용한 이메일만 로그인할 수 있습니다.</span></div><div><b>퇴사·계약 종료 즉시</b><span>서버의 해당 로그인 계정을 바로 중지합니다.</span></div><div><b>파일 반출 제한</b><span>암호화 백업은 관리자만 저장하고 복원할 수 있습니다.</span></div></div></section>`;
  }

  function renderAuditLogs() {
    const logs = [...store.auditLogs].sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt))).slice(0, 500);
    return `<section class="security-panel"><div class="security-panel-head"><div><h3>누가 무엇을 했는지 확인합니다</h3><p>고객정보를 보거나 바꾼 일, 열쇠를 빌리고 돌려준 일이 자동으로 기록됩니다.</p></div>${canWriteCRM() ? `<button class="primary-button" data-action="new-audit">＋ 직접 기록 추가</button>` : ""}</div>${logs.length ? `<div class="security-table-wrap"><table class="security-table audit-table"><thead><tr><th>언제</th><th>무슨 일</th><th>어떤 정보</th><th>처리 내용</th><th>누가</th><th>처리한 이유</th></tr></thead><tbody>${logs.map(log => `<tr><td>${esc(dateText(log.occurredAt))}</td><td><span class="audit-category">${esc(log.category)}</span></td><td><b>${esc(log.targetType || "업무")}</b><span>${esc(log.targetLabel || log.targetId || "-")}</span></td><td>${esc(log.action || "기록")}</td><td>${esc(log.actor || "-")}</td><td>${esc(log.reason || "업무 수행")}</td></tr>`).join("")}</tbody></table></div>` : empty("아직 사용 기록이 없습니다", "고객을 열어보거나 열쇠를 빌려주면 자동으로 기록됩니다.", canWriteCRM() ? `<button class="primary-button" data-action="new-audit">＋ 첫 기록 추가</button>` : "")}</section>`;
  }

  function renderIncidents() {
    const items = [...store.securityIncidents].sort((a, b) => (["종결", "무효"].includes(a.status)) - (["종결", "무효"].includes(b.status)) || String(b.occurredAt).localeCompare(String(a.occurredAt)));
    return `<section class="security-panel"><div class="security-panel-head"><div><h3>분실·유출·무단조회 사고</h3><p>사고를 발견하면 즉시 기록하고 데이터·운영책임자에게 보고합니다.</p></div>${canWriteCRM() ? `<button class="danger-button" data-action="new-incident">! 사고 보고</button>` : ""}</div>${items.length ? `<div class="incident-grid">${items.map(item => { const inactive = item.status === "종결" || item.status === "무효"; return `<article class="incident-card ${inactive ? "closed" : ""}"><header><span class="incident-severity ${item.severity === "긴급" ? "urgent" : ""}">${esc(item.severity)}</span><b>${esc(item.type)}</b><time>${esc(dateText(item.occurredAt))}</time></header><h4>${esc(item.summary || "내용 미입력")}</h4><p>보고자 ${esc(item.reportedBy || "-")} · 보고 대상 ${esc(item.escalatedTo || "데이터·운영책임자")}</p>${item.resolution ? `<div class="incident-resolution">${esc(item.resolution)}</div>` : ""}<footer><span class="security-status ${item.status === "종결" ? "safe" : item.status === "무효" ? "muted" : "danger"}">${esc(item.status)}</span>${canWriteCRM() && item.status !== "무효" ? `<button class="mini-button" data-incident-edit="${attr(item.id)}">처리 내용 수정</button>` : ""}</footer></article>`; }).join("")}</div>` : empty("보고된 사고가 없습니다", "키 분실, 개인정보 유출, 무단조회가 발생하면 즉시 기록하세요.", canWriteCRM() ? `<button class="danger-button" data-action="new-incident">! 사고 보고</button>` : "")}</section>`;
  }

  function securityAssetEditor(assetId) {
    const editing = store.securityAssets.find(item => item.id === assetId);
    const item = editing ? JSON.parse(JSON.stringify(editing)) : Core.createSecurityAsset({ accessRole: store.accessRoles[0] && store.accessRoles[0].name || "데이터·운영책임자" });
    const editableStatuses = Core.SECURITY_ASSET_STATUSES.filter(status => !["폐기", "무효"].includes(status));
    modalContent.innerHTML = `<div class="modal-head"><div><h2>${editing ? "열쇠·문서 정보 수정" : "열쇠·문서 등록"}</h2><p>어디에 있고 누가 가지고 있는지 기록하는 화면입니다.</p></div><button class="close-button" data-action="close-modal">×</button></div><form id="securityAssetForm" class="modal-body" data-asset-id="${attr(editing && editing.id || "")}"><div class="no-secret-box"><b>중요한 값은 적지 마세요</b><span>“관리실 도어락”이라고만 적고 실제 비밀번호나 주민등록번호는 입력하지 마세요.</span></div><div class="form-grid">${selectField("무엇을 등록하나요?", "type", Core.SECURITY_ASSET_TYPES, item.type)}${field("이름 *", "label", item.label, "text", "예: 무실스테이 공용현관 마스터키")}${selectField("어느 건물에서 사용하나요?", "buildingId", ["", ...store.buildings.map(building => building.id)], item.buildingId, id => id ? (buildingById(id)?.name || id) : "공통·미지정")}${field("호실·사용 장소", "room", item.room, "text", "예: 302호 또는 관리실")}${field("현재 누가 가지고 있나요?", "holder", item.holder, "text", "담당자 또는 업체명")}${selectField("현재 상태", "status", editableStatuses, item.status)}${field("빌려준 날", "issuedAt", datetimeValue(item.issuedAt), "datetime-local")}${field("돌려받을 날", "dueAt", item.dueAt ? Core.dayKey(item.dueAt) : "", "date")}${field("문서 보관 종료일", "retentionUntil", item.retentionUntil ? Core.dayKey(item.retentionUntil) : "", "date")}${field("평소 보관 장소", "storageLocation", item.storageLocation, "text", "예: 키 보관함 A-03")}${selectField("정보 중요도", "sensitivity", ["일반", "제한", "고위험"], item.sensitivity)}${areaField("추가 메모", "memo", item.memo, "wide")}</div><div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">취소</button><button class="primary-button">${editing ? "수정 저장" : "등록"}</button></div></form>`;
    openModal();
  }

  function securityReturnEditor(assetId) {
    const item = store.securityAssets.find(entry => entry.id === assetId);
    if (!item || item.status !== "대여중") return showToast("반납 처리할 대여 항목을 찾지 못했습니다.", "error");
    const user = currentAuth.user || {};
    const receiver = user.displayName || user.email || store.settings.owner || "";
    modalContent.innerHTML = `<div class="modal-head"><div><h2>반납 확인 기록</h2><p>반환자와 인수 상태를 확인한 뒤 반납 완료로 바꿉니다.</p></div><button class="close-button" data-action="close-modal">×</button></div><form id="securityReturnForm" class="modal-body" data-asset-id="${attr(item.id)}"><div class="no-secret-box"><b>${esc(item.label)}</b><span>${esc(item.holder || "현재 보유자 미입력")} · ${esc(buildingById(item.buildingId)?.name || "공통")}</span></div><div class="form-grid">${field("반환한 사람·업체 *", "returnedBy", item.holder || "", "text", "실제 반환자")}${field("인수 확인자 *", "receivedBy", receiver, "text", "확인한 담당자")}${field("반납 일시 *", "returnedAt", datetimeValue(new Date().toISOString()), "datetime-local")}${selectField("반납 상태 *", "returnCondition", ["정상", "손상 있음"], "정상")}${field("반납 후 보관 장소 *", "storageLocation", item.storageLocation || "", "text", "예: 키 보관함 A-03")}${areaField("확인 메모", "returnNote", "", "wide")}</div><div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">취소</button><button class="primary-button">반납 완료 저장</button></div></form>`;
    openModal();
  }

  function securityDispositionEditor(assetId) {
    const item = store.securityAssets.find(entry => entry.id === assetId);
    if (!item || ["폐기", "무효"].includes(item.status)) return showToast("이미 무효·폐기 처리된 항목입니다.", "error");
    const user = currentAuth.user || {};
    const approver = user.displayName || user.email || store.settings.owner || "";
    modalContent.innerHTML = `<div class="modal-head"><div><h2>무효·보안 파기 처리</h2><p>기록은 삭제하지 않고 처리 사유와 증빙을 남깁니다.</p></div><button class="close-button" data-action="close-modal">×</button></div><form id="securityDispositionForm" class="modal-body" data-asset-id="${attr(item.id)}"><div class="incident-alert-box"><b>${esc(item.label)}</b><span>감사기록은 계속 보존됩니다. 실제 비밀번호나 주민번호는 증빙란에도 적지 마세요.</span></div><div class="form-grid">${selectField("처리 종류 *", "dispositionType", ["잘못 등록된 기록 무효화", "보관기간 종료 보안 파기"], "잘못 등록된 기록 무효화")}${field("처리 일시 *", "disposedAt", datetimeValue(new Date().toISOString()), "datetime-local")}${field("처리 방법 *", "method", "", "text", "예: 문서 파쇄 또는 키 폐기")}${field("확인·승인자 *", "approvedBy", approver, "text", "책임자")}${areaField("처리 사유 *", "reason", "", "wide")}${areaField("증빙 위치·확인 메모", "evidence", "", "wide")}</div><div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">취소</button><button class="danger-button">기록을 남기고 처리</button></div></form>`;
    openModal();
  }

  function accessRoleEditor(roleId) {
    const editing = store.accessRoles.find(item => item.id === roleId);
    const role = editing ? JSON.parse(JSON.stringify(editing)) : Core.createAccessRole();
    const permission = (name, label, checked) => `<label class="permission-option"><input type="checkbox" name="${name}" ${checked ? "checked" : ""}><span><b>${label}</b><small>${label === "보기" ? "배정된 정보 확인" : label === "내용 바꾸기" ? "정보 추가·수정" : label === "파일 받기" ? "파일을 PC에 저장" : "열쇠·권한·사고 관리"}</small></span></label>`;
    modalContent.innerHTML = `<div class="modal-head"><div><h2>${editing ? "보기 권한 수정" : "사용자 구분 추가"}</h2><p>이 사람들이 할 수 있는 일을 선택하세요.</p></div><button class="close-button" data-action="close-modal">×</button></div><form id="accessRoleForm" class="modal-body" data-role-id="${attr(editing && editing.id || "")}"><div class="form-grid">${field("사용자 구분 *", "name", role.name, "text", "예: 업무 담당자 또는 청소업체")}${field("볼 수 있는 범위", "scope", role.scope, "text", "예: 배정된 건물만")}${selectField("현재 사용 여부", "status", ["사용중", "중지"], role.status)}</div><div class="permission-options">${permission("canView", "보기", role.canView)}${permission("canEdit", "내용 바꾸기", role.canEdit)}${permission("canDownload", "파일 받기", role.canDownload)}${permission("canManageSecurity", "열쇠·보안 관리", role.canManageSecurity)}</div><div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">취소</button><button class="primary-button">권한 저장</button></div></form>`;
    openModal();
  }

  function auditEditor() {
    const user = currentAuth.user || {};
    const actor = user.displayName || user.email || store.settings.owner || "현재 사용자";
    modalContent.innerHTML = `<div class="modal-head"><div><h2>사용 기록 추가</h2><p>프로그램이 자동으로 기록하지 못한 일을 직접 남길 때 사용합니다.</p></div><button class="close-button" data-action="close-modal">×</button></div><form id="auditForm" class="modal-body"><div class="form-grid">${selectField("무슨 일이었나요?", "category", Core.AUDIT_CATEGORIES, "변경")}${selectField("어떤 정보인가요?", "targetType", ["고객", "건물", "열쇠", "출입카드", "계약서", "권한", "백업", "기타"], "고객")}${field("대상 이름 *", "targetLabel", "", "text", "고객명·건물명·열쇠 이름")}<label class="field"><span>처리한 사용자</span><input value="${attr(actor)}" disabled></label>${field("무엇을 했나요? *", "action", "", "text", "예: 계약서 보관기간이 지나 파기함")}${field("왜 처리했나요?", "reason", "업무 수행")}</div><div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">취소</button><button class="primary-button">기록 저장</button></div></form>`;
    openModal();
  }

  function incidentEditor(incidentId) {
    const editing = store.securityIncidents.find(item => item.id === incidentId);
    const user = currentAuth.user || {};
    const reporter = editing && editing.reportedBy || user.displayName || user.email || store.settings.owner || "현재 사용자";
    const item = editing ? JSON.parse(JSON.stringify(editing)) : Core.createSecurityIncident({ reportedBy: reporter });
    modalContent.innerHTML = `<div class="modal-head"><div><h2>${editing ? "사고 처리 내용" : "보안 사고 보고"}</h2><p>키 분실·정보 유출·무단조회는 즉시 책임자에게 보고하세요.</p></div><button class="close-button" data-action="close-modal">×</button></div><form id="incidentForm" class="modal-body" data-incident-id="${attr(editing && editing.id || "")}"><div class="incident-alert-box"><b>긴급 조치</b><span>접근 권한을 우선 차단하고, 유출 범위와 관련자를 확인한 뒤 이 기록을 남기세요.</span></div><div class="form-grid">${selectField("사고 유형", "type", ["키 분실", "출입카드 분실", "개인정보 유출", "무단조회", "오발송", "반납 지연", "기타"], item.type)}${selectField("심각도", "severity", ["주의", "긴급"], item.severity)}${field("발생 일시", "occurredAt", datetimeValue(item.occurredAt), "datetime-local")}<label class="field"><span>보고자</span><input name="reportedBy" value="${attr(reporter)}" readonly></label>${field("보고 대상", "escalatedTo", item.escalatedTo)}${selectField("처리 상태", "status", ["보고됨", "조사중", "조치중", "종결", "무효"], item.status)}${areaField("사고 내용 *", "summary", item.summary, "wide")}${areaField("조치·재발방지 내용", "resolution", item.resolution, "wide")}</div><div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">취소</button><button class="danger-button">${editing ? "처리 내용 저장" : "즉시 보고"}</button></div></form>`;
    openModal();
  }

  function renderSettings() {
    const user = currentAuth.user || {};
    const canRestore = (!currentAuth.required && !currentAuth.enforceRoles) || user.role === "admin";
    main.innerHTML = `<div class="settings-grid">
      <section class="setting-card"><h3>로그인과 작업공간</h3><p>로그인한 회사 이메일의 이름이 담당자로 자동 기록됩니다.</p><form id="settingsForm"><div class="form-grid"><label class="field"><span>현재 사용자</span><input value="${attr(user.email || store.settings.owner || "로컬 사용자")}" disabled></label><label class="field"><span>회사·작업공간</span><input name="workspace" value="${attr(store.company.workspace || "원주 고객 영업관리")}"></label></div><div class="form-actions"><button class="primary-button" type="submit">설정 저장</button></div></form></section>
      <div class="panel-stack"><section class="setting-card"><h3>공용 데이터와 백업</h3><p>고객·상담·영업·업체 상담 정보는 회사 Firebase 서버에서 실시간 공유되고, 이 PC에는 복구용 캐시가 보관됩니다.</p><div class="info-box mono">${esc(dataPath || "로컬 캐시 위치 확인 중")}</div>${canRestore ? `<div class="inline-actions" style="margin-top:12px"><button class="secondary-button" data-action="backup">암호화 백업 저장</button><button class="secondary-button" data-action="restore">공용 데이터 복원</button></div>` : `<div class="info-box" style="margin-top:12px">백업 파일 저장과 복원은 개인정보 다운로드 권한이 있는 관리자만 사용할 수 있습니다.</div>`}</section><section class="setting-card"><h3>CRM과 업무흐름 연결 범위</h3><p>영업 관리와 실제 케이스 업무는 목적에 맞게 구분하되 같은 공용 자료로 연결합니다.</p><div class="info-box">고객정보·상담·영업·후속 연락과 케이스의 기본정보·17단계 진행·단계 메모를 모두 BRING CRM에서 관리합니다. 업무흐름빌더와 케이스 자료는 서로 동일하게 반영됩니다.</div></section></div>
    </div>`;
  }

  function customerEditor(customerId) {
    const editing = customerById(customerId);
    const customer = editing ? JSON.parse(JSON.stringify(editing)) : Core.createCustomer({ owner: store.settings.owner || "김현진" });
    const linkedBuildings = customerBuildings(customer);
    modalContent.innerHTML = `<div class="modal-head"><div><h2>${editing ? "고객 정보 수정" : "새 고객 등록"}</h2><p>먼저 필요한 내용만 입력하세요. 나머지는 나중에 추가해도 됩니다.</p></div><button class="close-button" data-action="close-modal">×</button></div><form id="customerForm" class="modal-body simple-customer-form" data-customer-id="${attr(editing && editing.id || "")}"><div class="essential-label"><b>기본 정보</b><span>이 화면만 입력해도 고객 등록이 완료됩니다.</span></div><div class="form-grid">
      ${field("고객명 *", "name", customer.name, "text", "예: 홍길동 또는 원주에셋")}
      <label class="field"><span>연락처</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" data-customer-phone value="${attr(customerPhoneText(customer.phone))}" placeholder="010-0000-0000"></label>
      ${selectField("고객 유형", "type", ["건물주", "임차인", "법인", "협력업체", "기타"], customer.type)}
      ${field("다음 연락일", "nextContactAt", datetimeValue(customer.nextContactAt), "datetime-local")}
      ${areaField("현재 어떤 요청이 있나요?", "currentIssue", customer.currentIssue, "wide")}
      ${areaField("개인 메모·고객 특징", "notes", customer.notes, "wide")}
      ${field("다음 할 일", "nextAction", customer.nextAction, "text", "예: 누수업체 비교견적 전달", "wide")}
    </div><details class="optional-form"><summary><b>고객 추가 정보</b><span>회사·이메일·금액 등을 입력하려면 펼치세요</span></summary><div class="form-grid optional-form-body">
      ${field("회사·상호", "company", customer.company)}${field("이메일", "email", customer.email, "email")}
      ${selectField("담당자", "owner", unique([store.settings.owner, "김현진", "서창환"]), customer.owner)}${selectField("알게 된 경로", "source", ["대표 상담", "소개", "홈페이지", "카카오채널", "전화", "기존 고객", "기타"], customer.source)}
      ${selectField("중요도", "priority", ["높음", "보통", "낮음"], customer.priority)}${field("예상 계약금액", "expectedValue", customer.expectedValue || "", "number", "원 단위")}
      ${field("관심 서비스", "interestServices", (customer.interestServices || []).join(", "), "text", "예: 건물관리, 누수 대응")}${field("태그", "tags", (customer.tags || []).join(", "), "text", "예: 원주, 다가구, 소개")}
      ${field("마지막 연락일", "lastContactAt", datetimeValue(customer.lastContactAt), "datetime-local")}
      <div class="info-box wide">진행상태는 고객 정보에서 직접 입력하지 않습니다. 연결된 건물의 영업 관리 단계가 고객 목록과 상세 화면에 자동으로 표시됩니다.</div>
    </div></details><div class="info-box">${linkedBuildings.length ? `연결된 건물 ${linkedBuildings.length}곳은 이 고객 화면에서 그대로 유지됩니다.` : "고객을 먼저 등록할 수 있습니다."} 건물 등록·수정은 건물 관리에서 현재 작업자를 선택한 뒤 진행해 주세요.</div><div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">취소</button><button type="submit" class="primary-button">${editing ? "수정 저장" : "고객 등록"}</button></div></form>`;
    openModal();
    setTimeout(() => document.querySelector('#customerForm [name="name"]')?.focus(), 30);
  }

  function buildingNumberField(label, name, value, suffix, placeholder) {
    const number = Number(value);
    const displayValue = Number.isFinite(number) && number > 0 ? Math.round(number) : "";
    return `<label class="field building-number-field"><span>${esc(label)}</span><div><input name="${attr(name)}" type="number" min="0" step="1" inputmode="numeric" value="${attr(displayValue)}" placeholder="${attr(placeholder || "숫자만 입력")}"><em>${esc(suffix || "")}</em></div></label>`;
  }

  function buildingChecklistField(label, name, options, selected, help, otherName, otherValue, otherPlaceholder) {
    const checked = new Set(buildingArray(selected));
    const other = String(otherValue || "").trim();
    return `<fieldset class="building-check-field wide"><legend>${esc(label)}</legend>${help ? `<p>${esc(help)}</p>` : ""}<div class="building-check-grid">${options.map(option => `<label><input type="checkbox" name="${attr(name)}" value="${attr(option)}" ${checked.has(option) || option === "기타" && !!other ? "checked" : ""}><span>${esc(option)}</span></label>`).join("")}</div>${otherName ? `<label class="building-other-field"><span>기타 설명</span><input name="${attr(otherName)}" value="${attr(other)}" placeholder="${attr(otherPlaceholder || "기타 내용을 입력하세요")}"></label>` : ""}</fieldset>`;
  }

  function buildingEditor(buildingId) {
    if (deferCanonicalMutation("건물")) return;
    const editing = buildingById(buildingId);
    const building = editing ? JSON.parse(JSON.stringify(editing)) : Core.createBuilding({ manager: store.settings.owner || "김현진" });
    const formalUnits = editing ? activeBuildingUnitsForBuilding(editing) : [];
    const formalVacantUnits = formalUnits.filter(unit => vacancyUnitStatus(unit) === "vacant");
    const formalUpcomingUnits = formalUnits.filter(unit => vacancyUnitStatus(unit) === "move_out_scheduled");
    const legacyMigration = editing ? vacancyLegacyMigrationState(editing) : null;
    const vacancyFields = formalUnits.length
      ? `<div class="building-derived-vacancy wide"><div><span>현재 공실</span><b>${formalVacantUnits.length.toLocaleString("ko-KR")}개</b><small>${esc(formalVacantUnits.map(unit => unit.label || unit.unitLabel).filter(Boolean).join(", ") || "없음")}</small></div><div><span>공실 예정</span><b>${formalUpcomingUnits.length.toLocaleString("ko-KR")}개</b><small>${esc(formalUpcomingUnits.map(unit => unit.label || unit.unitLabel).filter(Boolean).join(", ") || "없음")}</small></div><button type="button" class="secondary-button" data-vacancy-manage="${attr(editing.id)}">공실 현황에서 수정</button>${legacyMigration.unresolvedCount ? `<p class="building-derived-vacancy-warning" data-vacancy-legacy-resolution>기존 공실 ${legacyMigration.unresolvedCount.toLocaleString("ko-KR")}실은 실제 호실로 옮길 때까지 원본 값으로 보존됩니다. 다른 건물 정보는 그대로 저장할 수 있습니다.</p>` : ""}</div>`
      : `${buildingNumberField("공실 수", "vacantUnitCount", building.vacantUnitCount, "개", "예: 2")}${field("공실 호실", "vacantUnits", buildingArray(building.vacantUnits).join(", "), "text", "예: 101호, 203호", "wide")}`;
    const customerOptions = ["", ...store.customers.map(customer => customer.id)];
    const legacyAddress = editing && String(building.address || "").trim() && !String(building.roadAddress || "").trim() && !String(building.jibunAddress || "").trim()
      ? String(building.address).trim()
      : "";
    const legacyAddressNotice = legacyAddress
      ? `<div class="info-box wide">기존 주소 <b>${esc(legacyAddress)}</b>는 도로명·지번 구분 없이 그대로 보존됩니다. 네이버 링크로 불러오거나 주소 형식을 확인해 입력해 주세요.</div>`
      : "";
    const currentOwnerCustomerId = String(building.ownerCustomerId || "");
    const ownerOptionLabel = id => {
      if (!id) return "아직 연결하지 않음";
      const customer = customerById(id);
      return customer ? [customer.name || "이름 미입력", customer.company, customerPhoneText(customer.phone)].filter(Boolean).join(" · ") : id;
    };
    const ownerCustomerField = editing && currentOwnerCustomerId
      ? `<label class="field"><span>건물주·대표 고객</span><select disabled aria-disabled="true"><option>${esc(ownerOptionLabel(currentOwnerCustomerId))}</option></select><input type="hidden" name="ownerCustomerId" value="${attr(currentOwnerCustomerId)}"><small>이미 연결된 건물주를 바꾸거나 해제하려면 별도 이전 절차가 필요합니다.</small></label>`
      : `<label class="field"><span>건물주·대표 고객</span><select name="ownerCustomerId">${customerOptions.map(id => `<option value="${attr(id)}" ${id === currentOwnerCustomerId ? "selected" : ""}>${esc(ownerOptionLabel(id))}</option>`).join("")}</select><small>${editing ? (store.customers.length ? "연결할 고객을 선택하세요. 최초 연결 후 변경은 별도 이전 절차가 필요합니다." : "고객 관리에서 고객을 먼저 등록한 뒤 이 화면에서 연결하세요.") : "고객 관리에 등록된 고객을 건물주·대표 고객으로 연결합니다."}</small></label>`;
    modalContent.innerHTML = `<div class="modal-head"><div><h2>${editing ? "건물 정보 수정" : "새 건물 등록"}</h2><p>건물 고유 ID를 기준으로 고객·계약·케이스·입금 자료가 연결됩니다.</p></div><button class="close-button" data-action="close-modal">×</button></div><form id="buildingForm" class="modal-body building-form" data-building-id="${attr(editing && editing.id || "")}"><div class="info-box">같은 건물을 다시 등록하지 말고 기존 건물을 수정해 주세요. 건물명이 바뀌어도 연결된 업무는 유지됩니다.</div>
      <section class="quote-url-import building-link-import"><div><b>네이버 지도 링크로 자동 입력</b><span>장소 또는 주소 검색 링크에서 건물명·도로명·지번 주소를 찾아옵니다.</span></div><div class="quote-url-import-row"><input name="naverBuildingUrl" type="url" inputmode="url" autocomplete="off" maxlength="4096" placeholder="https://naver.me/... 또는 https://map.naver.com/..."><button type="button" data-building-link-lookup>건물 정보 불러오기</button></div><p data-building-link-lookup-status aria-live="polite">불러온 내용을 확인한 뒤 아래 건물 등록 버튼을 눌러 저장하세요.</p></section>
      <section class="building-form-section"><header><div><h3>기본 정보</h3><p>건물과 담당 고객을 구분하는 공용 정보입니다.</p></div></header><div class="form-grid building-form-section-body">
        ${field("건물명 *", "name", building.name, "text", "예: 햇빛빌라")}
        ${ownerCustomerField}
        ${selectField("건물 유형", "type", ["다가구", "원룸", "상가", "아파트", "빌딩", "오피스텔", "기타"], building.type || "다가구")}
        ${selectField("운영 상태", "status", ["영업후보", "현장방문", "견적중", "계약예정", "관리중", "보류"], building.status || "영업후보")}
        ${legacyAddressNotice}
        ${field("도로명 주소", "roadAddress", building.roadAddress, "text", "예: 강원특별자치도 원주시 중앙로 1", "wide")}
        ${field("지번 주소", "jibunAddress", building.jibunAddress, "text", "예: 강원특별자치도 원주시 중앙동 1-1", "wide")}
        ${field("전체 호실 수", "unitCount", building.unitCount || "", "number", "숫자만 입력")}
        ${field("담당자", "manager", building.manager || store.settings.owner || "김현진")}
      </div></section>
      <section class="building-form-section building-rental-form-section"><header><div><h3>임대·공실 정보</h3><p>대표 임대 조건과 현재 확인된 공실을 입력하세요.</p></div><span>금액은 원 단위</span></header><div class="form-grid building-form-section-body">
        ${buildingNumberField("보증금", "rentDeposit", building.rentDeposit, "원", "예: 3000000")}
        ${buildingNumberField("월세", "monthlyRent", building.monthlyRent, "원", "예: 330000")}
        ${buildingNumberField("관리비", "maintenanceFee", building.maintenanceFee, "원", "예: 50000")}
        ${vacancyFields}
        ${buildingChecklistField("관리비 포함 항목", "maintenanceIncludes", BUILDING_MAINTENANCE_ITEMS, building.maintenanceIncludes, "관리비에 포함되는 항목을 모두 선택하세요.", "maintenanceIncludeOther", building.maintenanceIncludeOther, "예: 승강기 유지비, 복도 청소")}
        ${buildingChecklistField("호실 구조", "roomTypes", BUILDING_ROOM_LAYOUTS, building.roomTypes, "건물에 있는 구조를 모두 선택하세요.", "roomTypeOther", building.roomTypeOther, "예: 복층, 쓰리룸")}
      </div></section>
      <section class="building-form-section building-options-form-section"><header><div><h3>호실 옵션</h3><p>세입자에게 제공되는 기본 옵션을 모두 선택하세요.</p></div></header><div class="form-grid building-form-section-body">
        ${buildingChecklistField("제공 옵션", "roomOptions", BUILDING_ROOM_OPTIONS, building.roomOptions, "선택한 내용은 건물 상세에서 한눈에 확인할 수 있습니다.", "roomOptionOther", building.roomOptionOther, "예: 건조기, 인덕션")}
      </div></section>
      <section class="building-form-section"><header><div><h3>관리 메모</h3><p>건물 운영 시 함께 확인할 내용을 적어 주세요.</p></div></header><div class="form-grid building-form-section-body">${areaField("건물 메모", "memo", building.memo, "wide")}</div></section>
      <div class="form-actions">${editing ? `<button type="button" class="danger-outline-button form-delete-left" data-building-delete="${attr(editing.id)}">건물 보관</button>` : ""}<button type="button" class="secondary-button" data-action="close-modal">취소</button><button type="submit" class="primary-button">${editing ? "수정 저장" : "건물 등록"}</button></div></form>`;
    openModal();
    setTimeout(() => document.querySelector(`#buildingForm [name="${editing ? "name" : "naverBuildingUrl"}"]`)?.focus(), 30);
  }

  function updateVacancyScheduleGuide(form) {
    const dateInput = form?.elements?.availableFrom;
    const guide = form?.querySelector(".vacancy-date-guide");
    if (!dateInput || !guide) return;
    const pastDue = /^\d{4}-\d{2}-\d{2}$/.test(dateInput.value || "") && dateInput.value < todayKey();
    guide.classList.toggle("warning", pastDue);
    guide.textContent = pastDue
      ? "입력한 예정일이 지났습니다. 저장 후 실제 공실 여부를 확인해 주세요. 날짜가 지났다고 자동으로 공실 처리하지 않습니다."
      : "공실 예정일을 입력해야 저장할 수 있습니다. 날짜가 되어도 상태는 자동으로 바뀌지 않습니다.";
  }

  function vacancyScheduleEditor(buildingId, unitId) {
    if (deferCanonicalMutation("공실 예정")) return;
    const building = buildingById(buildingId);
    const item = (store.buildingUnits || []).find(unit => unit && !unit.archivedAt && unit.id === unitId
      && String(unit.crmBuildingId || unit.buildingId || "") === String(buildingId));
    if (!building || building.archivedAt || !item) return showToast("호실을 찾지 못했습니다.", "error");
    if (!Number.isInteger(item.entityVersion) || item.entityVersion < 1) return showToast("최신 호실 버전을 확인한 뒤 다시 시도해 주세요.", "error");
    const label = item.label || item.unitLabel || "호실명 미입력";
    const availableFrom = String(item.availableFrom || item.moveOutAt || "").slice(0, 10);
    modalContent.innerHTML = `<div class="modal-head"><div><h2>공실 예정 등록</h2><p>${esc(building.name || "건물")} · ${esc(label)}</p></div><button class="close-button" data-action="close-modal">×</button></div><form id="vacancyScheduleForm" class="modal-body vacancy-schedule-form" data-building-id="${attr(building.id)}" data-unit-id="${attr(item.id)}" data-expected-version="${attr(item.entityVersion)}"><div class="vacancy-schedule-unit"><span>변경할 호실</span><strong>${esc(label)}</strong><small>${esc(inferredVacancyFloorLabel(item))} · 현재 ${esc(VACANCY_STATUS_LABELS[vacancyUnitStatus(item)])}</small></div><div class="form-grid">${field("공실 예정일 *", "availableFrom", availableFrom, "date")}${areaField("메모 (선택)", "memo", item.memo || "", "wide")}<div class="info-box wide vacancy-date-guide">공실 예정일을 입력해야 저장할 수 있습니다. 날짜가 되어도 상태는 자동으로 바뀌지 않습니다.</div></div><div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">취소</button><button type="submit" class="primary-button">공실 예정 저장</button></div></form>`;
    openModal();
    const form = document.getElementById("vacancyScheduleForm");
    form._vacancyOriginalMemo = String(item.memo || "");
    form.elements.availableFrom.required = true;
    updateVacancyScheduleGuide(form);
    setTimeout(() => form.elements.availableFrom?.focus(), 30);
  }

  async function saveVacancyQuickStatus(buildingId, unitId, nextStatus, sourceSelect) {
    const building = buildingById(buildingId);
    const item = (store.buildingUnits || []).find(unit => unit && !unit.archivedAt && unit.id === unitId
      && String(unit.crmBuildingId || unit.buildingId || "") === String(buildingId));
    if (!building || building.archivedAt || !item) {
      if (sourceSelect) sourceSelect.value = sourceSelect.dataset.currentStatus || "unknown";
      return showToast("호실을 찾지 못했습니다.", "error");
    }
    const previousStatus = vacancyUnitStatus(item);
    if (nextStatus === previousStatus) return;
    if (nextStatus === "move_out_scheduled") {
      if (sourceSelect) sourceSelect.value = previousStatus;
      vacancyScheduleEditor(buildingId, unitId);
      return;
    }
    if (!["unknown", "occupied", "vacant", "maintenance"].includes(nextStatus)) {
      if (sourceSelect) sourceSelect.value = previousStatus;
      return showToast("올바른 호실 상태를 선택해 주세요.", "error");
    }
    if (vacancyUnitSaveLocks.has(unitId)) {
      if (sourceSelect) sourceSelect.value = previousStatus;
      return;
    }
    if (deferCanonicalMutation("호실 상태")) {
      if (sourceSelect) sourceSelect.value = previousStatus;
      return;
    }
    if (!Number.isInteger(item.entityVersion) || item.entityVersion < 1) {
      if (sourceSelect) sourceSelect.value = previousStatus;
      return showToast("최신 호실 버전을 확인한 뒤 다시 시도해 주세요.", "error");
    }
    vacancyUnitSaveLocks.add(unitId);
    if (sourceSelect) {
      sourceSelect.disabled = true;
      sourceSelect.setAttribute("aria-busy", "true");
      sourceSelect.closest(".vacancy-unit-card")?.classList.add("saving");
    }
    try {
      await commitCanonicalEntity({
        entityType: "buildingUnits",
        entityId: item.id,
        operation: "update",
        expectedVersion: item.entityVersion,
        patch: { status: nextStatus, moveOutAt: "", availableFrom: "" },
        reason: `CRM 공실 현황 빠른 상태 변경: ${VACANCY_STATUS_LABELS[previousStatus]} → ${VACANCY_STATUS_LABELS[nextStatus]}`,
      });
      selectedVacancyBuildingId = building.id;
      showToast(`${item.label || item.unitLabel || "호실"}: ${VACANCY_STATUS_LABELS[previousStatus]} → ${VACANCY_STATUS_LABELS[nextStatus]}`, "success");
    } catch (error) {
      await refreshRendererOverlays(false).catch(() => undefined);
      showToast(isVacancyConfigurationConflict(error) ? "다른 컴퓨터에서 이 호실을 먼저 변경했습니다. 최신 상태를 반영했습니다." : (error.message || "호실 상태를 저장하지 못했습니다."), "error");
    } finally {
      vacancyUnitSaveLocks.delete(unitId);
      if (currentView === "vacancies") {
        renderVacancies();
        pageMeta();
      }
    }
  }

  function fieldReauthenticationMessage(code) {
    if (code === "FIELD_REAUTH_CANCELLED") return "Google 계정 확인을 취소했습니다. 현장 업무를 사용하려면 다시 연결해 주세요.";
    if (code === "FIELD_REAUTH_ACCOUNT_MISMATCH") return "현재 CRM 계정과 같은 Google 계정을 선택해 주세요.";
    if (code === "FIELD_REAUTH_SESSION_CHANGED") return "CRM 로그인 상태가 변경되었습니다. 현재 계정을 확인한 뒤 다시 시도해 주세요.";
    if (code === "FIELD_REAUTH_FAILED") return "Google 계정을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
    return "Google 계정을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }

  function buildingUnitEditor(buildingId, unitId) {
    if (deferCanonicalMutation("건물 호실")) return;
    const building = buildingById(buildingId);
    if (!building) return showToast("건물을 찾지 못했습니다.", "error");
    const item = (store.buildingUnits || []).find(unit => unit && unit.id === unitId && String(unit.crmBuildingId || unit.buildingId || "") === String(building.id)) || {};
    const floorLabel = inferredVacancyFloorLabel(item);
    const availableFrom = String(item.availableFrom || item.moveOutAt || "").slice(0, 10);
    const dateWarning = vacancyUnitStatus(item) === "move_out_scheduled" && availableFrom && availableFrom < todayKey();
    modalContent.innerHTML = `<div class="modal-head"><div><h2>${item.id ? "건물 호실 수정" : "건물 호실 등록"}</h2><p>${esc(building.name || "건물")}에 속한 실제 호실을 관리합니다.</p></div><button class="close-button" data-action="close-modal">×</button></div><form id="buildingUnitForm" class="modal-body" data-building-id="${attr(building.id)}" data-building-unit-id="${attr(item.id || "")}" data-return-view="${attr(currentView === "vacancies" ? "vacancies" : "buildings")}"><div class="form-grid">
      ${field("호실명 *", "label", item.label || item.unitLabel || "", "text", "예: 201호")}
      ${field("층명 *", "floorLabel", floorLabel === "층 미확인" ? "" : floorLabel, "text", "예: 2층, B1")}
      ${field("층 정렬 순서", "floorOrder", vacancyFloorOrder(item, floorLabel), "number", "지하층은 음수")}
      ${field("층 내 순서", "unitOrder", vacancyUnitOrder(item) === 999999 ? "" : vacancyUnitOrder(item), "number", "예: 1")}
      ${selectField("호실 상태", "status", ["unknown", "occupied", "vacant", "move_out_scheduled", "maintenance"], item.status || "unknown", value => ({ unknown: "확인 필요", occupied: "입주 중", vacant: "공실", move_out_scheduled: "공실 예정", maintenance: "정비 중" })[value] || value)}
      ${field("공실 예정일", "availableFrom", availableFrom, "date")}
      <div class="info-box wide vacancy-date-guide ${dateWarning ? "warning" : ""}">${dateWarning ? "공실 예정일이 지났습니다. 실제 상태를 확인해 주세요. 날짜가 지났다고 자동으로 공실 처리하지 않습니다." : "공실 예정 상태를 선택하면 공실 예정일을 반드시 입력해 주세요."}</div>
      ${areaField("호실 메모", "memo", item.memo || "", "wide")}
    </div><div class="form-actions">${item.id ? `<button type="button" class="danger-outline-button form-delete-left" data-building-unit-archive="${attr(item.id)}" data-building-id="${attr(building.id)}">호실 보관</button>` : ""}<button type="button" class="secondary-button" data-action="close-modal">취소</button><button type="submit" class="primary-button">${item.id ? "호실 저장" : "호실 등록"}</button></div></form>`;
    openModal();
    const availableFromInput = document.querySelector('#buildingUnitForm [name="availableFrom"]');
    if (availableFromInput) availableFromInput.required = vacancyUnitStatus(item) === "move_out_scheduled";
    setTimeout(() => document.querySelector('#buildingUnitForm [name="label"]')?.focus(), 30);
  }

  function contractTypeChecklist(selectedTypes) {
    const selected = new Set(Core.normalizeContractTypes(selectedTypes));
    return `<div class="field contract-type-field"><span>계약 유형 *</span><div class="contract-type-checklist">${Core.CONTRACT_TYPES.map(type => `<label><input type="checkbox" name="types" value="${attr(type)}" ${selected.has(type) ? "checked" : ""}><span>${esc(type)}</span></label>`).join("")}</div></div>`;
  }

  function contractBuildingField(customerId, buildingId) {
    const customer = customerById(customerId);
    const buildings = customerBuildings(customer);
    const current = buildingById(buildingId);
    const currentIsLegacyLink = Boolean(current && !buildings.some(building => building.id === current.id));
    if (currentIsLegacyLink) buildings.push(current);
    const selectedId = buildings.some(building => building.id === buildingId) ? buildingId : (buildings[0]?.id || "");
    const help = !customer ? "고객을 선택하면 연결된 건물이 표시됩니다." : currentIsLegacyLink ? "현재 계약 건물이 고객의 연결 목록에 없어 함께 표시했습니다." : buildings.length ? (buildings.length === 1 ? "연결된 건물이 자동 선택되었습니다." : `${buildings.length}개 연결 건물 중 첫 건물이 자동 선택됩니다.`) : "선택한 고객에게 연결된 건물이 없습니다.";
    return `<label class="field contract-building-field"><span>연결 건물 *</span><select name="buildingId" data-contract-building-select ${buildings.length ? "" : "disabled"}>${buildings.length ? buildings.map(building => `<option value="${attr(building.id)}" ${building.id === selectedId ? "selected" : ""}>${esc(buildingChoiceLabel(building))}</option>`).join("") : `<option value="">연결된 건물 없음</option>`}</select><small data-contract-building-help>${esc(help)}</small></label>`;
  }

  function refreshContractTypeFields(form) {
    if (!form) return [];
    const types = [...form.querySelectorAll('input[name="types"]:checked')].map(input => input.value).filter(type => Core.CONTRACT_TYPES.includes(type));
    const fields = form.querySelector("[data-contract-fields]");
    if (fields) fields.dataset.contractFields = types.join("|");
    form.querySelectorAll("[data-contract-specific]").forEach(section => section.classList.toggle("is-selected", types.includes(section.dataset.contractSpecific)));
    return types;
  }

  function refreshContractBuildings(form) {
    if (!form) return "";
    const customer = customerById(form.elements.customerId?.value);
    const buildings = customerBuildings(customer);
    const select = form.querySelector("[data-contract-building-select]");
    const help = form.querySelector("[data-contract-building-help]");
    if (!select) return "";
    select.innerHTML = buildings.length ? buildings.map((building, index) => `<option value="${attr(building.id)}" ${index === 0 ? "selected" : ""}>${esc(buildingChoiceLabel(building))}</option>`).join("") : `<option value="">연결된 건물 없음</option>`;
    select.disabled = !buildings.length;
    if (help) help.textContent = !customer ? "고객을 선택하면 연결된 건물이 표시됩니다." : buildings.length === 1 ? "연결된 건물이 자동 선택되었습니다." : buildings.length > 1 ? `${buildings.length}개 연결 건물 중 첫 건물을 자동 선택했습니다. 필요하면 변경하세요.` : "선택한 고객에게 연결된 건물이 없습니다. 고객 관리에서 건물을 먼저 연결해 주세요.";
    return buildings[0]?.id || "";
  }

  function contractEditor(contractId, oneOff = false) {
    const editing = store.contracts.find(item => item.id === contractId);
    const item = editing ? JSON.parse(JSON.stringify(editing)) : Core.createContract({ owner: store.settings.owner || "김현진", billingCycle: oneOff ? "건별" : "월 정기", startDate: oneOff ? todayKey() : Core.dayKey(), workDate: oneOff ? todayKey() : "", paymentDueDate: oneOff ? todayKey() : "" });
    const types = contractTypes(item);
    const customerOptions = ["", ...store.customers.map(customer => customer.id)];
    modalContent.innerHTML = `<div class="modal-head"><div><h2>${editing ? "계약 상세·수정" : "새 계약 등록"}</h2><p>필요한 계약 유형을 모두 체크하고 고객을 선택하세요.</p></div><button class="close-button" data-action="close-modal">×</button></div><form id="contractForm" class="modal-body contract-form" data-contract-id="${attr(editing && editing.id || "")}">
      <div class="contract-form-guide"><div><b>${esc(item.contractNo || "새 계약")}</b><span>계약 조건·기간·금액을 실제 계약 내용과 동일하게 입력하세요.</span></div><span>공용 서버에 저장</span></div>
      <div class="form-grid">${contractTypeChecklist(types)}${selectField("계약 상태", "status", Core.CONTRACT_STATUSES, item.status)}${field("계약명 *", "name", item.name, "text", "예: 혁신타워 종합관리", "wide")}${selectField("연결 고객 *", "customerId", customerOptions, item.customerId, id => id ? (customerById(id)?.name || id) : "고객 선택")}${contractBuildingField(item.customerId, item.buildingId)}${field("계약 시작일 *", "startDate", item.startDate, "date")}${field("계약 종료일 (선택)", "endDate", item.endDate, "date")}${field("계약 금액", "amount", item.amount || "", "number", "원 단위")}${selectField("납부 방식", "billingCycle", ["월 정기", "건별", "연간", "기타"], item.billingCycle)}${field("담당자", "owner", item.owner || store.settings.owner || "김현진")}${areaField("공통 업무 범위", "scope", item.scope, "wide")}</div>
      <section class="contract-type-fields one-off-contract-fields"><header><b>단건 계약 정산</b><span>납부 방식을 건별로 선택하면 입금 캘린더에 표시됩니다.</span></header><div class="form-grid">${field("작업일", "workDate", item.workDate || item.startDate, "date")}${field("입금 예정일", "paymentDueDate", item.paymentDueDate || item.workDate || item.startDate, "date")}${field("업체 지급액·작업비", "vendorCost", item.vendorCost || "", "number", "원 단위")}${selectField("고객 입금 상태", "collectionStatus", ["입금 예정", "입금 완료"], item.collectionStatus || "입금 예정")}${selectField("업체 지급 상태", "vendorPaymentStatus", ["지급 예정", "지급 완료"], item.vendorPaymentStatus || "지급 예정")}<label class="field"><span>예상 수익</span><input value="${attr(krw(Core.money(item.amount) - Core.money(item.vendorCost)))}" readonly></label></div></section>
      <section class="contract-type-fields" data-contract-fields="${attr(types.join("|"))}"><header><b>유형별 계약 내용</b><span>체크한 모든 계약 유형의 입력 항목이 표시됩니다.</span></header><div class="contract-specific-fields ${types.includes("청소") ? "is-selected" : ""}" data-contract-specific="청소">${field("청소 주기·작업 시점", "serviceFrequency", item.serviceFrequency, "text", "예: 주 2회 또는 공실 발생 시", "wide")}</div><div class="contract-specific-fields ${types.includes("건물관리") ? "is-selected" : ""}" data-contract-specific="건물관리">${field("관리 호실 수", "unitCount", item.unitCount || "", "number", "숫자 입력")}</div><div class="contract-specific-fields ${types.includes("부동산관리") ? "is-selected" : ""}" data-contract-specific="부동산관리">${field("관리 대상", "managementTarget", item.managementTarget, "text", "예: 상가·사무실 임대관리")}${field("수수료 방식", "feeMethod", item.feeMethod, "text", "예: 월 고정 또는 임대료 비율")}</div></section>
      <div class="form-grid contract-note-grid">${areaField("계약 메모", "memo", item.memo, "wide")}</div><div class="form-actions">${editing ? `<button type="button" class="danger-outline-button form-delete-left" data-contract-delete="${attr(editing.id)}">계약 삭제</button>` : ""}<button type="button" class="secondary-button" data-action="close-modal">취소</button><button type="submit" class="primary-button">${editing ? "계약 수정 저장" : "계약 등록"}</button></div></form>`;
    openModal();
    setTimeout(() => document.querySelector('#contractForm [name="name"]')?.focus(), 30);
  }

  function industryChecklistFields(industry, checked) {
    if (!industry) return `<section id="partnerIndustryChecklist" class="industry-checklist" data-industry=""><header><div><b>업종별 상담 체크리스트</b><span>업종을 선택하면 통화 중 확인할 항목이 표시됩니다.</span></div><em>선택 전</em></header></section>`;
    const rows = INDUSTRY_CHECKLISTS[industry] || INDUSTRY_CHECKLISTS["기타"];
    const values = checked && typeof checked === "object" ? checked : {};
    return `<section id="partnerIndustryChecklist" class="industry-checklist" data-industry="${attr(industry)}"><header><div><b>${esc(industry)} 상담 체크리스트</b><span>통화하면서 확인한 항목을 바로 체크하세요.</span></div><em>${rows.length}개 항목</em></header><div>${rows.map(([key, label]) => `<label><input type="checkbox" name="check__${attr(key)}" ${values[key] === true ? "checked" : ""}><span>${esc(label)}</span></label>`).join("")}</div></section>`;
  }

  function partnerVendorEditor(vendorId) {
    const editing = partnerVendorById(vendorId);
    const item = editing ? JSON.parse(JSON.stringify(editing)) : newPartnerVendor({ industry: "누수", region: "원주" });
    modalContent.innerHTML = `<div class="modal-head"><div><h2>${editing ? "연락 업체 수정" : "연락 업체 등록"}</h2><p>업체 링크에서 공개된 기본정보를 불러온 뒤 내용을 확인해 저장하세요.</p></div><button class="close-button" data-action="close-modal">×</button></div><form id="partnerVendorForm" class="modal-body partner-vendor-form" data-partner-vendor-id="${attr(editing && editing.id || "")}"><section class="quote-url-import"><div><b>업체 링크로 자동 입력</b><span>업체 홈페이지·지도·소개 페이지 주소를 붙여 넣으세요.</span></div><div class="quote-url-import-row"><input name="quoteUrl" type="url" value="${attr(item.quoteUrl || "")}" placeholder="https://..."><button type="button" data-vendor-lookup>업체 정보 불러오기</button></div><p data-vendor-lookup-status aria-live="polite">업체명·연락처·업종·작업 내용을 찾아 입력합니다.</p></section><input type="hidden" name="phoneLabel" value="${attr(item.phoneLabel || "")}"><input type="hidden" name="alternatePhoneLabel" value="${attr(item.alternatePhoneLabel || "")}"><div class="essential-label"><b>업체 기본정보</b><span>자동 입력된 내용이 맞는지 확인하고 부족한 정보는 직접 입력하세요.</span></div><div class="form-grid">
      ${field("업체명 *", "vendor", partnerVendorName(item), "text", "예: 달인누수탐지")}
      ${selectField("업종 *", "industry", Core.PARTNER_INDUSTRIES, partnerIndustry(item))}
      <label class="field"><span>업체 연락처</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" data-partner-vendor-phone value="${attr(customerPhoneText(item.phone))}" placeholder="010-0000-0000"></label>
      <label class="field"><span>추가 연락처</span><input name="alternatePhone" type="tel" inputmode="tel" autocomplete="tel" data-partner-vendor-phone value="${attr(customerPhoneText(item.alternatePhone))}" placeholder="두 번째 번호가 있을 때"></label>
      ${field("작업 내용", "service", item.service || item.category || "", "text", "예: 누수 탐지·배관 보수", "wide")}
      ${field("지역", "region", item.region || "원주", "text", "예: 원주")}
      ${areaField("업체 메모", "memo", item.memo, "wide")}
    </div><div class="form-actions">${editing ? `<button type="button" class="danger-outline-button form-delete-left" data-partner-vendor-delete="${attr(editing.id)}">업체 제외</button>` : ""}<button type="button" class="secondary-button" data-action="close-modal">취소</button><button type="submit" class="primary-button">${editing ? "업체 정보 수정 저장" : "연락 업체 저장"}</button></div></form>`;
    openModal();
    setTimeout(() => document.querySelector('#partnerVendorForm [name="quoteUrl"]')?.focus(), 30);
  }

  function refreshPartnerQuoteVendorSummary(form, applyVendorDefaults) {
    if (!form) return null;
    const vendor = partnerVendorById(form.elements.vendorId && form.elements.vendorId.value);
    const summary = form.querySelector("[data-partner-vendor-summary]");
    if (summary) summary.innerHTML = partnerVendorSummaryMarkup(vendor, form.dataset.legacyVendor ? `기존 기록 업체: ${form.dataset.legacyVendor}` : "연락 업체에서 업체를 먼저 등록할 수 있습니다.");
    if (!vendor) return null;
    const values = { vendor: partnerVendorName(vendor), phone: vendor.phone, phoneLabel: vendor.phoneLabel, alternatePhone: vendor.alternatePhone, alternatePhoneLabel: vendor.alternatePhoneLabel, quoteUrl: vendor.quoteUrl, service: vendor.service || vendor.category, region: vendor.region };
    Object.entries(values).forEach(([name, value]) => { if (form.elements[name]) form.elements[name].value = value || ""; });
    if (applyVendorDefaults && vendor.industry && form.elements.industry) {
      form.elements.industry.value = vendor.industry;
      form.elements.industry.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return vendor;
  }

  const CONSULTATION_CUSTOMER_TYPES = Object.freeze(["건물주", "임차인", "법인", "협력업체", "기타"]);

  function partnerVendorPickerSearchText(vendor) {
    return Core.normalizeText([
      partnerVendorName(vendor), vendor && vendor.phone, vendor && vendor.alternatePhone,
      customerPhoneText(vendor && vendor.phone), customerPhoneText(vendor && vendor.alternatePhone),
      Core.normalizePhone(vendor && vendor.phone), Core.normalizePhone(vendor && vendor.alternatePhone),
      vendor && vendor.region, vendor && (vendor.service || vendor.category), partnerIndustry(vendor)
    ].filter(Boolean).join(" "));
  }

  function partnerVendorPickerRows(form) {
    const industry = String(form && form.elements.industry && form.elements.industry.value || "");
    const selectedId = String(form && form.elements.vendorId && form.elements.vendorId.value || "");
    const query = Core.normalizeText(form && form.querySelector("[data-partner-vendor-search]")?.value || "");
    if (!industry) return [];
    return partnerVendorRows().filter(vendor => {
      const selected = String(vendor.id) === selectedId;
      const industryMatch = partnerIndustry(vendor) === industry;
      const searchMatch = !query || partnerVendorPickerSearchText(vendor).includes(query);
      return query ? industryMatch && searchMatch : industryMatch || selected;
    }).sort((a, b) => {
      if (String(a.id) === selectedId) return -1;
      if (String(b.id) === selectedId) return 1;
      return partnerVendorName(a).localeCompare(partnerVendorName(b), "ko");
    });
  }

  function renderPartnerVendorPicker(form) {
    if (!form) return;
    const industry = String(form.elements.industry && form.elements.industry.value || "");
    const selectedId = String(form.elements.vendorId && form.elements.vendorId.value || "");
    const search = form.querySelector("[data-partner-vendor-search]");
    const count = form.querySelector("[data-partner-vendor-count]");
    const results = form.querySelector("[data-partner-vendor-options]");
    if (search) search.disabled = !industry;
    if (!results) return;
    if (!industry) {
      if (count) count.textContent = "업종을 먼저 선택해 주세요";
      results.innerHTML = `<div class="entity-picker-empty"><b>1단계에서 업종을 선택하세요</b><span>선택한 업종의 연락 업체만 표시됩니다.</span></div>`;
      return;
    }
    const rows = partnerVendorPickerRows(form);
    const matchingCount = partnerVendorRows().filter(vendor => partnerIndustry(vendor) === industry).length;
    if (count) count.textContent = `${industry} 업체 ${matchingCount.toLocaleString("ko-KR")}개${search && search.value.trim() ? ` · 검색 결과 ${rows.filter(vendor => partnerIndustry(vendor) === industry).length}개` : ""}`;
    results.innerHTML = rows.length ? rows.map(vendor => {
      const selected = String(vendor.id) === selectedId;
      const currentIndustry = partnerIndustry(vendor);
      const meta = [partnerPhoneText(vendor), vendor.region, vendor.service || vendor.category].filter(Boolean).join(" · ");
      const note = currentIndustry === industry ? currentIndustry : `기존 연결 · 현재 업종 ${currentIndustry}`;
      return `<button type="button" tabindex="-1" class="entity-picker-option ${selected ? "selected" : ""}" data-partner-vendor-option="${attr(vendor.id)}" aria-pressed="${selected ? "true" : "false"}"><span class="entity-picker-option-main"><b>${esc(partnerVendorName(vendor) || "업체명 미입력")}</b><small>${esc(note)}</small></span><span class="entity-picker-option-meta">${esc(meta || "추가 정보 미입력")}</span></button>`;
    }).join("") : `<div class="entity-picker-empty"><b>조건에 맞는 연락 업체가 없습니다</b><span>검색어를 지우거나 연락 업체에서 새 업체를 등록해 주세요.</span></div>`;
  }

  function setupPartnerVendorPicker(form, initialIndustry, initialChecklist) {
    if (!form || form.querySelector("[data-partner-vendor-options]")) return;
    const vendorSelect = form.elements.vendorId;
    const industrySelect = form.elements.industry;
    const host = form.querySelector(".partner-quote-vendor-picker");
    if (!vendorSelect || !industrySelect || !host) return;
    form._partnerChecklistDrafts = initialIndustry ? { [initialIndustry]: Object.assign({}, initialChecklist || {}) } : {};
    if (!industrySelect.querySelector('option[value=""]')) {
      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "업종을 선택하세요";
      industrySelect.prepend(emptyOption);
    }
    if (initialIndustry && ![...industrySelect.options].some(option => option.value === initialIndustry)) {
      const legacyOption = document.createElement("option");
      legacyOption.value = initialIndustry;
      legacyOption.textContent = initialIndustry;
      industrySelect.appendChild(legacyOption);
    }
    unique(partnerVendorRows().map(partnerIndustry)).forEach(industry => {
      if (!industry || [...industrySelect.options].some(option => option.value === industry)) return;
      const option = document.createElement("option");
      option.value = industry;
      option.textContent = industry;
      industrySelect.appendChild(option);
    });
    industrySelect.value = initialIndustry || "";
    const selectedId = vendorSelect.value;
    const vendorField = vendorSelect.closest(".field");
    const vendorGrid = vendorField && vendorField.closest(".form-grid");
    const industryField = industrySelect.closest(".field");
    const summary = host.querySelector("[data-partner-vendor-summary]");
    const picker = document.createElement("div");
    picker.className = "entity-picker";
    picker.innerHTML = `<div class="entity-picker-steps"><section class="entity-picker-step"><div class="entity-picker-step-label"><b>1. 업종 선택</b><span>먼저 상담할 업종을 고르세요.</span></div><div data-partner-industry-field></div></section><section class="entity-picker-step"><div class="entity-picker-step-label"><b>2. 연락 업체 선택</b><span>업체명·연락처·지역·작업내용으로 검색할 수 있습니다.</span></div><label class="field"><span>업체 검색</span><input class="entity-picker-search" type="search" data-partner-vendor-search placeholder="업체명·연락처·지역 검색" autocomplete="off"></label><div class="entity-picker-count" data-partner-vendor-count aria-live="polite"></div><div class="entity-picker-results" data-partner-vendor-options role="group" aria-label="연락 업체 검색 결과"></div></section></div><input type="hidden" name="vendorId" value="${attr(selectedId)}">`;
    picker.querySelector("[data-partner-industry-field]").appendChild(industryField);
    if (vendorGrid) vendorGrid.remove();
    host.insertBefore(picker, summary || host.firstChild);
    renderPartnerVendorPicker(form);
  }

  function customerPickerSearchText(customer) {
    const buildings = customerBuildings(customer);
    return Core.normalizeText([
      customer && customer.name, customer && customer.company, customer && customer.phone,
      Core.normalizePhone(customer && customer.phone),
      customer && customer.email, customer && customer.type,
      ...(Array.isArray(customer && customer.tags) ? customer.tags : []),
      ...buildings.flatMap(building => [building.name, building.address])
    ].filter(Boolean).join(" "));
  }

  function consultationCustomerPickerRows(form) {
    const type = String(form && form.elements.customerType && form.elements.customerType.value || "");
    const selectedId = String(form && form.elements.customerId && form.elements.customerId.value || "");
    const query = Core.normalizeText(form && form.querySelector("[data-consultation-customer-search]")?.value || "");
    if (!type) return [];
    return store.customers.filter(customer => {
      const selected = String(customer.id) === selectedId;
      const typeMatch = String(customer.type || "기타") === type;
      const searchMatch = !query || customerPickerSearchText(customer).includes(query);
      return query ? typeMatch && searchMatch : typeMatch || selected;
    }).sort((a, b) => {
      if (String(a.id) === selectedId) return -1;
      if (String(b.id) === selectedId) return 1;
      return String(a.name || "").localeCompare(String(b.name || ""), "ko");
    });
  }

  function customerPickerSummaryMarkup(customer) {
    if (!customer) return `<div class="entity-picker-empty"><b>고객을 선택해 주세요</b><span>선택 후 상담 내용을 입력할 수 있습니다.</span></div>`;
    const buildings = customerBuildings(customer);
    const buildingText = buildings.map(building => buildingChoiceLabel(building)).join(" · ");
    return `<div class="partner-vendor-summary customer-picker-summary"><div><span>선택 고객</span><h3>${esc(customer.name || "이름 미입력")}</h3><p>${esc([customer.type || "기타", customer.company, customerPhoneText(customer.phone)].filter(Boolean).join(" · ") || "연락처 미입력")}</p></div><div><span>연결 건물</span><b>${esc(buildings.length ? `${buildings.length}곳` : "미연결")}</b><small>${esc(buildingText || "연결 건물 없음")}</small></div></div>`;
  }

  function renderConsultationCustomerPicker(form) {
    if (!form) return;
    const type = String(form.elements.customerType && form.elements.customerType.value || "");
    const selectedId = String(form.elements.customerId && form.elements.customerId.value || "");
    const search = form.querySelector("[data-consultation-customer-search]");
    const count = form.querySelector("[data-consultation-customer-count]");
    const results = form.querySelector("[data-consultation-customer-options]");
    const summary = form.querySelector("[data-consultation-customer-summary]");
    if (search) search.disabled = !type;
    if (!results) return;
    if (!type) {
      if (count) count.textContent = "고객 유형을 먼저 선택해 주세요";
      results.innerHTML = `<div class="entity-picker-empty"><b>1단계에서 고객 유형을 선택하세요</b><span>선택한 유형의 고객만 표시됩니다.</span></div>`;
    } else {
      const rows = consultationCustomerPickerRows(form);
      const query = Core.normalizeText(search && search.value || "");
      const matchingCount = store.customers.filter(customer => String(customer.type || "기타") === type).length;
      if (count) count.textContent = `${type} 고객 ${matchingCount.toLocaleString("ko-KR")}명${search && search.value.trim() ? ` · 검색 결과 ${rows.filter(customer => String(customer.type || "기타") === type).length}명` : ""}`;
      results.innerHTML = rows.length ? rows.map(customer => {
        const selected = String(customer.id) === selectedId;
        const buildings = customerBuildings(customer);
        const matchedBuilding = query ? buildings.find(building => Core.normalizeText([building.name, building.address].filter(Boolean).join(" ")).includes(query)) : null;
        const shownBuilding = matchedBuilding || buildings[0];
        const buildingMeta = shownBuilding ? `${buildingChoiceLabel(shownBuilding)}${buildings.length > 1 ? ` · 외 ${buildings.length - 1}곳` : ""}` : "";
        const currentType = String(customer.type || "기타");
        const note = currentType === type ? currentType : `기존 연결 · 현재 유형 ${currentType}`;
        const meta = [customer.company, customerPhoneText(customer.phone), buildingMeta].filter(Boolean).join(" · ");
        return `<button type="button" tabindex="-1" class="entity-picker-option ${selected ? "selected" : ""}" data-consultation-customer-option="${attr(customer.id)}" aria-pressed="${selected ? "true" : "false"}"><span class="entity-picker-option-main"><b>${esc(customer.name || "이름 미입력")}</b><small>${esc(note)}</small></span><span class="entity-picker-option-meta">${esc(meta || "추가 정보 미입력")}</span></button>`;
      }).join("") : `<div class="entity-picker-empty"><b>조건에 맞는 고객이 없습니다</b><span>검색어를 지우거나 고객 관리에서 새 고객을 등록해 주세요.</span></div>`;
    }
    if (summary) summary.innerHTML = customerPickerSummaryMarkup(customerById(selectedId));
  }

  function setupConsultationCustomerPicker(form, preselectedCustomer) {
    if (!form || form.querySelector("[data-consultation-customer-options]")) return;
    const customerSelect = form.elements.customerId;
    if (!customerSelect) return;
    const selectedId = customerSelect.value;
    const customerField = customerSelect.closest(".field");
    const picker = document.createElement("div");
    picker.className = "entity-picker wide";
    const selectedType = preselectedCustomer && (preselectedCustomer.type || "기타") || "";
    const types = ["", ...unique([...CONSULTATION_CUSTOMER_TYPES, ...store.customers.map(customer => customer.type || "기타"), selectedType])];
    picker.innerHTML = `<div class="entity-picker-steps"><section class="entity-picker-step"><div class="entity-picker-step-label"><b>1. 고객 유형 선택</b><span>상담할 고객 유형을 먼저 고르세요.</span></div>${selectField("고객 유형 *", "customerType", types, selectedType, value => value || "고객 유형을 선택하세요")}</section><section class="entity-picker-step"><div class="entity-picker-step-label"><b>2. 고객 선택</b><span>이름·상호·연락처·연결 건물로 검색할 수 있습니다.</span></div><label class="field"><span>고객 검색</span><input class="entity-picker-search" type="search" data-consultation-customer-search placeholder="이름·상호·연락처·건물 검색" autocomplete="off"></label><div class="entity-picker-count" data-consultation-customer-count aria-live="polite"></div><div class="entity-picker-results" data-consultation-customer-options role="group" aria-label="고객 검색 결과"></div></section></div><input type="hidden" name="customerId" value="${attr(selectedId)}"><div data-consultation-customer-summary>${customerPickerSummaryMarkup(preselectedCustomer)}</div>`;
    customerField.replaceWith(picker);
    renderConsultationCustomerPicker(form);
  }

  function partnerQuoteEditor(quoteId) {
    const editing = store.partnerQuotes.find(item => item.id === quoteId);
    const item = editing ? JSON.parse(JSON.stringify(editing)) : Core.createPartnerQuote({ owner: store.settings.owner || "김현진" });
    const linkedVendor = partnerVendorForQuote(item);
    item.vendorId = linkedVendor && linkedVendor.id || "";
    item.industry = editing ? partnerIndustry(item) : "";
    item.status = item.status === "견적 요청" ? "상담 중" : item.status === "견적 받음" ? "상담 완료" : item.status;
    item.consultationContent = item.consultationContent || item.memo || "";
    item.consultedAt = item.consultedAt || item.receivedAt || item.contactedAt || "";
    if (!item.totalMin && item.quotedAmount) item.totalMin = item.quotedAmount;
    if (!item.totalMax && item.quotedAmount) item.totalMax = item.quotedAmount;
    if (!item.travelMin && item.calloutFee) item.travelMin = item.calloutFee;
    if (!item.travelMax && item.calloutFee) item.travelMax = item.calloutFee;
    const vendorIds = ["", ...partnerVendorRows().sort((a, b) => partnerVendorName(a).localeCompare(partnerVendorName(b), "ko")).map(vendor => vendor.id)];
    modalContent.innerHTML = `<div class="modal-head"><div><h2>${editing ? "업체 상담 수정" : "업체 상담 기록"}</h2><p>저장된 연락 업체를 선택하고 상담 내용과 안내 가격을 기록하세요.</p></div><button class="close-button" data-action="close-modal">×</button></div><form id="partnerQuoteForm" class="modal-body partner-quote-form" data-partner-quote-id="${attr(editing && editing.id || "")}" data-legacy-vendor="${attr(!linkedVendor && item.vendor || "")}"><div class="quote-scenario-guide"><b>가상 조건만 사용하세요</b><span>실제 고객명·주소는 넣지 말고 모든 업체에 동일한 작업 조건을 제시합니다.</span></div><div class="partner-quote-vendor-picker"><div class="form-grid">${selectField("연락 업체 *", "vendorId", vendorIds, item.vendorId, id => id ? `${partnerVendorName(partnerVendorById(id))} · ${partnerIndustry(partnerVendorById(id))}` : "연락 업체를 선택하세요")}</div><div data-partner-vendor-summary>${partnerVendorSummaryMarkup(linkedVendor, !linkedVendor && item.vendor ? `기존 기록 업체: ${item.vendor} · 저장하려면 연락 업체를 선택하세요.` : "연락 업체에서 업체를 먼저 등록할 수 있습니다.")}</div>${!partnerVendorRows().length ? `<button type="button" class="secondary-button partner-vendor-create-link" data-action="new-partner-vendor">＋ 연락 업체 먼저 등록</button>` : ""}</div><input type="hidden" name="vendor" value="${attr(linkedVendor ? partnerVendorName(linkedVendor) : item.vendor || "")}"><input type="hidden" name="phone" value="${attr(linkedVendor && linkedVendor.phone || item.phone || "")}"><input type="hidden" name="phoneLabel" value="${attr(linkedVendor && linkedVendor.phoneLabel || item.phoneLabel || "")}"><input type="hidden" name="alternatePhone" value="${attr(linkedVendor && linkedVendor.alternatePhone || item.alternatePhone || "")}"><input type="hidden" name="alternatePhoneLabel" value="${attr(linkedVendor && linkedVendor.alternatePhoneLabel || item.alternatePhoneLabel || "")}"><input type="hidden" name="quoteUrl" value="${attr(linkedVendor && linkedVendor.quoteUrl || item.quoteUrl || "")}"><input type="hidden" name="service" value="${attr(linkedVendor && (linkedVendor.service || linkedVendor.category) || item.service || item.category || "")}"><input type="hidden" name="region" value="${attr(linkedVendor && linkedVendor.region || item.region || "원주")}"><div class="essential-label"><b>상담 중 바로 입력</b><span>진행 상태·안내 가격·상담 내용을 먼저 기록하세요.</span></div><div class="form-grid">
      ${selectField("업종 *", "industry", Core.PARTNER_INDUSTRIES, item.industry)}
      ${selectField("진행 상태", "status", Core.PARTNER_QUOTE_STATUSES, item.status)}
      ${field("문의한 작업 조건 *", "scenario", item.scenario, "text", "예: 원주 원룸 천장 누수 탐지·시공", "wide")}
      ${field("안내 가격 최저", "totalMin", item.totalMin || "", "number", "정확한 가격이면 이 칸만 입력")}
      ${field("안내 가격 최고", "totalMax", item.totalMax || "", "number", "범위 가격일 때 입력")}
      ${field("상담한 날", "consultedAt", item.consultedAt || "", "date")}
      ${field("담당자", "owner", item.owner || store.settings.owner || "김현진")}
      ${areaField("상담 내용", "consultationContent", item.consultationContent, "wide consultation-content-field")}
    </div>${industryChecklistFields(item.industry, item.checklist)}<details class="optional-form"><summary><b>비용 세부항목</b><span>탐지·시공비와 출장비를 입력하려면 펼치세요</span></summary><div class="form-grid optional-form-body">
      ${field("탐지·기본 점검비 최저", "inspectionMin", item.inspectionMin || "", "number", "원 단위")}${field("탐지·기본 점검비 최고", "inspectionMax", item.inspectionMax || "", "number", "원 단위")}
      ${field("예상 시공비 최저", "constructionMin", item.constructionMin || "", "number", "원 단위")}${field("예상 시공비 최고", "constructionMax", item.constructionMax || "", "number", "원 단위")}
      ${field("출장비 최저", "travelMin", item.travelMin || "", "number", "원 단위")}${field("출장비 최고", "travelMax", item.travelMax || "", "number", "원 단위")}
      ${field("시공비 산정 방식", "constructionPricing", item.constructionPricing, "text", "예: 총비용에 포함·현장에 따라 변동")}${field("출장비 조건", "travelPolicy", item.travelPolicy, "text", "예: 포함·0원·미확인")}
      ${field("작업 불가·미탐지 시", "noFindPolicy", item.noFindPolicy, "text", "예: 미탐지 시 비용 없음")}${field("포함 작업", "includedWork", item.includedWork, "text", "예: 압력검사·배관 보수·타일")}
      <label class="permission-option wide"><input type="checkbox" name="priceNegotiable" ${item.priceNegotiable ? "checked" : ""}><span><b>가격 협의 가능</b><small>업체가 에누리·가격 조정을 안내한 경우 체크</small></span></label>
    </div></details><details class="optional-form"><summary><b>연락·평가 정보</b><span>응답 속도와 A/S 조건을 입력하려면 펼치세요</span></summary><div class="form-grid optional-form-body">
      ${field("응답 속도", "responseSpeed", item.responseSpeed, "text", "예: 당일, 1일")}${field("보증·A/S", "warranty", item.warranty, "text", "예: 재탐지 30일")}${field("처음 연락한 날", "contactedAt", item.contactedAt || "", "date")}
      ${field("가격 안내받은 날", "receivedAt", item.receivedAt || "", "date")}${areaField("추가 비고", "memo", item.memo, "wide")}
    </div></details><div class="form-actions">${editing ? `<button type="button" class="danger-outline-button form-delete-left" data-partner-quote-delete="${attr(editing.id)}">상담 기록 삭제</button>` : ""}<button type="button" class="secondary-button" data-action="close-modal">취소</button><button type="submit" class="primary-button">${editing ? "수정 저장" : "상담 기록 저장"}</button></div></form>`;
    openModal();
    const form = document.getElementById("partnerQuoteForm");
    setupPartnerVendorPicker(form, item.industry, item.checklist);
    setTimeout(() => {
      const industry = form && form.elements.industry;
      const search = form && form.querySelector("[data-partner-vendor-search]");
      (industry && industry.value ? search : industry)?.focus();
    }, 30);
  }

  function taskEditor(customerId) {
    modalContent.innerHTML = `<div class="modal-head"><div><h2>할 일 추가</h2><p>후속 연락과 제출 업무를 기한별로 관리합니다.</p></div><button class="close-button" data-action="close-modal">×</button></div><form id="taskForm" class="modal-body" data-return-customer="${attr(customerId || "")}"><div class="form-grid">${selectField("연결 고객", "customerId", ["", ...store.customers.map(item => item.id)], customerId || "", id => id ? (customerById(id)?.name || id) : "공통 업무")}${field("할 일 *", "title", "")}${field("기한", "dueAt", todayKey(), "date")}${selectField("우선순위", "priority", ["높음", "보통", "낮음"], "보통")}${selectField("구분", "category", ["후속 연락", "견적", "현장방문", "제안서", "계약", "보고", "기타"], "후속 연락")}${field("담당자", "owner", store.settings.owner || "김현진")}${areaField("메모", "note", "", "wide")}</div><div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">취소</button><button class="primary-button" type="submit">추가</button></div></form>`;
    openModal();
  }

  function consultationEditor(customerId, returnView) {
    const customer = customerById(customerId);
    const relationshipMode = returnView === "relationships";
    const cycle = Number(customer && customer.relationshipCycleDays) || 30;
    const nextContactAt = relationshipMode ? (customer && customer.relationshipNextContactAt || addDaysIso(new Date(), cycle)) : "";
    const nextAction = relationshipMode ? (customer && customer.relationshipNextAction || "서비스 만족도 및 추가 요청 확인") : "";
    modalContent.innerHTML = `<div class="modal-head"><div><h2>${relationshipMode ? "후속 연락 기록" : "상담 기록 추가"}</h2><p>${relationshipMode ? "계약 고객과 나눈 내용과 다음 연락 약속을 함께 남기세요." : "고객과 나눈 핵심 내용과 다음 할 일을 간단히 남기세요."}</p></div><button class="close-button" data-action="close-modal">×</button></div><form id="consultationForm" class="modal-body" data-return-view="${attr(returnView || "consultations")}"><div class="form-grid">${selectField("고객 *", "customerId", ["", ...store.customers.map(item => item.id)], customerId || "", id => id ? (customerById(id)?.name || id) : "고객을 선택하세요")}${selectField("연락 방식", "type", ["전화", "문자", "카카오", "이메일", "미팅", "방문", "메모"], "전화")}${field("연락 일시", "occurredAt", datetimeValue(new Date().toISOString()), "datetime-local")}${field("담당자", "owner", store.settings.owner || "김현진")}${areaField("연락 내용 *", "summary", "", "wide")}${field("고객 반응·결과", "result", "", "text", relationshipMode ? "예: 서비스에 만족, 추가 요청 없음" : "예: 견적 요청 접수")}${field("다음 할 일", "nextAction", nextAction, "text", relationshipMode ? "예: 정기 안부 및 추가 요청 확인" : "예: 비교견적 전달")}${field("다음 연락일", "nextContactAt", datetimeValue(nextContactAt), "datetime-local")}</div><div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">취소</button><button class="primary-button">${relationshipMode ? "후속 연락 저장" : "상담 기록 저장"}</button></div></form>`;
    openModal();
    const form = document.getElementById("consultationForm");
    setupConsultationCustomerPicker(form, customer);
    setTimeout(() => {
      const type = form && form.elements.customerType;
      const search = form && form.querySelector("[data-consultation-customer-search]");
      (type && type.value ? search : type)?.focus();
    }, 30);
  }

  function relationshipEditor(customerId) {
    const customer = customerById(customerId);
    if (!customer) return;
    const cycle = Number(customer.relationshipCycleDays) || 30;
    const nextContactAt = customer.relationshipNextContactAt || addDaysIso(new Date(), cycle);
    modalContent.innerHTML = `<div class="modal-head"><div><h2>연락 계획 설정</h2><p>${esc(customer.name)} 고객과 관계를 이어갈 다음 일정을 정합니다.</p></div><button class="close-button" data-action="close-modal">×</button></div><form id="relationshipPlanForm" class="modal-body" data-customer-id="${attr(customer.id)}"><div class="info-box">계약 이후 만족도 확인, 불편사항 점검, 추가 서비스 안내 같은 연락을 잊지 않도록 관리합니다.</div><div class="form-grid" style="margin-top:14px">${selectField("연락 주기", "relationshipCycleDays", [7, 14, 30, 60, 90, 180], cycle, days => `${days}일마다`)}${field("다음 연락일 *", "relationshipNextContactAt", datetimeValue(nextContactAt), "datetime-local")}${field("다음 할 일", "relationshipNextAction", customer.relationshipNextAction || "계약 후 만족도 확인", "text", "예: 서비스 만족도와 추가 요청 확인", "wide")}${areaField("관계 메모", "relationshipNote", customer.relationshipNote || "", "wide")}</div><div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">취소</button><button class="primary-button">연락 계획 저장</button></div></form>`;
    openModal();
  }

  function workflowCaseEditor(buildingId) {
    const building = buildingById(buildingId) || null;
    modalContent.innerHTML = `<div class="modal-head"><div><h2>새 케이스 등록</h2><p>필수 정보만 입력하고 1단계부터 바로 시작합니다.</p></div><button class="close-button" data-action="close-modal">×</button></div><form id="workflowCaseCreateForm" class="modal-body"><div class="info-box">등록 건물을 선택하면 건물 ID가 함께 저장되어 건물명이 바뀌어도 업무 연결이 유지됩니다. 요청자는 실제 연락할 고객을 직접 선택해 주세요.</div><div class="form-grid" style="margin-top:14px">${selectField("등록 건물", "crmBuildingId", ["", ...store.buildings.map(item => item.id)], building && building.id || "", id => id ? buildingChoiceLabel(buildingById(id)) : "직접 입력·미등록 건물")}${selectField("요청자·연락 고객", "crmCustomerId", ["", ...store.customers.map(item => item.id)], "", id => id ? `${customerById(id)?.name || id}${customerById(id)?.type ? ` · ${customerById(id).type}` : ""}` : "직접 입력·미연결")}${field("고객명 *", "name", "", "text", "예: 홍길동")}${field("연락처", "phone", "", "text", "010-0000-0000")}${field("건물 *", "building", building && building.name || "", "text", "건물명")}${field("호실", "room", "", "text", "예: 302호")}${field("주소", "address", building && building.address || "", "text", "건물 주소", "wide")}${field("업무 유형", "issueType", "", "text", "예: 누수·전기·청소")}${selectField("긴급도", "urgency", ["보통", "확인 필요", "긴급"], "보통")}${areaField("접수 내용", "summary", "", "wide")}</div><div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">취소</button><button class="primary-button">케이스 등록</button></div></form>`;
    openModal();
  }

  function field(label, name, value, type, placeholder, extraClass) {
    return `<label class="field ${extraClass || ""}"><span>${esc(label)}</span><input name="${attr(name)}" type="${attr(type || "text")}" value="${attr(value ?? "")}" placeholder="${attr(placeholder || "")}"></label>`;
  }
  function areaField(label, name, value, extraClass) {
    return `<label class="field ${extraClass || ""}"><span>${esc(label)}</span><textarea name="${attr(name)}">${esc(value || "")}</textarea></label>`;
  }
  function selectField(label, name, options, value, labeler) {
    return `<label class="field"><span>${esc(label)}</span><select name="${attr(name)}">${options.map(option => `<option value="${attr(option)}" ${String(option) === String(value) ? "selected" : ""}>${esc(labeler ? labeler(option) : option || "선택 안 함")}</option>`).join("")}</select></label>`;
  }
  const unique = values => [...new Set(values.filter(Boolean))];

  const SALES_SOURCE_LABELS = Object.freeze({ building_sign: "건물 공개번호", broker: "공인중개사", storefront: "1층 상가", referral: "소개", danggeun: "당근", naver_blog: "네이버 블로그", existing_customer: "기존 고객", other: "기타" });
  const SALES_UNIT_LABELS = Object.freeze({ vacant: "공실", upcoming: "퇴실 예정", occupied: "입주 중", unknown: "미확인" });
  const SALES_CHANNEL_LABELS = Object.freeze({ sms: "문자", call: "전화", visit: "방문", meeting: "미팅", memo: "내부 메모" });
  const SALES_AD_CHANNEL_LABELS = Object.freeze({ naver: "네이버 부동산", daangn: "당근", naver_blog: "네이버 블로그", zigbang: "직방", dabang: "다방", other: "기타 광고채널" });
  const SALES_RESULT_LABELS = Object.freeze({ no_response: "무응답", replied: "응답", callback_requested: "재연락 요청", meeting_set: "미팅 확정", not_interested: "관심 없음", invalid_contact: "연락처 오류", do_not_contact: "연락 중단", follow_up: "후속 필요" });
  const SALES_RESPONSE_LABELS = Object.freeze({ vacancy_now: "현재 공실", vacancy_upcoming: "퇴실 예정", no_vacancy: "공실 없음", interested: "관심 있음", needs_info: "추가 설명 필요", callback_later: "나중에 연락", refused: "거절", wrong_number: "잘못된 번호", do_not_contact: "연락 중단 요청" });
  const SALES_FAILURE_LABELS = Object.freeze({ no_response: "무응답", invalid_number: "잘못된 번호", not_owner: "건물주 아님", no_vacancy: "공실 없음", not_interested: "관심 없음", price: "가격", trust: "신뢰", already_managed: "기존 관리업체", do_not_contact: "연락 중단 요청", other: "기타" });
  const SALES_SERVICE_LABELS = Object.freeze({ common_cleaning: "공용부 청소", move_in_cleaning: "입주 청소", move_out_cleaning: "퇴실 청소", flooring_wallpaper: "장판·도배", waterproofing: "방수", repair: "설비·수리", signage: "사이니지", other: "기타" });
  const SALES_OPPORTUNITY_LABELS = Object.freeze({ discovered: "기회 발견", quote_requested: "견적 요청", quote_approved: "견적 승인", work_completed: "작업 완료", revenue_recorded: "매출 기록" });
  const salesLabel = (labels, value) => labels[value] || value || "미입력";
  const salesActor = () => {
    const user = currentAuth && currentAuth.user || {};
    return { email: user.email || "", name: user.displayName || store.settings.owner || "담당자" };
  };
  const salesActorName = () => salesActor().name;
  const salesProspectById = id => (store.salesProspects || []).find(item => item && item.id === id) || null;
  const salesContactById = id => (store.salesContacts || []).find(item => item && item.id === id) || null;
  const salesUnitById = id => (store.salesUnits || []).find(item => item && item.id === id) || null;
  const salesOpportunityById = id => (store.salesOpportunities || []).find(item => item && item.id === id) || null;
  const activeSalesRecords = (collection, prospectId) => (store[collection] || []).filter(item => item && item.prospectId === prospectId && !item.archivedAt);
  function salesRelationContext(actor) {
    return {
      prospects: (store.salesProspects || []).filter(Boolean),
      contacts: (store.salesContacts || []).filter(Boolean),
      units: (store.salesUnits || []).filter(Boolean),
      opportunities: (store.salesOpportunities || []).filter(Boolean),
      actor: actor || salesActor()
    };
  }
  const salesStageFromEvents = prospectId => Sales.stageFromEvents(store.salesEvents, {
    prospectId,
    prospects: store.salesProspects,
    contacts: store.salesContacts,
    units: store.salesUnits,
    opportunities: store.salesOpportunities
  });
  function recalculateSalesProspectStage(prospectId) {
    const prospect = salesProspectById(prospectId);
    if (!prospect) return null;
    const previousStage = prospect.stage;
    const updated = typeof Sales.recalculateProspectStage === "function"
      ? Sales.recalculateProspectStage(prospect, store.salesEvents, salesRelationContext(salesActor()), salesActor())
      : Object.assign({}, prospect, { stage: salesStageFromEvents(prospectId), updatedAt: new Date().toISOString(), updatedBy: salesActor().email });
    store.salesProspects[store.salesProspects.findIndex(item => item && item.id === prospectId)] = updated;
    return { prospect: updated, previousStage };
  }
  function recalculateSalesProspectActivityCache(prospectId) {
    const prospect = salesProspectById(prospectId);
    if (!prospect) return null;
    const latest = activeSalesRecords("salesActivities", prospectId)
      .slice()
      .sort((left, right) => String(right.occurredAt || right.createdAt || "").localeCompare(String(left.occurredAt || left.createdAt || "")))[0];
    prospect.lastActivityAt = latest ? latest.occurredAt || latest.createdAt || "" : "";
    prospect.nextAction = latest ? latest.nextAction || "" : "";
    prospect.nextActionAt = latest ? latest.nextActionAt || "" : "";
    prospect.updatedAt = new Date().toISOString();
    prospect.updatedBy = salesActor().email;
    return prospect;
  }
  function salesAuditLogsForProspect(prospectId) {
    const relatedIds = new Set([prospectId]);
    ["salesContacts", "salesUnits", "salesActivities", "salesEvents", "salesOpportunities"].forEach(collection => {
      (store[collection] || []).forEach(item => {
        if (item && item.prospectId === prospectId && item.id) relatedIds.add(item.id);
      });
    });
    return (store.auditLogs || [])
      .filter(log => log && !log.archivedAt && relatedIds.has(log.targetId))
      .sort((left, right) => String(right.occurredAt || right.createdAt || "").localeCompare(String(left.occurredAt || left.createdAt || "")));
  }
  const salesOptionLabeler = labels => value => value ? salesLabel(labels, value) : "선택 안 함";
  const salesCheckbox = (label, name, checked, value) => `<label class="field sales-checkbox-field"><span>${esc(label)}</span><input type="checkbox" name="${attr(name)}" value="${attr(value || "true")}" ${checked ? "checked" : ""}></label>`;

  function salesEventOptions() {
    const standardAliases = {
      prospect_created: "building_surveyed", contact_verified: "valid_contact_found", reply_received: "response_received",
      meeting_confirmed: "meeting_booked", listing_received: "listing_intake", ad_published: "ad_posted", tenant_visit: "property_visit"
    };
    const standardByEvent = new Map((SalesStandards.funnelEvents || []).map(item => [item.event, item]));
    const evidenceGuidance = {
      lease_signed: "협력 공인중개사의 계약완료 확인이 필요합니다. 계약조건 협의나 계약서 작성은 공인중개사가 진행합니다.",
      paid_management_started: "관리 시작일, 서비스 범위, 관리계약 또는 시작 확인 증거를 함께 기록합니다."
    };
    return Sales.SALES_STAGES.flatMap(stage => stage.events.map(event => {
      const standard = standardByEvent.get(standardAliases[event] || event) || {};
      const eventLabels = { tenant_inquiry: "임차 문의", tenant_visit: "임차 방문", prospect_paused: "영업 보류", prospect_closed: "영업 종료" };
      return { event, label: eventLabels[event] || standard.label || stage.label, evidence: evidenceGuidance[event] || standard.evidence || (event === "prospect_paused" || event === "prospect_closed" ? "보류·종료 사유와 재연락 여부" : "완료 사실을 다시 확인할 수 있는 메모 또는 링크") };
    }));
  }

  function recalculateSalesProspectVacancies(prospectId) {
    const prospect = salesProspectById(prospectId);
    if (!prospect) return;
    const units = activeSalesRecords("salesUnits", prospectId);
    prospect.vacancyCount = units.filter(item => item.status === "vacant").length;
    prospect.upcomingVacancyCount = units.filter(item => item.status === "upcoming").length;
    prospect.updatedAt = new Date().toISOString();
    prospect.updatedBy = salesActor().email;
  }

  function assertSalesInputSafe(values) {
    try {
      Core.assertNoProhibitedSecrets(values);
      return true;
    } catch (error) {
      showToast(error.message || "실제 비밀번호·주민등록번호·출입코드는 저장할 수 없습니다.", "error");
      return false;
    }
  }

  function salesProspectEditor(prospectId, crmBuildingId) {
    ensureSalesStore();
    const existing = salesProspectById(prospectId);
    const linkedBuilding = !existing ? buildingById(crmBuildingId) : null;
    const item = existing || (linkedBuilding ? { name: linkedBuilding.name || "", address: linkedBuilding.address || "", crmBuildingId: linkedBuilding.id } : {});
    modalContent.innerHTML = `<div class="modal-head"><div><h2>${item.id ? "영업 대상 건물 수정" : "새 영업 대상 건물"}</h2><p>운영 건물과 자동으로 합치지 않고 확인된 경우에만 참조로 연결합니다.</p></div><button class="close-button" data-action="close-modal">×</button></div>${SalesUI.renderProspectForm({ item, crmBuildings: store.buildings, actor: salesActorName() })}`;
    const form = modalContent.querySelector("#salesProspectForm");
    if (form) form.dataset.salesProspectId = existing && existing.id || "";
    openModal();
    setTimeout(() => form?.elements.name?.focus(), 30);
  }

  function salesContactEditor(prospectId, contactId) {
    const prospect = salesProspectById(prospectId);
    if (!prospect) return showToast("영업 대상 건물을 찾지 못했습니다.", "error");
    const item = salesContactById(contactId) || {};
    modalContent.innerHTML = `<div class="modal-head"><div><h2>${item.id ? "연락처 수정" : "연락처 추가"}</h2><p>${esc(prospect.name || prospect.address)} · 연락처 출처와 수신거부를 함께 관리합니다.</p></div><button class="close-button" data-action="close-modal">×</button></div><form id="salesContactForm" class="modal-body" data-sales-prospect-id="${attr(prospect.id)}" data-sales-contact-id="${attr(item.id || "")}"><div class="form-grid">
      ${field("이름", "name", item.name || "", "text", "예: 건물주")}${field("역할", "role", item.role || "owner", "text", "예: 건물주·관리인")}${field("전화번호 *", "phone", item.phone || "", "tel", "확인한 연락처")}
      ${selectField("연락처 출처", "source", Sales.SALES_SOURCES, item.source || "building_sign", salesOptionLabeler(SALES_SOURCE_LABELS))}${areaField("출처 증거", "sourceEvidence", item.sourceEvidence || "", "wide")}${field("확인 일시", "verifiedAt", datetimeValue(item.verifiedAt), "datetime-local")}
      ${selectField("기존 CRM 고객 연결", "crmCustomerId", ["", ...store.customers.map(customer => customer.id)], item.crmCustomerId || "", id => id ? `${customerById(id)?.name || id} · 확인 후 연결` : "연결하지 않음")}
      ${salesCheckbox("수신거부·연락 중단", "doNotContact", !!(item.doNotContact || item.optOut))}${areaField("연락 중단 사유", "doNotContactReason", item.doNotContactReason || "", "wide")}
    </div><div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">취소</button><button class="primary-button">${item.id ? "연락처 저장" : "연락처 추가"}</button></div></form>`;
    openModal();
  }

  function salesUnitEditor(prospectId, unitId) {
    if (deferCanonicalMutation("영업 호실")) return;
    const prospect = salesProspectById(prospectId);
    if (!prospect) return showToast("영업 대상 건물을 찾지 못했습니다.", "error");
    const item = salesUnitById(unitId) || {};
    modalContent.innerHTML = `<div class="modal-head"><div><h2>${item.id ? "호실 수정" : "호실 추가"}</h2><p>${esc(prospect.name || prospect.address)} · 공실과 퇴실예정을 구분해 기록합니다.</p></div><button class="close-button" data-action="close-modal">×</button></div><form id="salesUnitForm" class="modal-body" data-sales-prospect-id="${attr(prospect.id)}" data-sales-unit-id="${attr(item.id || "")}"><div class="form-grid">
      ${field("호실명 *", "label", item.label || "", "text", "예: 201호")}${selectField("호실 상태", "status", Sales.UNIT_STATUSES, item.status || "unknown", salesOptionLabeler(SALES_UNIT_LABELS))}${field("퇴실 예정일", "moveOutAt", item.moveOutAt ? Core.dayKey(item.moveOutAt) : "", "date")}
      ${field("보증금", "deposit", item.deposit || 0, "number")}${field("월세", "rent", item.rent || 0, "number")}${field("관리비", "maintenanceFee", item.maintenanceFee || 0, "number")}${field("사진 링크", "photoUrl", item.photoUrl || "", "url", "https://")}${field("자료·증거 링크", "evidenceUrl", item.evidenceUrl || "", "url", "https://")}${areaField("호실 메모", "note", item.note || "", "wide")}
    </div><div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">취소</button><button class="primary-button">${item.id ? "호실 저장" : "호실 추가"}</button></div></form>`;
    openModal();
  }

  function salesActivityEditor(prospectId, presetScriptId) {
    const prospect = salesProspectById(prospectId);
    if (!prospect) return showToast("영업 대상 건물을 찾지 못했습니다.", "error");
    const contacts = activeSalesRecords("salesContacts", prospect.id);
    const units = activeSalesRecords("salesUnits", prospect.id);
    const script = (SalesStandards.scripts || []).find(item => item.id === presetScriptId) || null;
    modalContent.innerHTML = `<div class="modal-head"><div><h2>영업 활동 기록</h2><p>${esc(prospect.name || prospect.address)} · 문자·전화는 수신거부가 아닌 연락처만 선택할 수 있습니다.</p></div><button class="close-button" data-action="close-modal">×</button></div><form id="salesActivityForm" class="modal-body" data-sales-prospect-id="${attr(prospect.id)}"><div class="form-grid">
      ${selectField("활동 방식", "type", Sales.SALES_CHANNELS, "call", salesOptionLabeler(SALES_CHANNEL_LABELS))}${field("활동 일시", "occurredAt", datetimeValue(new Date().toISOString()), "datetime-local")}${selectField("연락처", "contactId", ["", ...contacts.map(item => item.id)], "", id => { const contact = salesContactById(id); return id ? `${contact?.name || "연락처"} · ${contact?.phone || "번호 미입력"}${contact?.doNotContact ? " · 연락 중단" : ""}` : "방문·메모는 선택 안 함"; })}
      ${selectField("관련 호실", "unitId", ["", ...units.map(item => item.id)], "", id => id ? salesUnitById(id)?.label || id : "건물 전체")}${selectField("결과", "result", Sales.SALES_RESULTS, "follow_up", salesOptionLabeler(SALES_RESULT_LABELS))}${selectField("응답 코드", "responseCode", ["", ...Sales.SALES_RESPONSE_CODES], "", salesOptionLabeler(SALES_RESPONSE_LABELS))}${selectField("실패 사유", "failureReason", ["", ...Sales.SALES_FAILURE_REASONS], "", salesOptionLabeler(SALES_FAILURE_LABELS))}
      ${areaField("활동 내용 *", "summary", "", "wide")}${areaField("상대방 응답", "responseText", "", "wide")}${selectField("사용 대본", "scriptId", ["", ...(SalesStandards.scripts || []).map(item => item.id)], script?.id || "", id => { const item = (SalesStandards.scripts || []).find(value => value.id === id); return id ? `${id} · ${item?.name || "대본"} · ${item?.status || "상태 미확인"}` : "대본 사용 안 함"; })}
      ${field("다음 행동", "nextAction", prospect.nextAction || "", "text", "예: 공실 조건 확인")}${field("후속 기한", "nextActionAt", datetimeValue(prospect.nextActionAt), "datetime-local")}${field("담당자", "owner", salesActorName())}
    </div><div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">취소</button><button class="primary-button">활동 기록 저장</button></div></form>`;
    const form = modalContent.querySelector("#salesActivityForm");
    if (form && script) form.dataset.scriptVersion = script.version || "";
    openModal();
  }

  function salesEventEditor(prospectId, suggestedType, suggestedChecklistIds) {
    const prospect = salesProspectById(prospectId);
    if (!prospect) return showToast("영업 대상 건물을 찾지 못했습니다.", "error");
    const contacts = activeSalesRecords("salesContacts", prospect.id);
    const units = activeSalesRecords("salesUnits", prospect.id);
    const opportunities = activeSalesRecords("salesOpportunities", prospect.id);
    const checklists = SalesStandards.checklists || [];
    modalContent.innerHTML = `<div class="modal-head"><div><h2>단계 완료 증거</h2><p>실제 완료 사실과 다시 확인할 수 있는 증거를 함께 남깁니다.</p></div><button class="close-button" data-action="close-modal">×</button></div>${SalesUI.renderEventForm({ prospect, units, eventTypes: salesEventOptions() })}`;
    const form = modalContent.querySelector("#salesEventForm");
    if (!form) return;
    form.dataset.salesProspectId = prospect.id;
    const evidenceType = form.elements.evidenceType;
    [
      ["broker_confirmation", "협력 공인중개사 계약완료 확인"],
      ["management_start", "유료관리 시작 확인"],
      ["service_contract", "관리 서비스 계약서"]
    ].forEach(([value, label]) => {
      if (!evidenceType || Array.from(evidenceType.options).some(option => option.value === value)) return;
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      evidenceType.appendChild(option);
    });
    const grid = form.querySelector(".sales-form-grid");
    grid?.insertAdjacentHTML("beforeend", `${selectField("확인 연락처", "contactId", ["", ...contacts.map(item => item.id)], "", id => id ? `${salesContactById(id)?.name || "연락처"} · ${salesContactById(id)?.phone || ""}` : "연락처 확인 단계에서 선택")}<div data-sales-contact-channel-field hidden>${selectField("접촉 채널", "channel", ["", ...Sales.SALES_CHANNELS], "", salesOptionLabeler(SALES_CHANNEL_LABELS))}</div><div data-sales-ad-channel-field hidden>${selectField("광고 채널", "adChannel", ["", ...Sales.AD_CHANNELS], "", salesOptionLabeler(SALES_AD_CHANNEL_LABELS))}</div>${selectField("접촉 결과", "result", ["", ...Sales.SALES_RESULTS], "", salesOptionLabeler(SALES_RESULT_LABELS))}${field("기록 담당자", "owner", salesActorName())}${selectField("관련 추가서비스", "opportunityId", ["", ...opportunities.map(item => item.id)], "", id => { const item = salesOpportunityById(id); return id ? `${salesLabel(SALES_SERVICE_LABELS, item?.serviceType)} · ${salesLabel(SALES_OPPORTUNITY_LABELS, item?.stage)}` : "연결하지 않음"; })}${field("유료관리 시작일", "managementStartedAt", "", "datetime-local")}${areaField("유료관리 서비스 범위", "serviceScope", "", "wide")}<fieldset class="sales-checklist-picker wide"><legend>적용 체크리스트</legend>${checklists.map(item => `<label><input type="checkbox" name="checklistIds" value="${attr(item.id)}" ${(suggestedChecklistIds || []).includes(item.id) ? "checked" : ""}><span>${esc(item.id)} · ${esc(item.title)}</span></label>`).join("")}</fieldset>`);
    if (form.elements.occurredAt) form.elements.occurredAt.value = datetimeValue(new Date().toISOString());
    if (suggestedType && form.elements.type) form.elements.type.value = suggestedType;
    refreshSalesEventChannelField(form);
    openModal();
  }

  function refreshSalesEventChannelField(form) {
    if (!form) return;
    const type = form.elements.type && form.elements.type.value;
    const contactField = form.querySelector("[data-sales-contact-channel-field]");
    const adField = form.querySelector("[data-sales-ad-channel-field]");
    if (contactField) contactField.hidden = type !== "contact_attempted";
    if (adField) adField.hidden = type !== "ad_published";
  }

  function salesEventArchiveEditor(prospectId, eventId) {
    const prospect = salesProspectById(prospectId);
    const item = (store.salesEvents || []).find(event => event && event.id === eventId && event.prospectId === prospectId);
    if (!prospect || !item || item.archivedAt) return showToast("보관할 완료 증거를 찾지 못했습니다.", "error");
    modalContent.innerHTML = `<div class="modal-head"><div><h2>완료 증거 정정·보관</h2><p>기록은 삭제하지 않습니다. 단계가 다시 계산되므로 정정 사유를 구체적으로 남겨 주세요.</p></div><button class="close-button" data-action="close-modal">×</button></div><form id="salesEventArchiveForm" class="modal-body" data-sales-prospect-id="${attr(prospectId)}" data-sales-event-id="${attr(eventId)}"><div class="form-grid">${areaField("정정 사유 *", "correctionReason", "", "wide")}</div><div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">취소</button><button class="danger-button">증거 보관</button></div></form>`;
    openModal();
    setTimeout(() => modalContent.querySelector('[name="correctionReason"]')?.focus(), 30);
  }

  function salesResumeEditor(prospectId) {
    const prospect = salesProspectById(prospectId);
    if (!prospect || prospect.archivedAt || prospect.stage !== "paused_closed") return showToast("보류·종료 상태인 영업 대상만 재개할 수 있습니다.", "error");
    modalContent.innerHTML = `<div class="modal-head"><div><h2>영업 재개</h2><p>재개할 단계와 실제 재개 사유를 직접 확인해 기록합니다.</p></div><button class="close-button" data-action="close-modal">×</button></div><form id="salesResumeForm" class="modal-body" data-sales-prospect-id="${attr(prospectId)}"><div class="form-grid">${selectField("재개 단계 *", "resumeStage", Sales.RESUMABLE_STAGES, Sales.RESUMABLE_STAGES[0], stage => (Sales.SALES_STAGES || []).find(item => item.id === stage)?.label || stage)}${areaField("재개 사유 *", "resumeReason", "", "wide")}</div><div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">취소</button><button class="primary-button">영업 재개 기록</button></div></form>`;
    openModal();
    setTimeout(() => modalContent.querySelector('[name="resumeReason"]')?.focus(), 30);
  }

  function salesOpportunityEditor(prospectId, opportunityId) {
    const prospect = salesProspectById(prospectId);
    if (!prospect) return showToast("영업 대상 건물을 찾지 못했습니다.", "error");
    const item = salesOpportunityById(opportunityId) || {};
    const units = activeSalesRecords("salesUnits", prospect.id);
    const workflowCases = activeCases();
    modalContent.innerHTML = `<div class="modal-head"><div><h2>${item.id ? "추가서비스 수정" : "추가서비스 기회"}</h2><p>견적과 매출을 구분합니다. 매출은 작업 증거와 1원 이상의 금액이 있을 때만 기록됩니다.</p></div><button class="close-button" data-action="close-modal">×</button></div><form id="salesOpportunityForm" class="modal-body" data-sales-prospect-id="${attr(prospect.id)}" data-sales-opportunity-id="${attr(item.id || "")}"><div class="form-grid">
      ${selectField("서비스 유형", "serviceType", Sales.SALES_SERVICE_TYPES, item.serviceType || "common_cleaning", salesOptionLabeler(SALES_SERVICE_LABELS))}${selectField("진행 상태", "stage", Sales.OPPORTUNITY_STAGES, item.stage || "discovered", salesOptionLabeler(SALES_OPPORTUNITY_LABELS))}${selectField("관련 호실", "unitId", ["", ...units.map(unit => unit.id)], item.unitId || "", id => id ? salesUnitById(id)?.label || id : "건물 전체")}${field("담당자", "owner", item.owner || salesActorName())}
      ${areaField("요구사항 *", "requirements", item.requirements || "", "wide")}${field("처리 기한", "dueAt", item.dueAt ? Core.dayKey(item.dueAt) : "", "date")}${field("견적 금액", "quoteAmount", item.quoteAmount || 0, "number")}${field("매출 금액", "revenueAmount", item.revenueAmount || 0, "number")}${field("완료·매출 증거 링크", "evidenceUrl", item.evidenceUrl || "", "url", "https://")}${areaField("완료·매출 증거 메모", "evidenceNote", item.evidenceNote || "", "wide")}${selectField("연결 민원·공사 케이스", "workflowCaseId", ["", ...workflowCases.map(workflowCase => workflowCaseKey(workflowCase))], item.workflowCaseId || "", caseId => { const workflowCase = workflowCases.find(value => workflowCaseKey(value) === caseId); return caseId ? `${workflowCase?.ticketNo || workflowCase?.receiptNo || caseId} · ${workflowCase?.building || workflowCase?.name || "케이스"}` : "연결하지 않음"; })}
    </div><div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">취소</button><button class="primary-button">${item.id ? "서비스 기회 저장" : "서비스 기회 추가"}</button></div></form>`;
    openModal();
  }

  function salesManagementMarkup(prospect) {
    const contacts = (store.salesContacts || []).filter(item => item.prospectId === prospect.id);
    const units = (store.salesUnits || []).filter(item => item.prospectId === prospect.id);
    const opportunities = (store.salesOpportunities || []).filter(item => item.prospectId === prospect.id);
    const operatingBuilding = buildingById(prospect.crmBuildingId);
    const recordButtons = (type, item) => `<span class="row-actions"><button type="button" class="mini-button" data-sales-${type}-edit="${attr(item.id)}" data-sales-prospect-id="${attr(prospect.id)}">수정</button><button type="button" class="${item.archivedAt ? "mini-button return" : "record-delete-button"}" data-sales-record-${item.archivedAt ? "restore" : "archive"}="${attr(item.id)}" data-sales-collection="${attr(type === "contact" ? "salesContacts" : type === "unit" ? "salesUnits" : "salesOpportunities")}" data-sales-prospect-id="${attr(prospect.id)}">${item.archivedAt ? "복원" : "보관"}</button></span>`;
    return `<details class="sales-detail-section sales-record-management"><summary><span>기록 관리·연결정보</span><b>보관·복원</b></summary><div class="sales-detail-body">
      <div class="sales-record-link"><b>기존 운영 건물</b><span>${esc(operatingBuilding ? `${operatingBuilding.name} · ${operatingBuilding.address || "주소 미입력"}` : "연결하지 않음")}</span></div>
      <h4>연락처 관리</h4>${contacts.length ? contacts.map(item => `<div class="sales-record-admin-row ${item.archivedAt ? "archived" : ""}"><span>${esc(item.name || "이름 미입력")} · ${esc(item.phone || "번호 미입력")}${item.archivedAt ? " · 보관됨" : ""}</span>${recordButtons("contact", item)}</div>`).join("") : `<p class="sales-record-empty">연락처가 없습니다.</p>`}
      <h4>호실 관리</h4>${units.length ? units.map(item => `<div class="sales-record-admin-row ${item.archivedAt ? "archived" : ""}"><span>${esc(item.label || "호실 미입력")} · ${esc(salesLabel(SALES_UNIT_LABELS, item.status))}${item.archivedAt ? " · 보관됨" : ""}</span>${recordButtons("unit", item)}</div>`).join("") : `<p class="sales-record-empty">호실이 없습니다.</p>`}
      <h4>추가서비스 관리</h4>${opportunities.length ? opportunities.map(item => `<div class="sales-record-admin-row ${item.archivedAt ? "archived" : ""}"><span>${esc(salesLabel(SALES_SERVICE_LABELS, item.serviceType))} · ${esc(salesLabel(SALES_OPPORTUNITY_LABELS, item.stage))}${item.archivedAt ? " · 보관됨" : ""}</span>${recordButtons("opportunity", item)}</div>`).join("") : `<p class="sales-record-empty">추가서비스 기회가 없습니다.</p>`}
      <p class="sales-form-rule">완료 증거 이벤트는 영구삭제하지 않습니다. 잘못 기록한 경우 감사기록을 남겨 보관 처리합니다.</p>
    </div></details>`;
  }

  function renderSalesProspectDrawer(prospectId) {
    ensureSalesStore();
    const prospect = salesProspectById(prospectId);
    if (!prospect) return closeDrawer();
    selectedCustomerId = "";
    selectedSalesProspectId = prospect.id;
    drawer.classList.remove("customer-centered");
    const writable = canWriteCRM() && !prospect.archivedAt;
    const archiveControl = canWriteCRM() ? `<section class="record-danger-zone"><div><b>${prospect.archivedAt ? "보관된 영업 대상" : "영업 대상 보관"}</b><span>기록은 삭제하지 않고 모든 활동과 완료 증거를 그대로 보존합니다.</span></div><button type="button" class="${prospect.archivedAt ? "secondary-button" : "danger-outline-button"}" data-sales-prospect-${prospect.archivedAt ? "restore" : "archive"}="${attr(prospect.id)}">${prospect.archivedAt ? "영업 대상 복원" : "영업 대상 보관"}</button></section>` : "";
    drawerContent.innerHTML = `<div class="drawer-head"><div><h2>건물 영업 상세</h2><p>${esc(prospect.id)}</p></div><button class="close-button" data-action="close-drawer">×</button></div><div class="drawer-body sales-drawer-body">${SalesUI.renderProspectDetail({ prospect, contacts: store.salesContacts, units: store.salesUnits, activities: store.salesActivities, events: store.salesEvents, opportunities: store.salesOpportunities, auditLogs: salesAuditLogsForProspect(prospect.id), stages: Sales.SALES_STAGES, writable, now: new Date().toISOString() })}${canWriteCRM() && !prospect.archivedAt ? salesManagementMarkup(prospect) : ""}${archiveControl}</div>`;
    drawerContent.querySelectorAll("a.sales-evidence-link[href]").forEach(link => {
      link.dataset.salesEvidenceLink = link.getAttribute("href") || "";
    });
    openDrawer();
  }

  function openSalesStandards(query) {
    const value = String(query || "");
    modalContent.innerHTML = `<div class="modal-head"><div><h2>BRING 영업 표준</h2><p>승인 상태와 법률검토 표시를 확인한 뒤 사용하세요.</p></div><button class="close-button" data-action="close-modal">×</button></div><div class="modal-body sales-standards-modal" id="salesStandardsResults">${SalesUI.renderStandards({ standards: SalesStandards, query: value })}</div>`;
    openModal();
    const input = modalContent.querySelector("[data-sales-standards-search]");
    if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  }

  function finishConfirmation(confirmed) {
    if (!activeConfirmation) return;
    const pending = activeConfirmation;
    activeConfirmation = null;
    confirmationLayer.classList.remove("open");
    confirmationLayer.setAttribute("aria-hidden", "true");
    appShell.inert = false;
    modal.inert = false;
    drawer.inert = false;
    confirmationContent.innerHTML = "";
    let remoteConflict = false;
    if (confirmed && pendingRemoteStore) {
      if (!saveInFlight) {
        const remote = pendingRemoteStore;
        pendingRemoteStore = null;
        store = rebaseLocalStore(store, synchronizedStore, remote);
        synchronizedStore = cloneStore(remote);
        if (saveTimer || queuedSave) queuedSave = cloneStore(store);
        if (modal.classList.contains("open")) closeModal();
        if (drawer.classList.contains("open")) closeDrawer();
        render();
      }
      confirmed = false;
      remoteConflict = true;
    }
    pending.resolve(Boolean(confirmed));
    if (!remoteConflict && pending.previousFocus && pending.previousFocus.isConnected) setTimeout(() => pending.previousFocus.focus(), 0);
    else if (remoteConflict) setTimeout(() => document.querySelector(`[data-view="${currentView}"]`)?.focus(), 0);
    if (remoteConflict) showToast("다른 사용자의 최신 변경을 먼저 반영했습니다. 내용을 다시 확인해 주세요.", "error");
    setTimeout(flushPendingRemote, 180);
  }

  function requestConfirmation(options) {
    const config = Object.assign({
      title: "이 작업을 진행할까요?", description: "내용을 확인한 뒤 계속해 주세요.", target: "", message: "", warning: "",
      confirmLabel: "확인", cancelLabel: "취소", tone: "primary", notice: false
    }, options || {});
    if (activeConfirmation) finishConfirmation(false);
    const previousFocus = document.activeElement;
    const icon = config.tone === "danger" ? "!" : config.tone === "warning" ? "!" : config.tone === "success" ? "✓" : "i";
    confirmationContent.innerHTML = `<div class="confirmation-head"><div class="confirmation-icon ${attr(config.tone)}" aria-hidden="true">${icon}</div><div><span>BRING CRM</span><h2 id="confirmationTitle">${esc(config.title)}</h2><p id="confirmationDescription">${esc(config.description)}</p></div><button type="button" class="confirmation-close" data-confirm-choice="cancel" aria-label="확인창 닫기">×</button></div><div class="confirmation-body">${config.target ? `<section class="confirmation-target"><span>확인 대상</span><strong>${esc(config.target)}</strong></section>` : ""}${config.message ? `<div class="confirmation-message">${esc(config.message)}</div>` : ""}${config.warning ? `<div class="confirmation-warning ${attr(config.tone)}"><b>${config.tone === "danger" ? "삭제 전 확인" : "안내"}</b><span>${esc(config.warning)}</span></div>` : ""}</div><div class="confirmation-actions">${config.notice ? "" : `<button type="button" class="secondary-button" data-confirm-choice="cancel">${esc(config.cancelLabel)}</button>`}<button type="button" class="${config.tone === "danger" ? "confirmation-danger-button" : "primary-button"}" data-confirm-choice="confirm">${esc(config.confirmLabel)}</button></div>`;
    confirmationLayer.classList.add("open");
    confirmationLayer.setAttribute("aria-hidden", "false");
    appShell.inert = true;
    modal.inert = true;
    drawer.inert = true;
    return new Promise(resolve => {
      activeConfirmation = { resolve, previousFocus };
      setTimeout(() => confirmationContent.querySelector('[data-confirm-choice="confirm"]')?.focus(), 20);
    });
  }

  function showCRMNotice(options) {
    return requestConfirmation(Object.assign({ notice: true, confirmLabel: "확인", tone: "primary" }, options || {}));
  }

  function openModal() {
    if (drawer.classList.contains("open")) closeDrawer();
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  }
  function closeModal() {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    setTimeout(flushPendingRemote, 180);
  }
  function openDrawer() {
    if (modal.classList.contains("open")) closeModal();
    if (!canWriteCRM()) {
      drawerContent.querySelectorAll("form input, form select, form textarea, form button").forEach(control => {
        control.disabled = true;
        control.setAttribute("aria-disabled", "true");
      });
    }
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
  }
  function closeDrawer() {
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    setTimeout(() => {
      if (!drawer.classList.contains("open")) drawer.classList.remove("customer-centered");
    }, 180);
    selectedCustomerId = "";
    selectedSalesProspectId = "";
    selectedCustomerDrawerMode = "customer";
    setTimeout(flushPendingRemote, 180);
  }

  function activityTimelineHtml(activities, emptyText) {
    if (!activities.length) return `<span class="text-muted" style="font-size:10px">${esc(emptyText || "아직 기록이 없습니다.")}</span>`;
    return activities.map(activity => `<div class="timeline-item"><i class="timeline-dot">${activityIcon(activity.type)}</i><div><strong>${esc(activity.type)} · ${esc(activity.summary)}</strong><p>${esc(activity.result || activity.nextAction || "")}</p><time>${esc(dateText(activity.occurredAt))} · ${esc(activity.owner || "")}</time></div><button type="button" class="timeline-delete" data-activity-delete="${attr(activity.id)}" aria-label="${esc(activity.summary || activity.type)} 기록 삭제">삭제</button></div>`).join("");
  }

  function renderCustomerDrawer(customerId) {
    const customer = customerById(customerId);
    if (!customer) return closeDrawer();
    if (!sessionViewedCustomers.has(customerId)) {
      sessionViewedCustomers.add(customerId);
      if (canWriteCRM()) {
        logAudit({ category: "조회", targetType: "고객", targetId: customer.id, targetLabel: customer.name, action: "고객 상세정보 조회", reason: "고객 상담·업무 확인" });
        scheduleSave();
      }
    }
    selectedCustomerId = customerId;
    selectedCustomerDrawerMode = "customer";
    drawer.classList.add("customer-centered");
    const buildings = customerBuildings(customer);
    const salesProgress = customerSalesProgress(customer);
    const activities = customerActivities(customerId);
    const tasks = customerTasks(customerId).filter(task => task.status !== "취소");
    drawerContent.innerHTML = `<div class="drawer-head"><div><h2>고객 상세</h2><p>${esc(customer.customerNo || customer.id)}</p></div><button class="close-button" data-action="close-drawer">×</button></div><div class="drawer-body">
      <section class="customer-summary"><i class="avatar">${esc(initials(customer.name))}</i><div><h3>${esc(customer.name)}</h3><p>${esc([customer.company, customer.type, customerPhoneText(customer.phone)].filter(Boolean).join(" · "))}</p></div><div class="summary-value"><strong>${esc(krw(customer.expectedValue))}</strong><span>예상 계약금액</span></div></section>
      <div class="inline-actions" style="margin-bottom:14px"><button class="primary-button" data-action="edit-selected-customer">고객 정보 수정</button><button class="secondary-button" data-action="new-selected-task">＋ 영업 할 일</button></div>
      <section class="detail-section"><div class="detail-section-head"><h4>영업 관리 연동·후속조치</h4>${customerSalesStageBadge(salesProgress)}</div><div class="detail-section-body"><div class="kv-grid"><div class="kv"><b>현재 문제</b><span>${esc(customer.currentIssue || "미입력")}</span></div><div class="kv"><b>다음 행동</b><span>${esc(customer.nextAction || "미입력")}</span></div><div class="kv"><b>다음 연락</b><span>${esc(dateText(customer.nextContactAt))}</span></div><div class="kv"><b>담당자·우선순위</b><span>${esc(customer.owner || "-")} · ${esc(customer.priority || "보통")}</span></div></div><p class="customer-sales-link-note">진행상태는 연결 건물의 영업 관리 단계에서 자동으로 가져옵니다.</p></div></section>
      <section class="detail-section"><div class="detail-section-head"><h4>연결 건물</h4><span class="text-muted" style="font-size:9px">${buildings.length}곳</span></div><div class="detail-section-body">${buildings.length ? `<div class="building-record-list">${buildings.map(building => {
        const row = salesProgress.rows.find(item => item.building.id === building.id);
        const itemProgress = row && row.stage
          ? { stateId: row.stage.id, label: row.stage.label, rows: [row] }
          : { stateId: row && row.ambiguous ? "needs-review" : "unregistered", label: row && row.ambiguous ? "연결 확인 필요" : "영업 미등록", rows: row ? [row] : [] };
        return `<div class="building-record customer-building-sales-record"><div><b>${esc(building.name || "건물명 미입력")}</b><span>${esc([building.type, building.address].filter(Boolean).join(" · ") || "정보 미입력")}</span><small>${esc(row && customerSalesMatchLabel[row.matchedBy] || "영업 건물 연결 없음")}</small></div><div class="customer-building-sales-actions">${customerSalesStageBadge(itemProgress)}<div class="row-actions">${row && row.prospect ? `<button type="button" class="mini-button" data-sales-prospect-open="${attr(row.prospect.id)}">영업 보기</button>` : row && !row.ambiguous && canWriteCRM() ? `<button type="button" class="mini-button" data-sales-connect-building="${attr(building.id)}">영업 연결</button>` : ""}<button type="button" class="mini-button" data-building-jump="${attr(building.id)}">건물 보기</button><button type="button" class="record-delete-button" data-building-delete="${attr(building.id)}">삭제</button></div></div></div>`;
      }).join("")}</div>` : `<span class="text-muted" style="font-size:10px">연결된 건물이 없습니다.</span>`}</div></section>
      <section class="detail-section"><div class="detail-section-head"><h4>상담 기록</h4><span class="text-muted" style="font-size:9px">${activities.length}건</span></div><div class="detail-section-body"><form id="activityForm" data-customer-id="${attr(customer.id)}"><div class="form-grid">${selectField("방식", "type", ["전화", "문자", "카카오", "이메일", "미팅", "방문", "메모"], "전화")}${field("일시", "occurredAt", datetimeValue(new Date().toISOString()), "datetime-local")}${areaField("상담 내용 *", "summary", "", "wide")}${field("결과", "result", "")}${field("다음 행동", "nextAction", customer.nextAction || "")}${field("다음 연락", "nextContactAt", datetimeValue(customer.nextContactAt), "datetime-local")}</div><div class="form-actions"><button type="submit" class="secondary-button">상담 기록 추가</button></div></form><div class="timeline" style="margin-top:12px">${activityTimelineHtml(activities, "아직 상담 기록이 없습니다.")}</div></div></section>
      <section class="detail-section"><div class="detail-section-head"><h4>할 일</h4><button class="filter-chip" data-action="new-selected-task">＋ 추가</button></div><div class="detail-section-body">${tasks.length ? `<div class="task-list">${tasks.slice(0, 6).map(task => `<div class="customer-task-record"><button class="task-check" data-task-toggle="${attr(task.id)}">${task.status === "완료" ? "✓" : ""}</button><span class="${task.status === "완료" ? "done" : ""}">${esc(task.title)}</span><time>${esc(shortDate(task.dueAt))}</time><button type="button" class="record-delete-button" data-task-delete="${attr(task.id)}">삭제</button></div>`).join("")}</div>` : `<span class="text-muted" style="font-size:10px">등록된 할 일이 없습니다.</span>`}</div></section>
      <section class="record-danger-zone"><div><b>고객 정보 삭제</b><span>연결된 건물·상담·할 일이 없을 때만 삭제할 수 있습니다.</span></div><button type="button" class="danger-outline-button" data-customer-delete="${attr(customer.id)}">고객 삭제</button></section>
    </div>`;
    openDrawer();
  }

  function renderRelationshipDrawer(customerId) {
    const customer = customerById(customerId);
    if (!customer) return closeDrawer();
    beginRelationship(customer);
    selectedCustomerId = customerId;
    selectedCustomerDrawerMode = "relationship";
    drawer.classList.remove("customer-centered");
    const activities = customerActivities(customerId);
    const state = relationshipState(customer);
    const lastActivity = activities[0];
    const lastContact = customer.relationshipLastContactAt || customer.lastContactAt || (lastActivity && lastActivity.occurredAt) || "";
    const nextContactAt = customer.relationshipNextContactAt || addDaysIso(new Date(), Number(customer.relationshipCycleDays) || 30);
    drawerContent.innerHTML = `<div class="drawer-head"><div><h2>계약 고객 관리</h2><p>후속 연락 이력과 다음 계획</p></div><button class="close-button" data-action="close-drawer">×</button></div><div class="drawer-body relationship-drawer-body">
      <section class="relationship-detail-summary"><i class="avatar">${esc(initials(customer.name))}</i><div><h3>${esc(customer.name)}</h3><p>${esc([customer.company, customerPhoneText(customer.phone)].filter(Boolean).join(" · ") || "연락처 미입력")}</p></div><span class="relationship-state ${state.tone}">${esc(state.label)}</span></section>
      <div class="inline-actions relationship-detail-actions"><button class="secondary-button" data-relationship-plan="${attr(customer.id)}">연락 계획 수정</button><button class="text-button" data-action="show-selected-customer">전체 고객 정보 보기 →</button></div>
      <section class="detail-section"><div class="detail-section-head"><h4>현재 연락 계획</h4><span class="relationship-plan-cycle">${Number(customer.relationshipCycleDays) || 30}일마다</span></div><div class="detail-section-body"><div class="kv-grid"><div class="kv"><b>마지막 연락</b><span>${esc(lastContact ? dateText(lastContact) : "기록 없음")}</span></div><div class="kv"><b>다음 연락</b><span>${esc(nextContactAt ? dateText(nextContactAt) : "일정 미등록")}</span></div><div class="kv"><b>다음 할 일</b><span>${esc(customer.relationshipNextAction || "후속 계획 미등록")}</span></div><div class="kv"><b>관계 시작</b><span>${esc(customer.relationshipStartedAt ? dateText(customer.relationshipStartedAt) : "미등록")}</span></div></div>${customer.relationshipNote ? `<p class="relationship-detail-note">${esc(customer.relationshipNote)}</p>` : ""}</div></section>
      <section class="detail-section relationship-add-section"><div class="detail-section-head"><div><h4>후속 연락 추가</h4><span>통화·문자·방문 내용을 바로 기록하세요.</span></div></div><div class="detail-section-body"><form id="relationshipActivityForm" data-customer-id="${attr(customer.id)}"><div class="form-grid">${selectField("연락 방식", "type", ["전화", "문자", "카카오", "이메일", "미팅", "방문", "메모"], "전화")}${field("연락 일시", "occurredAt", datetimeValue(new Date().toISOString()), "datetime-local")}${areaField("연락 내용 *", "summary", "", "wide")}${field("고객 반응·결과", "result", "", "text", "예: 서비스에 만족, 추가 요청 없음")}${field("다음 할 일", "nextAction", customer.relationshipNextAction || "정기 안부 및 추가 요청 확인")}${field("다음 연락일", "nextContactAt", datetimeValue(nextContactAt), "datetime-local")}</div><div class="form-actions"><button class="primary-button">＋ 후속 연락 저장</button></div></form></div></section>
      <section class="detail-section relationship-history-section"><div class="detail-section-head"><div><h4>후속 연락 기록</h4><span>잘못 입력한 기록은 오른쪽 삭제 버튼으로 정리할 수 있습니다.</span></div><b>${activities.length}건</b></div><div class="detail-section-body"><div class="timeline relationship-timeline">${activityTimelineHtml(activities, "아직 후속 연락 기록이 없습니다.")}</div></div></section>
    </div>`;
    openDrawer();
  }

  function activityIcon(type) {
    return ({ "전화": "☎", "문자": "S", "카카오": "K", "이메일": "@", "미팅": "M", "방문": "V", "메모": "N" })[type] || "·";
  }

  function customerFromForm(form) {
    const raw = Object.fromEntries(new FormData(form).entries());
    const id = form.dataset.customerId;
    const existing = customerById(id);
    const customer = existing || Core.createCustomer({ owner: store.settings.owner || "김현진" });
    Object.assign(customer, {
      name: raw.name.trim(), company: raw.company.trim(), phone: customerPhoneText(raw.phone), email: raw.email.trim(), type: raw.type,
      owner: raw.owner, source: raw.source, priority: raw.priority, expectedValue: Core.money(raw.expectedValue),
      interestServices: raw.interestServices.split(",").map(item => item.trim()).filter(Boolean), tags: raw.tags.split(",").map(item => item.trim()).filter(Boolean),
      currentIssue: raw.currentIssue.trim(), lastContactAt: raw.lastContactAt ? new Date(raw.lastContactAt).toISOString() : "",
      nextContactAt: raw.nextContactAt ? new Date(raw.nextContactAt).toISOString() : "", nextAction: raw.nextAction.trim(),
      notes: raw.notes.trim(), updatedAt: new Date().toISOString()
    });
    if (!existing) store.customers.push(customer);
    return customer;
  }

  async function deleteActivityRecord(activityId) {
    if (!canWriteCRM()) return showToast("조회 전용 계정은 상담 기록을 삭제할 수 없습니다.", "error");
    let activity = store.activities.find(item => item.id === activityId);
    if (!activity) return showToast("삭제할 기록을 찾지 못했습니다.", "error");
    const label = `${activity.type || "상담"} · ${activity.summary || "내용 없음"}`;
    if (!await requestConfirmation({ title: "이 상담 기록을 삭제할까요?", description: "잘못 입력한 기록인지 확인해 주세요.", target: label, warning: "삭제하면 모든 사용자의 CRM에서도 없어집니다.", confirmLabel: "기록 삭제", tone: "danger" })) return;
    const index = store.activities.findIndex(item => item.id === activityId);
    if (index < 0) return showToast("이미 삭제되었거나 변경된 기록입니다.", "error");
    activity = store.activities[index];
    store.activities.splice(index, 1);
    const customer = customerById(activity.customerId);
    if (customer) {
      const remaining = customerActivities(customer.id);
      const latest = remaining[0] || null;
      const latestPlan = remaining.find(item => item.nextAction || item.nextContactAt) || null;
      const previous = activity.previousCustomerState || {};
      const deletedWasLast = customer.lastContactAt === activity.occurredAt;
      const deletedWasRelationshipLast = customer.relationshipLastContactAt === activity.occurredAt;
      if (deletedWasLast) customer.lastContactAt = previous.lastContactAt !== undefined ? previous.lastContactAt : latest && latest.occurredAt || "";
      if (activity.nextAction && customer.nextAction === activity.nextAction) customer.nextAction = previous.nextAction !== undefined ? previous.nextAction : latestPlan && latestPlan.nextAction || "";
      if (activity.nextContactAt && customer.nextContactAt === activity.nextContactAt) customer.nextContactAt = previous.nextContactAt !== undefined ? previous.nextContactAt : latestPlan && latestPlan.nextContactAt || "";
      if (customerIsRelationshipCustomer(customer)) {
        if (deletedWasRelationshipLast) customer.relationshipLastContactAt = previous.relationshipLastContactAt !== undefined ? previous.relationshipLastContactAt : latest && latest.occurredAt || "";
        if (activity.nextAction && customer.relationshipNextAction === activity.nextAction) customer.relationshipNextAction = previous.relationshipNextAction !== undefined ? previous.relationshipNextAction : latestPlan && latestPlan.nextAction || "계약 후 만족도 확인";
        if ((activity.nextContactAt && customer.relationshipNextContactAt === activity.nextContactAt) || (deletedWasRelationshipLast && !activity.nextContactAt)) {
          customer.relationshipNextContactAt = previous.relationshipNextContactAt !== undefined ? previous.relationshipNextContactAt : latestPlan && latestPlan.nextContactAt || addDaysIso(latest && latest.occurredAt || new Date(), customer.relationshipCycleDays || 30);
        }
      }
      customer.updatedAt = new Date().toISOString();
      logAudit({ category: "삭제", targetType: "상담 기록", targetId: activity.id, targetLabel: customer.name, action: `${activity.type || "상담"} 기록 삭제`, reason: "잘못 입력한 기록 정정" });
    }
    scheduleSave();
    render();
    if (selectedCustomerId && customerById(selectedCustomerId)) {
      if (selectedCustomerDrawerMode === "relationship") renderRelationshipDrawer(selectedCustomerId);
      else renderCustomerDrawer(selectedCustomerId);
    }
    showToast("기록을 삭제했습니다.", "success");
  }

  async function deleteTaskRecord(taskId) {
    if (!canWriteCRM()) return showToast("조회 전용 계정은 할 일을 삭제할 수 없습니다.", "error");
    let task = store.tasks.find(item => item.id === taskId);
    if (!task) return showToast("삭제할 할 일을 찾지 못했습니다.", "error");
    if (!await requestConfirmation({ title: "이 할 일을 삭제할까요?", description: "잘못 입력했거나 더 이상 필요하지 않은 할 일인지 확인해 주세요.", target: task.title || "할 일", warning: "삭제하면 모든 사용자의 CRM에서도 없어집니다.", confirmLabel: "할 일 삭제", tone: "danger" })) return;
    const index = store.tasks.findIndex(item => item.id === taskId);
    if (index < 0) return showToast("이미 삭제되었거나 변경된 할 일입니다.", "error");
    task = store.tasks[index];
    store.tasks.splice(index, 1);
    logAudit({ category: "삭제", targetType: "영업 할 일", targetId: task.id, targetLabel: task.title, action: "영업 할 일 삭제", reason: "잘못 입력한 기록 정리" });
    scheduleSave();
    render();
    if (selectedCustomerId && customerById(selectedCustomerId)) renderCustomerDrawer(selectedCustomerId);
    showToast("할 일을 삭제했습니다.", "success");
  }

  async function deleteContractRecord(contractId) {
    if (!canWriteCRM()) return showToast("조회 전용 계정은 계약을 삭제할 수 없습니다.", "error");
    let contract = store.contracts.find(item => item.id === contractId);
    if (!contract) return showToast("삭제할 계약을 찾지 못했습니다.", "error");
    if (!await requestConfirmation({ title: "이 계약을 삭제할까요?", description: "계약명과 계약번호를 확인해 주세요.", target: `${contract.name || contractTypes(contract).join("·") || "계약"}\n${contract.contractNo || "계약번호 미발급"}`, warning: "삭제하면 모든 사용자의 CRM에서도 없어집니다.", confirmLabel: "계약 삭제", tone: "danger" })) return;
    const index = store.contracts.findIndex(item => item.id === contractId);
    if (index < 0) return showToast("이미 삭제되었거나 변경된 계약입니다.", "error");
    contract = store.contracts[index];
    store.contracts.splice(index, 1);
    logAudit({ category: "삭제", targetType: "계약", targetId: contract.id, targetLabel: contract.name, action: `${contractTypes(contract).join("·")} 계약 삭제`, reason: "잘못 입력한 계약 정리" });
    scheduleSave();
    closeModal();
    currentView = "contracts";
    render();
    showToast("계약을 삭제했습니다.", "success");
  }

  async function deletePartnerQuoteRecord(quoteId) {
    if (!canWriteCRM()) return showToast("조회 전용 계정은 업체 상담 기록을 삭제할 수 없습니다.", "error");
    let quote = store.partnerQuotes.find(item => item.id === quoteId);
    if (!quote) return showToast("삭제할 업체 상담 기록을 찾지 못했습니다.", "error");
    if (!await requestConfirmation({ title: "이 업체 상담 기록을 삭제할까요?", description: "업체명과 문의 조건을 확인해 주세요.", target: `${quote.vendor || "업체명 미입력"} · ${quote.scenario || "문의한 작업 조건 미입력"}`, warning: "삭제하면 모든 사용자의 CRM에서도 없어집니다.", confirmLabel: "상담 기록 삭제", tone: "danger" })) return;
    const index = store.partnerQuotes.findIndex(item => item.id === quoteId);
    if (index < 0) return showToast("이미 삭제되었거나 변경된 상담 기록입니다.", "error");
    quote = store.partnerQuotes[index];
    store.partnerQuotes.splice(index, 1);
    logAudit({ category: "삭제", targetType: "협력업체 상담", targetId: quote.id, targetLabel: quote.vendor, action: "업체 상담 기록 삭제", reason: "잘못 입력한 기록 정리" });
    scheduleSave();
    closeModal();
    currentView = "partnerQuotes";
    render();
    showToast("업체 상담 기록을 삭제했습니다.", "success");
  }

  async function excludePartnerVendorRecord(vendorId) {
    if (!canWriteCRM()) return showToast("조회 전용 계정은 연락 업체를 제외할 수 없습니다.", "error");
    const vendor = partnerVendorById(vendorId);
    if (!vendor) return showToast("제외할 연락 업체를 찾지 못했습니다.", "error");
    const linked = partnerQuotesForVendor(vendor).length;
    if (!await requestConfirmation({
      title: "이 업체를 연락 업체 목록에서 제외할까요?",
      description: "업체 기본정보는 서버에 보관되고 새 상담의 업체 선택 목록에서만 숨겨집니다.",
      target: `${partnerVendorName(vendor) || "업체명 미입력"}\n${partnerPhoneText(vendor)}`,
      message: linked ? `기존 상담 ${linked}건은 당시 저장된 업체 정보로 계속 표시됩니다.` : "필요하면 업체 정보를 다시 등록할 수 있습니다.",
      warning: "기존 상담 기록과 가격·상담 내용은 삭제되지 않습니다.",
      confirmLabel: "업체 제외",
      tone: "danger"
    })) return;
    const latest = allPartnerVendorRows().find(item => String(item.id) === String(vendorId));
    if (!latest || latest.active === false) return showToast("이미 제외되었거나 변경된 업체입니다.", "error");
    latest.active = false;
    latest.updatedAt = new Date().toISOString();
    logAudit({ category: "변경", targetType: "연락 업체", targetId: latest.id, targetLabel: partnerVendorName(latest), action: "연락 업체 목록에서 제외", reason: "사용자 확인 후 업체 제외" });
    scheduleSave();
    closeModal();
    currentView = "partnerVendors";
    render();
    showToast(`${partnerVendorName(latest) || "업체"}를 연락 업체 목록에서 제외했습니다.`, "success");
  }

  async function deleteCustomerRecord(customerId) {
    if (!canWriteCRM()) return showToast("조회 전용 계정은 고객을 삭제할 수 없습니다.", "error");
    let customer = customerById(customerId);
    if (!customer) return showToast("삭제할 고객을 찾지 못했습니다.", "error");
    const buildings = customerBuildings(customer);
    const activities = customerActivities(customer.id);
    const tasks = customerTasks(customer.id);
    const contracts = store.contracts.filter(item => item.customerId === customer.id);
    const linkedCases = (operations.cases || []).filter(item => item && (String(item.crmCustomerId || "") === String(customer.id) || (!item.crmCustomerId && Core.matchWorkflowCustomer(item, store.customers)?.id === customer.id)));
    if (buildings.length || activities.length || tasks.length || contracts.length || linkedCases.length) {
      await showCRMNotice({ title: "이 고객은 삭제할 수 없습니다", description: "연결된 업무 기록을 먼저 정리해 주세요.", target: customer.name || "고객", message: `건물 ${buildings.length}곳 · 케이스 ${linkedCases.length}건 · 상담 ${activities.length}건 · 할 일 ${tasks.length}건 · 계약 ${contracts.length}건`, warning: "연결 기록을 삭제하거나 다른 고객으로 옮긴 뒤 다시 시도해 주세요.", tone: "warning" });
      return;
    }
    if (!await requestConfirmation({ title: "이 고객 정보를 삭제할까요?", description: "삭제할 고객이 맞는지 확인해 주세요.", target: customer.name || "고객", warning: "삭제하면 모든 사용자의 CRM에서도 없어집니다.", confirmLabel: "고객 삭제", tone: "danger" })) return;
    customer = customerById(customerId);
    if (!customer) return showToast("이미 삭제되었거나 변경된 고객입니다.", "error");
    store.customers = store.customers.filter(item => item.id !== customer.id);
    logAudit({ category: "삭제", targetType: "고객", targetId: customer.id, targetLabel: customer.name, action: "고객 정보 삭제", reason: "사용자 확인 후 삭제" });
    scheduleSave();
    closeDrawer();
    render();
    showToast(`${customer.name || "고객"} 고객을 삭제했습니다.`, "success");
  }

  async function deleteBuildingRecord(buildingId) {
    if (deferCanonicalMutation("건물")) return;
    if (!canWriteCRM()) return showToast("조회 전용 계정은 건물을 삭제할 수 없습니다.", "error");
    let building = store.buildings.find(item => item.id === buildingId);
    if (!building) return showToast("삭제할 건물을 찾지 못했습니다.", "error");
    if (!await requestConfirmation({ title: "이 건물을 보관할까요?", description: "활성 건물 목록에서는 숨기고 기록은 안전하게 남깁니다.", target: building.name || "건물", warning: "필요하면 관리자 확인 후 다시 복원할 수 있습니다.", confirmLabel: "건물 보관", tone: "danger" })) return;
    building = store.buildings.find(item => item.id === buildingId);
    if (!building) return showToast("이미 삭제되었거나 변경된 건물입니다.", "error");
    if (!Number.isInteger(building.entityVersion) || building.entityVersion < 1) return showToast("최신 건물 버전을 확인한 뒤 다시 시도해 주세요.", "error");
    try {
      await commitCanonicalEntity({ entityType: "buildings", entityId: building.id, operation: "archive", expectedVersion: building.entityVersion, patch: {}, reason: "CRM 건물 보관" });
      if (document.getElementById("buildingForm")?.dataset.buildingId === building.id) closeModal();
      if (selectedBuildingId === building.id) selectedBuildingId = store.buildings.find(item => item.id !== building.id && !item.archivedAt)?.id || "";
      render();
      if (selectedCustomerId && customerById(selectedCustomerId)) renderCustomerDrawer(selectedCustomerId);
      showToast("건물을 기록과 함께 보관했습니다.", "success");
    } catch (error) { showToast(error.message || "건물을 보관하지 못했습니다.", "error"); }
  }

  document.addEventListener("click", async event => {
    const workEvidence = event.target.closest("[data-work-evidence]");
    if (workEvidence) {
      try {
        const url = new URL(workEvidence.dataset.workEvidence || "");
        if (url.protocol !== "https:" || url.hostname !== "drive.google.com") throw new Error("허용되지 않은 증빙 주소입니다.");
        const result = await api.openExternal(url.toString());
        if (!result || result.ok === false) throw new Error(result && result.error || "Drive 증빙을 열지 못했습니다.");
      } catch (error) { showToast(error.message, "error"); }
      return;
    }
    const workEdit = event.target.closest("[data-work-edit]");
    if (workEdit) { workRecordEditor(workEdit.dataset.workEdit); return; }
    const partnerVendorOption = event.target.closest("[data-partner-vendor-option]");
    if (partnerVendorOption) {
      const form = partnerVendorOption.closest("#partnerQuoteForm");
      if (!form || !form.elements.vendorId) return;
      form.elements.vendorId.value = partnerVendorOption.dataset.partnerVendorOption || "";
      refreshPartnerQuoteVendorSummary(form, false);
      renderPartnerVendorPicker(form);
      form.querySelector("[data-partner-vendor-search]")?.focus();
      return;
    }
    const consultationCustomerOption = event.target.closest("[data-consultation-customer-option]");
    if (consultationCustomerOption) {
      const form = consultationCustomerOption.closest("#consultationForm");
      if (!form || !form.elements.customerId) return;
      form.elements.customerId.value = consultationCustomerOption.dataset.consultationCustomerOption || "";
      renderConsultationCustomerPicker(form);
      form.querySelector("[data-consultation-customer-search]")?.focus();
      return;
    }
    const nav = event.target.closest("[data-view]");
    if (nav) {
      const nextView = nav.dataset.view;
      if (currentView !== "fieldOperations" && nextView === "fieldOperations") crmSearchValue = searchEl.value;
      if (currentView === "fieldOperations" && nextView !== "fieldOperations") {
        fieldOpenGeneration += 1;
        saveFieldNavigationState();
        await api.hideFieldPlatform();
        searchEl.value = crmSearchValue;
      }
      currentView = nextView;
      if (currentView === "cases") caseListMode = "active";
      render();
      if (currentView === "buildings") requestDriveImportCandidatesRefresh();
      if (["cases", "payments", "buildings", "pipeline"].includes(currentView)) refreshOperations({ silent: true });
      return;
    }
    const salesStage = event.target.closest("[data-sales-stage-filter]");
    if (salesStage) {
      salesStageFilter = salesStage.dataset.salesStageFilter || "all";
      renderPipeline();
      return;
    }
    const salesBoardModeControl = event.target.closest("[data-sales-board-mode]");
    if (salesBoardModeControl) {
      const nextMode = salesBoardModeControl.dataset.salesBoardMode;
      if (["focus", "flow"].includes(nextMode)) {
        salesBoardMode = nextMode;
        renderPipeline();
      }
      return;
    }
    const salesConnectBuilding = event.target.closest("[data-sales-connect-building]");
    if (salesConnectBuilding) {
      if (!canWriteCRM()) return showToast("조회 전용 계정은 영업 건물을 연결할 수 없습니다.", "error");
      const building = buildingById(salesConnectBuilding.dataset.salesConnectBuilding);
      if (!building) return showToast("연결할 건물을 찾지 못했습니다.", "error");
      salesProspectEditor("", building.id);
      return;
    }
    const salesProspectOpen = event.target.closest("[data-sales-prospect-open]");
    if (salesProspectOpen) { renderSalesProspectDrawer(salesProspectOpen.dataset.salesProspectOpen); return; }
    const salesProspectEdit = event.target.closest("[data-sales-edit-prospect]");
    if (salesProspectEdit) {
      if (!canWriteCRM()) return showToast("조회 전용 계정은 영업 대상 건물을 수정할 수 없습니다.", "error");
      salesProspectEditor(salesProspectEdit.dataset.salesEditProspect);
      return;
    }
    const salesProspectResume = event.target.closest("[data-sales-resume-prospect], [data-sales-prospect-resume]");
    if (salesProspectResume) {
      if (!canWriteCRM()) return showToast("조회 전용 계정은 영업을 재개할 수 없습니다.", "error");
      salesResumeEditor(salesProspectResume.dataset.salesResumeProspect || salesProspectResume.dataset.salesProspectResume);
      return;
    }
    const salesAddContact = event.target.closest("[data-sales-add-contact]");
    if (salesAddContact) { if (!canWriteCRM()) return showToast("조회 전용 계정은 연락처를 추가할 수 없습니다.", "error"); salesContactEditor(salesAddContact.dataset.salesAddContact, ""); return; }
    const salesAddUnit = event.target.closest("[data-sales-add-unit]");
    if (salesAddUnit) { if (!canWriteCRM()) return showToast("조회 전용 계정은 호실을 추가할 수 없습니다.", "error"); salesUnitEditor(salesAddUnit.dataset.salesAddUnit, ""); return; }
    const salesAddActivity = event.target.closest("[data-sales-add-activity]");
    if (salesAddActivity) { if (!canWriteCRM()) return showToast("조회 전용 계정은 활동을 기록할 수 없습니다.", "error"); salesActivityEditor(salesAddActivity.dataset.salesAddActivity, ""); return; }
    const salesAddEvent = event.target.closest("[data-sales-add-event]");
    if (salesAddEvent) { if (!canWriteCRM()) return showToast("조회 전용 계정은 완료 증거를 기록할 수 없습니다.", "error"); salesEventEditor(salesAddEvent.dataset.salesAddEvent, "", []); return; }
    const salesAddOpportunity = event.target.closest("[data-sales-add-opportunity]");
    if (salesAddOpportunity) { if (!canWriteCRM()) return showToast("조회 전용 계정은 추가서비스를 기록할 수 없습니다.", "error"); salesOpportunityEditor(salesAddOpportunity.dataset.salesAddOpportunity, ""); return; }
    const salesContactEdit = event.target.closest("[data-sales-contact-edit]");
    if (salesContactEdit) { if (!canWriteCRM()) return showToast("조회 전용 계정은 연락처를 수정할 수 없습니다.", "error"); salesContactEditor(salesContactEdit.dataset.salesProspectId, salesContactEdit.dataset.salesContactEdit); return; }
    const salesUnitEdit = event.target.closest("[data-sales-unit-edit]");
    if (salesUnitEdit) { if (!canWriteCRM()) return showToast("조회 전용 계정은 호실을 수정할 수 없습니다.", "error"); salesUnitEditor(salesUnitEdit.dataset.salesProspectId, salesUnitEdit.dataset.salesUnitEdit); return; }
    const salesOpportunityEdit = event.target.closest("[data-sales-opportunity-edit]");
    if (salesOpportunityEdit) { if (!canWriteCRM()) return showToast("조회 전용 계정은 추가서비스를 수정할 수 없습니다.", "error"); salesOpportunityEditor(salesOpportunityEdit.dataset.salesProspectId, salesOpportunityEdit.dataset.salesOpportunityEdit); return; }
    const salesProspectArchive = event.target.closest("[data-sales-prospect-archive]");
    if (salesProspectArchive) {
      if (!canWriteCRM()) return showToast("조회 전용 계정은 영업 대상을 보관할 수 없습니다.", "error");
      const prospect = salesProspectById(salesProspectArchive.dataset.salesProspectArchive);
      if (!prospect || !await requestConfirmation({ title: "이 영업 대상을 보관할까요?", description: "활동·호실·완료 증거는 삭제되지 않습니다.", target: prospect.name || prospect.address, confirmLabel: "보관", tone: "danger" })) return;
      const index = store.salesProspects.findIndex(item => item.id === prospect.id);
      store.salesProspects[index] = Sales.archiveRecord(prospect, salesActor());
      logAudit({ category: "보관", targetType: "영업 대상 건물", targetId: prospect.id, targetLabel: prospect.name || prospect.address, action: "영업 대상 보관", reason: "사용자 확인 후 활성 목록에서 제외" });
      scheduleSave(); closeDrawer(); renderPipeline(); showToast("영업 대상을 기록과 함께 보관했습니다.", "success");
      return;
    }
    const salesProspectRestore = event.target.closest("[data-sales-prospect-restore]");
    if (salesProspectRestore) {
      if (!canWriteCRM()) return showToast("조회 전용 계정은 영업 대상을 복원할 수 없습니다.", "error");
      const prospect = salesProspectById(salesProspectRestore.dataset.salesProspectRestore);
      if (!prospect) return;
      const index = store.salesProspects.findIndex(item => item.id === prospect.id);
      store.salesProspects[index] = Sales.restoreRecord(prospect, salesActor());
      logAudit({ category: "복원", targetType: "영업 대상 건물", targetId: prospect.id, targetLabel: prospect.name || prospect.address, action: "영업 대상 복원", reason: "영업 활동 재개" });
      scheduleSave(); renderSalesProspectDrawer(prospect.id); renderPipeline(); showToast("영업 대상을 복원했습니다.", "success");
      return;
    }
    const salesActivityArchive = event.target.closest("[data-sales-activity-archive]");
    if (salesActivityArchive) {
      if (!canWriteCRM()) return showToast("조회 전용 계정은 영업 활동을 보관할 수 없습니다.", "error");
      const prospectId = salesActivityArchive.dataset.salesProspectId;
      const item = (store.salesActivities || []).find(record => record && record.id === salesActivityArchive.dataset.salesActivityArchive && record.prospectId === prospectId);
      if (!item || !await requestConfirmation({ title: "이 영업 활동을 보관할까요?", description: "영구삭제하지 않고 활동 이력에 보존합니다.", target: item.summary || item.id, confirmLabel: "보관", tone: "danger" })) return;
      store.salesActivities[store.salesActivities.findIndex(record => record && record.id === item.id)] = Sales.archiveRecord(item, salesActor());
      recalculateSalesProspectActivityCache(prospectId);
      logAudit({ category: "보관", targetType: "영업 활동", targetId: item.id, targetLabel: item.summary || item.id, action: "영업 활동 보관", reason: "사용자 확인 후 보관" });
      scheduleSave(); renderSalesProspectDrawer(prospectId); renderPipeline(); showToast("영업 활동을 보관했습니다.", "success");
      return;
    }
    const salesActivityRestore = event.target.closest("[data-sales-activity-restore]");
    if (salesActivityRestore) {
      if (!canWriteCRM()) return showToast("조회 전용 계정은 영업 활동을 복원할 수 없습니다.", "error");
      const prospectId = salesActivityRestore.dataset.salesProspectId;
      const item = (store.salesActivities || []).find(record => record && record.id === salesActivityRestore.dataset.salesActivityRestore && record.prospectId === prospectId);
      if (!item) return;
      try {
        const actor = salesActor();
        const restored = Sales.restoreRecord(item, actor);
        const activityContext = salesRelationContext(actor);
        activityContext.scripts = SalesStandards.scripts;
        Sales.assertActivity(restored, activityContext);
        store.salesActivities[store.salesActivities.findIndex(record => record && record.id === item.id)] = restored;
        recalculateSalesProspectActivityCache(prospectId);
        logAudit({ category: "복원", targetType: "영업 활동", targetId: item.id, targetLabel: item.summary || item.id, action: "영업 활동 복원", reason: "현재 관계정보 재검증 후 복원" });
        scheduleSave(); renderSalesProspectDrawer(prospectId); renderPipeline(); showToast("영업 활동을 복원했습니다.", "success");
      } catch (error) { showToast(error.message || "현재 연락처·호실 상태에서는 이 활동을 복원할 수 없습니다.", "error"); }
      return;
    }
    const salesEventArchive = event.target.closest("[data-sales-event-archive]");
    if (salesEventArchive) {
      if (!canWriteCRM()) return showToast("조회 전용 계정은 완료 증거를 보관할 수 없습니다.", "error");
      salesEventArchiveEditor(salesEventArchive.dataset.salesProspectId, salesEventArchive.dataset.salesEventArchive);
      return;
    }
    const salesEventRestore = event.target.closest("[data-sales-event-restore]");
    if (salesEventRestore) {
      if (!canWriteCRM()) return showToast("조회 전용 계정은 완료 증거를 복원할 수 없습니다.", "error");
      const prospectId = salesEventRestore.dataset.salesProspectId;
      const item = (store.salesEvents || []).find(record => record && record.id === salesEventRestore.dataset.salesEventRestore && record.prospectId === prospectId);
      if (!item) return;
      try {
        const actor = salesActor();
        const restored = Sales.restoreRecord(item, actor);
        Sales.assertEvent(restored, salesRelationContext(actor));
        store.salesEvents[store.salesEvents.findIndex(record => record && record.id === item.id)] = restored;
        const stageResult = recalculateSalesProspectStage(prospectId);
        logAudit({ category: "복원", targetType: "영업 완료 증거", targetId: item.id, targetLabel: item.type || item.id, action: `완료 증거 복원 · ${stageResult?.previousStage || ""} → ${stageResult?.prospect?.stage || ""}`, reason: item.archiveReason || "현재 관계정보 재검증 후 복원" });
        scheduleSave(); renderSalesProspectDrawer(prospectId); renderPipeline(); showToast("완료 증거를 복원하고 단계를 다시 계산했습니다.", "success");
      } catch (error) { showToast(error.message || "현재 연락처·호실 상태에서는 이 증거를 복원할 수 없습니다.", "error"); }
      return;
    }
    const salesRecordArchive = event.target.closest("[data-sales-record-archive]");
    if (salesRecordArchive) {
      if (!canWriteCRM()) return showToast("조회 전용 계정은 영업 기록을 보관할 수 없습니다.", "error");
      const collection = salesRecordArchive.dataset.salesCollection;
      if (collection === "salesUnits" && deferCanonicalMutation("영업 호실")) return;
      const id = salesRecordArchive.dataset.salesRecordArchive;
      const item = (store[collection] || []).find(record => record.id === id);
      if (!item || !await requestConfirmation({ title: "이 영업 기록을 보관할까요?", description: "영구삭제하지 않고 상세의 관리 영역에서 복원할 수 있습니다.", target: item.name || item.label || item.requirements || id, confirmLabel: "보관", tone: "danger" })) return;
      const prospectId = salesRecordArchive.dataset.salesProspectId;
      if (collection === "salesUnits") {
        if (!Number.isInteger(item.entityVersion) || item.entityVersion < 1) return showToast("최신 호실 버전을 확인한 뒤 다시 시도해 주세요.", "error");
        try {
          await commitCanonicalEntity({ entityType: "salesUnits", entityId: id, operation: "archive", expectedVersion: item.entityVersion, patch: {}, reason: "CRM 영업 호실 보관" });
          render(); renderSalesProspectDrawer(prospectId); showToast("영업 호실을 보관했습니다.", "success");
        } catch (error) { showToast(error.message || "영업 호실을 보관하지 못했습니다.", "error"); }
        return;
      }
      const index = store[collection].findIndex(record => record.id === id);
      store[collection][index] = Sales.archiveRecord(item, salesActor());
      if (["salesContacts", "salesUnits"].includes(collection)) recalculateSalesProspectStage(prospectId);
      logAudit({ category: "보관", targetType: "영업 기록", targetId: id, targetLabel: item.name || item.label || item.requirements || id, action: `${collection} 기록 보관`, reason: "사용자 확인 후 보관" });
      scheduleSave(); renderSalesProspectDrawer(prospectId); renderPipeline(); showToast("영업 기록을 보관했습니다.", "success");
      return;
    }
    const salesRecordRestore = event.target.closest("[data-sales-record-restore]");
    if (salesRecordRestore) {
      if (!canWriteCRM()) return showToast("조회 전용 계정은 영업 기록을 복원할 수 없습니다.", "error");
      const collection = salesRecordRestore.dataset.salesCollection;
      if (collection === "salesUnits" && deferCanonicalMutation("영업 호실")) return;
      const id = salesRecordRestore.dataset.salesRecordRestore;
      const item = (store[collection] || []).find(record => record.id === id);
      if (!item) return;
      const prospectId = salesRecordRestore.dataset.salesProspectId;
      if (collection === "salesUnits") {
        if (!Number.isInteger(item.entityVersion) || item.entityVersion < 1) return showToast("최신 호실 버전을 확인한 뒤 다시 시도해 주세요.", "error");
        try {
          await commitCanonicalEntity({ entityType: "salesUnits", entityId: id, operation: "restore", expectedVersion: item.entityVersion, patch: {}, reason: "CRM 영업 호실 복원" });
          render(); renderSalesProspectDrawer(prospectId); showToast("영업 호실을 복원했습니다.", "success");
        } catch (error) { showToast(error.message || "영업 호실을 복원하지 못했습니다.", "error"); }
        return;
      }
      const index = store[collection].findIndex(record => record.id === id);
      store[collection][index] = Sales.restoreRecord(item, salesActor());
      if (["salesContacts", "salesUnits"].includes(collection)) recalculateSalesProspectStage(prospectId);
      logAudit({ category: "복원", targetType: "영업 기록", targetId: id, targetLabel: item.name || item.label || item.requirements || id, action: `${collection} 기록 복원`, reason: "영업 기록 재사용" });
      scheduleSave(); renderSalesProspectDrawer(prospectId); renderPipeline(); showToast("영업 기록을 복원했습니다.", "success");
      return;
    }
    const salesEvidenceLink = event.target.closest("[data-sales-evidence-link]");
    if (salesEvidenceLink) {
      event.preventDefault();
      const rawUrl = String(salesEvidenceLink.dataset.salesEvidenceLink || "").trim();
      try {
        const url = new URL(rawUrl);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error("http 또는 https 링크만 열 수 있습니다.");
        const result = await api.openExternal(url.toString());
        if (!result.ok) showToast(result.error || "증거 링크를 열지 못했습니다.", "error");
      } catch (error) { showToast(error.message || "올바른 증거 링크를 확인해 주세요.", "error"); }
      return;
    }
    const workflowAction = event.target.closest("[data-workflow-action]");
    if (workflowAction) { if (!canWriteCRM()) return showToast("조회 전용 계정은 케이스 업무를 실행할 수 없습니다.", "error"); await executeCaseWorkflowAction(workflowAction); return; }
    const caseUpload = event.target.closest("[data-case-upload]");
    if (caseUpload) { if (!canWriteCRM()) return showToast("조회 전용 계정은 파일을 올릴 수 없습니다.", "error"); await uploadCaseFiles(caseUpload); return; }
    const quoteConfirm = event.target.closest("[data-case-quote-confirm]");
    if (quoteConfirm) { if (!canWriteCRM()) return showToast("조회 전용 계정은 견적을 확정할 수 없습니다.", "error"); await confirmWorkflowQuoteAmount(quoteConfirm); return; }
    const paymentAction = event.target.closest("[data-payment-action]");
    if (paymentAction) { if (!canWriteCRM()) return showToast("조회 전용 계정은 입금 업무를 실행할 수 없습니다.", "error"); await executePaymentAction(paymentAction); return; }
    const paymentSheetOpen = event.target.closest("[data-payment-sheet-open]");
    if (paymentSheetOpen) {
      const sheet = operations.caseSettings && operations.caseSettings.paymentScheduleSheet || {};
      const url = String(sheet.url || sheet.sheetUrl || "").trim();
      if (!url) return showToast("세입자 관리대장 주소를 찾지 못했습니다. 관리자에게 연결 상태를 확인해 주세요.", "error");
      const result = await api.openExternal(url);
      if (!result.ok) showToast(result.error || "세입자 관리대장을 열지 못했습니다.", "error");
      return;
    }
    const paymentBankSelected = event.target.closest("[data-payment-bank-selected]");
    if (paymentBankSelected) {
      if (paymentBuildingFilter === "all") return showToast("왼쪽에서 계좌를 연결할 건물을 먼저 선택해 주세요.");
      paymentBankBindingEditor(paymentBuildingFilter);
      return;
    }
    const paymentScheduleEdit = event.target.closest("[data-payment-schedule-edit]");
    if (paymentScheduleEdit) { paymentScheduleEditor(paymentScheduleEdit.dataset.paymentScheduleEdit); return; }
    const paymentBankEdit = event.target.closest("[data-payment-bank-edit]");
    if (paymentBankEdit) { paymentBankBindingEditor(paymentBankEdit.dataset.paymentBankEdit); return; }
    const paymentBankUnlink = event.target.closest("[data-payment-bank-unlink]");
    if (paymentBankUnlink) {
      if (!canWriteCRM()) return showToast("조회 전용 계정은 계좌 연결을 해제할 수 없습니다.", "error");
      if (!await requestConfirmation({ title: "입금계좌 연결을 해제할까요?", description: "건물별 입금 조회에 사용 중인 계좌 연결입니다.", warning: "연결만 해제되며 기존 입금 기록은 삭제되지 않습니다.", confirmLabel: "연결 해제", tone: "danger" })) return;
      const result = await api.savePaymentBankBinding({ buildingId: paymentBankUnlink.dataset.paymentBankUnlink, accountRef: "" });
      if (!result.ok) return showToast(result.error || "계좌 연결을 해제하지 못했습니다.", "error");
      await refreshOperations({ silent: true, render: false }); closeModal(); renderPayments(); showToast("입금계좌 연결을 해제했습니다.", "success"); return;
    }
    const paymentScheduleDelete = event.target.closest("[data-payment-schedule-delete]");
    if (paymentScheduleDelete) {
      if (!canWriteCRM()) return showToast("조회 전용 계정은 납부 일정을 삭제할 수 없습니다.", "error");
      const scheduleId = paymentScheduleDelete.dataset.paymentScheduleDelete;
      const schedule = operations.payments && operations.payments.schedules && operations.payments.schedules[scheduleId];
      if (!schedule) return showToast("삭제할 납부 일정을 찾지 못했습니다.", "error");
      if (!await requestConfirmation({ title: "이 납부 일정을 삭제할까요?", description: "건물·호실·세입자와 금액을 확인해 주세요.", target: [schedule.buildingName, schedule.unit, schedule.tenantName].filter(Boolean).join(" · "), message: krw(schedule.amount), warning: "입금 기록이 연결된 일정은 안전을 위해 삭제가 차단됩니다.", confirmLabel: "일정 삭제", tone: "danger" })) return;
      paymentScheduleDelete.disabled = true;
      const result = await api.deletePaymentSchedule({ scheduleId });
      if (!result.ok) { paymentScheduleDelete.disabled = false; return showToast(result.error || "납부 일정을 삭제하지 못했습니다.", "error"); }
      await refreshOperations({ silent: true, render: false });
      closeModal();
      renderPayments();
      pageMeta();
      showToast("납부 일정을 삭제했습니다.", "success");
      return;
    }
    const activityDelete = event.target.closest("[data-activity-delete]");
    if (activityDelete) { await deleteActivityRecord(activityDelete.dataset.activityDelete); return; }
    const taskDelete = event.target.closest("[data-task-delete]");
    if (taskDelete) { await deleteTaskRecord(taskDelete.dataset.taskDelete); return; }
    const contractDelete = event.target.closest("[data-contract-delete]");
    if (contractDelete) { await deleteContractRecord(contractDelete.dataset.contractDelete); return; }
    const partnerQuoteDelete = event.target.closest("[data-partner-quote-delete]");
    if (partnerQuoteDelete) { await deletePartnerQuoteRecord(partnerQuoteDelete.dataset.partnerQuoteDelete); return; }
    const partnerVendorDelete = event.target.closest("[data-partner-vendor-delete]");
    if (partnerVendorDelete) { await excludePartnerVendorRecord(partnerVendorDelete.dataset.partnerVendorDelete); return; }
    const customerDelete = event.target.closest("[data-customer-delete]");
    if (customerDelete) { await deleteCustomerRecord(customerDelete.dataset.customerDelete); return; }
    const buildingDelete = event.target.closest("[data-building-delete]");
    if (buildingDelete) { await deleteBuildingRecord(buildingDelete.dataset.buildingDelete); return; }
    const securityTabButton = event.target.closest("[data-security-tab]");
    if (securityTabButton) {
      securityTab = securityTabButton.dataset.securityTab || "assets";
      renderSecurity();
      return;
    }
    const securityEdit = event.target.closest("[data-security-edit]");
    if (securityEdit) {
      if (requireSecurityPermission(false)) securityAssetEditor(securityEdit.dataset.securityEdit);
      return;
    }
    const securityReturn = event.target.closest("[data-security-return]");
    if (securityReturn) {
      if (!requireSecurityPermission(false)) return;
      securityReturnEditor(securityReturn.dataset.securityReturn);
      return;
    }
    const securityDispose = event.target.closest("[data-security-dispose]");
    if (securityDispose) {
      if (requireSecurityPermission(false)) securityDispositionEditor(securityDispose.dataset.securityDispose);
      return;
    }
    const roleEdit = event.target.closest("[data-role-edit]");
    if (roleEdit) {
      if (requireSecurityPermission(true)) accessRoleEditor(roleEdit.dataset.roleEdit);
      return;
    }
    const incidentEdit = event.target.closest("[data-incident-edit]");
    if (incidentEdit) {
      if (requireSecurityPermission(false)) incidentEditor(incidentEdit.dataset.incidentEdit);
      return;
    }
    const calendarShift = event.target.closest("[data-work-calendar-shift]");
    if (calendarShift) {
      workCalendarMonth = WorkCalendar.shiftMonth(workCalendarMonth, Number(calendarShift.dataset.workCalendarShift) || 0);
      workCalendarDate = `${workCalendarMonth}-01`;
      renderBuildingCalendar();
      pageMeta();
      return;
    }
    const calendarToday = event.target.closest("[data-work-calendar-today]");
    if (calendarToday) {
      workCalendarDate = todayKey();
      workCalendarMonth = workCalendarDate.slice(0, 7);
      renderBuildingCalendar();
      pageMeta();
      return;
    }
    const directCalendarDate = event.target.closest("[data-work-calendar-date]");
    const calendarDay = event.target.closest(".work-calendar-day");
    const calendarDate = directCalendarDate || (calendarDay && !event.target.closest("button, a, input, select, textarea, [role='button']")
      ? calendarDay.querySelector("[data-work-calendar-date]")
      : null);
    if (calendarDate) {
      const date = String(calendarDate.dataset.workCalendarDate || "");
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        workCalendarDate = date;
        workCalendarMonth = date.slice(0, 7);
        renderBuildingCalendar();
        pageMeta();
      }
      return;
    }
    const calendarEdit = event.target.closest("[data-work-calendar-edit]");
    if (calendarEdit) { buildingScheduleEditor(calendarEdit.dataset.workCalendarEdit, workCalendarDate); return; }
    const calendarComplete = event.target.closest("[data-work-calendar-complete]");
    if (calendarComplete) {
      if (!canWriteCRM()) return showToast("조회 전용 계정은 일정 상태를 변경할 수 없습니다.", "error");
      const item = store.serviceRecords.find(record => record.id === calendarComplete.dataset.workCalendarComplete);
      if (!item || item.status === "cancelled") return showToast("변경할 일정을 찾지 못했습니다.", "error");
      const completed = item.status !== "completed";
      const input = {
        operation: completed ? "complete" : "update",
        requestId: crypto.randomUUID(),
        recordId: item.id,
        expectedUpdatedAt: String(item.updatedAt || ""),
        expectedCommitVersion: Number(item.calendarCommitVersion) || 0,
      };
      if (!completed) input.values = buildingScheduleCommitValues(Object.assign({}, item, { status: "planned", completedAt: "" }));
      const result = await commitBuildingScheduleRecord(input, calendarComplete);
      if (!result || result.ok !== true) {
        renderBuildingCalendar(); pageMeta();
        return showToast(serviceRecordErrorText(result), "error");
      }
      renderBuildingCalendar(); pageMeta(); showToast(completed ? "일정을 완료 처리했습니다." : "일정을 예정 상태로 되돌렸습니다.", "success");
      return;
    }
    const calendarCancel = event.target.closest("[data-work-calendar-cancel]");
    if (calendarCancel) {
      if (!canWriteCRM()) return showToast("조회 전용 계정은 일정을 취소할 수 없습니다.", "error");
      let item = store.serviceRecords.find(record => record.id === calendarCancel.dataset.workCalendarCancel);
      const form = calendarCancel.closest("#buildingScheduleForm");
      if (!item || !form) return showToast("취소할 일정을 찾지 못했습니다.", "error");
      if (!await requestConfirmation({ title: "이 일정을 취소할까요?", description: "캘린더에서는 숨기고 작업 기록은 안전하게 남깁니다.", target: item.title || "업무 일정", warning: "필요하면 작업관리에서 취소 기록을 확인할 수 있습니다.", confirmLabel: "일정 취소", tone: "danger" })) return;
      if (Number(form.dataset.authGeneration) !== authGeneration || String(form.dataset.authUid || "") !== currentAuthUid()) {
        closeModal();
        return showToast("로그인 사용자가 변경되어 일정을 취소하지 않았습니다.", "error");
      }
      item = store.serviceRecords.find(record => record.id === calendarCancel.dataset.workCalendarCancel);
      if (!item) return showToast("최신 일정이 반영되었습니다. 다시 확인해 주세요.", "error");
      const result = await commitBuildingScheduleRecord({
        operation: "cancel",
        requestId: String(form.dataset.requestId || crypto.randomUUID()),
        recordId: item.id,
        expectedUpdatedAt: String(form.dataset.openedUpdatedAt || ""),
        expectedCommitVersion: Number(form.dataset.openedCommitVersion) || 0,
      }, form);
      if (!result || result.ok !== true) {
        if (["BUILDING_SCHEDULE_CONFLICT", "BUILDING_SCHEDULE_NOT_FOUND"].includes(String(result && result.code || ""))) closeModal();
        render();
        return showToast(serviceRecordErrorText(result), "error");
      }
      closeModal(); renderBuildingCalendar(); pageMeta(); showToast("일정을 취소했습니다.", "success");
      return;
    }
    const workRecordCancel = event.target.closest("[data-work-record-cancel]");
    if (workRecordCancel) {
      if (!canWriteCRM()) return showToast("조회 전용 계정은 작업을 취소할 수 없습니다.", "error");
      const form = workRecordCancel.closest("#workRecordForm");
      let item = store.serviceRecords.find(record => record.id === workRecordCancel.dataset.workRecordCancel);
      if (!form || !item) return showToast("취소할 작업을 찾지 못했습니다.", "error");
      if (!await requestConfirmation({ title: "이 작업을 취소할까요?", description: "기록은 삭제하지 않고 취소 이력으로 남깁니다.", target: item.title || WorkManagement.typeLabel(item.serviceType), warning: "취소 후에는 내용을 변경할 수 없습니다.", confirmLabel: "작업 취소", tone: "danger" })) return;
      if (Number(form.dataset.authGeneration) !== authGeneration || String(form.dataset.authUid || "") !== currentAuthUid()) {
        closeModal();
        return showToast("로그인 사용자가 변경되어 작업을 취소하지 않았습니다.", "error");
      }
      item = store.serviceRecords.find(record => record.id === workRecordCancel.dataset.workRecordCancel);
      if (!item) return showToast("최신 작업이 반영되었습니다. 다시 확인해 주세요.", "error");
      const result = await commitBuildingScheduleRecord({
        operation: "cancel",
        requestId: String(form.dataset.requestId || crypto.randomUUID()),
        recordId: item.id,
        expectedUpdatedAt: String(form.dataset.openedUpdatedAt || ""),
        expectedCommitVersion: Number(form.dataset.openedCommitVersion) || 0,
      }, form);
      if (!result || result.ok !== true) {
        if (["BUILDING_SCHEDULE_CONFLICT", "BUILDING_SCHEDULE_NOT_FOUND"].includes(String(result && result.code || ""))) closeModal();
        render();
        return showToast(serviceRecordErrorText(result), "error");
      }
      closeModal(); currentView = "workManagement"; render(); showToast("작업을 취소 기록으로 남겼습니다.", "success");
      return;
    }
    const buildingLinkLookup = event.target.closest("[data-building-link-lookup]");
    if (buildingLinkLookup) {
      const form = buildingLinkLookup.closest("#buildingForm");
      const status = form && form.querySelector("[data-building-link-lookup-status]");
      const rawUrl = String(form && form.elements.naverBuildingUrl && form.elements.naverBuildingUrl.value || "").trim();
      if (!rawUrl) return showToast("네이버 지도 링크를 먼저 입력해 주세요.", "error");
      const sequence = ++buildingLookupSequence;
      const generation = authGeneration;
      const uid = currentAuthUid();
      const snapshots = Object.fromEntries(["name", "roadAddress", "jibunAddress"].map(name => [name, String(form.elements[name] && form.elements[name].value || "")]));
      const sameFormAndSession = () => sequence === buildingLookupSequence
        && form.isConnected
        && document.getElementById("buildingForm") === form
        && generation === authGeneration
        && uid === currentAuthUid();
      buildingLinkLookup.disabled = true;
      buildingLinkLookup.textContent = "정보 찾는 중…";
      if (status) { status.className = "loading"; status.textContent = "네이버 지도에서 주소·건물 정보를 확인하고 있습니다."; }
      try {
        const result = await api.lookupNaverBuilding(rawUrl);
        if (!sameFormAndSession()) return;
        if (String(form.elements.naverBuildingUrl.value || "").trim() !== rawUrl) {
          if (status) { status.className = ""; status.textContent = "입력한 링크가 바뀌어 이전 조회 결과는 적용하지 않았습니다."; }
          return;
        }
        if (!result || !result.ok) throw new Error(result && (result.error || result.message) || "건물 정보를 찾지 못했습니다.");
        const filled = [];
        const changedWhileLoading = [];
        const preservedMissing = [];
        const missing = [];
        const applyLookupValue = (name, value, label) => {
          const input = form.elements[name];
          if (!input) return;
          const next = String(value || "").trim();
          if (String(input.value || "") !== snapshots[name]) {
            changedWhileLoading.push(label);
            return;
          }
          if (!next) {
            if (String(input.value || "").trim()) preservedMissing.push(label);
            else missing.push(label);
            return;
          }
          input.value = next;
          filled.push(label);
        };
        form.elements.naverBuildingUrl.value = result.url || rawUrl;
        applyLookupValue("name", result.name, "건물명");
        applyLookupValue("roadAddress", result.roadAddress, "도로명 주소");
        applyLookupValue("jibunAddress", result.jibunAddress, "지번 주소");
        if (status) {
          const messages = [filled.length ? `${filled.join("·")}를 자동 입력했습니다.` : "자동 입력할 정보를 찾지 못했습니다."];
          if (changedWhileLoading.length) messages.push(`${changedWhileLoading.join("·")}는 조회 중 직접 수정되어 유지했습니다.`);
          if (preservedMissing.length) messages.push(`${preservedMissing.join("·")}는 네이버에서 확인되지 않아 기존 입력을 유지했습니다.`);
          if (missing.length) messages.push(`${missing.join("·")}는 네이버에서 확인되지 않아 직접 입력해 주세요.`);
          messages.push("내용을 확인한 뒤 건물을 등록하세요.");
          status.className = filled.length ? "success" : "error";
          status.textContent = messages.join(" ");
        }
        showToast(filled.length ? `${filled.join("·")} 자동 입력 완료` : "자동 입력할 정보를 찾지 못했습니다.", filled.length ? "success" : "error");
      } catch (error) {
        if (!sameFormAndSession()) return;
        if (status) { status.className = "error"; status.textContent = error.message || "건물 정보를 불러오지 못했습니다."; }
        showToast(error.message || "건물 정보를 불러오지 못했습니다.", "error");
      } finally {
        if (sequence === buildingLookupSequence && form.isConnected && document.getElementById("buildingForm") === form) {
          buildingLinkLookup.disabled = false;
          buildingLinkLookup.textContent = "건물 정보 불러오기";
        }
      }
      return;
    }
    const vendorLookup = event.target.closest("[data-vendor-lookup]");
    if (vendorLookup) {
      const form = vendorLookup.closest("#partnerVendorForm, #partnerQuoteForm");
      const status = form && form.querySelector("[data-vendor-lookup-status]");
      const rawUrl = form && form.elements.quoteUrl.value.trim();
      if (!rawUrl) return showToast("업체 링크를 먼저 입력해 주세요.", "error");
      vendorLookup.disabled = true;
      vendorLookup.textContent = "정보 찾는 중…";
      if (status) { status.className = "loading"; status.textContent = "업체 페이지를 확인하고 있습니다."; }
      try {
        const result = await api.lookupVendor(rawUrl);
        if (!result.ok) throw new Error(result.error || result.message || "업체 정보를 찾지 못했습니다.");
        const filled = [];
        const preserved = [];
        const missing = [];
        const preserveManualValues = form.id === "partnerVendorForm";
        const applyLookupValue = (name, value, label) => {
          const input = form.elements[name];
          if (!input) return;
          const previous = input.value.trim();
          const next = String(value || "").trim();
          if (next) {
            input.value = next;
            filled.push(label);
            return;
          }
          if (!preserveManualValues) input.value = "";
          if (previous && preserveManualValues) preserved.push(label);
          else missing.push(label);
        };
        form.elements.quoteUrl.value = result.url || rawUrl;
        applyLookupValue("vendor", result.vendor, "업체명");
        applyLookupValue("phone", result.phone, "연락처");
        applyLookupValue("alternatePhone", result.alternatePhone, "추가 연락처");
        if (form.id === "partnerVendorForm") {
          formatCustomerPhoneInput(form.elements.phone);
          formatCustomerPhoneInput(form.elements.alternatePhone);
        }
        applyLookupValue("service", result.service, "작업 내용");
        if (form.elements.phoneLabel && result.phoneLabel) form.elements.phoneLabel.value = result.phoneLabel;
        if (form.elements.alternatePhoneLabel && result.alternatePhoneLabel) form.elements.alternatePhoneLabel.value = result.alternatePhoneLabel;
        if (result.industry && Core.PARTNER_INDUSTRIES.includes(result.industry)) {
          form.elements.industry.value = result.industry;
          form.elements.industry.dispatchEvent(new Event("change", { bubbles: true }));
          filled.push("업종");
        }
        const uniqueFilled = [...new Set(filled)];
        if (status) {
          status.className = "success";
          const imported = uniqueFilled.length ? `${uniqueFilled.join("·")}을 새 링크 정보로 입력했습니다.` : "새 링크에서 입력할 정보를 찾지 못했습니다.";
          const preservedText = preserved.length ? ` ${[...new Set(preserved)].join("·")} 항목은 공개 정보가 없어 기존 입력을 유지했습니다.` : "";
          const missingText = missing.length ? ` ${[...new Set(missing)].join("·")} 항목은 공개 정보를 찾지 못했습니다.` : "";
          status.textContent = `${imported}${preservedText}${missingText} 내용을 확인해 주세요.`;
        }
        showToast(uniqueFilled.length ? `${uniqueFilled.join("·")} 자동 입력 완료` : "자동 입력할 새 정보를 찾지 못했습니다.", uniqueFilled.length ? "success" : "error");
      } catch (error) {
        if (status) { status.className = "error"; status.textContent = error.message; }
        showToast(error.message, "error");
      } finally {
        vendorLookup.disabled = false;
        vendorLookup.textContent = "업체 정보 불러오기";
      }
      return;
    }
    const partnerLink = event.target.closest("[data-partner-vendor-link], [data-partner-quote-link]");
    if (partnerLink) {
      const result = await api.openExternal(partnerLink.dataset.partnerVendorLink || partnerLink.dataset.partnerQuoteLink);
      if (!result.ok) showToast(result.error || "업체 링크를 열지 못했습니다.", "error");
      return;
    }
    const caseResourceLink = event.target.closest("[data-case-resource-link]");
    if (caseResourceLink) {
      const result = await api.openExternal(caseResourceLink.dataset.caseResourceLink);
      if (!result.ok) showToast(result.error || "케이스 자료를 열지 못했습니다.", "error");
      return;
    }
    const partnerQuoteEdit = event.target.closest("[data-partner-quote-edit]");
    if (partnerQuoteEdit) {
      if (!canWriteCRM()) return showToast("조회 전용 계정은 업체 상담을 수정할 수 없습니다.", "error");
      partnerQuoteEditor(partnerQuoteEdit.dataset.partnerQuoteEdit);
      return;
    }
    const partnerVendorEdit = event.target.closest("[data-partner-vendor-edit]");
    if (partnerVendorEdit) {
      if (!canWriteCRM()) return showToast("조회 전용 계정은 연락 업체를 수정할 수 없습니다.", "error");
      partnerVendorEditor(partnerVendorEdit.dataset.partnerVendorEdit);
      return;
    }
    const contractEdit = event.target.closest("[data-contract-edit]");
    if (contractEdit) { contractEditor(contractEdit.dataset.contractEdit); return; }
    const caseListModeButton = event.target.closest("[data-case-list-mode]");
    if (caseListModeButton) {
      caseListMode = caseListModeButton.dataset.caseListMode === "trash" ? "trash" : "active";
      const availableCases = caseListMode === "trash" ? trashCases() : activeCases();
      selectedCaseKey = workflowCaseKey(availableCases[0]);
      openCaseStepKey = "";
      renderCases();
      return;
    }
    const caseTrashButton = event.target.closest("[data-case-trash]");
    if (caseTrashButton) {
      if (!canWriteCRM()) return showToast("조회 전용 계정은 케이스를 휴지통으로 이동할 수 없습니다.", "error");
      const item = workflowCaseByAnyKey(caseTrashButton.dataset.caseTrash);
      if (!item) return showToast("휴지통으로 이동할 케이스를 찾지 못했습니다.", "error");
      const label = item.ticketNo || item.receiptNo || item.id || "케이스";
      if (!await requestConfirmation({ title: "이 케이스를 휴지통으로 이동할까요?", description: "휴지통에서 언제든 다시 복원할 수 있습니다.", target: `${label}\n${[item.name, item.building, item.room].filter(Boolean).join(" · ")}`, warning: "17단계 상태와 메모는 그대로 보관됩니다.", confirmLabel: "휴지통으로 이동", tone: "danger" })) return;
      caseTrashButton.disabled = true;
      const result = await api.saveWorkflowCase({ caseKey: workflowCaseKey(item), trashAction: "trash" });
      if (!result.ok) { caseTrashButton.disabled = false; return showToast(result.error || "케이스를 휴지통으로 이동하지 못했습니다.", "error"); }
      await refreshOperations({ silent: true, render: false });
      selectedCaseKey = workflowCaseKey(activeCases()[0]);
      openCaseStepKey = "";
      renderCases();
      pageMeta();
      showToast(`${label} 케이스를 휴지통으로 이동했습니다.`, "success");
      return;
    }
    const caseRestoreButton = event.target.closest("[data-case-restore]");
    if (caseRestoreButton) {
      if (!canWriteCRM()) return showToast("조회 전용 계정은 케이스를 복원할 수 없습니다.", "error");
      const item = workflowCaseByAnyKey(caseRestoreButton.dataset.caseRestore);
      if (!item) return showToast("복원할 케이스를 찾지 못했습니다.", "error");
      const label = item.ticketNo || item.receiptNo || item.id || "케이스";
      if (!await requestConfirmation({ title: "이 케이스를 복원할까요?", description: "복원하면 다시 진행 중인 케이스 목록에 표시됩니다.", target: label, confirmLabel: "케이스 복원", tone: "success" })) return;
      caseRestoreButton.disabled = true;
      const result = await api.saveWorkflowCase({ caseKey: workflowCaseKey(item), trashAction: "restore" });
      if (!result.ok) { caseRestoreButton.disabled = false; return showToast(result.error || "케이스를 복원하지 못했습니다.", "error"); }
      await refreshOperations({ silent: true, render: false });
      caseListMode = "active";
      selectedCaseKey = workflowCaseKey(item);
      openCaseStepKey = "";
      renderCases();
      pageMeta();
      showToast(`${label} 케이스를 복원했습니다.`, "success");
      return;
    }
    const caseDeleteButton = event.target.closest("[data-case-delete]");
    if (caseDeleteButton) {
      if (!canWriteCRM()) return showToast("조회 전용 계정은 케이스를 영구 삭제할 수 없습니다.", "error");
      let item = workflowCaseByAnyKey(caseDeleteButton.dataset.caseDelete);
      if (!item || item.deleted !== true) return showToast("휴지통에서 삭제할 케이스를 찾지 못했습니다.", "error");
      const label = item.ticketNo || item.receiptNo || item.id || "케이스";
      if (!await requestConfirmation({
        title: "이 케이스를 영구 삭제할까요?",
        description: "영구 삭제 후에는 휴지통에서도 복원할 수 없습니다.",
        target: `${label}\n${[item.name, item.building, item.room].filter(Boolean).join(" · ")}`,
        message: "케이스 기본정보, 17단계 상태·메모, 선택 업체, 견적·사진·승인·정산 등 케이스 안의 모든 기록이 함께 삭제됩니다.",
        warning: "이 작업은 되돌릴 수 없습니다. 연결된 외부 파일 자체는 별도 저장소에 남을 수 있습니다.",
        confirmLabel: "영구 삭제",
        tone: "danger"
      })) return;
      await refreshOperations({ silent: true, render: false });
      item = workflowCaseByAnyKey(caseDeleteButton.dataset.caseDelete);
      if (!item || item.deleted !== true) { renderCases(); return showToast("다른 사용자가 케이스를 복원하거나 삭제했습니다. 목록을 새로고침했습니다.", "error"); }
      caseDeleteButton.disabled = true;
      const result = await api.saveWorkflowCase({ caseKey: workflowCaseKey(item), trashAction: "delete" });
      if (!result.ok) { caseDeleteButton.disabled = false; return showToast(result.error || "케이스를 영구 삭제하지 못했습니다.", "error"); }
      await refreshOperations({ silent: true, render: false });
      caseListMode = "trash";
      selectedCaseKey = workflowCaseKey(trashCases()[0]);
      openCaseStepKey = "";
      renderCases();
      pageMeta();
      showToast(`${label} 케이스를 영구 삭제했습니다.`, "success");
      return;
    }
    const caseSelect = event.target.closest("[data-case-select]");
    if (caseSelect) {
      selectedCaseKey = caseSelect.dataset.caseSelect;
      openCaseStepKey = "";
      renderCases();
      return;
    }
    const caseNoteToggle = event.target.closest("[data-case-note-toggle]");
    if (caseNoteToggle) {
      const stepKey = caseNoteToggle.dataset.caseNoteToggle;
      const detailScroller = main.querySelector(".case-detail-scroll");
      const browserScroller = main.querySelector(".case-browser-list");
      const anchorTop = caseNoteToggle.getBoundingClientRect().top;
      const detailScrollTop = detailScroller?.scrollTop || 0;
      const browserScrollTop = browserScroller?.scrollTop || 0;
      openCaseStepKey = openCaseStepKey === stepKey ? "" : stepKey;
      renderCases();
      const nextDetailScroller = main.querySelector(".case-detail-scroll");
      const nextBrowserScroller = main.querySelector(".case-browser-list");
      const nextToggle = main.querySelector(`[data-case-note-toggle="${stepKey}"]`);
      if (nextBrowserScroller) nextBrowserScroller.scrollTop = browserScrollTop;
      if (nextDetailScroller) {
        nextDetailScroller.scrollTop = detailScrollTop;
        if (nextToggle) nextDetailScroller.scrollTop += nextToggle.getBoundingClientRect().top - anchorTop;
      }
      return;
    }
    const paymentModeButton = event.target.closest("[data-payment-mode]");
    if (paymentModeButton) { paymentMode = paymentModeButton.dataset.paymentMode === "oneOff" ? "oneOff" : "recurring"; renderPayments(); pageMeta(); return; }
    const paymentEvent = event.target.closest("[data-payment-event]");
    if (paymentEvent) { paymentStatusEditor(paymentEvent.dataset.paymentEvent); return; }
    const paymentMonthButton = event.target.closest("[data-payment-month]");
    if (paymentMonthButton) { shiftPaymentMonth(paymentMonthButton.dataset.paymentMonth); renderPayments(); pageMeta(); return; }
    const paymentBuildingCard = event.target.closest("[data-payment-building-id]");
    if (paymentBuildingCard) {
      paymentBuildingFilter = paymentBuildingCard.dataset.paymentBuildingId || "all";
      renderPayments();
      pageMeta();
      return;
    }
    const driveImportOpen = event.target.closest("[data-drive-import-open]");
    if (driveImportOpen) {
      const result = await api.openExternal(driveImportOpen.dataset.driveImportOpen);
      if (!result || result.ok !== true) showToast(result && result.error || "Drive 원본을 열지 못했습니다.", "error");
      return;
    }
    const driveImportApprove = event.target.closest("[data-drive-import-approve]");
    if (driveImportApprove) { driveImportApprovalEditor(driveImportApprove.dataset.driveImportApprove); return; }
    const driveImportReject = event.target.closest("[data-drive-import-reject]");
    if (driveImportReject) { driveImportRejectionEditor(driveImportReject.dataset.driveImportReject); return; }
    const buildingVacancies = event.target.closest("[data-building-vacancies], [data-vacancy-manage]");
    if (buildingVacancies) {
      const buildingId = buildingVacancies.dataset.buildingVacancies || buildingVacancies.dataset.vacancyManage;
      const building = buildingById(buildingId);
      if (!building || building.archivedAt) return showToast("건물을 찾지 못했습니다.", "error");
      selectedBuildingId = building.id;
      selectedVacancyBuildingId = building.id;
      vacancyStatusFilter = "attention";
      vacancyUnitQuery = "";
      closeModal();
      closeDrawer();
      currentView = "vacancies";
      render();
      return;
    }
    const vacancyBuilding = event.target.closest("[data-vacancy-building]");
    if (vacancyBuilding) {
      selectedVacancyBuildingId = vacancyBuilding.dataset.vacancyBuilding;
      vacancyStatusFilter = "attention";
      vacancyUnitQuery = "";
      renderVacancies();
      pageMeta();
      return;
    }
    const vacancyFilter = event.target.closest("[data-vacancy-filter]");
    if (vacancyFilter) {
      const nextFilter = vacancyFilter.dataset.vacancyFilter;
      vacancyStatusFilter = VACANCY_FILTER_ORDER.includes(nextFilter) ? nextFilter : "attention";
      renderVacancies();
      return;
    }
    const vacancySearchClear = event.target.closest("[data-vacancy-search-clear]");
    if (vacancySearchClear) {
      vacancyUnitQuery = "";
      renderVacancies();
      document.querySelector("[data-vacancy-unit-search]")?.focus();
      return;
    }
    const vacancyConfigure = event.target.closest("[data-vacancy-configure]");
    if (vacancyConfigure) {
      if (!canWriteCRM()) return showToast("조회 전용 계정은 층·호실 구성을 변경할 수 없습니다.", "error");
      vacancyConfigurationEditor(vacancyConfigure.dataset.vacancyConfigure);
      return;
    }
    const vacancyUnitEdit = event.target.closest("[data-vacancy-unit-edit]");
    if (vacancyUnitEdit) {
      if (!canWriteCRM()) return showToast("조회 전용 계정은 호실 상태를 변경할 수 없습니다.", "error");
      buildingUnitEditor(vacancyUnitEdit.dataset.buildingId, vacancyUnitEdit.dataset.vacancyUnitEdit);
      return;
    }
    const vacancyFloorAdd = event.target.closest("[data-vacancy-floor-add]");
    if (vacancyFloorAdd) {
      if (!canWriteCRM()) return showToast("조회 전용 계정은 층 구성을 변경할 수 없습니다.", "error");
      const form = vacancyFloorAdd.closest("#vacancyConfigurationForm");
      if (!form) return;
      const floors = captureVacancyConfiguration(form);
      const ordinaryOrders = floors.map(floor => floor.floorOrder).filter(order => Number.isFinite(order) && order > 0 && order < 999);
      const floorOrder = ordinaryOrders.length ? Math.max(...ordinaryOrders) + 1 : 1;
      floors.push({ key: crypto.randomUUID(), floorLabel: `${floorOrder}층`, floorOrder, units: [] });
      renderVacancyConfigurationFloors(form, floors);
      form.querySelector(`[data-floor-key="${attr(floors.at(-1).key)}"] [data-vacancy-floor-label]`)?.focus();
      return;
    }
    const vacancyFloorRange = event.target.closest("[data-vacancy-floor-range]");
    if (vacancyFloorRange) {
      if (!canWriteCRM()) return showToast("조회 전용 계정은 층 구성을 변경할 수 없습니다.", "error");
      const form = vacancyFloorRange.closest("#vacancyConfigurationForm");
      if (!form) return;
      const total = Math.min(200, Math.max(1, Core.nonNegativeInteger(form.querySelector("[data-vacancy-floor-total]")?.value)));
      form.querySelector("[data-vacancy-floor-total]").value = total;
      const floors = captureVacancyConfiguration(form);
      for (let floorOrder = 1; floorOrder <= total; floorOrder += 1) {
        const label = `${floorOrder}층`;
        const exists = floors.some(floor => floor.floorOrder === floorOrder || normalizeVacancyUnitLabel(floor.floorLabel) === normalizeVacancyUnitLabel(label));
        if (!exists) floors.push({ key: crypto.randomUUID(), floorLabel: label, floorOrder, units: [] });
      }
      floors.sort((left, right) => left.floorOrder - right.floorOrder || left.floorLabel.localeCompare(right.floorLabel, "ko", { numeric: true }));
      renderVacancyConfigurationFloors(form, floors);
      return;
    }
    const vacancyAutoLabel = event.target.closest("[data-vacancy-auto-label]");
    if (vacancyAutoLabel) {
      if (!canWriteCRM()) return showToast("조회 전용 계정은 호실 구성을 변경할 수 없습니다.", "error");
      const form = vacancyAutoLabel.closest("#vacancyConfigurationForm");
      if (!form) return;
      const floorKey = vacancyAutoLabel.dataset.vacancyAutoLabel;
      const floors = captureVacancyConfiguration(form);
      const floor = floors.find(item => item.key === floorKey);
      const row = [...form.querySelectorAll("[data-vacancy-floor-row]")].find(item => item.dataset.floorKey === floorKey);
      if (!floor || !row) return;
      if (!floor.floorLabel) return showToast("자동 라벨을 만들 층명을 입력해 주세요.", "error");
      const requestedCount = Math.min(200, Core.nonNegativeInteger(row.querySelector("[data-vacancy-floor-count]")?.value));
      const existingUnits = floor.units.filter(unit => unit.entityId);
      const desiredCount = Math.max(requestedCount, existingUnits.length);
      const otherFloorUnitCount = floors.filter(item => item.key !== floorKey).reduce((total, item) => total + item.units.length, 0);
      if (otherFloorUnitCount + desiredCount > 200) {
        return showToast(`한 건물의 호실은 최대 200개까지 설정할 수 있습니다. 현재 다른 층에 ${otherFloorUnitCount}개가 있습니다.`, "error");
      }
      if (requestedCount < existingUnits.length) showToast(`기존 호실 ${existingUnits.length}개는 유지됩니다.`);
      const draftUnits = floor.units.filter(unit => !unit.entityId).slice(0, Math.max(0, desiredCount - existingUnits.length));
      floor.units = [...existingUnits, ...draftUnits];
      const usedLabels = new Set(floors.filter(item => item.key !== floorKey).flatMap(item => item.units).map(unit => normalizeVacancyUnitLabel(unit.label)).filter(Boolean));
      floor.units.forEach(unit => usedLabels.add(normalizeVacancyUnitLabel(unit.label)));
      const legacyLabels = legacyVacancyLabels(buildingById(form.dataset.buildingId));
      let sequence = 1;
      while (floor.units.length < desiredCount) {
        let label = generatedVacancyUnitLabel(floor.floorLabel, sequence);
        while (usedLabels.has(normalizeVacancyUnitLabel(label))) {
          sequence += 1;
          label = generatedVacancyUnitLabel(floor.floorLabel, sequence);
        }
        const normalizedLabel = normalizeVacancyUnitLabel(label);
        floor.units.push({ entityId: "", expectedVersion: 0, label, status: legacyLabels.has(normalizedLabel) ? "vacant" : "unknown" });
        usedLabels.add(normalizedLabel);
        sequence += 1;
      }
      renderVacancyConfigurationFloors(form, floors);
      return;
    }
    const vacancyFloorRemove = event.target.closest("[data-vacancy-floor-remove]");
    if (vacancyFloorRemove) {
      if (!canWriteCRM()) return showToast("조회 전용 계정은 층 구성을 변경할 수 없습니다.", "error");
      const form = vacancyFloorRemove.closest("#vacancyConfigurationForm");
      if (!form) return;
      const floors = captureVacancyConfiguration(form);
      const target = floors.find(floor => floor.key === vacancyFloorRemove.dataset.vacancyFloorRemove);
      if (target?.units.some(unit => unit.entityId)) return showToast("기존 호실이 있는 층은 제거할 수 없습니다.", "error");
      if (floors.length <= 1) return showToast("층을 한 개 이상 유지해 주세요.", "error");
      renderVacancyConfigurationFloors(form, floors.filter(floor => floor.key !== vacancyFloorRemove.dataset.vacancyFloorRemove));
      return;
    }
    const buildingEdit = event.target.closest("[data-building-edit]");
    if (buildingEdit) { buildingEditor(buildingEdit.dataset.buildingEdit); return; }
    const buildingRestore = event.target.closest("[data-building-restore]");
    if (buildingRestore) {
      if (deferCanonicalMutation("건물")) return;
      const item = (store.buildings || []).find(building => building && building.id === buildingRestore.dataset.buildingRestore);
      if (!item || !Number.isInteger(item.entityVersion) || item.entityVersion < 1) return showToast("최신 건물 버전을 확인한 뒤 다시 시도해 주세요.", "error");
      try {
        await commitCanonicalEntity({ entityType: "buildings", entityId: item.id, operation: "restore", expectedVersion: item.entityVersion, patch: {}, reason: "CRM 건물 복원" });
        selectedBuildingId = item.id; render(); showToast("건물을 복원했습니다.", "success");
      } catch (error) { showToast(error.message || "건물을 복원하지 못했습니다.", "error"); }
      return;
    }
    const buildingUnitAdd = event.target.closest("[data-building-unit-add]");
    if (buildingUnitAdd) { buildingUnitEditor(buildingUnitAdd.dataset.buildingUnitAdd, ""); return; }
    const buildingUnitEdit = event.target.closest("[data-building-unit-edit]");
    if (buildingUnitEdit) { buildingUnitEditor(buildingUnitEdit.dataset.buildingId, buildingUnitEdit.dataset.buildingUnitEdit); return; }
    const buildingUnitArchive = event.target.closest("[data-building-unit-archive]");
    if (buildingUnitArchive) {
      if (deferCanonicalMutation("건물 호실")) return;
      const item = (store.buildingUnits || []).find(unit => unit && unit.id === buildingUnitArchive.dataset.buildingUnitArchive);
      if (!item || !Number.isInteger(item.entityVersion) || item.entityVersion < 1) return showToast("최신 호실 버전을 확인한 뒤 다시 시도해 주세요.", "error");
      if (!await requestConfirmation({ title: "이 호실을 보관할까요?", description: "활성 호실 목록에서는 숨기고 기록은 남깁니다.", target: item.label || item.unitLabel || "호실", confirmLabel: "호실 보관", tone: "danger" })) return;
      try {
        await commitCanonicalEntity({ entityType: "buildingUnits", entityId: item.id, operation: "archive", expectedVersion: item.entityVersion, patch: {}, reason: "CRM 건물 호실 보관" });
        closeModal(); render(); showToast("건물 호실을 보관했습니다.", "success");
      } catch (error) { showToast(error.message || "건물 호실을 보관하지 못했습니다.", "error"); }
      return;
    }
    const buildingUnitRestore = event.target.closest("[data-building-unit-restore]");
    if (buildingUnitRestore) {
      if (deferCanonicalMutation("건물 호실")) return;
      const item = (store.buildingUnits || []).find(unit => unit && unit.id === buildingUnitRestore.dataset.buildingUnitRestore);
      if (!item || !Number.isInteger(item.entityVersion) || item.entityVersion < 1) return showToast("최신 호실 버전을 확인한 뒤 다시 시도해 주세요.", "error");
      try {
        await commitCanonicalEntity({ entityType: "buildingUnits", entityId: item.id, operation: "restore", expectedVersion: item.entityVersion, patch: {}, reason: "CRM 건물 호실 복원" });
        selectedBuildingId = buildingUnitRestore.dataset.buildingId; render(); showToast("건물 호실을 복원했습니다.", "success");
      } catch (error) { showToast(error.message || "건물 호실을 복원하지 못했습니다.", "error"); }
      return;
    }
    const buildingNewCase = event.target.closest("[data-building-new-case]");
    if (buildingNewCase) { workflowCaseEditor(buildingNewCase.dataset.buildingNewCase); return; }
    const buildingPayments = event.target.closest("[data-building-payments]");
    if (buildingPayments) {
      const building = buildingById(buildingPayments.dataset.buildingPayments);
      if (!building) return showToast("건물 정보를 찾지 못했습니다.", "error");
      paymentBuildingFilter = paymentFilterIdForBuilding(building);
      currentView = "payments";
      render();
      await refreshOperations({ silent: true });
      return;
    }
    const buildingCaseOpen = event.target.closest("[data-building-case-open]");
    if (buildingCaseOpen) {
      selectedCaseKey = buildingCaseOpen.dataset.buildingCaseOpen;
      caseListMode = "active";
      currentView = "cases";
      render();
      return;
    }
    const buildingPaymentOpen = event.target.closest("[data-building-payment-open]");
    if (buildingPaymentOpen) {
      paymentBuildingFilter = buildingPaymentOpen.dataset.buildingPaymentId || "all";
      currentView = "payments";
      render();
      paymentStatusEditor(buildingPaymentOpen.dataset.buildingPaymentOpen);
      return;
    }
    const buildingJump = event.target.closest("[data-building-jump]");
    if (buildingJump) {
      selectedBuildingId = buildingJump.dataset.buildingJump;
      closeDrawer();
      currentView = "buildings";
      render();
      requestDriveImportCandidatesRefresh();
      await refreshOperations({ silent: true });
      return;
    }
    const buildingOpen = event.target.closest("[data-building-open]");
    if (buildingOpen) {
      selectedBuildingId = buildingOpen.dataset.buildingOpen;
      renderBuildings();
      pageMeta();
      return;
    }
    const relationshipFollowup = event.target.closest("[data-relationship-followup]");
    if (relationshipFollowup) { consultationEditor(relationshipFollowup.dataset.relationshipFollowup, "relationships"); return; }
    const relationshipPlan = event.target.closest("[data-relationship-plan]");
    if (relationshipPlan) { relationshipEditor(relationshipPlan.dataset.relationshipPlan); return; }
    const relationshipOpen = event.target.closest("[data-relationship-open]");
    if (relationshipOpen) { renderRelationshipDrawer(relationshipOpen.dataset.relationshipOpen); return; }
    const customerOpen = event.target.closest("[data-customer-open]");
    if (customerOpen) { renderCustomerDrawer(customerOpen.dataset.customerOpen); return; }
    const taskToggle = event.target.closest("[data-task-toggle]");
    if (taskToggle) {
      const task = store.tasks.find(item => item.id === taskToggle.dataset.taskToggle);
      if (!canWriteCRM()) return showToast("조회 전용 계정은 할 일을 변경할 수 없습니다.", "error");
      if (task) {
        task.status = task.status === "완료" ? "할 일" : "완료";
        task.updatedAt = new Date().toISOString();
        logAudit({ category: "변경", targetType: "영업 할 일", targetId: task.id, targetLabel: task.title, action: `상태를 ${task.status}(으)로 변경`, reason: "영업 할 일 관리" });
        scheduleSave(); render(); if (selectedCustomerId) renderCustomerDrawer(selectedCustomerId);
      }
      return;
    }
    const contractType = event.target.closest("[data-contract-type-filter]");
    if (contractType) { contractTypeFilter = contractType.dataset.contractTypeFilter; renderContracts(); return; }
    const taskFilter = event.target.closest("[data-task-filter]");
    if (taskFilter) { taskStatusFilter = taskFilter.dataset.taskFilter; renderTasks(); return; }
    const partnerQuoteFilter = event.target.closest("[data-partner-quote-filter]");
    if (partnerQuoteFilter) { partnerQuoteStatusFilter = partnerQuoteFilter.dataset.partnerQuoteFilter; renderPartnerQuotes(); return; }
    const actionControl = event.target.closest("[data-action]");
    const action = actionControl?.dataset.action;
    if (!action) return;
    if (action === "logout") {
      let result = await api.logout({ confirmed: false });
      if (result && result.code === "FIELD_LOGOUT_PENDING") {
        const count = Number(result.pendingUploads && result.pendingUploads.count || 0);
        const confirmed = await requestConfirmation({
          title: "미완료 업로드가 있습니다",
          description: "로그아웃하면 현장 사진이나 서류 전송이 끝나지 않을 수 있습니다.",
          target: `미완료 업로드 ${count}건`,
          warning: "가능하면 업로드를 마친 뒤 로그아웃해 주세요.",
          confirmLabel: "그래도 로그아웃",
          tone: "warning",
        });
        if (!confirmed) return;
        result = await api.logout({ confirmed: true });
      }
      if (!result || !result.ok) return showToast(result && result.error || "로그아웃 전에 현장 업무 저장 상태를 확인해 주세요.", "error");
      location.reload();
    }
    else if (action === "check-update") {
      if (currentUpdate.status === "ready") {
        const result = await api.installUpdate();
        if (!result.ok) showToast(result.error || "업데이트를 시작하지 못했습니다.", "error");
      } else {
        showToast("새 버전을 확인하고 있습니다.");
        updateUpdaterUI(await api.checkForUpdates());
      }
    }
    else if (action === "new-sales-prospect") {
      if (!canWriteCRM()) return showToast("조회 전용 계정은 영업 대상 건물을 등록할 수 없습니다.", "error");
      salesProspectEditor("");
    }
    else if (action === "new-field-job") showToast("현장 업무 등록 화면은 연결 정보를 준비하고 있습니다. 현재 현장 업무 조회는 그대로 사용할 수 있습니다.");
    else if (action === "new-work-record") workRecordEditor("");
    else if (action === "new-building-schedule") buildingScheduleEditor("", actionControl.dataset.scheduleDate || workCalendarDate);
    else if (action === "reconnect-field") {
      fieldConnectionState = Object.assign({}, fieldConnectionState, { status: "connecting", message: "현장 업무에 다시 연결하고 있습니다.", ready: false });
      const result = await api.reconnectFieldPlatform();
      if (!result.ok) {
        fieldConnectionState = Object.assign({}, fieldConnectionState, { status: "disconnected", message: result.error || "다시 연결하지 못했습니다.", ready: false });
        renderFieldOperations();
      } else {
        fieldConnectionState = Object.assign({}, fieldConnectionState, { status: "connecting", message: "이전 현장 업무 화면을 복원하고 있습니다.", ready: true });
        const generation = ++fieldOpenGeneration;
        await openFieldOperations(generation);
      }
    }
    else if (action === "reauthenticate-field-google") {
      if (fieldReauthInProgress || fieldConnectionState.status !== "auth-required" || !currentAuth.user) return;
      const generation = authGeneration;
      const uid = currentAuthUid();
      fieldReauthInProgress = true;
      fieldConnectionState = Object.assign({}, fieldConnectionState, {
        message: "Google 계정 확인 창에서 현재 CRM 계정을 선택해 주세요.",
        ready: false,
      });
      renderFieldOperations();
      let result;
      try {
        result = await api.reauthenticateFieldPlatform();
      } catch (_error) {
        result = { ok: false, code: "FIELD_REAUTH_FAILED" };
      } finally {
        fieldReauthInProgress = false;
      }
      if (generation !== authGeneration || uid !== currentAuthUid() || currentView !== "fieldOperations") return;
      if (!result || !result.ok) {
        fieldConnectionState = Object.assign({}, fieldConnectionState, {
          status: "auth-required",
          message: fieldReauthenticationMessage(result && result.code),
          ready: false,
        });
        renderFieldOperations();
        return;
      }
      fieldConnectionState = Object.assign({}, fieldConnectionState, {
        status: "connecting",
        message: "Google 계정 확인이 완료되었습니다. 현장 업무를 연결하고 있습니다.",
        ready: false,
      });
      renderFieldOperations();
    }
    else if (action === "open-sales-standards") openSalesStandards("");
    else if (action === "new-customer") customerEditor("");
    else if (action === "new-building") buildingEditor("");
    else if (action === "configure-vacancy") {
      if (!canWriteCRM()) return showToast("조회 전용 계정은 층·호실 구성을 변경할 수 없습니다.", "error");
      const buildingId = selectedVacancyBuildingId || (store.buildings || []).find(building => building && !building.archivedAt)?.id || "";
      if (!buildingId) return showToast("층·호실을 구성할 건물을 먼저 등록해 주세요.", "error");
      vacancyConfigurationEditor(buildingId);
    }
    else if (action === "new-contract") contractEditor("");
    else if (action === "new-one-off-contract") contractEditor("", true);
    else if (action === "new-workflow-case") workflowCaseEditor();
    else if (action === "new-payment-schedule") paymentScheduleEditor("");
    else if (action === "refresh-operations") await refreshOperations();
    else if (action === "refresh-workflow-vendors") {
      const result = await api.loadWorkflowVendors({ force: true });
      if (!result.ok) showToast(result.error || "업체 목록을 새로고침하지 못했습니다.", "error");
      else { workflowVendors = result.vendors || []; workflowVendorError = ""; renderCases(); showToast("최신 업체 목록을 반영했습니다.", "success"); }
    }
    else if (action === "open-guide") showWelcomeGuide();
    else if (action === "finish-guide") finishWelcomeGuide(false);
    else if (action === "guide-new-customer") finishWelcomeGuide(true);
    else if (action === "close-modal") closeModal();
    else if (action === "close-drawer") closeDrawer();
    else if (action === "show-selected-customer") renderCustomerDrawer(selectedCustomerId);
    else if (action === "edit-selected-customer") {
      const customerId = selectedCustomerId;
      closeDrawer();
      customerEditor(customerId);
    }
    else if (action === "new-consultation") consultationEditor(selectedCustomerId, currentView);
    else if (action === "new-partner-vendor") {
      if (!canWriteCRM()) return showToast("조회 전용 계정은 연락 업체를 등록할 수 없습니다.", "error");
      partnerVendorEditor("");
    }
    else if (action === "new-partner-quote") {
      if (!canWriteCRM()) return showToast("조회 전용 계정은 업체 상담을 등록할 수 없습니다.", "error");
      partnerQuoteEditor("");
    }
    else if (action === "new-task") taskEditor("");
    else if (action === "new-selected-task") taskEditor(selectedCustomerId);
    else if (action === "new-security-asset") { if (requireSecurityPermission(false)) securityAssetEditor(""); }
    else if (action === "new-access-role") { if (requireSecurityPermission(true)) accessRoleEditor(""); }
    else if (action === "new-audit") { if (requireSecurityPermission(false)) auditEditor(); }
    else if (action === "new-incident") { if (requireSecurityPermission(false)) incidentEditor(""); }
    else if (action === "backup") {
      if (!canAdministerSecurity()) return showToast("백업 파일은 관리자만 저장할 수 있습니다.", "error");
      const result = await api.backup(store);
      if (result.ok) { logAudit({ category: "백업", targetType: "백업", targetLabel: Core.dayKey(), action: "CRM 전체 데이터 백업 생성", reason: "정기·수동 백업" }); scheduleSave(); showToast("CRM 백업을 저장했습니다.", "success"); }
    } else if (action === "restore") {
      try {
        const result = await api.restore();
        if (result.ok) { store = result.data; logAudit({ category: "백업", targetType: "백업", targetLabel: "복원 파일", action: "CRM 백업 복원", reason: "데이터 복구" }); scheduleSave(); closeDrawer(); render(); showToast("백업을 불러왔습니다.", "success"); }
        else if (result.error) showToast(result.error, "error");
      } catch (error) { showToast(`백업 불러오기 실패: ${error.message}`, "error"); }
    }
  });

  document.addEventListener("change", async event => {
    if (event.target.matches("[data-work-calendar-building]")) {
      workCalendarBuildingId = event.target.value || "all";
      renderBuildingCalendar();
      pageMeta();
      return;
    }
    if (event.target.matches("[data-vacancy-status-select]")) {
      if (!canWriteCRM()) {
        event.target.value = event.target.dataset.currentStatus || "unknown";
        return showToast("조회 전용 계정은 호실 상태를 변경할 수 없습니다.", "error");
      }
      await saveVacancyQuickStatus(event.target.dataset.buildingId, event.target.dataset.unitId, event.target.value, event.target);
      return;
    }
    if (event.target.matches('#vacancyScheduleForm [name="availableFrom"]')) {
      updateVacancyScheduleGuide(event.target.closest("#vacancyScheduleForm"));
      return;
    }
    if (event.target.matches("#vacancyConfigurationForm [data-vacancy-unit-status]")) {
      renderVacancyConfigurationPreview(event.target.closest("#vacancyConfigurationForm"));
      return;
    }
    if (event.target.matches('#buildingUnitForm [name="status"], #buildingUnitForm [name="availableFrom"]')) {
      const form = event.target.closest("#buildingUnitForm");
      const status = form?.elements.status?.value || "unknown";
      const dateInput = form?.elements.availableFrom;
      const guide = form?.querySelector(".vacancy-date-guide");
      const requiresDate = status === "move_out_scheduled";
      if (dateInput) dateInput.required = requiresDate;
      const pastDue = requiresDate && /^\d{4}-\d{2}-\d{2}$/.test(dateInput?.value || "") && dateInput.value < todayKey();
      if (guide) {
        guide.classList.toggle("warning", pastDue);
        guide.textContent = pastDue
          ? "공실 예정일이 지났습니다. 실제 상태를 확인해 주세요. 날짜가 지났다고 자동으로 공실 처리하지 않습니다."
          : requiresDate ? "공실 예정 상태에는 공실 예정일을 반드시 입력해 주세요." : "공실 예정 상태를 선택할 때만 예정일이 저장됩니다.";
      }
      return;
    }
    const workFilter = event.target.closest("[data-work-filter]");
    if (workFilter) {
      workFilters[workFilter.dataset.workFilter] = workFilter.value || "all";
      renderWorkManagement();
      return;
    }
    if (event.target.matches('#salesEventForm [name="type"]')) refreshSalesEventChannelField(event.target.form);
    const customerSalesFilter = event.target.closest("[data-customer-sales-stage-filter]");
    if (customerSalesFilter) {
      customerSalesStageFilter = customerSalesFilter.value || "all";
      renderCustomers();
      return;
    }
    if (event.target.matches('#workflowCaseCreateForm [name="crmBuildingId"], #workflowCaseBasicForm [name="crmBuildingId"]')) {
      const form = event.target.form;
      const building = buildingById(event.target.value);
      if (form && building) {
        if (form.elements.building) form.elements.building.value = building.name || "";
        if (form.elements.address) form.elements.address.value = building.address || "";
      }
      return;
    }
    if (event.target.matches('#workflowCaseCreateForm [name="crmCustomerId"], #workflowCaseBasicForm [name="crmCustomerId"]')) {
      const form = event.target.form;
      const customer = customerById(event.target.value);
      if (form && customer) {
        if (form.elements.name) form.elements.name.value = customer.name || "";
        if (form.elements.phone) form.elements.phone.value = customerPhoneText(customer.phone);
        if (form.elements.email) form.elements.email.value = customer.email || "";
      }
      return;
    }
    const vendorSelection = event.target.closest("[data-case-vendor-select]");
    if (vendorSelection) {
      if (!canWriteCRM()) {
        vendorSelection.checked = !vendorSelection.checked;
        return showToast("조회 전용 계정은 업체 선택을 변경할 수 없습니다.", "error");
      }
      vendorSelection.disabled = true;
      let vendor = null;
      try { vendor = JSON.parse(vendorSelection.dataset.vendorJson || "null"); } catch (_) { vendor = null; }
      const result = await api.saveWorkflowCase({ caseKey: vendorSelection.dataset.caseKey, vendorSelection: { id: vendorSelection.dataset.caseVendorSelect, selected: vendorSelection.checked, vendor } });
      if (!result.ok) {
        vendorSelection.checked = !vendorSelection.checked;
        vendorSelection.disabled = false;
        return showToast(result.error || "업체 선택을 저장하지 못했습니다.", "error");
      }
      await refreshOperations({ silent: true, render: false });
      renderCases();
      showToast(vendorSelection.checked ? "견적 요청 업체를 선택했습니다." : "업체 선택을 해제했습니다.", "success");
      return;
    }
    if (event.target.matches('#paymentScheduleForm [name="buildingId"]')) {
      const building = paymentBuildings().find(item => item.id === event.target.value);
      const form = event.target.form;
      if (building && form && !form.elements.buildingName.value.trim()) form.elements.buildingName.value = building.name;
    }
    const caseStep = event.target.closest("[data-case-step-status]");
    if (caseStep) {
      if (!canWriteCRM()) {
        renderCases();
        return showToast("조회 전용 계정은 단계 상태를 변경할 수 없습니다.", "error");
      }
      const caseItem = workflowCaseByKey(caseStep.dataset.caseKey);
      const stepKey = caseStep.dataset.caseStepStatus;
      const nextKey = `c${Number(stepKey.slice(1)) + 1}`;
      const result = await api.saveWorkflowCase({ caseKey: caseStep.dataset.caseKey, stepKey, stepStatus: caseStep.value, startNext: !(caseItem && caseItem.status && caseItem.status[nextKey]) });
      if (!result.ok) { showToast(result.error || "단계 상태를 저장하지 못했습니다.", "error"); await refreshOperations({ silent: true }); return; }
      await refreshOperations({ silent: true, render: false });
      renderCases();
      showToast(`${Core.WORKFLOW_STEPS[Number(stepKey.slice(1)) - 1]} · ${caseStep.options[caseStep.selectedIndex].text}`, "success");
      return;
    }
    const paymentBuilding = event.target.closest("[data-payment-building-filter]");
    if (paymentBuilding) {
      paymentBuildingFilter = paymentBuilding.value;
      renderPayments();
      pageMeta();
      return;
    }
    const industryFilter = event.target.closest("[data-partner-industry-filter]");
    if (industryFilter) {
      partnerQuoteIndustryFilter = industryFilter.value;
      renderPartnerQuotes();
      return;
    }
    const vendorIndustryFilter = event.target.closest("[data-partner-vendor-industry-filter]");
    if (vendorIndustryFilter) {
      partnerVendorIndustryFilter = vendorIndustryFilter.value;
      renderPartnerVendors();
      return;
    }
    const contractStatus = event.target.closest("[data-contract-status-filter]");
    if (contractStatus) {
      contractStatusFilter = contractStatus.value;
      renderContracts();
      return;
    }
    if (event.target.matches('#contractForm input[name="types"]')) refreshContractTypeFields(event.target.form);
    if (event.target.matches('#contractForm [name="customerId"]')) refreshContractBuildings(event.target.form);
    if (event.target.matches('#partnerQuoteForm [name="industry"]')) {
      const form = event.target.form;
      const selectedVendor = partnerVendorById(form && form.elements.vendorId && form.elements.vendorId.value);
      if (selectedVendor && partnerIndustry(selectedVendor) !== event.target.value) form.elements.vendorId.value = "";
      const current = {};
      document.querySelectorAll('#partnerIndustryChecklist input[type="checkbox"]').forEach(input => { current[input.name.replace("check__", "")] = input.checked; });
      const checklist = document.getElementById("partnerIndustryChecklist");
      const previousIndustry = String(checklist && checklist.dataset.industry || "");
      form._partnerChecklistDrafts ||= {};
      if (previousIndustry) form._partnerChecklistDrafts[previousIndustry] = current;
      if (checklist) checklist.outerHTML = industryChecklistFields(event.target.value, form._partnerChecklistDrafts[event.target.value] || {});
      refreshPartnerQuoteVendorSummary(form, false);
      renderPartnerVendorPicker(form);
    }
    if (event.target.matches('#consultationForm [name="customerType"]')) {
      const form = event.target.form;
      const selectedCustomer = customerById(form && form.elements.customerId && form.elements.customerId.value);
      if (selectedCustomer && String(selectedCustomer.type || "기타") !== event.target.value) form.elements.customerId.value = "";
      renderConsultationCustomerPicker(form);
    }
  });

  document.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.target;
    if (!canWriteCRM() && !["emailLoginForm", "passwordChangeForm"].includes(form.id)) return showToast("조회 전용 계정은 내용을 변경할 수 없습니다.", "error");
    if (form.id === "buildingScheduleForm") {
      if (!canWriteCRM()) return showToast("조회 전용 계정은 일정을 저장할 수 없습니다.", "error");
      if (form.dataset.submitting === "true") return;
      if (Number(form.dataset.authGeneration) !== authGeneration || String(form.dataset.authUid || "") !== currentAuthUid()) {
        closeModal();
        return showToast("로그인 사용자가 변경되어 일정을 저장하지 않았습니다.", "error");
      }
      const raw = Object.fromEntries(new FormData(form).entries());
      const creating = form.dataset.scheduleCreate === "true";
      const existing = creating ? null : store.serviceRecords.find(item => item.id === form.dataset.scheduleId) || null;
      if (!creating && !existing) return showToast("일정이 이미 변경되었거나 취소되었습니다. 최신 화면을 확인해 주세요.", "error");
      const building = buildingById(raw.buildingId);
      const retainingExistingBuilding = Boolean(existing && existing.buildingId === raw.buildingId);
      if (!retainingExistingBuilding && !building) return showToast("일정을 등록할 건물을 선택해 주세요.", "error");
      if (!retainingExistingBuilding && building && building.archivedAt) return showToast("보관된 건물에는 새 일정을 등록할 수 없습니다.", "error");
      const title = String(raw.title || "").trim();
      const summary = String(raw.summary || "").trim();
      const owner = String(raw.owner || "").trim();
      if (!title) return showToast("일정명을 입력해 주세요.", "error");
      if (title.length > 160) return showToast("일정명은 160자 이내로 입력해 주세요.", "error");
      if (!WorkCalendar.isDateKey(raw.scheduledDate)) return showToast("일정 날짜를 확인해 주세요.", "error");
      if (summary.length > 2000) return showToast("일정 메모는 2,000자 이내로 입력해 주세요.", "error");
      if (owner.length > 120) return showToast("담당자명은 120자 이내로 입력해 주세요.", "error");
      const startTime = String(raw.startTime || "");
      const endTime = String(raw.endTime || "");
      if ((startTime && !WorkCalendar.isTimeKey(startTime)) || (endTime && !WorkCalendar.isTimeKey(endTime))) return showToast("일정 시간을 확인해 주세요.", "error");
      if (endTime && !startTime) return showToast("종료 시간을 입력하려면 시작 시간도 입력해 주세요.", "error");
      if (startTime && endTime && endTime <= startTime) return showToast("종료 시간은 시작 시간보다 늦게 입력해 주세요.", "error");
      const statuses = ["planned", "in_progress", "completed"];
      const status = statuses.includes(raw.status) ? raw.status : "planned";
      const values = buildingScheduleCommitValues(Object.assign({}, existing || {}, {
        buildingId: String(raw.buildingId || ""),
        title,
        serviceType: ["inspection", "repair", "cleaning", "stair_cleaning", "grounds_cutting", "meeting", "other"].includes(raw.serviceType) ? raw.serviceType : "other",
        status,
        scheduledDate: raw.scheduledDate,
        startTime,
        endTime,
        completedAt: status === "completed" ? existing && existing.completedAt || todayKey() : "",
        owner,
        summary,
      }));
      try { Core.assertNoProhibitedSecrets(values); }
      catch (error) { return showToast(error.message || "일정 메모에 저장할 수 없는 민감정보가 포함되어 있습니다.", "error"); }
      const result = await commitBuildingScheduleRecord({
        operation: creating ? "create" : "update",
        requestId: String(form.dataset.requestId || crypto.randomUUID()),
        recordId: String(form.dataset.scheduleId || ""),
        expectedUpdatedAt: creating ? "" : String(form.dataset.openedUpdatedAt || ""),
        expectedCommitVersion: creating ? 0 : Number(form.dataset.openedCommitVersion) || 0,
        values,
      }, form);
      if (!result || result.ok !== true) {
        if (["BUILDING_SCHEDULE_CONFLICT", "BUILDING_SCHEDULE_NOT_FOUND", "BUILDING_SCHEDULE_BUILDING_UNAVAILABLE"].includes(String(result && result.code || ""))) closeModal();
        render();
        return showToast(serviceRecordErrorText(result), "error");
      }
      workCalendarDate = result.record.scheduledDate;
      workCalendarMonth = result.record.scheduledDate.slice(0, 7);
      closeModal(); currentView = "buildingCalendar"; render(); showToast(creating ? "업무 일정을 등록했습니다." : "업무 일정을 수정했습니다.", "success");
    } else if (form.id === "workRecordForm") {
      if (!canWriteCRM()) return showToast("조회 전용 계정은 작업을 저장할 수 없습니다.", "error");
      if (form.dataset.submitting === "true") return;
      if (Number(form.dataset.authGeneration) !== authGeneration || String(form.dataset.authUid || "") !== currentAuthUid()) {
        closeModal();
        return showToast("로그인 사용자가 변경되어 작업을 저장하지 않았습니다.", "error");
      }
      const raw = Object.fromEntries(new FormData(form).entries());
      const creating = form.dataset.workCreate === "true";
      const existing = creating ? null : store.serviceRecords.find(item => item.id === form.dataset.workId) || null;
      if (!creating && !existing) return showToast("작업이 이미 변경되었거나 취소되었습니다. 최신 화면을 확인해 주세요.", "error");
      if (existing && existing.status === "cancelled") return showToast("취소된 작업은 변경할 수 없습니다.", "error");
      const building = buildingById(raw.buildingId);
      const retainingExistingBuilding = Boolean(existing && existing.buildingId === raw.buildingId);
      if (!retainingExistingBuilding && (!building || building.archivedAt)) return showToast("연결할 활성 건물을 선택해 주세요.", "error");
      if (raw.scheduledDate && !WorkCalendar.isDateKey(raw.scheduledDate)) return showToast("예정일을 확인해 주세요.", "error");
      if (raw.completedAt && !WorkCalendar.isDateKey(raw.completedAt)) return showToast("완료일을 확인해 주세요.", "error");
      if (raw.status === "completed" && !raw.completedAt) return showToast("완료 작업은 완료일을 입력해 주세요.", "error");
      const startTime = String(raw.startTime || "");
      const endTime = String(raw.endTime || "");
      if ((startTime && !WorkCalendar.isTimeKey(startTime)) || (endTime && !WorkCalendar.isTimeKey(endTime))) return showToast("작업 시간을 확인해 주세요.", "error");
      if (endTime && !startTime) return showToast("종료 시간을 입력하려면 시작 시간도 입력해 주세요.", "error");
      if (startTime && endTime && endTime <= startTime) return showToast("종료 시간은 시작 시간보다 늦게 입력해 주세요.", "error");
      if (raw.evidenceUrl) {
        try { const url = new URL(raw.evidenceUrl); if (url.protocol !== "https:" || url.hostname !== "drive.google.com") throw new Error(); }
        catch (_) { return showToast("Drive 증빙은 https://drive.google.com 주소만 입력해 주세요.", "error"); }
      }
      const title = String(raw.title || WorkManagement.typeLabel(raw.serviceType)).trim();
      if (!title || title.length > 160) return showToast("작업명은 160자 이내로 입력해 주세요.", "error");
      const values = buildingScheduleCommitValues(Object.assign({}, existing || {}, raw, { title, startTime, endTime }));
      try { Core.assertNoProhibitedSecrets(values); }
      catch (error) { return showToast(error.message || "작업 내용에 저장할 수 없는 민감정보가 포함되어 있습니다.", "error"); }
      const result = await commitBuildingScheduleRecord({
        operation: creating ? "create" : "update",
        requestId: String(form.dataset.requestId || crypto.randomUUID()),
        recordId: String(form.dataset.workId || ""),
        expectedUpdatedAt: creating ? "" : String(form.dataset.openedUpdatedAt || ""),
        expectedCommitVersion: creating ? 0 : Number(form.dataset.openedCommitVersion) || 0,
        values,
      }, form);
      if (!result || result.ok !== true) {
        if (["BUILDING_SCHEDULE_CONFLICT", "BUILDING_SCHEDULE_NOT_FOUND", "BUILDING_SCHEDULE_BUILDING_UNAVAILABLE"].includes(String(result && result.code || ""))) closeModal();
        render();
        return showToast(serviceRecordErrorText(result), "error");
      }
      closeModal(); currentView = "workManagement"; render(); showToast("작업을 공용 CRM에 저장했습니다.", "success");
    } else if (form.id === "driveImportApprovalForm" || form.id === "driveImportRejectionForm") {
      if (!canAdministerSecurity()) return showToast("관리자만 Drive 자료를 승인하거나 반려할 수 있습니다.", "error");
      const item = driveImportCandidateById(form.dataset.driveFileId);
      if (!item) return showToast("검토 후보를 찾지 못했습니다.", "error");
      const values = Object.fromEntries(new FormData(form).entries());
      try {
        const request = DriveImportUI.buildDecisionRequest(form.id === "driveImportApprovalForm" ? "approve" : "reject", item, Object.assign(values, { requestId: crypto.randomUUID() }));
        await api.decideDriveImport(request);
        const latest = await api.load();
        store = preserveRendererOverlays(latest, store);
        ensureSalesStore(store);
        synchronizedStore = cloneStore(store);
        overlayRefreshPromise = null;
        await refreshRendererOverlays(false);
        await refreshDriveImportCandidates({ renderAfter: false, force: true }).catch(() => undefined);
        closeModal();
        render();
        showToast(form.id === "driveImportApprovalForm" ? "Drive 자료를 승인해 건물을 등록했습니다." : "Drive 자료를 반려했습니다.", "success");
      } catch (error) { showToast(error.message || "Drive 검토 결과를 저장하지 못했습니다.", "error"); }
    } else if (form.id === "salesProspectForm") {
      const raw = Object.fromEntries(new FormData(form).entries());
      if (!assertSalesInputSafe(raw)) return;
      try {
        const existing = salesProspectById(form.dataset.salesProspectId || raw.id);
        const prospectValues = Object.assign({}, existing || {}, {
          id: existing?.id || raw.id || undefined,
          name: String(raw.name || "").trim(), address: String(raw.address || "").trim(), region: String(raw.region || "").trim(),
          buildingType: raw.buildingType, demandAnchors: String(raw.demandAnchors || "").split(",").map(item => item.trim()).filter(Boolean),
          source: raw.source, owner: String(raw.owner || "").trim() || salesActorName(), priority: raw.priority,
          vacancyCount: Number(raw.vacancyCount) || 0, upcomingVacancyCount: Number(raw.upcomingVacancyCount) || 0,
          nextAction: String(raw.nextAction || "").trim(), nextActionAt: raw.nextActionAt ? new Date(raw.nextActionAt).toISOString() : "",
          crmBuildingId: String(raw.crmBuildingId || "")
        });
        Sales.assertProspect(prospectValues);
        const candidate = Sales.createSalesProspect(prospectValues, salesActor());
        const duplicates = typeof Sales.duplicateProspects === "function" ? Sales.duplicateProspects(store.salesProspects, candidate) : [];
        if (duplicates.length && !await requestConfirmation({ title: "같은 주소의 영업 대상이 있습니다", description: "별동 등 다른 건물이 맞는지 확인해 주세요.", target: duplicates.map(item => item.name || item.address).join(" · "), warning: "계속하면 별도 영업 대상으로 저장됩니다.", confirmLabel: "별도 건물로 저장", tone: "warning" })) return;
        if (existing) {
          store.salesProspects[store.salesProspects.findIndex(item => item.id === existing.id)] = candidate;
        } else {
          store.salesProspects.push(candidate);
          const actor = salesActor();
          const createdEvent = Sales.createSalesEvent({ prospectId: candidate.id, type: "prospect_created", occurredAt: candidate.createdAt || new Date().toISOString(), evidenceType: "crm_record", evidenceNote: "CRM에서 영업 대상 건물 등록", owner: salesActorName() }, salesRelationContext(actor));
          store.salesEvents.push(createdEvent);
          candidate.stage = salesStageFromEvents(candidate.id);
        }
        logAudit({ category: existing ? "변경" : "등록", targetType: "영업 대상 건물", targetId: candidate.id, targetLabel: candidate.name || candidate.address, action: existing ? "영업 대상 기본정보 수정" : "영업 대상 등록 및 후보 증거 생성", reason: "건물 중심 영업 관리" });
        scheduleSave(); closeModal(); currentView = "pipeline"; render(); renderSalesProspectDrawer(candidate.id); showToast(existing ? "영업 대상 건물을 수정했습니다." : "영업 대상 건물과 후보 증거를 등록했습니다.", "success");
      } catch (error) { showToast(error.message || "영업 대상 건물을 저장하지 못했습니다.", "error"); }
    } else if (form.id === "salesContactForm") {
      const raw = Object.fromEntries(new FormData(form).entries());
      if (!assertSalesInputSafe(raw)) return;
      try {
        const existing = salesContactById(form.dataset.salesContactId);
        const contactValues = Object.assign({}, existing || {}, {
          prospectId: form.dataset.salesProspectId, name: String(raw.name || "").trim(), role: String(raw.role || "").trim(), phone: String(raw.phone || "").trim(),
          source: raw.source, sourceEvidence: String(raw.sourceEvidence || "").trim(), verifiedAt: raw.verifiedAt ? new Date(raw.verifiedAt).toISOString() : "",
          doNotContact: !!raw.doNotContact, doNotContactReason: String(raw.doNotContactReason || "").trim(), crmCustomerId: String(raw.crmCustomerId || "")
        });
        Sales.assertContact(contactValues);
        const item = Sales.createSalesContact(contactValues, salesActor());
        if (existing) store.salesContacts[store.salesContacts.findIndex(record => record.id === existing.id)] = item;
        else store.salesContacts.push(item);
        const optOutChanged = existing && !!(existing.doNotContact || existing.optOut) !== !!item.doNotContact;
        logAudit({ category: existing ? "변경" : "등록", targetType: "영업 연락처", targetId: item.id, targetLabel: item.name || item.phone, action: optOutChanged ? `수신거부 ${item.doNotContact ? "설정" : "해제"}` : existing ? "연락처 정보 수정" : "연락처 등록", reason: item.doNotContactReason || "영업 연락처 관리" });
        scheduleSave(); closeModal(); render(); renderSalesProspectDrawer(item.prospectId); showToast("연락처를 저장했습니다.", "success");
      } catch (error) { showToast(error.message || "연락처를 저장하지 못했습니다.", "error"); }
    } else if (form.id === "salesUnitForm") {
      if (deferCanonicalMutation("영업 호실")) return;
      const raw = Object.fromEntries(new FormData(form).entries());
      if (!assertSalesInputSafe(raw)) return;
      try {
        const existing = salesUnitById(form.dataset.salesUnitId);
        if (existing && (!Number.isInteger(existing.entityVersion) || existing.entityVersion < 1)) return showToast("최신 호실 버전을 확인한 뒤 다시 시도해 주세요.", "error");
        const unitValues = Object.assign({}, existing || {}, {
          prospectId: form.dataset.salesProspectId, label: String(raw.label || "").trim(), status: raw.status,
          moveOutAt: raw.moveOutAt || "", deposit: Number(raw.deposit) || 0, rent: Number(raw.rent) || 0, maintenanceFee: Number(raw.maintenanceFee) || 0,
          photoUrl: String(raw.photoUrl || "").trim(), evidenceUrl: String(raw.evidenceUrl || "").trim(), note: String(raw.note || "").trim()
        });
        Sales.assertUnit(unitValues);
        const item = Sales.createSalesUnit(Object.assign({}, unitValues, { id: existing && existing.id || crypto.randomUUID() }), salesActor());
        await commitCanonicalEntity({
          entityType: "salesUnits",
          entityId: item.id,
          operation: existing ? "update" : "create",
          expectedVersion: existing ? existing.entityVersion : 0,
          patch: buildCanonicalSalesUnitPatch(item),
          reason: existing ? "CRM 영업 호실 수정" : "CRM 영업 호실 등록",
        });
        closeModal(); render(); renderSalesProspectDrawer(item.prospectId); showToast("호실을 저장했습니다.", "success");
      } catch (error) { showToast(error.message || "호실을 저장하지 못했습니다.", "error"); }
    } else if (form.id === "salesActivityForm") {
      const raw = Object.fromEntries(new FormData(form).entries());
      if (!String(raw.summary || "").trim()) return showToast("영업 활동 내용을 입력해 주세요.", "error");
      if (!assertSalesInputSafe(raw)) return;
      try {
        const script = (SalesStandards.scripts || []).find(item => item.id === raw.scriptId);
        const actor = salesActor();
        const activityValues = {
          prospectId: form.dataset.salesProspectId, contactId: String(raw.contactId || ""), unitId: String(raw.unitId || ""), type: raw.type,
          occurredAt: raw.occurredAt ? new Date(raw.occurredAt).toISOString() : new Date().toISOString(), result: raw.result,
          responseCode: String(raw.responseCode || ""), failureReason: String(raw.failureReason || ""), summary: String(raw.summary || "").trim(), responseText: String(raw.responseText || "").trim(),
          scriptId: String(raw.scriptId || ""), scriptVersion: script?.version || form.dataset.scriptVersion || "", nextAction: String(raw.nextAction || "").trim(),
          nextActionAt: raw.nextActionAt ? new Date(raw.nextActionAt).toISOString() : "", owner: String(raw.owner || "").trim() || salesActorName(), createdBy: actor.email, updatedBy: actor.email
        };
        const activityContext = salesRelationContext(actor);
        activityContext.scripts = SalesStandards.scripts;
        Sales.assertActivity(activityValues, activityContext);
        const item = Sales.createSalesActivity(activityValues, activityContext);
        store.salesActivities.push(item);
        const prospect = salesProspectById(item.prospectId);
        if (prospect) {
          prospect.lastActivityAt = item.occurredAt;
          prospect.nextAction = item.nextAction || prospect.nextAction;
          prospect.nextActionAt = item.nextActionAt || prospect.nextActionAt;
          prospect.updatedAt = new Date().toISOString();
          prospect.updatedBy = actor.email;
        }
        const contact = salesContactById(item.contactId);
        if (contact && (item.result === "do_not_contact" || item.responseCode === "do_not_contact")) {
          contact.doNotContact = true; contact.optOut = true; contact.doNotContactAt = item.occurredAt; contact.doNotContactReason ||= "영업 활동에서 연락 중단 요청 확인";
        }
        logAudit({ category: "등록", targetType: "영업 활동", targetId: item.id, targetLabel: prospect?.name || item.prospectId, action: `${salesLabel(SALES_CHANNEL_LABELS, item.type)} · ${salesLabel(SALES_RESULT_LABELS, item.result)} 활동 기록`, reason: item.summary });
        scheduleSave(); closeModal(); render(); renderSalesProspectDrawer(item.prospectId); showToast("영업 활동을 저장했습니다.", "success");
      } catch (error) { showToast(error.message || "영업 활동을 저장하지 못했습니다.", "error"); }
    } else if (form.id === "salesEventForm") {
      const formData = new FormData(form);
      const raw = Object.fromEntries(formData.entries());
      if (!assertSalesInputSafe(raw)) return;
      try {
        const prospectId = form.dataset.salesProspectId || raw.prospectId;
        if (raw.type === "contact_attempted" && (!raw.channel || !raw.result)) return showToast("최초접촉 완료 증거에는 채널과 결과가 필요합니다.", "error");
        if (raw.type === "contact_attempted" && !Sales.SALES_CHANNELS.includes(raw.channel)) return showToast("올바른 최초접촉 채널을 선택해 주세요.", "error");
        if (raw.type === "ad_published" && !Sales.AD_CHANNELS.includes(raw.adChannel)) return showToast("올바른 광고 게시 채널을 선택해 주세요.", "error");
        const actor = salesActor();
        const eventValues = {
          prospectId, contactId: String(raw.contactId || ""), unitId: String(raw.unitId || ""), type: raw.type,
          opportunityId: String(raw.opportunityId || ""), occurredAt: String(raw.occurredAt || "").trim(), evidenceType: raw.evidenceType,
          evidenceUrl: String(raw.evidenceUrl || "").trim(), evidenceNote: String(raw.evidenceNote || "").trim(), channel: raw.type === "ad_published" ? String(raw.adChannel || "") : String(raw.channel || ""), result: String(raw.result || ""),
          managementStartedAt: String(raw.managementStartedAt || "").trim(), serviceScope: String(raw.serviceScope || "").trim(),
          checklistIds: formData.getAll("checklistIds").map(String), owner: String(raw.owner || "").trim() || salesActorName(), createdBy: actor.email
        };
        const eventContext = salesRelationContext(actor);
        Sales.assertEvent(eventValues, eventContext);
        const item = Sales.createSalesEvent(eventValues, eventContext);
        store.salesEvents.push(item);
        const prospect = salesProspectById(prospectId);
        if (prospect) {
          const previousStage = prospect.stage;
          prospect.stage = salesStageFromEvents(prospect.id);
          prospect.updatedAt = new Date().toISOString();
          prospect.updatedBy = salesActor().email;
          logAudit({ category: "단계변경", targetType: "영업 대상 건물", targetId: prospect.id, targetLabel: prospect.name || prospect.address, action: `${previousStage} → ${prospect.stage} · ${item.type}`, reason: item.evidenceNote || item.evidenceUrl });
        }
        scheduleSave(); closeModal(); render(); renderSalesProspectDrawer(prospectId); showToast("완료 증거를 저장하고 영업 단계를 반영했습니다.", "success");
      } catch (error) { showToast(error.message || "완료 증거를 저장하지 못했습니다.", "error"); }
    } else if (form.id === "salesEventArchiveForm") {
      const raw = Object.fromEntries(new FormData(form).entries());
      const correctionReason = String(raw.correctionReason || "").trim();
      if (!correctionReason) return showToast("완료 증거를 정정하는 사유를 입력해 주세요.", "error");
      if (!assertSalesInputSafe(raw)) return;
      try {
        const prospectId = form.dataset.salesProspectId;
        const item = (store.salesEvents || []).find(record => record && record.id === form.dataset.salesEventId && record.prospectId === prospectId);
        if (!item || item.archivedAt) return showToast("보관할 완료 증거를 찾지 못했습니다.", "error");
        const actor = salesActor();
        const archived = Object.assign(Sales.archiveRecord(item, actor), { archiveReason: correctionReason });
        store.salesEvents[store.salesEvents.findIndex(record => record && record.id === item.id)] = archived;
        const stageResult = recalculateSalesProspectStage(prospectId);
        logAudit({ category: "보관", targetType: "영업 완료 증거", targetId: item.id, targetLabel: item.type || item.id, action: `완료 증거 정정·보관 · ${stageResult?.previousStage || ""} → ${stageResult?.prospect?.stage || ""}`, reason: correctionReason });
        scheduleSave(); closeModal(); render(); renderSalesProspectDrawer(prospectId); showToast("완료 증거를 보관하고 단계를 다시 계산했습니다.", "success");
      } catch (error) { showToast(error.message || "완료 증거를 보관하지 못했습니다.", "error"); }
    } else if (form.id === "salesResumeForm") {
      const raw = Object.fromEntries(new FormData(form).entries());
      const resumeReason = String(raw.resumeReason || "").trim();
      if (!resumeReason) return showToast("영업 재개 사유를 입력해 주세요.", "error");
      if (!assertSalesInputSafe(raw)) return;
      try {
        const prospect = salesProspectById(form.dataset.salesProspectId);
        if (!prospect || prospect.archivedAt || prospect.stage !== "paused_closed") return showToast("보류·종료 상태인 영업 대상만 재개할 수 있습니다.", "error");
        const actor = salesActor();
        const eventValues = { prospectId: prospect.id, type: "prospect_resumed", resumeStage: raw.resumeStage, evidenceType: "resume_reason", evidenceNote: resumeReason, occurredAt: new Date().toISOString(), owner: salesActorName(), createdBy: actor.email };
        const eventContext = salesRelationContext(actor);
        const item = Sales.createSalesEvent(eventValues, eventContext);
        store.salesEvents.push(item);
        const stageResult = recalculateSalesProspectStage(prospect.id);
        logAudit({ category: "단계변경", targetType: "영업 대상 건물", targetId: prospect.id, targetLabel: prospect.name || prospect.address, action: `영업 재개 · ${stageResult?.previousStage || "paused_closed"} → ${stageResult?.prospect?.stage || raw.resumeStage}`, reason: resumeReason });
        scheduleSave(); closeModal(); render(); renderSalesProspectDrawer(prospect.id); showToast("영업 재개를 기록하고 단계를 반영했습니다.", "success");
      } catch (error) { showToast(error.message || "영업을 재개하지 못했습니다.", "error"); }
    } else if (form.id === "salesOpportunityForm") {
      const raw = Object.fromEntries(new FormData(form).entries());
      if (!String(raw.requirements || "").trim()) return showToast("추가서비스 요구사항을 입력해 주세요.", "error");
      if (!assertSalesInputSafe(raw)) return;
      try {
        const existing = salesOpportunityById(form.dataset.salesOpportunityId);
        const workflowCaseId = String(raw.workflowCaseId || "").trim();
        if (workflowCaseId && !workflowCaseByKey(workflowCaseId)) return showToast("활성 민원·공사 케이스만 연결할 수 있습니다.", "error");
        if (!existing && raw.stage !== "discovered") return showToast("새 추가서비스는 ‘기회 발견’에서 시작해 주세요.", "error");
        if (existing && raw.stage !== existing.stage && !Sales.canTransitionOpportunityStage(existing.stage, raw.stage)) return showToast("추가서비스 상태는 한 단계씩 진행해 주세요.", "error");
        const opportunityValues = Object.assign({}, existing || {}, {
          prospectId: form.dataset.salesProspectId, unitId: String(raw.unitId || ""), serviceType: raw.serviceType, stage: raw.stage,
          requirements: String(raw.requirements || "").trim(), owner: String(raw.owner || "").trim() || salesActorName(), dueAt: raw.dueAt || "",
          quoteAmount: Number(raw.quoteAmount) || 0, revenueAmount: Number(raw.revenueAmount) || 0,
          evidenceUrl: String(raw.evidenceUrl || "").trim(), evidenceNote: String(raw.evidenceNote || "").trim(), workflowCaseId
        });
        const actor = salesActor();
        const stageChanged = !existing || raw.stage !== existing.stage;
        const transitionAt = stageChanged ? new Date().toISOString() : undefined;
        const item = Sales.createSalesOpportunity(opportunityValues, actor, transitionAt, existing?.stage);
        Sales.assertOpportunity(item, { prospects: store.salesProspects, units: store.salesUnits });
        if (existing) store.salesOpportunities[store.salesOpportunities.findIndex(record => record.id === existing.id)] = item;
        else store.salesOpportunities.push(item);
        logAudit({ category: existing ? "변경" : "등록", targetType: "추가서비스 기회", targetId: item.id, targetLabel: salesLabel(SALES_SERVICE_LABELS, item.serviceType), action: `${salesLabel(SALES_OPPORTUNITY_LABELS, item.stage)}${item.stage === "revenue_recorded" ? ` · ${krw(item.revenueAmount)}` : ""}`, reason: item.requirements });
        scheduleSave(); closeModal(); render(); renderSalesProspectDrawer(item.prospectId); showToast("추가서비스 기회를 저장했습니다.", "success");
      } catch (error) { showToast(error.message || "추가서비스 기회를 저장하지 못했습니다.", "error"); }
    } else if (form.id === "workflowCaseCreateForm") {
      const raw = Object.fromEntries(new FormData(form).entries());
      if (!String(raw.name || "").trim()) return showToast("고객명을 입력해 주세요.", "error");
      if (!String(raw.building || "").trim()) return showToast("건물명을 입력해 주세요.", "error");
      const result = await api.saveWorkflowCase({ create: true, fields: raw });
      if (!result.ok) return showToast(result.error || "케이스를 등록하지 못했습니다.", "error");
      selectedCaseKey = result.caseKey;
      closeModal();
      await refreshOperations({ silent: true, render: false });
      currentView = "cases";
      render();
      showToast("새 케이스를 등록하고 1단계를 시작했습니다.", "success");
    } else if (form.id === "workflowCaseBasicForm") {
      const raw = Object.fromEntries(new FormData(form).entries());
      const result = await api.saveWorkflowCase({ caseKey: form.dataset.caseKey, fields: raw });
      if (!result.ok) return showToast(result.error || "기본 정보를 저장하지 못했습니다.", "error");
      await refreshOperations({ silent: true, render: false });
      renderCases();
      showToast("케이스 기본 정보를 저장했습니다.", "success");
    } else if (form.classList.contains("case-step-note-form")) {
      const raw = Object.fromEntries(new FormData(form).entries());
      const result = await api.saveWorkflowCase({ caseKey: form.dataset.caseKey, stepKey: form.dataset.stepKey, stepNote: raw.stepNote });
      if (!result.ok) return showToast(result.error || "단계 메모를 저장하지 못했습니다.", "error");
      await refreshOperations({ silent: true, render: false });
      renderCases();
      showToast("단계 메모를 저장했습니다.", "success");
    } else if (form.id === "paymentScheduleForm") {
      const raw = Object.fromEntries(new FormData(form).entries());
      const selectedBuilding = paymentBuildings().find(item => item.id === raw.buildingId);
      if (!raw.buildingName.trim() && selectedBuilding) raw.buildingName = selectedBuilding.name;
      if (selectedBuilding && selectedBuilding.address) raw.buildingAddress = selectedBuilding.address;
      const originalBuildingId = String(form.dataset.originalBuildingId || "");
      const crmBuilding = buildingById(raw.buildingId);
      if (originalBuildingId && crmBuilding && (crmBuilding.externalRefs && crmBuilding.externalRefs.paymentBuildingIds || []).includes(originalBuildingId)) raw.buildingId = originalBuildingId;
      if (!raw.buildingName.trim() || !raw.tenantName.trim() || Core.money(raw.amount) < 1 || !raw.startMonth) return showToast("건물명·세입자명·금액·시작 월을 입력해 주세요.", "error");
      const result = await api.savePaymentSchedule(Object.assign({}, raw, { scheduleId: form.dataset.scheduleId, active: raw.active === "true" }));
      if (!result.ok) return showToast(result.error || "납부 일정을 저장하지 못했습니다.", "error");
      await refreshOperations({ silent: true, render: false });
      closeModal(); currentView = "payments"; render(); showToast("납부 일정을 공용 캘린더에 저장했습니다.", "success");
    } else if (form.id === "paymentBankBindingForm") {
      const selected = form.querySelector('input[name="accountRef"]:checked');
      if (!selected) return showToast("연결할 입금계좌를 선택해 주세요.", "error");
      const result = await api.savePaymentBankBinding({ buildingId: form.dataset.buildingId, buildingName: form.dataset.buildingName, accountRef: selected.value, bankCode: selected.dataset.bankCode, accountName: selected.dataset.accountName, accountLast4: selected.dataset.accountLast4 });
      if (!result.ok) return showToast(result.error || "입금계좌 연결을 저장하지 못했습니다.", "error");
      await refreshOperations({ silent: true, render: false });
      closeModal(); currentView = "payments"; render(); showToast("건물과 입금계좌를 연결했습니다.", "success");
    } else if (form.id === "paymentStatusForm") {
      const raw = Object.fromEntries(new FormData(form).entries());
      const result = await api.savePaymentOverride({ month: form.dataset.month, scheduleId: form.dataset.scheduleId, status: raw.status, reason: raw.reason.trim() });
      if (!result.ok) return showToast(result.error || "입금 상태를 저장하지 못했습니다.", "error");
      await refreshOperations({ silent: true, render: false });
      closeModal(); currentView = "payments"; render(); showToast("입금 상태를 공용 캘린더에 반영했습니다.", "success");
    } else if (form.id === "vacancyScheduleForm") {
      if (deferCanonicalMutation("공실 예정")) return;
      const building = buildingById(form.dataset.buildingId);
      const item = (store.buildingUnits || []).find(unit => unit && !unit.archivedAt && unit.id === form.dataset.unitId
        && String(unit.crmBuildingId || unit.buildingId || "") === String(form.dataset.buildingId));
      if (!building || building.archivedAt || !item) return showToast("호실을 찾지 못했습니다.", "error");
      const expectedVersion = Number(form.dataset.expectedVersion);
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return showToast("최신 호실 버전을 확인한 뒤 다시 시도해 주세요.", "error");
      const availableFrom = String(form.elements.availableFrom?.value || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(availableFrom)) return showToast("공실 예정일을 입력해 주세요.", "error");
      const memo = String(form.elements.memo?.value || "").trim();
      const patch = { status: "move_out_scheduled", moveOutAt: "", availableFrom };
      if (memo !== String(form._vacancyOriginalMemo || "")) patch.memo = memo;
      const previousStatus = vacancyUnitStatus(item);
      const submitButton = form.querySelector('button[type="submit"]');
      vacancyUnitSaveLocks.add(item.id);
      if (submitButton) submitButton.disabled = true;
      try {
        await commitCanonicalEntity({
          entityType: "buildingUnits",
          entityId: item.id,
          operation: "update",
          expectedVersion,
          patch,
          reason: `CRM 공실 예정 등록: ${availableFrom}`,
        });
        selectedVacancyBuildingId = building.id;
        selectedBuildingId = building.id;
        vacancyStatusFilter = "attention";
        vacancyUnitSaveLocks.delete(item.id);
        closeModal();
        currentView = "vacancies";
        render();
        showToast(`${item.label || item.unitLabel || "호실"}: ${VACANCY_STATUS_LABELS[previousStatus]} → 공실 예정 (${shortDate(availableFrom)})`, availableFrom < todayKey() ? "" : "success");
      } catch (error) {
        if (isVacancyConfigurationConflict(error)) {
          await refreshRendererOverlays(false).catch(() => undefined);
          vacancyUnitSaveLocks.delete(item.id);
          closeModal();
          if (currentView === "vacancies") render();
          showToast("다른 컴퓨터에서 이 호실을 먼저 변경했습니다. 최신 상태를 확인해 주세요.", "error");
        } else showToast(error.message || "공실 예정 상태를 저장하지 못했습니다.", "error");
      } finally {
        vacancyUnitSaveLocks.delete(item.id);
        if (submitButton && submitButton.isConnected) submitButton.disabled = false;
      }
    } else if (form.id === "vacancyConfigurationForm") {
      if (deferCanonicalMutation("층·호실 구성")) return;
      if (pendingRemoteStore) {
        const latest = pendingRemoteStore;
        pendingRemoteStore = null;
        closeModal();
        applyRemoteStore(latest);
        flushPendingRemote();
        currentView = "vacancies";
        render();
        return showToast("다른 컴퓨터의 최신 변경을 반영했습니다. 층·호실 구성을 다시 열어 확인해 주세요.", "error");
      }
      const building = buildingById(form.dataset.buildingId);
      if (!building || building.archivedAt) return showToast("건물을 찾지 못했습니다.", "error");
      const floors = captureVacancyConfiguration(form);
      if (!floors.length) return showToast("한 개 이상의 층을 구성해 주세요.", "error");
      if (floors.some(floor => !floor.floorLabel)) return showToast("모든 층의 층명을 입력해 주세요.", "error");
      const normalizedFloors = floors.map(floor => normalizeVacancyUnitLabel(floor.floorLabel));
      if (new Set(normalizedFloors).size !== normalizedFloors.length) return showToast("같은 층명이 두 번 입력되어 있습니다.", "error");
      const configuredUnits = floors.flatMap(floor => floor.units.map((unit, index) => ({
        entityId: unit.entityId,
        expectedVersion: unit.expectedVersion,
        label: String(unit.label || "").trim(),
        floorLabel: floor.floorLabel,
        floorOrder: Math.max(-1000, Math.min(1000, Math.trunc(Number(floor.floorOrder) || 0))),
        unitOrder: index + 1,
        status: vacancyUnitStatus(unit),
      })));
      if (!configuredUnits.length) return showToast("한 개 이상의 호실을 구성해 주세요.", "error");
      if (configuredUnits.length > 200) return showToast("한 건물의 호실은 최대 200개까지 구성할 수 있습니다.", "error");
      if (configuredUnits.some(unit => !unit.label)) return showToast("모든 호실명을 입력해 주세요.", "error");
      const normalizedLabels = configuredUnits.map(unit => normalizeVacancyUnitLabel(unit.label));
      if (new Set(normalizedLabels).size !== normalizedLabels.length) return showToast("같은 호실명이 두 번 입력되어 있습니다.", "error");
      if (configuredUnits.some(unit => unit.entityId && (!Number.isInteger(unit.expectedVersion) || unit.expectedVersion < 1))) return showToast("기존 호실의 최신 버전을 확인할 수 없습니다. 창을 닫고 다시 열어 주세요.", "error");
      const legacyMigration = vacancyLegacyMigrationState(building);
      const legacyVacancyMinimum = legacyMigration.requiredVacantCount;
      const configuredVacancies = configuredUnits.filter(unit => unit.status === "vacant").length;
      const configuredVacantLabels = new Set(configuredUnits
        .filter(unit => unit.status === "vacant")
        .map(unit => normalizeVacancyUnitLabel(unit.label))
        .filter(Boolean));
      const statusConflictNamedVacancy = legacyMigration.statusConflictNamedLabels[0];
      if (statusConflictNamedVacancy) return showToast(`${statusConflictNamedVacancy} 기존 공실은 이미 정식 호실로 등록되어 있습니다. 해당 호실 단건 수정에서 먼저 공실로 변경해 주세요.`, "error");
      const unresolvedNamedVacancy = legacyMigration.namedLabels.find(label => !configuredVacantLabels.has(normalizeVacancyUnitLabel(label)));
      if (unresolvedNamedVacancy) return showToast(`${unresolvedNamedVacancy} 기존 공실은 최초 이전 시 동일한 호실명으로 공실 지정해 주세요.`, "error");
      if (legacyVacancyMinimum > configuredVacancies) return showToast(`기존 공실을 실제 호실에 지정해 주세요. 필요한 ${legacyVacancyMinimum}실 중 ${configuredVacancies}실이 공실로 지정되었습니다.`, "error");
      const existingIds = new Set(activeBuildingUnitsForBuilding(building).map(unit => String(unit.id || "")).filter(Boolean));
      const configuredExistingIds = new Set(configuredUnits.map(unit => String(unit.entityId || "")).filter(Boolean));
      if ([...existingIds].some(id => !configuredExistingIds.has(id))) return showToast("기존 호실이 구성에서 누락되었습니다. 창을 닫고 최신 상태를 다시 확인해 주세요.", "error");
      if (typeof api.configureBuildingUnits !== "function") return showToast("층·호실 구성 기능을 불러오지 못했습니다. 앱을 다시 실행해 주세요.", "error");
      const submitButton = form.querySelector('button[type="submit"]');
      const configureGeneration = authGeneration;
      const configureUid = currentAuthUid();
      const configureSessionActive = () => configureGeneration === authGeneration && configureUid === currentAuthUid();
      if (submitButton) submitButton.disabled = true;
      try {
        const result = await api.configureBuildingUnits({
          buildingId: building.id,
          operatorId: selectedFieldOperatorId,
          units: configuredUnits.map(unit => Object.assign(
            { label: unit.label, floorLabel: unit.floorLabel, floorOrder: unit.floorOrder, unitOrder: unit.unitOrder, status: unit.status },
            unit.entityId ? { entityId: unit.entityId, expectedVersion: unit.expectedVersion } : {}
          )),
        });
        if (!configureSessionActive()) return;
        if (!result || result.ok === false || result.error) {
          if (isVacancyConfigurationConflict(result)) return await recoverVacancyConfigurationConflict(building.id);
          return showToast(result && result.error || "층·호실 구성을 저장하지 못했습니다.", "error");
        }
        const configuredVacantLabels = configuredUnits.filter(unit => unit.status === "vacant").map(unit => unit.label);
        const localBuilding = buildingById(building.id);
        if (localBuilding) {
          localBuilding.vacantUnitCount = configuredVacantLabels.length;
          localBuilding.vacantUnits = configuredVacantLabels;
        }
        let overlaysRefreshed = true;
        try {
          await refreshRendererOverlays(false);
        } catch (_) {
          overlaysRefreshed = false;
        }
        if (!configureSessionActive()) return;
        selectedBuildingId = building.id;
        selectedVacancyBuildingId = building.id;
        vacancyStatusFilter = "attention";
        closeModal();
        currentView = "vacancies";
        render();
        const changed = Number(result.createdCount || 0) + Number(result.updatedCount || 0);
        const successMessage = changed ? `층·호실 ${Number(result.totalUnits || configuredUnits.length).toLocaleString("ko-KR")}개 구성을 저장했습니다.` : "층·호실 구성이 최신 상태입니다.";
        showToast(overlaysRefreshed ? successMessage : `${successMessage} 최신 목록은 연결되는 대로 반영됩니다.`, overlaysRefreshed ? "success" : "warning");
      } catch (error) {
        if (!configureSessionActive()) return;
        if (isVacancyConfigurationConflict(error)) return await recoverVacancyConfigurationConflict(building.id);
        showToast(error.message || "층·호실 구성을 저장하지 못했습니다.", "error");
      } finally {
        if (configureSessionActive() && submitButton && submitButton.isConnected) submitButton.disabled = false;
      }
    } else if (form.id === "buildingUnitForm") {
      if (deferCanonicalMutation("건물 호실")) return;
      const raw = Object.fromEntries(new FormData(form).entries());
      const label = String(raw.label || "").trim();
      if (!label) return showToast("호실명을 입력해 주세요.", "error");
      const floorLabel = String(raw.floorLabel || "").trim();
      if (!floorLabel) return showToast("층명을 입력해 주세요.", "error");
      const status = VACANCY_STATUS_ORDER.includes(raw.status) && raw.status !== "all" ? raw.status : "unknown";
      const availableFrom = status === "move_out_scheduled" ? String(raw.availableFrom || "").slice(0, 10) : "";
      if (status === "move_out_scheduled" && !availableFrom) return showToast("공실 예정 상태에는 공실 예정일을 입력해 주세요.", "error");
      const unitBuilding = buildingById(form.dataset.buildingId);
      if (!unitBuilding || unitBuilding.archivedAt) return showToast("건물을 찾지 못했습니다.", "error");
      const existing = (store.buildingUnits || []).find(item => item && item.id === form.dataset.buildingUnitId);
      if (existing && (!Number.isInteger(existing.entityVersion) || existing.entityVersion < 1)) return showToast("최신 호실 버전을 확인한 뒤 다시 시도해 주세요.", "error");
      const duplicate = activeBuildingUnitsForBuilding(unitBuilding).find(unit => unit.id !== (existing && existing.id) && normalizeVacancyUnitLabel(unit.label || unit.unitLabel) === normalizeVacancyUnitLabel(label));
      if (duplicate) return showToast("같은 건물에 동일한 호실명이 이미 등록되어 있습니다.", "error");
      const entityId = existing && existing.id || crypto.randomUUID();
      try {
        await commitCanonicalEntity({
          entityType: "buildingUnits",
          entityId,
          operation: existing ? "update" : "create",
          expectedVersion: existing ? existing.entityVersion : 0,
          patch: buildCanonicalBuildingUnitPatch({ buildingId: form.dataset.buildingId, label, floorLabel, floorOrder: raw.floorOrder, unitOrder: raw.unitOrder, status, moveOutAt: "", availableFrom, memo: raw.memo }),
          reason: existing ? "CRM 건물 호실 수정" : "CRM 건물 호실 등록",
        });
        selectedBuildingId = form.dataset.buildingId;
        selectedVacancyBuildingId = form.dataset.buildingId;
        const returnView = form.dataset.returnView === "vacancies" ? "vacancies" : "buildings";
        closeModal(); currentView = returnView; render();
        showToast(status === "move_out_scheduled" && availableFrom < todayKey() ? "호실을 저장했습니다. 지난 공실 예정일의 실제 상태를 확인해 주세요." : "건물 호실을 저장했습니다.", status === "move_out_scheduled" && availableFrom < todayKey() ? "" : "success");
      } catch (error) { showToast(error.message || "건물 호실을 저장하지 못했습니다.", "error"); }
    } else if (form.id === "buildingForm") {
      if (deferCanonicalMutation("건물")) return;
      const formData = new FormData(form);
      const raw = Object.fromEntries(formData.entries());
      const name = String(raw.name || "").trim();
      if (!name) return showToast("건물명을 입력해 주세요.", "error");
      const nonNegativeInteger = Core.nonNegativeInteger;
      const checkedValues = fieldName => [...new Set(formData.getAll(fieldName).map(value => String(value || "").trim()).filter(Boolean))];
      const existing = buildingById(form.dataset.buildingId);
      const formalUnits = existing ? activeBuildingUnitsForBuilding(existing) : [];
      const legacyMigration = existing ? vacancyLegacyMigrationState(existing) : null;
      const vacantUnits = formalUnits.length
        ? legacyMigration.unresolvedCount
          ? buildingArray(existing.vacantUnits)
          : formalUnits.filter(unit => vacancyUnitStatus(unit) === "vacant").map(unit => String(unit.label || unit.unitLabel || "").trim()).filter(Boolean)
        : [...new Set(String(raw.vacantUnits || "").split(/[\n,，;]+/).map(value => value.trim()).filter(Boolean))];
      const vacantUnitCount = formalUnits.length ? legacyMigration.unresolvedCount ? nonNegativeInteger(existing.vacantUnitCount) : vacantUnits.length : nonNegativeInteger(raw.vacantUnitCount);
      if (!(formalUnits.length && legacyMigration.unresolvedCount) && vacantUnits.length > vacantUnitCount) return showToast(`공실 호실을 ${vacantUnits.length}개 입력했습니다. 공실 수를 ${vacantUnits.length}개 이상으로 입력해 주세요.`, "error");
      const maintenanceIncludes = checkedValues("maintenanceIncludes");
      const roomTypes = checkedValues("roomTypes");
      const roomOptions = checkedValues("roomOptions");
      const maintenanceIncludeOther = String(raw.maintenanceIncludeOther || "").trim();
      const roomTypeOther = String(raw.roomTypeOther || "").trim();
      const roomOptionOther = String(raw.roomOptionOther || "").trim();
      if (maintenanceIncludeOther && !maintenanceIncludes.includes("기타")) maintenanceIncludes.push("기타");
      if (roomTypeOther && !roomTypes.includes("기타")) roomTypes.push("기타");
      if (roomOptionOther && !roomOptions.includes("기타")) roomOptions.push("기타");
      const roadAddress = String(raw.roadAddress || "").trim();
      const jibunAddress = String(raw.jibunAddress || "").trim();
      const legacyAddress = existing && !String(existing.roadAddress || "").trim() && !String(existing.jibunAddress || "").trim()
        ? String(existing.address || "").trim()
        : "";
      const address = roadAddress || jibunAddress || legacyAddress;
      if (!name || !address) return showToast("건물명과 도로명·지번 주소 중 하나 이상을 입력해 주세요.", "error");
      const addressKeys = new Set([address, roadAddress, jibunAddress].map(Core.normalizeText).filter(Boolean));
      const duplicate = store.buildings.find(building => building.id !== (existing && existing.id)
        && Core.normalizeText(building.name) === Core.normalizeText(name)
        && buildingAddressKeys(building).some(value => addressKeys.has(value)));
      if (duplicate) return showToast("같은 이름과 주소의 건물이 이미 등록되어 있습니다.", "error");
      if (existing && (!Number.isInteger(existing.entityVersion) || existing.entityVersion < 1)) return showToast("최신 건물 버전을 확인한 뒤 다시 시도해 주세요.", "error");
      const item = existing || Core.createBuilding({ id: crypto.randomUUID(), manager: store.settings.owner || "김현진" });
      const previousName = String(item.name || "").trim();
      const aliases = new Set(item.aliases || []);
      if (previousName && Core.normalizeText(previousName) !== Core.normalizeText(name)) aliases.add(previousName);
      const paymentIds = new Set(item.externalRefs && item.externalRefs.paymentBuildingIds || []);
      const sameNameBuildingExists = store.buildings.some(building => building.id !== item.id && buildingNames(building).includes(Core.normalizeText(name)));
      const matchingSchedules = Object.values(operations.payments && operations.payments.schedules || {}).filter(schedule => Core.normalizeText(schedule.buildingName) === Core.normalizeText(name));
      const unaddressedExternalIds = new Set(matchingSchedules.filter(schedule => !Core.normalizeText(schedule.buildingAddress)).map(schedule => String(schedule.buildingId || "")).filter(Boolean));
      Object.values(operations.payments && operations.payments.schedules || {}).forEach(schedule => {
        const scheduleAddress = Core.normalizeText(schedule.buildingAddress);
        const addressMatch = !!scheduleAddress && addressKeys.has(scheduleAddress);
        const unambiguousNameOnly = !scheduleAddress && !sameNameBuildingExists && unaddressedExternalIds.size <= 1;
        const matched = existing ? scheduleBelongsToBuilding(schedule, existing) : Core.normalizeText(schedule.buildingName) === Core.normalizeText(name) && (addressMatch || unambiguousNameOnly);
        if (matched && schedule.buildingId) paymentIds.add(String(schedule.buildingId));
      });
      const currentOwnerCustomerId = String(existing && existing.ownerCustomerId || "");
      const requestedOwnerCustomerId = currentOwnerCustomerId || String(raw.ownerCustomerId || "");
      if (requestedOwnerCustomerId && !customerById(requestedOwnerCustomerId)) return showToast("연결할 고객 정보를 다시 확인해 주세요.", "error");
      if (existing && !currentOwnerCustomerId && requestedOwnerCustomerId) {
        const ownerCustomer = customerById(requestedOwnerCustomerId);
        if (!await requestConfirmation({
          title: "이 고객을 건물주로 연결할까요?",
          description: "건물과 고객의 연결 관계를 함께 저장합니다.",
          target: `${ownerCustomer?.name || requestedOwnerCustomerId} · ${name}`,
          warning: "최초 연결 후 다른 고객으로 변경하거나 해제하려면 별도 이전 절차가 필요합니다.",
          confirmLabel: "건물주 연결",
          tone: "warning",
        })) return;
      }
      const patch = buildCanonicalBuildingPatch({
        name, ownerCustomerId: requestedOwnerCustomerId, type: raw.type, status: raw.status,
        address, roadAddress, jibunAddress, unitCount: raw.unitCount,
        rentDeposit: nonNegativeInteger(raw.rentDeposit), monthlyRent: nonNegativeInteger(raw.monthlyRent), maintenanceFee: nonNegativeInteger(raw.maintenanceFee),
        maintenanceIncludes, maintenanceIncludeOther, vacantUnitCount, vacantUnits, roomTypes, roomTypeOther, roomOptions, roomOptionOther,
        manager: String(raw.manager || "").trim() || store.settings.owner || "김현진", memo: raw.memo,
        aliases: [...aliases], paymentBuildingIds: [...paymentIds],
      });
      if (formalUnits.length) {
        delete patch.vacantUnitCount;
        delete patch.vacantUnits;
      }
      if (existing && !Object.hasOwn(existing, "ownerCustomerId") && !requestedOwnerCustomerId) delete patch.ownerCustomerId;
      try {
        const commitResult = await commitCanonicalEntity({
          entityType: "buildings",
          entityId: item.id,
          operation: existing ? "update" : "create",
          expectedVersion: existing ? existing.entityVersion : 0,
          patch,
          reason: existing ? "CRM 건물 기본정보 수정" : "CRM 건물 등록",
        });
        selectedBuildingId = String(commitResult && commitResult.entityId || item.id);
        closeModal(); currentView = "buildings"; render(); requestDriveImportCandidatesRefresh(); showToast(`${name} 건물을 저장했습니다.`, "success");
      } catch (error) { showToast(error.message || "건물을 저장하지 못했습니다.", "error"); }
    } else if (form.id === "contractForm") {
      const formData = new FormData(form);
      const raw = Object.fromEntries(formData.entries());
      const types = formData.getAll("types").map(type => String(type)).filter(type => Core.CONTRACT_TYPES.includes(type));
      if (!types.length) return showToast("계약 유형을 하나 이상 선택해 주세요.", "error");
      if (!raw.name.trim()) return showToast("계약명을 입력해 주세요.", "error");
      if (!raw.customerId || !raw.buildingId) return showToast("연결할 고객과 건물을 선택해 주세요.", "error");
      const existing = store.contracts.find(item => item.id === form.dataset.contractId);
      const linkedCustomer = customerById(raw.customerId);
      const keepsExistingLink = existing && existing.customerId === raw.customerId && existing.buildingId === raw.buildingId;
      if (!keepsExistingLink && !customerBuildings(linkedCustomer).some(building => building.id === raw.buildingId)) return showToast("선택한 고객에게 연결된 건물을 선택해 주세요.", "error");
      if (!raw.startDate) return showToast("계약 시작일을 입력해 주세요.", "error");
      if (raw.endDate && raw.endDate < raw.startDate) return showToast("계약 종료일은 시작일보다 빠를 수 없습니다.", "error");
      if (raw.billingCycle === "건별" && (!raw.workDate || !raw.paymentDueDate)) return showToast("단건 계약의 작업일과 입금 예정일을 입력해 주세요.", "error");
      const item = existing || Core.createContract({ owner: store.settings.owner || "김현진" });
      Object.assign(item, {
        types, type: types[0], name: raw.name.trim(), customerId: raw.customerId, buildingId: raw.buildingId,
        startDate: raw.startDate, endDate: raw.endDate || "", amount: Core.money(raw.amount), billingCycle: raw.billingCycle,
        status: raw.status, owner: raw.owner.trim() || store.settings.owner || "김현진", scope: raw.scope.trim(),
        serviceFrequency: raw.serviceFrequency.trim(), unitCount: Number(raw.unitCount) || 0,
        managementTarget: raw.managementTarget.trim(), feeMethod: raw.feeMethod.trim(), memo: raw.memo.trim(),
        workDate: raw.workDate || "", paymentDueDate: raw.paymentDueDate || "", vendorCost: Core.money(raw.vendorCost),
        grossProfit: Core.money(raw.amount) - Core.money(raw.vendorCost), collectionStatus: raw.collectionStatus || "입금 예정",
        vendorPaymentStatus: raw.vendorPaymentStatus || "지급 예정", updatedAt: new Date().toISOString()
      });
      if (!existing) store.contracts.push(item);
      const customer = customerById(item.customerId);
      const building = buildingById(item.buildingId);
      logAudit({ category: existing ? "변경" : "등록", targetType: "계약", targetId: item.id, targetLabel: item.name, action: `${types.join("·")} · ${item.status} · ${building && building.name || "건물"}`, reason: "계약 관리" });
      scheduleSave(); closeModal(); currentView = "contracts"; render(); showToast(`${customer && customer.name || "고객"} 계약을 저장했습니다.`, "success");
    } else if (form.id === "customerForm") {
      const wasExisting = !!form.dataset.customerId;
      if (!String(form.elements.name && form.elements.name.value || "").trim()) return showToast("고객명을 입력해 주세요.", "error");
      const customer = customerFromForm(form);
      logAudit({ category: wasExisting ? "변경" : "등록", targetType: "고객", targetId: customer.id, targetLabel: customer.name, action: wasExisting ? "고객 기본정보 수정" : "신규 고객 등록", reason: "고객 관리" });
      scheduleSave(); closeModal(); render(); renderCustomerDrawer(customer.id); showToast(`${customer.name} 고객을 저장했습니다.`, "success");
    } else if (form.id === "partnerVendorForm") {
      const raw = Object.fromEntries(new FormData(form).entries());
      if (!String(raw.vendor || "").trim()) return showToast("업체명을 입력해 주세요.", "error");
      const editing = partnerVendorById(form.dataset.partnerVendorId);
      const normalizedUrl = String(raw.quoteUrl || "").trim().replace(/\/$/, "").toLowerCase();
      const normalizedPhones = [...new Set([raw.phone, raw.alternatePhone].map(Core.normalizePhone).filter(Boolean))];
      const normalizedName = Core.normalizeText(raw.vendor);
      const duplicate = allPartnerVendorRows().find(item => String(item.id) !== String(editing && editing.id || "") && (
        (normalizedUrl && String(item.quoteUrl || "").trim().replace(/\/$/, "").toLowerCase() === normalizedUrl) ||
        (normalizedPhones.length && [item.phone, item.alternatePhone].some(value => normalizedPhones.includes(Core.normalizePhone(value)))) ||
        (normalizedName && Core.normalizeText(partnerVendorName(item)) === normalizedName && partnerIndustry(item) === raw.industry)
      ));
      if (duplicate && duplicate.active !== false) return showToast("이미 등록된 연락 업체입니다. 기존 업체 정보를 수정해 주세요.", "error");
      const existingItem = editing || duplicate || null;
      const item = Object.assign({}, existingItem || newPartnerVendor(), {
        vendor: String(raw.vendor || "").trim(), name: String(raw.vendor || "").trim(), industry: raw.industry,
        phone: customerPhoneText(raw.phone), phoneLabel: String(raw.phoneLabel || "").trim(),
        alternatePhone: customerPhoneText(raw.alternatePhone), alternatePhoneLabel: String(raw.alternatePhoneLabel || "").trim(),
        quoteUrl: String(raw.quoteUrl || "").trim(), service: String(raw.service || "").trim(), category: String(raw.service || "").trim(),
        region: String(raw.region || "").trim() || "원주", memo: String(raw.memo || "").trim(), active: true, updatedAt: new Date().toISOString()
      });
      delete item.customerId;
      delete item.buildingId;
      store.partnerVendors ||= [];
      const prospectiveVendors = store.partnerVendors.map(vendor => existingItem && vendor === existingItem ? item : vendor);
      if (!existingItem) prospectiveVendors.push(item);
      try {
        // Validate the exact post-submit shared document before changing the
        // renderer store. A rejected value must never leave a ghost vendor in
        // the list or a success message on screen.
        Core.assertNoProhibitedSecrets(Core.sanitizeSharedStore(Object.assign({}, store, { partnerVendors: prospectiveVendors })));
      } catch (error) {
        return showToast(error && error.message || "저장할 수 없는 민감정보가 포함되어 있습니다.", "error");
      }
      if (existingItem) Object.assign(existingItem, item);
      else store.partnerVendors.push(item);
      logAudit({ category: editing || duplicate ? "변경" : "등록", targetType: "연락 업체", targetId: item.id, targetLabel: partnerVendorName(item), action: duplicate ? "제외 업체 재등록" : editing ? "업체 기본정보 수정" : "연락 업체 등록", reason: "연락 업체 관리" });
      scheduleSave(); closeModal(); currentView = "partnerVendors"; render(); showToast(`${partnerVendorName(item)} 업체 정보를 저장했습니다.`, "success");
    } else if (form.id === "partnerQuoteForm") {
      const raw = Object.fromEntries(new FormData(form).entries());
      if (!String(raw.industry || "").trim()) return showToast("업종을 먼저 선택해 주세요.", "error");
      const selectedVendor = partnerVendorById(raw.vendorId);
      if (!selectedVendor) return showToast("저장된 연락 업체를 선택해 주세요.", "error");
      if (!String(raw.scenario || "").trim()) return showToast("문의한 작업 조건을 입력해 주세요.", "error");
      const existing = store.partnerQuotes.find(item => item.id === form.dataset.partnerQuoteId);
      const item = existing || Core.createPartnerQuote({ owner: store.settings.owner || "김현진" });
      const checklistRows = INDUSTRY_CHECKLISTS[raw.industry] || INDUSTRY_CHECKLISTS["기타"];
      const checklist = Object.fromEntries(checklistRows.map(([key]) => [key, !!form.elements[`check__${key}`]?.checked]));
      const inspectionMin = Core.money(raw.inspectionMin);
      const inspectionMax = Core.money(raw.inspectionMax);
      const constructionMin = Core.money(raw.constructionMin);
      const constructionMax = Core.money(raw.constructionMax);
      const travelMin = Core.money(raw.travelMin);
      const travelMax = Core.money(raw.travelMax);
      const totalMin = Core.money(raw.totalMin);
      const totalMax = Core.money(raw.totalMax);
      const hasPrice = inspectionMin || inspectionMax || constructionMin || constructionMax || travelMin || travelMax || totalMin || totalMax;
      const keepVendorSnapshot = !!existing && String(existing.vendorId || "") === String(selectedVendor.id || "");
      const snapshotValue = (field, fallback) => keepVendorSnapshot && Object.prototype.hasOwnProperty.call(existing, field) ? existing[field] : fallback;
      const selectedService = String(selectedVendor.service || selectedVendor.category || "").trim();
      Object.assign(item, {
        vendorId: selectedVendor.id, industry: raw.industry, scenario: String(raw.scenario || "").trim(),
        service: snapshotValue("service", selectedService), category: keepVendorSnapshot ? existing.category : selectedService, vendor: snapshotValue("vendor", partnerVendorName(selectedVendor)),
        phone: snapshotValue("phone", String(selectedVendor.phone || "").trim()), phoneLabel: snapshotValue("phoneLabel", String(selectedVendor.phoneLabel || "").trim()),
        alternatePhone: snapshotValue("alternatePhone", String(selectedVendor.alternatePhone || "").trim()), alternatePhoneLabel: snapshotValue("alternatePhoneLabel", String(selectedVendor.alternatePhoneLabel || "").trim()),
        quoteUrl: snapshotValue("quoteUrl", String(selectedVendor.quoteUrl || "").trim()), region: snapshotValue("region", String(selectedVendor.region || "").trim() || "원주"), status: raw.status,
        inspectionMin, inspectionMax, constructionMin, constructionMax, travelMin, travelMax, totalMin, totalMax,
        constructionPricing: String(raw.constructionPricing || "").trim(), travelPolicy: String(raw.travelPolicy || "").trim() || "미확인",
        noFindPolicy: String(raw.noFindPolicy || "").trim() || "미확인", includedWork: String(raw.includedWork || "").trim(), priceNegotiable: !!raw.priceNegotiable,
        responseSpeed: String(raw.responseSpeed || "").trim(), warranty: String(raw.warranty || "").trim(), checklist,
        contactedAt: raw.contactedAt || "", receivedAt: raw.receivedAt || (hasPrice ? todayKey() : ""), consultedAt: raw.consultedAt || "", consultationContent: String(raw.consultationContent || "").trim(),
        owner: String(raw.owner || "").trim() || store.settings.owner || "김현진", memo: String(raw.memo || "").trim(), updatedAt: new Date().toISOString()
      });
      delete item.customerId;
      delete item.buildingId;
      if (!existing) store.partnerQuotes.push(item);
      logAudit({ category: existing ? "변경" : "등록", targetType: "협력업체 상담", targetId: item.id, targetLabel: item.vendor, action: `${item.industry} · ${item.scenario} · ${item.status} · ${moneyRange(item.totalMin, item.totalMax, "가격 미확인")}`, reason: "업체 상담 관리" });
      scheduleSave(); closeModal(); currentView = "partnerQuotes"; render(); showToast(`${item.vendor} 상담 기록을 저장했습니다.`, "success");
    } else if (form.id === "taskForm") {
      const raw = Object.fromEntries(new FormData(form).entries());
      if (!raw.title.trim()) return showToast("할 일을 입력해 주세요.", "error");
      const returnCustomerId = String(form.dataset.returnCustomer || "");
      const task = Core.createTask(raw);
      store.tasks.push(task);
      logAudit({ category: "등록", targetType: "영업 할 일", targetId: task.id, targetLabel: task.title, action: "영업 할 일 등록", reason: "후속 업무 관리" });
      scheduleSave(); closeModal(); render(); if (returnCustomerId && customerById(returnCustomerId)) renderCustomerDrawer(returnCustomerId); showToast("할 일을 추가했습니다.", "success");
    } else if (form.id === "relationshipActivityForm") {
      const raw = Object.fromEntries(new FormData(form).entries());
      const customer = customerById(form.dataset.customerId);
      if (!customer) return showToast("고객 정보를 찾지 못했습니다.", "error");
      if (!raw.summary.trim()) return showToast("후속 연락 내용을 입력해 주세요.", "error");
      const activity = Core.createActivity({ customerId: customer.id, context: "relationship", previousCustomerState: { lastContactAt: customer.lastContactAt || "", nextAction: customer.nextAction || "", nextContactAt: customer.nextContactAt || "", relationshipLastContactAt: customer.relationshipLastContactAt || "", relationshipNextAction: customer.relationshipNextAction || "", relationshipNextContactAt: customer.relationshipNextContactAt || "" }, type: raw.type, occurredAt: raw.occurredAt ? new Date(raw.occurredAt).toISOString() : new Date().toISOString(), summary: raw.summary.trim(), result: raw.result.trim(), nextAction: raw.nextAction.trim(), nextContactAt: raw.nextContactAt ? new Date(raw.nextContactAt).toISOString() : "", owner: store.settings.owner || "김현진" });
      store.activities.push(activity);
      beginRelationship(customer);
      customer.lastContactAt = activity.occurredAt;
      customer.relationshipLastContactAt = activity.occurredAt;
      if (activity.nextAction) {
        customer.nextAction = activity.nextAction;
        customer.relationshipNextAction = activity.nextAction;
      }
      customer.nextContactAt = activity.nextContactAt || customer.nextContactAt;
      customer.relationshipNextContactAt = activity.nextContactAt || addDaysIso(activity.occurredAt, customer.relationshipCycleDays);
      customer.updatedAt = new Date().toISOString();
      logAudit({ category: "변경", targetType: "계약 고객", targetId: customer.id, targetLabel: customer.name, action: `${activity.type} 후속 연락 기록 추가`, reason: "계약 후 관계 관리" });
      scheduleSave(); render(); renderRelationshipDrawer(customer.id); showToast("후속 연락을 저장했습니다.", "success");
    } else if (form.id === "activityForm") {
      const raw = Object.fromEntries(new FormData(form).entries());
      if (!raw.summary.trim()) return showToast("상담 내용을 입력해 주세요.", "error");
      const customer = customerById(form.dataset.customerId);
      const activity = Core.createActivity(Object.assign(raw, { customerId: form.dataset.customerId, context: customerIsRelationshipCustomer(customer) ? "relationship" : "consultation", owner: store.settings.owner || "김현진", occurredAt: raw.occurredAt ? new Date(raw.occurredAt).toISOString() : new Date().toISOString(), nextContactAt: raw.nextContactAt ? new Date(raw.nextContactAt).toISOString() : "" }));
      store.activities.push(activity);
      if (customer) {
        customer.lastContactAt = activity.occurredAt;
        if (activity.nextAction) customer.nextAction = activity.nextAction;
        if (activity.nextContactAt) customer.nextContactAt = activity.nextContactAt;
        if (customerIsRelationshipCustomer(customer)) {
          beginRelationship(customer);
          customer.relationshipLastContactAt = activity.occurredAt;
          customer.relationshipNextContactAt = activity.nextContactAt || addDaysIso(activity.occurredAt, customer.relationshipCycleDays);
          if (activity.nextAction) customer.relationshipNextAction = activity.nextAction;
        }
        customer.updatedAt = new Date().toISOString();
      }
      logAudit({ category: "변경", targetType: "고객", targetId: form.dataset.customerId, targetLabel: customer && customer.name || "고객", action: `${activity.type} 상담 기록 추가`, reason: "상담 이력 관리" });
      scheduleSave(); render(); renderCustomerDrawer(form.dataset.customerId); showToast("상담 기록을 추가했습니다.", "success");
    } else if (form.id === "consultationForm") {
      const raw = Object.fromEntries(new FormData(form).entries());
      const returnView = form.dataset.returnView || "consultations";
      if (!String(raw.customerType || "").trim()) return showToast("고객 유형을 먼저 선택해 주세요.", "error");
      if (!raw.customerId) return showToast("고객을 선택해 주세요.", "error");
      if (!raw.summary.trim()) return showToast("상담 내용을 입력해 주세요.", "error");
      const customer = customerById(raw.customerId);
      const buildingId = returnView === "consultations" ? String(raw.buildingId || "").trim() : "";
      if (buildingId && (!customer || !customerBuildings(customer).some(building => String(building.id) === buildingId))) return showToast("선택한 고객과 연결된 건물을 선택해 주세요.", "error");
      const activity = Core.createActivity({ customerId: raw.customerId, buildingId, context: returnView === "relationships" || customerIsRelationshipCustomer(customer) ? "relationship" : "consultation", type: raw.type, occurredAt: raw.occurredAt ? new Date(raw.occurredAt).toISOString() : new Date().toISOString(), summary: raw.summary.trim(), result: raw.result.trim(), nextAction: raw.nextAction.trim(), nextContactAt: raw.nextContactAt ? new Date(raw.nextContactAt).toISOString() : "", owner: raw.owner.trim() || store.settings.owner || "김현진" });
      store.activities.push(activity);
      if (customer) {
        customer.lastContactAt = activity.occurredAt;
        if (activity.nextAction) customer.nextAction = activity.nextAction;
        if (activity.nextContactAt) customer.nextContactAt = activity.nextContactAt;
        if (returnView === "relationships" || customerIsRelationshipCustomer(customer)) {
          beginRelationship(customer);
          customer.relationshipLastContactAt = activity.occurredAt;
          customer.relationshipNextContactAt = activity.nextContactAt || addDaysIso(activity.occurredAt, customer.relationshipCycleDays);
          customer.relationshipNextAction = activity.nextAction || customer.relationshipNextAction || "정기 안부 및 추가 요청 확인";
        }
        customer.updatedAt = new Date().toISOString();
      }
      logAudit({ category: "변경", targetType: "고객", targetId: raw.customerId, targetLabel: customer && customer.name || "고객", action: `${activity.type} 상담 기록 추가`, reason: "상담 이력 관리" });
      scheduleSave(); closeModal(); currentView = returnView; render(); if (returnView === "relationships") renderRelationshipDrawer(raw.customerId); showToast(returnView === "relationships" ? "후속 연락을 기록했습니다." : "상담 기록을 저장했습니다.", "success");
    } else if (form.id === "relationshipPlanForm") {
      const raw = Object.fromEntries(new FormData(form).entries());
      const customer = customerById(form.dataset.customerId);
      if (!customer) return showToast("고객 정보를 찾지 못했습니다.", "error");
      if (!raw.relationshipNextContactAt) return showToast("다음 연락일을 입력해 주세요.", "error");
      customer.relationshipCycleDays = Number(raw.relationshipCycleDays) || 30;
      customer.relationshipNextContactAt = new Date(raw.relationshipNextContactAt).toISOString();
      customer.relationshipNextAction = raw.relationshipNextAction.trim() || "계약 후 만족도 확인";
      customer.relationshipNote = raw.relationshipNote.trim();
      customer.relationshipStartedAt = customer.relationshipStartedAt || new Date().toISOString();
      customer.updatedAt = new Date().toISOString();
      logAudit({ category: "변경", targetType: "고객", targetId: customer.id, targetLabel: customer.name, action: `계약 고객 연락 계획 설정 · ${customer.relationshipCycleDays}일 주기`, reason: "계약 후 관계 관리" });
      scheduleSave(); closeModal(); currentView = "relationships"; render(); renderRelationshipDrawer(customer.id); showToast("다음 연락 계획을 저장했습니다.", "success");
    } else if (form.id === "securityReturnForm") {
      if (!requireSecurityPermission(false)) return;
      const raw = Object.fromEntries(new FormData(form).entries());
      const item = store.securityAssets.find(entry => entry.id === form.dataset.assetId);
      if (!item || item.status !== "대여중") return showToast("반납 처리할 대여 항목을 찾지 못했습니다.", "error");
      if (!raw.returnedBy.trim() || !raw.receivedBy.trim() || !raw.returnedAt || !raw.storageLocation.trim()) return showToast("반환자·인수자·반납 일시·보관 장소를 모두 확인해 주세요.", "error");
      item.status = "반납완료";
      item.holder = "";
      item.returnedAt = new Date(raw.returnedAt).toISOString();
      item.storageLocation = raw.storageLocation.trim();
      item.returnEvidence = { returnedBy: raw.returnedBy.trim(), receivedBy: raw.receivedBy.trim(), returnedAt: item.returnedAt, condition: raw.returnCondition, storageLocation: item.storageLocation, note: raw.returnNote.trim() };
      item.updatedAt = new Date().toISOString();
      logAudit({ category: "키반납", targetType: item.type, targetId: item.id, targetLabel: item.label, action: `반납 완료 · 반환 ${item.returnEvidence.returnedBy} · 인수 ${item.returnEvidence.receivedBy} · 상태 ${item.returnEvidence.condition}`, reason: item.returnEvidence.note || "열쇠·문서 반납 관리" });
      scheduleSave(); closeModal(); renderSecurity(); showToast(`${item.label} 반납 확인 기록을 저장했습니다.`, "success");
    } else if (form.id === "securityDispositionForm") {
      if (!requireSecurityPermission(false)) return;
      const raw = Object.fromEntries(new FormData(form).entries());
      const item = store.securityAssets.find(entry => entry.id === form.dataset.assetId);
      if (!item || ["폐기", "무효"].includes(item.status)) return showToast("처리할 항목을 찾지 못했습니다.", "error");
      if (!raw.disposedAt || !raw.method.trim() || !raw.approvedBy.trim() || !raw.reason.trim()) return showToast("처리 일시·방법·승인자·사유를 모두 입력해 주세요.", "error");
      const isDisposal = raw.dispositionType === "보관기간 종료 보안 파기";
      item.status = isDisposal ? "폐기" : "무효";
      item.disposition = { type: raw.dispositionType, disposedAt: new Date(raw.disposedAt).toISOString(), method: raw.method.trim(), approvedBy: raw.approvedBy.trim(), reason: raw.reason.trim(), evidence: raw.evidence.trim() };
      item.updatedAt = new Date().toISOString();
      logAudit({ category: isDisposal ? "파기" : "변경", targetType: item.type, targetId: item.id, targetLabel: item.label, action: `${raw.dispositionType} · ${item.disposition.method} · 승인 ${item.disposition.approvedBy}`, reason: item.disposition.reason });
      scheduleSave(); closeModal(); renderSecurity(); showToast(`${item.label}을(를) 삭제하지 않고 ${item.status} 처리했습니다.`, "success");
    } else if (form.id === "securityAssetForm") {
      if (!requireSecurityPermission(false)) return;
      const raw = Object.fromEntries(new FormData(form).entries());
      const sensitiveText = Object.values(raw).join(" ");
      if (!raw.label.trim()) return showToast("관리 대상명을 입력해 주세요.", "error");
      if (containsProhibitedSecret(sensitiveText)) return showToast("실제 주민등록번호나 비밀번호는 저장할 수 없습니다.", "error");
      const existing = store.securityAssets.find(item => item.id === form.dataset.assetId);
      const item = existing || Core.createSecurityAsset();
      const previousStatus = item.status;
      Object.assign(item, { type: raw.type, label: raw.label.trim(), buildingId: raw.buildingId, room: raw.room.trim(), holder: raw.holder.trim(), status: raw.status, issuedAt: raw.issuedAt ? new Date(raw.issuedAt).toISOString() : "", dueAt: raw.dueAt || "", retentionUntil: raw.retentionUntil || "", storageLocation: raw.storageLocation.trim(), sensitivity: raw.sensitivity, memo: raw.memo.trim(), updatedAt: new Date().toISOString() });
      if (item.status === "반납완료" && previousStatus !== "반납완료") item.returnedAt = new Date().toISOString();
      if (!existing) store.securityAssets.push(item);
      const category = item.status === "대여중" && previousStatus !== "대여중" ? "키대여" : item.status === "반납완료" && previousStatus !== "반납완료" ? "키반납" : existing ? "변경" : "등록";
      logAudit({ category, targetType: item.type, targetId: item.id, targetLabel: item.label, action: existing ? `관리정보 수정 · 상태 ${item.status}` : "새 관리 대상 등록", reason: "개인정보·키 통제" });
      scheduleSave(); closeModal(); renderSecurity(); showToast(`${item.label}을(를) 저장했습니다.`, "success");
    } else if (form.id === "accessRoleForm") {
      if (!requireSecurityPermission(true)) return;
      const raw = Object.fromEntries(new FormData(form).entries());
      if (!raw.name.trim()) return showToast("역할명을 입력해 주세요.", "error");
      const existing = store.accessRoles.find(item => item.id === form.dataset.roleId);
      const role = existing || Core.createAccessRole();
      Object.assign(role, { name: raw.name.trim(), scope: raw.scope.trim(), status: raw.status, canView: !!raw.canView, canEdit: !!raw.canEdit, canDownload: !!raw.canDownload, canManageSecurity: !!raw.canManageSecurity, updatedAt: new Date().toISOString() });
      if (!existing) store.accessRoles.push(role);
      logAudit({ category: "권한변경", targetType: "권한", targetId: role.id, targetLabel: role.name, action: `${existing ? "역할 수정" : "역할 추가"} · ${role.status}`, reason: "역할별 최소 권한 관리" });
      scheduleSave(); closeModal(); renderSecurity(); showToast(`${role.name} 권한을 저장했습니다.`, "success");
    } else if (form.id === "auditForm") {
      if (!requireSecurityPermission(false)) return;
      const raw = Object.fromEntries(new FormData(form).entries());
      if (!raw.targetLabel.trim() || !raw.action.trim()) return showToast("대상명과 처리 내용을 입력해 주세요.", "error");
      logAudit({ category: raw.category, targetType: raw.targetType, targetLabel: raw.targetLabel.trim(), action: raw.action.trim(), reason: raw.reason.trim() || "업무 수행" });
      scheduleSave(); closeModal(); securityTab = "audit"; renderSecurity(); showToast("처리 이력을 저장했습니다.", "success");
    } else if (form.id === "incidentForm") {
      if (!requireSecurityPermission(false)) return;
      const raw = Object.fromEntries(new FormData(form).entries());
      if (!raw.summary.trim()) return showToast("사고 내용을 입력해 주세요.", "error");
      if ((raw.status === "종결" || raw.status === "무효") && !raw.resolution.trim()) return showToast("종결·무효 처리에는 조치 또는 정정 사유를 입력해 주세요.", "error");
      const existing = store.securityIncidents.find(item => item.id === form.dataset.incidentId);
      const item = existing || Core.createSecurityIncident();
      Object.assign(item, { type: raw.type, severity: raw.severity, occurredAt: raw.occurredAt ? new Date(raw.occurredAt).toISOString() : new Date().toISOString(), reportedBy: (existing && existing.reportedBy) || raw.reportedBy.trim(), escalatedTo: raw.escalatedTo.trim(), status: raw.status, summary: raw.summary.trim(), resolution: raw.resolution.trim(), updatedAt: new Date().toISOString() });
      if (!existing) store.securityIncidents.push(item);
      logAudit({ category: "사고", targetType: "보안사고", targetId: item.id, targetLabel: item.type, action: `${existing ? "처리 내용 변경" : "사고 보고"} · ${item.status}`, actor: item.reportedBy, reason: item.summary });
      scheduleSave(); closeModal(); securityTab = "incidents"; renderSecurity(); showToast(existing ? "사고 처리 내용을 저장했습니다." : "사고를 책임자 보고 목록에 등록했습니다.", existing ? "success" : "error");
    } else if (form.id === "settingsForm") {
      const raw = Object.fromEntries(new FormData(form).entries());
      store.company.workspace = raw.workspace.trim();
      scheduleSave(); renderSettings(); showToast("설정을 저장했습니다.", "success");
    }
  });

  searchEl.addEventListener("input", () => {
    if (currentView === "fieldOperations") {
      fieldNavigationState.search = searchEl.value.slice(0, 256);
      saveFieldNavigationState();
      clearTimeout(fieldSearchTimer);
      fieldSearchTimer = setTimeout(() => {
        void sendFieldNavigation();
      }, 180);
      return;
    }
    if (currentView === "buildingCalendar") {
      workCalendarQuery = searchEl.value.slice(0, 160);
      renderBuildingCalendar();
      return;
    }
    crmSearchValue = searchEl.value;
    if (currentView === "cases") renderCases();
    if (currentView === "customers") renderCustomers();
    if (currentView === "buildings") renderBuildings();
    if (currentView === "vacancies") renderVacancies();
    if (currentView === "contracts") renderContracts();
    if (currentView === "partnerVendors") renderPartnerVendors();
    if (currentView === "partnerQuotes") renderPartnerQuotes();
    if (currentView === "pipeline") renderPipeline();
  });
  searchEl.addEventListener("keydown", event => { if (event.key === "Enter") { if (["fieldOperations", "buildingCalendar"].includes(currentView)) return; if (!["cases", "buildings", "vacancies", "contracts", "partnerVendors", "partnerQuotes", "pipeline"].includes(currentView)) currentView = "customers"; render(); } });
  fieldOperatorSelect.addEventListener("change", async () => {
    const previousOperatorId = selectedFieldOperatorId;
    const nextOperatorId = String(fieldOperatorSelect.value || "");
    if (nextOperatorId && !fieldTeamProfiles.some(profile => profile.active === true && profile.id === nextOperatorId)) {
      fieldOperatorSelect.value = previousOperatorId;
      return showToast("선택할 수 없는 작업자입니다.", "error");
    }
    selectedFieldOperatorId = nextOperatorId;
    try {
      if (selectedFieldOperatorId) localStorage.setItem(fieldOperatorStorageKey(), JSON.stringify({ operatorId: selectedFieldOperatorId, selectedAt: new Date().toISOString() }));
      else localStorage.removeItem(fieldOperatorStorageKey());
    } catch (_error) {}
    renderFieldOperatorControl();
    if (nextOperatorId && previousOperatorId !== nextOperatorId && fieldConnectionState.ready) {
      await sendFieldNavigation();
    } else if (!nextOperatorId && previousOperatorId && fieldConnectionState.ready) {
      await sendFieldNavigation();
    }
    const selected = activeFieldOperator();
    showToast(selected ? `현재 작업자를 ${selected.name}(으)로 선택했습니다.` : "현재 작업자 선택을 해제했습니다.", selected ? "success" : "");
  });
  document.addEventListener("beforeinput", event => {
    if (!event.target.matches(formattedPhoneInputSelector) || event.isComposing) return;
    const direction = event.inputType === "deleteContentBackward" ? "backward" : event.inputType === "deleteContentForward" ? "forward" : "";
    if (direction && deleteCustomerPhoneDigit(event.target, direction)) event.preventDefault();
  });
  document.addEventListener("input", event => {
    if (event.target.matches(formattedPhoneInputSelector)) {
      if (!event.isComposing) formatCustomerPhoneInput(event.target);
    } else if (event.target.matches("[data-vacancy-unit-search]")) {
      vacancyUnitQuery = event.target.value.slice(0, 256);
      if (event.isComposing) return;
      const caret = event.target.selectionStart;
      renderVacancies();
      const input = document.querySelector("[data-vacancy-unit-search]");
      input?.focus();
      if (Number.isInteger(caret)) input?.setSelectionRange(caret, caret);
    } else if (event.target.matches("#vacancyConfigurationForm [data-vacancy-floor-label], #vacancyConfigurationForm [data-vacancy-floor-order], #vacancyConfigurationForm [data-vacancy-floor-count], #vacancyConfigurationForm [data-vacancy-unit-label]")) {
      renderVacancyConfigurationPreview(event.target.closest("#vacancyConfigurationForm"));
    } else if (event.target.matches("[data-partner-vendor-search]")) {
      renderPartnerVendorPicker(event.target.closest("#partnerQuoteForm"));
    } else if (event.target.matches("[data-consultation-customer-search]")) {
      renderConsultationCustomerPicker(event.target.closest("#consultationForm"));
    } else if (event.target.matches("[data-sales-query]")) {
      searchEl.value = event.target.value;
      renderPipeline();
      const input = document.querySelector("[data-sales-query]");
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    } else if (event.target.matches("[data-sales-standards-search]")) {
      openSalesStandards(event.target.value);
    }
  });
  document.addEventListener("compositionend", event => {
    if (event.target.matches(formattedPhoneInputSelector)) formatCustomerPhoneInput(event.target);
  });
  confirmationLayer.addEventListener("click", event => {
    const choice = event.target.closest("[data-confirm-choice]")?.dataset.confirmChoice;
    if (choice === "confirm") finishConfirmation(true);
    else if (choice === "cancel") finishConfirmation(false);
  });
  modal.addEventListener("click", event => { if (event.target === modal) closeModal(); });
  drawer.addEventListener("click", event => { if (event.target === drawer) closeDrawer(); });
document.addEventListener("keydown", event => {
  if (confirmationLayer.classList.contains("open")) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finishConfirmation(false); }
    else if (event.key === "Enter" && !event.target.closest?.("[data-confirm-choice]")) { event.preventDefault(); event.stopPropagation(); finishConfirmation(true); }
    else if (event.key === "Tab") {
      const controls = [...confirmationCard.querySelectorAll("button:not([disabled])")];
      if (controls.length) {
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    return;
  }
  const buildingLinkInput = event.target.closest?.('#buildingForm [name="naverBuildingUrl"]');
  if (buildingLinkInput && event.key === "Enter" && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault();
    buildingLinkInput.closest("form")?.querySelector("[data-building-link-lookup]")?.click();
    return;
  }
  const pickerSearch = event.target.closest?.("[data-partner-vendor-search], [data-consultation-customer-search]");
  if (pickerSearch && event.key === "Enter" && (event.isComposing || event.keyCode === 229)) return;
  if (pickerSearch && event.key === "Escape" && pickerSearch.value) {
    event.preventDefault();
    event.stopPropagation();
    pickerSearch.value = "";
    pickerSearch.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  if (pickerSearch && ["Enter", "ArrowDown"].includes(event.key)) {
    event.preventDefault();
    const form = pickerSearch.closest("form");
    const selector = pickerSearch.matches("[data-partner-vendor-search]") ? "[data-partner-vendor-option]" : "[data-consultation-customer-option]";
    form?.querySelector(selector)?.focus();
    if (event.key === "Enter") form?.querySelector(selector)?.click();
    return;
  }
  const pickerOption = event.target.closest?.("[data-partner-vendor-option], [data-consultation-customer-option]");
  if (pickerOption && ["ArrowDown", "ArrowUp", "Home", "End", "Escape"].includes(event.key)) {
    event.preventDefault();
    const form = pickerOption.closest("form");
    const partner = pickerOption.matches("[data-partner-vendor-option]");
    const selector = partner ? "[data-partner-vendor-option]" : "[data-consultation-customer-option]";
    const options = [...(form?.querySelectorAll(selector) || [])];
    const index = options.indexOf(pickerOption);
    if (event.key === "Escape") {
      form?.querySelector(partner ? "[data-partner-vendor-search]" : "[data-consultation-customer-search]")?.focus();
    } else {
      const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : event.key === "ArrowDown" ? Math.min(options.length - 1, index + 1) : Math.max(0, index - 1);
      options[nextIndex]?.focus();
    }
    return;
  }
  if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-relationship-open]")) {
    event.preventDefault();
    renderRelationshipDrawer(event.target.dataset.relationshipOpen);
    return;
  }
  if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-contract-edit]")) {
    event.preventDefault();
    contractEditor(event.target.dataset.contractEdit);
    return;
  }
  if (event.key === "Escape") { closeModal(); closeDrawer(); }
});

  api.onShortcut(action => {
    if (currentAuth.required && !currentAuth.user) return;
    if (action === "new-customer") customerEditor("");
    if (action === "search") { searchEl.focus(); searchEl.select(); }
  });

  api.onAuthState(state => {
    setCurrentAuth(state);
    if (currentAuth.required && !currentAuth.user) showLogin(currentAuth.error || "회사 이메일과 비밀번호로 로그인해 주세요.", Boolean(currentAuth.error));
    else if (currentAuth.user && currentAuth.user.mustChangePassword) showPasswordChange(currentAuth);
    else showApplication(currentAuth);
  });

  api.onSyncState(state => {
    updateSyncUI(state);
    if (state && state.status === "connected" && appInitialized) {
      void refreshRendererOverlays().catch(() => undefined);
    }
  });
  api.onRemoteData(applyRemoteStore);
  api.onFieldEvent(envelope => {
    if (!envelope || typeof envelope !== "object" || !envelope.payload) return;
    if (envelope.type === "field.ready") {
      if (envelope.payload.session === "authenticated") {
        fieldConnectionState = Object.assign({}, fieldConnectionState, { status: "ready", message: "현장 업무가 연결되었습니다.", ready: true });
        saveFieldNavigationState();
      } else if (["missing", "expired"].includes(envelope.payload.session)) {
        fieldConnectionState = Object.assign({}, fieldConnectionState, {
          status: "connecting",
          message: "CRM 로그인으로 현장 업무를 자동 연결하고 있습니다.",
          ready: false,
        });
      }
    } else if (envelope.type === "field.routeChanged") {
      fieldNavigationState = Object.assign({}, fieldNavigationState, {
        route: envelope.payload.route,
        selectedJobId: String(envelope.payload.selectedJobId || ""),
        filter: envelope.payload.filter && typeof envelope.payload.filter === "object" ? envelope.payload.filter : {},
        scrollTop: Number.isInteger(envelope.payload.scrollTop) ? envelope.payload.scrollTop : 0,
        search: String(envelope.payload.search || "").slice(0, 256),
      });
      saveFieldNavigationState();
      if (currentView === "fieldOperations" && searchEl.value !== fieldNavigationState.search) searchEl.value = fieldNavigationState.search;
    } else if (envelope.type === "field.pendingUploads") {
      fieldConnectionState.pendingUploads = { count: envelope.payload.count, risk: envelope.payload.risk };
    } else if (envelope.type === "field.openCrmEntity") {
      void navigateFromField(envelope.payload.entityType, envelope.payload.entityId);
    }
  });
  api.onFieldState(state => {
    fieldConnectionState = Object.assign({}, fieldConnectionState, state || {});
    if (currentView === "fieldOperations" && ["disconnected", "timeout", "error", "auth-required"].includes(fieldConnectionState.status)) {
      fieldOpenGeneration += 1;
      void api.hideFieldPlatform();
      renderFieldOperations();
    }
  });
  api.onUpdateState(state => {
    const previous = currentUpdate.status;
    updateUpdaterUI(state);
    if (state.status === "ready" && previous !== "ready") showToast(`새 버전 ${state.availableVersion || ""}을 받았습니다.`, "success");
    if (state.status === "current" && previous === "checking") showToast("현재 최신 버전입니다.", "success");
  });
  api.updateState().then(updateUpdaterUI).catch(() => updateUpdaterUI({ status: "disabled" }));

  googleLoginButton.addEventListener("click", async () => {
    if (loginInProgress) return;
    loginInProgress = true;
    googleLoginButton.disabled = true;
    loginMessage.className = "login-message";
    loginMessage.textContent = "회사 Google 로그인을 확인하고 있습니다…";
    try {
      const result = await api.loginWithGoogle();
      if (!result.ok) {
        showLogin(result.error || "Google 로그인에 실패했습니다. 다시 시도해 주세요.", true);
        return;
      }
      setCurrentAuth(result.auth);
      showApplication(currentAuth);
      await loadApplication(result.data);
      showToast("회사 Google 계정으로 CRM 서버에 연결했습니다.", "success");
    } catch (error) {
      showLogin(error.message || "Google 로그인에 실패했습니다.", true);
    } finally {
      loginInProgress = false;
      googleLoginButton.disabled = false;
    }
  });

  loginForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (loginInProgress) return;
    loginInProgress = true;
    loginButton.disabled = true;
    loginMessage.className = "login-message";
    loginMessage.textContent = "회사 서버에서 계정을 확인하고 있습니다…";
    try {
      const result = await api.login({ email: loginEmail.value.trim(), password: loginPassword.value });
      if (!result.ok) {
        showLogin(result.error || "로그인하지 못했습니다. 다시 시도해 주세요.", true);
        return;
      }
      setCurrentAuth(result.auth);
      loginPassword.value = "";
      if (currentAuth.user && currentAuth.user.mustChangePassword) {
        showPasswordChange(currentAuth);
        return;
      }
      showApplication(currentAuth);
      await loadApplication(result.data);
      showToast("공용 CRM 서버에 연결되었습니다.", "success");
    } catch (error) {
      showLogin(error.message || "로그인하지 못했습니다.", true);
    } finally {
      loginInProgress = false;
      loginButton.disabled = false;
    }
  });

  passwordChangeForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (loginInProgress) return;
    if (newPassword.value !== confirmPassword.value) return showPasswordChange(currentAuth, "새 비밀번호가 서로 일치하지 않습니다.", true);
    if (newPassword.value.length < 8 || !/[A-Za-z]/.test(newPassword.value) || !/\d/.test(newPassword.value)) return showPasswordChange(currentAuth, "영문과 숫자를 포함해 8자 이상 입력해 주세요.", true);
    loginInProgress = true;
    passwordChangeButton.disabled = true;
    loginMessage.className = "login-message";
    loginMessage.textContent = "새 비밀번호를 안전하게 저장하고 있습니다…";
    try {
      const result = await api.changePassword(newPassword.value);
      if (!result.ok) {
        showPasswordChange(currentAuth, result.error || "비밀번호를 변경하지 못했습니다.", true);
        return;
      }
      setCurrentAuth(result.auth);
      newPassword.value = "";
      confirmPassword.value = "";
      showApplication(currentAuth);
      await loadApplication(result.data);
      showToast("새 비밀번호로 변경했습니다.", "success");
    } catch (error) {
      showPasswordChange(currentAuth, error.message || "비밀번호를 변경하지 못했습니다.", true);
    } finally {
      loginInProgress = false;
      passwordChangeButton.disabled = false;
    }
  });

  async function loadApplication(initialData) {
    try {
      store = Core.sanitizeStore(initialData || await api.load());
      ensureSalesStore(store);
      await refreshRendererOverlays(false).catch(() => undefined);
      await loadFieldTeamProfiles();
      dataPath = await api.dataPath();
      const query = new URLSearchParams(location.search);
      if (query.get("demo") === "1" && !store.customers.length) store = demoStore();
      synchronizedStore = cloneStore(store);
      store.partnerVendors = Array.isArray(store.partnerVendors) ? store.partnerVendors : [];
      if (["dashboard", "cases", "payments", "customers", "buildings", "vacancies", "buildingCalendar", "workManagement", "fieldOperations", "consultations", "pipeline", "contracts", "relationships", "partnerVendors", "partnerQuotes", "tasks", "security", "settings"].includes(query.get("view"))) currentView = query.get("view");
      await refreshOperations({ silent: true, render: false });
      document.getElementById("lastSaved").textContent = store.updatedAt ? `최신 반영 ${dateText(store.updatedAt)}` : "새 데이터";
      render();
      appInitialized = true;
      if (currentView === "buildings") requestDriveImportCandidatesRefresh();
      if (!store.settings.onboardingComplete) setTimeout(showWelcomeGuide, 350);
    } catch (error) {
      main.innerHTML = empty("CRM을 시작하지 못했습니다", error.message || "데이터 파일을 확인하세요.");
      showToast(error.message, "error");
    }
  }

  async function init() {
    try {
      setCurrentAuth(await api.authState());
      if (currentAuth.required && !currentAuth.user) {
        showLogin(currentAuth.error || "허용된 회사 이메일과 비밀번호를 입력해 주세요.", Boolean(currentAuth.error));
        return;
      }
      if (currentAuth.user && currentAuth.user.mustChangePassword) {
        showPasswordChange(currentAuth);
        return;
      }
      showApplication(currentAuth);
      updateSyncUI(currentAuth.required ? { status: "syncing", message: "공용 서버 연결 확인 중" } : { status: "connected", message: "테스트 데이터 사용 중" });
      await loadApplication();
    } catch (error) {
      showLogin(error.message || "로그인 상태를 확인하지 못했습니다.", true);
    }
  }

  window.__crmTest = {
    snapshot: () => ({
      ready: !!store,
      initialized: appInitialized,
      view: currentView,
      customers: store.customers.length,
      buildings: store.buildings.length,
      salesProspects: store.salesProspects.length,
      salesEvents: store.salesEvents.length,
      salesOpportunities: store.salesOpportunities.length,
      partnerVendors: partnerVendorRows().length,
      partnerQuotes: store.partnerQuotes.length,
      cases: activeCases().length,
      vacancyBuildings: (store.buildings || []).filter(building => building && !building.archivedAt).length,
      vacancyUnits: (store.buildingUnits || []).filter(unit => unit && !unit.archivedAt).length,
      selectedVacancyBuildingId,
      vacancyStatusFilter,
      paymentRows: paymentRows("all").length,
      tasks: store.tasks.length,
      title: document.getElementById("pageTitle").textContent,
      bodyText: main.textContent.slice(0, 300),
      modalOpen: modal.classList.contains("open"),
      confirmationOpen: confirmationLayer.classList.contains("open"),
      drawerOpen: drawer.classList.contains("open"),
      loginVisible: !loginGate.hidden,
      passwordChangeVisible: !passwordChangeForm.hidden,
      authEmail: currentAuth.user && currentAuth.user.email || "",
      syncStatus: currentSync.status
    }),
    setDemo: () => { store = demoStore(); synchronizedStore = cloneStore(store); render(); },
    getStore: () => JSON.parse(JSON.stringify(store)),
    getOperations: () => JSON.parse(JSON.stringify(operations)),
    customerSalesProgress: customerId => JSON.parse(JSON.stringify(customerSalesProgress(customerById(customerId)))),
    confirmPending: () => finishConfirmation(true),
    cancelPending: () => finishConfirmation(false),
    applyRemoteForTest: data => applyRemoteStore(data)
  };

  setInterval(() => {
    if (["cases", "payments", "buildings", "pipeline"].includes(currentView) && !document.hidden) refreshOperations({ silent: true });
  }, 30000);

  init();
})();
