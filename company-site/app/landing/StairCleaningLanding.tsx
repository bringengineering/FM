import Image from "next/image";
import { PHONE_HREF, PHONE_LABEL } from "./contact";
import QuickEstimateForm from "./QuickEstimateForm";
import "./stair-cleaning.css";

const facts = [
  ["01", "월 4회 정기방문", "건물 여건에 따라 주 2·3회 방문도 협의할 수 있습니다."],
  ["02", "월간 관리보고", "작업 내용과 현장에서 확인한 사항을 한 달 단위로 정리합니다."],
  ["03", "시설 상태 확인", "조명·누수 흔적·적치물처럼 놓치기 쉬운 부분을 함께 살핍니다."],
  ["04", "원주 직영팀", "지역 현장을 직접 방문하고 필요한 상황에 빠르게 대응합니다."],
] as const;

const scopes = [
  ["01", "계단·난간", "층별 계단의 먼지와 생활 오염을 제거하고 난간 주변을 정리합니다.", "/landing/cleaning/stair-bright.jpg", "관리된 밝은 계단과 난간"],
  ["02", "복도·승강기 홀", "공용 복도와 승강기 앞 주요 동선을 정기적으로 관리해 청결을 유지합니다.", "/landing/cleaning/stair-elevator-hall.jpg", "관리된 승강기 홀"],
  ["03", "공동현관·공용부", "출입구와 공용 공간 등 건물의 첫인상이 되는 구역을 관리합니다.", "/landing/cleaning/stair-common-hall.jpg", "정돈된 건물 공용부"],
  ["04", "공용창·창틀", "쌓이기 쉬운 먼지와 손자국을 확인하고 정기 일정에 맞춰 청소합니다.", "/landing/cleaning/stair-window-wide.jpg", "관리된 공용창과 창틀"],
] as const;

