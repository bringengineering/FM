import type { CleaningOrderActor } from "./contracts.js";
import { validateStoredCleaningOrder } from "./core.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_AMOUNT = 1_000_000_000;
const MAX_REVISIONS = 100;
const MAX_HISTORY = 200;

export interface CleaningQuoteItem {
  name: string;
  detail: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  note: string;
}

export interface CleaningQuoteSnapshot {
  quoteDate: string;
  validUntil: string;
  recipient: string;
  recipientPhone: string;
  siteAddress: string;
  projectName: string;
  service: string;
  summary: string;
  items: CleaningQuoteItem[];
  totalAmount: number;
  supplyAmount: number;
  vatAmount: number;
  taxIncluded: boolean;
  notes: string[];
  company: Record<string, string>;
}

export interface CleaningQuoteRecord extends CleaningQuoteSnapshot {
  id: string;
  orderId: string;
  buildingId: string;
  revision: number;
  previousQuoteId: string;
  status: "pending_review" | "admin_approved" | "returned";
  createdAt: string;
  createdByUid: string;
  reviewHistory: CleaningQuoteReviewEvent[];
}

export interface CleaningQuoteReviewEvent {
  requestId: string;
  action: "approve" | "return";
  changedAt: string;
  changedByUid: string;
  note: string;
}

export interface CleaningQuoteSet {
  orderId: string;
  buildingId: string;
  latestRevision: number;
  latestQuoteId: string;
  revisions: Record<string, CleaningQuoteRecord>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, max: number, required = false): string {
  if (typeof value !== "string") throw new Error("invalid_cleaning_quote_input");
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (normalized.length > max || (required && !normalized)) throw new Error("invalid_cleaning_quote_input");
  return normalized;
}

function day(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("invalid_cleaning_quote_input");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error("invalid_cleaning_quote_input");
  return value;
}

function safeId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function normalizeCompany(value: unknown): Record<string, string> {
  if (!isRecord(value)) throw new Error("invalid_cleaning_quote_input");
  const allowed = new Set(["businessName", "representative", "registrationNumber", "address", "phone", "fax", "businessType", "businessCategory"]);
  if (Object.keys(value).some(key => !allowed.has(key))) throw new Error("invalid_cleaning_quote_input");
  const company: Record<string, string> = {};
  for (const key of allowed) company[key] = text(value[key] === undefined ? "" : value[key], key === "address" ? 240 : 100);
  if (company.registrationNumber && !/^\d{3}-\d{2}-\d{5}$/.test(company.registrationNumber)) throw new Error("invalid_cleaning_quote_input");
  return company;
}

