import { recordsFor, type FieldRecord } from "./fieldRecords";

export type LandingSlug =
  | "stair-cleaning"
  | "building-care"
  | "move-in-cleaning"
  | "turnover-care";

export type LandingRecord = FieldRecord;

type LandingFact = {
  value: string;
  label: string;
  image?: string;
  imageAlt?: string;
};

type LandingItem = {
  title: string;
  copy: string;
  image?: string;
  imageAlt?: string;
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
  cleaningResults: LandingItem[];
  imageCredit?: {
    label: string;
    href: string;
  };
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
    title: "원주 계단·공용부 ",
    accent: "정기청소",
    lead:
      "계단, 복도, 공동현관과 공용창까지 정기적으로 청소합니다. 작업이 끝나면 완료 사진과 현장에서 확인한 사항을 함께 보내드립니다.",
    price: "주 1회 3층 6만원부터",
    priceNote: "부가세 별도 · 4층 7만원, 5층 8만원 · 범위에 따라 변동",
    heroImage: "/landing/cleaning/stair-cleaning-example.jpg",
    heroAlt: "전문 장비를 든 작업자의 실내 청소 작업 예시",
    facts: [
      { value: "월 4회", label: "정기 방문" },
      { value: "사진 제공", label: "작업 완료 확인" },
      { value: "이상 보고", label: "조명·누수·적치물" },
      { value: "원주", label: "지역 현장 대응" },
    ],
    cleaningResults: [
      {
        title: "먼지·오염 제거",
        copy: "계단과 복도 바닥에 쌓인 먼지와 생활 오염을 정기적으로 정리합니다.",
      },
      {
        title: "손이 닿는 곳 정리",
        copy: "난간, 공동현관과 공용창 주변처럼 자주 접촉하는 곳을 함께 살핍니다.",
      },
      {
        title: "완료 사진 전달",
        copy: "건물주가 멀리 있어도 작업 후 상태를 사진으로 확인할 수 있습니다.",
      },
    ],
    imageCredit: {
      label: "사진 출처: Pexels",
      href: "https://www.pexels.com/photo/man-wearing-an-orange-coveralls-6197123/",
    },
    scope: [
      { title: "계단·난간", copy: "층별 계단의 먼지와 오염을 제거하고 난간 주변을 정리합니다." },
      { title: "복도 바닥", copy: "공용 복도 바닥의 먼지와 생활 오염을 정기적으로 청소합니다." },
      { title: "공동현관", copy: "출입구 바닥과 문 주변, 우편함 앞 공간을 정돈합니다." },
      { title: "공용창·창틀", copy: "공용창과 창틀에 쌓인 먼지와 손자국을 확인해 청소합니다." },
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
    price: "월 8만 9천원부터",
    priceNote: "부가세 별도 · 건물 규모와 관리 범위에 따라 변동",
    heroImage: "/landing/address-sign-after.jpg",
    heroAlt: "브링케어가 관리한 건물 입구 표식",
    facts: [
      { value: "공실", label: "상태 확인", image: "/landing/records/vacancy-check.jpg", imageAlt: "BRING CARE가 확인한 실제 공실 내부" },
      { value: "입퇴실", label: "현장 지원", image: "/landing/records/tenancy-check.jpg", imageAlt: "실제 입퇴실 현장 확인 기록" },
      { value: "민원", label: "접수·연결", image: "/landing/records/entrance-notices.jpg", imageAlt: "공동현관 안내문과 현장 확인 기록" },
      { value: "사진", label: "처리 결과 보고", image: "/landing/records/address-sign-work.jpg", imageAlt: "건물 표식 작업 완료 현장 기록" },
    ],
    cleaningResults: [
      { title: "공용부 청결 확인", copy: "방문 시 계단, 복도와 출입구의 청결 상태를 확인합니다.", image: "/landing/records/waste-cleanup.jpg", imageAlt: "실제 공용부 정리 현장" },
      { title: "관리 요소 확인", copy: "공실, 적치물과 수리가 필요한 부분을 현장에서 함께 살핍니다.", image: "/landing/records/defect-check.jpg", imageAlt: "실제 건물 하자 확인 현장" },
      { title: "처리 결과 공유", copy: "확인한 내용과 필요한 조치를 사진과 기록으로 전달합니다.", image: "/landing/records/address-sign-work.jpg", imageAlt: "실제 현장 조치 완료 기록" },
    ],
    scope: [
      { title: "공실 확인", copy: "비어 있는 호실의 상태와 필요한 조치를 확인합니다.", image: "/landing/movein-campaign/suit-cabinet.png", imageAlt: "정장을 입은 BRING CARE 관리자의 공실 점검 캠페인 이미지" },
      { title: "공용부 점검", copy: "조명, 표식, 적치물과 공용 공간을 살핍니다.", image: "/landing/campaign/suit-cobweb.png", imageAlt: "정장을 입은 BRING CARE 관리자의 공용부 점검 캠페인 이미지" },
      { title: "민원 연결", copy: "세입자 문의를 받고 필요한 담당과 연결합니다.", image: "/landing/campaign/suit-mailbox.png", imageAlt: "정장을 입은 BRING CARE 관리자의 현장 민원 확인 캠페인 이미지" },
      {
        title: "소규모 보수",
        copy: "현장 확인부터 자재·작업자 연결과 완료 확인까지 돕습니다.",
        image: "/landing/campaign/suit-entry-window.png",
        imageAlt: "정장을 입은 BRING CARE 관리자의 소규모 보수 확인 캠페인 이미지",
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
    price: "관리 건물 10만원 · 일반 단건 12만원부터",
    priceNote: "부가세 별도 · 평형, 오염도, 옵션과 추가 작업에 따라 변동",
    heroImage: "/landing/move-in-condition.jpg",
    heroAlt: "입주 전 상태를 확인하는 원룸 내부",
    facts: [
      { value: "범위 안내", label: "작업 전 확인" },
      { value: "완료 사진", label: "작업 결과 확인" },
      { value: "원룸부터", label: "공간별 견적" },
      { value: "원주", label: "지역 상담" },
    ],
    cleaningResults: [
      { title: "생활 먼지 제거", copy: "바닥, 수납장과 창틀에 남은 먼지를 공간별로 정리합니다." },
      { title: "주방·욕실 청소", copy: "기름때와 물때가 남기 쉬운 주방과 욕실을 집중적으로 청소합니다." },
      { title: "완료 상태 확인", copy: "작업이 끝난 공간을 확인하고 필요한 경우 완료 사진을 전달합니다." },
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
  "turnover-care": {
    slug: "turnover-care",
    eyebrow: "브링케어 24H 입·퇴실 관리 패키지",
    metaTitle: "원주 24H 입·퇴실 관리 | BRING CARE",
    metaDescription:
      "퇴실 14일 전부터 준비하는 원주 입·퇴실 관리. 퇴실 확인, 직영 청소, 필요한 보수 연결과 완료 사진을 한 흐름으로 관리합니다.",
    title: "퇴실 후에 움직이지 않습니다.",
    accent: "14일 전부터 준비합니다.",
    lead:
      "퇴실 확인부터 직영 청소, 필요한 보수 연결, 완료 사진과 다음 임대 준비까지 하나의 흐름으로 관리합니다.",
    price: "관리 건물 입·퇴실청소 10만원부터",
    priceNote: "부가세 별도 · 적용 조건 충족 시 24H 운영 기준",
    heroImage: "/landing/records/tenancy-check.jpg",
    heroAlt: "브링케어가 퇴실 상태를 확인한 실제 원룸 내부",
    facts: [
      { value: "D-14", label: "퇴실 전 사전 접수" },
      { value: "24H", label: "조건 충족 시 운영 기준" },
      { value: "직영 청소", label: "승인된 기본 범위" },
      { value: "사진 기록", label: "완료·인계 준비" },
    ],
    cleaningResults: [
      { title: "퇴실 상태 기록", copy: "잔존물, 오염과 파손 여부를 확인해 사진으로 남깁니다." },
      { title: "청소·경미한 정리", copy: "승인된 범위의 기본 청소와 정리를 바로 이어서 진행합니다." },
      { title: "다음 임대 준비", copy: "완료 사진과 현장 정보를 정리해 다음 안내에 활용할 수 있게 합니다." },
    ],
    scope: [
      { title: "퇴실 확인", copy: "출입 후 호실 상태와 필요한 작업을 확인합니다." },
      { title: "직영 청소", copy: "주방, 욕실, 창틀과 바닥의 승인된 기본 범위를 청소합니다." },
      { title: "보수 연결", copy: "전문작업이 필요하면 범위와 비용을 안내하고 승인 후 연결합니다." },
      { title: "완료 보고", copy: "작업 결과와 다음 확인 사항을 사진으로 전달합니다." },
    ],
    records: recordsFor(["224382172156", "224368259003", "224383896443", "224382176899"]),
    process: [
      { title: "D-14 접수", copy: "퇴실 일정과 출입 정보를 등록합니다." },
      { title: "사전 확인", copy: "작업 범위와 승인 항목을 정합니다." },
      { title: "퇴실 확인", copy: "오염, 잔존물과 수리 필요 여부를 기록합니다." },
      { title: "청소·정리", copy: "승인된 범위를 직영으로 진행합니다." },
      { title: "사진 기록", copy: "완료 상태와 추가 사항을 전달합니다." },
      { title: "D+1 인계 준비", copy: "다음 임대 안내를 위한 정보를 정리합니다." },
    ],
    faq: [
      { question: "24H가 임대차 계약까지 보장하나요?", answer: "아닙니다. 24H는 조건을 충족한 호실의 청소·정리·사진 기록·인계 준비를 마치는 운영 기준이며 임대차 계약을 보장하지 않습니다." },
      { question: "모든 수리가 24시간 안에 끝나나요?", answer: "아닙니다. 도배, 장판, 설비 등 전문작업이나 중대한 수리는 별도 일정과 승인이 필요합니다." },
      { question: "언제까지 신청해야 하나요?", answer: "퇴실 14일 전까지 접수해야 출입, 범위와 비용을 사전에 맞출 수 있습니다." },
    ],
  },
};
