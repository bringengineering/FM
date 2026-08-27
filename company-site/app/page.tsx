const services = [
  {
    number: "01",
    en: "FACILITY",
    title: "시설 운영 관리",
    copy: "점검·보수·일정을 기준화해 시설의 상태와 다음 조치를 명확하게 관리합니다.",
  },
  {
    number: "02",
    en: "RENT & PAYMENT",
    title: "임대·입금 관리",
    copy: "건물과 호실, 계약과 납부 일정을 연결해 반복 확인 업무를 줄입니다.",
  },
  {
    number: "03",
    en: "CARE DESK",
    title: "민원 대응",
    copy: "접수부터 담당 지정, 처리와 완료 보고까지 하나의 이력으로 남깁니다.",
  },
  {
    number: "04",
    en: "PROJECT",
    title: "공사·견적 관리",
    copy: "현장 확인, 견적 비교, 승인, 시공, 정산의 책임과 진행 상황을 연결합니다.",
  },
  {
    number: "05",
    en: "SAFETY",
    title: "에너지·안전 점검",
    copy: "시설별 점검 기준과 이력을 쌓아 예방 중심의 운영 기반을 만듭니다.",
  },
  {
    number: "06",
    en: "INSIGHT",
    title: "운영 데이터·보고",
    copy: "흩어진 현장 기록을 한눈에 볼 수 있는 정보로 바꿔 판단을 돕습니다.",
  },
];

