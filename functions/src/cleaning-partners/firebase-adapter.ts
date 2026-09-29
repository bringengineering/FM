import type { CleaningDelayActionInput, CleaningDelayIncidentInput, CleaningExtraChargeRequest, CleaningPartnerAccountBinding, CleaningPartnerDispatchRecord, CleaningPartnerOffer } from "./contracts.js";
import {
  createCleaningReworkRequest,
  recordCleaningReworkCompletion,
  recordCleaningReworkPartnerResponse,
  recordCleaningReworkProgress,
  validateCleaningReworkRequest,
  type CleaningReworkRequest,
} from "./rework.js";
import { validateStoredCleaningOrder } from "../cleaning-orders/core.js";
import {
  addCleaningPartnerOffer,
  advanceCleaningPartnerProgress,
  bindCleaningPartnerAccount,
  createCleaningPartnerOffer,
  createCleaningExtraChargeRequest,
  decideCleaningPartnerOfferResponse,
  expireCleaningPartnerOffer,
  normalizeCleaningPartnerEmail,
  normalizeCleaningPartnerOfferInput,
  recordCleaningExtraChargeDecision,
  recordCleaningExtraChargeDelivery,
  validateCleaningExtraChargeRequest,
  validateCleaningPartnerDispatch,
} from "./core.js";
import { recordCleaningDelayAction as applyCleaningDelayAction, recordCleaningDelayIncident as applyCleaningDelayIncident } from "./operations.js";

interface SnapshotLike { val(): unknown }
interface TransactionLike { committed: boolean; snapshot: SnapshotLike }
interface QueryLike {
  equalTo(value: string): QueryLike;
  limitToLast?(count: number): QueryLike;
  get(): Promise<SnapshotLike>;
}
interface ReferenceLike {
  get(): Promise<SnapshotLike>;
  orderByChild(path: string): QueryLike;
  transaction(update: (current: unknown) => unknown, onComplete?: undefined, applyLocally?: boolean): Promise<TransactionLike>;
}
export interface CleaningPartnerDatabaseLike { ref(path: string): ReferenceLike }

export interface CleaningPartnerOfferResponseInput {
  offerId: string;
  action: "accept" | "decline";
  reason: string;
}

export interface CleaningExtraChargeRequestInput {
  requestId: string; orderId: string; customerId: string; buildingId: string; vendorId: string;
  serviceType: string; amount: number; reason: string; evidenceFileIds: string[];
}

