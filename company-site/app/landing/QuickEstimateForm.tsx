"use client";

import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const FORM_ENDPOINT =
  "https://formsubmit.co/ajax/bringengineering1008@gmail.com";
const BRIDGE_ORIGIN = "https://bring-fm.web.app";
const BRIDGE_URL = `${BRIDGE_ORIGIN}/consult-mail-bridge.html`;
const PHONE_NUMBER = "01065663606";

type QuickEstimateFormProps = {
  service: string;
  sourcePath: string;
};

type SubmitStatus = "idle" | "sending" | "error" | "copied";

type DeliveryResult = {
  success?: boolean | string;
  message?: string;
};

function isSuccessful(result: DeliveryResult) {
  return result.success === true || result.success === "true";
}

export default function QuickEstimateForm({
  service,
  sourcePath,
}: QuickEstimateFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const bridgeRef = useRef<HTMLIFrameElement>(null);
  const [bridgeReady, setBridgeReady] = useState(false);
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [errorMessage, setErrorMessage] = useState(
    "전송이 완료되지 않았습니다. 전화로 빠르게 상담받으실 수 있습니다.",
  );

  function buildDelivery(form: HTMLFormElement) {
    const formData = new FormData(form);
    const pageUrl = new URL(window.location.href);
    const delivery = new FormData();

    delivery.append("_subject", `[BRING CARE 간편 견적] ${service}`);
    delivery.append("_template", "table");
    delivery.append("_captcha", "false");
    delivery.append("_honey", String(formData.get("website") || ""));
    delivery.append("이름", String(formData.get("name") || ""));
    delivery.append("연락처", String(formData.get("phone") || ""));
    delivery.append("건물 위치 또는 지역", String(formData.get("location") || ""));
    delivery.append("건물 정보", String(formData.get("buildingInfo") || "입력 안 함"));
    delivery.append("서비스", service);
    delivery.append("유입 경로", sourcePath);
    delivery.append("현재 URL", pageUrl.href);
    delivery.append("utm_source", pageUrl.searchParams.get("utm_source") || "");
    delivery.append("utm_campaign", pageUrl.searchParams.get("utm_campaign") || "");
    delivery.append("utm_term", pageUrl.searchParams.get("utm_term") || "");
    delivery.append("접수 시각", new Date().toLocaleString("ko-KR"));

    return delivery;
  }

  async function submitDirect(delivery: FormData) {
    const response = await fetch(FORM_ENDPOINT, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: delivery,
    });
    const result = (await response.json()) as DeliveryResult;

    return {
      ...result,
      success: response.ok && isSuccessful(result),
    };
  }

  async function submitThroughBridge(delivery: FormData) {
    const iframe = bridgeRef.current;
    if (!bridgeReady || !iframe?.contentWindow) {
      throw new Error(
        "메일 전송 연결을 준비 중입니다. 잠시 후 다시 시도하거나 전화로 문의해 주세요.",
      );
    }

    const fields: Record<string, string> = {};
    delivery.forEach((value, key) => {
      if (typeof value === "string") fields[key] = value;
    });

    const requestId =
      globalThis.crypto?.randomUUID?.() ||
      `estimate-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    return new Promise<DeliveryResult>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        window.removeEventListener("message", receiveResult);
        reject(new Error("메일 전송 응답이 지연되고 있습니다."));
      }, 20_000);

      function receiveResult(event: MessageEvent) {
        if (
          event.origin !== BRIDGE_ORIGIN ||
          event.source !== iframe.contentWindow ||
          event.data?.type !== "bring-consult-result" ||
          event.data?.requestId !== requestId
        ) {
          return;
        }

        window.clearTimeout(timeout);
        window.removeEventListener("message", receiveResult);
        resolve(event.data as DeliveryResult);
      }

      window.addEventListener("message", receiveResult);
      iframe.contentWindow.postMessage(
        { type: "bring-consult-submit", requestId, fields },
        BRIDGE_ORIGIN,
      );
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    if (status === "sending" || !form.reportValidity()) return;

    setStatus("sending");
    setErrorMessage(
      "전송이 완료되지 않았습니다. 전화로 빠르게 상담받으실 수 있습니다.",
    );

    try {
      const delivery = buildDelivery(form);
      const result =
        window.location.origin === BRIDGE_ORIGIN
          ? await submitDirect(delivery)
          : await submitThroughBridge(delivery);

      if (!isSuccessful(result)) {
        throw new Error(result.message || "견적 신청 전송에 실패했습니다.");
      }

      router.push("/consult/complete");
    } catch (error) {
      setErrorMessage(
        error instanceof Error && error.message
          ? error.message
          : "견적 신청 전송에 실패했습니다.",
      );
      setStatus("error");
    }
  }

  function buildCopyMessage() {
    const form = formRef.current;
    if (!form) return "";
    const formData = new FormData(form);

    return [
      `[BRING CARE ${service} 견적 신청]`,
      `이름: ${formData.get("name")}`,
      `연락처: ${formData.get("phone")}`,
      `건물 위치 또는 지역: ${formData.get("location")}`,
      `건물 정보: ${formData.get("buildingInfo") || "입력 안 함"}`,
      `유입 경로: ${sourcePath}`,
    ].join("\n");
  }

  async function copyApplication() {
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;

    const message = buildCopyMessage();
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
    <form
      className="quick-estimate-form"
      id="quick-estimate"
      ref={formRef}
      onSubmit={handleSubmit}
    >
      <iframe
        className="form-mail-bridge"
        ref={bridgeRef}
        src={BRIDGE_URL}
        title="견적 메일 전송 연결"
        tabIndex={-1}
        aria-hidden="true"
        onLoad={() => setBridgeReady(true)}
      />

      <label className="form-honeypot" aria-hidden="true">
        웹사이트
        <input name="website" type="text" tabIndex={-1} autoComplete="off" />
      </label>

      <h2>{service} 견적 신청</h2>
      <p>필수 정보만 남겨주시면 확인 후 연락드리겠습니다.</p>

      <div className="estimate-fields">
        <label>
          이름
          <input name="name" autoComplete="name" required />
        </label>
        <label>
          연락처
          <input
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            pattern="[0-9+\-\s]{8,20}"
            required
          />
        </label>
        <label>
          건물 위치 또는 지역
          <input name="location" autoComplete="street-address" required />
        </label>
        <label>
          건물 정보
          <textarea
            name="buildingInfo"
            rows={3}
            placeholder="층수, 세대수, 청소 범위 등을 적어주세요."
          />
        </label>
      </div>

      <label className="estimate-consent">
        <input name="consent" type="checkbox" required />
        상담을 위해 입력 정보를 이메일로 전달하는 데 동의합니다.
      </label>

      <button type="submit" disabled={status === "sending"}>
        {status === "sending" ? "전송 중..." : "간편 견적 신청"}
      </button>

      {(status === "error" || status === "copied") && (
        <div className="estimate-fallback">
          <p role="status" aria-live="polite">
            {status === "copied"
              ? "신청 내용이 복사되었습니다. 문자나 메신저에 붙여넣어 보내주세요."
              : errorMessage}
          </p>
          <div>
            <a href={`tel:${PHONE_NUMBER}`}>전화 상담 010-6566-3606</a>
            <button type="button" onClick={copyApplication}>
              신청 내용 복사
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
