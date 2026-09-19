export type PriceRow = {
  id: string;
  label: string;
  value: string;
  numericValue?: number;
};

export type CleaningService = {
  id: string;
  title: string;
  short: string;
  description: string;
  rows: PriceRow[];
  note?: string;
};

export function formatWon(value: number) {
  return `${new Intl.NumberFormat("ko-KR").format(value)}원`;
}

const row = (id: string, label: string, value: string, numericValue?: number): PriceRow => ({ id, label, value, numericValue });

export const CLEANING_SERVICES: CleaningService[] = [
  {
    id: "studio", title: "원룸·다가구 입주/퇴실청소", short: "원룸·다가구", description: "입주 전 또는 퇴실 후 공간 전체 기본청소",
    rows: [
      row("studio-6", "6평 이하", "149,000원", 149000), row("studio-9", "7~9평", "169,000원", 169000),
      row("studio-12", "10~12평", "199,000원", 199000), row("studio-15", "13~15평", "229,000원", 229000),
      row("studio-18", "16~18평", "259,000원", 259000), row("studio-19", "19평 이상", "별도견적"),
    ],
  },
  {
    id: "apartment", title: "아파트 입주/이사청소", short: "아파트", description: "공급·계약면적을 기준으로 안내합니다",
    rows: [
      row("apt-20", "20평 이하", "269,000원", 269000), row("apt-24", "21~24평", "319,000원", 319000),
      row("apt-28", "25~28평", "359,000원", 359000), row("apt-32", "29~32평", "399,000원", 399000),
      row("apt-36", "33~36평", "449,000원", 449000), row("apt-40", "37~40평", "499,000원", 499000),
      row("apt-41", "41평 이상", "평당 12,500원부터"),
    ],
  },
  {
    id: "common-area", title: "공용부·계단 정기청소", short: "공용부·계단", description: "월 4회·주 1회 방문 기준",
    rows: [row("common-3", "3층 이하", "월 79,000원", 79000), row("common-4", "4층", "월 89,000원", 89000), row("common-5", "5층", "월 99,000원", 99000), row("common-6", "6층", "월 119,000원", 119000), row("common-7", "7층 이상", "별도견적")],
    note: "기본범위: 계단·복도·현관·난간·간단 쓰레기 정리",
  },
  {
    id: "office", title: "사무실·상가 정기청소", short: "사무실·상가", description: "1인 작업시간 기준",
    rows: [row("office-2", "2시간", "단건 69,000원 · 월 249,000원", 69000), row("office-3", "3시간", "단건 89,000원 · 월 329,000원", 89000), row("office-4", "4시간", "단건 119,000원 · 월 439,000원", 119000), row("office-6", "6시간", "단건 169,000원 · 월 계약 별도협의", 169000), row("office-8", "8시간", "단건 219,000원 · 월 계약 별도협의", 219000)],
  },
  {
    id: "store-deep", title: "상가 오픈·폐점 대청소", short: "상가 대청소", description: "오픈 전·폐점 후 집중청소",
    rows: [row("store-10", "10평 이하", "199,000원", 199000), row("store-20", "11~20평", "299,000원", 299000), row("store-30", "21~30평", "399,000원", 399000), row("store-40", "31~40평", "499,000원", 499000), row("store-41", "41평 이상", "평당 12,000원부터")],
  },
  {
    id: "construction", title: "인테리어·준공청소", short: "준공청소", description: "공사분진과 현장 상태를 사진으로 확인합니다",
    rows: [row("construction-10", "10평", "최소 200,000원", 200000), row("construction-20", "20평", "300,000원부터", 300000), row("construction-30", "30평", "450,000원부터", 450000), row("construction-40", "40평", "600,000원부터", 600000), row("construction-50", "50평", "750,000원부터", 750000), row("construction-100", "100평", "1,500,000원부터", 1500000)],
    note: "기본 평당 15,000원부터이며 사진 확인 후 확정견적을 드립니다.",
  },
  {
    id: "specialty", title: "기타·전문청소", short: "전문청소", description: "전문 장비와 안전조건 확인이 필요한 작업",
    rows: [
      row("specialty-air-wall", "벽걸이 에어컨", "69,000원부터", 69000), row("specialty-air-stand", "스탠드 에어컨", "129,000원부터", 129000),
      row("specialty-mattress", "매트리스", "69,000원부터", 69000), row("specialty-floor", "바닥세척·왁스", "200,000원부터", 200000),
      row("specialty-glass", "외벽·고소 유리", "200,000원부터 · 현장견적", 200000), row("specialty-flood", "침수복구", "200,000원부터 · 현장견적", 200000),
      row("specialty-fire", "화재복구·유품·특수청소", "300,000원부터 · 현장견적", 300000), row("specialty-disinfection", "방역·소독", "100,000원부터", 100000),
    ],
    note: "전문청소는 사진·안전조건·장비를 확인한 뒤 확정합니다.",
  },
];

export function getService(serviceId: string) {
  return CLEANING_SERVICES.find((service) => service.id === serviceId);
}

export function getDisplayedPrice(serviceId: string, priceId: string) {
  const price = getService(serviceId)?.rows.find((item) => item.id === priceId);
  if (!price) return undefined;
  return { label: price.label, value: price.value, numericValue: price.numericValue };
}

export const EXTRA_PRICES = [
  ["작은 창 추가", "20,000원부터"], ["대형창·베란다창", "30,000원부터"], ["곰팡이·심한 기름때", "30,000원부터"],
  ["니코틴·담배오염", "50,000원부터"], ["폐기물 배출대행", "20,000원부터"], ["화장실·베란다 추가", "각 30,000원"],
  ["복층", "30,000원부터"], ["당일 긴급·야간", "각 20%"], ["공사분진", "평당 3,000~5,000원"],
] as const;
