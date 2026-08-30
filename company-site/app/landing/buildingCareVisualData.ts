export const activeCertifications = [
  { id: "rnd", title: "연구개발전담부서", issuer: "과학기술정보통신부 · 한국산업기술진흥협회", image: "/landing/certifications/rnd-department.webp" },
  { id: "venture", title: "벤처기업 확인", issuer: "벤처기업확인기관", validUntil: "2027.10.20", image: "/landing/certifications/venture.webp" },
  { id: "startup", title: "창업기업 확인", issuer: "강원지방중소벤처기업청", validUntil: "2028.09.24", image: "/landing/certifications/startup.webp" },
] as const;

export const serviceVisuals = [
  { icon: "□", title: "공실 관리", copy: "빈 호실의 상태와 필요한 조치를 확인합니다." },
  { icon: "↔", title: "입·퇴실 관리", copy: "퇴실 접수부터 다음 입실 준비까지 연결합니다." },
  { icon: "✦", title: "공용부 청소", copy: "계단·현관·우편함을 정기적으로 관리합니다." },
  { icon: "⌁", title: "시설 점검", copy: "조명·누수 흔적·적치물 등 이상을 살핍니다." },
  { icon: "●", title: "민원 연결", copy: "내용을 확인하고 필요한 담당자와 연결합니다." },
  { icon: "＋", title: "수리·보수 조율", copy: "견적과 일정을 조율하고 완료를 기록합니다." },
] as const;

export const directVsBringRows = [
  { label: "연락 창구", direct: "업체마다 개별 연락", bring: "BRING CARE 한 곳" },
  { label: "현장 확인", direct: "건물주 직접 방문", bring: "원주 직영팀 확인" },
  { label: "업체 조율", direct: "건물주가 일정 조율", bring: "범위·일정 통합 조율" },
  { label: "완료 확인", direct: "재방문 또는 개별 확인", bring: "완료 사진으로 확인" },
  { label: "관리 기록", direct: "문자·사진에 분산", bring: "방문별 기록 정리" },
  { label: "월간 보고", direct: "건물주가 직접 취합", bring: "월간 관리보고 제공" },
] as const;

export const managementScopeRows = [
  { label: "정기 현장 확인", included: true, separate: false },
  { label: "공실·공용부 상태 기록", included: true, separate: false },
  { label: "민원·업체 연결", included: true, separate: false },
  { label: "월간 관리보고", included: true, separate: false },
  { label: "실제 청소 작업비", included: false, separate: true },
  { label: "수리·자재·전문 시공비", included: false, separate: true },
  { label: "폐기물 처리비", included: false, separate: true },
] as const;

export const managementCycle = [
  { title: "확인", copy: "공실과 공용부의 현재 상태를 현장에서 봅니다.", image: "/landing/records/vacancy-check.jpg" },
  { title: "조율", copy: "필요한 작업의 범위·금액·일정을 먼저 정리합니다.", image: "/landing/records/tenancy-check.jpg" },
  { title: "처리", copy: "승인된 청소·수리·정비를 담당자와 연결합니다.", image: "/landing/records/grounds-work.jpg" },
  { title: "보고", copy: "완료 사진과 다음 확인 사항을 기록해 전달합니다.", image: "/landing/records/defect-check.jpg" },
] as const;
