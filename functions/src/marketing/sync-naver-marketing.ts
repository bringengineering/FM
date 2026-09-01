import { normalizeSearchAdStat } from "./naver-searchad.js";

type SearchAdClient = {
  getCampaigns(): Promise<Array<Record<string, unknown>>>;
  getStats(ids: string[], since: string, until: string): Promise<Array<Record<string, unknown>>>;
};

const seoulDay = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
const serviceKey = (name: string) => name.includes("입주") ? "move_in_cleaning" : name.includes("계단") || name.includes("공용부") ? "stair_cleaning" : name.includes("건물관리") ? "building_care" : "other";

export async function syncNaverMarketingCore(
  input: { now: Date },
  dependencies: { client: SearchAdClient; write(path: string, value: Record<string, unknown>): Promise<unknown> },
) {
  const until = seoulDay(input.now);
  const since = until;
  const campaigns = await dependencies.client.getCampaigns();
  const byId = Object.fromEntries(campaigns.map(campaign => {
    const id = String(campaign.nccCampaignId || campaign.id || "");
    return [id, { campaignId: id, campaignName: String(campaign.name || campaign.campaignName || ""), serviceKey: serviceKey(String(campaign.name || campaign.campaignName || "")) }];
  }).filter(([id]) => id));
  const stats = Object.keys(byId).length ? await dependencies.client.getStats(Object.keys(byId), since, until) : [];
  const rows = Object.fromEntries(stats.map(raw => {
    const normalized = normalizeSearchAdStat(raw);
    return [normalized.campaignId, { ...byId[normalized.campaignId], ...normalized, syncedAt: input.now.toISOString(), rangeSince: since, rangeUntil: until }];
  }).filter(([id]) => id));
  const snapshot = { provider: "naver", accountId: "2575255", syncedAt: input.now.toISOString(), range: { since, until }, campaigns: rows, days: { [until]: rows }, status: { ok: true } };
  await dependencies.write("marketingMetrics/naver", snapshot);
  return snapshot;
}
