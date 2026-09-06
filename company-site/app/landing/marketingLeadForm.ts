import type { MarketingLeadInput } from "./marketingLeadClient";

export function campaignContext(href: string) {
  const url = new URL(href);
  return {
    utmSource: url.searchParams.get("utm_source") || "",
    utmCampaign: url.searchParams.get("utm_campaign") || "",
    utmTerm: url.searchParams.get("utm_term") || "",
  };
}

export function marketingLeadCopy(values: MarketingLeadInput) {
  const typeLabel =
    values.customerType === "building_owner"
      ? "건물주"
      : values.customerType === "manager"
        ? "관리 담당자"
        : "개인 고객";

  return [
    `[BRING CARE ${values.service} 견적 신청]`,
    `이름: ${values.name || "입력 안 함"}`,
    `연락처: ${values.phone}`,
    `문의 유형: ${typeLabel}`,
    `건물 위치 또는 지역: ${values.location || "입력 안 함"}`,
    `필요한 상담 내용: ${values.needs}`,
    `건물 정보: ${values.buildingInfo || "입력 안 함"}`,
    `유입 경로: ${values.sourcePath}`,
  ].join("\n");
}
