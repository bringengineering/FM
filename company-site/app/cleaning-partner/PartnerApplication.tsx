"use client";

import { FormEvent, useState } from "react";
import { submitMarketingLead } from "../landing/marketingLeadClient";

export default function PartnerApplication() {
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const phone = String(data.get("phone") || "").replace(/[^0-9]/g, "").replace(/^(010)(\d{4})(\d{4})$/, "$1-$2-$3");
    const services = data.getAll("services").map(String);
    setState("sending"); setError("");
    try {
      await submitMarketingLead({
        name: String(data.get("representative") || "").trim(), phone,
        location: String(data.get("region") || "").trim(),
        needs: `가능 서비스: ${services.join(", ")}\n지원 메모: ${String(data.get("memo") || "").trim()}`,
        buildingInfo: `경력 ${data.get("experienceYears") || 0}년 · ${data.get("headcount") || 1}명 · 일 ${data.get("dailyCapacity") || 1}건`,
        customerType: "cleaning_partner", service: "Cleaning Partner 지원", sourcePath: "/cleaning-partner",
        utmSource: new URLSearchParams(location.search).get("utm_source") || "direct",
        utmCampaign: new URLSearchParams(location.search).get("utm_campaign") || "partner_recruitment",
        utmTerm: new URLSearchParams(location.search).get("utm_term") || "", consent: data.get("consent") === "on",
        leadType: "partner_application", businessName: String(data.get("businessName") || "").trim(),
        businessNumber: String(data.get("businessNumber") || "").trim(), services: services.join(","),
        headcount: Number(data.get("headcount") || 1), dailyCapacity: Number(data.get("dailyCapacity") || 1),
        vehicle: String(data.get("vehicle") || "").trim(), experienceYears: Number(data.get("experienceYears") || 0),
        invoiceAvailable: data.get("invoiceAvailable") === "on", insured: data.get("insured") === "on",
      });
      setState("done"); form.reset();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "접수하지 못했습니다."); setState("idle"); }
  }

  return <main className="cp-page">
    <header className="cp-nav"><a href="/">BRING <b>CARE</b></a><a href="tel:0337468919">033-746-8919</a></header>
    <section className="cp-hero"><div><p>BRING CARE · CLEANING PARTNER</p><h1>잘하는 팀이<br/>제값 받고 일하도록.</h1><p className="cp-lead">영업·상담·결제·고객 CS는 브링케어가 맡습니다.<br/>Partner는 정해진 범위와 품질에 집중합니다.</p><a href="#apply">Partner 지원하기 <span>↓</span></a></div></section>
    <section className="cp-values"><div><p className="cp-label">PARTNER STANDARD</p><h2>단순 하청이 아니라<br/><em>함께 성장하는 운영 파트너</em>입니다.</h2><div className="cp-grid"><article><b>01</b><h3>현장 추가금 없음</h3><p>사전에 확정한 범위와 가격을 지켜 고객 신뢰를 함께 만듭니다.</p></article><article><b>02</b><h3>유상 시험작업 2건</h3><p>말이 아니라 실제 품질을 확인하고, 통과한 팀부터 정식 배차합니다.</p></article><article><b>03</b><h3>주간 정산</h3><p>완료·검수·CS 상태를 기준으로 지급액과 보류액을 투명하게 관리합니다.</p></article></div></div></section>
    <section className="cp-process"><div><p className="cp-label">ONBOARDING</p><h2>지원부터 첫 배차까지</h2><ol><li><b>01</b><span>온라인 지원</span></li><li><b>02</b><span>전화 인터뷰</span></li><li><b>03</b><span>서류 확인</span></li><li><b>04</b><span>유상 시험 2건</span></li><li><b>05</b><span>조건부 승인·배차</span></li></ol></div></section>
    <section className="cp-apply" id="apply"><div className="cp-copy"><p className="cp-label">APPLICATION</p><h2>Cleaning Partner<br/>지원서</h2><p>접수 후 영업시간 내 순서대로 연락드립니다.<br/>평일 09:00–22:00 · 주말 09:00–18:00</p></div>{state === "done" ? <div className="cp-complete"><b>접수 완료</b><h3>지원해 주셔서 감사합니다.</h3><p>담당자가 확인 후 연락드리겠습니다.</p><button onClick={() => setState("idle")}>추가 지원서 작성</button></div> : <form onSubmit={submit}><div className="cp-two"><label>상호명<input name="businessName" required/></label><label>대표자명<input name="representative" required/></label></div><div className="cp-two"><label>연락처<input name="phone" inputMode="tel" placeholder="010-1234-5678" required/></label><label>사업자번호<input name="businessNumber" placeholder="123-45-67890"/></label></div><label>주 활동지역<input name="region" placeholder="예: 원주·횡성·춘천" required/></label><fieldset><legend>가능 서비스</legend><label><input type="checkbox" name="services" value="move_in"/> 입주·이사청소</label><label><input type="checkbox" name="services" value="common_area"/> 계단·공용부청소</label></fieldset><div className="cp-three"><label>청소 경력<input name="experienceYears" type="number" min="0" defaultValue="0"/>년</label><label>투입 인원<input name="headcount" type="number" min="1" defaultValue="1"/>명</label><label>일 최대<input name="dailyCapacity" type="number" min="1" defaultValue="1"/>건</label></div><label>보유 차량<input name="vehicle" placeholder="예: 스타렉스, 1톤 탑차, 없음"/></label><div className="cp-checks"><label><input type="checkbox" name="invoiceAvailable"/> 세금계산서 발행 가능</label><label><input type="checkbox" name="insured"/> 배상책임보험 가입</label></div><label>지원 메모<textarea name="memo" rows={4} placeholder="주요 경력·장비·가능 일정 등을 적어주세요."/></label><label className="cp-consent"><input type="checkbox" name="consent" required/> Partner 심사와 연락을 위한 개인정보 수집·이용에 동의합니다.</label>{error && <p className="cp-error">{error}</p>}<button className="cp-submit" disabled={state === "sending"}>{state === "sending" ? "접수 중…" : "Partner 지원서 제출"}</button></form>}</section>
    <footer>BRING CARE · 현장과 데이터를 연결하는 Physical Infrastructure Operations Company</footer>
  </main>;
}
