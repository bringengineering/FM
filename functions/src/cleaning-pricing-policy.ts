export const CLEANING_PRICE_BANDS = Object.freeze([
  { id: "up_to_18", label: "18평 이하", max: 18 },
  { id: "19_to_24", label: "19~24평", max: 24 },
  { id: "25_to_30", label: "25~30평", max: 30 },
  { id: "31_to_34", label: "31~34평", max: 34 },
  { id: "35_plus", label: "35평 이상", max: Number.POSITIVE_INFINITY },
]);

export const CLEANING_HOUSING_TYPES = Object.freeze([
  { id: "apartment", label: "아파트" },
  { id: "villa", label: "빌라 / 연립주택" },
  { id: "detached", label: "단독주택" },
]);

export interface CleaningPricingAddon {
  id: string;
  name: string;
  description: string;
  amount: number;
}

export interface CleaningPricingPolicy {
  policyId: string;
  name: string;
  region: string;
  effectiveFrom: string;
  publication: "draft" | "published";
  basePrices: Record<"apartment" | "villa" | "detached", number[]>;
  addOns: CleaningPricingAddon[];
  discountCaps: { promotion: number; membership: number };
}

export interface CleaningPricingPolicyRecord {
  policy: CleaningPricingPolicy;
  createdAt: string;
  createdByUid: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fail(): never {
  throw new Error("invalid_cleaning_pricing_policy");
}

function exactKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

function safeText(value: unknown, max: number, required = true): string {
  if (typeof value !== "string") return fail();
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (normalized.length > max || (required && !normalized)) return fail();
  return normalized;
}

function day(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fail();
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return fail();
  return value;
}

function amount(value: unknown, positive: boolean): number {
  if (!Number.isSafeInteger(value) || (positive ? Number(value) < 1 : Number(value) < 0) || Number(value) > 100_000_000) return fail();
  return Number(value);
}

export function normalizeCleaningPricingPolicy(value: unknown): CleaningPricingPolicy {
  if (!isRecord(value) || !exactKeys(value, ["policyId", "name", "region", "effectiveFrom", "publication", "basePrices", "addOns", "discountCaps"])) return fail();
  const policyId = safeText(value.policyId, 120);
  if (!/^[A-Za-z0-9_-]+$/.test(policyId)) return fail();
  const publication = value.publication;
  if (publication !== "draft" && publication !== "published") return fail();
  const rawPrices = value.basePrices;
  if (!isRecord(rawPrices) || !exactKeys(rawPrices, CLEANING_HOUSING_TYPES.map(item => item.id))) return fail();
  const basePrices = Object.create(null) as CleaningPricingPolicy["basePrices"];
  for (const housing of CLEANING_HOUSING_TYPES) {
    const rows = rawPrices[housing.id];
    if (!Array.isArray(rows) || rows.length !== CLEANING_PRICE_BANDS.length) return fail();
    basePrices[housing.id as keyof typeof basePrices] = rows.map(value => amount(value, true));
  }
  if (!Array.isArray(value.addOns) || value.addOns.length > 30) return fail();
  const seen = new Set<string>();
  const addOns = value.addOns.map(raw => {
    if (!isRecord(raw) || !exactKeys(raw, ["id", "name", "description", "amount"])) return fail();
    const id = safeText(raw.id, 64);
    if (!/^[A-Za-z0-9_-]+$/.test(id) || seen.has(id)) return fail();
    seen.add(id);
    return {
      id,
      name: safeText(raw.name, 80),
      description: safeText(raw.description, 240, false),
      amount: amount(raw.amount, true),
    };
  });
  if (!isRecord(value.discountCaps) || !exactKeys(value.discountCaps, ["promotion", "membership"])) return fail();
  return {
    policyId,
    name: safeText(value.name, 100),
    region: safeText(value.region, 80),
    effectiveFrom: day(value.effectiveFrom),
    publication,
    basePrices,
    addOns,
    discountCaps: {
      promotion: amount(value.discountCaps.promotion, false),
      membership: amount(value.discountCaps.membership, false),
    },
  };
}

export function selectCleaningPricingPolicy(
  policies: unknown[], region: string, quoteDate: string,
): CleaningPricingPolicy | null {
  const normalizedRegion = safeText(region, 80);
  const date = day(quoteDate);
  const effective = policies.map(normalizeCleaningPricingPolicy)
    .filter(policy => policy.publication === "published" && policy.region === normalizedRegion && policy.effectiveFrom <= date)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.policyId.localeCompare(a.policyId));
  return effective[0] || null;
}

