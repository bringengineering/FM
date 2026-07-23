import type { Metadata } from "next";
import ConsultForm from "./ConsultForm";

export const metadata: Metadata = {
  title: "상담 신청 | Bring Care",
  description:
    "브링엔지니어링의 시설관리, 임대관리, 민원, 공사·견적, 디지털 FM 상담을 신청하세요.",
};

export default function ConsultPage() {
  return (
    <main className="consult-page">
      <header className="consult-header">
        <a
          className="brand"
          href="/"
          aria-label="Bring Care · bringengineering 홈으로 이동"
        >
          <span className="brand-image" aria-hidden="true" />
          <span className="brand-engineering" aria-hidden="true">
            <strong>bring</strong>engineering
          </span>
        </a>
        <nav aria-label="상담 페이지 메뉴">
          <a href="/#services">서비스</a>
          <a href="/#digital">디지털 FM</a>
          <a href="/#company">회사 정보</a>
        </nav>
        <a className="consult-home" href="/">
          홈페이지
          <span aria-hidden="true">↗</span>
        </a>
      </header>

      <section className="consult-hero">
        <div>
          <p className="eyebrow">
            <span />
            FM CONSULTATION
          </p>
          <h1>
            건물에 맞는 관리,
            <br />
            <em>이야기부터 시작합니다.</em>
          </h1>
          <p>
            현재 운영 상황과 필요한 도움을 알려주세요.
            <br className="desktop-break" />
            브링케어가 확인 후 연락드리겠습니다.
          </p>
        </div>
        <div className="consult-hero-index">
          <span>BRING CARE</span>
          <strong>01 / 02</strong>
          <p>FIELD · CONNECT · DATA</p>
        </div>
      </section>

      <section className="consult-layout">
        <aside className="contact-panel">
          <p className="section-label section-label-light">DIRECT CONTACT</p>
          <h2>
            편한 방법으로
            <br />
            바로 문의하세요.
          </h2>
          <div className="direct-links">
            <a href="tel:01065663606">
              <span>전화 상담</span>
              <strong>010-6566-3606</strong>
              <i aria-hidden="true">↗</i>
            </a>
            <a href="mailto:bringengineering1008@gmail.com">
              <span>이메일 상담</span>
              <strong>bringengineering1008@gmail.com</strong>
              <i aria-hidden="true">↗</i>
            </a>
          </div>
          <div className="contact-guide">
            <span>상담 진행</span>
            <ol>
              <li>
                <b>01</b> 문의 내용 확인
              </li>
              <li>
                <b>02</b> 전화 또는 이메일 회신
              </li>
              <li>
                <b>03</b> 현장·운영 범위 협의
              </li>
            </ol>
          </div>
        </aside>

        <ConsultForm />
      </section>

      <footer className="consult-footer">
        <div>
          <span className="footer-brand">Bring Care</span>
          <p>관리의 모든 흐름을 연결합니다.</p>
        </div>
        <div>
          <p>브링엔지니어링 · 대표 서창환 · 사업자등록번호 748-28-01935</p>
          <p>010-6566-3606 · bringengineering1008@gmail.com</p>
        </div>
      </footer>
    </main>
  );
}
