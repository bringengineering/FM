import { describe, expect, it } from "vitest";
import {
  CLEANING_SERVICES,
  formatWon,
  getDisplayedPrice,
} from "../../app/cleaning-estimate/pricing";
import { buildCleaningLead } from "../../app/cleaning-estimate/lead";

describe("cleaning estimate pricing", () => {
  it("publishes every approved service category and price table", () => {
    expect(CLEANING_SERVICES).toHaveLength(7);
    expect(CLEANING_SERVICES.map((service) => service.id)).toEqual([
      "studio",
      "apartment",
      "common-area",
      "office",
      "store-deep",
      "construction",
      "specialty",
    ]);
    expect(CLEANING_SERVICES.every((service) => service.rows.length > 0)).toBe(true);
  });

  it("returns a VAT-inclusive selected price without inventing a quote", () => {
    expect(getDisplayedPrice("studio", "studio-6")).toEqual({
      label: "6평 이하",
      value: "149,000원",
      numericValue: 149000,
    });
    expect(getDisplayedPrice("construction", "construction-30")?.value).toBe(
      "450,000원부터",
    );
    expect(getDisplayedPrice("specialty", "specialty-fire")?.value).toBe(
      "300,000원부터 · 현장견적",
    );
    expect(formatWon(319000)).toBe("319,000원");
  });
});

describe("cleaning estimate CRM payload", () => {
  it("keeps the selected service, price, schedule and no-extra-charge promise", () => {
    const lead = buildCleaningLead({
      serviceId: "studio",
      priceId: "studio-6",
      condition: "일반 오염",
      address: "강원특별자치도 원주시 단계동",
      preferredDate: "2026-09-25",
      alternateDate: "2026-09-26",
      preferredTime: "오전",
      photoPlan: "사진 없이 먼저 접수",
      name: "홍길동",
      phone: "010-1234-5678",
      customerType: "individual",
      consent: true,
    });

    expect(lead.service).toBe("원룸·다가구 입주/퇴실청소");
    expect(lead.location).toBe("강원특별자치도 원주시 단계동");
    expect(lead.buildingInfo).toContain("6평 이하 / 149,000원");
    expect(lead.needs).toContain("희망일 1순위: 2026-09-25");
    expect(lead.needs).toContain("확정견적 이후 기본 작업 현장 추가금 없음");
  });
});
