type PartnershipIconType = "vacancy" | "care" | "ready" | "brokerage";

const partnershipSteps = [
  {
    number: "01",
    title: "공실 확인",
    copy: "호실 상태와 필요한 조치를 현장에서 확인합니다.",
    icon: "vacancy" as const,
  },
  {
    number: "02",
    title: "청소·보수 조율",
    copy: "입주 가능한 상태로 필요한 작업을 준비합니다.",
    icon: "care" as const,
  },
  {
    number: "03",
    title: "임대 준비",
    copy: "완료 사진과 호실 정보를 보기 쉽게 정리합니다.",
    icon: "ready" as const,
  },
  {
    number: "04",
    title: "중개 연결",
    copy: "이지부동산중개법인이 임대차 상담과 중개를 진행합니다.",
    icon: "brokerage" as const,
  },
] as const;

function PartnershipIcon({ type }: { type: PartnershipIconType }) {
  const paths = {
    vacancy: (
      <>
        <path d="M4 20V8l8-4 8 4v12" />
        <path d="M8 20v-6h8v6M8 10h.01M16 10h.01" />
      </>
    ),
    care: (
      <>
        <path d="m14 6 4-4 4 4-4 4M16 8 8 16" />
        <path d="m8 14-5 5 2 2 5-5M4 5l5 5" />
      </>
    ),
    ready: (
      <>
        <path d="M6 3.5h12v17H6zM9 8h6M9 12h6" />
        <path d="m9 16 1.5 1.5L15 14" />
      </>
    ),
    brokerage: (
      <>
        <path d="M4 20V9l8-5 8 5v11M8 20v-6h8v6" />
        <path d="m15.5 9.5 2 2 3.5-4" />
      </>
    ),
  } as const;

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[type]}
    </svg>
  );
}

export default function BuildingCarePartnership() {
  return (
    <section
      id="real-estate-partnership"
      className="bc-section bc-partnership"
      aria-labelledby="bc-partnership-title"
    >
      <div className="bc-shell">
        <header className="bc-heading bc-partnership-heading">
          <p className="bc-kicker">VACANCY TO LEASING</p>
          <h2 id="bc-partnership-title">
            공실 확인에서 임대차 중개까지,{" "}
            <br />한 흐름으로 연결합니다.
          </h2>
          <p>
            BRING CARE가 공실 상태와 임대 준비를 관리하고, 임대차 상담과
            중개는 이지부동산중개법인이 진행합니다.
          </p>
        </header>

        <ol className="bc-partnership-flow">
          {partnershipSteps.map((step) => (
            <li
              key={step.number}
              className={
                step.icon === "brokerage"
                  ? "bc-partnership-brokerage"
                  : undefined
              }
            >
              <PartnershipIcon type={step.icon} />
              <span>{step.number}</span>
              <h3>{step.title}</h3>
              <p>{step.copy}</p>
            </li>
          ))}
        </ol>

        <div className="bc-partnership-roles">
          <strong>BRING CARE × 이지부동산중개법인</strong>
          <p>
            건물관리는 BRING CARE가, 임대차 중개는
            이지부동산중개법인이 담당합니다.
          </p>
          <a href="#building-care-consultation">공실·임대관리 상담</a>
        </div>
      </div>
    </section>
  );
}
