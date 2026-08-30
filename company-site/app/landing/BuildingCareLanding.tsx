"use client";

import Image from "next/image";
import { KAKAO_CHAT_HREF, PHONE_HREF, PHONE_LABEL } from "./contact";
import QuickEstimateForm from "./QuickEstimateForm";
import { QuickEstimateExperience, QuickEstimateTrigger } from "./QuickEstimateExperience";
import { buildingCareCases, buildingCareFaq, turnoverSteps } from "./buildingCareData";
import BuildingCarePartnership from "./BuildingCarePartnership";
import BuildingCarePricingGrid from "./BuildingCarePricingGrid";
import BuildingCareTestimonials from "./BuildingCareTestimonials";
import BuildingCareExperienceCards from "./BuildingCareExperienceCards";
import BuildingCareCredentials from "./BuildingCareCredentials";
import {
  BrandTeamManifesto,
  CertificationTrustBar,
  ManagementComparison,
  ManagementCycle,
  ManagementScopeTable,
  OperatingStandardComparison,
  ServiceVisualMenu,
} from "./BuildingCareVisualBlocks";
import "./building-care-sales.css";

const ProblemIcon = ({ type }: { type: "vacancy" | "facility" | "result" }) => {
  const paths = {
    vacancy: <><path d="M5 4.5h10v15H5z"/><path d="M15 8h4v11.5H9"/><path d="M9 12h.01"/><path d="m16.5 5.5 2-2 2 2"/></>,
    facility: <><path d="m14.5 6.5 3-3 3 3-3 3"/><path d="m16.5 7.5-7 7"/><path d="M8 13.5 4.5 17 7 19.5 10.5 16"/><path d="M4 5.5h7v5H7l-3 2z"/></>,
    result: <><path d="M6 3.5h12v17H6z"/><path d="M9 8h6M9 12h6"/><path d="m9 16 1.5 1.5L15 14"/></>,
  } as const;
  return <svg className="bc-problem-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[type]}</svg>;
};

const ContactIcon = ({ type }: { type: "owner" | "clean" | "facility" | "vacancy" | "complaint" | "repair" }) => {
  const paths = {
    owner: <><circle cx="9" cy="7" r="3"/><path d="M4 20v-3a5 5 0 0 1 10 0v3M15 9h5v11h-5zM17.5 12h.01M17.5 15h.01"/></>,
    clean: <><path d="m7 18 7-7 4 4-7 7H7zM14 11l2-7 4 4-6 3zM5 6v3M3.5 7.5h3"/></>,
    facility: <><path d="M5 21V4h12v17M9 8h1M13 8h1M9 12h1M13 12h1M9 16h1M13 16h1"/><path d="m17 11 2 2 3-3"/></>,
    vacancy: <><path d="M4 20V8l8-4 8 4v12M8 20v-6h8v6M7 10h.01M17 10h.01"/></>,
    complaint: <><path d="M4 5h16v11H9l-5 4zM8 10h.01M12 10h.01M16 10h.01"/></>,
    repair: <><path d="m14 6 4-4 4 4-4 4M16 8 8 16M8 14l-5 5 2 2 5-5M5 5l4 4"/></>,
  } as const;
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[type]}</svg>;
};

