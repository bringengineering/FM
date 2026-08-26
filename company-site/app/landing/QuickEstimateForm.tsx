"use client";

import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PHONE_DIGITS, PHONE_LABEL } from "./contact";
import { submitMarketingLead } from "./marketingLeadClient";

type QuickEstimateFormProps = { service: string; sourcePath: string };
type SubmitStatus = "idle" | "sending" | "error" | "copied";

export default function QuickEstimateForm({ service, sourcePath }: QuickEstimateFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("접수가 완료되지 않았습니다. 전화로 빠르게 상담받으실 수 있습니다.");

  function formValues(form: HTMLFormElement) {
    const data = new FormData(form);
    const url = new URL(window.location.href);
    return {
      name: String(data.get("name") || "").trim(), phone: String(data.get("phone") || "").trim(),
      location: String(data.get("location") || "").trim(), needs: String(data.get("needs") || "").trim(),
      buildingInfo: String(data.get("buildingInfo") || "").trim(), customerType: String(data.get("customerType") || "individual"),
      service, sourcePath, utmSource: url.searchParams.get("utm_source") || "",
      utmCampaign: url.searchParams.get("utm_campaign") || "", utmTerm: url.searchParams.get("utm_term") || "",
      consent: data.get("consent") === "on",
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (status === "sending" || !form.reportValidity()) return;
    setStatus("sending");
    try {
      const result = await submitMarketingLead(formValues(form));
      router.push(`/consult/complete?receipt=${encodeURIComponent(result.receiptId)}`);
    } catch (error) {
      setErrorMessage(error instanceof Error && error.message ? error.message : "견적 신청 접수에 실패했습니다.");
      setStatus("error");
    }
  }

  function buildCopyMessage() {
    if (!formRef.current) return "";
    const values = formValues(formRef.current);
    const typeLabel = values.customerType === "building_owner" ? "건물주" : values.customerType === "manager" ? "관리 담당자" : "개인 고객";
    return [`[BRING CARE ${service} 견적 신청]`, `이름: ${values.name}`, `연락처: ${values.phone}`, `문의 유형: ${typeLabel}`, `건물 위치 또는 지역: ${values.location}`, `필요한 상담 내용: ${values.needs}`, `건물 정보: ${values.buildingInfo || "입력 안 함"}`, `유입 경로: ${sourcePath}`].join("\n");
  }

  async function copyApplication() {
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;
    const message = buildCopyMessage();
    try { await navigator.clipboard.writeText(message); }
    catch {
      const textArea = document.createElement("textarea"); textArea.value = message; document.body.appendChild(textArea);
      textArea.select(); document.execCommand("copy"); textArea.remove();
    }
    setStatus("copied");
  }

  return <form className="quick-estimate-form" id="quick-estimate-form" ref={formRef} onSubmit={handleSubmit}>
    <h2>{service} 견적 신청</h2><p>연락처와 필요한 청소 내용을 남기면 BRING CARE가 바로 확인합니다.</p>
    <div className="estimate-fields">
      <label>이름<input name="name" autoComplete="name" maxLength={80} required /></label>
      <label>연락처<input name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="010-1234-5678" pattern="010-[0-9]{4}-[0-9]{4}" required /></label>
      <label>문의 유형<select name="customerType" defaultValue="individual" required><option value="individual">개인 입주·이사청소</option><option value="building_owner">임대건물 건물주</option><option value="manager">건물 관리 담당자</option></select></label>
      <label>건물 위치 또는 지역<input name="location" autoComplete="street-address" maxLength={200} required /></label>
      <label>필요한 상담 내용<textarea name="needs" rows={4} maxLength={1000} placeholder="청소 범위, 희망 일정, 현재 불편한 점을 적어주세요." required /></label>
      <label>건물 정보<textarea name="buildingInfo" rows={3} maxLength={600} placeholder="층수, 세대수 등 알고 계신 내용을 적어주세요." /></label>
    </div>
    <label className="estimate-consent"><input name="consent" type="checkbox" required />상담을 위해 입력 정보를 BRING CARE CRM에 저장하고 연락받는 데 동의합니다.</label>
    <button type="submit" disabled={status === "sending"}>{status === "sending" ? "전송 중..." : "간편 견적 신청"}</button>
    {(status === "error" || status === "copied") && <div className="estimate-fallback"><p role="status" aria-live="polite">{status === "copied" ? "신청 내용이 복사되었습니다. 문자나 메신저에 붙여넣어 보내주세요." : errorMessage}</p><div><a href={`tel:${PHONE_DIGITS}`}>전화 상담 {PHONE_LABEL}</a><button type="button" onClick={copyApplication}>신청 내용 복사</button></div></div>}
  </form>;
}
