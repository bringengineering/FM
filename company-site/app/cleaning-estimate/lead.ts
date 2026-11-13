import type { MarketingLeadInput } from "../landing/marketingLeadClient";
import { getDisplayedPrice, getService } from "./pricing";

export type CleaningEstimateValues = {
  serviceId: string;
  priceId: string;
  condition: string;
  address: string;
  preferredDate: string;
  alternateDate: string;
  preferredTime: string;
  photoPlan: string;
  name: string;
  phone: string;
  customerType: string;
  consent: boolean;
  note?: string;
};

export function buildCleaningLead(values: CleaningEstimateValues): MarketingLeadInput {
  const service = getService(values.serviceId);
  const price = getDisplayedPrice(values.serviceId, values.priceId);
  return {
    name: values.name,
    phone: values.phone,
    location: values.address,
    customerType: values.customerType,
    service: service?.title ?? "청소 견적",
    sourcePath: "/cleaning-estimate",
    buildingInfo: `${price?.label ?? "면적 확인 필요"} / ${price?.value ?? "별도견적"} / 현장상태: ${values.condition}`,
    needs: [
      `희망일 1순위: ${values.preferredDate}`,
      `희망일 2순위: ${values.alternateDate || "미입력"}`,
      `희망시간: ${values.preferredTime}`,
      `사진: ${values.photoPlan}`,
      values.note ? `추가 요청: ${values.note}` : "",
      "가격 원칙: 확정견적 이후 기본 작업 현장 추가금 없음",
    ].filter(Boolean).join("\n"),
    utmSource: "",
    utmCampaign: "cleaning-estimate",
    utmTerm: service?.short ?? "",
    consent: values.consent,
  };
}
