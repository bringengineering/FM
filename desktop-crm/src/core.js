(function attachBringCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function makeBringCore() {
  const PIPELINE_STAGES = ["신규 고객", "상담 준비", "상담 중", "상담 완료", "계약 중", "계약 확정"];
  const LEGACY_PIPELINE_STAGE_MAP = Object.freeze({
    "신규": "신규 고객",
    "연락예정": "상담 준비",
    "현장방문": "상담 중",
    "상담완료": "상담 완료",
    "견적·제안": "계약 중",
    "계약": "계약 확정",
    "관리중": "계약 확정"
  });
  const PARTNER_QUOTE_STATUSES = ["연락 예정", "상담 중", "상담 완료", "협력 후보", "제외"];
  const LEGACY_PARTNER_QUOTE_STATUS_MAP = Object.freeze({
    "견적 요청": "상담 중",
    "견적 받음": "상담 완료"
  });
  const PARTNER_INDUSTRIES = ["누수", "설비·배관", "전기·조명", "청소", "타일·방수", "도배·장판", "보일러·냉난방", "소방", "CCTV·보안", "방역", "폐기물", "기타"];
  const BUILDING_MAINTENANCE_INCLUDES = ["수도", "인터넷", "TV", "공용전기", "기타"];
  const BUILDING_ROOM_TYPES = ["원룸", "1.5룸", "투룸", "기타"];
  const BUILDING_ROOM_OPTIONS = ["냉장고", "세탁기", "에어컨", "전자레인지", "TV", "침대", "책상·의자", "옷장·행거", "신발장", "기타"];
  const BUILDING_UNIT_STATUSES = ["unknown", "occupied", "vacant", "move_out_scheduled", "maintenance"];
  const LEGACY_BUILDING_UNIT_STATUS_MAP = Object.freeze({ active: "occupied" });
  const CONTRACT_TYPES = ["청소", "건물관리", "부동산관리"];
  const CONTRACT_STATUSES = ["계약 준비", "진행 중", "종료 예정", "종료"];
  const WORKFLOW_STEPS = [
    "문의 접수 / 정보 입력", "접수확인 발송", "상담·요청 파악", "민원·요청 분류", "업체 견적 요청",
    "견적 비교", "최적 추천", "건물주에 추천 발송", "승인·입금 (계약)", "입금 확인",
    "업체 연결·일정", "공사 진행", "작업 사진(전/후)", "B/A 보고서", "정산·증빙", "월간 리포트", "유지관리·사후관리"
  ];
  const SECURITY_ASSET_TYPES = ["열쇠", "출입카드", "비밀번호 관리항목", "계약서", "신분확인 문서", "기타"];
  const SECURITY_ASSET_STATUSES = ["보관중", "대여중", "반납완료", "분실", "폐기", "무효"];
  const AUDIT_CATEGORIES = ["조회", "등록", "변경", "공유", "반출", "삭제", "백업", "파기", "권한변경", "키대여", "키반납", "사고"];

  const pad = value => String(value).padStart(2, "0");
  const random = prefix => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const iso = value => {
    const date = value ? new Date(value) : new Date();
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  };
  const dayKey = value => {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };
  const normalizePhone = value => String(value || "").replace(/\D/g, "");
  const normalizeText = value => String(value || "").trim().toLowerCase().replace(/\s+/g, "");
  const money = value => Number(String(value || 0).replace(/[^0-9.-]/g, "")) || 0;
  const nonNegativeInteger = value => {
    const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, "").replace(/원/g, "").trim());
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(parsed));
  };
  const boundedInteger = (value, minimum, maximum, fallback = 0) => {
    const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
    return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
  };
  const optionalDate = value => {
    const text = String(value || "").trim();
    if (!text) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const candidate = new Date(`${text}T00:00:00.000Z`);
      return !Number.isNaN(candidate.getTime()) && candidate.toISOString().slice(0, 10) === text ? text : "";
    }
    try { return new Date(text).toISOString() === text ? text : ""; }
    catch (_error) { return ""; }
  };

  function normalizeStringList(value) {
    let source = [];
    if (Array.isArray(value)) source = value;
    else if (typeof value === "string") source = value.split(/[,\n\r]+/);
    else if (value && typeof value === "object") {
      source = Object.keys(value)
        .sort((left, right) => Number(left) - Number(right))
        .map(key => value[key]);
    }
    return [...new Set(source.map(item => String(item ?? "").trim()).filter(Boolean))];
  }
  const RESIDENT_REGISTRATION_NUMBER = /(?<!\d)\d{6}\s*-?\s*[1-8]\d{6}(?!\d)/;
  const SECRET_VALUE = /(?:비밀번호|비번|패스워드|암호|password|passcode|\bpw\b|\bpin\b|도어락(?:\s*번호)?|공동\s*현관(?:\s*번호)?|출입\s*번호|현관\s*번호|문\s*열림\s*번호)\s*(?:은|는|이|가|번호|코드|:|=|-|is)?\s*([0-9a-z!@#$%^&*._-](?:\s?[0-9a-z!@#$%^&*._-]){3,})/i;
  const SECRET_FIELD = /^(?:비밀번호|비번|패스워드|암호|도어락번호|공동현관번호|출입번호|현관번호|password|passcode|pw|pin|doorlockcode|accesscode)$/i;
  const SECRET_CONTEXT = /(?:비밀번호|비번|패스워드|암호|password|passcode|\bpw\b|\bpin\b|도어락|공동\s*현관|출입\s*번호|현관\s*번호)/i;
  const SECRET_DETAIL_FIELD = /^(?:값|내용|메모|비고|코드|번호|상세|value|memo|note|details|code|number)$/i;
  const SECRET_CODE_ONLY = /^[0-9a-z!@#$%^&*._-](?:\s?[0-9a-z!@#$%^&*._-]){3,}$/i;
  const normalizePipelineStage = value => {
    const stage = String(value || "신규 고객");
    return LEGACY_PIPELINE_STAGE_MAP[stage] || stage;
  };

  const stableKeyHash = value => {
    let hash = 2166136261;
    for (const char of String(value || "")) {
      hash ^= char.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  };

  const firebaseSafeKey = value => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const cleaned = raw.replace(/[.#$\[\]\/\u0000-\u001f\u007f]/g, "_");
    if (cleaned === raw && raw.length <= 100) return raw;
    return `${cleaned.slice(0, 88)}_${stableKeyHash(raw)}`.slice(0, 100);
  };

  function normalizeCustomer(value) {
    const customer = Object.assign({}, value || {});
    customer.stage = normalizePipelineStage(customer.stage);
    customer.buildingIds = normalizeStringList(customer.buildingIds);
    const rawLinks = customer.buildingIdLinks && typeof customer.buildingIdLinks === "object" && !Array.isArray(customer.buildingIdLinks)
      ? customer.buildingIdLinks
      : {};
    customer.buildingIdLinks = Object.fromEntries(Object.entries(rawLinks)
      .filter(([buildingId, linked]) => linked === true
        && !["__proto__", "prototype", "constructor"].includes(buildingId)
        && firebaseSafeKey(buildingId) === buildingId));
    return customer;
  }

  function customerBuildingIds(value) {
    const customer = normalizeCustomer(value);
    return [...new Set([...customer.buildingIds, ...Object.keys(customer.buildingIdLinks)])];
  }

  const stableObjectText = value => {
    if (Array.isArray(value)) return `[${value.map(stableObjectText).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableObjectText(value[key])}`).join(",")}}`;
    return JSON.stringify(value ?? null);
  };

  function legacyPartnerVendorId(quote) {
    const quoteId = firebaseSafeKey(quote && quote.id);
    return `pvd_legacy_${quoteId || "unknown"}`;
  }

  function prohibitedSecretType(value) {
    const text = String(value || "").normalize("NFKC");
    if (RESIDENT_REGISTRATION_NUMBER.test(text)) return "resident-registration-number";
    if (SECRET_VALUE.test(text)) return "credential";
    return "";
  }

  function findProhibitedSecrets(value) {
    const findings = [];
    const visited = typeof WeakSet === "function" ? new WeakSet() : null;
    const visit = (node, path) => {
      if (typeof node === "string") {
        const field = String(path || "").split(/[.\[]/).pop().replace(/\]$/, "").replace(/[^0-9a-zㄱ-힣]/gi, "");
        const normalizedValue = node.trim();
        const fieldCredential = SECRET_FIELD.test(field) && normalizedValue.length >= 4 && !/^\*+$/.test(normalizedValue);
        const type = prohibitedSecretType(node) || (fieldCredential ? "credential" : "");
        if (type) findings.push({ path: path || "$", type });
        return;
      }
      if (!node || typeof node !== "object") return;
      if (visited) {
        if (visited.has(node)) return;
        visited.add(node);
      }
      if (!Array.isArray(node)) {
        const descriptor = [node.label, node.name, node.title, node.type, node.category].filter(item => typeof item === "string").join(" ");
        if (SECRET_CONTEXT.test(descriptor)) {
          Object.entries(node).forEach(([key, item]) => {
            if (!['string', 'number'].includes(typeof item) || !SECRET_DETAIL_FIELD.test(key)) return;
            const detail = String(item).trim();
            if (SECRET_CODE_ONLY.test(detail) && !/^\*+$/.test(detail)) findings.push({ path: path ? `${path}.${key}` : key, type: "credential" });
          });
        }
        Object.entries(node).forEach(([key, item]) => {
          const field = String(key).replace(/[^0-9a-zㄱ-힣]/gi, "");
          if (typeof item !== "number" || !SECRET_FIELD.test(field)) return;
          const detail = String(item);
          if (SECRET_CODE_ONLY.test(detail)) findings.push({ path: path ? `${path}.${key}` : key, type: "credential" });
        });
      }
      if (Array.isArray(node)) {
        node.forEach((item, index) => visit(item, `${path || "$"}[${index}]`));
        return;
      }
      Object.entries(node).forEach(([key, item]) => visit(item, path ? `${path}.${key}` : key));
    };
    visit(value, "");
    return findings;
  }

  function assertNoProhibitedSecrets(value) {
    const finding = findProhibitedSecrets(value)[0];
    if (!finding) return value;
    const error = new Error("실제 주민등록번호나 비밀번호·출입 코드는 CRM에 저장할 수 없습니다.");
    error.code = "PROHIBITED_SENSITIVE_VALUE";
    error.path = finding.path;
    error.secretType = finding.type;
    throw error;
  }

  function canMutate(user) {
    return Boolean(user && String(user.uid || "") && ["admin", "member"].includes(String(user.role || "")) && user.mustChangePassword !== true);
  }

  function assertMutationAllowed(user) {
    if (!user) {
      const error = new Error("로그인이 필요합니다.");
      error.code = "AUTH_REQUIRED";
      throw error;
    }
    if (!canMutate(user)) {
      const error = new Error(user.mustChangePassword === true ? "새 비밀번호를 먼저 설정해 주세요." : "조회 전용 계정은 CRM 자료를 변경할 수 없습니다.");
      error.code = user.mustChangePassword === true ? "PASSWORD_CHANGE_REQUIRED" : "READ_ONLY_ACCOUNT";
      throw error;
    }
    return user;
  }

  function normalizeServiceRecords(input) {
    const seenDriveFiles = new Set();
    return (Array.isArray(input) ? input : []).filter(Boolean).map(item => Object.assign({}, item, {
      id: String(item.id || ""), buildingId: String(item.buildingId || ""), driveFileId: String(item.driveFileId || ""),
      serviceType: String(item.serviceType || ""), status: String(item.status || ""), completedAt: String(item.completedAt || ""),
      amount: money(item.amount), vendorName: String(item.vendorName || ""), vendorPhone: normalizePhone(item.vendorPhone),
      summary: String(item.summary || ""), evidenceUrl: String(item.evidenceUrl || "")
    })).filter(item => {
      if (!item.driveFileId) return true;
      if (seenDriveFiles.has(item.driveFileId)) return false;
      seenDriveFiles.add(item.driveFileId);
      return true;
    });
  }

  function normalizeServiceContracts(input) {
    return (Array.isArray(input) ? input : []).filter(Boolean).map(item => Object.assign({}, item, {
      id: String(item.id || ""), buildingId: String(item.buildingId || ""), serviceType: String(item.serviceType || ""),
      cadence: String(item.cadence || ""), monthlyAmount: money(item.monthlyAmount), status: String(item.status || "planned"),
      startDate: String(item.startDate || "")
    }));
  }

  function serviceSchedulesForContract(contract) {
    if (!contract || contract.status !== "active" || !/^\d{4}-\d{2}-\d{2}$/.test(String(contract.startDate || ""))) return [];
    return [];
  }

  function blankSharedStore() {
    return {
      schemaVersion: 3,
      company: { name: "BRING Care", workspace: "원주 건물 운영" },
      settings: {
        owner: "김현진",
        workflowUrl: "https://bringengineering.github.io/FM/",
        firebaseDatabaseUrl: "https://bring-fm-default-rtdb.asia-southeast1.firebasedatabase.app",
        autoSync: true,
        onboardingComplete: false
      },
      customers: [], buildings: [], activities: [], contracts: [], partnerVendors: [], partnerQuotes: [], tasks: [], serviceRecords: [], serviceContracts: [], serviceSchedules: [], securityAssets: [], auditLogs: [], securityIncidents: [],
      salesProspects: [], salesContacts: [], salesUnits: [], salesActivities: [], salesEvents: [], salesOpportunities: [],
      accessRoles: [
        createAccessRole({ name: "데이터·운영책임자", canView: true, canEdit: true, canDownload: true, canManageSecurity: true }),
        createAccessRole({ name: "업무 담당자", canView: true, canEdit: true, canDownload: false, canManageSecurity: false }),
        createAccessRole({ name: "협력업체", canView: true, canEdit: false, canDownload: false, canManageSecurity: false, scope: "배정된 건물·티켓만" })
      ],
      updatedAt: iso()
    };
  }

  function blankStore() {
    return Object.assign(blankSharedStore(), { buildingUnits: [], fieldSummaries: [], marketingLeads: [] });
  }

  function sanitizeSharedStore(input) {
    const base = blankSharedStore();
    const src = input && typeof input === "object" ? input : {};
    const partnerQuotes = Array.isArray(src.partnerQuotes) ? src.partnerQuotes.filter(Boolean).map(quote => normalizePartnerQuote(quote)) : [];
    const partnerVendors = Array.isArray(src.partnerVendors) ? src.partnerVendors.filter(Boolean).map(vendor => normalizePartnerVendor(vendor)) : [];
    const vendorsById = new Map(partnerVendors.filter(vendor => vendor.id).map(vendor => [vendor.id, vendor]));
    partnerQuotes.forEach(quote => {
      if (!quote.vendorId) quote.vendorId = legacyPartnerVendorId(quote);
      if (!vendorsById.has(quote.vendorId)) {
        const vendor = partnerVendorFromQuote(quote, quote.vendorId);
        partnerVendors.push(vendor);
        vendorsById.set(vendor.id, vendor);
      }
    });
    return {
      schemaVersion: 3,
      company: Object.assign({}, base.company, src.company || {}),
      settings: Object.assign({}, base.settings, src.settings || {}),
      customers: Array.isArray(src.customers) ? src.customers.filter(Boolean).map(customer => normalizeCustomer(customer)) : [],
      buildings: Array.isArray(src.buildings) ? src.buildings.filter(Boolean).map(building => normalizeBuilding(building)) : [],
      activities: Array.isArray(src.activities) ? src.activities.filter(Boolean) : [],
      contracts: Array.isArray(src.contracts) ? src.contracts.filter(Boolean).map(contract => normalizeContract(contract)) : [],
      partnerVendors,
      partnerQuotes,
      tasks: Array.isArray(src.tasks) ? src.tasks.filter(Boolean) : [],
      serviceRecords: normalizeServiceRecords(src.serviceRecords),
      serviceContracts: normalizeServiceContracts(src.serviceContracts),
      serviceSchedules: Array.isArray(src.serviceSchedules) ? src.serviceSchedules.filter(Boolean) : [],
      securityAssets: Array.isArray(src.securityAssets) ? src.securityAssets.filter(Boolean) : [],
      accessRoles: Array.isArray(src.accessRoles) && src.accessRoles.length ? src.accessRoles.filter(Boolean) : base.accessRoles,
      auditLogs: Array.isArray(src.auditLogs) ? src.auditLogs.filter(Boolean) : [],
      securityIncidents: Array.isArray(src.securityIncidents) ? src.securityIncidents.filter(Boolean) : [],
      salesProspects: Array.isArray(src.salesProspects) ? src.salesProspects.filter(Boolean) : [],
      salesContacts: Array.isArray(src.salesContacts) ? src.salesContacts.filter(Boolean) : [],
      salesUnits: Array.isArray(src.salesUnits) ? src.salesUnits.filter(Boolean) : [],
      salesActivities: Array.isArray(src.salesActivities) ? src.salesActivities.filter(Boolean) : [],
      salesEvents: Array.isArray(src.salesEvents) ? src.salesEvents.filter(Boolean) : [],
      salesOpportunities: Array.isArray(src.salesOpportunities) ? src.salesOpportunities.filter(Boolean) : [],
      updatedAt: src.updatedAt || iso()
    };
  }

  const FORBIDDEN_OVERLAY_KEYS = new Set(["__proto__", "prototype", "constructor"]);
  const OVERLAY_ID = /^[A-Za-z0-9_-]{1,120}$/;

  function cloneOverlayValue(value, depth) {
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
    if (depth >= 10) return null;
    if (Array.isArray(value)) return value.slice(0, 500).map(item => cloneOverlayValue(item, depth + 1));
    if (!value || typeof value !== "object") return null;
    const result = {};
    Object.entries(value).forEach(([key, item]) => {
      if (!FORBIDDEN_OVERLAY_KEYS.has(key)) result[key] = cloneOverlayValue(item, depth + 1);
    });
    return result;
  }

  function sanitizeOverlayCollection(value, identityField) {
    const entries = Array.isArray(value)
      ? value.map(item => ["", item])
      : value && typeof value === "object" ? Object.entries(value) : [];
    return entries.slice(0, 10000).flatMap(([fallbackId, item]) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const copy = cloneOverlayValue(item, 0);
      const id = String(copy[identityField] || (identityField === "id" ? copy.id : "") || fallbackId || "").trim();
      if (!OVERLAY_ID.test(id) || FORBIDDEN_OVERLAY_KEYS.has(id)) return [];
      copy[identityField] = id;
      return [copy];
    });
  }

  function normalizeBuildingUnit(value) {
    const unit = Object.assign({}, value || {});
    unit.id = String(unit.id || "").trim();
    unit.crmBuildingId = String(unit.crmBuildingId || unit.buildingId || "").trim();
    unit.label = String(unit.label || unit.unitLabel || "").trim();
    unit.floorLabel = String(unit.floorLabel || "").trim();
    unit.floorOrder = boundedInteger(unit.floorOrder, -1_000, 1_000);
    unit.unitOrder = boundedInteger(unit.unitOrder, 0, 100_000);
    const legacyStatus = LEGACY_BUILDING_UNIT_STATUS_MAP[String(unit.status || "")];
    unit.status = legacyStatus || (BUILDING_UNIT_STATUSES.includes(unit.status) ? unit.status : "unknown");
    unit.moveOutAt = optionalDate(unit.moveOutAt);
    unit.availableFrom = optionalDate(unit.availableFrom);
    unit.memo = String(unit.memo || "").trim();
    return unit;
  }

  function normalizeMarketingLead(value) {
    const lead = Object.assign({}, value || {});
    ["requestId", "name", "phone", "location", "needs", "buildingInfo", "service", "sourcePath", "utmSource", "utmCampaign", "utmTerm"]
      .forEach(field => { lead[field] = String(lead[field] || "").trim(); });
    lead.customerType = ["individual", "building_owner", "manager"].includes(lead.customerType) ? lead.customerType : "individual";
    lead.consent = lead.consent === true;
    lead.submittedAt = Number.isFinite(Number(lead.submittedAt)) && Number(lead.submittedAt) >= 0 ? Number(lead.submittedAt) : 0;
    lead.status = ["new", "processing", "converted", "closed"].includes(lead.status) ? lead.status : "new";
    return lead;
  }

  function sanitizeRendererOverlays(input) {
    const source = input && typeof input === "object" ? input : {};
    return {
      buildingUnits: sanitizeOverlayCollection(source.buildingUnits, "id").map(normalizeBuildingUnit),
      fieldSummaries: sanitizeOverlayCollection(source.fieldSummaries, "fieldJobId"),
      marketingLeads: sanitizeOverlayCollection(source.marketingLeads, "requestId").map(normalizeMarketingLead)
    };
  }

  function sanitizeRendererStore(input) {
    return Object.assign(sanitizeSharedStore(input), sanitizeRendererOverlays(input));
  }

  function sanitizeStore(input) {
    return sanitizeRendererStore(input);
  }

  function normalizePartnerQuote(value) {
    const quote = Object.assign({}, value || {});
    const originalId = String(quote.id || "").trim();
    const fallbackId = originalId || `legacy_${stableKeyHash(stableObjectText(quote))}`;
    quote.id = firebaseSafeKey(fallbackId);
    if (originalId && quote.id !== originalId) quote.legacyId = String(quote.legacyId || originalId);
    quote.status = LEGACY_PARTNER_QUOTE_STATUS_MAP[quote.status] || (PARTNER_QUOTE_STATUSES.includes(quote.status) ? quote.status : "연락 예정");
    quote.consultationContent = String(quote.consultationContent || quote.memo || "");
    quote.consultedAt = quote.consultedAt || quote.receivedAt || quote.contactedAt || "";
    quote.vendorId = firebaseSafeKey(quote.vendorId);
    delete quote.customerId;
    delete quote.buildingId;
    return quote;
  }

  function normalizePartnerVendor(value) {
    const vendor = Object.assign({}, value || {});
    const originalId = String(vendor.id || "").trim();
    vendor.id = firebaseSafeKey(originalId);
    if (originalId && vendor.id !== originalId) vendor.legacyId = String(vendor.legacyId || originalId);
    vendor.name = String(vendor.name || vendor.vendor || "").trim();
    vendor.industry = String(vendor.industry || (String(vendor.category || "").includes("누수") ? "누수" : "기타"));
    vendor.service = String(vendor.service || vendor.category || "").trim();
    vendor.phone = String(vendor.phone || "").trim();
    vendor.phoneLabel = String(vendor.phoneLabel || "").trim();
    vendor.alternatePhone = String(vendor.alternatePhone || "").trim();
    vendor.alternatePhoneLabel = String(vendor.alternatePhoneLabel || "").trim();
    vendor.sourceUrl = String(vendor.sourceUrl || vendor.quoteUrl || "").trim();
    vendor.quoteUrl = String(vendor.quoteUrl || vendor.sourceUrl || "").trim();
    vendor.region = String(vendor.region || "원주").trim() || "원주";
    vendor.active = vendor.active !== false;
    delete vendor.customerId;
    delete vendor.buildingId;
    return vendor;
  }

  function partnerVendorFromQuote(value, vendorId) {
    const quote = normalizePartnerQuote(value);
    const createdAt = quote.createdAt || quote.consultedAt || quote.receivedAt || quote.contactedAt || "";
    return normalizePartnerVendor({
      id: vendorId || quote.vendorId || legacyPartnerVendorId(quote),
      name: quote.vendor || "업체명 미입력",
      industry: quote.industry || (String(quote.category || "").includes("누수") ? "누수" : "기타"),
      service: quote.service || quote.category || "",
      phone: quote.phone || "",
      phoneLabel: quote.phoneLabel || "",
      alternatePhone: quote.alternatePhone || "",
      alternatePhoneLabel: quote.alternatePhoneLabel || "",
      sourceUrl: quote.quoteUrl || "",
      quoteUrl: quote.quoteUrl || "",
      region: quote.region || "원주",
      active: true,
      createdAt,
      updatedAt: quote.updatedAt || createdAt
    });
  }

  function createCustomer(values) {
    const now = iso();
    const customer = Object.assign({
      id: random("cus"), customerNo: `C-${dayKey(now).replace(/-/g, "")}-${String(Date.now()).slice(-4)}`,
      name: "", company: "", phone: "", email: "", type: "건물주", address: "", source: "대표 상담",
      interestServices: [], currentIssue: "", stage: "신규 고객", lastContactAt: "", nextContactAt: "",
      nextAction: "첫 연락", owner: "김현진", expectedValue: 0, lostReason: "", priority: "보통",
      relationshipCycleDays: 30, relationshipStartedAt: "", relationshipLastContactAt: "", relationshipNextContactAt: "",
      relationshipNextAction: "", relationshipNote: "",
      tags: [], notes: "", buildingIds: [], buildingIdLinks: {}, workflowCaseIds: [], createdAt: now, updatedAt: now
    }, values || {});
    customer.stage = normalizePipelineStage(customer.stage);
    return customer;
  }

  function createBuilding(values) {
    const now = iso();
    return normalizeBuilding(Object.assign({
      id: random("bld"), buildingNo: `B-${dayKey(now).replace(/-/g, "")}-${String(Date.now()).slice(-4)}`,
      name: "", address: "", type: "다가구", status: "영업후보", ownerCustomerId: "", unitCount: 0,
      rentDeposit: 0, monthlyRent: 0, maintenanceFee: 0, maintenanceIncludes: [], maintenanceIncludeOther: "",
      vacantUnitCount: 0, vacantUnits: [], roomTypes: [], roomTypeOther: "", roomOptions: [], roomOptionOther: "",
      manager: "김현진", memo: "", aliases: [], externalRefs: { paymentBuildingIds: [] }, createdAt: now, updatedAt: now
    }, values || {}));
  }

  function normalizeBuilding(value) {
    const building = Object.assign({}, value || {});
    building.rentDeposit = nonNegativeInteger(building.rentDeposit);
    building.monthlyRent = nonNegativeInteger(building.monthlyRent);
    building.maintenanceFee = nonNegativeInteger(building.maintenanceFee);
    building.maintenanceIncludes = normalizeStringList(building.maintenanceIncludes);
    building.maintenanceIncludeOther = String(building.maintenanceIncludeOther || "").trim();
    building.vacantUnitCount = nonNegativeInteger(building.vacantUnitCount);
    building.vacantUnits = normalizeStringList(building.vacantUnits);
    building.roomTypes = normalizeStringList(building.roomTypes);
    building.roomTypeOther = String(building.roomTypeOther || "").trim();
    building.roomOptions = normalizeStringList(building.roomOptions);
    building.roomOptionOther = String(building.roomOptionOther || "").trim();
    building.aliases = [...new Set((Array.isArray(building.aliases) ? building.aliases : []).map(item => String(item || "").trim()).filter(Boolean))];
    const refs = building.externalRefs && typeof building.externalRefs === "object" ? building.externalRefs : {};
    building.externalRefs = Object.assign({}, refs, {
      paymentBuildingIds: [...new Set((Array.isArray(refs.paymentBuildingIds) ? refs.paymentBuildingIds : []).map(item => String(item || "").trim()).filter(Boolean))]
    });
    return building;
  }

  function createActivity(values) {
    const now = iso();
    return Object.assign({
      id: random("act"), customerId: "", type: "전화", occurredAt: now, summary: "", result: "",
      nextAction: "", nextContactAt: "", owner: "김현진", workflowCaseId: "", createdAt: now
    }, values || {});
  }

  function createTask(values) {
    const now = iso();
    return Object.assign({
      id: random("tsk"), customerId: "", title: "", dueAt: dayKey(now), priority: "보통", status: "할 일",
      owner: "김현진", category: "후속 연락", note: "", createdAt: now, updatedAt: now
    }, values || {});
  }

  function normalizeContractTypes(value) {
    const source = value && typeof value === "object" && !Array.isArray(value)
      ? (Array.isArray(value.types) && value.types.length ? value.types : [value.type])
      : (Array.isArray(value) ? value : [value]);
    const types = [...new Set(source.map(type => String(type || "").trim()).filter(type => CONTRACT_TYPES.includes(type)))];
    return types.length ? types : [CONTRACT_TYPES[0]];
  }

  function normalizeContract(value) {
    const contract = Object.assign({}, value || {});
    contract.types = normalizeContractTypes(contract);
    contract.type = contract.types[0];
    return contract;
  }

  function createContract(values) {
    const now = iso();
    return normalizeContract(Object.assign({
      id: random("ctr"), contractNo: `CT-${dayKey(now).replace(/-/g, "")}-${String(Date.now()).slice(-4)}`,
      type: "청소", name: "", customerId: "", buildingId: "", startDate: dayKey(now), endDate: "",
      amount: 0, billingCycle: "월 정기", status: "계약 준비", owner: "김현진", scope: "",
      serviceFrequency: "", unitCount: 0, managementTarget: "", feeMethod: "", memo: "",
      createdAt: now, updatedAt: now
    }, values || {}));
  }

  function createPartnerQuote(values) {
    const now = iso();
    return Object.assign({
      id: random("pqt"), vendorId: "", industry: "누수", scenario: "", service: "", vendor: "", phone: "", phoneLabel: "", alternatePhone: "", alternatePhoneLabel: "", quoteUrl: "", region: "원주",
      status: "연락 예정", inspectionMin: 0, inspectionMax: 0, constructionMin: 0, constructionMax: 0,
      travelMin: 0, travelMax: 0, totalMin: 0, totalMax: 0, constructionPricing: "", travelPolicy: "미확인",
      noFindPolicy: "미확인", includedWork: "", priceNegotiable: false, responseSpeed: "", warranty: "", checklist: {},
      contactedAt: "", receivedAt: "", consultedAt: "", consultationContent: "", owner: "김현진", memo: "", createdAt: now, updatedAt: now
    }, values || {});
  }

  function createPartnerVendor(values) {
    const now = iso();
    return normalizePartnerVendor(Object.assign({
      id: random("pvd"), name: "", industry: "누수", service: "", phone: "", phoneLabel: "",
      alternatePhone: "", alternatePhoneLabel: "", sourceUrl: "", quoteUrl: "", region: "원주",
      active: true, createdAt: now, updatedAt: now
    }, values || {}));
  }

  function createSecurityAsset(values) {
    const now = iso();
    return Object.assign({
      id: random("sec"), assetNo: `S-${dayKey(now).replace(/-/g, "")}-${String(Date.now()).slice(-4)}`,
      type: "열쇠", label: "", buildingId: "", room: "", holder: "", status: "보관중",
      issuedAt: "", dueAt: "", returnedAt: "", retentionUntil: "", storageLocation: "",
      accessRole: "데이터·운영책임자", sensitivity: "제한", memo: "", createdAt: now, updatedAt: now
    }, values || {});
  }

  function createAccessRole(values) {
    const now = iso();
    return Object.assign({
      id: random("role"), name: "새 역할", scope: "배정된 업무만", canView: true, canEdit: false,
      canDownload: false, canManageSecurity: false, status: "사용중", createdAt: now, updatedAt: now
    }, values || {});
  }

  function createAuditLog(values) {
    const now = iso();
    return Object.assign({
      id: random("log"), category: "조회", targetType: "고객", targetId: "", targetLabel: "",
      action: "", actor: "", actorUid: "", actorEmail: "", reason: "업무 수행", occurredAt: now, createdAt: now
    }, values || {});
  }

  function createSecurityIncident(values) {
    const now = iso();
    return Object.assign({
      id: random("inc"), type: "키 분실", severity: "주의", summary: "", status: "보고됨",
      occurredAt: now, reportedBy: "", escalatedTo: "데이터·운영책임자", resolution: "", createdAt: now, updatedAt: now
    }, values || {});
  }

  function calculateSecurityStatus(store, nowValue) {
    const data = sanitizeStore(store);
    const today = dayKey(nowValue);
    const activeAssets = data.securityAssets.filter(item => item.status !== "폐기" && item.status !== "무효");
    const checkedOut = activeAssets.filter(item => item.status === "대여중");
    const overdueAssets = checkedOut.filter(item => item.dueAt && dayKey(item.dueAt) < today);
    const expiringRecords = activeAssets.filter(item => item.retentionUntil && dayKey(item.retentionUntil) <= today);
    const openIncidents = data.securityIncidents.filter(item => item.status !== "종결" && item.status !== "무효");
    return {
      totalAssets: activeAssets.length,
      checkedOut: checkedOut.length,
      overdueAssets: overdueAssets.length,
      expiringRecords: expiringRecords.length,
      openIncidents: openIncidents.length,
      alertTotal: overdueAssets.length + expiringRecords.length + openIncidents.length
    };
  }

  function workflowProgress(workflowCase) {
    const status = workflowCase && workflowCase.status || {};
    const done = WORKFLOW_STEPS.reduce((count, _, index) => count + (status[`c${index + 1}`] === "done" ? 1 : 0), 0);
    const doingIndex = WORKFLOW_STEPS.findIndex((_, index) => status[`c${index + 1}`] === "doing");
    const currentIndex = doingIndex >= 0 ? doingIndex : Math.min(done, WORKFLOW_STEPS.length - 1);
    return { done, total: WORKFLOW_STEPS.length, percent: Math.round(done / WORKFLOW_STEPS.length * 100), currentIndex, current: WORKFLOW_STEPS[currentIndex] };
  }

  function calculateDashboard(store, nowValue, workflowCases) {
    const data = sanitizeStore(store);
    const today = dayKey(nowValue);
    const activeStages = new Set(PIPELINE_STAGES);
    const isOpenTask = task => task.status !== "완료" && task.status !== "취소";
    const dueKey = value => value ? dayKey(value) : "";
    return {
      totalCustomers: data.customers.length,
      todayContacts: data.customers.filter(customer => dueKey(customer.nextContactAt) === today).length,
      overdueContacts: data.customers.filter(customer => customer.nextContactAt && dueKey(customer.nextContactAt) < today && customer.stage !== "보류·거절").length,
      openTasks: data.tasks.filter(isOpenTask).length,
      overdueTasks: data.tasks.filter(task => isOpenTask(task) && dueKey(task.dueAt) < today).length,
      pendingPartnerQuotes: data.partnerQuotes.filter(quote => quote.status === "연락 예정" || quote.status === "상담 중").length,
      receivedPartnerQuotes: data.partnerQuotes.filter(quote => money(quote.totalMax) > 0 || money(quote.constructionMax) > 0 || money(quote.quotedAmount) > 0).length,
      pipelineValue: data.customers.filter(customer => activeStages.has(customer.stage)).reduce((sum, customer) => sum + money(customer.expectedValue), 0),
      activeWorkflows: (workflowCases || []).filter(item => workflowProgress(item).done < WORKFLOW_STEPS.length && !item.deleted && !item.archived).length
    };
  }

  function buildWorkflowCase(customer, building, nowValue) {
    const now = iso(nowValue);
    const id = `kcrm${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const interest = Array.isArray(customer.interestServices) ? customer.interestServices.join(", ") : String(customer.interestServices || "");
    const summary = [customer.currentIssue, interest].filter(Boolean).join(" / ") || "CRM 후속 업무";
    return {
      id,
      ticketNo: `CRM-${dayKey(now).replace(/-/g, "")}-${String(Date.now()).slice(-4)}`,
      crmCustomerId: customer.id,
      crmCustomerNo: customer.customerNo || "",
      crmBuildingId: building && building.id || "",
      name: customer.name || "새 고객",
      phone: customer.phone || "",
      email: customer.email || "",
      building: building && building.name || "",
      address: building && building.address || customer.address || "",
      grade: "스탠다드",
      summary,
      issueType: interest || "고객 상담",
      urgency: customer.priority === "높음" ? "긴급" : "보통",
      source: "bring_crm",
      crmStage: customer.stage || "신규",
      expectedValue: money(customer.expectedValue),
      nextAction: customer.nextAction || "",
      status: { c1: "doing" },
      note: { c1: `CRM에서 고객 등록 후 업무흐름을 시작했습니다.\n현재 문제: ${customer.currentIssue || "미입력"}\n다음 행동: ${customer.nextAction || "미입력"}` },
      log: ["BRING CRM에서 업무흐름 생성"],
      receivedAt: now,
      createdAt: now,
      updatedAt: now
    };
  }

  function matchWorkflowCustomer(workflowCase, customers) {
    if (!workflowCase) return null;
    if (workflowCase.crmCustomerId) return (customers || []).find(item => item.id === workflowCase.crmCustomerId) || null;
    const phone = normalizePhone(workflowCase.phone);
    if (phone) {
      const byPhone = (customers || []).filter(item => normalizePhone(item.phone) === phone);
      if (byPhone.length === 1) return byPhone[0];
      if (byPhone.length > 1) return null;
    }
    const name = normalizeText(workflowCase.name);
    if (!name) return null;
    const byName = (customers || []).filter(item => normalizeText(item.name) === name);
    return byName.length === 1 ? byName[0] : null;
  }

  function paymentNormalizeName(value) {
    return String(value || "").toLowerCase().replace(/\s+/g, "").replace(/[^0-9a-z가-힣]/g, "");
  }

  function paymentMonthRows(data, monthKey, todayKey, buildingId) {
    const source = data && typeof data === "object" ? data : {};
    const month = String(monthKey || dayKey()).slice(0, 7);
    const today = String(todayKey || dayKey()).slice(0, 10);
    const daysInMonth = (() => {
      const match = month.match(/^(\d{4})-(\d{2})$/);
      return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate() : 30;
    })();
    const dateShift = (value, amount) => {
      const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) return "";
      const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Number(amount || 0)));
      return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
    };
    const schedules = Object.entries(source.schedules || {}).map(([id, value]) => Object.assign({ id }, value || {})).filter(schedule => {
      if (buildingId && buildingId !== "all" && schedule.buildingId !== buildingId) return false;
      if (schedule.active === false) return false;
      if (schedule.startMonth && month < schedule.startMonth) return false;
      if (schedule.endMonth && month > schedule.endMonth) return false;
      return true;
    });
    const transactions = Object.entries(source.transactions || {}).map(([id, value]) => Object.assign({ id }, value || {})).filter(item => item.active !== false);
    const rows = schedules.map(schedule => {
      const dueDay = Math.min(Math.max(1, Number(schedule.dueDay) || 1), daysInMonth);
      const dueDate = `${month}-${pad(dueDay)}`;
      const payer = paymentNormalizeName(schedule.payerName);
      const amount = money(schedule.amount);
      const candidates = transactions.filter(transaction => {
        if (transaction.direction && transaction.direction !== "deposit") return false;
        if (transaction.matchStatus === "review") {
          if (!Array.isArray(transaction.reviewScheduleIds) || !transaction.reviewScheduleIds.includes(schedule.id)) return false;
        } else if (String(transaction.buildingId || "") !== String(schedule.buildingId || "")) return false;
        return money(transaction.amount) === amount && paymentNormalizeName(transaction.payerName) === payer && String(transaction.date || "") >= dateShift(dueDate, -3) && String(transaction.date || "") <= dateShift(dueDate, 7);
      });
      return { schedule, dueDate, candidates, status: "scheduled", matchedTransaction: null, override: null };
    });
    const usage = {};
    rows.forEach(row => row.candidates.forEach(transaction => { usage[transaction.id] = (usage[transaction.id] || 0) + 1; }));
    const overrides = source.overrides && source.overrides[month] || {};
    rows.forEach(row => {
      const override = overrides[row.schedule.id] || null;
      row.override = override;
      if (override && override.status && override.status !== "auto") {
        row.status = override.status;
        row.matchedTransaction = override.transactionId ? transactions.find(item => item.id === override.transactionId) || null : null;
      } else if (row.candidates.some(item => item.matchStatus === "review")) row.status = "review";
      else if (row.candidates.length === 1 && usage[row.candidates[0].id] === 1) {
        row.status = "paid";
        row.matchedTransaction = row.candidates[0];
      } else if (row.candidates.length) row.status = "review";
      else row.status = today > row.dueDate ? "overdue" : "scheduled";
    });
    return rows.sort((left, right) => left.dueDate.localeCompare(right.dueDate) || String(left.schedule.unit || "").localeCompare(String(right.schedule.unit || ""), "ko"));
  }

  return {
    PIPELINE_STAGES, PARTNER_QUOTE_STATUSES, PARTNER_INDUSTRIES, BUILDING_MAINTENANCE_INCLUDES, BUILDING_ROOM_TYPES, BUILDING_ROOM_OPTIONS, BUILDING_UNIT_STATUSES, CONTRACT_TYPES, CONTRACT_STATUSES, WORKFLOW_STEPS, SECURITY_ASSET_TYPES, SECURITY_ASSET_STATUSES, AUDIT_CATEGORIES,
    blankStore, blankSharedStore, sanitizeStore, sanitizeSharedStore, sanitizeRendererStore, sanitizeRendererOverlays, createCustomer, createBuilding, normalizeBuilding, normalizeBuildingUnit, createActivity, createContract, normalizeContractTypes, createPartnerVendor, createPartnerQuote, createTask, createSecurityAsset,
    createAccessRole, createAuditLog, createSecurityIncident, calculateDashboard, calculateSecurityStatus,
    workflowProgress, buildWorkflowCase, matchWorkflowCustomer, paymentNormalizeName, paymentMonthRows,
    normalizePhone, normalizeText, normalizePipelineStage, normalizeStringList, normalizeCustomer, customerBuildingIds, nonNegativeInteger, money, dayKey, iso,
    prohibitedSecretType, findProhibitedSecrets, assertNoProhibitedSecrets, canMutate, assertMutationAllowed,
    normalizePartnerVendor, partnerVendorFromQuote, legacyPartnerVendorId,
    normalizeServiceRecords, normalizeServiceContracts, serviceSchedulesForContract
  };
});