export default function BuildingCareLanding() {
  return <QuickEstimateExperience service="원룸·다가구 건물관리" sourcePath="/building-care" defaultCustomerType="building_owner" needsPlaceholder="건물 주소와 현재 가장 불편한 점을 적어주세요.">
    <main className="building-care-sales">
      <BrandTeamManifesto />
      <CertificationTrustBar />
      <BuildingCareCredentials />

      <section id="owner-problem" className="bc-section"><div className="bc-shell"><header className="bc-heading"><p className="bc-kicker">CUSTOMER PROBLEM</p><h2>건물 하나 관리하는데,<br />왜 이렇게 연락할 곳이 많을까요?</h2><p>작은 문제 하나가 생겨도 업체를 찾고, 일정을 맞추고, 결과를 다시 확인해야 합니다.</p></header><div className="bc-problem-grid">{[
        { n: "01", type: "vacancy" as const, title: "공실·퇴실", copy: "현장 확인 → 청소업체 → 수리업체 → 중개사" },
        { n: "02", type: "facility" as const, title: "시설·민원", copy: "임차인 연락 → 상황 파악 → 현장 확인 → 전문업체" },
        { n: "03", type: "result" as const, title: "결과 확인", copy: "일정 조율 → 비용 승인 → 완료 확인 → 기록" },
      ].map((item)=><article className="bc-card bc-problem-card" key={item.title}><div className="bc-problem-top"><ProblemIcon type={item.type}/><span>{item.n}</span></div><h3>{item.title}</h3><p>{item.copy}</p></article>)}</div></div></section>

      <section id="one-contact" className="bc-section"><div className="bc-shell"><header className="bc-heading bc-one-contact-heading"><p className="bc-kicker">ONE CONTACT</p><h2>건물주의 가치를 높이는<br /><strong>BRING CARE 통합 관리 서비스</strong></h2><p>건물주는 한 곳에 요청하고, 현장 확인부터 필요한 업체 연결과 결과 기록까지 BRING CARE가 정리합니다.</p></header><div className="bc-contact-network bc-contact-infographic"><article className="bc-contact-owner"><ContactIcon type="owner"/><h3>건물주</h3><p>믿고 맡기는<br/>든든한 파트너</p></article><div className="bc-contact-core"><span>BRING</span><strong>CARE</strong><small>건물의 가치를 지키는<br/>통합 관리 솔루션</small></div><div className="bc-contact-services">{[
        { type: "clean" as const, title: "청소", copy: "정기·입주·퇴실 청소" },
        { type: "facility" as const, title: "시설", copy: "설비 점검 및 유지관리" },
        { type: "vacancy" as const, title: "공실", copy: "임대차·공실 관리" },
        { type: "complaint" as const, title: "민원", copy: "입주민 민원 대응" },
        { type: "repair" as const, title: "수리", copy: "긴급·일반 수리 조율" },
      ].map(item=><article className="bc-contact-service" key={item.title}><ContactIcon type={item.type}/><div><h3>{item.title}</h3><p>{item.copy}</p></div></article>)}</div><div className="bc-contact-values">{[
        ["전문성","체계적인 관리 기준"],["효율성","시간과 비용 절약"],["신뢰성","투명한 확인과 기록"],["현장성","원주 직영팀 현장 대응"],
      ].map(([title,copy], index)=><article className="bc-contact-value" key={title}><span>{["◇","◷","↗","○"][index]}</span><div><strong>{title}</strong><small>{copy}</small></div></article>)}</div></div></div></section>

      <BuildingCarePartnership />

      <section id="service-menu" className="bc-section bc-visual-section"><div className="bc-shell"><ServiceVisualMenu /></div></section>
      <section id="management-cycle" className="bc-section bc-visual-section"><div className="bc-shell"><ManagementCycle /></div></section>

      <section id="real-cases" className="bc-section"><div className="bc-shell"><header className="bc-heading"><p className="bc-kicker">REAL MANAGEMENT RECORD</p><h2>말보다 현장으로 보여드립니다.</h2><p>연출 사진이 아닌 BRING CARE가 실제로 확인하고 기록한 관리 현장입니다.</p></header><div className="bc-case-grid">{buildingCareCases.map(x=><article className="bc-case-card" key={x.title}><div><Image src={x.image} alt={`BRING CARE 실제 현장기록 - ${x.title}`} fill unoptimized sizes="(max-width: 760px) 100vw, 33vw"/></div><h3>{x.title}</h3><p>{x.copy}</p><dl className="bc-case-evidence"><div><dt>확인한 문제</dt><dd>{x.problem}</dd></div><div><dt>진행한 조치</dt><dd>{x.action}</dd></div><div><dt>남긴 결과</dt><dd>{x.result}</dd></div></dl></article>)}</div></div></section>
      <BuildingCareExperienceCards />
      <BuildingCareTestimonials />

      <section id="management-report" className="bc-section"><div className="bc-shell bc-split"><header className="bc-heading"><p className="bc-kicker">MONTHLY REPORT</p><h2>건물에 가지 않아도<br />관리 상태를 확인하세요.</h2><p>사진만 보내고 끝내지 않습니다. 방문 이력과 확인 사항, 필요한 후속 조치를 한 달 단위로 정리합니다.</p><ul className="bc-checks"><li>정기 방문 이력</li><li>공용부·공실 확인 사항</li><li>후속 조치 제안</li></ul></header><div className="bc-report-ui"><span>관리보고 화면 예시</span><div className="bc-report-head"><strong>8월 월간 관리보고</strong><b>관리 완료</b></div>{[["정기방문","주 2회 방문"],["공용부 확인","계단·현관·우편함"],["확인 사항","후속 확인 1건"],["현장 사진","12장 첨부"]].map(([a,b])=><p key={a}><span>{a}</span><strong>{b}</strong></p>)}</div></div></section>

      <div className="bc-shell"><section className="bc-mid-cta"><p>이 건물은 어떻게 관리할지<br />먼저 받아보세요.</p><div className="bc-actions"><QuickEstimateTrigger className="bc-button bc-primary">무료 관리진단 신청</QuickEstimateTrigger><a className="bc-button" href={PHONE_HREF}>{PHONE_LABEL}</a></div></section></div>

      <section id="management-comparison" className="bc-section bc-visual-section"><div className="bc-shell"><ManagementComparison /></div></section>
      <section id="management-scope" className="bc-section bc-visual-section"><div className="bc-shell"><ManagementScopeTable /></div></section>

      <section id="building-care-price" className="bc-section"><div className="bc-shell"><header className="bc-heading"><p className="bc-kicker">CLEAR PRICING</p><h2>관리와 청소를 나눠<br />필요한 만큼 선택하세요.</h2><p>기본 관리와 정기청소의 방문 횟수와 비용을 분명하게 구분했습니다.</p></header><BuildingCarePricingGrid /></div></section>

      <section id="turnover-package" className="bc-section"><div className="bc-shell"><header className="bc-heading"><p className="bc-kicker">24H TURNOVER CARE</p><h2>퇴실하는 순간부터<br />다음 입실을 준비합니다.</h2><p>공실을 발견한 뒤 움직이지 않고, 퇴실 접수부터 청소·수리·촬영·중개 공유를 한 흐름으로 준비합니다.</p></header><div className="bc-turnover-track">{turnoverSteps.map((x,i)=><div key={x}><span>{i+1}</span><strong>{x}</strong></div>)}</div></div></section>

      <section id="turnover-time" className="bc-section"><div className="bc-shell"><header className="bc-heading"><p className="bc-kicker">VACANCY TURNAROUND TIME</p><h2>공실만 관리하지 않습니다.<br />공실의 ‘시간’을 관리합니다.</h2></header><div className="bc-parallel-track"><article><h3>일반적인 순차 진행</h3>{["퇴실","현장확인 대기","청소 일정 대기","수리 일정 대기","촬영·중개사 전달","입실"].map(x=><span key={x}>{x}</span>)}</article><article><h3>BRING의 병렬 준비</h3>{["퇴실 접수 → 현장 확인","청소·수리·폐기물 동시 준비","촬영·공실정보 정리","협력 중개사 공유","입실 준비 → 다음 입실"].map(x=><span key={x}>{x}</span>)}</article></div></div></section>

      <section id="operating-standard" className="bc-section bc-visual-section"><div className="bc-shell"><OperatingStandardComparison /></div></section>

      <section id="trust-operations" className="bc-section"><div className="bc-shell"><header className="bc-heading"><p className="bc-kicker">TRUST & OPERATIONS</p><h2>현장을 확인하고,<br />기록이 남는 방식으로 운영합니다.</h2></header><div className="bc-trust-grid">{[["원주 직영 운영","지역 현장을 직접 확인합니다."],["사전 승인 원칙","추가 비용이 필요한 작업은 먼저 안내합니다."],["현장 기록","확인 위치와 처리 결과를 사진으로 남깁니다."],["파트너 협업","전문 작업은 범위와 완료 상태를 함께 확인합니다."]].map(([a,b])=><article className="bc-card" key={a}><h3>{a}</h3><p>{b}</p></article>)}</div></div></section>

      <section id="building-care-faq" className="bc-section"><div className="bc-shell"><header className="bc-heading"><p className="bc-kicker">FAQ</p><h2>건물주가 많이 묻는 질문</h2></header><div className="bc-faq">{buildingCareFaq.map(([q,a])=><details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div></div></section>

      <section id="building-care-consultation" className="bc-section"><div className="bc-shell bc-consult"><div><p className="bc-kicker">FREE MANAGEMENT CHECK</p><h2>건물 주소와 불편한 점만<br />알려주세요.</h2><p>현재 관리 방식과 필요한 범위를 확인해 BRING CARE가 먼저 정리해드리겠습니다.</p><a className="bc-kakao" href={KAKAO_CHAT_HREF} target="_blank" rel="noreferrer">카카오톡으로 바로 상담</a></div><QuickEstimateForm service="원룸·다가구 건물관리" sourcePath="/building-care"/></div></section>
    </main>
  </QuickEstimateExperience>;
}
