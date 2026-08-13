"use client";

import { useEffect, useState, type ReactNode } from "react";

import {
  loginFieldUser,
  observeFieldSession,
  type FieldSession,
  type FieldSessionObserver,
} from "../lib/auth.client";
import { FieldSessionProvider } from "./FieldSessionContext";
import BrandLogo from "./BrandLogo";

type AuthGateProps = {
  children: ReactNode;
  login?: () => Promise<FieldSession>;
  observeSession?: FieldSessionObserver;
  interactiveLogin?: boolean;
};

type GateState =
  | { status: "checking" }
  | { status: "signedOut"; message?: string }
  | { status: "signingIn" }
  | { status: "authenticated"; session: FieldSession };

function authErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message === "field_company_account_required") {
    return "회사 계정 bringengineering1008@gmail.com으로 로그인해 주세요.";
  }
  if (message === "field_access_denied") {
    return "승인되지 않은 계정입니다. 관리자에게 내부 직원 등록을 요청해 주세요.";
  }
  if (message === "field_login_domain_not_authorized") {
    return "현재 접속 주소가 Google 로그인 허용 도메인에 등록되지 않았습니다. 관리자에게 문의해 주세요.";
  }
  if (message === "field_login_browser_unsupported") {
    return "현재 브라우저에서는 Google 로그인을 시작할 수 없습니다. Chrome 또는 Safari에서 다시 열어 주세요.";
  }
  if (message === "field_provision_failed") {
    return "직원 권한 확인 서버를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.";
  }
  return "로그인에 실패했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.";
}

function SignInScreen({
  state,
  onLogin,
  interactiveLogin,
}: {
  state: Exclude<GateState, { status: "authenticated" }>;
  onLogin: () => void;
  interactiveLogin: boolean;
}) {
  const checking = state.status === "checking";
  const signingIn = state.status === "signingIn";

  if (!interactiveLogin) {
    return (
      <main className="field-auth-screen">
        <section className="field-auth-card" role="status" aria-live="polite">
          <div className="field-auth-brand"><BrandLogo /></div>
          <p className="field-eyebrow">BRING CRM · FIELD</p>
          <h1>CRM 계정 확인</h1>
          <p>{checking ? "CRM 계정을 확인하고 있습니다." : "CRM에서 다시 연결해 주세요."}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="field-auth-screen">
      <section className="field-auth-card" aria-labelledby="field-auth-title">
        <div className="field-auth-brand">
          <BrandLogo />
        </div>
        <p className="field-eyebrow">INTERNAL PLATFORM</p>
        <h1 id="field-auth-title">현장 매물 관리</h1>
        <p>
          건물·공실 정보와 현장 사진을 안전하게 관리하는 브링 내부 직원용 플랫폼입니다.
        </p>
        <div className="field-auth-notice">
          <span aria-hidden="true">✓</span>
          대표님과 승인된 내부 직원 계정만 사용할 수 있습니다.
        </div>
        <button
          className="field-google-login"
          type="button"
          disabled={checking || signingIn}
          onClick={onLogin}
        >
          <span aria-hidden="true">G</span>
          {checking ? "계정 확인 중…" : signingIn ? "로그인 중…" : "Google로 로그인"}
        </button>
        {state.status === "signedOut" && state.message ? (
          <p className="field-auth-error" role="alert">
            {state.message}
          </p>
        ) : null}
        <small className="field-auth-help">
          권한이 없는 경우 관리자에게 회사 계정 승인을 요청해 주세요.
        </small>
      </section>
    </main>
  );
}

export default function AuthGate({
  children,
  login = loginFieldUser,
  observeSession = observeFieldSession,
  interactiveLogin = true,
}: AuthGateProps) {
  const [state, setState] = useState<GateState>({ status: "checking" });

  useEffect(
    () =>
      observeSession(
        (session) => {
          setState(session ? { status: "authenticated", session } : { status: "signedOut" });
        },
        (error) => {
          setState({ status: "signedOut", message: authErrorMessage(error) });
        },
      ),
    [observeSession],
  );

  async function handleLogin() {
    setState({ status: "signingIn" });
    try {
      const session = await login();
      setState({ status: "authenticated", session });
    } catch (error) {
      setState({
        status: "signedOut",
        message: authErrorMessage(error),
      });
    }
  }

  if (state.status === "authenticated") {
    return (
      <FieldSessionProvider key={state.session.uid} session={state.session}>
        {children}
      </FieldSessionProvider>
    );
  }

  return (
    <SignInScreen
      state={state}
      interactiveLogin={interactiveLogin}
      onLogin={() => void handleLogin()}
    />
  );
}
