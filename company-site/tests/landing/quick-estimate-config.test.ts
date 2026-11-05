import { describe, expect, it } from "vitest";
import {
  compactEstimateConfig,
  formatKoreanMobile,
} from "../../app/landing/quickEstimateConfig";

describe("compact estimate configuration", () => {
  it.each([
    ["stair-cleaning", "building_owner", "건물 위치, 층수, 희망 청소 주기"],
    ["building-care", "building_owner", "건물 위치, 세대수, 현재 가장 불편한 문제"],
    ["move-in-cleaning", "individual", "청소 희망일, 공간 유형, 평형 또는 방 개수"],
    ["turnover-care", "building_owner", "퇴실 예정일, 호실 위치, 필요한 준비"],
  ] as const)(
    "maps %s to the approved quick form context",
    (slug, customerType, placeholder) => {
      expect(compactEstimateConfig[slug].defaultCustomerType).toBe(customerType);
      expect(compactEstimateConfig[slug].needsPlaceholder).toContain(placeholder);
    },
  );

  it("formats an eleven-digit Korean mobile number", () => {
    expect(formatKoreanMobile("01012345678")).toBe("010-1234-5678");
    expect(formatKoreanMobile("010-1234-5678")).toBe("010-1234-5678");
  });

  it("keeps partial phone input editable while removing non-digits", () => {
    expect(formatKoreanMobile("010 12a")).toBe("010-12");
    expect(formatKoreanMobile("01012345")).toBe("010-1234-5");
  });
});
