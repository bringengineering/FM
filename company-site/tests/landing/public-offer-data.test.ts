import { describe, expect, it } from "vitest";
import {
  KAKAO_CHAT_HREF,
  PHONE_HREF,
  PHONE_LABEL,
} from "../../app/landing/contact";
import { PUBLIC_PRICES, VAT_NOTE } from "../../app/landing/pricing";

describe("public BRING CARE offer data", () => {
  it("uses the confirmed phone and official Kakao channel", () => {
    expect(PHONE_LABEL).toBe("010-6566-3603");
    expect(PHONE_HREF).toBe("tel:01065663603");
    expect(KAKAO_CHAT_HREF).toBe("https://pf.kakao.com/_xnaRfX/chat");
  });

  it("publishes the approved VAT-exclusive prices", () => {
    expect(VAT_NOTE).toBe("모든 금액은 부가세 별도입니다.");
    expect(PUBLIC_PRICES).toMatchObject([
      { id: "building-care", price: "8만 9천원부터" },
      {
        id: "stair-cleaning",
        price: "3층 6만원 · 4층 7만원 · 5층 8만원",
      },
      { id: "managed-turnover", price: "10만원부터" },
      { id: "single-turnover", price: "12만원부터" },
    ]);
    expect(PUBLIC_PRICES.every((price) => price.vatExcluded)).toBe(true);
  });
});
