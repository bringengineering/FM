import Image from "next/image";

const managementExperiences = [
  {
    category: "원거리 관리",
    title: "멀리 있어도 확인이 쉬워집니다.",
    copy: "방문 결과를 현장 사진과 확인 항목으로 정리해 건물주가 직접 이동하지 않아도 상태를 파악할 수 있습니다.",
    image: "/landing/records/vacancy-check.jpg",
    imageAlt: "BRING CARE 공실 확인 현장",
    tags: ["공실 확인", "현장 기록"],
  },
  {
    category: "통합 관리",
    title: "연락할 곳을 줄여드립니다.",
    copy: "공실·공용부·시설 문제를 한 곳에서 접수하고 필요한 업체 연결과 결과 확인을 정리합니다.",
    image: "/landing/records/tenancy-check.jpg",
    imageAlt: "BRING CARE 입퇴실 확인 현장",
    tags: ["입퇴실 관리", "공용부 확인"],
  },
  {
    category: "완료 기록",
    title: "확인에서 완료 기록까지 이어집니다.",
    copy: "발견한 문제와 진행한 조치, 남은 확인 사항을 한 흐름으로 정리해 전달합니다.",
    image: "/landing/records/defect-check.jpg",
    imageAlt: "BRING CARE 건물 하자 확인 현장",
    tags: ["시설 확인", "업체 연결"],
  },
] as const;

export default function BuildingCareExperienceCards() {
  return <section id="management-experience" className="bc-section bc-experience-section">
    <div className="bc-shell">
      <header className="bc-heading bc-experience-heading">
        <p className="bc-kicker">MANAGEMENT EXPERIENCE</p>
        <h2 aria-label="건물주가 체감하는 관리의 차이">건물주가 체감하는<br />관리의 차이</h2>
        <p>직접 다녀오지 않아도 현장 확인부터 후속 조치까지 한눈에 파악할 수 있습니다.</p>
      </header>
      <div className="bc-experience-grid">
        {managementExperiences.map((item) => <article className="bc-experience-card" key={item.title}>
          <div className="bc-experience-image">
            <Image src={item.image} alt={item.imageAlt} fill unoptimized sizes="(max-width: 700px) 100vw, 33vw" />
          </div>
          <div className="bc-experience-copy">
            <span>{item.category}</span>
            <h3>{item.title}</h3>
            <p>{item.copy}</p>
            <div>{item.tags.map((tag) => <b key={tag}>#{tag}</b>)}</div>
          </div>
        </article>)}
      </div>
    </div>
  </section>;
}
