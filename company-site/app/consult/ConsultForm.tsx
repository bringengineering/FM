"use client";

import { FormEvent, useState } from "react";

const CONSULT_EMAIL = "bringengineering1008@gmail.com";
const FORM_ENDPOINT = `https://formsubmit.co/ajax/${CONSULT_EMAIL}`;

type SubmitStatus = "idle" | "sending" | "error" | "copied";

export default function ConsultForm() {
  const [status, setStatus] = useState<SubmitStatus>("idle");

  function buildMessage(form: HTMLFormElement) {
    const data = new FormData(form);
    const serviceNames = data.getAll("service").join(", ") || "선택 안 함";

    return [
      "[Bring Care FM 상담 신청]",
      "",
      `성명: ${data.get("name")}`,
      `연락처: ${data.get("phone")}`,
      `이메일: ${data.get("email") || "입력 안 함"}`,
      `건물 유형: ${data.get("buildingType")}`,
      `건물 위치: ${data.get("location") || "입력 안 함"}`,
      `관심 서비스: ${serviceNames}`,
      "",
      "[문의 내용]",
      `${data.get("message")}`,
    ].join("\n");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    if (!form.reportValidity() || status === "sending") {
      return;
    }

    const data = new FormData(form);
    const services = data.getAll("service").join(", ") || "선택 안 함";
    const delivery = new FormData();

    delivery.append(
      "_subject",
      `[Bring Care 상담 신청] ${data.get("name")} / ${data.get("buildingType")}`,
    );
    delivery.append("_template", "table");
    delivery.append("_honey", String(data.get("website") || ""));
    delivery.append("성명", String(data.get("name") || ""));
    delivery.append("연락처", String(data.get("phone") || ""));
    delivery.append("이메일", String(data.get("email") || "입력 안 함"));
    delivery.append("건물 유형", String(data.get("buildingType") || ""));
    delivery.append("건물 위치", String(data.get("location") || "입력 안 함"));
    delivery.append("관심 서비스", services);
    delivery.append("문의 내용", String(data.get("message") || ""));
    delivery.append("접수 시각", new Date().toLocaleString("ko-KR"));
    if (data.get("email")) {
      delivery.append("email", String(data.get("email")));
    }

    setStatus("sending");

    try {
      const response = await fetch(FORM_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
        body: delivery,
      });
      const result = (await response.json()) as {
        success?: boolean | string;
        message?: string;
      };
      const succeeded =
        response.ok &&
        (result.success === true || result.success === "true");

      if (!succeeded) {
        throw new Error(result.message || "상담 신청 전송에 실패했습니다.");
      }

      window.location.assign("/consult/complete");
    } catch {
      setStatus("error");
    }
  }

  async function copyApplication() {
    const form = document.querySelector<HTMLFormElement>("#consult-form");
    if (!form || !form.reportValidity()) {
      return;
    }

    const message = buildMessage(form);
    try {
      await navigator.clipboard.writeText(message);
      setStatus("copied");
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = message;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      textArea.remove();
      setStatus("copied");
    }
  }

  return (
    <form className="consult-form" id="consult-form" onSubmit={handleSubmit}>
      <label className="form-honeypot" aria-hidden="true">
        웹사이트
        <input
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </label>

      <div className="form-section-head">
        <span>01</span>
        <div>
          <h2>기본 정보를 알려주세요.</h2>
          <p>
            <i aria-hidden="true">*</i> 표시는 필수 입력 항목입니다.
          </p>
        </div>
      </div>

      <div className="form-grid">
        <label>
          <span>
            성명 <i>*</i>
          </span>
          <input
            name="name"
            type="text"
            autoComplete="name"
            placeholder="성함을 입력해 주세요"
            required
          />
        </label>
        <label>
          <span>
            연락처 <i>*</i>
          </span>
          <input
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="010-0000-0000"
            pattern="[0-9+\-\s]{8,20}"
            required
          />
        </label>
        <label>
          <span>이메일</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            placeholder="name@example.com"
          />
        </label>
        <label>
          <span>
            건물 유형 <i>*</i>
          </span>
          <select name="buildingType" defaultValue="" required>
            <option value="" disabled>
              건물 유형을 선택해 주세요
            </option>
            <option value="상가·근린생활시설">상가·근린생활시설</option>
            <option value="업무·오피스">업무·오피스</option>
            <option value="주거·임대건물">주거·임대건물</option>
            <option value="공장·창고">공장·창고</option>
            <option value="교육·연구시설">교육·연구시설</option>
            <option value="기타">기타</option>
          </select>
        </label>
        <label className="full">
          <span>건물 위치</span>
          <input
            name="location"
            type="text"
            autoComplete="street-address"
            placeholder="시·군·구 또는 건물 주소를 입력해 주세요"
          />
        </label>
      </div>

      <div className="form-divider" />

      <div className="form-section-head">
        <span>02</span>
        <div>
          <h2>필요한 서비스를 선택해 주세요.</h2>
          <p>여러 항목을 함께 선택할 수 있습니다.</p>
        </div>
      </div>

      <fieldset className="service-checks">
        <legend className="sr-only">관심 서비스</legend>
        {[
          "시설 운영 관리",
          "임대·입금 관리",
          "민원 대응",
          "공사·견적 관리",
          "에너지·안전 점검",
          "디지털 FM",
        ].map((service) => (
          <label key={service}>
            <input type="checkbox" name="service" value={service} />
            <span>{service}</span>
            <i aria-hidden="true">✓</i>
          </label>
        ))}
      </fieldset>

      <label className="message-field">
        <span>
          문의 내용 <i>*</i>
        </span>
        <textarea
          name="message"
          rows={7}
          minLength={10}
          placeholder="현재 건물 운영 상황과 필요한 도움을 자세히 적어주세요."
          required
        />
      </label>

      <label className="consent-field">
        <input type="checkbox" name="consent" required />
        <span>
          상담과 회신을 위해 입력한 정보를 이메일로 전달하는 데 동의합니다.
          <small>
            입력 내용은 상담 메일 발송을 위해 전송 대행 서비스에 전달될 수
            있으며, 브링케어 홈페이지에는 별도로 저장되지 않습니다.
          </small>
        </span>
      </label>

      <div className="form-actions">
        <button
          className="submit-button"
          type="submit"
          disabled={status === "sending"}
        >
          {status === "sending" ? "상담 신청 전송 중..." : "상담 신청 전송"}
          <span aria-hidden="true">↗</span>
        </button>
        <button className="copy-button" type="button" onClick={copyApplication}>
          신청 내용 복사
        </button>
      </div>

      <p
        className={`form-status${status === "error" ? " form-status-error" : ""}`}
        role="status"
        aria-live="polite"
        hidden={status === "idle" || status === "sending"}
      >
        {status === "copied"
          ? "신청 내용이 복사되었습니다. 이메일이나 문자에 붙여넣어 보내주세요."
          : "전송이 완료되지 않았습니다. 잠시 후 다시 시도하거나 전화·이메일로 문의해 주세요."}
      </p>
    </form>
  );
}
