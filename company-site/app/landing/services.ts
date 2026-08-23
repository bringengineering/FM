import { recordsFor, type FieldRecord } from "./fieldRecords";

export type LandingSlug =
  | "stair-cleaning"
  | "building-care"
  | "move-in-cleaning";

export type LandingRecord = FieldRecord;

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
      "원주 원룸·다가구 계단과 복도 정기청소. 월 4회 6만원부터, 작업사진과 건물 이상사항을 함께 보고합니다.",
    title: "깨끗하게만 하지 않습니다.",
    accent: "건물 상태까지 확인합니다.",
    lead:
      "계단·복도 정기청소부터 조명·누수 흔적·적치물 확인까지. 작업 후 사진으로 확인하세요.",
    price: "월 4회 6만원부터",
    priceNote: "층수, 오염도, 작업 범위에 따라 달라질 수 있습니다.",
    heroImage: "/landing/common-area-issue.jpg",
    heroAlt: "브링케어가 관리 중인 원주 건물 공용부",
    facts: [
      { value: "월 4회", label: "정기 방문" },
      { value: "사진 제공", label: "작업 완료 확인" },
      { value: "이상 보고", label: "조명·누수·적치물" },
      { value: "원주", label: "지역 현장 대응" },
    ],
    scope: [
      { title: "계단·난간", copy: "층별 계단과 손이 자주 닿는 난간을 정리합니다." },
      { title: "복도·현관", copy: "공용 복도와 출입구의 먼지와 오염을 관리합니다." },
      { title: "우편함 주변", copy: "우편함과 공용 안내 공간을 함께 살핍니다." },
      { title: "공용창·문", copy: "손자국과 주변 오염을 확인해 정돈합니다." },
    ],
    records: recordsFor([
      "224382174945",
      "224382174370",
      "224382173190",
      "224382175661",
    ]),
    process: [
      { title: "건물 확인", copy: "주소, 층수, 공용부 상태를 확인합니다." },
      { title: "범위 협의", copy: "방문 횟수와 포함 범위를 정합니다." },
      { title: "정기 작업", copy: "약속한 일정에 공용부를 관리합니다." },
      { title: "사진 보고", copy: "완료 사진과 이상사항을 전달합니다." },
    ],
    faq: [
      {
        question: "청소 범위는 어디까지인가요?",
        answer: "계단, 복도, 현관 등 계약한 공용부를 기준으로 안내합니다.",
      },
      {
        question: "가격은 항상 6만원인가요?",
        answer: "6만원은 시작 가격이며 층수, 오염도, 범위에 따라 달라집니다.",
      },
      {
        question: "건물주가 원주에 없어도 되나요?",
        answer: "가능합니다. 작업 결과와 확인 사항을 사진으로 전달합니다.",
      },
    ],
  },
  "building-care": {
    slug: "building-care",
    eyebrow: "원주 원룸·다가구 건물관리",
    metaTitle: "원주 원룸·다가구 건물관리 | BRING CARE",
    metaDescription:
      "공실, 세입자 문의, 입퇴실과 건물 상태를 연결하는 원주 지역 공동관리. 월 8.9만원.",
    title: "멀리 있어도,",
    accent: "우리 건물의 오늘을 확인할 수 있습니다.",
    lead:
      "공실부터 세입자 문의, 입퇴실과 현장 확인까지 처리 결과를 사진과 기록으로 연결합니다.",
    price: "지역 공동관리 월 8.9만원",
    priceNote: "건물 규모와 관리 범위에 따라 별도 협의될 수 있습니다.",
    heroImage: "/landing/address-sign-after.jpg",
    heroAlt: "브링케어가 관리한 건물 입구 표식",
    facts: [
      { value: "공실", label: "상태 확인" },
      { value: "입퇴실", label: "현장 지원" },
      { value: "민원", label: "접수·연결" },
      { value: "사진", label: "처리 결과 보고" },
    ],
    scope: [
      { title: "공실 확인", copy: "비어 있는 호실의 상태와 필요한 조치를 확인합니다." },
      { title: "공용부 점검", copy: "조명, 표식, 적치물과 공용 공간을 살핍니다." },
      { title: "민원 연결", copy: "세입자 문의를 받고 필요한 담당과 연결합니다." },
      {
        title: "소규모 보수",
        copy: "현장 확인부터 자재·작업자 연결과 완료 확인까지 돕습니다.",
      },
    ],
    records: recordsFor([
      "224383896443",
      "224382176899",
      "224382176266",
      "224382169457",
      "224381122777",
      "224373338080",
    ]),
    process: [
      { title: "건물 등록", copy: "위치, 세대수, 현재 관리 상태를 확인합니다." },
      { title: "관리 범위 결정", copy: "필요한 항목과 보고 방식을 정합니다." },
      { title: "현장 대응", copy: "점검, 민원과 필요한 작업을 연결합니다." },
      { title: "결과 공유", copy: "사진과 처리 내용을 건물주에게 전달합니다." },
    ],
    faq: [
      {
        question: "원주 밖에 살아도 맡길 수 있나요?",
        answer: "가능합니다. 현장 확인과 처리 결과를 사진과 기록으로 전달합니다.",
      },
      {
        question: "8.9만원에 모든 수리비가 포함되나요?",
        answer:
          "관리 서비스 비용이며 자재와 전문 공사 비용은 사전 안내 후 별도입니다.",
      },
      {
        question: "청소만 먼저 맡길 수 있나요?",
        answer: "가능합니다. 공용부 청소 후 필요한 관리 범위를 함께 상담할 수 있습니다.",
      },
    ],
  },
  "move-in-cleaning": {
    slug: "move-in-cleaning",
    eyebrow: "원주 입주·이사청소",
    metaTitle: "원주 입주청소 10만원부터 | BRING CARE",
    metaDescription:
      "원주 원룸 입주청소 10만원부터. 작업 범위를 먼저 안내하고 완료 사진으로 확인합니다.",
    title: "새 공간의 첫날,",
    accent: "작업 범위와 완료 사진으로 확인하세요.",
    lead:
      "현관, 주방, 욕실, 창틀과 바닥의 작업 범위를 먼저 안내하고 완료 후 사진으로 확인합니다.",
    price: "원룸 10만원부터",
    priceNote: "평형, 오염도, 옵션과 추가 작업에 따라 달라질 수 있습니다.",
    heroImage: "/landing/move-in-condition.jpg",
    heroAlt: "입주 전 상태를 확인하는 원룸 내부",
    facts: [
      { value: "범위 안내", label: "작업 전 확인" },
      { value: "완료 사진", label: "작업 결과 확인" },
      { value: "원룸부터", label: "공간별 견적" },
      { value: "원주", label: "지역 상담" },
    ],
    scope: [
      { title: "현관", copy: "바닥, 문과 신발장 주변을 정리합니다." },
      { title: "주방", copy: "싱크대, 수납장과 조리 공간을 관리합니다." },
      { title: "욕실", copy: "세면대, 변기, 바닥과 벽면을 청소합니다." },
      { title: "창틀·바닥", copy: "창 주변 먼지와 실내 바닥을 마무리합니다." },
    ],
    records: recordsFor(["224382172156", "224368259003"]),
    process: [
      { title: "사진 상담", copy: "공간과 오염 상태를 먼저 확인합니다." },
      { title: "범위·가격 안내", copy: "포함 항목과 추가 항목을 구분합니다." },
      { title: "현장 작업", copy: "약속한 범위에 맞춰 청소합니다." },
      { title: "완료 확인", copy: "작업 후 상태를 사진으로 확인합니다." },
    ],
    faq: [
      {
        question: "10만원에 모든 평형이 가능한가요?",
        answer: "10만원은 원룸 기준 시작 가격이며 평형과 오염도에 따라 달라집니다.",
      },
      {
        question: "작업 범위를 미리 알 수 있나요?",
        answer: "상담 단계에서 포함 항목과 별도 항목을 구분해 안내합니다.",
      },
      {
        question: "청소 후 확인은 어떻게 하나요?",
        answer: "현장 확인 또는 작업 후 사진으로 완료 상태를 확인할 수 있습니다.",
      },
    ],
  },
};