export function normalizeCleaningQuoteSnapshot(value: unknown): CleaningQuoteSnapshot {
  if (!isRecord(value)) throw new Error("invalid_cleaning_quote_input");
  const allowed = new Set(["quoteDate", "validUntil", "recipient", "recipientPhone", "siteAddress", "projectName", "service", "summary", "items", "taxIncluded", "notes", "company"]);
  if (Object.keys(value).some(key => !allowed.has(key))) throw new Error("invalid_cleaning_quote_input");
  const quoteDate = day(value.quoteDate);
  const validUntil = day(value.validUntil);
  if (validUntil < quoteDate) throw new Error("invalid_cleaning_quote_input");
  if (!Array.isArray(value.items) || value.items.length < 1 || value.items.length > 8) throw new Error("invalid_cleaning_quote_input");
  const itemKeys = new Set(["name", "detail", "quantity", "unit", "unitPrice", "note"]);
  const items = value.items.map(item => {
    if (!isRecord(item) || Object.keys(item).some(key => !itemKeys.has(key))) throw new Error("invalid_cleaning_quote_input");
    const quantity = item.quantity;
    const unitPrice = item.unitPrice;
    if (!Number.isSafeInteger(quantity) || Number(quantity) < 1 || Number(quantity) > 999
      || !Number.isSafeInteger(unitPrice) || Number(unitPrice) < 1 || Number(unitPrice) > MAX_AMOUNT) {
      throw new Error("invalid_cleaning_quote_input");
    }
    return {
      name: text(item.name, 80, true),
      detail: text(item.detail, 240),
      quantity: Number(quantity),
      unit: text(item.unit, 12, true),
      unitPrice: Number(unitPrice),
      note: text(item.note === undefined ? "" : item.note, 100),
    };
  });
  const rawTotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  if (!Number.isSafeInteger(rawTotal) || rawTotal < 1 || rawTotal > MAX_AMOUNT) throw new Error("invalid_cleaning_quote_input");
  if (typeof value.taxIncluded !== "boolean") throw new Error("invalid_cleaning_quote_input");
  const supplyAmount = value.taxIncluded ? Math.round(rawTotal / 1.1) : rawTotal;
  const vatAmount = value.taxIncluded ? rawTotal - supplyAmount : Math.round(rawTotal * 0.1);
  const notes = value.notes === undefined ? [] : value.notes;
  if (!Array.isArray(notes) || notes.length > 4) throw new Error("invalid_cleaning_quote_input");
  const recipientPhone = text(value.recipientPhone, 30);
  if (recipientPhone && !/^[0-9+()\-\s]{8,30}$/.test(recipientPhone)) throw new Error("invalid_cleaning_quote_input");
  return {
    quoteDate,
    validUntil,
    recipient: text(value.recipient, 80, true),
    recipientPhone,
    siteAddress: text(value.siteAddress, 240),
    projectName: text(value.projectName, 120, true),
    service: text(value.service, 60, true),
    summary: text(value.summary, 500, true),
    items,
    totalAmount: rawTotal,
    supplyAmount,
    vatAmount,
    taxIncluded: value.taxIncluded,
    notes: notes.map(item => text(item, 180, true)),
    company: normalizeCompany(value.company),
  };
}

function canonicalTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function safeActor(actor: unknown): actor is CleaningOrderActor {
  return isRecord(actor) && typeof actor.uid === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(actor.uid)
    && !["__proto__", "prototype", "constructor"].includes(actor.uid)
    && (actor.role === "admin" || actor.role === "member");
}

export interface CleaningQuoteCreateDependencies {
  now(): string;
  readOrder(orderId: string): Promise<unknown | null>;
  readQuoteSet(orderId: string): Promise<unknown | null>;
  createRevisionIfCurrent(orderId: string, expectedRevision: number, quote: CleaningQuoteRecord): Promise<{
    quote: CleaningQuoteRecord | null;
    latestRevision: number;
    created: boolean;
  }>;
}

