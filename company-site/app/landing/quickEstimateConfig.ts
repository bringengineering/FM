import type { LandingSlug } from "./services";

export type CompactEstimateConfig = {
  defaultCustomerType: "building_owner" | "individual";
  needsPlaceholder: string;
};

export const compactEstimateConfig: Record<LandingSlug, CompactEstimateConfig> = {
  "stair-cleaning": {
    defaultCustomerType: "building_owner",
    needsPlaceholder: "건물 위치, 층수, 희망 청소 주기를 적어주세요.",
  },
  "building-care": {
    defaultCustomerType: "building_owner",
    needsPlaceholder: "건물 위치, 세대수, 현재 가장 불편한 문제를 적어주세요.",
  },
  "move-in-cleaning": {
    defaultCustomerType: "individual",
    needsPlaceholder: "청소 희망일, 공간 유형, 평형 또는 방 개수를 적어주세요.",
  },
  "turnover-care": {
    defaultCustomerType: "building_owner",
    needsPlaceholder: "퇴실 예정일, 호실 위치, 필요한 준비를 적어주세요.",
  },
};

export function formatKoreanMobile(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}
