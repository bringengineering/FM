import { describe, expect, it } from "vitest";
import { landingServices } from "../../app/landing/services";

describe("landing service content", () => {
  it("defines the three approved services in navigation order", () => {
    expect(Object.keys(landingServices)).toEqual([
      "stair-cleaning",
      "building-care",
      "move-in-cleaning",
    ]);

    expect(landingServices["stair-cleaning"].price).toContain("6만원");
    expect(landingServices["building-care"].price).toContain("8.9만원");
    expect(landingServices["move-in-cleaning"].price).toContain("10만원");
  });

  it("keeps service claims grounded and useful for prospective customers", () => {
    for (const service of Object.values(landingServices)) {
      expect(service.title).not.toMatch(/1위|100%|최우수/);
      expect(service.scope.length).toBeGreaterThanOrEqual(4);
      expect(service.faq.length).toBeGreaterThanOrEqual(3);

      for (const record of service.records) {
        expect(record.source).toMatch(/^https:\/\/blog\.naver\.com\/bringcare\//);
        expect(record.alt.length).toBeGreaterThan(8);
      }
    }
  });
});
