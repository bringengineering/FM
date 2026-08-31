import Image from "next/image";
import { PHONE_HREF, PHONE_LABEL } from "./contact";
import QuickEstimateForm from "./QuickEstimateForm";
import LandingBrandIntro from "./LandingBrandIntro";
import RelatedServices from "./RelatedServices";
import "./stair-cleaning.css";

const facts = [
  ["01", "구역별 집중청소", "창문부터 욕실·주방·수납장까지 필요한 구역을 나눠 관리합니다."],
  ["02", "전문 장비 사용", "오염 종류와 공간에 맞는 장비와 도구로 작업합니다."],
  ["03", "완료 상태 확인", "청소가 끝난 뒤 주요 구역의 작업 상태를 확인합니다."],
  ["04", "원주 직영팀", "상담부터 현장 작업까지 지역 직영팀이 직접 대응합니다."],
] as const;

const scopes = [
  ["01", "창문·창틀", "유리의 손자국과 창틀·레일에 쌓인 먼지와 오염을 정리합니다.", "/landing/movein-campaign/suit-window.png", "검은 정장을 입은 브링케어 관리자의 창문 청소 캠페인 이미지"],
  ["02", "욕실·배수구", "욕실의 물때와 배수구 주변처럼 오염이 남기 쉬운 구역을 관리합니다.", "/landing/movein-campaign/suit-bathroom-drain.png", "검은 정장을 입은 브링케어 관리자의 욕실 배수구 청소 캠페인 이미지"],
  ["03", "주방·후드", "주방 상판과 후드 주변에 남은 먼지와 기름 오염을 꼼꼼히 확인합니다.", "/landing/movein-campaign/suit-kitchen-hood.png", "검은 정장을 입은 브링케어 관리자의 주방 후드 청소 캠페인 이미지"],
  ["04", "수납장 안쪽", "붙박이장과 신발장 등 수납공간을 열어 내부 먼지까지 정리합니다.", "/landing/movein-campaign/suit-cabinet.png", "검은 정장을 입은 브링케어 관리자의 붙박이장 청소 캠페인 이미지"],
] as const;

const details = [
  ["바닥·모서리", "벽면과 맞닿는 바닥 가장자리까지 정리합니다.", "/landing/movein-campaign/suit-floor-edge.png", "검은 정장을 입은 브링케어 관리자의 바닥 모서리 청소 캠페인 이미지"],
  ["창틀·레일", "먼지가 쌓이는 레일과 좁은 틈을 브러시로 관리합니다.", "/landing/movein-campaign/suit-window-track.png", "검은 정장을 입은 브링케어 관리자의 창틀 레일 청소 캠페인 이미지"],
  ["천장·환기구", "손이 잘 닿지 않는 높은 곳도 범위에 맞춰 확인합니다.", "/landing/movein-campaign/suit-ceiling-vent.png", "검은 정장을 입은 브링케어 관리자의 천장 환기구 청소 캠페인 이미지"],
] as const;

const moveInHubItems = [
  ["▣", "창문·창틀", "빛이 들어오는 구역"],
  ["◉", "욕실·배수구", "물때가 남기 쉬운 구역"],
  ["⌂", "주방·후드", "기름 오염 확인 구역"],
  ["▤", "수납장 안쪽", "문을 열어 확인하는 구역"],
  ["⌞", "바닥·모서리", "먼지가 모이는 가장자리"],
  ["↔", "창틀·레일", "좁은 틈 집중 구역"],
  ["✦", "천장·환기구", "손이 닿기 어려운 구역"],
] as const;

const moveInProcess = [
  ["01", "상담 접수", "공간 위치와 유형, 희망 일정을 확인합니다."],
  ["02", "범위 확인", "면적과 주요 오염, 필요한 추가 작업을 먼저 정리합니다."],
  ["03", "구역별 청소", "창문·욕실·주방·수납장과 세부 구역을 순서대로 작업합니다."],
  ["04", "완료 확인", "요청한 범위와 주요 구역의 마무리 상태를 다시 확인합니다."],
] as const;

