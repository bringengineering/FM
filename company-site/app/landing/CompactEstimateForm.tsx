"use client";

import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PHONE_DIGITS, PHONE_LABEL } from "./contact";
import { campaignContext, marketingLeadCopy } from "./marketingLeadForm";
import { submitMarketingLead, type MarketingLeadInput } from "./marketingLeadClient";
import { formatKoreanMobile } from "./quickEstimateConfig";

type CompactEstimateFormProps = {
  service: string;
  sourcePath: string;
  defaultCustomerType: "building_owner" | "individual";
  needsPlaceholder: string;
  titleId: string;
};

type SubmitStatus = "idle" | "sending" | "error" | "copied";

export default function CompactEstimateForm({
  service,
  sourcePath,
  defaultCustomerType,
  needsPlaceholder,
  titleId,
}: CompactEstimateFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [phone, setPhone] = useState("");
  const [needs, setNeeds] = useState("");
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  function leadValues(): MarketingLeadInput {
    return {
      name: "",
      phone: formatKoreanMobile(phone),
      location: "",
      needs: needs.trim(),
      buildingInfo: "",
      customerType: defaultCustomerType,
      service,
      sourcePath,
      ...campaignContext(window.location.href),
      consent,
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "sending" || !event.currentTarget.reportValidity()) return;
    setStatus("sending");
    setErrorMessage("");
    try {
      const result = await submitMarketingLead(leadValues());
      router.push(`/consult/complete?receipt=${encodeURIComponent(result.receiptId)}`);
    } catch (error) {
      setErrorMessage(
        error instanceof Error && error.message
          ? error.message
          : "견적 신청 접수에 실패했습니다.",
      );
      setStatus("error");
    }
  }

  async function copyApplication() {
    const message = marketingLeadCopy(leadValues());
    try {
      await navigator.clipboard.writeText(message);
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = message;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      textArea.remove();
    }
    setStatus("copied");
  }

  return (
    <form className="compact-estimate-form" ref={formRef} onSubmit={handleSubmit}>
      <p className="compact-estimate-eyebrow">30초 빠른 견적</p>
      <h2 id={titleId}>{service} 빠른 견적</h2>
      <p className="compact-estimate-lead">
        연락처와 필요한 내용만 남기면 BRING CARE가 확인 후 연락드립니다.
      </p>

      <label>
        연락처
        <input
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="010-1234-5678"
          pattern="010-[0-9]{4}-[0-9]{4}"
          value={phone}
          onChange={(event) => setPhone(formatKoreanMobile(event.target.value))}
          required
        />
      </label>
      <label>
        필요한 상담 내용
        <textarea
          name="needs"
          rows={4}
          maxLength={1000}
          placeholder={needsPlaceholder}
          value={needs}
          onChange={(event) => setNeeds(event.target.value)}
          required
        />
      </label>
      <label className="compact-estimate-consent">
        <input
          name="consent"
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
          required
        />
        상담을 위해 개인정보를 BRING CARE CRM에 저장하고 연락받는 데 동의합니다.
      </label>

      {status !== "error" && status !== "copied" ? (
        <button type="submit" disabled={status === "sending"}>
          {status === "sending" ? "전송 중..." : "빠른 견적 신청"}
        </button>
      ) : null}

      {status === "error" || status === "copied" ? (
        <div className="compact-estimate-fallback">
          <p role="status" aria-live="polite">
            {status === "copied"
              ? "신청 내용이 복사되었습니다. 문자나 메신저에 붙여넣어 보내주세요."
              : errorMessage}
          </p>
          <div>
            <a href={`tel:${PHONE_DIGITS}`}>전화 상담 {PHONE_LABEL}</a>
            <button type="button" onClick={copyApplication}>
              신청 내용 복사
            </button>
            <button type="submit" onClick={() => setStatus("idle")}>
              다시 제출
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
