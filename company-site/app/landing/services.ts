export type LandingSlug =
  | "stair-cleaning"
  | "building-care"
  | "move-in-cleaning";

export type LandingRecord = {
  title: string;
  source: string;
  alt: string;
};

type LandingFact = {
  value: string;
  label: string;
};

type LandingItem = {
  title: string;
  copy: string;
};

type LandingFaq = {
  question: string;
  answer: string;
};

export type LandingService = {
  slug: LandingSlug;
  eyebrow: string;
  metaTitle: string;
  metaDescription: string;
  title: string;
  accent: string;
  lead: string;
  price: string;
  priceNote: string;
  heroImage: string;
  heroAlt: string;
  facts: LandingFact[];
  scope: LandingItem[];
  records: LandingRecord[];
  process: LandingItem[];
  faq: LandingFaq[];
};

export const landingServices: Record<LandingSlug, LandingService> = {
  "stair-cleaning": {
    slug: "stair-cleaning",
    eyebrow: "원주 원룸·다가구 계단청소",
    metaTitle: "원주 계단·공용부 청소 | BRING CARE",
    metaDescription:
      "원주 원룸·다가구 건물의 계단과 공용부를 정기적으로 관리합니다. 작업 범위를 확인하고 사진으로 작업 내용을 공유합니다.",
    title: "깨끗하게만 하지 않습니다.",
    accent: "건물 상태까지 확인합니다.",
    lead:
      "계단청소를 시작으로 건물의 공용부 상태를 살피고, 필요한 작업 범위를 함께 정리합니다.",
    price: "월 4회 6만원부터",
    priceNote: "층수·오염도·작업 범위에 따라 비용이 달라질 수 있습니다.",
    heroImage: "/landing/common-area-issue.jpg",
    heroAlt: "관리 전 상태가 보이는 원룸 건물 공용 계단",
    facts: [
      { value: "월 4회", label: "정기 방문 기준" },
      { value: "공용부", label: "계단과 복도 중심" },
      { value: "사진 공유", label: "작업 후 확인" },
    ],
    scope: [
      { title: "계단·난간", copy: "먼지와 오염이 쌓이는 계단, 난간을 닦습니다." },
      { title: "복도·현관", copy: "입주자가 함께 쓰는 복도와 현관을 정리합니다." },
      { title: "우편함 주변", copy: "우편함 주변의 먼지와 작은 쓰레기를 확인합니다." },
      { title: "공용창·문", copy: "공용으로 사용하는 창과 문의 상태를 살핍니다." },
    ],
    records: [],
    process: [
      { title: "건물 상태 확인", copy: "현장을 보고 현재 오염과 관리 상태를 확인합니다." },
      { title: "범위 합의", copy: "필요한 공용부와 방문 주기를 함께 정합니다." },
      { title: "정기 작업", copy: "합의한 범위에 맞춰 정기적으로 청소합니다." },
      { title: "작업 사진 보고", copy: "작업 후 사진과 확인할 내용을 전달합니다." },
    ],
    faq: [
      {
        question: "어느 범위까지 계단청소를 하나요?",
        answer:
          "기본 범위는 계단·난간, 복도·현관 등 공용부입니다. 우편함 주변과 공용창·문은 현장 확인 후 범위를 정합니다.",
      },
      {
        question: "6만원부터라는 가격은 어떻게 정해지나요?",
        answer:
          "월 4회 기준 시작 가격이며, 층수·오염도·작업 범위에 따라 상담 후 달라질 수 있습니다.",
      },
      {
        question: "원주에 없는 건물주도 맡길 수 있나요?",
        answer:
          "가능합니다. 현장 확인과 작업 사진을 바탕으로 건물 상태와 작업 내용을 전달드립니다.",
      },
    ],
  },
  "building-care": {
    slug: "building-care",
    eyebrow: "원주 원룸·다가구 건물관리",
    metaTitle: "원주 원룸·다가구 건물관리 | BRING CARE",
    metaDescription:
      "원주 원룸·다가구 건물의 공용부와 공실을 확인하고, 필요한 민원과 소규모 보수를 연결합니다.",
    title: "멀리 있어도,",
    accent: "우리 건물의 오늘을 확인할 수 있습니다.",
    lead:
      "자주 방문하기 어려운 건물도 공용부와 공실의 상태를 확인하고, 필요한 다음 일을 정리합니다.",
    price: "지역 공동관리 월 8.9만원",
    priceNote: "관리 범위와 방문 주기는 건물 상태와 요청 사항에 따라 상담합니다.",
    heroImage: "/landing/address-sign-after.jpg",
    heroAlt: "건물 주소 표지와 정돈된 건물 외부",
    facts: [
      { value: "공실 확인", label: "비어 있는 호실 점검" },
      { value: "공용부", label: "건물 상태 확인" },
      { value: "사진 보고", label: "확인 내용 공유" },
    ],
    scope: [
      { title: "공실 확인", copy: "요청한 호실을 방문해 기본 상태를 확인합니다." },
      { title: "공용부 점검", copy: "계단·복도 등 공용부의 상태와 변화를 살핍니다." },
      { title: "민원 연결", copy: "확인된 요청을 정리해 필요한 대응으로 연결합니다." },
      { title: "소규모 보수", copy: "현장에서 확인 가능한 작은 보수의 진행을 조율합니다." },
    ],
    records: [],
    process: [
      { title: "건물 정보 확인", copy: "주소와 관리가 필요한 공간, 요청 사항을 확인합니다." },
      { title: "관리 범위 합의", copy: "방문 주기와 점검·연결 범위를 함께 정합니다." },
      { title: "현장 확인", copy: "합의한 범위에 따라 공실과 공용부를 방문합니다." },
      { title: "상태 보고", copy: "확인 사진과 필요한 다음 일을 정리해 전달합니다." },
    ],
    faq: [
      {
        question: "원주에 없는 건물주도 건물관리를 맡길 수 있나요?",
        answer:
          "가능합니다. 방문 후 공실과 공용부의 확인 내용을 사진과 함께 전달해 현장 상황을 파악할 수 있게 합니다.",
      },
      {
        question: "소규모 보수 비용도 월 관리비에 포함되나요?",
        answer:
          "보수에 필요한 자재비와 외부 작업비는 관리비에 포함되지 않습니다. 확인 후 비용과 진행 방법을 먼저 안내합니다.",
      },
      {
        question: "청소부터 먼저 상담할 수도 있나요?",
        answer:
          "가능합니다. 계단·복도 같은 공용부 청소만 먼저 정하고, 이후 필요한 관리 범위를 상담할 수 있습니다.",
      },
    ],
  },
  "move-in-cleaning": {
    slug: "move-in-cleaning",
    eyebrow: "원주 입주·이사청소",
    metaTitle: "원주 입주·이사청소 | BRING CARE",
    metaDescription:
      "원주 원룸 입주·이사청소를 현장 상태와 요청 범위에 맞춰 진행하고, 작업 전후 사진으로 확인할 수 있게 합니다.",
    title: "새 공간의 첫날,",
    accent: "작업 전후 사진으로 확인하세요.",
    lead:
      "입주 전 비어 있는 공간의 상태를 확인하고, 필요한 청소 범위를 정한 뒤 작업 전후를 사진으로 남깁니다.",
    price: "원룸 10만원부터",
    priceNote: "현장 상태와 청소 범위에 따라 상담 후 비용이 달라질 수 있습니다.",
    heroImage: "/landing/move-in-condition.jpg",
    heroAlt: "입주 전 원룸의 청소 상태를 확인하는 모습",
    facts: [
      { value: "원룸", label: "10만원부터" },
      { value: "전후 사진", label: "작업 내용 확인" },
      { value: "범위 상담", label: "현장 상태 기준" },
    ],
    scope: [
      { title: "현관", copy: "입주자가 처음 사용하는 현관의 먼지와 오염을 정리합니다." },
      { title: "주방", copy: "싱크대와 조리 공간을 중심으로 청소 범위를 확인합니다." },
      { title: "욕실", copy: "욕실의 물때와 먼지 등 눈에 보이는 오염을 정리합니다." },
      { title: "창틀·바닥", copy: "창틀과 바닥의 먼지를 확인하고 청소합니다." },
    ],
    records: [],
    process: [
      { title: "현장 상태 확인", copy: "비어 있는 공간의 오염과 청소가 필요한 곳을 확인합니다." },
      { title: "청소 범위 합의", copy: "현장 상태와 요청 사항을 기준으로 범위를 정합니다." },
      { title: "청소 작업", copy: "합의한 공간과 항목에 맞춰 청소를 진행합니다." },
      { title: "전후 사진 전달", copy: "작업 전후 사진으로 진행 내용과 상태를 확인합니다." },
    ],
    faq: [
      {
        question: "원룸 10만원부터라는 시작 가격에 포함되는 범위는 무엇인가요?",
        answer:
          "원룸 기준 시작 가격이며, 현관·주방·욕실·창틀·바닥 등 실제 청소 범위와 상태를 확인한 뒤 최종 안내합니다.",
      },
      {
        question: "청소 범위는 현장에서 바꿀 수 있나요?",
        answer:
          "가능합니다. 작업 전 상태를 확인하고 추가로 필요한 범위가 있으면 비용과 함께 먼저 협의합니다.",
      },
      {
        question: "청소가 끝난 뒤 사진을 받을 수 있나요?",
        answer:
          "네. 합의한 범위의 작업 전후 사진을 전달해 작업 내용을 확인할 수 있게 합니다.",
      },
    ],
  },
};
