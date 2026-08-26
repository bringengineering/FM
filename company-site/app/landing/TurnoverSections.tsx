const timeline = [
  { title: "D-14 접수", copy: "퇴실 일정과 출입 가능 시간을 먼저 등록합니다." },
  { title: "사전 확인", copy: "청소·정리 범위와 필요한 보수 가능성을 확인합니다." },
  { title: "퇴실 확인", copy: "잔존물, 오염, 파손과 계량기 상태를 기록합니다." },
  { title: "청소·정리", copy: "승인된 범위의 직영 청소와 경미한 정리를 진행합니다." },
  { title: "사진 기록", copy: "완료 상태와 추가 확인 사항을 사진으로 전달합니다." },
  { title: "D+1 인계 준비", copy: "다음 임대 안내에 사용할 수 있도록 현장 정보를 정리합니다." },
];

const delays = [
  "출입 비밀번호나 열쇠 전달이 늦어진 경우",
  "작업 범위와 비용 승인이 완료되지 않은 경우",
  "도배·장판·설비 등 중대한 추가 수리가 필요한 경우",
  "대량 폐기물이나 심한 특수 오염이 확인된 경우",
  "면허·전문 장비가 필요한 외부 전문작업이 포함된 경우",
];

export default function TurnoverSections() {
  return (
    <div className="turnover-sections">
      <section
        className="turnover-standard"
        id="turnover-standard"
        aria-labelledby="turnover-standard-title"
      >
        <div className="landing-section-inner turnover-standard-grid">
          <div>
            <p className="landing-eyebrow">24H 운영 기준</p>
            <h2 id="turnover-standard-title">빠른 청소보다 중요한 것은 미리 준비하는 흐름입니다.</h2>
          </div>
          <p className="turnover-standard-statement">
            퇴실 14일 전까지 접수되고 출입·작업 범위·비용 승인이 완료된 호실 중
            중대한 추가 수리가 없는 경우, 퇴실 확인 시점부터 24시간 안에
            청소·경미한 정리·사진 기록·인계 준비를 마치는 것을 운영 기준으로 합니다.
          </p>
        </div>
      </section>

      <section className="turnover-comparison" aria-labelledby="turnover-comparison-title">
        <div className="landing-section-inner">
          <div className="landing-section-heading">
            <p>대응 방식의 차이</p>
            <h2 id="turnover-comparison-title">퇴실 후 연락을 돌리는 시간을 줄입니다.</h2>
          </div>
          <div className="turnover-comparison-grid">
            <article>
              <span>일반적인 사후 대응</span>
              <h3>퇴실 확인 뒤 업체를 찾습니다.</h3>
              <p>현장 확인, 견적, 승인과 일정 조율이 차례로 시작되어 임대 준비가 늦어질 수 있습니다.</p>
            </article>
            <article className="turnover-comparison-active">
              <span>BRING CARE 사전 준비</span>
              <h3>퇴실 14일 전부터 순서를 맞춥니다.</h3>
              <p>출입과 작업 범위를 먼저 정해 퇴실 확인 직후 필요한 작업이 이어지도록 준비합니다.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="turnover-timeline" aria-labelledby="turnover-timeline-title">
        <div className="landing-section-inner">
          <div className="landing-section-heading">
            <p>D-14 → D+1</p>
            <h2 id="turnover-timeline-title">한 번의 접수로 여섯 단계를 연결합니다.</h2>
          </div>
          <ol>
            {timeline.map((item, index) => (
              <li key={item.title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{item.title}</h3>
                <p>{item.copy}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="turnover-boundaries" aria-labelledby="turnover-boundaries-title">
        <div className="landing-section-inner">
          <div className="landing-section-heading">
            <p>적용 조건과 역할</p>
            <h2 id="turnover-boundaries-title">직접 하는 일과 승인이 필요한 일을 구분합니다.</h2>
          </div>
          <div className="turnover-role-grid">
            <article><span>01</span><h3>BRING CARE 직접 수행</h3><p>현장 확인, 기본 청소, 경미한 정리와 완료 사진 기록</p></article>
            <article><span>02</span><h3>외부 전문업체</h3><p>도배, 장판, 설비, 전기와 전문 장비가 필요한 작업</p></article>
            <article><span>03</span><h3>건물주 승인</h3><p>작업 범위, 비용과 외부 전문작업 진행 여부의 최종 승인</p></article>
          </div>
          <div className="turnover-delay-card">
            <h3>24H 운영 기준에서 제외되거나 일정이 달라질 수 있는 경우</h3>
            <ul>{delays.map((delay) => <li key={delay}>{delay}</li>)}</ul>
            <p>외부 전문작업 연결·조율 비용은 건물주가 승인한 작업금액의 5%이며, 실제 시공비는 별도입니다.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
