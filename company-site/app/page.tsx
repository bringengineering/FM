const services = [
  {
    number: "01",
    title: "시설 운영 관리",
    copy: "점검, 보수, 일정, 협력업체 업무를 한 흐름으로 관리해 시설의 빈틈을 줄입니다.",
    tag: "OPERATION",
  },
  {
    number: "02",
    title: "임대·입금 관리",
    copy: "건물·호실·세입자 기준으로 계약과 납부 일정을 정리해 확인 업무를 단순하게 만듭니다.",
    tag: "RENT & PAYMENT",
  },
  {
    number: "03",
    title: "민원 대응",
    copy: "접수부터 담당 지정, 처리, 완료까지 기록해 고객과 현장이 같은 진행 상황을 공유합니다.",
    tag: "CARE DESK",
  },
  {
    number: "04",
    title: "공사·견적 관리",
    copy: "현장 확인, 견적 비교, 승인, 시공, 정산을 연결해 의사결정과 책임을 분명하게 합니다.",
    tag: "PROJECT",
  },
  {
    number: "05",
    title: "에너지·안전 점검",
    copy: "시설별 점검 기준과 이력을 축적해 예방 중심의 운영 기반을 만듭니다.",
    tag: "SAFETY",
  },
  {
    number: "06",
    title: "운영 데이터·보고",
    copy: "흩어진 현장 기록을 한눈에 볼 수 있는 정보로 바꿔 더 나은 운영 판단을 돕습니다.",
    tag: "INSIGHT",
  },
];

const process = [
  ["현장 파악", "건물과 운영 환경, 현재 업무 흐름을 함께 살펴봅니다."],
  ["기준 설계", "시설별 점검·보고·대응 기준과 담당 흐름을 정리합니다."],
  ["실행·연결", "현장 업무와 디지털 기록을 연결해 운영을 시작합니다."],
  ["개선·보고", "축적된 이력을 바탕으로 반복 문제와 비용 구조를 개선합니다."],
];

const capabilities = [
  "업무 흐름 보드",
  "입금 캘린더",
  "민원 처리 이력",
  "견적·공사 기록",
];

