(function(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringMarketingMetrics = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  const nonNegative = value => Math.max(0, Number(value) || 0);
  const ratio = (numerator, denominator, multiplier = 1) => denominator > 0 ? numerator / denominator * multiplier : null;

  function normalizeMetric(value) {
    const source = value && typeof value === "object" ? value : {};
    const impressions = nonNegative(source.impressions);
    const clicks = nonNegative(source.clicks);
    const spend = nonNegative(source.spend);
    const leads = nonNegative(source.leads);
    return {
      campaignId: String(source.campaignId || ""),
      campaignName: String(source.campaignName || ""),
      serviceKey: String(source.serviceKey || ""),
      impressions, clicks, spend, leads,
      ctr: ratio(clicks, impressions, 100),
      averageCpc: ratio(spend, clicks),
      costPerLead: ratio(spend, leads),
      syncedAt: String(source.syncedAt || ""),
    };
  }

  function summarizeMetrics(values) {
    const total = (Array.isArray(values) ? values : []).map(normalizeMetric).reduce((sum, row) => ({
      impressions: sum.impressions + row.impressions,
      clicks: sum.clicks + row.clicks,
      spend: sum.spend + row.spend,
      leads: sum.leads + row.leads,
    }), { impressions: 0, clicks: 0, spend: 0, leads: 0 });
    return normalizeMetric(total);
  }

  return { normalizeMetric, ratio, summarizeMetrics };
});
