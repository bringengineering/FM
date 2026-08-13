(function attachBringSalesCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringSalesCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function makeBringSalesCore() {
  "use strict";

  const SALES_STAGES = Object.freeze([
    { id: "candidate", label: "건물후보", events: ["prospect_created"] },
    { id: "contact_ready", label: "유효 연락처 확보", events: ["contact_verified"] },
    { id: "first_contact", label: "최초접촉", events: ["contact_attempted"] },
    { id: "replied", label: "응답", events: ["reply_received"] },
    { id: "qualified_interest", label: "유효관심", events: ["interest_qualified"] },
    { id: "meeting_confirmed", label: "미팅 확정", events: ["meeting_confirmed"] },
    { id: "diagnosis_done", label: "현장진단 완료", events: ["diagnosis_completed"] },
    { id: "listing_received", label: "매물접수", events: ["listing_received"] },
    { id: "ad_published", label: "광고게시", events: ["ad_published"] },
    { id: "tenant_inquiry_visit", label: "임차문의·방문", events: ["tenant_inquiry", "tenant_visit"] },
    { id: "lease_signed", label: "임대차계약", events: ["lease_signed"] },
    { id: "paid_management", label: "유료관리 전환", events: ["paid_management_started"] },
    { id: "paused_closed", label: "보류·종료", events: ["prospect_paused", "prospect_closed"] }
  ].map((stage, index) => Object.freeze(Object.assign({ code: stage.id, index }, stage))));

  const SALES_CHANNELS = Object.freeze(["sms", "call", "visit", "meeting", "memo"]);
  const SALES_SOURCES = Object.freeze([
    "building_sign", "broker", "storefront", "referral", "danggeun", "naver_blog", "existing_customer", "other"
  ]);
  const SALES_RESULTS = Object.freeze([
    "no_response", "replied", "callback_requested", "meeting_set", "not_interested", "invalid_contact", "do_not_contact", "follow_up"
  ]);
  const SALES_RESPONSE_CODES = Object.freeze([
    "vacancy_now", "vacancy_upcoming", "no_vacancy", "interested", "needs_info", "callback_later", "refused", "wrong_number", "do_not_contact"
  ]);
  const SALES_FAILURE_REASONS = Object.freeze([
    "no_response", "invalid_number", "not_owner", "no_vacancy", "not_interested", "price", "trust", "already_managed", "do_not_contact", "other"
  ]);
  const SALES_SERVICE_TYPES = Object.freeze([
    "common_cleaning", "move_in_cleaning", "move_out_cleaning", "flooring_wallpaper", "waterproofing", "repair", "signage", "other"
  ]);
  const OPPORTUNITY_STAGES = Object.freeze([
    "discovered", "quote_requested", "quote_approved", "work_completed", "revenue_recorded"
  ]);
  const UNIT_STATUSES = Object.freeze(["vacant", "upcoming", "occupied", "unknown"]);

  const EVENT_TO_STAGE = new Map();
  SALES_STAGES.forEach(stage => stage.events.forEach(event => EVENT_TO_STAGE.set(event, stage.id)));
  const EVENT_TYPES = Object.freeze(Array.from(EVENT_TO_STAGE.keys()));
  const STAGE_INDEX = new Map(SALES_STAGES.map((stage, index) => [stage.id, index]));
  const UNIT_EVENTS = new Set(["listing_received", "ad_published", "tenant_inquiry", "tenant_visit", "lease_signed"]);

  const text = value => String(value || "").trim();
  const list = value => Array.isArray(value) ? value.filter(Boolean).map(item => String(item)) : [];
  const amount = value => Number(String(value ?? 0).replace(/[^0-9.-]/g, "")) || 0;
  const bool = value => value === true || value === "true" || value === 1 || value === "1";
  const iso = value => {
    const date = value ? new Date(value) : new Date();
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  };
  const optionalIso = value => text(value) ? iso(value) : "";
  const random = prefix => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const enumValue = (value, values, fallback) => values.includes(value) ? value : fallback;
  const errorItem = (field, code, message) => ({ field, code, message });

  function actorEmail(actor) {
    return text(actor && actor.email || actor);
  }

  function commonRecord(value, prefix, actor, at) {
    const source = value && typeof value === "object" ? value : {};
    const now = iso(at);
    const editor = actorEmail(actor);
    const createdAt = source.createdAt ? iso(source.createdAt) : now;
    return Object.assign({}, source, {
      id: text(source.id) || random(prefix),
      archivedAt: optionalIso(source.archivedAt),
      archivedBy: text(source.archivedBy),
      createdAt,
      createdBy: text(source.createdBy) || editor,
      updatedAt: now,
      updatedBy: editor || text(source.updatedBy || source.createdBy)
    });
  }

  function normalizeAddress(value) {
    return text(value).normalize("NFKC").toLowerCase().replace(/강원도/g, "강원").replace(/\s+/g, "").replace(/[(),.-]/g, "");
  }

  function normalizeSalesProspect(value, actor, at) {
    const record = commonRecord(value, "spr", actor, at);
    record.name = text(record.name);
    record.address = text(record.address);
    record.normalizedAddress = text(record.normalizedAddress) || normalizeAddress(record.address);
    record.region = text(record.region);
    record.buildingType = text(record.buildingType) || "one_room_multi_family";
    record.demandAnchors = list(record.demandAnchors);
    record.source = enumValue(record.source, SALES_SOURCES, "other");
    record.owner = text(record.owner);
    record.priority = text(record.priority) || "normal";
    record.stage = STAGE_INDEX.has(record.stage) ? record.stage : "candidate";
    record.vacancyCount = Math.max(0, Math.trunc(amount(record.vacancyCount)));
    record.upcomingVacancyCount = Math.max(0, Math.trunc(amount(record.upcomingVacancyCount)));
    record.lastActivityAt = optionalIso(record.lastActivityAt);
    record.nextAction = text(record.nextAction);
    record.nextActionAt = optionalIso(record.nextActionAt);
    record.crmBuildingId = text(record.crmBuildingId);
    return record;
  }

  function createSalesProspect(value, actor, at) {
    const record = normalizeSalesProspect(value, actor, at);
    if (!record.name && !record.address) {
      const error = new Error("건물명 또는 주소가 필요합니다.");
      error.code = "PROSPECT_NAME_OR_ADDRESS_REQUIRED";
      throw error;
    }
    return record;
  }

  function normalizeSalesContact(value, actor, at) {
    const record = commonRecord(value, "sct", actor, at);
    record.prospectId = text(record.prospectId);
    record.name = text(record.name);
    record.role = text(record.role) || "owner";
    record.phone = text(record.phone);
    record.source = enumValue(record.source, SALES_SOURCES, "other");
    record.sourceEvidence = text(record.sourceEvidence);
    record.verifiedAt = optionalIso(record.verifiedAt);
    record.doNotContact = bool(record.doNotContact || record.optOut);
    record.optOut = record.doNotContact;
    record.doNotContactAt = record.doNotContact ? (optionalIso(record.doNotContactAt) || record.updatedAt) : "";
    record.doNotContactReason = text(record.doNotContactReason);
    record.crmCustomerId = text(record.crmCustomerId);
    return record;
  }

  function createSalesContact(value, actor, at) {
    const record = normalizeSalesContact(value, actor, at);
    if (!record.prospectId || !record.phone) {
      const error = new Error("대상 건물과 전화번호가 필요합니다.");
      error.code = "SALES_CONTACT_REQUIRED_FIELDS";
      throw error;
    }
    return record;
  }

  function normalizeSalesUnit(value, actor, at) {
    const record = commonRecord(value, "sun", actor, at);
    record.prospectId = text(record.prospectId);
    record.label = text(record.label);
    record.status = enumValue(record.status, UNIT_STATUSES, "unknown");
    record.moveOutAt = optionalIso(record.moveOutAt);
    record.deposit = amount(record.deposit);
    record.rent = amount(record.rent);
    record.maintenanceFee = amount(record.maintenanceFee);
    record.photoUrl = text(record.photoUrl);
    record.evidenceUrl = text(record.evidenceUrl);
    record.note = text(record.note);
    return record;
  }

  function createSalesUnit(value, actor, at) {
    const record = normalizeSalesUnit(value, actor, at);
    if (!record.prospectId || !record.label) {
      const error = new Error("대상 건물과 호실명이 필요합니다.");
      error.code = "SALES_UNIT_REQUIRED_FIELDS";
      throw error;
    }
    return record;
  }

  function normalizeSalesActivity(value, actor, at) {
    const record = commonRecord(value, "sac", actor, at);
    record.prospectId = text(record.prospectId);
    record.contactId = text(record.contactId);
    record.unitId = text(record.unitId);
    record.type = enumValue(record.type, SALES_CHANNELS, "memo");
    record.channel = enumValue(record.channel || record.type, SALES_CHANNELS, record.type);
    record.occurredAt = record.occurredAt ? iso(record.occurredAt) : record.createdAt;
    record.result = enumValue(record.result, SALES_RESULTS, "follow_up");
    record.responseCode = text(record.responseCode) ? enumValue(record.responseCode, SALES_RESPONSE_CODES, "") : "";
    record.failureReason = text(record.failureReason) ? enumValue(record.failureReason, SALES_FAILURE_REASONS, "other") : "";
    record.summary = text(record.summary);
    record.responseText = text(record.responseText);
    record.scriptId = text(record.scriptId);
    record.scriptVersion = text(record.scriptVersion);
    record.nextAction = text(record.nextAction);
    record.nextActionAt = optionalIso(record.nextActionAt);
    record.owner = text(record.owner);
    return record;
  }

  function validateContactAttempt(value, contacts) {
    const activity = value && typeof value === "object" ? value : {};
    const errors = [];
    const type = text(activity.type || activity.channel);
    if (!activity.prospectId) errors.push(errorItem("prospectId", "PROSPECT_REQUIRED", "대상 건물이 필요합니다."));
    if (!["sms", "call"].includes(type)) return { valid: errors.length === 0, errors };
    if (!activity.contactId) errors.push(errorItem("contactId", "CONTACT_REQUIRED", "문자·전화에는 연락처가 필요합니다."));
    const contact = (Array.isArray(contacts) ? contacts : []).find(item => item && item.id === activity.contactId && !item.archivedAt);
    if (activity.contactId && !contact) errors.push(errorItem("contactId", "CONTACT_NOT_FOUND", "유효한 연락처를 찾을 수 없습니다."));
    if (contact && (bool(contact.doNotContact) || bool(contact.optOut))) {
      errors.push(errorItem("contactId", "CONTACT_OPTED_OUT", "수신거부 연락처에는 새 접촉을 기록할 수 없습니다."));
    }
    return { valid: errors.length === 0, errors };
  }

  function createSalesActivity(value, context, at) {
    const actor = context && context.actor ? context.actor : (context && !Array.isArray(context.contacts) ? context : null);
    const record = normalizeSalesActivity(value, actor, at);
    const contactsProvided = context && Array.isArray(context.contacts);
    if (contactsProvided) {
      const validation = validateContactAttempt(record, contactsProvided ? context.contacts : []);
      if (!validation.valid) {
        const first = validation.errors[0];
        const error = new Error(first.message);
        error.code = first.code;
        error.field = first.field;
        error.errors = validation.errors;
        throw error;
      }
    }
    return record;
  }

  function normalizeSalesEvent(value, actor, at) {
    const source = value && typeof value === "object" ? value : {};
    const now = iso(at);
    const editor = actorEmail(actor);
    const createdAt = source.createdAt ? iso(source.createdAt) : now;
    return Object.assign({}, source, {
      id: text(source.id) || random("sev"),
      prospectId: text(source.prospectId),
      contactId: text(source.contactId),
      unitId: text(source.unitId),
      opportunityId: text(source.opportunityId),
      type: text(source.type),
      occurredAt: source.occurredAt ? iso(source.occurredAt) : createdAt,
      evidenceType: text(source.evidenceType) || (text(source.evidenceUrl) ? "url" : (text(source.evidenceNote) ? "note" : "")),
      evidenceUrl: text(source.evidenceUrl),
      evidenceNote: text(source.evidenceNote),
      channel: text(source.channel),
      result: text(source.result),
      checklistIds: list(source.checklistIds),
      owner: text(source.owner),
      archivedAt: optionalIso(source.archivedAt),
      archivedBy: text(source.archivedBy),
      createdAt,
      createdBy: text(source.createdBy) || editor,
      updatedAt: now,
      updatedBy: editor || text(source.updatedBy || source.createdBy)
    });
  }

  function validateEvent(value, context) {
    const event = value && typeof value === "object" ? value : {};
    const errors = [];
    if (!text(event.prospectId)) errors.push(errorItem("prospectId", "PROSPECT_REQUIRED", "대상 건물이 필요합니다."));
    if (!EVENT_TO_STAGE.has(event.type)) errors.push(errorItem("type", "EVENT_TYPE_INVALID", "올바른 영업 이벤트가 필요합니다."));
    if (!text(event.occurredAt) || Number.isNaN(new Date(event.occurredAt).getTime())) {
      errors.push(errorItem("occurredAt", "OCCURRED_AT_REQUIRED", "발생시각이 필요합니다."));
    }
    if (!text(event.evidenceType) && !text(event.evidenceUrl) && !text(event.evidenceNote)) {
      errors.push(errorItem("evidenceType", "EVIDENCE_TYPE_REQUIRED", "증거 유형이 필요합니다."));
    }
    if (!text(event.evidenceUrl) && !text(event.evidenceNote)) {
      errors.push(errorItem("evidence", "EVIDENCE_REQUIRED", "증거 링크 또는 확인 메모가 필요합니다."));
    }
    if (UNIT_EVENTS.has(event.type) && !text(event.unitId)) {
      errors.push(errorItem("unitId", "UNIT_REQUIRED", "이 이벤트에는 호실이 필요합니다."));
    }
    if (event.type === "contact_verified") {
      if (!text(event.contactId)) errors.push(errorItem("contactId", "CONTACT_REQUIRED", "확인된 연락처가 필요합니다."));
      if (context && Array.isArray(context.contacts) && event.contactId) {
        const contact = context.contacts.find(item => item && item.id === event.contactId && item.prospectId === event.prospectId && !item.archivedAt && item.phone);
        if (!contact) errors.push(errorItem("contactId", "CONTACT_NOT_VERIFIED", "대상 건물의 유효 연락처를 확인해 주세요."));
      }
    }
    if (["prospect_paused", "prospect_closed"].includes(event.type) && !text(event.evidenceNote)) {
      errors.push(errorItem("evidenceNote", "CLOSE_REASON_REQUIRED", "보류·종료 사유가 필요합니다."));
    }
    return { valid: errors.length === 0, errors };
  }

  function createSalesEvent(value, context, at) {
    const actor = context && context.actor ? context.actor : (context && !Array.isArray(context.contacts) && !Array.isArray(context.units) ? context : null);
    const record = normalizeSalesEvent(value, actor, at);
    const validation = validateEvent(record, context);
    if (!validation.valid) {
      const first = validation.errors[0];
      const error = new Error(first.message);
      error.code = first.code;
      error.field = first.field;
      error.errors = validation.errors;
      throw error;
    }
    return record;
  }

  function normalizeSalesOpportunity(value, actor, at) {
    const record = commonRecord(value, "sop", actor, at);
    record.prospectId = text(record.prospectId);
    record.unitId = text(record.unitId);
    record.serviceType = enumValue(record.serviceType, SALES_SERVICE_TYPES, "other");
    record.stage = enumValue(record.stage, OPPORTUNITY_STAGES, "discovered");
    record.requirements = text(record.requirements);
    record.owner = text(record.owner);
    record.dueAt = optionalIso(record.dueAt);
    record.quoteAmount = amount(record.quoteAmount);
    record.revenueAmount = amount(record.revenueAmount);
    record.evidenceUrl = text(record.evidenceUrl);
    record.evidenceNote = text(record.evidenceNote);
    record.workflowCaseId = text(record.workflowCaseId);
    return record;
  }

  function validateOpportunity(value) {
    const record = normalizeSalesOpportunity(value);
    const errors = [];
    if (!record.prospectId) errors.push(errorItem("prospectId", "PROSPECT_REQUIRED", "대상 건물이 필요합니다."));
    if (["work_completed", "revenue_recorded"].includes(record.stage) && !record.evidenceUrl && !record.evidenceNote) {
      errors.push(errorItem("evidence", "EVIDENCE_REQUIRED", "작업완료·매출기록에는 증거가 필요합니다."));
    }
    if (record.stage === "revenue_recorded" && record.revenueAmount <= 0) {
      errors.push(errorItem("revenueAmount", "REVENUE_AMOUNT_REQUIRED", "매출기록 금액은 1원 이상이어야 합니다."));
    }
    return { valid: errors.length === 0, errors };
  }

  function createSalesOpportunity(value, actor, at) {
    const record = normalizeSalesOpportunity(value, actor, at);
    const validation = validateOpportunity(record);
    if (!validation.valid) {
      const first = validation.errors[0];
      const error = new Error(first.message);
      error.code = first.code;
      error.field = first.field;
      error.errors = validation.errors;
      throw error;
    }
    return record;
  }

  function canTransitionOpportunityStage(from, to) {
    const fromIndex = OPPORTUNITY_STAGES.indexOf(from);
    const toIndex = OPPORTUNITY_STAGES.indexOf(to);
    return fromIndex >= 0 && toIndex === fromIndex + 1;
  }

  function stageFromEvents(events, options) {
    const prospectId = options && options.prospectId;
    let highest = 0;
    for (const event of Array.isArray(events) ? events : []) {
      if (!event || event.archivedAt || (prospectId && event.prospectId !== prospectId)) continue;
      if (!validateEvent(event, options).valid) continue;
      const stageId = EVENT_TO_STAGE.get(event.type);
      const index = STAGE_INDEX.get(stageId);
      if (index > highest) highest = index;
    }
    return SALES_STAGES[highest].id;
  }

  function calculateKpis(store, options) {
    const data = store && typeof store === "object" ? store : {};
    const settings = options && typeof options === "object" ? options : {};
    const activeProspects = (Array.isArray(data.salesProspects) ? data.salesProspects : []).filter(item => item && !item.archivedAt && item.stage !== "paused_closed");
    const allProspects = Array.isArray(data.salesProspects) ? data.salesProspects : [];
    const activeProspectIds = new Set(activeProspects.map(item => item.id).filter(Boolean));
    const shouldRestrictProspects = allProspects.length > 0;
    const inPeriod = occurredAt => {
      const timestamp = new Date(occurredAt).getTime();
      if (Number.isNaN(timestamp)) return false;
      if (settings.from && timestamp < new Date(settings.from).getTime()) return false;
      if (settings.to && timestamp >= new Date(settings.to).getTime()) return false;
      return true;
    };
    const events = (Array.isArray(data.salesEvents) ? data.salesEvents : []).filter(event => {
      if (!event || event.archivedAt || !inPeriod(event.occurredAt)) return false;
      if (shouldRestrictProspects && !activeProspectIds.has(event.prospectId)) return false;
      return validateEvent(event, settings).valid;
    });
    const prospectCount = types => new Set(events.filter(event => types.includes(event.type)).map(event => event.prospectId)).size;
    const unitCount = types => new Set(events.filter(event => types.includes(event.type)).map(event => `${event.prospectId}:${event.unitId}`)).size;
    const opportunities = (Array.isArray(data.salesOpportunities) ? data.salesOpportunities : []).filter(item => {
      if (!item || item.archivedAt || (shouldRestrictProspects && !activeProspectIds.has(item.prospectId))) return false;
      return validateOpportunity(item).valid;
    });
    const completed = opportunities.filter(item => ["work_completed", "revenue_recorded"].includes(item.stage));
    const revenue = opportunities.filter(item => item.stage === "revenue_recorded");
    const today = text(settings.today || settings.now).slice(0, 10) || new Date().toISOString().slice(0, 10);
    const dueDate = prospect => text(prospect.nextActionAt).slice(0, 10);
    const ownerCounts = {};
    activeProspects.forEach(prospect => {
      const owner = prospect.owner || "미지정";
      ownerCounts[owner] = (ownerCounts[owner] || 0) + 1;
    });
    const result = {
      activeProspects: activeProspects.length,
      contactReadyProspects: prospectCount(["contact_verified"]),
      contactedProspects: prospectCount(["contact_attempted"]),
      respondedProspects: prospectCount(["reply_received"]),
      qualifiedProspects: prospectCount(["interest_qualified"]),
      meetingConfirmedProspects: prospectCount(["meeting_confirmed"]),
      diagnosedProspects: prospectCount(["diagnosis_completed"]),
      listingUnits: unitCount(["listing_received"]),
      adPublishedUnits: unitCount(["ad_published"]),
      tenantActivityUnits: unitCount(["tenant_inquiry", "tenant_visit"]),
      leaseSignedUnits: unitCount(["lease_signed"]),
      paidManagementProspects: prospectCount(["paid_management_started"]),
      completedOpportunities: new Set(completed.map(item => item.id)).size,
      revenueRecorded: revenue.reduce((sum, item) => sum + amount(item.revenueAmount), 0),
      todayFollowUps: activeProspects.filter(prospect => dueDate(prospect) === today).length,
      overdueFollowUps: activeProspects.filter(prospect => dueDate(prospect) && dueDate(prospect) < today).length,
      activeProspectsByOwner: ownerCounts
    };
    return Object.assign(result, {
      firstContacts: result.contactedProspects,
      repliedProspects: result.respondedProspects,
      meetingsConfirmed: result.meetingConfirmedProspects,
      diagnosesCompleted: result.diagnosedProspects,
      listingReceivedUnits: result.listingUnits,
      leasesSignedUnits: result.leaseSignedUnits,
      opportunityWorkCompleted: result.completedOpportunities,
      revenueAmount: result.revenueRecorded,
      todayFollowups: result.todayFollowUps,
      overdueFollowups: result.overdueFollowUps,
      activeByOwner: result.activeProspectsByOwner
    });
  }

  function salesError(code, message, field) {
    const error = new Error(message);
    error.code = code;
    if (field) error.field = field;
    return error;
  }

  function assertProspect(value) {
    const item = normalizeSalesProspect(value);
    if (!item.name && !item.address) throw salesError("SALES_PROSPECT_IDENTITY_REQUIRED", "건물명 또는 주소를 입력해 주세요.", "name");
    return item;
  }

  function assertContact(value) {
    const item = normalizeSalesContact(value);
    if (!item.prospectId || !item.phone) throw salesError("SALES_CONTACT_REQUIRED", "대상 건물과 연락처를 확인해 주세요.", "phone");
    return item;
  }

  function assertUnit(value) {
    const item = normalizeSalesUnit(value);
    if (!item.prospectId || !item.label) throw salesError("SALES_UNIT_REQUIRED", "대상 건물과 호실명을 입력해 주세요.", "label");
    return item;
  }

  function assertActivity(value, context) {
    const item = normalizeSalesActivity(value);
    if (!item.summary) throw salesError("SALES_ACTIVITY_SUMMARY_REQUIRED", "영업활동 내용을 입력해 주세요.", "summary");
    if (["sms", "call"].includes(item.type) && !item.contactId) {
      throw salesError("SALES_ACTIVITY_CONTACT_REQUIRED", "문자·전화 대상 연락처를 선택해 주세요.", "contactId");
    }
    if (["sms", "call"].includes(item.type)) {
      const contact = (context && Array.isArray(context.contacts) ? context.contacts : []).find(candidate => candidate && candidate.id === item.contactId && !candidate.archivedAt);
      if (contact && (bool(contact.doNotContact) || bool(contact.optOut))) {
        throw salesError("SALES_CONTACT_OPTED_OUT", "수신거부 연락처에는 문자·전화를 기록할 수 없습니다.", "contactId");
      }
    }
    return item;
  }

  function assertEvent(value, context) {
    const event = normalizeSalesEvent(value);
    const validation = validateEvent(event, context);
    if (validation.valid) return event;
    const first = validation.errors[0];
    const codes = {
      UNIT_REQUIRED: "SALES_EVENT_UNIT_REQUIRED",
      CONTACT_REQUIRED: "SALES_EVENT_CONTACT_REQUIRED",
      CONTACT_NOT_VERIFIED: "SALES_EVENT_CONTACT_REQUIRED",
      EVIDENCE_REQUIRED: "SALES_EVENT_EVIDENCE_REQUIRED",
      EVIDENCE_TYPE_REQUIRED: "SALES_EVENT_EVIDENCE_REQUIRED",
      CLOSE_REASON_REQUIRED: "SALES_EVENT_REASON_REQUIRED"
    };
    throw salesError(codes[first.code] || `SALES_${first.code}`, first.message, first.field);
  }

  function assertOpportunity(value) {
    const item = normalizeSalesOpportunity(value);
    const validation = validateOpportunity(item);
    if (validation.valid) return item;
    const first = validation.errors[0];
    const code = first.code === "REVENUE_AMOUNT_REQUIRED" ? "SALES_OPPORTUNITY_REVENUE_REQUIRED" : "SALES_OPPORTUNITY_EVIDENCE_REQUIRED";
    throw salesError(code, first.message, first.field);
  }

  function duplicateProspects(records, candidate) {
    const current = normalizeSalesProspect(candidate);
    const key = current.normalizedAddress || normalizeAddress(current.address);
    if (!key) return [];
    return (Array.isArray(records) ? records : []).filter(item => {
      if (!item || item.archivedAt || item.id === current.id) return false;
      return (text(item.normalizedAddress) || normalizeAddress(item.address)) === key;
    });
  }

  function archiveRecord(record, actor, at) {
    const timestamp = iso(at);
    return Object.assign({}, record || {}, { archivedAt: timestamp, archivedBy: actorEmail(actor), updatedAt: timestamp, updatedBy: actorEmail(actor) });
  }

  function restoreRecord(record, actor, at) {
    const timestamp = iso(at);
    return Object.assign({}, record || {}, { archivedAt: "", archivedBy: "", updatedAt: timestamp, updatedBy: actorEmail(actor) });
  }

  function nextStageFromEvents(prospectId, events) {
    const applicable = (Array.isArray(events) ? events : []).filter(event => event && !event.archivedAt && event.prospectId === prospectId && validateEvent(event).valid);
    if (!applicable.length) return "candidate";
    applicable.sort((left, right) => new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime());
    return EVENT_TO_STAGE.get(applicable[applicable.length - 1].type) || "candidate";
  }

  function computeSalesKpis(store, range) {
    return calculateKpis(store, range);
  }

  return {
    SALES_STAGES,
    SALES_EVENT_TYPES: EVENT_TYPES,
    SALES_CHANNELS,
    SALES_SOURCES,
    SALES_RESULTS,
    SALES_RESPONSE_CODES,
    SALES_FAILURE_REASONS,
    SALES_SERVICE_TYPES,
    SERVICE_TYPES: SALES_SERVICE_TYPES,
    OPPORTUNITY_STAGES,
    UNIT_STATUSES,
    EVENT_TYPES,
    createSalesProspect,
    normalizeSalesProspect,
    createSalesContact,
    normalizeSalesContact,
    createSalesUnit,
    normalizeSalesUnit,
    createSalesActivity,
    normalizeSalesActivity,
    createSalesEvent,
    normalizeSalesEvent,
    createSalesOpportunity,
    normalizeSalesOpportunity,
    validateContactAttempt,
    validateEvent,
    validateOpportunity,
    stageFromEvents,
    calculateKpis,
    canTransitionOpportunityStage,
    normalizeAddress,
    createProspect: createSalesProspect,
    createContact: createSalesContact,
    createUnit: createSalesUnit,
    createActivity: createSalesActivity,
    createEvent: createSalesEvent,
    createOpportunity: createSalesOpportunity,
    assertProspect,
    assertContact,
    assertUnit,
    assertActivity,
    assertEvent,
    assertOpportunity,
    duplicateProspects,
    nextStageFromEvents,
    computeSalesKpis,
    archiveRecord,
    restoreRecord
  };
});
