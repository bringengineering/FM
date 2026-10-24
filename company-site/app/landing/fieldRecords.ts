export type FieldRecordCategory =
  | "common-area"
  | "environment"
  | "safety"
  | "vacancy";

export type FieldRecord = {
  id: string;
  category: FieldRecordCategory;
  image: string;
  alt: string;
  label: string;
  title: string;
  copy: string;
  sourceUrl: string;
};

export const fieldRecordCategories: Record<
  FieldRecordCategory,
  { label: string; description: string }
> = {
  "common-area": {
    label: "공용부 개선",
    description: "출입구와 복도에서 매일 마주치는 표식과 안내 환경을 정돈합니다.",
  },
  environment: {
    label: "환경 정비",
    description: "쓰레기, 잡초와 외벽 덩굴처럼 건물 인상을 해치는 요소를 정리합니다.",
  },
  safety: {
    label: "안전·하자 점검",
    description: "청소와 방문 과정에서 놓치기 쉬운 하자와 안전 요소를 확인합니다.",
  },
  vacancy: {
    label: "공실·임대 관리",
    description: "입주 전 공실과 관리 세대의 상태를 현장에서 확인하고 기록합니다.",
  },
};

export const fieldRecords: FieldRecord[] = [
  {
    id: "224383896443",
    category: "common-area",
    image: "/landing/records/address-sign-work.jpg",
    alt: "BRING CARE 작업자가 건물 입구 도로명주소판을 교체하는 모습",
    label: "공용부 개선",
    title: "낡은 도로명주소판 교체",
    copy: "건물 입구의 낡은 주소판을 확인하고 새 표식으로 교체했습니다.",
    sourceUrl: "https://blog.naver.com/bringcare/224383896443",
  },
  {
    id: "224382176899",
    category: "common-area",
    image: "/landing/records/unit-sign.jpg",
    alt: "개인정보를 가린 호수판과 새 벨 커버가 설치된 출입문",
    label: "공용부 개선",
    title: "호수판과 벨 커버 정비",
    copy: "작은 표식과 벨 커버를 정돈해 복도와 출입문의 인상을 개선했습니다.",
    sourceUrl: "https://blog.naver.com/bringcare/224382176899",
  },
  {
    id: "224382176266",
    category: "common-area",
    image: "/landing/records/entrance-notices.jpg",
    alt: "개인정보를 가린 건물 출입구 안내물 정비 현장",
    label: "공용부 개선",
    title: "건물 출입구 안내물 정리",
    copy: "뒤엉킨 종이 안내물을 걷어내고 출입 동선에 필요한 안내를 정돈했습니다.",
    sourceUrl: "https://blog.naver.com/bringcare/224382176266",
  },
  {
    id: "224382175661",
    category: "common-area",
    image: "/landing/records/digital-signage.jpg",
    alt: "개인정보를 가린 건물 입구 디지털 사이니지",
    label: "공용부 개선",
    title: "종이 공지를 디지털 안내로 개선",
    copy: "건물 입구 공지를 한눈에 확인할 수 있도록 디지털 안내 환경을 마련했습니다.",
    sourceUrl: "https://blog.naver.com/bringcare/224382175661",
  },
  {
    id: "224382174945",
    category: "environment",
    image: "/landing/records/waste-cleanup.jpg",
    alt: "건물 앞에 모여 있는 생활 쓰레기와 정리 대상 물품",
    label: "환경 정비",
    title: "건물 앞 쓰레기 정리",
    copy: "공용 공간을 막고 있던 쓰레기와 적치 상태를 확인해 정리했습니다.",
    sourceUrl: "https://blog.naver.com/bringcare/224382174945",
  },
  {
    id: "224382174370",
    category: "safety",
    image: "/landing/records/defect-check.jpg",
    alt: "공용부 청소 중 발견한 벽면 하자 흔적",
    label: "안전·하자 점검",
    title: "청소 중 발견한 벽면 하자",
    copy: "청소 과정에서 벽면 손상과 습기 흔적을 발견하고 현장 상태를 기록했습니다.",
    sourceUrl: "https://blog.naver.com/bringcare/224382174370",
  },
  {
    id: "224382173190",
    category: "safety",
    image: "/landing/records/fire-safety-pad.jpg",
    alt: "전기 화재 예방용 안전 패드를 설치하기 전 확인하는 모습",
    label: "안전·하자 점검",
    title: "입구 전기 화재예방 패드 설치",
    copy: "공용부 전기 사용 환경을 확인하고 화재 예방을 위한 안전 패드를 설치했습니다.",
    sourceUrl: "https://blog.naver.com/bringcare/224382173190",
  },
  {
    id: "224382172156",
    category: "vacancy",
    image: "/landing/records/tenancy-check.jpg",
    alt: "BRING CARE가 현장 점검한 관리 세대의 실내 모습",
    label: "공실·임대 관리",
    title: "관리 세대 현장 점검",
    copy: "임대차 계약 이후에도 세대 내부 상태와 필요한 조치 항목을 현장에서 확인했습니다.",
    sourceUrl: "https://blog.naver.com/bringcare/224382172156",
  },
  {
    id: "224382169457",
    category: "environment",
    image: "/landing/records/vine-overgrowth.jpg",
    alt: "건물 외벽을 따라 높게 자란 넝쿨의 정비 전 모습",
    label: "환경 정비",
    title: "건물 외벽 넝쿨 정리",
    copy: "외벽까지 자란 넝쿨을 확인하고 건물 주변 조경 정비를 진행했습니다.",
    sourceUrl: "https://blog.naver.com/bringcare/224382169457",
  },
  {
    id: "224381122777",
    category: "environment",
    image: "/landing/records/grounds-work.jpg",
    alt: "작업자가 관리 건물 주변 잡초와 덩굴을 정리하는 모습",
    label: "환경 정비",
    title: "무성한 잡초와 외벽 덩굴 정비",
    copy: "건물 주변의 잡초와 덩굴을 현장에서 확인하고 작업자와 정비했습니다.",
    sourceUrl: "https://blog.naver.com/bringcare/224381122777",
  },
  {
    id: "224373338080",
    category: "environment",
    image: "/landing/records/bulky-waste.jpg",
    alt: "건물 주변에 쌓인 대형폐기물과 정리 대상 물품",
    label: "환경 정비",
    title: "건물 주변 대형폐기물 신고·정리",
    copy: "건물 주변에 방치된 대형폐기물을 확인하고 신고부터 정리까지 연결했습니다.",
    sourceUrl: "https://blog.naver.com/bringcare/224373338080",
  },
  {
    id: "224368259003",
    category: "vacancy",
    image: "/landing/records/vacancy-check.jpg",
    alt: "입주 전 확인한 원룸 공실의 발코니와 실내 상태",
    label: "공실·임대 관리",
    title: "원룸 공실 입주 전 확인",
    copy: "입주 전에 공실 내부와 발코니, 비치 물품의 상태를 사진으로 확인했습니다.",
    sourceUrl: "https://blog.naver.com/bringcare/224368259003",
  },
];

export const fieldRecordById = new Map(
  fieldRecords.map((record) => [record.id, record]),
);

export function recordsFor(ids: string[]): FieldRecord[] {
  return ids.map((id) => {
    const record = fieldRecordById.get(id);
    if (!record) throw new Error(`Unknown BRING CARE field record: ${id}`);
    return record;
  });
}
