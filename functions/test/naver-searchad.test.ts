import { describe, expect, it, vi } from "vitest";
import { createSearchAdClient, normalizeSearchAdStat, SearchAdError, signSearchAdRequest } from "../src/marketing/naver-searchad.js";

describe("Naver SearchAd client", () => {
  it("signs the exact timestamp, method and URI", () => {
    expect(signSearchAdRequest({ timestamp: "1700000000000", method: "GET", path: "/stats", secretKey: "secret" }))
      .toBe("dSmwhFWokbdwBl/uE6S6gXwJnOJpri7T5DFhYjePHJU=");
  });

  it("normalizes campaign statistics", () => {
    expect(normalizeSearchAdStat({ id: "cmp_1", impCnt: 10, clkCnt: 2, salesAmt: 3300 })).toMatchObject({
      campaignId: "cmp_1", impressions: 10, clicks: 2, spend: 3300,
    });
  });

  it("sends signed headers and classifies rate limits", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "limited" }), { status: 429 }));
    const client = createSearchAdClient({ accessLicense: "license", secretKey: "secret", customerId: "2575255", fetchImpl, now: () => 1700000000000 });
    await expect(client.getCampaigns()).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
    expect(fetchImpl).toHaveBeenCalledWith("https://api.searchad.naver.com/ncc/campaigns", expect.objectContaining({ headers: expect.objectContaining({ "X-API-KEY": "license", "X-Customer": "2575255" }) }));
  });

  it("encodes multiple campaign ids as repeated stats parameters", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    const client = createSearchAdClient({ accessLicense: "license", secretKey: "secret", customerId: "2575255", fetchImpl, now: () => 1700000000000 });
    await client.getStats(["cmp_1", "cmp_2"], "2026-09-01", "2026-09-02");
    const requested = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(requested.searchParams.getAll("ids")).toEqual(["cmp_1", "cmp_2"]);
  });
});

void SearchAdError;
