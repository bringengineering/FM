export type PublicPriceId =
  | "building-care"
  | "stair-cleaning"
  | "managed-turnover"
  | "single-turnover";

export type PublicPrice = {
  id: PublicPriceId;
  label: string;
  price: string;
  basis: string;
  includes: string[];
  vatExcluded: true;
};

export const VAT_NOTE = "모든 금액은 부가세 별도입니다.";

export const PUBLIC_PRICES: PublicPrice[] = [
  {
    id: "building-care",
    label: "월 정기관리",
    price: "8만 9천원부터",
    basis: "원룸·다가구 건물 기준",
    includes: ["정기 방문", "관리 보고", "입·퇴실 일정 관리", "통합 상담 창구"],
    vatExcluded: true,
  },
  {
    id: "stair-cleaning",
    label: "계단·공용부 정기청소",
    price: "3층 6만원 · 4층 7만원 · 5층 8만원",
    basis: "주 1회 방문 기준",
    includes: ["계단·복도", "공동현관", "작업 사진", "이상사항 보고"],
    vatExcluded: true,
  },
  {
    id: "managed-turnover",
    label: "관리 건물 입·퇴실청소",
    price: "10만원부터",
    basis: "원룸 기본 청소 기준",
    includes: ["현관", "주방·욕실", "창틀·바닥", "완료 사진"],
    vatExcluded: true,
  },
  {
    id: "single-turnover",
    label: "일반 단건 입·퇴실청소",
    price: "12만원부터",
    basis: "원룸 기본 청소 기준",
    includes: ["작업 범위 안내", "주방·욕실", "창틀·바닥", "완료 확인"],
    vatExcluded: true,
  },
];

export const PRICE_DISCLAIMERS = [
  "평형, 층수, 오염도, 잔존물, 옵션과 추가 작업에 따라 금액이 달라질 수 있습니다.",
  "현장 작업비, 자재비, 폐기물비와 전문업체 시공비는 별도입니다.",
  "외부 전문작업 연결·조율 비용은 건물주가 승인한 작업금액의 5%입니다.",
];