export default function StairCleaningLanding() {
  return (
    <main className="stair-toss">
      <header className="stair-nav">
        <a className="stair-logo" href="/" aria-label="BRING CARE 홈">
          BRING <span>CARE</span>
        </a>
        <nav aria-label="주요 메뉴">
          <a href="#service">서비스</a><a href="#price">가격안내</a><a href="#field">관리사례</a>
          <a className="stair-nav-call" href={PHONE_HREF}>전화 상담</a>
        </nav>
      </header>

      <section className="stair-hero" aria-labelledby="stair-title">
        <div className="stair-hero-card">
          <Image src="/landing/cleaning/stair-hero-lobby.jpg" alt="브링케어가 관리하는 원주 건물 공용부" fill priority unoptimized sizes="(max-width: 820px) 100vw, 1240px" />
          <div className="stair-hero-copy">
            <p className="stair-eyebrow">원주 직영팀 · 계단/공용부 정기청소</p>
            <h1 id="stair-title">계단청소를 넘어,<br />건물의 첫인상을<br />관리합니다.</h1>
            <p>공용부 정기청소부터 시설 상태 확인과 월간 관리보고까지, 한 팀이 꾸준히 관리합니다.</p>
            <div className="stair-hero-actions">
              <a className="stair-btn stair-btn-primary" href="#estimate">30초 간편 견적</a>
              <a className="stair-btn stair-btn-white" href={PHONE_HREF}>{PHONE_LABEL}</a>
            </div>
          </div>
          <div className="stair-price-pill"><span>월 4회 정기방문</span><strong>3층 6만원부터</strong><small>부가세 별도 · 주 2·3회 협의 가능</small></div>
        </div>
      </section>

      <section className="stair-facts" aria-label="서비스 핵심 정보">
        <div className="stair-inner stair-fact-grid">
          {facts.map(([number, title, copy]) => <article key={title}><span>{number}</span><strong>{title}</strong><p>{copy}</p></article>)}
        </div>
      </section>

      <section className="stair-section stair-soft" id="service" aria-labelledby="stair-scope-title">
        <div className="stair-inner">
          <div className="stair-section-head"><p>SERVICE SCOPE</p><h2 id="stair-scope-title">깨끗하게만 하지 않습니다.</h2><span>정기 청소와 함께 건물주가 멀리 있어도 놓치기 쉬운 공용부 상태를 확인합니다.</span></div>
          <div className="stair-scope-grid">
            {scopes.map(([number, title, copy, image, alt]) => <article key={title}><span>{number}</span><h3>{title}</h3><p>{copy}</p><div className="stair-scope-image"><Image src={image} alt={alt} fill unoptimized sizes="(max-width: 820px) 100vw, 50vw" /></div></article>)}
          </div>
        </div>
      </section>

      <section className="stair-section" id="field" aria-labelledby="stair-field-title">
        <div className="stair-inner">
          <div className="stair-section-head"><p>REAL FIELD</p><h2 id="stair-field-title">청소 후, 관리가 보입니다.</h2><span>BRING CARE의 실제 원주 현장 사진으로 관리 범위를 보여드립니다.</span></div>
          <div className="stair-gallery">
            <figure><Image src="/landing/cleaning/stair-hero-lobby.jpg" alt="실제 공용부 관리 현장" fill unoptimized sizes="(max-width: 820px) 100vw, 58vw" /><figcaption><strong>공용부 전체</strong><span>매일 오가는 공간의 인상을 관리합니다.</span></figcaption></figure>
            <figure><Image src="/landing/cleaning/stair-bright.jpg" alt="실제 계단 관리 현장" fill unoptimized sizes="(max-width: 820px) 100vw, 42vw" /><figcaption><strong>계단·난간</strong><span>밝고 깔끔한 주 동선을 유지합니다.</span></figcaption></figure>
            <figure><Image src="/landing/cleaning/stair-window-wide.jpg" alt="실제 공용창 관리 현장" fill unoptimized sizes="(max-width: 820px) 100vw, 42vw" /><figcaption><strong>공용창·창틀</strong><span>빛이 드는 공간까지 놓치지 않습니다.</span></figcaption></figure>
          </div>
        </div>
      </section>

      <section className="stair-section stair-soft" aria-labelledby="stair-report-title">
        <div className="stair-inner stair-report-grid">
          <div className="stair-report-copy"><p className="stair-tag">MONTHLY REPORT</p><h2 id="stair-report-title">한 달의 관리 내용을<br />보고서로 확인하세요.</h2><span>매번 사진만 전송하고 끝내지 않습니다. 작업 내역과 시설 확인 사항을 월간 관리보고로 정리합니다.</span><ul><li><b>✓</b><div><strong>정기 청소 이력</strong><small>방문일과 관리 범위 기록</small></div></li><li><b>✓</b><div><strong>공용부 확인 사항</strong><small>조명·누수 흔적·적치물 등 확인</small></div></li><li><b>✓</b><div><strong>후속 조치 제안</strong><small>필요한 관리 항목을 건물주에게 안내</small></div></li></ul></div>
          <div className="stair-report-card"><header><strong>월간 관리보고 예시</strong><span>관리 완료</span></header><dl><div><dt>정기방문</dt><dd>4회 완료</dd></div><div><dt>공용부 청소</dt><dd>계단·복도·현관</dd></div><div><dt>확인 사항</dt><dd>공용등 1곳 점검 필요</dd></div><div><dt>현장 사진</dt><dd>12장 첨부</dd></div></dl></div>
        </div>
      </section>

      <section className="stair-section stair-soft stair-price-section" id="price" aria-labelledby="stair-price-title">
        <div className="stair-inner"><div className="stair-section-head"><p>PRICE</p><h2 id="stair-price-title">건물 규모에 맞춰<br />투명하게 안내합니다.</h2><span>기본 가격을 먼저 확인하고, 현장 여건에 따라 정확한 견적을 안내받으세요.</span></div><div className="stair-pricing"><header><div><span>월 4회 정기청소</span><small>기본 관리 기준</small></div><strong>6만원부터</strong></header><dl><div><dt>3층 건물</dt><dd>월 60,000원</dd></div><div><dt>4층 건물</dt><dd>월 70,000원</dd></div><div><dt>5층 건물</dt><dd>월 80,000원</dd></div></dl><p>※ 부가세 별도 · 오염도와 관리 범위에 따라 변동될 수 있습니다.</p><a className="stair-btn stair-btn-primary" href="#estimate">우리 건물 견적 확인</a></div></div>
      </section>

      <section className="stair-estimate" id="estimate" aria-labelledby="stair-estimate-title"><div className="stair-estimate-wrap"><div className="stair-estimate-head"><p>QUICK ESTIMATE</p><h2 id="stair-estimate-title">건물 정보만 알려주세요.<br />빠르게 확인해드릴게요.</h2><span>필수 항목만 남겨주시면 원주 직영팀이 확인 후 연락드립니다.</span></div><QuickEstimateForm service="계단·공용부 청소" sourcePath="/stair-cleaning" /><div className="stair-kakao"><span>더 빠른 상담이 필요하신가요?</span><a href="https://pf.kakao.com/_xnaRfX/chat" target="_blank" rel="noreferrer">카카오톡으로 상담</a></div></div></section>

      <a className="stair-sticky" href="#estimate"><span>무료 견적 신청</span><small>30초 만에 입력하기</small></a>
    </main>
  );
}