export async function createCleaningQuoteRevisionCore(
  raw: unknown,
  actor: unknown,
  dependencies: CleaningQuoteCreateDependencies,
): Promise<{ quote: CleaningQuoteRecord; replayed: boolean }> {
  if (!isRecord(raw) || Object.keys(raw).some(key => !["requestId", "orderId", "expectedRevision", "quote"].includes(key))
    || !safeId(raw.requestId) || !safeId(raw.orderId) || !Number.isSafeInteger(raw.expectedRevision)
    || Number(raw.expectedRevision) < 0 || Number(raw.expectedRevision) >= MAX_REVISIONS) {
    throw new Error("invalid_cleaning_quote_input");
  }
  if (!safeActor(actor)) throw new Error("cleaning_quote_forbidden");
  if (!isRecord(dependencies) || typeof dependencies.now !== "function" || typeof dependencies.readOrder !== "function"
    || typeof dependencies.readQuoteSet !== "function" || typeof dependencies.createRevisionIfCurrent !== "function") {
    throw new Error("cleaning_quote_runtime_invalid");
  }
  const snapshot = normalizeCleaningQuoteSnapshot(raw.quote);
  const [order, quoteSet] = await Promise.all([dependencies.readOrder(raw.orderId), dependencies.readQuoteSet(raw.orderId)]);
  if (order === null || order === undefined) throw new Error("cleaning_quote_order_not_found");
  if (!validateStoredCleaningOrder(order, raw.orderId)) throw new Error("cleaning_quote_stored_data_invalid");
  if (!isRecord(order) || typeof order.buildingId !== "string" || !order.buildingId) {
    throw new Error("cleaning_quote_order_not_found");
  }
  const current = isRecord(quoteSet) ? quoteSet : null;
  const latestRevision = current && Number.isSafeInteger(current.latestRevision) ? Number(current.latestRevision) : 0;
  const latestQuoteId = current && typeof current.latestQuoteId === "string" ? current.latestQuoteId : "";
  const prior = current && isRecord(current.revisions) && isRecord(current.revisions[raw.requestId])
    ? current.revisions[raw.requestId] as unknown as CleaningQuoteRecord : null;
  if (prior && prior.createdByUid === actor.uid && prior.orderId === raw.orderId
    && sameQuoteSnapshot(snapshot, snapshotOf(prior))) return { quote: prior, replayed: true };
  if (order.status !== "quote_pending" && order.status !== "approval_pending") throw new Error("cleaning_quote_order_not_ready");
  if (latestRevision !== Number(raw.expectedRevision)) {
    throw new Error("cleaning_quote_revision_conflict");
  }
  if (latestRevision > 0 && !latestQuoteId) throw new Error("cleaning_quote_stored_data_invalid");
  const now = dependencies.now();
  if (!canonicalTimestamp(now)) throw new Error("cleaning_quote_timestamp_invalid");
  const quote: CleaningQuoteRecord = {
    ...snapshot,
    id: raw.requestId,
    orderId: raw.orderId,
    buildingId: order.buildingId,
    revision: latestRevision + 1,
    previousQuoteId: latestQuoteId,
    status: "pending_review",
    createdAt: now,
    createdByUid: actor.uid,
    reviewHistory: [],
  };
  const result = await dependencies.createRevisionIfCurrent(raw.orderId, latestRevision, quote);
  if (!isRecord(result) || !Number.isSafeInteger(result.latestRevision) || typeof result.created !== "boolean") throw new Error("cleaning_quote_write_failed");
  if (result.created && result.latestRevision === quote.revision && sameQuote(result.quote, quote)) return { quote, replayed: false };
  if (sameQuote(result.quote, quote)) return { quote: result.quote as CleaningQuoteRecord, replayed: true };
  throw new Error("cleaning_quote_revision_conflict");
}

function snapshotOf(quote: CleaningQuoteRecord): CleaningQuoteSnapshot {
  return {
    quoteDate: quote.quoteDate, validUntil: quote.validUntil, recipient: quote.recipient, recipientPhone: quote.recipientPhone,
    siteAddress: quote.siteAddress, projectName: quote.projectName, service: quote.service, summary: quote.summary,
    items: quote.items, totalAmount: quote.totalAmount, supplyAmount: quote.supplyAmount, vatAmount: quote.vatAmount,
    taxIncluded: quote.taxIncluded, notes: quote.notes, company: quote.company,
  };
}

function sameQuote(existing: unknown, candidate: CleaningQuoteRecord): existing is CleaningQuoteRecord {
  return isRecord(existing) && existing.id === candidate.id && existing.orderId === candidate.orderId
    && existing.buildingId === candidate.buildingId && existing.revision === candidate.revision
    && existing.createdByUid === candidate.createdByUid
    && sameQuoteSnapshot(snapshotOf(existing as unknown as CleaningQuoteRecord), snapshotOf(candidate));
}