export default function Home() {
  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Bring Care 홈으로 이동">
          <span className="brand-image" aria-hidden="true" />
        </a>
        <nav className="nav-links" aria-label="주요 메뉴">
          <a href="#services">서비스</a>
          <a href="#method">운영 방식</a>
          <a href="#digital">디지털 FM</a>
          <a href="#company">회사 정보</a>
        </nav>
        <a className="header-cta" href="#company">
          회사 소개
          <span aria-hidden="true">↘</span>
        </a>
      </header>

      <section className="hero" id="top">
        <div className="hero-glow" aria-hidden="true" />
        <div className="hero-copy">
          <p className="eyebrow">
            <span />
            FACILITY MANAGEMENT · WONJU
          </p>
          <h1>
            관리의 모든 흐름을,
            <br />
            <em>하나의 기준</em>으로.
          </h1>
          <p className="hero-lede">
            브링케어는 시설·임대·민원·공사 데이터를 연결해
            <br className="desktop-break" />
            현장이 더 빠르고 정확하게 움직이도록 돕는 FM 운영 파트너입니다.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href="#services">
              서비스 살펴보기
              <span aria-hidden="true">→</span>
            </a>
            <a className="text-link" href="#company">
              브링엔지니어링 소개
              <span aria-hidden="true">↘</span>
            </a>
          </div>
        </div>

        <div className="hero-visual" aria-label="브링케어 FM 운영 흐름">
          <div className="visual-topline">
            <span>CARE FLOW</span>
            <span>FM / 01</span>
          </div>
          <div className="orbit orbit-one" aria-hidden="true" />
          <div className="orbit orbit-two" aria-hidden="true" />
          <div className="flow-core">
            <span className="core-kicker">BRING</span>
            <strong>CARE</strong>
            <span className="core-caption">Connected operation</span>
          </div>
          <div className="flow-node node-a">
            <span>01</span>
            시설
          </div>
          <div className="flow-node node-b">
            <span>02</span>
            임대
          </div>
          <div className="flow-node node-c">
            <span>03</span>
            민원
          </div>
          <div className="flow-node node-d">
            <span>04</span>
            공사
          </div>
          <div className="visual-footer">
            <span>FIELD</span>
            <i />
            <span>DATA</span>
            <i />
            <span>REPORT</span>
          </div>
        </div>
      </section>

      <section className="value-strip" aria-label="브링케어 핵심 가치">
        <p>현장을 이해하고</p>
        <span aria-hidden="true">+</span>
        <p>업무를 연결하고</p>
        <span aria-hidden="true">+</span>
        <p>기록으로 개선합니다</p>
      </section>

      <section className="section services" id="services">
        <div className="section-heading">
          <p className="section-label">WHAT WE CARE</p>
          <div>
            <h2>
              건물 운영에 필요한 일을
              <br />
              <span>끊김 없이 연결합니다.</span>
            </h2>
            <p>
              시설의 상태와 사람의 업무가 따로 움직이지 않도록,
              <br className="desktop-break" />
              현장의 전 과정을 하나의 관리 체계로 설계합니다.
            </p>
          </div>
        </div>
        <div className="service-grid">
          {services.map((service) => (
            <article className="service-card" key={service.number}>
              <div className="card-top">
                <span className="card-number">{service.number}</span>
                <span className="card-arrow" aria-hidden="true">
                  ↗
                </span>
              </div>
              <div>
                <p className="card-tag">{service.tag}</p>
                <h3>{service.title}</h3>
                <p className="card-copy">{service.copy}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="method" id="method">
        <div className="method-intro">
          <p className="section-label section-label-light">HOW WE WORK</p>
          <h2>
            현장을 먼저 보고,
            <br />
            운영 기준을 만듭니다.
          </h2>
          <p>
            정해진 답을 가져오기보다 건물과 사용자,
            <br />
            기존 업무에 맞는 실행 가능한 방법을 찾습니다.
          </p>
        </div>
        <ol className="process-list">
          {process.map(([title, copy], index) => (
            <li key={title}>
              <span className="process-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <h3>{title}</h3>
                <p>{copy}</p>
              </div>
              <span className="process-mark" aria-hidden="true">
                +
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="section digital" id="digital">
        <div className="digital-panel">
          <div className="digital-ui" aria-label="FM 운영 데이터 예시 화면">
            <div className="ui-header">
              <span className="ui-brand">BRING FM</span>
              <span className="ui-live">
                <i />
                LIVE
              </span>
            </div>
            <div className="ui-body">
              <aside className="ui-sidebar">
                <span className="active" />
                <span />
                <span />
                <span />
              </aside>
              <div className="ui-content">
                <div className="ui-title-row">
                  <div>
                    <small>OPERATION BOARD</small>
                    <strong>오늘의 운영 현황</strong>
                  </div>
                  <span className="ui-date">07.23</span>
                </div>
                <div className="ui-metrics">
                  <div>
                    <span>점검 예정</span>
                    <strong>08</strong>
                    <i className="lime" />
                  </div>
                  <div>
                    <span>처리 중</span>
                    <strong>03</strong>
                    <i />
                  </div>
                  <div>
                    <span>완료</span>
                    <strong>12</strong>
                    <i className="soft" />
                  </div>
                </div>
                <div className="ui-chart">
                  <span style={{ height: "32%" }} />
                  <span style={{ height: "58%" }} />
                  <span style={{ height: "43%" }} />
                  <span style={{ height: "76%" }} />
                  <span style={{ height: "64%" }} />
                  <span style={{ height: "91%" }} />
                  <span style={{ height: "70%" }} />
                </div>
                <div className="ui-list">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </div>
          </div>

          <div className="digital-copy">
            <p className="section-label section-label-light">DIGITAL FM</p>
            <h2>
              기억에 의존하던 관리에서,
              <br />
              <span>데이터가 남는 운영으로.</span>
            </h2>
            <p>
              브링케어는 현장의 실제 업무를 디지털 흐름으로 연결합니다.
              담당자가 바뀌어도 기록은 남고, 다음 판단은 더 빨라집니다.
            </p>
            <ul>
              {capabilities.map((item) => (
                <li key={item}>
                  <span aria-hidden="true">✓</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="belief">
        <p className="belief-kicker">BRING CARE STANDARD</p>
        <blockquote>
          좋은 시설관리는
          <br />
          문제가 생긴 뒤 움직이는 일이 아니라,
          <br />
          <em>문제가 커지기 전에 연결하는 일</em>이라고 믿습니다.
        </blockquote>
        <div className="belief-line">
          <span />
          <p>CARE · CONNECT · IMPROVE</p>
          <span />
        </div>
      </section>

      <section className="company" id="company">
        <div className="company-copy">
          <p className="section-label">COMPANY</p>
          <h2>
            현장과 기술을 잇는
            <br />
            <span>FM 엔지니어링 파트너.</span>
          </h2>
          <p>
            브링엔지니어링은 공학 연구개발과 응용 소프트웨어 역량을 바탕으로
            시설관리의 실행력과 디지털 전환을 함께 만듭니다.
          </p>
          <a
            className="button button-dark"
            href="https://map.kakao.com/link/search/%EC%83%81%EC%A7%80%EB%8C%80%EA%B8%B8%2083"
            target="_blank"
            rel="noreferrer"
          >
            회사 위치 확인
            <span aria-hidden="true">↗</span>
          </a>
        </div>

        <div className="company-card">
          <div className="company-logo">
            <span className="brand-image" aria-hidden="true" />
          </div>
          <dl>
            <div>
              <dt>상호</dt>
              <dd>브링엔지니어링</dd>
            </div>
            <div>
              <dt>대표자</dt>
              <dd>서창환</dd>
            </div>
            <div>
              <dt>사업자등록번호</dt>
              <dd>748-28-01935</dd>
            </div>
            <div>
              <dt>개업일</dt>
              <dd>2025. 06. 11.</dd>
            </div>
            <div className="wide">
              <dt>사업장</dt>
              <dd>
                강원특별자치도 원주시 상지대길 83,
                <br />
                벤처창업관동 3층 305호
              </dd>
            </div>
            <div className="wide">
              <dt>사업 분야</dt>
              <dd>
                기타 공학 연구개발업
                <br />
                응용 소프트웨어 개발 및 공급업
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <footer>
        <div className="footer-top">
          <div>
            <span className="footer-brand">Bring Care</span>
            <p>관리의 모든 흐름을 연결합니다.</p>
          </div>
          <a href="#top" aria-label="페이지 맨 위로 이동">
            TOP
            <span aria-hidden="true">↑</span>
          </a>
        </div>
        <div className="footer-bottom">
          <p>
            브링엔지니어링 · 대표 서창환 · 사업자등록번호 748-28-01935
          </p>
          <p>
            강원특별자치도 원주시 상지대길 83, 벤처창업관동 3층 305호
          </p>
          <p>© 2026 BRING ENGINEERING. ALL RIGHTS RESERVED.</p>
        </div>
      </footer>
    </main>
  );
}
