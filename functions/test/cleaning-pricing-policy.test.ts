import { describe, expect, it } from "vitest";
import { calculateCleaningPrice, cleaningPricingPolicyStatus, createCleaningPricingPolicy, normalizeCleaningPricingPolicy, selectCleaningPricingPolicy } from "../src/cleaning-pricing-policy.js";

const policy = {
  policyId: "wonju-2026-10-01-v1",
  name: "입주청소 가격표 v1.2",
  region: "원주시",
  effectiveFrom: "2026-10-01",
  publication: "published",
  basePrices: {
    apartment: [180000, 240000, 280000, 320000, 360000],
    villa: [160000, 220000, 260000, 300000, 340000],
    detached: [200000, 260000, 320000, 360000, 400000],
  },
  addOns: [
    { id: "balcony", name: "베란다 청소", description: "베란다 바닥, 유리, 배수구 등", amount: 20000 },
    { id: "window", name: "창틀 청소", description: "전체 창틀 및 방충망 포함", amount: 30000 },
    { id: "ac", name: "에어컨 분해 청소", description: "벽걸이형 기준 (스탠드형 별도)", amount: 15000 },
    { id: "waste", name: "폐기물 처리", description: "생활 폐기물 수거 및 처리", amount: 30000 },
  ],
  discountCaps: { promotion: 50000, membership: 30000 },
};

describe("cleaning pricing policy", () => {
  it("normalizes the full table shown in the pricing-policy reference", () => {
    expect(normalizeCleaningPricingPolicy(policy)).toEqual(policy);
  });

  it("rejects incomplete or unsafe prices, duplicate add-ons and unknown fields", () => {
    expect(() => normalizeCleaningPricingPolicy({ ...policy, basePrices: { ...policy.basePrices, apartment: [180000] } }))
      .toThrow("invalid_cleaning_pricing_policy");
    expect(() => normalizeCleaningPricingPolicy({ ...policy, addOns: [...policy.addOns, policy.addOns[0]] }))
      .toThrow("invalid_cleaning_pricing_policy");
    expect(() => normalizeCleaningPricingPolicy({ ...policy, discountCaps: { promotion: -1, membership: 30000 } }))
      .toThrow("invalid_cleaning_pricing_policy");
    expect(() => normalizeCleaningPricingPolicy({ ...policy, unexpected: true }))
      .toThrow("invalid_cleaning_pricing_policy");
  });

  it("chooses the newest published version effective for the requested region and date", () => {
    const earlier = { ...policy, policyId: "earlier", effectiveFrom: "2026-09-01" };
    const later = { ...policy, policyId: "later", effectiveFrom: "2026-10-01" };
    const draft = { ...policy, policyId: "draft", effectiveFrom: "2026-09-15", publication: "draft" as const };
    const otherRegion = { ...policy, policyId: "other", region: "횡성군", effectiveFrom: "2026-08-01" };
    expect(selectCleaningPricingPolicy([earlier, later, draft, otherRegion], "원주시", "2026-09-30")?.policyId).toBe("earlier");
    expect(selectCleaningPricingPolicy([earlier, later, draft, otherRegion], "원주시", "2026-10-01")?.policyId).toBe("later");
    expect(selectCleaningPricingPolicy([later, otherRegion], "원주시", "2026-09-30")).toBeNull();
  });

  it("calculates the housing-size rate, selected extras and bounded discounts", () => {
    const normalized = normalizeCleaningPricingPolicy(policy);
    expect(calculateCleaningPrice(normalized, {
      housingType: "apartment", areaPyeong: 24, addOnIds: ["balcony", "window", "ac"],
      promotionDiscount: 60000, membershipDiscount: 10000,
    })).toEqual({
      policyId: policy.policyId, baseAmount: 240000, addOnAmount: 65000,
      promotionDiscount: 50000, membershipDiscount: 10000, totalAmount: 245000,
    });
  });

  it("reports scheduled, active and expired labels from the effective date", () => {
    const normalized = normalizeCleaningPricingPolicy(policy);
    expect(cleaningPricingPolicyStatus(normalized, "2026-09-30")).toBe("scheduled");
    expect(cleaningPricingPolicyStatus(normalized, "2026-10-01")).toBe("active");
    expect(cleaningPricingPolicyStatus(normalized, "2026-11-01", "2026-10-31")).toBe("expired");
  });

  it("saves append-only policy versions for admins and prevents overlapping published prices", () => {
    const requestId = "d40c8754-df83-4ab3-8f0e-e2d55dc3ccaa";
    const save = (id: string, value = policy, current: Record<string, unknown> = {}) => createCleaningPricingPolicy(current, { requestId: id, policy: value }, { uid: "admin_01", role: "admin" }, "2026-09-28T03:00:00.000Z");
    const first = save(requestId);
    expect(first).toMatchObject({ ok: true, replayed: false, record: { policy: { policyId: requestId }, createdByUid: "admin_01" } });
    if (!first.ok) throw new Error("expected policy to be created");
    const stored = { [requestId]: first.record };
    expect(save(requestId, { ...policy, name: "changed" }, stored)).toMatchObject({ ok: false, error: "cleaning_pricing_policy_request_conflict" });
    expect(save("7729a32a-e2aa-4666-9a9b-90e8b5d92f50", policy, stored)).toMatchObject({ ok: false, error: "cleaning_pricing_policy_effective_date_conflict" });
    expect(createCleaningPricingPolicy({}, { requestId, policy }, { uid: "member_01", role: "member" }, "2026-09-28T03:00:00.000Z"))
      .toMatchObject({ ok: false, error: "cleaning_pricing_policy_forbidden" });
    const draft = save("663a4138-5311-46c9-a6bd-d5cad51ca7b7", { ...policy, publication: "draft" }, stored);
    expect(draft).toMatchObject({ ok: true, record: { policy: { publication: "draft" } } });
  });
});
