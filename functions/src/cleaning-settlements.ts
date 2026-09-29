import { validateCleaningPartnerDispatch } from "./cleaning-partners/core.js";

export type CleaningSettlementCheck = "verified" | "unavailable";

export interface CleaningSettlementWorkItem {
  orderId: string;
  desiredDate: string;
  supplierAmount: number;
}

export interface CleaningSettlementPartnerReview {
  vendorId: string;
  vendorName: string;
  completedWorkCount: number;
  grossSupplierAmount: number;
  workItems: CleaningSettlementWorkItem[];
  checks: {
    workCompletion: CleaningSettlementCheck;
    customerInspection: CleaningSettlementCheck;
    csHold: CleaningSettlementCheck;
    payoutAccount: CleaningSettlementCheck;
    taxInvoice: CleaningSettlementCheck;
  };
  finalPayoutAmount: null;
  payoutEnabled: false;
}

export interface CleaningSettlementReviewInput {
  fromDate: string;
  toDate: string;
  orders: unknown;
  dispatches: unknown;
  vendors: unknown;
}

export interface CleaningSettlementReview {
  fromDate: string;
  toDate: string;
  completedWorkCount: number;
  grossSupplierAmount: number;
  excludedWorkCount: number;
  partners: CleaningSettlementPartnerReview[];
  payoutEnabled: false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function buildCleaningSettlementReview(input: CleaningSettlementReviewInput): CleaningSettlementReview {
  if (!isRecord(input) || !validDay(input.fromDate) || !validDay(input.toDate) || input.fromDate > input.toDate) {
    throw new Error("invalid_cleaning_settlement_period");
  }
  if (!isRecord(input.orders) || !isRecord(input.dispatches) || !isRecord(input.vendors)) {
    throw new Error("cleaning_settlement_source_invalid");
  }

  const grouped = new Map<string, CleaningSettlementPartnerReview>();
  let excludedWorkCount = 0;

  for (const [orderId, rawOrder] of Object.entries(input.orders)) {
    if (!isRecord(rawOrder) || rawOrder.id !== orderId || rawOrder.requestId !== orderId
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(orderId)
      || rawOrder.status !== "completed" || !validDay(rawOrder.desiredDate)
      || rawOrder.desiredDate < input.fromDate || rawOrder.desiredDate > input.toDate) continue;

    const dispatch = input.dispatches[orderId];
    if (!validateCleaningPartnerDispatch(dispatch, orderId) || !dispatch.acceptedOfferId) {
      excludedWorkCount += 1;
      continue;
    }
    const acceptedOffer = dispatch.offers.find(offer => offer.id === dispatch.acceptedOfferId && offer.status === "accepted");
    const vendor = acceptedOffer && input.vendors[acceptedOffer.vendorId];
    if (!acceptedOffer || acceptedOffer.progress !== "completed" || !vendor || !isRecord(vendor)
      || vendor.id !== acceptedOffer.vendorId || typeof vendor.name !== "string" || !vendor.name.trim()
      || !Number.isSafeInteger(acceptedOffer.supplierAmount) || acceptedOffer.supplierAmount <= 0) {
      excludedWorkCount += 1;
      continue;
    }

    let partner = grouped.get(acceptedOffer.vendorId);
    if (!partner) {
      partner = {
        vendorId: acceptedOffer.vendorId,
        vendorName: vendor.name.trim(),
        completedWorkCount: 0,
        grossSupplierAmount: 0,
        workItems: [],
        checks: {
          workCompletion: "verified",
          customerInspection: "unavailable",
          csHold: "unavailable",
          payoutAccount: "unavailable",
          taxInvoice: "unavailable",
        },
        finalPayoutAmount: null,
        payoutEnabled: false,
      };
      grouped.set(partner.vendorId, partner);
    }
    partner.completedWorkCount += 1;
    partner.grossSupplierAmount += acceptedOffer.supplierAmount;
    if (!Number.isSafeInteger(partner.grossSupplierAmount)) throw new Error("cleaning_settlement_total_overflow");
    partner.workItems.push({ orderId, desiredDate: rawOrder.desiredDate, supplierAmount: acceptedOffer.supplierAmount });
  }

  const partners = [...grouped.values()].sort((a, b) => b.grossSupplierAmount - a.grossSupplierAmount
    || a.vendorName.localeCompare(b.vendorName, "ko-KR"));
  for (const partner of partners) {
    partner.workItems.sort((a, b) => b.desiredDate.localeCompare(a.desiredDate) || a.orderId.localeCompare(b.orderId));
  }

  const completedWorkCount = partners.reduce((total, partner) => total + partner.completedWorkCount, 0);
  const grossSupplierAmount = partners.reduce((total, partner) => total + partner.grossSupplierAmount, 0);
  if (!Number.isSafeInteger(grossSupplierAmount)) throw new Error("cleaning_settlement_total_overflow");

  return { fromDate: input.fromDate, toDate: input.toDate, completedWorkCount, grossSupplierAmount,
    excludedWorkCount, partners, payoutEnabled: false };
}
