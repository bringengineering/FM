import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Cleaning Partner recruitment page", () => {
  it("collects the screening fields and submits a partner application", async () => {
    const source = await readFile(resolve(process.cwd(), "app/cleaning-partner/PartnerApplication.tsx"), "utf8");
    expect(source).toContain("Cleaning Partner");
    expect(source).toContain('leadType: "partner_application"');
    for (const field of ["businessName", "businessNumber", "services", "headcount", "dailyCapacity", "vehicle", "experienceYears", "invoiceAvailable", "insured"]) {
      expect(source).toContain(field);
    }
    expect(source).toContain("submitMarketingLead");
  });
});
