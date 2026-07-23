import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "상담 신청 발송 완료 | Bring Care",
  description:
    "브링케어 시설관리 상담 신청이 담당 이메일로 정상 발송되었습니다.",
};

export default function ConsultCompletePage() {
  return (
    <main className="consult-page complete-page">
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
        <nav aria-label="발송 완료 페이지 메뉴">
          <a href="/#services">서비스</a>
          <a href="/#digital">디지털 FM</a>
          <a href="/#company">회사 정보</a>
        </nav>
        <a className="consult-home" href="/">
          홈페이지
          <span aria-hidden="true">↗</span>
        </a>
      </header>

      <section className="complete-hero">
        <div className="complete-card">
          <div className="complete-mark" aria-hidden="true">
            ✓
          </div>
          <p className="eyebrow complete-eyebrow">
            <span />
            MESSAGE SENT
          </p>
          <h1>
            상담 신청이
            <br />
            <em>발송 완료되었습니다.</em>
          </h1>
          <p className="complete-description">
            작성하신 상담 내용이 브링케어 담당 이메일로 전달되었습니다.
            <br />
            내용을 확인한 뒤 입력하신 연락처로 회신드리겠습니다.
          </p>

          <div className="complete-steps" aria-label="상담 진행 순서">
            <div>
              <span>01</span>
              <strong>신청 발송</strong>
              <small>완료</small>
            </div>
            <i aria-hidden="true" />
            <div>
              <span>02</span>
              <strong>내용 확인</strong>
              <small>담당자 확인</small>
            </div>
            <i aria-hidden="true" />
            <div>
              <span>03</span>
              <strong>상담 회신</strong>
              <small>전화·이메일</small>
            </div>
          </div>

          <div className="complete-actions">
            <a className="complete-primary" href="/">
              홈페이지로 돌아가기
              <span aria-hidden="true">→</span>
            </a>
            <a className="complete-secondary" href="/consult">
              새 상담 신청
            </a>
          </div>

          <p className="complete-contact">
            빠른 상담이 필요하시면{" "}
            <a href="tel:01065663606">010-6566-3606</a>으로 연락해 주세요.
          </p>
        </div>

        <aside className="complete-index" aria-hidden="true">
          <span>BRING CARE</span>
          <strong>02 / 02</strong>
          <p>FIELD · CONNECT · DATA</p>
        </aside>
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
