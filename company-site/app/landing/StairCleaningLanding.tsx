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
    problem: "건물 앞 생활 쓰레기와 적치물로 공용 공간의 통행 환경이 흐트러져 있었습니다.",
    action: "적치 상태를 확인한 뒤 생활 쓰레기를 수거하고 공용 동선을 정리했습니다.",
    result: "정비 완료 상태를 사진으로 기록해 건물주가 현장 상황을 확인할 수 있게 했습니다.",
    image: "/landing/records/waste-cleanup.jpg",
    alt: "브링케어가 정리한 건물 공용부 적치물 현장",
    href: "https://blog.naver.com/bringcare/224382174945",
  },
  {
    title: "청소 중 발견한 벽면 하자",
    problem: "공용부 작업 중 벽면 손상과 습기 흔적이 확인됐습니다.",
    action: "손상 위치와 주변 상태를 사진으로 남기고 확인 내용을 정리했습니다.",
    result: "건물주가 현장에 오지 않아도 후속 점검이 필요한 위치를 확인할 수 있게 했습니다.",
    image: "/landing/records/defect-check.jpg",
    alt: "브링케어 공용부 청소 중 확인한 벽면 하자",
    href: "https://blog.naver.com/bringcare/224382174370",
  },
  {
    title: "전기 화재예방 조치",
    problem: "공용부 전기 사용 환경에서 화재 예방을 위해 확인이 필요한 부분이 있었습니다.",
    action: "사용 상태를 확인하고 위험을 줄이기 위한 예방 조치를 진행했습니다.",
    result: "조치한 위치와 완료 상태를 기록해 이후 관리 때 다시 확인할 수 있게 했습니다.",
    image: "/landing/records/fire-safety-pad.jpg",
    alt: "브링케어 건물 공용부 전기 화재예방 조치 현장",
    href: "https://blog.naver.com/bringcare/224382173190",
  },
  {
    title: "건물 입구 안내환경 개선",
    problem: "건물 입구의 반복적인 종이 공지로 안내 확인과 외관 관리가 불편했습니다.",
    action: "건물 이용자가 안내를 쉽게 확인할 수 있도록 입구 안내 환경을 정리했습니다.",
    result: "반복 공지를 줄이고 건물 입구에서 필요한 정보를 확인하기 쉬운 상태로 개선했습니다.",
    image: "/landing/records/digital-signage.jpg",
    alt: "브링케어가 개선한 건물 입구 디지털 안내환경",
    href: "https://blog.naver.com/bringcare/224382175661",
  },
] as const;