export function calculateCleaningPrice(policyValue: unknown, input: {
  housingType: string;
  areaPyeong: number;
  addOnIds: string[];
  promotionDiscount: number;
  membershipDiscount: number;
}): {
  policyId: string;
  baseAmount: number;
  addOnAmount: number;
  promotionDiscount: number;
  membershipDiscount: number;
  totalAmount: number;
} {
  const policy = normalizeCleaningPricingPolicy(policyValue);
  if (!isRecord(input) || !["apartment", "villa", "detached"].includes(input.housingType)
    || !Number.isFinite(input.areaPyeong) || input.areaPyeong <= 0 || input.areaPyeong > 1000
    || !Array.isArray(input.addOnIds) || input.addOnIds.some(id => typeof id !== "string")
    || !Number.isSafeInteger(input.promotionDiscount) || input.promotionDiscount < 0
    || !Number.isSafeInteger(input.membershipDiscount) || input.membershipDiscount < 0) return fail();
  const uniqueIds = new Set(input.addOnIds);
  if (uniqueIds.size !== input.addOnIds.length) return fail();
  const bandIndex = CLEANING_PRICE_BANDS.findIndex(band => input.areaPyeong <= band.max);
  const prices = policy.basePrices[input.housingType as keyof CleaningPricingPolicy["basePrices"]];
  const selectedAddOns = policy.addOns.filter(addOn => uniqueIds.has(addOn.id));
  if (selectedAddOns.length !== uniqueIds.size) return fail();
  const baseAmount = prices[bandIndex];
  const addOnAmount = selectedAddOns.reduce((sum, addOn) => sum + addOn.amount, 0);
  const promotionDiscount = Math.min(input.promotionDiscount, policy.discountCaps.promotion);
  const membershipDiscount = Math.min(input.membershipDiscount, policy.discountCaps.membership);
  const totalAmount = baseAmount + addOnAmount - promotionDiscount - membershipDiscount;
  if (!Number.isSafeInteger(totalAmount) || totalAmount < 1) return fail();
  return { policyId: policy.policyId, baseAmount, addOnAmount, promotionDiscount, membershipDiscount, totalAmount };
}

export function cleaningPricingPolicyStatus(
  policyValue: unknown, today: string, nextEffectiveFrom?: string,
): "draft" | "scheduled" | "active" | "expired" {
  const policy = normalizeCleaningPricingPolicy(policyValue);
  const currentDate = day(today);
  if (policy.publication === "draft") return "draft";
  if (policy.effectiveFrom > currentDate) return "scheduled";
  if (nextEffectiveFrom && day(nextEffectiveFrom) <= currentDate && nextEffectiveFrom > policy.effectiveFrom) return "expired";
  return "active";
}

export function createCleaningPricingPolicy(
  currentValue: unknown,
  rawInput: unknown,
  actor: { uid: string; role: string },
  now: string,
): { ok: true; record: CleaningPricingPolicyRecord; replayed: boolean } | { ok: false; error: string } {
  if (actor.role !== "admin" || !/^[A-Za-z0-9_-]{1,128}$/.test(actor.uid)) {
    return { ok: false, error: "cleaning_pricing_policy_forbidden" };
  }
  if (!isRecord(rawInput) || !exactKeys(rawInput, ["requestId", "policy"])
    || typeof rawInput.requestId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawInput.requestId)
    || !isRecord(rawInput.policy)) return { ok: false, error: "invalid_cleaning_pricing_policy" };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(now)
    || !Number.isFinite(Date.parse(now)) || new Date(Date.parse(now)).toISOString() !== now) {
    return { ok: false, error: "cleaning_pricing_policy_timestamp_invalid" };
  }
  let policy: CleaningPricingPolicy;
  try {
    policy = normalizeCleaningPricingPolicy({ ...rawInput.policy, policyId: rawInput.requestId });
  } catch {
    return { ok: false, error: "invalid_cleaning_pricing_policy" };
  }
  const current = isRecord(currentValue) ? currentValue : {};
  const existing = current[policy.policyId];
  if (existing !== undefined) {
    if (!isRecord(existing) || !isRecord(existing.policy)) return { ok: false, error: "cleaning_pricing_policy_stored_data_invalid" };
    try {
      const existingPolicy = normalizeCleaningPricingPolicy(existing.policy);
      if (JSON.stringify(existingPolicy) === JSON.stringify(policy)
        && existing.createdByUid === actor.uid && typeof existing.createdAt === "string") {
        return { ok: true, record: existing as unknown as CleaningPricingPolicyRecord, replayed: true };
      }
    } catch {
      return { ok: false, error: "cleaning_pricing_policy_stored_data_invalid" };
    }
    return { ok: false, error: "cleaning_pricing_policy_request_conflict" };
  }
  for (const rawRecord of Object.values(current)) {
    if (!isRecord(rawRecord) || !isRecord(rawRecord.policy)) return { ok: false, error: "cleaning_pricing_policy_stored_data_invalid" };
    let existingPolicy: CleaningPricingPolicy;
    try { existingPolicy = normalizeCleaningPricingPolicy(rawRecord.policy); }
    catch { return { ok: false, error: "cleaning_pricing_policy_stored_data_invalid" }; }
    if (policy.publication === "published" && existingPolicy.publication === "published"
      && policy.region === existingPolicy.region && policy.effectiveFrom === existingPolicy.effectiveFrom) {
      return { ok: false, error: "cleaning_pricing_policy_effective_date_conflict" };
    }
  }
  return {
    ok: true,
    record: { policy, createdAt: now, createdByUid: actor.uid },
    replayed: false,
  };
}
