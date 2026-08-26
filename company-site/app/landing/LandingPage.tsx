import Image from "next/image";
import Link from "next/link";
import { PHONE_HREF, PHONE_LABEL } from "./contact";
import OfficialChannels from "./OfficialChannels";
import PricingGrid from "./PricingGrid";
import QuickEstimateForm from "./QuickEstimateForm";
import type { LandingService } from "./services";
import TurnoverIntro from "./TurnoverIntro";
import TurnoverSections from "./TurnoverSections";
import "./landing.css";

const serviceNames: Record<LandingService["slug"], string> = {
  "stair-cleaning": "계단·공용부 청소",
  "building-care": "원룸·다가구 건물관리",
  "move-in-cleaning": "입주·이사청소",
  "turnover-care": "24H 입·퇴실 관리",
};

const activePriceBySlug = {
  "stair-cleaning": "stair-cleaning",
  "building-care": "building-care",
  "move-in-cleaning": "single-turnover",
  "turnover-care": "managed-turnover",
} as const;

type LandingPageProps = {
  service: LandingService;
};

export default function LandingPage({ service }: LandingPageProps) {
  const serviceName = serviceNames[service.slug];
  const sourcePath = `/${service.slug}`;
  const isTurnoverCare = service.slug === "turnover-care";

  return (
    <main className={`landing-page landing-${service.slug}`}>
      {isTurnoverCare ? (
        <TurnoverIntro service={service} />
      ) : (
        <>
          <header className="landing-header">
            <Link
              className="landing-brand"
              href="/"
              aria-label="BRING CARE 홈으로 이동"
            >
              <span className="brand-image" aria-hidden="true" />
              <span className="brand-engineering">
                BRING <strong>ENGINEERING</strong>
              </span>
            </Link>
            <nav className="landing-header-actions" aria-label="상담 바로가기">
              <a className="landing-header-phone" href={PHONE_HREF}>
                <span>전화 상담</span>
                <strong>{PHONE_LABEL}</strong>
              </a>
              <a className="landing-button landing-button-dark" href="#quick-estimate">
                간편 견적
              </a>
            </nav>
          </header>

          <section className="landing-hero" aria-labelledby="landing-title">
            <div className="landing-hero-copy">
              <p className="landing-eyebrow">{service.eyebrow}</p>
              <h1 id="landing-title">
                {service.title}
                <em>{service.accent}</em>
              </h1>
              <p className="landing-lead">{service.lead}</p>
              <div className="landing-price-line">
                <strong>{service.price}</strong>
                <span>{service.priceNote}</span>
              </div>
              <div className="landing-hero-actions">
                <a
                  className="landing-button landing-button-primary"
                  href={PHONE_HREF}
                >
                  전화로 바로 상담
                  <span>{PHONE_LABEL}</span>
                </a>
                <a
                  className="landing-button landing-button-outline"
                  href="#quick-estimate"
                >
                  30초 간편 견적
                </a>
              </div>
            </div>
            <figure className="landing-hero-media">
              <Image
                src={service.heroImage}
                alt={service.heroAlt}
                width={773}
                height={1031}
                priority
                unoptimized
                sizes="(max-width: 760px) 100vw, 48vw"
              />
              <figcaption>
                {service.imageCredit ? (
                  <>
                    <span>청소 작업 예시 이미지</span>
                    <a
                      href={service.imageCredit.href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {service.imageCredit.label}
                    </a>
                  </>
                ) : (
                  <>
                    <span>BRING CARE 현장기록</span>
                    청소와 관리 사이, 놓치기 쉬운 상태까지 확인합니다.
                  </>
                )}
              </figcaption>
            </figure>
          </section>

          <section className="landing-facts" aria-labelledby="facts-title">
            <h2 className="landing-sr-only" id="facts-title">
              서비스 핵심 정보
            </h2>
            <div className="landing-section-inner landing-fact-grid">
              {service.facts.map((fact, index) => (
                <article key={`${fact.value}-${fact.label}`}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{fact.value}</strong>
                  <p>{fact.label}</p>
                </article>
              ))}
            </div>
          </section>
        </>
      )}

      {isTurnoverCare ? <TurnoverSections /> : null}

      <section
        className="landing-cleaning-results"
        id={isTurnoverCare ? "cleaning-results" : undefined}
        aria-labelledby="cleaning-results-title"
      >
        <div className="landing-section-inner">
          <div className="landing-section-heading">
            <p>{service.slug === "building-care" ? "방문 결과" : "청소 결과"}</p>
            <h2 id="cleaning-results-title">
              {service.slug === "building-care"
                ? "방문 후 이렇게 확인됩니다."
                : "청소 후 이렇게 달라집니다."}
            </h2>
            <span>
              {service.slug === "building-care"
                ? "현장에서 확인한 내용과 처리 결과를 기록으로 공유합니다."
                : "눈에 보이는 청결부터 작업 확인까지 한 번에 챙깁니다."}
            </span>
          </div>
          <ol className="landing-cleaning-result-grid">
            {service.cleaningResults.map((item, index) => (
              <li key={item.title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.copy}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="landing-scope" aria-labelledby="scope-title">
        <div className="landing-section-inner">
          <div className="landing-section-heading">
            <p>{service.slug === "building-care" ? "서비스 범위" : "청소 범위"}</p>
            <h2 id="scope-title">
              {service.slug === "building-care"
                ? "어디까지 관리하는지 먼저 알려드립니다."
                : "어디까지 청소하는지 먼저 알려드립니다."}
            </h2>
            <span>현장 조건에 따라 포함 범위는 상담 후 확정됩니다.</span>
          </div>
          <div className="landing-scope-grid">
            {service.scope.map((item, index) => (
              <article key={item.title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{item.title}</h3>
                <p>{item.copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        className="landing-records"
        id={isTurnoverCare ? "field-records" : undefined}
        aria-labelledby="records-title"
      >
        <div className="landing-section-inner">
          <div className="landing-section-heading landing-section-heading-light">
            <p>실제 현장기록</p>
            <h2 id="records-title">말보다 현장으로 보여드립니다.</h2>
            <span>BRING CARE 블로그에 공개된 실제 기록만 사용했습니다.</span>
          </div>
          <div className="landing-record-grid">
            {service.records.map((record) => (
              <article className="landing-record-card" key={`${record.sourceUrl}-${record.image}`}>
                <div className="landing-record-image">
                  <Image
                    src={record.image}
                    alt={record.alt}
                    width={773}
                    height={1031}
                    unoptimized
                    sizes="(max-width: 760px) 88vw, (max-width: 1080px) 44vw, 30vw"
                  />
                  <span>{record.label}</span>
                </div>
                <div className="landing-record-copy">
                  <h3>{record.title}</h3>
                  <p>{record.copy}</p>
                  <a href={record.sourceUrl} target="_blank" rel="noreferrer">
                    네이버 블로그 원문 보기
                    <span aria-hidden="true">↗</span>
                  </a>
                </div>
              </article>
            ))}
          </div>
          <div className="landing-records-more">
            <span className="landing-records-mark" aria-hidden="true" />
            <div>
              <strong>공용부 개선부터 공실 점검까지</strong>
              <p>BRING CARE가 공개한 12개 현장기록을 관리 유형별로 확인하세요.</p>
            </div>
            <Link href="/care-records">현장기록 12건 전체 보기 <span aria-hidden="true">→</span></Link>
          </div>
        </div>
      </section>

      <section className="landing-difference" aria-labelledby="difference-title">
        <div className="landing-section-inner landing-difference-grid">
          <div>
            <p className="landing-eyebrow">청소에 더해지는 BRING CARE의 차이</p>
            <h2 id="difference-title">청소하면서 건물까지 봅니다.</h2>
            <p>
              눈앞의 오염만 정리하고 끝내지 않습니다. 현장에서 발견한 조명,
              누수 흔적, 표식과 적치물 같은 확인 사항을 사진과 함께 전달합니다.
            </p>
          </div>
          <ol>
            <li>
              <span>01</span>
              <div>
                <strong>작업</strong>
                <p>협의한 범위에 맞춰 현장을 정리합니다.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>발견</strong>
                <p>지나치기 쉬운 건물 상태를 함께 살핍니다.</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>보고</strong>
                <p>완료 사진과 확인 사항을 건물주에게 전달합니다.</p>
              </div>
            </li>
          </ol>
        </div>
      </section>

      {!isTurnoverCare ? (
        <aside className="landing-turnover-link">
          <div className="landing-section-inner">
            <p>퇴실 일정이 잡혀 있다면</p>
            <h2>퇴실 후가 아니라 14일 전부터 준비하세요.</h2>
            <Link href="/turnover-care">
              입·퇴실까지 함께 관리하기 <span aria-hidden="true">→</span>
            </Link>
          </div>
        </aside>
      ) : null}

      <PricingGrid activePrice={activePriceBySlug[service.slug]} />

      <section className="landing-process" aria-labelledby="process-title">
        <div className="landing-section-inner">
          <div className="landing-section-heading">
            <p>진행 과정</p>
            <h2 id="process-title">상담부터 결과 확인까지 간단하게.</h2>
          </div>
          <ol className="landing-process-list">
            {service.process.map((item, index) => (
              <li key={item.title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{item.title}</h3>
                <p>{item.copy}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="landing-faq" aria-labelledby="faq-title">
        <div className="landing-section-inner landing-faq-layout">
          <div className="landing-section-heading">
            <p>자주 묻는 질문</p>
            <h2 id="faq-title">상담 전 궁금한 점을 확인하세요.</h2>
          </div>
          <div className="landing-faq-list">
            {service.faq.map((item) => (
              <details key={item.question}>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <OfficialChannels />

      <section
        className="landing-estimate"
        id="quick-estimate"
        aria-label={`${serviceName} 간편 견적`}
      >
        <div className="landing-section-inner landing-estimate-layout">
          <div className="landing-estimate-copy">
            <p className="landing-eyebrow">30초 간편 견적</p>
            <h2>현장에 맞는 범위와 가격을 안내해 드립니다.</h2>
            <p>
              이름, 연락처, 건물 위치 또는 지역은 필수입니다. 층수, 세대수,
              청소 범위 같은 건물 정보는 선택해 남겨주세요. 급한 상담은 전화가
              가장 빠릅니다.
            </p>
            <a href={PHONE_HREF}>
              <span>전화 상담</span>
              <strong>{PHONE_LABEL}</strong>
            </a>
          </div>
          <QuickEstimateForm service={serviceName} sourcePath={sourcePath} />
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-section-inner">
          <div>
            <span className="landing-footer-logo" aria-hidden="true" />
            <p>원룸·다가구 건물의 청소부터 관리까지</p>
          </div>
          <div>
            <p>브링엔지니어링 · 대표 서창환 · 사업자등록번호 748-28-01935</p>
            <a href="https://blog.naver.com/bringcare" target="_blank" rel="noreferrer">
              BRING CARE 네이버 블로그
            </a>
          </div>
        </div>
      </footer>

      {isTurnoverCare ? (
        <nav
          className="mobile-sticky-actions turnover-mobile-sticky"
          aria-label="빠른 상담"
        >
          <a href="#quick-estimate">퇴실 일정 30초 견적</a>
        </nav>
      ) : (
        <nav className="mobile-sticky-actions" aria-label="빠른 상담">
          <a href={PHONE_HREF}>전화 상담</a>
          <a href="#quick-estimate">간편 견적</a>
        </nav>
      )}
    </main>
  );
}
