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
  utmSource: "naver", utmCampaign: "stair", utmTerm: "원주계단청소", consent: true,
};

describe("submitMarketingLead", () => {
  beforeEach(() => { mocks.ensureToken.mockReset(); mocks.ref.mockClear(); mocks.set.mockReset(); mocks.serverTimestamp.mockClear(); });

  it("creates one private CRM inbox record after App Check", async () => {
    const result = await submitMarketingLead(input);
    expect(mocks.ensureToken).toHaveBeenCalledTimes(1);
    expect(result.receiptId).toMatch(/^lead_[A-Za-z0-9_-]{16,100}$/);
    expect(mocks.ref).toHaveBeenCalledWith(expect.anything(), `crmCompany/marketingLeadInbox/${result.receiptId}`);
    expect(mocks.set).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ...input, requestId: result.receiptId, submittedAt: { ".sv": "timestamp" }, status: "new" }));
  });

  it("rejects a non-mobile placeholder before writing", async () => {
    await expect(submitMarketingLead({ ...input, phone: "010-0000" })).rejects.toThrow(/010-1234-5678/);
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
