import { describe, expect, it, vi } from "vitest";
import { syncNaverMarketingCore } from "../src/marketing/sync-naver-marketing.js";

describe("Naver marketing sync", () => {
  it("writes one idempotent day snapshot with mapped service keys", async () => {
    const write = vi.fn();
    const client = {
      getCampaigns: vi.fn().mockResolvedValue([{ nccCampaignId: "cmp_1", name: "BRING CARE | 건물관리" }]),
      getStats: vi.fn().mockResolvedValue([{ id: "cmp_1", impCnt: 20, clkCnt: 2, salesAmt: 1500, ccnt: 1 }]),
    };
    const now = new Date("2026-09-02T00:15:00.000Z");
    await syncNaverMarketingCore({ now }, { client, write });
    await syncNaverMarketingCore({ now }, { client, write });

    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[0][0]).toBe("marketingMetrics/naver");
    expect(write.mock.calls[0][1].days["2026-09-02"].cmp_1).toMatchObject({ clicks: 2, spend: 1500, serviceKey: "building_care" });
  });
});
