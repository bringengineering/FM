"use client";

import { useEffect, useState, type ReactNode } from "react";

import {
  loginFieldUser,
  observeFieldSession,
  type FieldSession,
  type FieldSessionObserver,
} from "../lib/auth.client";

type AuthGateProps = {
  children: ReactNode;
  login?: () => Promise<FieldSession>;
  observeSession?: FieldSessionObserver;
};

type GateState =
  | { status: "checking" }
  | { status: "signedOut"; message?: string }
  | { status: "signingIn" }
  | { status: "authenticated"; session: FieldSession };

function SignInScreen({
  state,
  onLogin,
}: {
  state: Exclude<GateState, { status: "authenticated" }>;
  onLogin: () => void;
}) {
  const checking = state.status === "checking";
  const signingIn = state.status === "signingIn";

  return (
    <main className="field-auth-screen">
      <section className="field-auth-card" aria-labelledby="field-auth-title">
        <div className="field-auth-brand" aria-label="BRING FIELD">
          <span className="field-brand-mark" aria-hidden="true">
            B
          </span>
          <span>
            <strong>BRING</strong>
            <small>FIELD</small>
          </span>
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
}: AuthGateProps) {
  const [state, setState] = useState<GateState>({ status: "checking" });

  useEffect(
    () =>
      observeSession((session) => {
        setState(session ? { status: "authenticated", session } : { status: "signedOut" });
      }),
    [observeSession],
  );

  async function handleLogin() {
    setState({ status: "signingIn" });
    try {
      const session = await login();
      setState({ status: "authenticated", session });
    } catch (error) {
      const denied = error instanceof Error && error.message === "field_access_denied";
      setState({
        status: "signedOut",
        message: denied
          ? "승인되지 않은 계정입니다. 관리자에게 내부 직원 등록을 요청해 주세요."
          : "로그인에 실패했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.",
      });
    }
  }

  if (state.status === "authenticated") {
    return children;
  }

  return <SignInScreen state={state} onLogin={() => void handleLogin()} />;
}
