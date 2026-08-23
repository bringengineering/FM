import { describe, expect, it } from "vitest";

import {
  MarketingLeadError,
  normalizeMarketingLeadInput,
  reduceMarketingLeadDataRoot,
  submitMarketingLeadCore,
  type MarketingLeadTransactionCommand,
} from "../src/marketing/submit-marketing-lead.js";

const validInput = {
  requestId: "lead_01JTESTREQUEST000000000001",
  name: "김건물",
  phone: "010-1234-5678",
  location: "원주시 단계동",
  needs: "4층 원룸 계단을 월 4회 청소하고 싶습니다.",
  buildingInfo: "4층 16세대",
  customerType: "building_owner",
  service: "계단·공용부 청소",
  sourcePath: "/stair-cleaning",
  pageUrl: "https://bring-fm.web.app/stair-cleaning?utm_source=naver",
  utmSource: "naver",
  utmCampaign: "stair-launch",
  utmTerm: "원주계단청소",
  consent: true,
  website: "",
};

function command(overrides: Partial<MarketingLeadTransactionCommand> = {}) {
  return {
    input: normalizeMarketingLeadInput(validInput),
    phoneHash: "phone_hash",
    now: "2026-08-24T04:30:00.000Z",
    ids: {
      customerId: "cus_01",
      activityId: "act_01",
      prospectId: "spr_01",
      contactId: "sct_01",
      opportunityId: "sop_01",
      eventId: "sev_01",
    },
    ...overrides,
  } satisfies MarketingLeadTransactionCommand;
}

describe("normalizeMarketingLeadInput", () => {
  it("normalizes a valid 010 mobile request and keeps approved campaign context", () => {
    expect(normalizeMarketingLeadInput(validInput)).toMatchObject({
      phone: "010-1234-5678",
      customerType: "building_owner",
      service: "계단·공용부 청소",
      sourcePath: "/stair-cleaning",
      utmSource: "naver",
      utmTerm: "원주계단청소",
      consent: true,
    });
  });

  it.each([
    [{ ...validInput, phone: "02-123-4567" }, "marketing_lead_phone_invalid"],
    [{ ...validInput, consent: false }, "marketing_lead_consent_required"],
    [{ ...validInput, needs: "" }, "marketing_lead_needs_required"],
    [{ ...validInput, sourcePath: "/admin" }, "marketing_lead_source_invalid"],
    [{ ...validInput, service: "무관한 서비스" }, "marketing_lead_service_invalid"],
  ])("rejects invalid public input with a stable code", (input, code) => {
    expect(() => normalizeMarketingLeadInput(input)).toThrowError(
      expect.objectContaining<Partial<MarketingLeadError>>({ code }),
    );
  });
});

describe("reduceMarketingLeadDataRoot", () => {
  it("creates CRM customer, activity and building-owner sales records atomically", () => {
    const result = reduceMarketingLeadDataRoot({}, command());

    expect(result.result).toEqual({
      receiptId: validInput.requestId,
      customerId: "cus_01",
      repeated: false,
    });
    expect(result.data.customers).toMatchObject({
      cus_01: {
        name: "김건물",
        phone: "010-1234-5678",
        source: "홈페이지",
        stage: "신규 고객",
        currentIssue: validInput.needs,
      },
    });
    expect(result.data.activities).toMatchObject({
      act_01: {
        customerId: "cus_01",
        type: "메모",
        result: "신규 상담 신청",
      },
    });
    expect(result.data.salesProspects).toMatchObject({
      spr_01: {
        address: "원주시 단계동",
        source: "other",
        stage: "candidate",
      },
    });
    expect(result.data.salesContacts).toMatchObject({
      sct_01: {
        prospectId: "spr_01",
        phone: "010-1234-5678",
        verifiedAt: "",
      },
    });
    expect(result.data.salesOpportunities).toMatchObject({
      sop_01: {
        prospectId: "spr_01",
        serviceType: "common_cleaning",
        stage: "discovered",
        requirements: validInput.needs,
      },
    });
    expect(result.data.salesEvents).toMatchObject({
      sev_01: {
        prospectId: "spr_01",
        type: "prospect_created",
      },
    });
  });

  it("reuses an existing customer for the same phone hash and appends a new activity", () => {
    const first = reduceMarketingLeadDataRoot({}, command());
    const second = reduceMarketingLeadDataRoot(
      first.data,
      command({
        input: normalizeMarketingLeadInput({
          ...validInput,
          requestId: "lead_01JTESTREQUEST000000000002",
          needs: "정기청소 견적을 다시 확인하고 싶습니다.",
        }),
        ids: { ...command().ids, customerId: "cus_02", activityId: "act_02" },
      }),
    );

    expect(Object.keys(second.data.customers as object)).toEqual(["cus_01"]);
    expect(second.data.activities).toHaveProperty("act_02.customerId", "cus_01");
    expect(second.result.customerId).toBe("cus_01");
  });

  it("returns the stored receipt without creating duplicates for a retried request id", () => {
    const first = reduceMarketingLeadDataRoot({}, command());
    const repeated = reduceMarketingLeadDataRoot(first.data, command());

    expect(repeated.result).toMatchObject({ customerId: "cus_01", repeated: true });
    expect(repeated.data).toBe(first.data);
  });

  it("does not create a building sales prospect for an individual move-in request", () => {
    const result = reduceMarketingLeadDataRoot(
      {},
      command({
        input: normalizeMarketingLeadInput({
          ...validInput,
          customerType: "individual",
          service: "입주·이사청소",
          sourcePath: "/move-in-cleaning",
        }),
      }),
    );

    expect(result.data.salesProspects).toBeUndefined();
    expect(result.data.salesContacts).toBeUndefined();
    expect(result.data.salesOpportunities).toBeUndefined();
  });
});

describe("submitMarketingLeadCore", () => {
  it("passes a normalized command to the injected CRM transaction", async () => {
    let received: MarketingLeadTransactionCommand | undefined;
    const result = await submitMarketingLeadCore(validInput, {
      now: () => "2026-08-24T04:30:00.000Z",
      newId: (prefix) => `${prefix}_generated`,
      transact: async (value) => {
        received = value;
        return { receiptId: value.input.requestId, customerId: "cus_generated", repeated: false };
      },
    });

    expect(received).toMatchObject({
      input: { phone: "010-1234-5678", needs: validInput.needs },
      ids: { customerId: "cus_generated", activityId: "act_generated" },
    });
    expect(received?.phoneHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.receiptId).toBe(validInput.requestId);
  });
});
