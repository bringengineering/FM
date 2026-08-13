"use client";

import { useEffect, useState, type ReactNode } from "react";

import { observeDesktopLogout } from "../lib/auth.client";
import {
  consumeDesktopHandoffFromUrl,
  type DesktopHandoffState,
} from "../lib/desktop-handoff.client";
import BrandLogo from "./BrandLogo";

type DesktopFieldBootstrapProps = {
  children: ReactNode;
  exchange?: () => Promise<DesktopHandoffState>;
  directSession?: boolean;
};

type BootstrapState =
  | { status: "connecting" }
  | { status: "ready" }
  | { status: "error"; error: "expired" | "denied" | "unavailable" };

const messages = {
  expired: "연결 시간이 만료되었습니다.",
  denied: "승인된 CRM 직원 계정이 아닙니다.",
  unavailable: "FIELD 연결 서버를 사용할 수 없습니다.",
} as const;

export default function DesktopFieldBootstrap({
  children,
  exchange = () => consumeDesktopHandoffFromUrl(new URL(window.location.href)),
  directSession = false,
}: DesktopFieldBootstrapProps) {
  const [state, setState] = useState<BootstrapState>(
    directSession ? { status: "ready" } : { status: "connecting" },
  );

  useEffect(() => observeDesktopLogout(), []);

  useEffect(() => {
    if (directSession) return;
    let active = true;
    void exchange()
      .then((result) => {
        if (!active) return;
        if (result.mode === "crm" && result.consumed) {
          setState({ status: "ready" });
          return;
        }
        setState({
          status: "error",
          error: result.mode === "crm" && result.error ? result.error : "denied",
        });
      })
      .catch(() => {
        if (active) setState({ status: "error", error: "unavailable" });
      });
    return () => {
      active = false;
    };
  }, [directSession, exchange]);

  if (state.status === "ready") {
    return <div className="field-embedded">{children}</div>;
  }

  return (
    <main className="field-auth-screen field-embedded-bootstrap">
      <section
        className="field-auth-card"
        role={state.status === "connecting" ? "status" : "alert"}
        aria-live="polite"
      >
        <div className="field-auth-brand"><BrandLogo /></div>
        <p className="field-eyebrow">BRING CRM · FIELD</p>
        <h1>{state.status === "connecting" ? "CRM 계정 연결 중" : "FIELD 연결 확인 필요"}</h1>
        <p>
          {state.status === "connecting"
            ? "로그인된 내부 직원 계정을 안전하게 확인하고 있습니다."
            : messages[state.error]}
        </p>
        {state.status === "error" ? (
          <button
            className="field-google-login"
            type="button"
            onClick={() => window.dispatchEvent(new Event("bring-field-reconnect-request"))}
          >
            다시 연결
          </button>
        ) : null}
      </section>
    </main>
  );
}
