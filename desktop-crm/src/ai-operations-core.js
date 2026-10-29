(function attachBringAiOperationsCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringAiOperationsCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function makeBringAiOperationsCore() {
  "use strict";

  const BAND_DAYS = Object.freeze({ urgent: 1, high: 3, normal: 7, nurture: 14 });
  const STAGE_POINTS = Object.freeze({
    contact_ready: 5,
    first_contact: 10,
    replied: 15,
    qualified_interest: 20,
    meeting_confirmed: 25,
    diagnosis_done: 25,
    listing_received: 25,
    ad_published: 25,
    tenant_inquiry_visit: 25,
    lease_signed: 25,
    paid_management: 25,
    quote_requested: 25,
    quote_approved: 25,
    work_completed: 25,
    revenue_recorded: 25,
    "견적": 25,
    "협의": 25
  });
  const RESPONSE_TYPES = new Set([
    "call", "reply", "visit", "meeting", "replied", "callback_requested",
    "meeting_set", "통화", "회신", "방문", "미팅"
  ]);
  const CATEGORY_RULES = Object.freeze([
    ["water", /누수|수도|배관|물샘|침수/],
    ["electric", /전기|정전|차단기|콘센트|감전/],
    ["heating_cooling", /보일러|난방|냉방|에어컨|가스/],
    ["cleaning", /청소|오염|곰팡이/],
    ["waste", /폐기물|쓰레기|버려/],
    ["grounds", /예초|잡초|마당|외부/],
    ["damage", /파손|고장|깨짐|문이 안|출입 불가/],
    ["leasing", /임대차|공실|퇴실|입주|계약/]
  ]);
  const IMMEDIATE_RISK = /화재|불이 났|연기|가스 냄새|가스 누출|감전|침수|출입 불가/;

  function salesBand(score) {
    const normalized = Math.max(0, Math.min(100, Number(score) || 0));
    if (normalized >= 80) return "urgent";
    if (normalized >= 55) return "high";
    if (normalized >= 30) return "normal";
    return "nurture";
  }

  function kstParts(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit"
    });
    const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
    return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
  }

  function dateOnly(value) {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const parts = kstParts(value);
    if (!parts) return "";
    return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  }

  function addKstDays(now, days) {
    const parts = kstParts(now);
    if (!parts) return "";
    const middayUtc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 3));
    return dateOnly(middayUtc);
  }

  function dayDifference(later, earlier) {
    const left = dateOnly(later);
    const right = dateOnly(earlier);
    if (!left || !right) return null;
    return Math.round((Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86400000);
  }

  function recommendFollowUp(band, existingDate, now = new Date()) {
    const recommended = addKstDays(now, BAND_DAYS[band] || BAND_DAYS.nurture);
    const existing = dateOnly(existingDate);
    const today = dateOnly(now);
    return existing && existing >= today && existing <= recommended ? existing : recommended;
  }

  function scoreSalesFocus(input = {}, now = new Date()) {
    const components = {
      stage: STAGE_POINTS[String(input.stage || "")] || 0,
      overdue: 0,
      response: RESPONSE_TYPES.has(String(input.lastResponseType || input.result || "")) ? 20 : 0,
      vacancyOrIssue: input.hasVacancy === true || String(input.currentIssue || "").trim() ? 15 : 0,
      expectedValue: Number(input.expectedValue) > 0 ? 10 : 0,
      dormant: 0
    };
    const dueDiff = dayDifference(input.nextActionAt, now);
    if (dueDiff !== null) components.overdue = dueDiff < 0 ? 25 : dueDiff === 0 ? 15 : 0;
    const inactiveDays = dayDifference(now, input.lastActivityAt);
    if (inactiveDays !== null && inactiveDays >= 10) components.dormant = 5;
    const score = Math.min(100, Object.values(components).reduce((sum, value) => sum + value, 0));
    const band = salesBand(score);
    return Object.freeze({
      score,
      band,
      recommendedAt: recommendFollowUp(band, input.nextActionAt, now),
      components: Object.freeze(components)
    });
  }

  function classifyIssue(value) {
    const content = String(value || "").trim();
    const matched = CATEGORY_RULES.find(([, pattern]) => pattern.test(content));
    const safetyWarning = IMMEDIATE_RISK.test(content);
    return {
      category: matched ? matched[0] : "other",
      urgency: safetyWarning ? "immediate" : "normal",
      safetyWarning
    };
  }

  function buildWorkDraftPayload(input = {}) {
    const title = String(input.title || "").trim().slice(0, 120);
    const detail = String(input.detail || "").trim().slice(0, 2000);
    const classification = classifyIssue(`${title} ${detail}`);
    return Object.freeze({
      title,
      detail,
      buildingLabel: String(input.buildingLabel || "").trim().slice(0, 120),
      requestedAt: dateOnly(input.requestedAt),
      category: classification.category,
      urgency: classification.urgency,
      safetyWarning: classification.safetyWarning
    });
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }

  function sourceRevision(value) {
    const content = JSON.stringify(stableValue(value));
    let hash = 2166136261;
    for (let index = 0; index < content.length; index += 1) {
      hash ^= content.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `rev_${(hash >>> 0).toString(16).padStart(8, "0")}`;
  }

  function assertCurrentProposal(proposal, currentSource) {
    if (!proposal || proposal.sourceRevision !== sourceRevision(currentSource)) {
      throw new Error("stale AI proposal: source data changed");
    }
    return true;
  }

  return Object.freeze({
    BAND_DAYS,
    salesBand,
    recommendFollowUp,
    scoreSalesFocus,
    classifyIssue,
    buildWorkDraftPayload,
    sourceRevision,
    assertCurrentProposal
  });
});
