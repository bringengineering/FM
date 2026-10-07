import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureToken: vi.fn(),
  ref: vi.fn((_database: unknown, path: string) => ({ path })),
  set: vi.fn(),
  serverTimestamp: vi.fn(() => ({ ".sv": "timestamp" })),
}));

vi.mock("firebase/database", () => ({ ref: mocks.ref, set: mocks.set, serverTimestamp: mocks.serverTimestamp }));
vi.mock("../../app/field/lib/firebase.client", () => ({ database: { name: "test" }, ensureFieldAppCheckToken: mocks.ensureToken }));

import { submitMarketingLead } from "../../app/landing/marketingLeadClient";

const input = {
  name: "김건물", phone: "010-1234-5678", location: "원주시 단계동", needs: "계단 정기청소",
  buildingInfo: "4층", customerType: "building_owner", service: "계단·공용부 청소", sourcePath: "/stair-cleaning",
  utmSource: "naver", utmCampaign: "stair", utmTerm: "원주계단청소", utmContent: "CR-0007", consent: true,
};

describe("submitMarketingLead", () => {
  beforeEach(() => { mocks.ensureToken.mockReset(); mocks.ref.mockClear(); mocks.set.mockReset(); mocks.serverTimestamp.mockClear(); });

  it("creates one private CRM inbox record after App Check", async () => {
    const result = await submitMarketingLead(input);
    expect(mocks.ensureToken).toHaveBeenCalledTimes(1);
    expect(result.receiptId).toMatch(/^lead_[A-Za-z0-9_-]{16,100}$/);
    expect(mocks.ref).toHaveBeenCalledWith(expect.anything(), `crmCompany/data/marketingLeadInbox/${result.receiptId}`);
    expect(mocks.set).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ...input, requestId: result.receiptId, submittedAt: { ".sv": "timestamp" }, status: "new" }));
    expect(mocks.set).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ utmContent: "CR-0007" }));
  });

  it("rejects a non-mobile placeholder before writing", async () => {
    await expect(submitMarketingLead({ ...input, phone: "010-0000" })).rejects.toThrow(/010-1234-5678/);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("accepts a structured Cleaning Partner application in the same CRM inbox", async () => {
    const result = await submitMarketingLead({
      ...input,
      name: "박파트너",
      customerType: "cleaning_partner",
      service: "Cleaning Partner 지원",
      leadType: "partner_application",
      businessName: "원주클린",
      businessNumber: "123-45-67890",
      services: "move_in,common_area",
      headcount: 3,
      dailyCapacity: 2,
      vehicle: "1톤 탑차",
      experienceYears: 4,
      invoiceAvailable: true,
      insured: false,
    });
    expect(mocks.set).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      requestId: result.receiptId,
      leadType: "partner_application",
      businessName: "원주클린",
      headcount: 3,
    }));
  });
});
