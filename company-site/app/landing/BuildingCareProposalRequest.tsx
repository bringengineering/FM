"use client";

import Image from "next/image";
import { FormEvent, useRef, useState } from "react";
import { PHONE_DIGITS, PHONE_LABEL } from "./contact";
import { campaignContext, marketingLeadCopy } from "./marketingLeadForm";
import { submitMarketingLead, type MarketingLeadInput } from "./marketingLeadClient";

type SubmitStatus = "idle" | "sending" | "success" | "error" | "copied";

const service = "건물관리 제안서 요청";
const sourcePath = "/building-care#building-care-proposal";
const proposalHref = "/downloads/bring-care-building-management-proposal.pdf";

export default function BuildingCareProposalRequest() {
  const formRef = useRef<HTMLFormElement>(null);
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [errorMessage, setErrorMessage] = useState(
    "신청이 완료되지 않았습니다. 전화로 빠르게 요청하실 수 있습니다.",
  );

  function formValues(form: HTMLFormElement): MarketingLeadInput {
    const data = new FormData(form);
    return {
      name: String(data.get("name") || "").trim(),
      phone: String(data.get("phone") || "").trim(),
      location: String(data.get("location") || "").trim(),
      needs: "BRING CARE 건물관리 제안서 요청",
      buildingInfo: "",
      customerType: "building_owner",
      service,
      sourcePath,
      ...campaignContext(window.location.href),
      consent: data.get("consent") === "on",
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (status === "sending" || !form.reportValidity()) return;

    setStatus("sending");
    try {
      await submitMarketingLead(formValues(form));
      setStatus("success");
    } catch (error) {
      setErrorMessage(
        error instanceof Error && error.message
          ? error.message
          : "제안서 신청 접수에 실패했습니다.",
      );
      setStatus("error");
    }
  }

  async function copyApplication() {
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;
    const message = marketingLeadCopy(formValues(form));

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
    <section className="bc-proposal" id="building-care-proposal">
      <div className="bc-proposal-inner">
        <div className="bc-proposal-preview" aria-label="BRING CARE 건물관리 제안서 미리보기">
          <div className="bc-proposal-cover">
            <Image
              src="/landing/proposal/bring-care-proposal-cover.png"
              alt="BRING CARE 건물관리 제안서 표지"
              width={2400}
              height={1350}
              sizes="(max-width: 760px) 100vw, 48vw"
            />
          </div>
          <div className="bc-proposal-meta">
            <span>BRING CARE SERVICE PROPOSAL</span>
            <strong>총 18페이지 · PDF</strong>
          </div>
        </div>

        <div className="bc-proposal-content">
          <p className="bc-kicker">SERVICE PROPOSAL</p>
          <h2>건물관리 제안서를 받아보세요</h2>
          <p className="bc-proposal-lead">
            시설관리부터 임차인 응대, 공실·입퇴실 관리와 관리기록까지
            BRING CARE의 운영 범위와 절차를 한 번에 확인할 수 있습니다.
          </p>

          {status === "success" ? (
            <div className="bc-proposal-success" role="status" aria-live="polite">
              <span>신청이 접수되었습니다.</span>
              <strong>제안서를 바로 확인해보세요.</strong>
              <a
                href={proposalHref}
                download="BRING_CARE_건물관리_제안서.pdf"
              >
                제안서 PDF 다운로드
              </a>
              <p>담당자가 입력하신 연락처로 건물 상황을 확인해드립니다.</p>
            </div>
          ) : (
            <form ref={formRef} className="bc-proposal-form" onSubmit={handleSubmit}>
              <div className="bc-proposal-fields">
                <label>
                  이름
                  <input name="name" autoComplete="name" maxLength={80} required />
                </label>
                <label>
                  연락처
                  <input
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="010-1234-5678"
                    pattern="010-[0-9]{4}-[0-9]{4}"
                    required
                  />
                </label>
                <label className="bc-proposal-address">
                  건물 주소
                  <input
                    name="location"
                    autoComplete="street-address"
                    maxLength={200}
                    placeholder="예: 원주시 단계동"
                    required
                  />
                </label>
              </div>
              <label className="bc-proposal-consent">
                <input name="consent" type="checkbox" required />
                제안서 제공과 상담을 위해 입력 정보를 BRING CARE CRM에 저장하고
                연락받는 데 동의합니다.
              </label>
              <button type="submit" disabled={status === "sending"}>
                {status === "sending" ? "신청 중..." : "제안서 신청하기"}
              </button>
              {(status === "error" || status === "copied") && (
                <div className="bc-proposal-fallback">
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
                  </div>
                </div>
              )}
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
