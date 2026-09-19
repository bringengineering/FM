import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("public marketing lead intake rules", () => {
  it("routes create-only public leads into the CRM shared inbox", async () => {
    const rules = JSON.parse(await readFile(resolve(process.cwd(), "../database.rules.json"), "utf8"));
    const leadRule = rules.rules.crmCompany.data.marketingLeadInbox.$leadId;

    expect(leadRule[".write"]).toContain("auth == null");
    expect(leadRule[".write"]).toContain("!data.exists()");
    expect(leadRule[".write"]).toContain("newData.numChildren() === 15");
    expect(leadRule[".write"]).toContain("newData.numChildren() === 25");
    expect(leadRule.leadType[".validate"]).toContain("partner_application");
    expect(leadRule[".validate"]).toContain("newData.child('requestId').val() === $leadId");
    expect(leadRule[".validate"]).toContain("newData.child('phone').val().matches(/^010-");
    expect(leadRule.$other[".validate"]).toBe(false);
  });
});
