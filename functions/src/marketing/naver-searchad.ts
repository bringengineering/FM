import { createHmac } from "node:crypto";

export interface SignInput { timestamp: string; method: string; path: string; secretKey: string }
export interface SearchAdCredentials { accessLicense: string; secretKey: string; customerId: string }

export class SearchAdError extends Error {
  constructor(message: string, public readonly code: string, public readonly status: number) { super(message); }
}

export function signSearchAdRequest(input: SignInput): string {
  return createHmac("sha256", input.secretKey)
    .update(`${input.timestamp}.${input.method.toUpperCase()}.${input.path}`)
    .digest("base64");
}

const count = (value: unknown) => Math.max(0, Number(value) || 0);
export function normalizeSearchAdStat(value: Record<string, unknown>) {
  return {
    campaignId: String(value.id || value.nccCampaignId || ""),
    impressions: count(value.impCnt),
    clicks: count(value.clkCnt),
    spend: count(value.salesAmt),
    conversions: count(value.ccnt),
  };
}

export function createSearchAdClient(options: SearchAdCredentials & { fetchImpl?: typeof fetch; now?: () => number; baseUrl?: string }) {
  const fetchImpl = options.fetchImpl || fetch;
  const baseUrl = options.baseUrl || "https://api.searchad.naver.com";
  async function request(path: string, query?: Record<string, string | string[]>) {
    const timestamp = String((options.now || Date.now)());
    const url = new URL(`${baseUrl}${path}`);
    Object.entries(query || {}).forEach(([key, value]) => (Array.isArray(value) ? value : [value]).forEach(item => url.searchParams.append(key, item)));
    const response = await fetchImpl(url.toString(), { headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "X-Timestamp": timestamp,
      "X-API-KEY": options.accessLicense,
      "X-Customer": options.customerId,
      "X-Signature": signSearchAdRequest({ timestamp, method: "GET", path, secretKey: options.secretKey }),
    } });
    if (!response.ok) {
      const body = await response.text();
      const code = response.status === 401 || response.status === 403 ? "AUTH_FAILED" : response.status === 429 ? "RATE_LIMITED" : response.status >= 500 ? "UPSTREAM_FAILED" : "BAD_REQUEST";
      throw new SearchAdError(body.slice(0, 300) || `SearchAd ${response.status}`, code, response.status);
    }
    return response.json();
  }
  return {
    getCampaigns: () => request("/ncc/campaigns") as Promise<Array<Record<string, unknown>>>,
    getStats: (ids: string[], since: string, until: string) => request("/stats", {
      ids,
      fields: JSON.stringify(["impCnt", "clkCnt", "salesAmt", "ccnt"]),
      timeRange: JSON.stringify({ since, until }),
      timeIncrement: "1",
    }) as Promise<Array<Record<string, unknown>>>,
  };
}