const flow = [
  {
    number: "01",
    title: "요청을 받습니다",
    copy: "현장 이슈와 요청 내용을 빠짐없이 기록합니다.",
  },
  {
    number: "02",
    title: "담당을 연결합니다",
    copy: "업무 성격에 맞는 담당과 처리 기준을 지정합니다.",
  },
  {
    number: "03",
    title: "과정을 남깁니다",
    copy: "진행 상황, 사진, 견적과 의사결정을 한곳에 모읍니다.",
  },
  {
    number: "04",
    title: "완료를 확인합니다",
    copy: "처리 결과를 공유하고 다음 점검과 개선으로 이어갑니다.",
  },
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
        <a
          className="brand"
          href="#top"
          aria-label="Bring Care · bringengineering 홈으로 이동"
        >
          <span className="brand-image" aria-hidden="true" />
          <span className="brand-engineering" aria-hidden="true">
            <strong>bring</strong>engineering
          </span>
        </a>
        <nav className="nav-links" aria-label="주요 메뉴">
          <a href="#services">서비스</a>
          <a href="#standard">운영 기준</a>
          <a href="#digital">디지털 FM</a>
          <a href="#company">회사 정보</a>
        </nav>
        <a className="header-cta" href="/consult">
          상담 신청
          <span aria-hidden="true">↗</span>
        </a>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">
            <span />
            FACILITY MANAGEMENT · WONJU
          </p>
          <h1>
            건물을 관리하며,
            <br />
            <em>청소까지 직접 수행합니다.</em>
          </h1>
          <p className="hero-lede">
            관리자가 현장에 있습니다. 청소부터 시설 확인과 기록까지,
            <br className="desktop-break" />
            건물의 일상을 한 팀이 책임집니다.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href="#services">
              서비스 살펴보기
              <span aria-hidden="true">→</span>
            </a>
            <a className="text-link" href="#standard">
              브링케어의 운영 기준
              <span aria-hidden="true">↓</span>
            </a>
          </div>
          <div className="hero-facts" aria-label="브링케어 운영 구성">
            <div>
              <strong>06</strong>
              <span>관리 영역</span>
            </div>
            <div>
              <strong>04</strong>
              <span>운영 단계</span>
            </div>
            <div>
              <strong>01</strong>
              <span>연결된 기준</span>
            </div>
          </div>
        </div>

        <div className="hero-media">
          <img
            src="/brand-campaign/bringcare-suited-team-building-v2.png"
            alt="정장을 입은 브링케어 건물관리팀을 표현한 건물 앞 브랜드 캠페인 단체사진"
          />
          <div className="hero-media-shade" aria-hidden="true" />
          <div className="media-label">
            <span className="live-dot" />
            <div>
              <small>브링케어 브랜드 캠페인 이미지</small>
              <strong>관리자가 현장에 있습니다.</strong>
            </div>
          </div>
          <div className="media-index">
            <span>BRING CARE</span>
            <span>FM / 2026</span>
          </div>
        </div>
      </section>

      <section className="flow-strip" aria-label="브링케어 관리 영역">
        <p>FACILITY</p>
        <span>+</span>
        <p>RENT</p>
        <span>+</span>
        <p>CARE</p>
        <span>+</span>
        <p>PROJECT</p>
        <span>+</span>
        <p>DATA</p>
      </section>

      <section className="manifesto" id="standard">
        <div className="manifesto-heading">
          <p className="section-label">BRING CARE STANDARD</p>
          <p className="manifesto-note">
            관리의 품질은 얼마나 많이 하는지가 아니라
            <br />
            얼마나 정확하게 이어지는지에서 시작합니다.
          </p>
        </div>
        <div className="manifesto-words" aria-label="현장 연결 기록">
          <span>현장</span>
          <i>→</i>
          <span>연결</span>
          <i>→</i>
          <span>기록</span>
        </div>
        <p className="manifesto-copy">
          현장을 이해하고, 필요한 사람과 업무를 연결하고,
          <br />
          그 과정을 다음 판단을 위한 기록으로 남깁니다.
        </p>
      </section>

      <section className="services section" id="services">
        <div className="section-heading">
          <p className="section-label">WHAT WE CARE</p>
          <div>
            <h2>
              건물 운영에 필요한 일을
              <br />
              <span>한 흐름으로 관리합니다.</span>
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
              <div className="card-head">
                <span className="card-number">{service.number}</span>
                <span className="card-arrow" aria-hidden="true">
                  ↗
                </span>
              </div>
              <div className="service-glyph" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div>
                <p className="card-en">{service.en}</p>
                <h3>{service.title}</h3>
                <p className="card-copy">{service.copy}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="operation-flow">
        <div className="operation-intro">
          <p className="section-label section-label-light">ONE CONNECTED FLOW</p>
          <h2>
            한 건의 요청이
            <br />
            끝까지 이어지는 방식.
          </h2>
          <p>
            요청을 받은 순간부터 완료를 확인하는 순간까지,
            <br />
            담당과 기록이 끊어지지 않게 연결합니다.
          </p>
        </div>
        <ol className="flow-list">
          {flow.map((item) => (
            <li key={item.number}>
              <span className="flow-number">{item.number}</span>
              <div>
                <h3>{item.title}</h3>
                <p>{item.copy}</p>
              </div>
              <span className="flow-plus" aria-hidden="true">
                +
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="digital section" id="digital">
        <div className="digital-visual">
          <div className="ui-shell">
            <div className="ui-topbar">
              <span className="ui-logo">BRING FM</span>
              <div className="ui-state">
                <i />
                LIVE OPERATION
              </div>
            </div>
            <div className="ui-grid">
              <aside className="ui-sidebar" aria-hidden="true">
                <span className="active" />
                <span />
                <span />
                <span />
              </aside>
              <div className="ui-content">
                <div className="ui-heading">
                  <div>
                    <small>OPERATION BOARD</small>
                    <strong>오늘의 운영 현황</strong>
                  </div>
                  <span>JUL 23</span>
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
                <div className="ui-chart" aria-hidden="true">
                  <span style={{ height: "32%" }} />
                  <span style={{ height: "58%" }} />
                  <span style={{ height: "43%" }} />
                  <span style={{ height: "76%" }} />
                  <span style={{ height: "64%" }} />
                  <span style={{ height: "91%" }} />
                  <span style={{ height: "70%" }} />
                </div>
                <div className="ui-table" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </div>
          </div>
          <div className="visual-badge">
            <strong>FIELD</strong>
            <span>TO</span>
            <strong>DATA</strong>
          </div>
        </div>

        <div className="digital-copy">
          <p className="section-label">DIGITAL FM</p>
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
      </section>

      <section className="closing">
        <p>BRING CARE</p>
        <h2>
          문제가 생긴 뒤 움직이는 관리보다,
          <br />
          <span>문제가 커지기 전에 연결하는 관리.</span>
        </h2>
        <div className="closing-line">
          <span />
          <p>CARE · CONNECT · IMPROVE</p>
          <span />
        </div>
      </section>

      <section className="company section" id="company">
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

      <a className="floating-cta" href="/consult">
        <span>FM 운영</span>
        <strong>상담 신청</strong>
        <i aria-hidden="true">↓</i>
      </a>

      <footer>
        <div className="footer-top">
          <div>
            <span className="footer-brand">Bring Care</span>
            <p>관리의 모든 흐름을 연결합니다.</p>
            <p className="footer-contact">
              010-6566-3603 · bringengineering1008@gmail.com
            </p>
          </div>
          <a href="#top" aria-label="페이지 맨 위로 이동">
            TOP
            <span aria-hidden="true">↑</span>
          </a>
        </div>
        <div className="footer-bottom">
          <p>브링엔지니어링 · 대표 서창환 · 사업자등록번호 748-28-01935</p>
          <p>강원특별자치도 원주시 상지대길 83, 벤처창업관동 3층 305호</p>
          <p>© 2026 BRING ENGINEERING. ALL RIGHTS RESERVED.</p>
        </div>
      </footer>
    </main>
  );
}
