export const buildingCarePillars = [
  { id: "pm", english: "PROPERTY MANAGEMENT", title: "임대운영 관리", copy: "공실·입퇴실·임차인 연락을 한 흐름으로 관리합니다.", items: ["공실 상태 확인", "입퇴실 일정 조율", "임차인 문의 연결"], image: "/landing/records/vacancy-check.jpg" },
  { id: "fm", english: "FACILITY MANAGEMENT", title: "건물·시설 관리", copy: "공용부와 시설 상태를 현장에서 확인하고 기록합니다.", items: ["공용부 정기 확인", "조명·적치물 점검", "월간 관리보고"], image: "/landing/records/entrance-notices.jpg" },
  { id: "maintenance", english: "MAINTENANCE COORDINATION", title: "수리·보수 조율", copy: "필요한 작업을 확인하고 업체 연결부터 완료 확인까지 돕습니다.", items: ["현장 확인", "견적·일정 조율", "완료 사진 기록"], image: "/landing/records/defect-check.jpg" },
] as const;

export const managementSteps = ["상담·건물정보 확인", "현장 방문", "관리 범위 확정", "계약·인수인계", "정기 방문", "문제 확인·조율", "월간 보고"] as const;
export const turnoverSteps = ["퇴실 접수", "현장 확인", "청소 준비", "수리 확인", "폐기물 정리", "촬영 준비", "공실정보 정리", "중개사 공유", "입실 준비"] as const;

export const managementServices = [
  { icon: "▦", title: "시설관리", copy: "공용부와 주요 설비의 상태를 확인하고 조명·누수 흔적·적치물 등 현장 이상을 기록합니다." },
  { icon: "◌", title: "임차인 응대", copy: "문의와 민원을 한 창구에서 접수하고 상황 파악부터 담당자 연결, 결과 안내까지 관리합니다." },
  { icon: "⌁", title: "유지관리", copy: "수리·보수 필요 여부를 확인하고 견적, 일정, 승인과 완료 상태를 순서대로 확인합니다." },
  { icon: "↔", title: "입·퇴실 관리", copy: "퇴실 예정과 출입 일정을 파악하고 점검, 청소·보수 준비와 입주 전 확인을 연결합니다." },
  { icon: "□", title: "공실 관리", copy: "공실 상태와 임대 준비 항목을 확인하고 사진·정보를 정리해 협력 중개사와 연결합니다." },
  { icon: "✓", title: "관리기록", copy: "방문 이력, 현장 사진, 처리내역과 후속 확인 사항을 월간 관리보고로 전달합니다." },
] as const;

export const turnoverProcess = [
  { title: "퇴실 예정 파악", copy: "퇴실 예정일, 출입 방식과 현장 확인 일정을 사전에 정리합니다." },
  { title: "퇴실 현장 점검", copy: "호실 상태, 시설 이상, 잔존물과 청소·보수 필요 항목을 확인합니다." },
  { title: "청소·보수 통합 준비", copy: "퇴실청소, 폐기물 정리와 필요한 수리·보수의 범위와 일정을 함께 준비합니다." },
  { title: "공실 전환·임대 준비", copy: "작업 완료 상태를 확인하고 공실 사진과 임대 준비 정보를 정리합니다." },
  { title: "문의·방문 일정 연계", copy: "현장 상태와 방문 일정을 정리해 임대차 중개를 담당하는 이지부동산중개법인과 연결합니다." },
  { title: "다음 입주 관리", copy: "입주 전 최종 상태를 확인하고 인계한 뒤 전 과정을 관리기록으로 남깁니다." },
] as const;

export const buildingCareCases = [
  { title: "공실 상태 확인", copy: "비어 있는 호실의 상태와 필요한 조치를 현장에서 확인했습니다.", problem: "퇴실 후 호실 상태를 현장에서 확인하기 어려움", action: "호실과 설비 상태를 위치별로 촬영", result: "청소·수리 필요 항목과 현장 사진을 기록", image: "/landing/records/vacancy-check.jpg" },
  { title: "입·퇴실 현장 확인", copy: "일정에 맞춰 호실과 공용부 상태를 확인하고 기록했습니다.", problem: "입·퇴실 일정과 현장 상태가 따로 관리됨", action: "일정에 맞춰 호실과 공용부를 함께 확인", result: "인수인계에 필요한 확인 내용을 사진으로 정리", image: "/landing/records/tenancy-check.jpg" },
  { title: "건물 하자 확인", copy: "현장에서 발견한 손상 위치를 사진과 함께 정리했습니다.", problem: "손상 위치와 보수 범위를 원격으로 판단하기 어려움", action: "손상 부위와 주변 상태를 가까이에서 확인", result: "업체 상담에 필요한 위치와 상태를 기록", image: "/landing/records/defect-check.jpg" },
  { title: "적치물·폐기물 정리", copy: "방치된 물품의 범위를 확인하고 처리 과정을 기록했습니다.", problem: "공용부 적치물의 수량과 처리 범위가 불분명함", action: "대상 물품과 이동 동선을 먼저 확인", result: "처리 전후 상태와 남은 확인 사항을 기록", image: "/landing/records/waste-cleanup.jpg" },
  { title: "외부 환경 정비", copy: "건물 주변의 관리 범위를 확인하고 필요한 작업을 진행했습니다.", problem: "건물 외부 관리 범위를 현장에서 파악하기 어려움", action: "출입구와 건물 주변 관리 구간을 확인", result: "진행한 작업과 다음 관리 지점을 사진으로 정리", image: "/landing/records/grounds-work.jpg" },
] as const;

export const entryServices = [
  { title: "계단·공용부 정기청소", copy: "월 4회 정기방문과 월간 관리보고", href: "/stair-cleaning", cta: "청소 견적받기" },
  { title: "24H 입·퇴실 관리", copy: "퇴실 접수부터 다음 입실 준비까지", href: "#turnover-package", cta: "입퇴실 패키지 문의하기" },
] as const;

export const buildingCareFaq = [
  ["건물주가 원주에 없어도 가능한가요?", "가능합니다. 출입 방식과 승인 기준을 정한 뒤 현장 확인 내용과 처리 결과를 기록해 전달합니다."],
  ["어떤 건물을 관리하나요?", "원주 지역 원룸·다가구·소형 빌딩을 중심으로 상담합니다."],
  ["월 69,000원 기본 관리에는 무엇이 포함되나요?", "주 2회 정기 방문을 기준으로 공실·공용부 상태 확인, 문의 연결과 월간 보고를 제공합니다. 계단·공용부 정기청소는 월 4회 별도 상품입니다."],
  ["청소와 수리비도 포함인가요?", "월 관리비와 실제 청소·수리·자재 비용은 구분합니다. 필요한 작업은 사전 안내와 승인 후 진행합니다."],
  ["최소 계약기간이 있나요?", "안정적인 인수인계와 관리 기록을 위해 기본 6개월부터 운영합니다."],
  ["민원은 어떻게 처리하나요?", "내용을 접수하고 현장 확인 또는 담당 업체 연결이 필요한지 구분해 건물주에게 공유합니다."],
  ["관리보고는 어떻게 받나요?", "방문 이력, 확인 사항, 현장 사진과 후속 제안을 월간 단위로 정리해 전달합니다."],
  ["상담할 때 무엇이 필요한가요?", "건물 주소, 층수·세대수, 현재 관리 방식과 가장 불편한 점을 알려주시면 됩니다."],
] as const;
