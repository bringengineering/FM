const WONJU_AREA_CODES: Record<string, string> = {
  무실동: "MUSIL",
  단계동: "DANGYE",
  반곡동: "BANGOK",
  지정면: "JIJEONG",
  혁신동: "HYEOKSIN",
  원인동: "WONIN",
  개운동: "GAEUN",
  명륜동: "MYEONGNYUN",
  단구동: "DANGU",
  일산동: "ILSAN",
  학성동: "HAKSEONG",
  우산동: "USAN",
  태장동: "TAEJANG",
  봉산동: "BONGSAN",
  행구동: "HAENGGU",
  관설동: "GWANSEOL",
  문막읍: "MUNMAK",
};

export function classifyWonjuArea(address: string): string {
  const normalized = address.normalize("NFKC").trim();
  const district = normalized.match(/원주시\s+([^\s,]+(?:동|읍|면))(?:\s|,|$)/)?.[1];
  if (!district) return "ETC";
  return WONJU_AREA_CODES[district] ?? "ETC";
}

export function formatManagementNumber(input: {
  area: string;
  year: number;
  sequence: number;
}): string {
  const area = /^[A-Z0-9]{2,16}$/.test(input.area) ? input.area : "ETC";
  const year = String(Math.trunc(input.year)).slice(-2).padStart(2, "0");
  const sequence = String(Math.max(1, Math.trunc(input.sequence))).padStart(4, "0");
  return `BR-WJ-${area}-${year}-${sequence}`;
}
