import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Naver marketing schedule", () => {
  it("runs every ten minutes with all SearchAd secrets", () => {
    const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(source).toContain("syncNaverMarketingMetrics");
    expect(source).toContain('schedule: "every 10 minutes"');
    expect(source).toContain('defineSecret("NAVER_SEARCHAD_ACCESS_LICENSE")');
    expect(source).toContain('defineSecret("NAVER_SEARCHAD_SECRET_KEY")');
    expect(source).toContain('defineSecret("NAVER_SEARCHAD_CUSTOMER_ID")');
  });
});
