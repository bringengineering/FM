import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AuthGate from "../../app/field/components/AuthGate";

const signedOutObserver = (listener: (session: null) => void) => {
  listener(null);
  return () => undefined;
};

describe("AuthGate redirect initiation", () => {
  it("never offers Google login while CRM owns the embedded session", async () => {
    render(
      <AuthGate interactiveLogin={false} observeSession={signedOutObserver}>
        <div>내부 플랫폼</div>
      </AuthGate>,
    );

    expect(await screen.findByRole("status")).toHaveTextContent("CRM에서 다시 연결");
    expect(screen.queryByRole("button", { name: "Google濡?濡쒓렇??" })).not.toBeInTheDocument();
  });

  it("re-enables sign-in with an actionable message when the current domain is unauthorized", async () => {
    const login = vi.fn(async () => {
      throw new Error("field_login_domain_not_authorized");
    });

    render(
      <AuthGate login={login} observeSession={signedOutObserver}>
        <div>내부 대시보드</div>
      </AuthGate>,
    );

    const button = await screen.findByRole("button", { name: "Google로 로그인" });
    fireEvent.click(button);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "현재 접속 주소가 Google 로그인 허용 도메인에 등록되지 않았습니다. 관리자에게 문의해 주세요.",
    );
    expect(screen.getByRole("button", { name: "Google로 로그인" })).toBeEnabled();
    expect(login).toHaveBeenCalledOnce();
  });

  it("opens the platform when Firebase restores an authorized persisted session", async () => {
    render(
      <AuthGate
        observeSession={(listener) => {
          listener({
            uid: "user-1",
            displayName: "브링 담당자",
            role: "staff",
          });
          return () => undefined;
        }}
      >
        <div>내부 대시보드</div>
      </AuthGate>,
    );

    expect(await screen.findByText("내부 대시보드")).toBeInTheDocument();
  });

  it("distinguishes a provisioning outage from an unauthorized account", async () => {
    render(
      <AuthGate
        observeSession={(_listener, errorListener) => {
          errorListener?.(new Error("field_provision_failed"));
          return () => undefined;
        }}
      >
        <div>내부 대시보드</div>
      </AuthGate>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "직원 권한 확인 서버를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    );
    expect(screen.getByRole("button", { name: "Google로 로그인" })).toBeEnabled();
  });
});
