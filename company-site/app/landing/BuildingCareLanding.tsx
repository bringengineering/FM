"use client";

import Image from "next/image";
import { KAKAO_CHAT_HREF, PHONE_HREF, PHONE_LABEL } from "./contact";
import QuickEstimateForm from "./QuickEstimateForm";
import { QuickEstimateExperience, QuickEstimateTrigger } from "./QuickEstimateExperience";
import { buildingCareCases, buildingCareFaq, buildingCarePillars, entryServices, managementSteps, turnoverSteps } from "./buildingCareData";
import "./building-care-sales.css";

const Arrow = () => <span aria-hidden="true">→</span>;

export default function BuildingCareLanding() {
  return <QuickEstimateExperience service="원룸·다가구 건물관리" sourcePath="/building-care" defaultCustomerType="building_owner" needsPlaceholder="건물 주소와 현재 가장 불편한 점을 적어주세요.">
    <main className="building-care-sales">
      <section id="building-care-hero" className="bc-hero"><div className="bc-shell bc-hero-grid">
        <div className="bc-hero-copy"><p className="bc-kicker">BRING CARE · BUILDING MANAGEMENT</p><h1>건물은 임대하고,<br />관리는 맡기세요.</h1><p className="bc-lead">공실부터 임차인·시설점검·민원·수리까지 건물주 대신 확인하고 처리합니다.</p><div className="bc-price"><strong>월 89,000원부터</strong><span>부가세 별도 · 기본 6개월</span></div><div className="bc-actions"><QuickEstimateTrigger className="bc-button bc-primary">무료 관리진단 신청</QuickEstimateTrigger><a className="bc-button" href={PHONE_HREF}>{PHONE_LABEL}</a></div></div>
        <div className="bc-hero-visual"><Image src="/landing/records/vacancy-check.jpg" alt="BRING CARE 실제 공실 관리 현장" fill priority unoptimized sizes="(max-width: 760px) 100vw, 50vw"/><div className="bc-report-float"><small>이번 달 관리 현황</small><strong>정기 확인 4회 완료</strong><span>현장 사진 · 확인 사항 · 후속 제안</span></div></div>
      </div></section>

      <section id="owner-problem" className="bc-section"><div className="bc-shell"><header className="bc-heading"><p className="bc-kicker">CUSTOMER PROBLEM</p><h2>건물 하나 관리하는데,<br />왜 이렇게 연락할 곳이 많을까요?</h2><p>작은 문제 하나가 생겨도 업체를 찾고, 일정을 맞추고, 결과를 다시 확인해야 합니다.</p></header><div className="bc-problem-grid">{[["01","공실·퇴실","현장 확인 → 청소업체 → 수리업체 → 중개사"],["02","시설·민원","임차인 연락 → 상황 파악 → 현장 확인 → 전문업체"],["03","결과 확인","일정 조율 → 비용 승인 → 완료 확인 → 기록"]].map(([n,t,c])=><article className="bc-card" key={t}><span>{n}</span><h3>{t}</h3><p>{c}</p></article>)}</div></div></section>

      <section id="one-contact" className="bc-section"><div className="bc-shell bc-split"><header className="bc-heading"><p className="bc-kicker">ONE CONTACT</p><h2>건물 관리창구를<br />하나로 줄입니다.</h2><p>건물주는 BRING CARE 한 곳에 요청하고, 현장 확인과 필요한 연결은 저희가 정리합니다.</p></header><div className="bc-contact-network"><div className="bc-owner">건물주</div><Arrow/><div className="bc-core">BRING<br/>CARE</div><div className="bc-spokes"><span>청소</span><span>시설</span><span>공실</span><span>민원</span><span>수리</span></div></div></div></section>

      <section id="care-system" className="bc-section"><div className="bc-shell"><header className="bc-heading"><p className="bc-kicker">CARE SYSTEM</p><h2>청소가 아니라,<br />건물 운영의 흐름을 관리합니다.</h2></header><div className="bc-pillar-grid">{buildingCarePillars.map(x=><article className="bc-card bc-pillar" key={x.id}><div className="bc-pillar-image"><Image src={x.image} alt={`BRING CARE 실제 ${x.title} 현장`} fill unoptimized sizes="(max-width: 760px) 100vw, 33vw"/></div><p>{x.english}</p><h3>{x.title}</h3><span>{x.copy}</span><ul>{x.items.map(i=><li key={i}>{i}</li>)}</ul></article>)}</div></div></section>

      <section id="management-process" className="bc-section"><div className="bc-shell"><header className="bc-heading"><p className="bc-kicker">MANAGEMENT PROCESS</p><h2>상담부터 월간 보고까지,<br />관리 기준을 먼저 세웁니다.</h2></header><ol className="bc-process">{managementSteps.map((x,i)=><li key={x}><span>{String(i+1).padStart(2,"0")}</span><strong>{x}</strong></li>)}</ol></div></section>

      <section id="turnover-package" className="bc-section"><div className="bc-shell"><header className="bc-heading"><p className="bc-kicker">24H TURNOVER CARE</p><h2>퇴실하는 순간부터<br />다음 입실을 준비합니다.</h2><p>공실을 발견한 뒤 움직이지 않고, 퇴실 접수부터 청소·수리·촬영·중개 공유를 한 흐름으로 준비합니다.</p></header><div className="bc-turnover-track">{turnoverSteps.map((x,i)=><div key={x}><span>{i+1}</span><strong>{x}</strong></div>)}</div></div></section>

      <section id="turnover-time" className="bc-section"><div className="bc-shell"><header className="bc-heading"><p className="bc-kicker">VACANCY TURNAROUND TIME</p><h2>공실만 관리하지 않습니다.<br />공실의 ‘시간’을 관리합니다.</h2></header><div className="bc-parallel-track"><article><h3>일반적인 순차 진행</h3>{["퇴실","현장확인 대기","청소 일정 대기","수리 일정 대기","촬영·중개사 전달","입실"].map(x=><span key={x}>{x}</span>)}</article><article><h3>BRING의 병렬 준비</h3>{["퇴실 접수 → 현장 확인","청소·수리·폐기물 동시 준비","촬영·공실정보 정리","협력 중개사 공유","입실 준비 → 다음 입실"].map(x=><span key={x}>{x}</span>)}</article></div></div></section>

      <section id="building-care-price" className="bc-section"><div className="bc-shell"><header className="bc-heading"><p className="bc-kicker">SIMPLE PRICE</p><h2>기본 관리비는<br />명확하게 시작합니다.</h2></header><div className="bc-price-card"><div><span>원룸·다가구 공동관리</span><strong>월 89,000원부터</strong><small>부가세 별도 · 기본 6개월</small></div><ul><li>정기 현장 확인</li><li>공실·공용부 상태 기록</li><li>민원·업체 연결</li><li>월간 관리보고</li></ul><p>청소·수리·자재·전문 시공비는 관리비와 구분해 사전 안내 후 진행합니다.</p></div></div></section>

      <section id="entry-services" className="bc-section"><div className="bc-shell"><header className="bc-heading"><p className="bc-kicker">ENTRY SERVICE</p><h2>필요한 서비스부터<br />가볍게 시작할 수 있습니다.</h2></header><div className="bc-entry-grid">{entryServices.map((x,i)=><article className="bc-card" key={x.title}><span>0{i+1}</span><h3>{x.title}</h3><p>{x.copy}</p><a href={x.href}>{x.cta} <Arrow/></a></article>)}</div></div></section>

      <section id="real-cases" className="bc-section"><div className="bc-shell"><header className="bc-heading"><p className="bc-kicker">REAL MANAGEMENT RECORD</p><h2>말보다 현장으로 보여드립니다.</h2><p>연출 사진이 아닌 BRING CARE가 실제로 확인하고 기록한 관리 현장입니다.</p></header><div className="bc-case-grid">{buildingCareCases.map(x=><article className="bc-case-card" key={x.title}><div><Image src={x.image} alt={`BRING CARE 실제 현장기록 - ${x.title}`} fill unoptimized sizes="(max-width: 760px) 100vw, 33vw"/></div><h3>{x.title}</h3><p>{x.copy}</p></article>)}</div></div></section>

      <section id="management-report" className="bc-section"><div className="bc-shell bc-split"><header className="bc-heading"><p className="bc-kicker">MONTHLY REPORT</p><h2>건물에 가지 않아도<br />관리 상태를 확인하세요.</h2><p>사진만 보내고 끝내지 않습니다. 방문 이력과 확인 사항, 필요한 후속 조치를 한 달 단위로 정리합니다.</p><ul className="bc-checks"><li>정기 방문 이력</li><li>공용부·공실 확인 사항</li><li>후속 조치 제안</li></ul></header><div className="bc-report-ui"><span>관리보고 화면 예시</span><div className="bc-report-head"><strong>8월 월간 관리보고</strong><b>관리 완료</b></div>{[["정기방문","4회 완료"],["공용부 확인","계단·현관·우편함"],["확인 사항","후속 확인 1건"],["현장 사진","12장 첨부"]].map(([a,b])=><p key={a}><span>{a}</span><strong>{b}</strong></p>)}</div></div></section>

      <section id="trust-operations" className="bc-section"><div className="bc-shell"><header className="bc-heading"><p className="bc-kicker">TRUST & OPERATIONS</p><h2>현장을 확인하고,<br />기록이 남는 방식으로 운영합니다.</h2></header><div className="bc-trust-grid">{[["원주 직영 운영","지역 현장을 직접 확인합니다."],["사전 승인 원칙","추가 비용이 필요한 작업은 먼저 안내합니다."],["현장 기록","확인 위치와 처리 결과를 사진으로 남깁니다."],["파트너 협업","전문 작업은 범위와 완료 상태를 함께 확인합니다."]].map(([a,b])=><article className="bc-card" key={a}><h3>{a}</h3><p>{b}</p></article>)}</div></div></section>

      <section id="building-care-faq" className="bc-section"><div className="bc-shell"><header className="bc-heading"><p className="bc-kicker">FAQ</p><h2>건물주가 많이 묻는 질문</h2></header><div className="bc-faq">{buildingCareFaq.map(([q,a])=><details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div></div></section>

      <section id="building-care-consultation" className="bc-section"><div className="bc-shell bc-consult"><div><p className="bc-kicker">FREE MANAGEMENT CHECK</p><h2>건물 주소와 불편한 점만<br />알려주세요.</h2><p>현재 관리 방식과 필요한 범위를 확인해 BRING CARE가 먼저 정리해드리겠습니다.</p><a className="bc-kakao" href={KAKAO_CHAT_HREF} target="_blank" rel="noreferrer">카카오톡으로 바로 상담</a></div><QuickEstimateForm service="원룸·다가구 건물관리" sourcePath="/building-care"/></div></section>
    </main>
  </QuickEstimateExperience>;
}
