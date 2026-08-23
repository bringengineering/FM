import { createHash } from "node:crypto";

type UnknownRecord = Record<string, unknown>;

const SERVICES = new Map([
  ["계단·공용부 청소", { path: "/stair-cleaning", opportunity: "common_cleaning" }],
  ["건물관리", { path: "/building-care", opportunity: "other" }],
  ["입주·이사청소", { path: "/move-in-cleaning", opportunity: "move_in_cleaning" }],
]);
const CUSTOMER_TYPES = new Set(["individual", "building_owner", "manager"]);

export interface MarketingLeadInput {
  requestId: string;
  name: string;
  phone: string;
  location: string;
  needs: string;
  buildingInfo: string;
  customerType: "individual" | "building_owner" | "manager";
  service: string;
  sourcePath: string;
  pageUrl: string;
  utmSource: string;
  utmCampaign: string;
  utmTerm: string;
  consent: true;
  website: string;
}

export interface MarketingLeadIds {
  customerId: string;
  activityId: string;
  prospectId: string;
  contactId: string;
  opportunityId: string;
  eventId: string;
}

export interface MarketingLeadResult {
  receiptId: string;
  customerId: string;
  repeated: boolean;
}

export interface MarketingLeadTransactionCommand {
  input: MarketingLeadInput;
  phoneHash: string;
  now: string;
  ids: MarketingLeadIds;
}

export interface MarketingLeadRootDecision {
  data: UnknownRecord;
  result: MarketingLeadResult;
}

export interface MarketingLeadDependencies {
  now(): string;
  newId(prefix: string): string;
  transact(command: MarketingLeadTransactionCommand): Promise<MarketingLeadResult>;
}

export class MarketingLeadError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MarketingLeadError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new MarketingLeadError(code, message);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(
  value: unknown,
  maximumBytes: number,
  code: string,
  message: string,
): string {
  if (typeof value !== "string") fail(code, message);
  const normalized = value.trim().normalize("NFKC");
  if (
    !normalized
    || Buffer.byteLength(normalized, "utf8") > maximumBytes
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)
  ) fail(code, message);
  return normalized;
}

function optionalText(value: unknown, maximumBytes: number): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") fail("marketing_lead_input_invalid", "입력 내용을 확인해 주세요.");
  const normalized = value.trim().normalize("NFKC");
  if (
    Buffer.byteLength(normalized, "utf8") > maximumBytes
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)
  ) fail("marketing_lead_input_invalid", "입력 내용을 확인해 주세요.");
  return normalized;
}

function normalizePhone(value: unknown): string {
  const source = requiredText(
    value,
    40,
    "marketing_lead_phone_invalid",
    "010으로 시작하는 휴대폰 번호를 입력해 주세요.",
  );
  let digits = source.replace(/[^0-9]/g, "");
  if (digits.startsWith("82")) digits = `0${digits.slice(2)}`;
  if (!/^010\d{8}$/.test(digits)) {
    fail("marketing_lead_phone_invalid", "010으로 시작하는 휴대폰 번호를 입력해 주세요.");
  }
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

function safeCollection(value: unknown): UnknownRecord {
  return isRecord(value) ? { ...value } : {};
}

function assertSafeId(value: string, field: string): void {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(value)) {
    fail("marketing_lead_transaction_invalid", `${field} 값이 올바르지 않습니다.`);
  }
}

function validTimestamp(value: string): boolean {
  return Boolean(value) && !Number.isNaN(new Date(value).getTime());
}