export default function MoveInCleaningLanding() {
  return (
    <main className="stair-toss movein-toss">
      <LandingBrandIntro serviceHref="#service" estimateHref="#estimate" />
      <header className="stair-nav">
        <a className="stair-logo" href="/" aria-label="BRING CARE 홈">BRING <span>CARE</span></a>
        <nav aria-label="주요 메뉴">
          <a href="#service">서비스</a><a href="#price">가격안내</a><a href="#detail">청소범위</a>
          <a className="stair-nav-call" href={PHONE_HREF}>전화 상담</a>
        </nav>
      </header>

      <section className="stair-hero" aria-labelledby="movein-title">
        <div className="stair-hero-card stair-ad-hero movein-ad-hero">
          <Image src="/landing/movein-campaign/suit-window.png" alt="검은 정장을 입은 브링케어 관리자의 창문 청소 캠페인 이미지" fill priority unoptimized sizes="(max-width: 820px) 100vw, 1240px" />
          <div className="stair-hero-copy">
            <p className="stair-eyebrow">원주 직영팀 · 입주/이사청소</p>
            <h1 id="movein-title">새 공간의 첫날,<br />보이는 곳부터<br />숨은 곳까지.</h1>
            <p>창문·욕실·주방·수납장·바닥까지, 입주 전에 필요한 청소 범위를 한 번에 확인하고 맡기세요.</p>
            <div className="stair-hero-actions">
              <a className="stair-btn stair-btn-primary" href="#estimate">30초 간편 견적</a>
              <a className="stair-btn stair-btn-white" href={PHONE_HREF}>{PHONE_LABEL}</a>
            </div>
          </div>
          <div className="stair-price-pill"><span>일반 단건 입·퇴실청소</span><strong>12만원부터</strong><small>부가세 별도 · 면적과 오염도에 따라 변동</small></div>
        </div>
      </section>

      <section className="stair-facts" aria-label="서비스 핵심 정보"><div className="stair-inner stair-fact-grid">
        {facts.map(([number, title, copy]) => <article key={title}><span>{number}</span><strong>{title}</strong><p>{copy}</p></article>)}
      </div></section>

      <section className="stair-section movein-scope-summary" aria-labelledby="movein-summary-title"><div className="stair-inner">
        <div className="stair-section-head stair-summary-head"><p>MOVE-IN CLEANING MAP</p><h2 id="movein-summary-title">입주 전 확인할 청소 구역을<br />한눈에 정리했습니다.</h2><span>눈에 보이는 바닥뿐 아니라 입주 후 불편이 생기기 쉬운 안쪽과 틈까지 구역별로 확인합니다.</span></div>
        <div className="movein-scope-hub"><div className="movein-hub-core"><small>BEFORE MOVE-IN</small><strong>7개 핵심<br />청소 구역</strong><span>구역별 작업·완료 확인</span></div><div className="movein-hub-items">{moveInHubItems.map(([symbol,title,copy]) => <article className="movein-hub-item" key={title}><b aria-hidden="true">{symbol}</b><div><strong>{title}</strong><small>{copy}</small></div></article>)}</div></div>
      </div></section>

      <section className="stair-section stair-soft" id="service" aria-labelledby="movein-scope-title"><div className="stair-inner">
        <div className="stair-section-head"><p>SERVICE SCOPE</p><h2 id="movein-scope-title">입주 전에 필요한 곳을<br />구역별로 청소합니다.</h2><span>눈에 잘 보이는 공간은 물론 오염이 남기 쉬운 안쪽과 틈까지 작업 범위에 맞춰 관리합니다.</span></div>
        <div className="stair-scope-grid">{scopes.map(([number, title, copy, image, alt]) => <article key={title}><span>{number}</span><h3>{title}</h3><p>{copy}</p><div className="stair-scope-image"><Image src={image} alt={alt} fill unoptimized sizes="(max-width: 820px) 100vw, 50vw" /></div></article>)}</div>
      </div></section>

      <section className="stair-section" id="detail" aria-labelledby="movein-detail-title"><div className="stair-inner">
        <div className="stair-section-head"><p>CLEANING DETAIL</p><h2 id="movein-detail-title">손이 잘 닿지 않는 곳도<br />놓치지 않습니다.</h2><span>입주 후 불편이 생기기 쉬운 세부 구역까지 확인합니다.</span></div>
        <div className="stair-gallery">{details.map(([title, copy, image, alt]) => <figure key={title}><Image src={image} alt={alt} fill unoptimized sizes="(max-width: 820px) 100vw, 42vw" /><figcaption><strong>{title}</strong><span>{copy}</span></figcaption></figure>)}</div>
      </div></section>

      <section className="stair-section stair-soft" aria-labelledby="movein-check-title"><div className="stair-inner stair-report-grid">
        <div className="stair-report-copy"><p className="stair-tag">FINAL CHECK</p><h2 id="movein-check-title">청소가 끝난 뒤<br />주요 구역을 확인합니다.</h2><span>작업만 하고 끝내지 않고 요청 범위와 주요 구역의 완료 상태를 다시 살핍니다.</span><ul><li><b>✓</b><div><strong>요청 범위 확인</strong><small>상담 시 정한 작업 구역 확인</small></div></li><li><b>✓</b><div><strong>구역별 마무리 점검</strong><small>창문·욕실·주방·수납장 등 확인</small></div></li><li><b>✓</b><div><strong>추가 확인사항 안내</strong><small>현장에서 발견된 사항을 고객에게 안내</small></div></li></ul></div>
        <div className="stair-report-card"><header><strong>입주청소 완료 확인 예시</strong><span>작업 완료</span></header><dl><div><dt>창문·창틀</dt><dd>완료</dd></div><div><dt>욕실·배수구</dt><dd>완료</dd></div><div><dt>주방·수납장</dt><dd>완료</dd></div><div><dt>바닥·모서리</dt><dd>완료</dd></div></dl></div>
      </div></section>

      <section className="stair-section movein-process" aria-labelledby="movein-process-title"><div className="stair-inner">
        <div className="stair-section-head"><p>PROCESS</p><h2 id="movein-process-title">상담부터 완료 확인까지<br />네 단계로 진행합니다.</h2><span>무엇을 언제 확인하는지 알 수 있도록 상담과 현장 작업 과정을 단순하게 정리했습니다.</span></div>
        <ol className="movein-process-grid">{moveInProcess.map(([number,title,copy]) => <li key={number}><span>{number}</span><strong>{title}</strong><p>{copy}</p></li>)}</ol>
      </div></section>

      <div className="stair-inner"><section className="stair-mid-cta movein-mid-cta" aria-label="입주 이사청소 견적 안내"><div><span>사진이 없어도 괜찮습니다.</span><strong>공간 위치와 유형만 알려주시면<br />필요한 청소 범위부터 확인합니다.</strong></div><a className="stair-btn stair-btn-primary" href="#estimate">무료 범위 확인</a></section></div>

      <section className="stair-section stair-soft stair-price-section" id="price" aria-labelledby="movein-price-title"><div className="stair-inner">
        <div className="stair-section-head"><p>PRICE</p><h2 id="movein-price-title">청소 유형에 맞춰<br />먼저 가격을 안내합니다.</h2><span>면적, 오염도, 잔존 물품과 추가 작업 여부에 따라 최종 견적이 달라질 수 있습니다.</span></div>
        <div className="stair-pricing"><header><div><span>입주·이사청소</span><small>기본 가격 안내</small></div><strong>10만원부터</strong></header><dl><div><dt>일반 단건 입·퇴실청소</dt><dd>120,000원부터</dd></div><div><dt>관리 건물 입·퇴실청소</dt><dd>100,000원부터</dd></div></dl><p>※ 부가세 별도 · 면적, 오염도, 잔존 물품과 옵션에 따라 변동될 수 있습니다.</p><a className="stair-btn stair-btn-primary" href="#estimate">우리 집 견적 확인</a></div>
      </div></section>

      <section className="stair-estimate" id="estimate" aria-labelledby="movein-estimate-title"><div className="stair-estimate-wrap"><div className="stair-estimate-head"><p>QUICK ESTIMATE</p><h2 id="movein-estimate-title">청소할 공간만 알려주세요.<br />빠르게 확인해드릴게요.</h2><span>필수 항목만 남겨주시면 원주 직영팀이 확인 후 연락드립니다.</span></div><QuickEstimateForm service="입주·이사청소" sourcePath="/move-in-cleaning" /><div className="stair-kakao"><span>더 빠른 상담이 필요하신가요?</span><a href="https://pf.kakao.com/_xnaRfX/chat" target="_blank" rel="noreferrer">카카오톡으로 상담</a></div></div></section>
      <RelatedServices current="move-in-cleaning" />
      <a className="stair-sticky" href="#estimate"><span>무료 견적 신청</span><small>30초 만에 입력하기</small></a>
    </main>
  );
}
