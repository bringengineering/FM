import Image from "next/image";
import Link from "next/link";
import OfficialChannels from "./OfficialChannels";
import {
  fieldRecordCategories,
  fieldRecords,
  type FieldRecordCategory,
} from "./fieldRecords";
import "./landing.css";

const categoryOrder: FieldRecordCategory[] = [
  "common-area",
  "environment",
  "safety",
  "vacancy",
];

export default function FieldRecordArchive() {
  return (
    <main className="landing-page care-records-page">
      <header className="landing-header">
        <Link className="landing-brand" href="/" aria-label="BRING CARE 홈으로 이동">
          <span className="brand-image" aria-hidden="true" />
          <span className="brand-engineering">원룸·다가구 청소부터 관리까지</span>
        </Link>
        <nav className="landing-header-actions" aria-label="서비스 바로가기">
          <Link className="landing-records-back" href="/building-care">
            건물관리 보기
          </Link>
          <Link className="landing-button landing-button-dark" href="/building-care#quick-estimate">
            간편 견적
          </Link>
        </nav>
      </header>

      <section className="care-records-hero" aria-labelledby="care-records-title">
        <div className="landing-section-inner care-records-hero-layout">
          <div>
            <p className="landing-eyebrow">BRING CARE FIELD NOTES</p>
            <h1 id="care-records-title">
              청소에서 발견하고,
              <em>관리로 해결한 현장기록.</em>
            </h1>
            <p>
              BRING CARE 공식 블로그에 공개된 원주 현장 12건을 관리 유형별로
              정리했습니다. 각 카드에서 실제 원문을 바로 확인할 수 있습니다.
            </p>
          </div>
          <div className="care-records-brand-panel" aria-label="현장기록 요약">
            <span className="care-records-logo" aria-hidden="true" />
            <dl>
              <div><dt>기록</dt><dd>12건</dd></div>
              <div><dt>관리 유형</dt><dd>4개</dd></div>
              <div><dt>현장 지역</dt><dd>원주</dd></div>
            </dl>
          </div>
        </div>
      </section>

      <nav className="care-records-index" aria-label="현장기록 유형">
        <div className="landing-section-inner">
          {categoryOrder.map((category) => (
            <a href={`#record-${category}`} key={category}>
              {fieldRecordCategories[category].label}
            </a>
          ))}
        </div>
      </nav>

      <div className="care-records-groups">
        {categoryOrder.map((category, categoryIndex) => {
          const meta = fieldRecordCategories[category];
          const records = fieldRecords.filter((record) => record.category === category);

          return (
            <section
              className="care-records-group"
              id={`record-${category}`}
              aria-labelledby={`record-${category}-title`}
              key={category}
            >
              <div className="landing-section-inner">
                <div className="care-records-group-heading">
                  <span>{String(categoryIndex + 1).padStart(2, "0")}</span>
                  <div>
                    <p>{records.length} FIELD NOTES</p>
                    <h2 id={`record-${category}-title`}>{meta.label}</h2>
                    <p>{meta.description}</p>
                  </div>
                </div>
                <div className="care-records-grid">
                  {records.map((record) => (
                    <article className="care-record-card" key={record.id}>
                      <div className="care-record-image">
                        <Image
                          src={record.image}
                          alt={record.alt}
                          width={900}
                          height={720}
                          unoptimized
                          sizes="(max-width: 760px) 92vw, (max-width: 1100px) 46vw, 30vw"
                        />
                        <span>{record.label}</span>
                      </div>
                      <div className="care-record-copy">
                        <h3>{record.title}</h3>
                        <p>{record.copy}</p>
                        <a href={record.sourceUrl} target="_blank" rel="noreferrer">
                          네이버 블로그 원문 보기 <span aria-hidden="true">↗</span>
                        </a>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </section>
          );
        })}
      </div>

      <section className="care-records-cta" aria-labelledby="care-records-cta-title">
        <div className="landing-section-inner">
          <span className="care-records-cta-logo" aria-hidden="true" />
          <div>
            <p>내 건물에도 이런 관리가 필요하다면</p>
            <h2 id="care-records-cta-title">청소부터 관리까지 한 번에 상담하세요.</h2>
          </div>
          <Link className="landing-button landing-button-primary" href="/building-care#quick-estimate">
            건물관리 간편 견적
          </Link>
        </div>
      </section>

      <OfficialChannels />

      <footer className="landing-footer">
        <div className="landing-section-inner">
          <div><span className="landing-footer-logo" aria-hidden="true" /><p>원룸·다가구 건물의 청소부터 관리까지</p></div>
          <div><p>브링엔지니어링 · 대표 서창환 · 사업자등록번호 748-28-01935</p></div>
        </div>
      </footer>
    </main>
  );
}