export interface CleaningExtraChargeDecisionInput {
  orderId: string; requestId: string; expectedRevision: number; decision: "approve" | "decline"; evidenceRef: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function safeReworkPathIds(orderId: unknown, requestId: unknown): orderId is string {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  return typeof orderId === "string" && uuid.test(orderId) && typeof requestId === "string" && uuid.test(requestId);
}

function verifiedDrivePhoto(value: unknown): value is Record<string, unknown> & { driveFileId: string } {
  if (!isRecord(value) || typeof value.driveFileId !== "string" || !/^[A-Za-z0-9_-]{6,200}$/u.test(value.driveFileId)
    || typeof value.webViewLink !== "string") return false;
  try {
    const url = new URL(value.webViewLink);
    const linkId = url.searchParams.get("id") || /\/d\/([A-Za-z0-9_-]{6,200})(?:\/|$)/u.exec(url.pathname)?.[1];
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && ["drive.google.com", "docs.google.com"].includes(url.hostname) && linkId === value.driveFileId;
  } catch { return false; }
}

function readOffers(dispatches: unknown, vendorId: string): CleaningPartnerOffer[] {
  if (!isRecord(dispatches)) return [];
  const offers: CleaningPartnerOffer[] = [];
  for (const value of Object.values(dispatches)) {
    if (!isRecord(value) || !Array.isArray(value.offers)) continue;
    for (const offer of value.offers) {
      if (isRecord(offer) && offer.vendorId === vendorId) offers.push(offer as unknown as CleaningPartnerOffer);
    }
  }
  return offers.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
}

export function createCleaningPartnerFirebaseDependencies(
  database: CleaningPartnerDatabaseLike,
  now: () => string = () => new Date().toISOString(),
  verifyImageFileIds: (fileIds: string[]) => Promise<string[]> = async fileIds => fileIds,
  readImageFile: (fileId: string) => Promise<{ mimeType: string; base64: string } | null> = async () => null,
) {
  async function accountForEmail(emailValue: unknown): Promise<CleaningPartnerAccountBinding | null> {
    const email = normalizeCleaningPartnerEmail(emailValue);
    if (!email) return null;
    const accountsRef = database.ref("crmCompany/cleaningPartnerAccounts");
    const snapshot = await accountsRef.orderByChild("email").equalTo(email).get();
    const records = snapshot.val();
    if (!isRecord(records)) return null;
    const matches = Object.values(records).filter(value => isRecord(value) && value.email === email && value.enabled === true);
    return matches.length === 1 ? matches[0] as unknown as CleaningPartnerAccountBinding : null;
  }

  return {
    async readCleaningReworkRequests(orderIdValue: string): Promise<CleaningReworkRequest[]> {
      if (typeof orderIdValue !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(orderIdValue)) return [];
      const snapshot = await database.ref(`crmCompany/cleaningReworkRequests/${orderIdValue}`).get();
      const records = snapshot.val();
      if (!isRecord(records)) return [];
      const requests = Object.values(records).filter(validateCleaningReworkRequest);
      if (requests.length !== Object.keys(records).length) throw new Error("cleaning_rework_stored_data_invalid");
      return requests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async createCleaningReworkRequest(inputValue: unknown, actorUid: string) {
      const normalized = createCleaningReworkRequest(inputValue, actorUid, now());
      if (!normalized.ok) return normalized;
      const request = normalized.request;
      let verifiedFileIds: string[];
      try { verifiedFileIds = await verifyImageFileIds(request.customerPhotoFileIds); }
      catch { return { ok: false as const, error: "cleaning_rework_evidence_invalid" }; }
      if (verifiedFileIds.length !== request.customerPhotoFileIds.length
        || verifiedFileIds.some((id, index) => id !== request.customerPhotoFileIds[index])) {
        return { ok: false as const, error: "cleaning_rework_evidence_invalid" };
      }
      const [orderSnapshot, customerSnapshot, buildingSnapshot, dispatchSnapshot] = await Promise.all([
        database.ref(`crmCompany/cleaningOrders/${request.orderId}`).get(),
        database.ref(`crmCompany/data/customers/${request.customerId}`).get(),
        database.ref(`crmCompany/data/buildings/${request.buildingId}`).get(),
        database.ref(`crmCompany/cleaningPartnerDispatches/${request.orderId}`).get(),
      ]);
      const order = orderSnapshot.val();
      const customer = customerSnapshot.val();
      const building = buildingSnapshot.val();
      const dispatch = dispatchSnapshot.val();
      if (!validateStoredCleaningOrder(order, request.orderId) || order.status !== "completed"
        || order.customerId !== request.customerId || order.buildingId !== request.buildingId
        || !isRecord(customer) || customer.id !== request.customerId || !isRecord(building) || building.id !== request.buildingId
        || !(isRecord(customer.buildingIdLinks) && customer.buildingIdLinks[request.buildingId] === true || building.customerId === request.customerId)
        || !validateCleaningPartnerDispatch(dispatch, request.orderId) || !dispatch.acceptedOfferId) {
        return { ok: false as const, error: "cleaning_rework_order_context_invalid" };
      }
      const accepted = dispatch.offers.find(offer => offer.id === dispatch.acceptedOfferId && offer.status === "accepted");
      if (!accepted || accepted.vendorId !== request.vendorId || accepted.progress !== "completed") {
        return { ok: false as const, error: "cleaning_rework_partner_context_invalid" };
      }
      const collection = database.ref(`crmCompany/cleaningReworkRequests/${request.orderId}`);
      let transactionError = "";
      const saved = await collection.transaction(current => {
        if (current !== null && !isRecord(current)) { transactionError = "cleaning_rework_stored_data_invalid"; return undefined; }
        const records = isRecord(current) ? current : {};
        if (Object.keys(records).length >= 50) { transactionError = "cleaning_rework_limit_reached"; return undefined; }
        if (Object.hasOwn(records, request.requestId)) { transactionError = "cleaning_rework_conflict"; return undefined; }
        return { ...records, [request.requestId]: request };
      }, undefined, false);
      if (!saved.committed) return { ok: false as const, error: transactionError || "cleaning_rework_transaction_conflict" };
      return { ok: true as const, request };
    },
    async readCleaningReworksForEmail(emailValue: string) {
      const binding = await accountForEmail(emailValue);
      if (!binding) return { vendorId: "", requests: [] };
      const snapshot = await database.ref("crmCompany/cleaningReworkRequests").get();
      const source = snapshot.val();
      if (!isRecord(source)) return { vendorId: binding.vendorId, requests: [] };
      const requests: CleaningReworkRequest[] = [];
      for (const [orderId, rawRequests] of Object.entries(source)) {
        if (!isRecord(rawRequests)) throw new Error("cleaning_rework_stored_data_invalid");
        for (const raw of Object.values(rawRequests)) {
          if (!validateCleaningReworkRequest(raw)) throw new Error("cleaning_rework_stored_data_invalid");
          if (raw.orderId !== orderId) throw new Error("cleaning_rework_stored_data_invalid");
          if (raw.vendorId === binding.vendorId && ["requested", "accepted", "in_progress", "awaiting_review"].includes(raw.status)) requests.push(raw);
        }
      }
      return { vendorId: binding.vendorId, requests: requests.sort((a, b) => a.desiredAt.localeCompare(b.desiredAt)).slice(0, 100)
        .map(({ customerId: _customerId, buildingId: _buildingId, customerPhotoFileIds, customerNotice: _customerNotice, completionReportId: _completionReportId, createdByUid: _createdByUid, events: _events, ...safe }) => ({ ...safe, customerPhotoCount: customerPhotoFileIds.length })) };
    },
    async readCleaningReworkPhotoForEmail(emailValue: string, orderIdValue: string, requestIdValue: string, photoIndex: number) {
      if (!safeReworkPathIds(orderIdValue, requestIdValue) || !Number.isSafeInteger(photoIndex) || photoIndex < 0 || photoIndex > 7) return null;
      const binding = await accountForEmail(emailValue);
      if (!binding) return null;
      const snapshot = await database.ref(`crmCompany/cleaningReworkRequests/${orderIdValue}/${requestIdValue}`).get();
      const request = snapshot.val();
      if (!validateCleaningReworkRequest(request) || request.orderId !== orderIdValue || request.requestId !== requestIdValue
        || request.vendorId !== binding.vendorId || !["requested", "accepted", "in_progress", "awaiting_review"].includes(request.status)) return null;
      const fileId = request.customerPhotoFileIds[photoIndex];
      if (!fileId) return null;
      const verified = await verifyImageFileIds([fileId]);
      if (!Array.isArray(verified) || verified.length !== 1 || verified[0] !== fileId) return null;
      const image = await readImageFile(fileId);
      if (!image || !["image/jpeg", "image/png", "image/webp"].includes(image.mimeType)
        || typeof image.base64 !== "string" || image.base64.length > 10_000_000
        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(image.base64)) return null;
      return image;
    },
    async respondToCleaningRework(input: { orderId: string; requestId: string; expectedRevision: number; action: "accept" | "decline"; reason: string }, actorUid: string, vendorId: string) {
      if (!safeReworkPathIds(input?.orderId, input?.requestId)) return { ok: false as const, error: "invalid_cleaning_rework_input" };
      const path = `crmCompany/cleaningReworkRequests/${input.orderId}/${input.requestId}`;
      let decisionError = "";
      const saved = await database.ref(path).transaction(current => {
        const decision = recordCleaningReworkPartnerResponse(current, { ...input, vendorId, actorUid, now: now() });
        if (!decision.ok) { decisionError = decision.error; return undefined; }
        return decision.request;
      }, undefined, false);
      if (!saved.committed) return { ok: false as const, error: decisionError || "cleaning_rework_not_found" };
      return { ok: true as const, request: saved.snapshot.val() as CleaningReworkRequest };
    },
    async updateCleaningReworkProgress(input: { orderId: string; requestId: string; expectedRevision: number; nextStatus: "in_progress" | "awaiting_review" }, actorUid: string, vendorId: string) {
      if (!safeReworkPathIds(input?.orderId, input?.requestId)) return { ok: false as const, error: "invalid_cleaning_rework_input" };
      const path = `crmCompany/cleaningReworkRequests/${input.orderId}/${input.requestId}`;
      let decisionError = "";
      const saved = await database.ref(path).transaction(current => {
        const decision = recordCleaningReworkProgress(current, { ...input, vendorId, actorUid, now: now() });
        if (!decision.ok) { decisionError = decision.error; return undefined; }
        return decision.request;
      }, undefined, false);
      if (!saved.committed) return { ok: false as const, error: decisionError || "cleaning_rework_not_found" };
      return { ok: true as const, request: saved.snapshot.val() as CleaningReworkRequest };
    },
    async completeCleaningRework(input: { orderId: string; requestId: string; expectedRevision: number; reportId: string }, actorUid: string) {
      if (!safeReworkPathIds(input?.orderId, input?.requestId) || typeof input.reportId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/u.test(input.reportId)) {
        return { ok: false as const, error: "invalid_cleaning_rework_input" };
      }
      const requestPath = `crmCompany/cleaningReworkRequests/${input.orderId}/${input.requestId}`;
      const requestSnapshot = await database.ref(requestPath).get();
      const existing = requestSnapshot.val();
      if (!validateCleaningReworkRequest(existing)) return { ok: false as const, error: "cleaning_rework_not_found" };
      const reportSnapshot = await database.ref(`crmCompany/workReports/${input.reportId}`).get();
      const report = reportSnapshot.val();
      const itemKeys: Record<string, string[]> = { window: ["window"], kitchen: ["kitchen"], bathroom: ["bath"], floor: ["floor"], other: ["scope", "after"] };
      const requiredKeys = existing.areas.flatMap(area => itemKeys[area]);
      const photoKeys = existing.areas.flatMap(area => area === "other" ? ["after"] : itemKeys[area]);
      const items = isRecord(report) && Array.isArray(report.items) ? report.items : [];
      const matched = requiredKeys.length > 0 && requiredKeys.every(key => items.some(item => isRecord(item) && item.key === key && item.status === "done"))
        && photoKeys.every(key => {
          const item = items.find(candidate => isRecord(candidate) && candidate.key === key && candidate.status === "done");
          if (!isRecord(item) || !Array.isArray(item.before) || !Array.isArray(item.after)) return false;
          const beforeIds = item.before.filter(verifiedDrivePhoto).map(photo => photo.driveFileId);
          const afterIds = item.after.filter(verifiedDrivePhoto).map(photo => photo.driveFileId);
          return beforeIds.length > 0 && afterIds.length > 0 && beforeIds.some(beforeId => afterIds.some(afterId => beforeId !== afterId));
        });
      if (!isRecord(report) || report.id !== input.reportId || report.cleaningOrderId !== existing.orderId
        || report.buildingId !== existing.buildingId || !canonicalTimestamp(report.updatedAt) || report.updatedAt <= existing.createdAt
        || !matched) return { ok: false as const, error: "cleaning_rework_completion_evidence_required" };
      const photoIds = new Set<string>();
      for (const rawItem of items) {
        if (!isRecord(rawItem) || !requiredKeys.includes(String(rawItem.key))) continue;
        for (const photos of [rawItem.before, rawItem.after]) if (Array.isArray(photos)) for (const rawPhoto of photos) {
          if (verifiedDrivePhoto(rawPhoto)) photoIds.add(rawPhoto.driveFileId);
        }
      }
      let verified: string[];
      try { verified = await verifyImageFileIds([...photoIds]); }
      catch { return { ok: false as const, error: "cleaning_rework_completion_evidence_required" }; }
      if (!verified || verified.length !== photoIds.size || verified.some(id => !photoIds.has(id))) {
        return { ok: false as const, error: "cleaning_rework_completion_evidence_required" };
      }
      let decisionError = "";
      const saved = await database.ref(requestPath).transaction(current => {
        const decision = recordCleaningReworkCompletion(current, { actorUid, expectedRevision: input.expectedRevision, reportId: input.reportId, now: now() });
        if (!decision.ok) { decisionError = decision.error; return undefined; }
        return decision.request;
      }, undefined, false);
      if (!saved.committed) return { ok: false as const, error: decisionError || "cleaning_rework_not_found" };
      return { ok: true as const, request: saved.snapshot.val() as CleaningReworkRequest };
    },
    async readExtraChargeRequests(orderIdValue: string): Promise<CleaningExtraChargeRequest[]> {
      if (typeof orderIdValue !== "string" || !/^[0-9a-f-]{36}$/iu.test(orderIdValue)) return [];
      const snapshot = await database.ref(`crmCompany/cleaningPartnerExtraCharges/${orderIdValue}`).get();
      const records = snapshot.val();
      if (!isRecord(records)) return [];
      return Object.values(records).filter(validateCleaningExtraChargeRequest);
    },
    async createExtraChargeRequest(inputValue: unknown, actorUid: string) {
      const normalized = createCleaningExtraChargeRequest(inputValue, actorUid, now());
      if (!normalized.ok) return normalized;
      const input = normalized.request;
      let verifiedFileIds: string[];
      try { verifiedFileIds = await verifyImageFileIds(input.evidenceFileIds); }
      catch { return { ok: false as const, error: "cleaning_extra_charge_evidence_invalid" }; }
      if (verifiedFileIds.length !== input.evidenceFileIds.length
        || verifiedFileIds.some((fileId, index) => fileId !== input.evidenceFileIds[index])) {
        return { ok: false as const, error: "cleaning_extra_charge_evidence_invalid" };
      }
      const [orderSnapshot, customerSnapshot, buildingSnapshot, vendorSnapshot, dispatchSnapshot] = await Promise.all([
        database.ref(`crmCompany/cleaningOrders/${input.orderId}`).get(),
        database.ref(`crmCompany/data/customers/${input.customerId}`).get(),
        database.ref(`crmCompany/data/buildings/${input.buildingId}`).get(),
        database.ref(`crmCompany/data/partnerVendors/${input.vendorId}`).get(),
        database.ref(`crmCompany/cleaningPartnerDispatches/${input.orderId}`).get(),
      ]);
      const order = orderSnapshot.val();
      const customer = customerSnapshot.val();
      const building = buildingSnapshot.val();
      const vendor = vendorSnapshot.val();
      const dispatch = dispatchSnapshot.val();
      if (!isRecord(order) || order.id !== input.orderId || order.status !== "in_progress"
        || order.customerId !== input.customerId || order.buildingId !== input.buildingId
        || !isRecord(customer) || customer.id !== input.customerId || !isRecord(building) || building.id !== input.buildingId
        || !(isRecord(customer.buildingIdLinks) && customer.buildingIdLinks[input.buildingId] === true || building.customerId === input.customerId)
        || !isRecord(vendor) || vendor.id !== input.vendorId || vendor.archived === true || vendor.deleted === true
        || !validateCleaningPartnerDispatch(dispatch, input.orderId) || !dispatch.acceptedOfferId) {
        return { ok: false as const, error: "cleaning_extra_charge_order_context_invalid" };
      }
      const accepted = dispatch.offers.find(offer => offer.id === dispatch.acceptedOfferId && offer.status === "accepted");
      if (!accepted || accepted.vendorId !== input.vendorId || !["arrived", "started", "photos_submitted"].includes(accepted.progress)) {
        return { ok: false as const, error: "cleaning_extra_charge_partner_not_on_site" };
      }
      const reference = database.ref(`crmCompany/cleaningPartnerExtraCharges/${input.orderId}`);
      let decisionError = "";
      const result = await reference.transaction(current => {
        if (current !== null && !isRecord(current)) { decisionError = "cleaning_extra_charge_data_invalid"; return undefined; }
        const existing = isRecord(current) ? current[input.requestId] : undefined;
        if (existing !== undefined) { decisionError = "cleaning_extra_charge_conflict"; return undefined; }
        return { ...(isRecord(current) ? current : {}), [input.requestId]: input };
      }, undefined, false);
      if (!result.committed) return { ok: false as const, error: decisionError || "cleaning_extra_charge_transaction_conflict" };
      return { ok: true as const, request: input };
    },
    async recordExtraChargeDelivery(input: { orderId: string; requestId: string; expectedRevision: number; messageDeliveryId: string }, actorUid: string) {
      if (typeof input.orderId !== "string" || typeof input.requestId !== "string" || typeof input.messageDeliveryId !== "string"
        || !/^[0-9a-f-]{36}$/iu.test(input.orderId) || !/^[0-9a-f-]{36}$/iu.test(input.requestId)
        || !/^[0-9a-f-]{36}$/iu.test(input.messageDeliveryId) || !Number.isSafeInteger(input.expectedRevision)) {
        return { ok: false as const, error: "invalid_cleaning_extra_charge_input" };
      }
      const [requestSnapshot, deliverySnapshot] = await Promise.all([
        database.ref(`crmCompany/cleaningPartnerExtraCharges/${input.orderId}/${input.requestId}`).get(),
        database.ref(`crmCompany/messageDeliveries/${input.messageDeliveryId}`).get(),
      ]);
      const request = requestSnapshot.val();
      const delivery = deliverySnapshot.val();
      if (!validateCleaningExtraChargeRequest(request) || !isRecord(delivery) || delivery.requestId !== input.messageDeliveryId
        || delivery.customerId !== request.customerId || delivery.sourceType !== "cleaningOrder" || delivery.sourceId !== input.orderId
        || delivery.category !== "cleaning_extra_charge_approval" || !["accepted", "failed"].includes(String(delivery.status))
        || typeof delivery.providerMessageId !== "string"
        || (delivery.status === "accepted") !== Boolean(delivery.providerMessageId)) {
        return { ok: false as const, error: "cleaning_extra_charge_delivery_unverified" };
      }
      const context = await readExtraChargeCanonicalContext(request);
      if (!context) return { ok: false as const, error: "cleaning_extra_charge_order_context_invalid" };
      let decisionError = "";
      const result = await database.ref(`crmCompany/cleaningPartnerExtraCharges/${input.orderId}/${input.requestId}`).transaction(current => {
        const decision = recordCleaningExtraChargeDelivery(current, {
          actorUid, expectedRevision: input.expectedRevision, result: delivery.status as "accepted" | "failed",
          providerMessageId: delivery.providerMessageId as string, now: now(),
        });
        if (!decision.ok) { decisionError = decision.error; return undefined; }
        return decision.request;
      }, undefined, false);
      if (!result.committed) return { ok: false as const, error: decisionError || "cleaning_extra_charge_transaction_conflict" };
      return { ok: true as const, request: result.snapshot.val() as CleaningExtraChargeRequest };
    },
    async recordExtraChargeDecision(input: CleaningExtraChargeDecisionInput, actorUid: string) {
      if (!input || typeof input.orderId !== "string" || typeof input.requestId !== "string"
        || !/^[0-9a-f-]{36}$/iu.test(input.orderId) || !/^[0-9a-f-]{36}$/iu.test(input.requestId)) {
        return { ok: false as const, error: "invalid_cleaning_extra_charge_input" };
      }
      const requestSnapshot = await database.ref(`crmCompany/cleaningPartnerExtraCharges/${input.orderId}/${input.requestId}`).get();
      const request = requestSnapshot.val();
      if (!validateCleaningExtraChargeRequest(request)) return { ok: false as const, error: "cleaning_extra_charge_not_found" };
      const context = await readExtraChargeCanonicalContext(request);
      if (!context) return { ok: false as const, error: "cleaning_extra_charge_order_context_invalid" };
      let decisionError = "";
      const result = await database.ref(`crmCompany/cleaningPartnerExtraCharges/${input.orderId}/${input.requestId}`).transaction(current => {
        const decision = recordCleaningExtraChargeDecision(current, { ...input, actorUid, now: now() });
        if (!decision.ok) { decisionError = decision.error; return undefined; }
        return decision.request;
      }, undefined, false);
      if (!result.committed) return { ok: false as const, error: decisionError || "cleaning_extra_charge_not_found" };
      return { ok: true as const, request: result.snapshot.val() as CleaningExtraChargeRequest };
    },
    async readDispatch(orderIdValue: string): Promise<CleaningPartnerDispatchRecord | null> {
      if (typeof orderIdValue !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(orderIdValue)) return null;
      const snapshot = await database.ref(`crmCompany/cleaningPartnerDispatches/${orderIdValue}`).get();
      const dispatch = snapshot.val();
      if (!isRecord(dispatch) || dispatch.orderId !== orderIdValue || !Array.isArray(dispatch.offers)) return null;
      return dispatch as unknown as CleaningPartnerDispatchRecord;
    },
    async recordDelayIncident(input: CleaningDelayIncidentInput, actorUid: string) {
      if (!input || typeof input.orderId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(input.orderId)) {
        return { ok: false as const, error: "invalid_cleaning_delay_input" };
      }
      const orderSnapshot = await database.ref(`crmCompany/cleaningOrders/${input.orderId}`).get();
      const order = orderSnapshot.val();
      if (!isRecord(order) || order.id !== input.orderId || !["scheduled", "in_progress"].includes(String(order.status))) {
        return { ok: false as const, error: "cleaning_delay_order_not_active" };
      }
      let decisionError = "";
      const result = await database.ref(`crmCompany/cleaningPartnerDispatches/${input.orderId}`).transaction(current => {
        const decision = applyCleaningDelayIncident(current, input, actorUid, now());
        if (!decision.ok) { decisionError = decision.error; return undefined; }
        return decision.dispatch;
      }, undefined, false);
      if (!result.committed) return { ok: false as const, error: decisionError || "cleaning_delay_transaction_conflict" };
      return { ok: true as const, dispatch: result.snapshot.val() as CleaningPartnerDispatchRecord };
    },
    async recordDelayAction(input: CleaningDelayActionInput, actorUid: string) {
      if (!input || typeof input.orderId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(input.orderId)) {
        return { ok: false as const, error: "invalid_cleaning_delay_input" };
      }
      const orderSnapshot = await database.ref(`crmCompany/cleaningOrders/${input.orderId}`).get();
      const order = orderSnapshot.val();
      if (!isRecord(order) || order.id !== input.orderId || !["scheduled", "in_progress"].includes(String(order.status))) {
        return { ok: false as const, error: "cleaning_delay_order_not_active" };
      }
      let decisionError = "";
      const result = await database.ref(`crmCompany/cleaningPartnerDispatches/${input.orderId}`).transaction(current => {
        const decision = applyCleaningDelayAction(current, input, actorUid, now());
        if (!decision.ok) { decisionError = decision.error; return undefined; }
        return decision.dispatch;
      }, undefined, false);
      if (!result.committed) return { ok: false as const, error: decisionError || "cleaning_delay_transaction_conflict" };
      return { ok: true as const, dispatch: result.snapshot.val() as CleaningPartnerDispatchRecord };
    },
    async expireOffer(input: { orderId: string; offerId: string; expectedRevision: number }, actorUid: string) {
      let decisionError = "";
      const result = await database.ref(`crmCompany/cleaningPartnerDispatches/${input.orderId}`).transaction(current => {
        const decision = expireCleaningPartnerOffer(current, { ...input, actorUid, now: now() });
        if (!decision.ok) { decisionError = decision.error; return undefined; }
        return decision.dispatch;
      }, undefined, false);
      if (!result.committed) return { ok: false as const, error: decisionError || "cleaning_partner_transaction_conflict" };
      return { ok: true as const, dispatch: result.snapshot.val() as CleaningPartnerDispatchRecord };
    },
    async expireDueOffers(orderId: string, actorUid: string): Promise<CleaningPartnerDispatchRecord | null> {
      let dispatch = await this.readDispatch(orderId);
      if (!dispatch) return null;
      for (const offer of dispatch.offers) {
        if (offer.status !== "offered" || Date.parse(offer.expiresAt) > Date.parse(now())) continue;
        const result = await this.expireOffer({ orderId, offerId: offer.id, expectedRevision: offer.revision }, actorUid);
        if (result.ok) dispatch = result.dispatch;
      }
      return dispatch;
    },
    async readAccountForEmail(emailValue: unknown) {
      return accountForEmail(emailValue);
    },
    async bindAccount(vendorId: string, email: unknown, enabled: boolean, actorUid: string) {
      const timestamp = now();
      const vendorSnapshot = await database.ref(`crmCompany/data/partnerVendors/${vendorId}`).get();
      const vendor = vendorSnapshot.val();
      if (!isRecord(vendor) || vendor.archived === true || vendor.deleted === true) {
        return { ok: false as const, error: "cleaning_partner_vendor_not_found" };
      }
      const reference = database.ref("crmCompany/cleaningPartnerAccounts");
      let decisionError = "";
      const result = await reference.transaction(current => {
        const decision = bindCleaningPartnerAccount(current ?? {}, vendorId, email, enabled, actorUid, timestamp);
        if (!decision.ok) { decisionError = decision.error; return undefined; }
        return decision.accounts;
      }, undefined, false);
      if (!result.committed) return { ok: false as const, error: decisionError || "cleaning_partner_transaction_conflict" };
      return { ok: true as const, binding: (result.snapshot.val() as Record<string, CleaningPartnerAccountBinding>)[vendorId] };
    },
    async readOffersForEmail(emailValue: unknown): Promise<CleaningPartnerOffer[]> {
      const account = await accountForEmail(emailValue);
      if (!account) return [];
      const snapshot = await database.ref("crmCompany/cleaningPartnerDispatches").get();
      return readOffers(snapshot.val(), account.vendorId);
    },
    async createOffer(inputValue: unknown, actorUid: string, reassignAccepted = false, reassignReason = "") {
      const normalized = normalizeCleaningPartnerOfferInput(inputValue);
      if (!normalized.ok) return normalized;
      const { value: input } = normalized;
      const [orderSnapshot, accountSnapshot] = await Promise.all([
        database.ref(`crmCompany/cleaningOrders/${input.orderId}`).get(),
        database.ref(`crmCompany/data/partnerVendors/${input.vendorId}`).get(),
      ]);
      const order = orderSnapshot.val();
      if (!isRecord(order) || order.id !== input.orderId) return { ok: false as const, error: "cleaning_partner_order_not_found" };
      const buildingSnapshot = await database.ref(`crmCompany/data/buildings/${String(order.buildingId || "")}`).get();
      const timestamp = now();
      const offer = createCleaningPartnerOffer(input, actorUid, order, buildingSnapshot.val(), timestamp);
      if (!offer) return { ok: false as const, error: "cleaning_partner_order_not_dispatchable" };
      const vendor = accountSnapshot.val();
      if (!isRecord(vendor) || vendor.archived === true || vendor.deleted === true) {
        return { ok: false as const, error: "cleaning_partner_vendor_not_found" };
      }
      const reference = database.ref(`crmCompany/cleaningPartnerDispatches/${input.orderId}`);
      let decisionError = "";
      const result = await reference.transaction(current => {
        const decision = addCleaningPartnerOffer(current, offer, actorUid, timestamp, reassignAccepted, reassignReason);
        if (!decision.ok) { decisionError = decision.error; return undefined; }
        return decision.dispatch;
      }, undefined, false);
      const dispatch = result.snapshot.val();
      if (!result.committed) return { ok: false as const, error: decisionError || "cleaning_partner_transaction_conflict" };
      return { ok: true as const, dispatch: dispatch as CleaningPartnerDispatchRecord };
    },
    async respond(input: CleaningPartnerOfferResponseInput, actorUid: string, vendorId: string) {
      const snapshot = await database.ref("crmCompany/cleaningPartnerDispatches").get();
      const dispatches = snapshot.val();
      if (!isRecord(dispatches)) return { ok: false as const, error: "cleaning_partner_offer_not_found" };
      const entry = Object.entries(dispatches).find(([, value]) => isRecord(value)
        && Array.isArray(value.offers) && value.offers.some(offer => isRecord(offer) && offer.id === input.offerId));
      if (!entry) return { ok: false as const, error: "cleaning_partner_offer_not_found" };
      const [orderId] = entry;
      let decisionError = "";
      const result = await database.ref(`crmCompany/cleaningPartnerDispatches/${orderId}`).transaction(current => {
        const decision = decideCleaningPartnerOfferResponse(current, {
          ...input,
          vendorId,
          actorUid,
          reason: input.action === "decline" ? input.reason : "",
          now: now(),
        });
        if (!decision.ok) { decisionError = decision.error; return undefined; }
        return decision.dispatch;
      }, undefined, false);
      if (!result.committed) return { ok: false as const, error: decisionError || "cleaning_partner_transaction_conflict" };
      return { ok: true as const, dispatch: result.snapshot.val() as CleaningPartnerDispatchRecord };
    },
    async advanceProgress(input: { offerId: string; nextProgress: string; expectedRevision: number }, actorUid: string, vendorId: string) {
      const snapshot = await database.ref("crmCompany/cleaningPartnerDispatches").get();
      const dispatches = snapshot.val();
      if (!isRecord(dispatches)) return { ok: false as const, error: "cleaning_partner_offer_not_found" };
      const entry = Object.entries(dispatches).find(([, value]) => isRecord(value)
        && Array.isArray(value.offers) && value.offers.some(offer => isRecord(offer) && offer.id === input.offerId));
      if (!entry) return { ok: false as const, error: "cleaning_partner_offer_not_found" };
      const [orderId] = entry;
      let decisionError = "";
      const result = await database.ref(`crmCompany/cleaningPartnerDispatches/${orderId}`).transaction(current => {
        const decision = advanceCleaningPartnerProgress(current, { ...input, actorUid, vendorId, now: now() });
        if (!decision.ok) { decisionError = decision.error; return undefined; }
        return decision.dispatch;
      }, undefined, false);
      if (!result.committed) return { ok: false as const, error: decisionError || "cleaning_partner_transaction_conflict" };
      return { ok: true as const, dispatch: result.snapshot.val() as CleaningPartnerDispatchRecord };
    },
  };

  async function readExtraChargeCanonicalContext(request: CleaningExtraChargeRequest): Promise<boolean> {
    const [orderSnapshot, customerSnapshot, buildingSnapshot, vendorSnapshot] = await Promise.all([
      database.ref(`crmCompany/cleaningOrders/${request.orderId}`).get(),
      database.ref(`crmCompany/data/customers/${request.customerId}`).get(),
      database.ref(`crmCompany/data/buildings/${request.buildingId}`).get(),
      database.ref(`crmCompany/data/partnerVendors/${request.vendorId}`).get(),
    ]);
    const order = orderSnapshot.val();
    const customer = customerSnapshot.val();
    const building = buildingSnapshot.val();
    const vendor = vendorSnapshot.val();
    return isRecord(order) && order.id === request.orderId && order.customerId === request.customerId
      && order.buildingId === request.buildingId
      && isRecord(customer) && customer.id === request.customerId
      && isRecord(building) && building.id === request.buildingId
      && (isRecord(customer.buildingIdLinks) && customer.buildingIdLinks[request.buildingId] === true || building.customerId === request.customerId)
      && isRecord(vendor) && vendor.id === request.vendorId && vendor.archived !== true && vendor.deleted !== true;
  }
}