export function normalizeMarketingLeadInput(value: unknown): MarketingLeadInput {
  if (!isRecord(value)) fail("marketing_lead_input_invalid", "신청 내용을 확인해 주세요.");
  const requestId = requiredText(
    value.requestId,
    120,
    "marketing_lead_request_invalid",
    "접수 요청을 다시 시작해 주세요.",
  );
  if (!/^[A-Za-z0-9_-]{16,120}$/.test(requestId)) {
    fail("marketing_lead_request_invalid", "접수 요청을 다시 시작해 주세요.");
  }
  const service = requiredText(
    value.service,
    80,
    "marketing_lead_service_invalid",
    "상담 서비스를 확인해 주세요.",
  );
  const servicePolicy = SERVICES.get(service);
  if (!servicePolicy) fail("marketing_lead_service_invalid", "상담 서비스를 확인해 주세요.");
  const sourcePath = requiredText(
    value.sourcePath,
    100,
    "marketing_lead_source_invalid",
    "유입 경로를 확인해 주세요.",
  );
  if (sourcePath !== servicePolicy.path) {
    fail("marketing_lead_source_invalid", "유입 경로를 확인해 주세요.");
  }
  const customerType = optionalText(value.customerType, 40) || "individual";
  if (!CUSTOMER_TYPES.has(customerType)) {
    fail("marketing_lead_customer_type_invalid", "문의 유형을 확인해 주세요.");
  }
  if (value.consent !== true) {
    fail("marketing_lead_consent_required", "CRM 저장 및 상담 연락에 동의해 주세요.");
  }
  const website = optionalText(value.website, 200);
  if (website) fail("marketing_lead_bot_detected", "신청을 처리할 수 없습니다.");

  return {
    requestId,
    name: requiredText(value.name, 120, "marketing_lead_name_required", "이름을 입력해 주세요."),
    phone: normalizePhone(value.phone),
    location: requiredText(value.location, 300, "marketing_lead_location_required", "건물 위치 또는 지역을 입력해 주세요."),
    needs: requiredText(value.needs, 2_000, "marketing_lead_needs_required", "필요한 상담 내용을 입력해 주세요."),
    buildingInfo: optionalText(value.buildingInfo, 1_500),
    customerType: customerType as MarketingLeadInput["customerType"],
    service,
    sourcePath,
    pageUrl: optionalText(value.pageUrl, 1_500),
    utmSource: optionalText(value.utmSource, 200),
    utmCampaign: optionalText(value.utmCampaign, 300),
    utmTerm: optionalText(value.utmTerm, 300),
    consent: true,
    website: "",
  };
}

function isBuildingSalesLead(input: MarketingLeadInput): boolean {
  return input.customerType !== "individual" || input.sourcePath !== "/move-in-cleaning";
}

function customerTypeLabel(value: MarketingLeadInput["customerType"]): string {
  if (value === "building_owner") return "건물주";
  if (value === "manager") return "관리 담당자";
  return "개인 고객";
}

function sourceEvidence(input: MarketingLeadInput): string {
  return ["BRING CARE 광고 랜딩", input.sourcePath, input.utmTerm].filter(Boolean).join(" · ");
}

function activitySummary(input: MarketingLeadInput): string {
  return [
    `[${input.service}] ${input.needs}`,
    input.buildingInfo ? `건물 정보: ${input.buildingInfo}` : "",
    input.utmSource || input.utmCampaign || input.utmTerm
      ? `광고: ${[input.utmSource, input.utmCampaign, input.utmTerm].filter(Boolean).join(" / ")}`
      : "",
  ].filter(Boolean).join("\n");
}

function customerNumber(now: string, customerId: string): string {
  const day = now.slice(0, 10).replace(/-/g, "");
  return `C-${day}-${customerId.slice(-6).toUpperCase()}`;
}

function opportunityType(input: MarketingLeadInput): string {
  return SERVICES.get(input.service)?.opportunity || "other";
}

