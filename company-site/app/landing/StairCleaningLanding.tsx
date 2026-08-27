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
  ["01", "계단·난간", "계단의 먼지와 생활 오염을 제거하고 손이 자주 닿는 난간 주변을 정리합니다.", "/landing/cleaning/bringcare-stair-mop-up.png", "브링케어 유니폼 작업자의 계단 밀대 청소 연출 이미지"],
  ["02", "계단 모서리", "밀대로 놓치기 쉬운 계단 끝과 벽면 모서리를 브러시로 세부 청소합니다.", "/landing/cleaning/bringcare-stair-corner-brush.png", "브링케어 유니폼 작업자의 계단 모서리 브러시 청소 연출 이미지"],
  ["03", "공동현관·안전설비", "건물의 첫인상이 되는 현관과 공용 안전설비 주변을 함께 정돈합니다.", "/landing/cleaning/bringcare-fire-extinguisher-area.png", "브링케어 유니폼 작업자의 공용부 소화기 주변 청소 연출 이미지"],
  ["04", "공용창·창틀", "손자국과 먼지가 눈에 잘 보이는 공용창과 창틀을 정기적으로 관리합니다.", "/landing/cleaning/bringcare-common-window.png", "브링케어 유니폼 작업자의 공용창 청소 연출 이미지"],
] as const;

const references = [
  {
    title: "공용부 환경 정비",
    copy: "건물 앞 생활 쓰레기와 적치 상태를 확인하고 공용 공간의 통행 환경을 정리했습니다.",
    image: "/landing/records/waste-cleanup.jpg",
    alt: "브링케어가 정리한 건물 공용부 적치물 현장",
    href: "https://blog.naver.com/bringcare/224382174945",
  },
  {
    title: "청소 중 발견한 벽면 하자",
    copy: "공용부 작업 과정에서 벽면 손상과 습기 흔적을 발견해 건물주가 확인할 수 있도록 기록했습니다.",
    image: "/landing/records/defect-check.jpg",
    alt: "브링케어 공용부 청소 중 확인한 벽면 하자",
    href: "https://blog.naver.com/bringcare/224382174370",
  },
  {
    title: "전기 화재예방 조치",
    copy: "공용부 전기 사용 환경을 확인하고 화재 위험을 줄이기 위한 예방 조치를 진행했습니다.",
    image: "/landing/records/fire-safety-pad.jpg",
    alt: "브링케어 건물 공용부 전기 화재예방 조치 현장",
    href: "https://blog.naver.com/bringcare/224382173190",
  },
  {
    title: "건물 입구 안내환경 개선",
    copy: "반복되는 종이 공지를 줄이고 건물 이용자가 안내를 쉽게 확인할 수 있도록 입구 환경을 개선했습니다.",
    image: "/landing/records/digital-signage.jpg",
    alt: "브링케어가 개선한 건물 입구 디지털 안내환경",
    href: "https://blog.naver.com/bringcare/224382175661",
  },
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
          <Image src="/landing/cleaning/bringcare-stair-mop-up.png" alt="브링케어 유니폼 작업자의 계단 밀대 청소 연출 이미지" fill priority unoptimized sizes="(max-width: 820px) 100vw, 1240px" />
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
          <div className="stair-section-head"><p>CLEANING DETAIL</p><h2 id="stair-field-title">계단 한 칸부터<br />공용창까지 관리합니다.</h2><span>건물 공용부에서 반복적으로 오염되는 구역을 작업 범위에 맞춰 관리합니다.</span></div>
          <div className="stair-gallery">
            <figure><Image src="/landing/cleaning/bringcare-stair-mop-down.png" alt="브링케어 유니폼 작업자의 계단 하행 밀대 청소 연출 이미지" fill unoptimized sizes="(max-width: 820px) 100vw, 58vw" /><figcaption><strong>계단 바닥</strong><span>한 층씩 이동하며 계단의 먼지와 생활 오염을 정리합니다.</span></figcaption></figure>
            <figure><Image src="/landing/cleaning/bringcare-stair-corner-brush.png" alt="브링케어 유니폼 작업자의 계단 모서리 브러시 청소 연출 이미지" fill unoptimized sizes="(max-width: 820px) 100vw, 42vw" /><figcaption><strong>모서리·틈새</strong><span>밀대가 닿기 어려운 계단 끝과 벽면 틈을 세부 청소합니다.</span></figcaption></figure>
            <figure><Image src="/landing/cleaning/bringcare-common-window.png" alt="브링케어 유니폼 작업자의 공용창 청소 연출 이미지" fill unoptimized sizes="(max-width: 820px) 100vw, 42vw" /><figcaption><strong>공용창·창틀</strong><span>건물 안으로 빛이 들어오는 공용창의 손자국과 먼지를 관리합니다.</span></figcaption></figure>
          </div>
        </div>
      </section>

      <section className="stair-section stair-references" aria-labelledby="stair-reference-title">
        <div className="stair-inner">
          <div className="stair-section-head">
            <p>BRING CARE MANAGEMENT RECORD</p>
            <h2 id="stair-reference-title">청소만 한 것이 아니라,<br />건물을 관리해왔습니다.</h2>
            <span>연출 이미지가 아닌 BRING CARE의 실제 관리 현장입니다. 각 기록은 네이버 블로그 원문에서 확인할 수 있습니다.</span>
          </div>
          <div className="stair-reference-grid">
            {references.map((reference) => (
              <article key={reference.href}>
                <div className="stair-reference-image">
                  <Image src={reference.image} alt={reference.alt} fill unoptimized sizes="(max-width: 820px) 100vw, 50vw" />
                  <span>BRING CARE 실제 관리 현장</span>
                </div>
                <div className="stair-reference-copy">
                  <h3>{reference.title}</h3>
                  <p>{reference.copy}</p>
                  <a href={reference.href} target="_blank" rel="noreferrer">실제 현장기록 보기 <span aria-hidden="true">↗</span></a>
                </div>
              </article>
            ))}
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
