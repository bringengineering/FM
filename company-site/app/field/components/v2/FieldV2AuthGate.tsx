"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  loginFieldV2User,
  observeFieldV2Session,
  type FieldV2AuthState,
  type FieldV2Session,
  type FieldV2SessionObserver,
} from "../../lib/v2-auth.client";
import BrandLogo from "../BrandLogo";

type State =
  | { status: "checking" }
  | { status: "signedOut"; message?: string }
  | { status: "signingIn" }
  | { status: "authenticated"; session: FieldV2Session };

export default function FieldV2AuthGate({
  children,
  embedded,
  login = loginFieldV2User,
  observeSession = observeFieldV2Session,
  onSessionChange,
  onAuthStateChange,
}: {
  children(session: FieldV2Session): ReactNode;
  embedded: boolean;
  login?: () => Promise<FieldV2Session>;
  observeSession?: FieldV2SessionObserver;
  onSessionChange?: (session: FieldV2Session | null) => void;
  onAuthStateChange?: (state: FieldV2AuthState) => void;
}) {
  const [state, setState] = useState<State>({ status: "checking" });
  const authEpoch = useRef(0);

  useEffect(() => {
    onAuthStateChange?.("checking");
    return observeSession(
      (session, observedState) => {
        authEpoch.current += 1;
        const nextAuthState = observedState ?? (session ? "authenticated" : "missing");
        onSessionChange?.(session);
        onAuthStateChange?.(nextAuthState);
        setState(session ? { status: "authenticated", session }
          : nextAuthState === "checking" ? { status: "checking" }
            : { status: "signedOut" });
      },
      (error) => {
        setState({
          status: "signedOut",
          message: error.message === "field_access_unavailable"
            ? "계정 권한을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요."
            : "승인된 CRM 계정으로 로그인해 주세요.",
        });
      },
    );
  }, [observeSession, onAuthStateChange, onSessionChange]);

  if (state.status === "authenticated") return children(state.session);

  if (embedded) {
    return (
      <main className="field-v2-auth-screen">
        <section className="field-v2-auth-card" role="status" aria-live="polite">
          <p>BRING CRM · FIELD</p>
          <h1>CRM 계정 확인</h1>
          <span>{state.status === "checking" ? "CRM 계정을 확인하고 있습니다." : "CRM에서 다시 연결해 주세요."}</span>
        </section>
      </main>
    );
  }

  const working = state.status === "checking" || state.status === "signingIn";
  return (
    <main className="field-v2-auth-screen">
      <section className="field-v2-auth-card" aria-labelledby="field-v2-auth-title">
        <BrandLogo />
        <p>BRING FIELD</p>
        <h1 id="field-v2-auth-title">현장 업무</h1>
        <span>승인된 CRM 계정으로 현장 업무를 확인합니다.</span>
        <button
          className="field-v2-action"
          type="button"
          disabled={working}
          onClick={() => {
            const attempt = ++authEpoch.current;
            setState({ status: "signingIn" });
            void login()
              .catch(() => {
                if (authEpoch.current === attempt) {
                  setState({ status: "signedOut", message: "로그인에 실패했습니다. 다시 시도해 주세요." });
                }
              });
          }}
        >
          {working ? "계정 확인 중…" : "Google로 로그인"}
        </button>
        {state.status === "signedOut" && state.message ? <small role="alert">{state.message}</small> : null}
      </section>
    </main>
  );
}