const includedWork = ["계단·난간 청소", "복도·승강기 홀", "공동현관 정리", "공용창·창틀", "월간 관리보고"] as const;
const optionalWork = ["바닥 왁스·코팅", "외벽·고압세척", "대량 폐기물 처리", "특수오염 제거", "전문 수리·시공"] as const;
const process = [
  ["01 상담 접수", "건물 위치와 층수, 원하는 방문 횟수를 확인합니다."],
  ["02 현장 확인", "공용부 범위와 오염도, 별도 작업 여부를 확인합니다."],
  ["03 정기 청소", "협의한 일정에 원주 직영팀이 방문해 공용부를 관리합니다."],
  ["04 월간 관리보고", "방문 이력과 시설 확인 사항을 한 달 단위로 정리합니다."],
] as const;
const faqs = [
  ["건물주가 현장에 있어야 하나요?", "아닙니다. 출입 방법과 작업 범위가 정해지면 비대면으로 진행하고 월간 관리보고로 확인할 수 있습니다."],
  ["주 2회·3회 방문도 가능한가요?", "가능합니다. 건물 규모와 유동 인구, 원하는 관리 수준을 확인한 뒤 방문 횟수를 협의합니다."],
  ["청소도구와 소모품은 누가 준비하나요?", "기본 작업에 필요한 청소 장비와 도구는 브링케어 직영팀이 준비합니다. 건물 전용 비품이 필요한 경우 별도로 안내합니다."],
  ["세금계산서 발행이 가능한가요?", "가능합니다. 안내된 금액은 부가세 별도이며 사업자 정보 확인 후 세금계산서를 발행합니다."],
  ["오염이 심하면 가격이 달라지나요?", "기본 범위를 넘는 특수오염, 대량 적치물, 왁스·고압세척 등은 현장 확인 후 별도 견적으로 안내합니다."],
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
          <div className="stair-section-head"><p>CLEANING DETAIL</p><strong className="stair-section-kicker">서비스 작업 범위</strong><h2 id="stair-field-title">계단 한 칸부터<br />공용창까지 관리합니다.</h2><span>건물 공용부에서 반복적으로 오염되는 구역을 작업 범위에 맞춰 관리합니다.</span></div>
          <div className="stair-gallery">
            <figure><Image src="/landing/cleaning/bringcare-stair-mop-down.png" alt="브링케어 유니폼 작업자의 계단 하행 밀대 청소 연출 이미지" fill unoptimized sizes="(max-width: 820px) 100vw, 58vw" /><figcaption><strong>계단 바닥</strong><span>한 층씩 이동하며 계단의 먼지와 생활 오염을 정리합니다.</span></figcaption></figure>
            <figure><Image src="/landing/cleaning/bringcare-stair-corner-brush.png" alt="브링케어 유니폼 작업자의 계단 모서리 브러시 청소 연출 이미지" fill unoptimized sizes="(max-width: 820px) 100vw, 42vw" /><figcaption><strong>모서리·틈새</strong><span>밀대가 닿기 어려운 계단 끝과 벽면 틈을 세부 청소합니다.</span></figcaption></figure>
            <figure><Image src="/landing/cleaning/bringcare-common-window.png" alt="브링케어 유니폼 작업자의 공용창 청소 연출 이미지" fill unoptimized sizes="(max-width: 820px) 100vw, 42vw" /><figcaption><strong>공용창·창틀</strong><span>건물 안으로 빛이 들어오는 공용창의 손자국과 먼지를 관리합니다.</span></figcaption></figure>
          </div>
        </div>
      </section>

      <section className="stair-section stair-soft stair-boundary" aria-labelledby="stair-boundary-title">
        <div className="stair-inner">
          <div className="stair-section-head"><p>SCOPE GUIDE</p><h2 id="stair-boundary-title">기본 청소와 별도 작업을<br />미리 구분했습니다.</h2><span>처음 상담할 때 포함 범위를 먼저 확인해 예상하지 못한 추가 비용을 줄입니다.</span></div>
          <div className="stair-boundary-grid">
            <article><header><span>기본 포함</span><strong>정기청소 범위</strong></header><ul>{includedWork.map((item) => <li key={item}><b>✓</b>{item}</li>)}</ul></article>
            <article className="stair-boundary-optional"><header><span>별도 협의</span><strong>추가 작업 범위</strong></header><ul>{optionalWork.map((item) => <li key={item}><b>＋</b>{item}</li>)}</ul><p>현장 작업비와 전문업체 시공비는 범위 확인 후 별도로 안내합니다.</p></article>
          </div>
        </div>
      </section>

      <section className="stair-section stair-references" aria-labelledby="stair-reference-title">
        <div className="stair-inner">
          <div className="stair-section-head">
            <p>BRING CARE MANAGEMENT RECORD</p>
            <h2 id="stair-reference-title">말보다 현장으로<br />보여드립니다.</h2>
            <span>연출 이미지가 아닌 BRING CARE의 실제 관리 현장입니다. 각 기록은 네이버 블로그 원문에서 확인할 수 있습니다.</span>
          </div>
          <div className="stair-reference-grid">
            {references.map((reference) => (
              <article key={reference.href}>
                <div className="stair-reference-image">
                  <Image src={reference.image} alt={reference.alt} fill unoptimized sizes="(max-width: 820px) 100vw, 50vw" />
                  <span>BRING CARE 실제 관리 기록</span>
                </div>
                <div className="stair-reference-copy">
                  <h3>{reference.title}</h3>
                  <dl className="stair-reference-detail">
                    <div><dt>확인한 문제</dt><dd>{reference.problem}</dd></div>
                    <div><dt>진행한 조치</dt><dd>{reference.action}</dd></div>
                    <div><dt>관리 결과</dt><dd>{reference.result}</dd></div>
                  </dl>
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

      <section className="stair-section stair-process" aria-labelledby="stair-process-title"><div className="stair-inner">
        <div className="stair-section-head"><p>PROCESS</p><h2 id="stair-process-title">상담부터 월간보고까지<br />한 흐름으로 진행합니다.</h2><span>건물주가 매번 현장에 오지 않아도 관리 과정을 확인할 수 있게 구성했습니다.</span></div>
        <ol className="stair-process-grid">{process.map(([title, copy]) => <li key={title}><strong>{title}</strong><p>{copy}</p></li>)}</ol>
      </div></section>

      <section className="stair-section stair-soft stair-price-section" id="price" aria-labelledby="stair-price-title">
        <div className="stair-inner"><div className="stair-section-head"><p>PRICE</p><h2 id="stair-price-title">건물 규모에 맞춰<br />투명하게 안내합니다.</h2><span>기본 가격을 먼저 확인하고, 현장 여건에 따라 정확한 견적을 안내받으세요.</span></div><div className="stair-pricing"><header><div><span>월 4회 정기청소</span><small>기본 관리 기준</small></div><strong>6만원부터</strong></header><dl><div><dt>3층 건물</dt><dd>월 60,000원</dd></div><div><dt>4층 건물</dt><dd>월 70,000원</dd></div><div><dt>5층 건물</dt><dd>월 80,000원</dd></div></dl><p>※ 부가세 별도 · 오염도와 관리 범위에 따라 변동될 수 있습니다.</p><a className="stair-btn stair-btn-primary" href="#estimate">우리 건물 견적 확인</a></div></div>
      </section>

      <section className="stair-section stair-faq" aria-labelledby="stair-faq-title"><div className="stair-inner">
        <div className="stair-section-head"><p>FAQ</p><h2 id="stair-faq-title">자주 묻는 질문</h2><span>견적을 신청하기 전에 궁금한 내용을 먼저 확인하세요.</span></div>
        <div className="stair-faq-list">{faqs.map(([question, answer], index) => <details key={question} open={index === 0}><summary>{question}<span aria-hidden="true">＋</span></summary><p>{answer}</p></details>)}</div>
      </div></section>

      <section className="stair-estimate" id="estimate" aria-labelledby="stair-estimate-title"><div className="stair-estimate-wrap"><div className="stair-estimate-head"><p>QUICK ESTIMATE</p><h2 id="stair-estimate-title">건물 정보만 알려주세요.<br />빠르게 확인해드릴게요.</h2><span>필수 항목만 남겨주시면 원주 직영팀이 확인 후 연락드립니다.</span></div><QuickEstimateForm service="계단·공용부 청소" sourcePath="/stair-cleaning" /><div className="stair-kakao"><span>더 빠른 상담이 필요하신가요?</span><a href="https://pf.kakao.com/_xnaRfX/chat" target="_blank" rel="noreferrer">카카오톡으로 상담</a></div></div></section>

      <a className="stair-sticky" href="#estimate"><span>무료 견적 신청</span><small>30초 만에 입력하기</small></a>
    </main>
  );
}