export function reduceMarketingLeadDataRoot(
  currentData: unknown,
  command: MarketingLeadTransactionCommand,
): MarketingLeadRootDecision {
  if (!isRecord(command) || !validTimestamp(command.now) || !isRecord(command.ids)) {
    fail("marketing_lead_transaction_invalid", "CRM 저장 요청이 올바르지 않습니다.");
  }
  const input = normalizeMarketingLeadInput(command.input);
  assertSafeId(command.phoneHash, "phoneHash");
  Object.entries(command.ids).forEach(([key, id]) => assertSafeId(id, key));

  const data = isRecord(currentData) ? currentData : {};
  const receipts = safeCollection(data.marketingLeadReceipts);
  const storedReceipt = receipts[input.requestId];
  if (isRecord(storedReceipt) && typeof storedReceipt.customerId === "string") {
    return {
      data,
      result: { receiptId: input.requestId, customerId: storedReceipt.customerId, repeated: true },
    };
  }

  const phoneIndex = safeCollection(data.marketingLeadPhoneIndex);
  const storedIndex = isRecord(phoneIndex[command.phoneHash])
    ? phoneIndex[command.phoneHash] as UnknownRecord
    : null;
  const indexedCustomerId = storedIndex && typeof storedIndex.customerId === "string"
    ? storedIndex.customerId
    : "";
  const customers = safeCollection(data.customers);
  const existingCustomer = indexedCustomerId && isRecord(customers[indexedCustomerId])
    ? customers[indexedCustomerId] as UnknownRecord
    : null;
  const customerId = existingCustomer ? indexedCustomerId : command.ids.customerId;
  const interests = new Set(
    Array.isArray(existingCustomer?.interestServices)
      ? existingCustomer.interestServices.filter((item): item is string => typeof item === "string")
      : [],
  );
  interests.add(input.service);
  customers[customerId] = existingCustomer ? {
    ...existingCustomer,
    name: existingCustomer.name || input.name,
    phone: existingCustomer.phone || input.phone,
    address: existingCustomer.address || input.location,
    interestServices: [...interests],
    currentIssue: input.needs,
    nextAction: "신규 홈페이지 문의 확인",
    updatedAt: command.now,
  } : {
    id: customerId,
    customerNo: customerNumber(command.now, customerId),
    name: input.name,
    company: input.buildingInfo,
    phone: input.phone,
    email: "",
    type: customerTypeLabel(input.customerType),
    address: input.location,
    source: "홈페이지",
    interestServices: [...interests],
    currentIssue: input.needs,
    stage: "신규 고객",
    lastContactAt: "",
    nextContactAt: "",
    nextAction: "신규 홈페이지 문의 확인",
    owner: "미배정",
    expectedValue: 0,
    lostReason: "",
    priority: "높음",
    relationshipCycleDays: 30,
    relationshipStartedAt: "",
    relationshipLastContactAt: "",
    relationshipNextContactAt: "",
    relationshipNextAction: "",
    relationshipNote: "",
    tags: ["홈페이지 문의", input.service],
    notes: sourceEvidence(input),
    buildingIds: [],
    buildingIdLinks: {},
    workflowCaseIds: [],
    createdAt: command.now,
    updatedAt: command.now,
  };

  const activities = safeCollection(data.activities);
  activities[command.ids.activityId] = {
    id: command.ids.activityId,
    customerId,
    type: "메모",
    occurredAt: command.now,
    summary: activitySummary(input),
    result: "신규 상담 신청",
    nextAction: "전화 또는 카카오 상담",
    nextContactAt: "",
    owner: "미배정",
    createdAt: command.now,
    updatedAt: command.now,
  };

  let prospectId = storedIndex && typeof storedIndex.prospectId === "string"
    ? storedIndex.prospectId
    : "";
  const additions: UnknownRecord = {};
  if (isBuildingSalesLead(input)) {
    const prospects = safeCollection(data.salesProspects);
    const existingProspect = prospectId && isRecord(prospects[prospectId]);
    if (!existingProspect) {
      prospectId = command.ids.prospectId;
      prospects[prospectId] = {
        id: prospectId,
        name: input.buildingInfo || `${input.location} 문의 건물`,
        address: input.location,
        normalizedAddress: input.location.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, ""),
        region: input.location,
        buildingType: "one_room_multi_family",
        demandAnchors: [input.service],
        source: "other",
        owner: "미배정",
        priority: "high",
        stage: "candidate",
        vacancyCount: 0,
        upcomingVacancyCount: 0,
        lastActivityAt: command.now,
        nextAction: "홈페이지 문의 확인",
        nextActionAt: "",
        crmBuildingId: "",
        archivedAt: "",
        archivedBy: "",
        createdAt: command.now,
        createdBy: "website-lead",
        updatedAt: command.now,
        updatedBy: "website-lead",
      };
      const contacts = safeCollection(data.salesContacts);
      contacts[command.ids.contactId] = {
        id: command.ids.contactId,
        prospectId,
        name: input.name,
        role: input.customerType === "manager" ? "manager" : "owner",
        phone: input.phone,
        source: "other",
        sourceEvidence: sourceEvidence(input),
        verifiedAt: "",
        doNotContact: false,
        optOut: false,
        doNotContactAt: "",
        doNotContactReason: "",
        crmCustomerId: customerId,
        archivedAt: "",
        archivedBy: "",
        createdAt: command.now,
        createdBy: "website-lead",
        updatedAt: command.now,
        updatedBy: "website-lead",
      };
      const events = safeCollection(data.salesEvents);
      events[command.ids.eventId] = {
        id: command.ids.eventId,
        prospectId,
        contactId: "",
        unitId: "",
        opportunityId: "",
        type: "prospect_created",
        resumeStage: "",
        occurredAt: command.now,
        evidenceType: "website_form",
        evidenceUrl: input.pageUrl,
        evidenceNote: "BRING CARE 광고 랜딩 상담 신청",
        channel: "",
        result: "",
        checklistIds: [],
        owner: "미배정",
        managementStartedAt: "",
        serviceScope: input.service,
        archivedAt: "",
        archivedBy: "",
        createdAt: command.now,
        createdBy: "website-lead",
        updatedAt: command.now,
        updatedBy: "website-lead",
      };
      additions.salesContacts = contacts;
      additions.salesEvents = events;
    }
    const opportunities = safeCollection(data.salesOpportunities);
    opportunities[command.ids.opportunityId] = {
      id: command.ids.opportunityId,
      prospectId,
      unitId: "",
      serviceType: opportunityType(input),
      stage: "discovered",
      requirements: input.needs,
      owner: "미배정",
      dueAt: "",
      quoteAmount: 0,
      revenueAmount: 0,
      evidenceUrl: input.pageUrl,
      evidenceNote: sourceEvidence(input),
      workflowCaseId: "",
      workCompletedAt: "",
      revenueRecordedAt: "",
      milestoneDateSource: "explicit",
      archivedAt: "",
      archivedBy: "",
      createdAt: command.now,
      createdBy: "website-lead",
      updatedAt: command.now,
      updatedBy: "website-lead",
    };
    additions.salesProspects = prospects;
    additions.salesOpportunities = opportunities;
  }

  phoneIndex[command.phoneHash] = {
    customerId,
    prospectId,
    lastSubmittedAt: command.now,
  };
  receipts[input.requestId] = {
    receiptId: input.requestId,
    customerId,
    activityId: command.ids.activityId,
    createdAt: command.now,
  };

  return {
    data: {
      ...data,
      customers,
      activities,
      marketingLeadPhoneIndex: phoneIndex,
      marketingLeadReceipts: receipts,
      ...additions,
    },
    result: { receiptId: input.requestId, customerId, repeated: false },
  };
}

export async function submitMarketingLeadCore(
  value: unknown,
  dependencies: MarketingLeadDependencies,
): Promise<MarketingLeadResult> {
  if (
    !dependencies
    || typeof dependencies.now !== "function"
    || typeof dependencies.newId !== "function"
    || typeof dependencies.transact !== "function"
  ) fail("marketing_lead_dependencies_invalid", "CRM 연결을 사용할 수 없습니다.");
  const input = normalizeMarketingLeadInput(value);
  const now = dependencies.now();
  if (!validTimestamp(now)) fail("marketing_lead_timestamp_invalid", "접수 시각을 확인할 수 없습니다.");
  const phoneHash = createHash("sha256").update(input.phone.replace(/-/g, "")).digest("hex");
  const ids = {
    customerId: dependencies.newId("cus"),
    activityId: dependencies.newId("act"),
    prospectId: dependencies.newId("spr"),
    contactId: dependencies.newId("sct"),
    opportunityId: dependencies.newId("sop"),
    eventId: dependencies.newId("sev"),
  };
  return dependencies.transact({ input, phoneHash, now, ids });
}