function sameQuoteSnapshot(left: unknown, right: unknown): boolean {
  const canonicalize = (value: unknown): CleaningQuoteSnapshot | null => {
    if (!isRecord(value)) return null;
    try {
      return normalizeCleaningQuoteSnapshot({
        quoteDate: value.quoteDate,
        validUntil: value.validUntil,
        recipient: value.recipient,
        recipientPhone: value.recipientPhone,
        siteAddress: value.siteAddress,
        projectName: value.projectName,
        service: value.service,
        summary: value.summary,
        items: value.items,
        taxIncluded: value.taxIncluded,
        notes: value.notes ?? [],
        company: value.company,
      });
    } catch {
      return null;
    }
  };
  const normalizedLeft = canonicalize(left);
  const normalizedRight = canonicalize(right);
  return normalizedLeft !== null && normalizedRight !== null
    && JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

export interface CleaningQuoteReviewDependencies {
  now(): string;
  readQuoteSet(orderId: string): Promise<unknown | null>;
  reviewLatestRevisionIfCurrent(orderId: string, expectedRevision: number, quoteId: string, event: CleaningQuoteReviewEvent): Promise<{
    quote: CleaningQuoteRecord | null;
    latestRevision: number;
    updated: boolean;
  }>;
}

export async function reviewCleaningQuoteCore(
  raw: unknown,
  actor: unknown,
  dependencies: CleaningQuoteReviewDependencies,
): Promise<{ quote: CleaningQuoteRecord; replayed: boolean }> {
  if (!isRecord(raw) || Object.keys(raw).some(key => !["requestId", "orderId", "quoteId", "expectedRevision", "action", "note"].includes(key))
    || !safeId(raw.requestId) || !safeId(raw.orderId) || !safeId(raw.quoteId)
    || !Number.isSafeInteger(raw.expectedRevision) || Number(raw.expectedRevision) < 1
    || (raw.action !== "approve" && raw.action !== "return") || typeof raw.note !== "string" || raw.note.length > 500
    || (raw.action === "return" && !raw.note.trim())) throw new Error("invalid_cleaning_quote_input");
  const note = raw.note.trim();
  if (!isRecord(actor) || actor.role !== "admin" || !safeActor(actor)) throw new Error("cleaning_quote_forbidden");
  if (!isRecord(dependencies) || typeof dependencies.now !== "function" || typeof dependencies.readQuoteSet !== "function"
    || typeof dependencies.reviewLatestRevisionIfCurrent !== "function") throw new Error("cleaning_quote_runtime_invalid");
  const set = await dependencies.readQuoteSet(raw.orderId);
  if (!isRecord(set) || set.orderId !== raw.orderId || !isRecord(set.revisions)) throw new Error("cleaning_quote_not_found");
  const revision = set.revisions[raw.quoteId];
  if (!isRecord(revision) || revision.orderId !== raw.orderId || revision.id !== raw.quoteId) throw new Error("cleaning_quote_not_found");
  const events = Array.isArray(revision.reviewHistory) ? revision.reviewHistory.filter(isRecord) : [];
  const previous = events.find(event => event.requestId === raw.requestId);
  if (previous) {
    if (previous.action === raw.action && previous.changedByUid === actor.uid && previous.note === note) {
      return { quote: revision as unknown as CleaningQuoteRecord, replayed: true };
    }
    throw new Error("cleaning_quote_request_conflict");
  }
  if (set.latestRevision !== raw.expectedRevision || set.latestQuoteId !== raw.quoteId || revision.revision !== raw.expectedRevision
    || revision.status !== "pending_review") throw new Error("cleaning_quote_revision_conflict");
  if (events.length >= MAX_HISTORY) throw new Error("cleaning_quote_history_limit");
  const now = dependencies.now();
  if (!canonicalTimestamp(now)) throw new Error("cleaning_quote_timestamp_invalid");
  const event: CleaningQuoteReviewEvent = { requestId: raw.requestId, action: raw.action, changedAt: now, changedByUid: actor.uid, note };
  const result = await dependencies.reviewLatestRevisionIfCurrent(raw.orderId, Number(raw.expectedRevision), raw.quoteId, event);
  if (!isRecord(result) || typeof result.updated !== "boolean" || !Number.isSafeInteger(result.latestRevision)) throw new Error("cleaning_quote_write_failed");
  if (result.updated && isRecord(result.quote) && result.latestRevision === raw.expectedRevision) return { quote: result.quote as unknown as CleaningQuoteRecord, replayed: false };
  if (isRecord(result.quote)) {
    const repeated = Array.isArray(result.quote.reviewHistory) && result.quote.reviewHistory.some(item => isRecord(item)
      && item.requestId === raw.requestId && item.action === raw.action && item.changedByUid === actor.uid && item.note === note);
    if (repeated) return { quote: result.quote as unknown as CleaningQuoteRecord, replayed: true };
  }
  throw new Error("cleaning_quote_revision_conflict");
}
