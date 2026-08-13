import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AppShell from "../../app/field/components/AppShell";
import DesktopFieldBootstrap from "../../app/field/components/DesktopFieldBootstrap";
import type { DesktopHandoffState } from "../../app/field/lib/desktop-handoff.client";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("DesktopFieldBootstrap", () => {
  it("uses the persistent embedded Firebase session without a paid handoff", async () => {
    const exchange = vi.fn();
    const authenticate = vi.fn(async () => "restored" as const);
    render(
      <DesktopFieldBootstrap directSession exchange={exchange} authenticate={authenticate}>
        <div>FIELD persistent session</div>
      </DesktopFieldBootstrap>,
    );

    expect(await screen.findByText("FIELD persistent session")).toBeInTheDocument();
    expect(exchange).not.toHaveBeenCalled();
    expect(authenticate).toHaveBeenCalledOnce();
  });

  it("shows a connection state until the CRM handoff is consumed", async () => {
    const result = deferred<DesktopHandoffState>();
    render(
      <DesktopFieldBootstrap exchange={() => result.promise}>
        <div>FIELD 업무 화면</div>
      </DesktopFieldBootstrap>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("CRM 계정 연결 중");
    expect(screen.queryByText("FIELD 업무 화면")).not.toBeInTheDocument();

    result.resolve({ mode: "crm", consumed: true });
    expect(await screen.findByText("FIELD 업무 화면")).toBeInTheDocument();
  });

  it.each([
    ["expired", "연결 시간이 만료되었습니다"],
    ["denied", "승인된 CRM 직원 계정이 아닙니다"],
    ["unavailable", "FIELD 연결 서버를 사용할 수 없습니다"],
  ] as const)("shows a safe %s failure and requests a fresh handoff", async (error, message) => {
    const reconnect = vi.fn();
    window.addEventListener("bring-field-reconnect-request", reconnect);
    render(
      <DesktopFieldBootstrap
        exchange={async () => ({ mode: "crm", consumed: false, error })}
      >
        <div>FIELD 업무 화면</div>
      </DesktopFieldBootstrap>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    fireEvent.click(screen.getByRole("button", { name: "다시 연결" }));
    expect(reconnect).toHaveBeenCalledOnce();
    window.removeEventListener("bring-field-reconnect-request", reconnect);
  });

  it("hides duplicate logout and Drive controls in embedded AppShell mode", () => {
    render(
      <AppShell
        active="home"
        session={{ uid: "user-1", displayName: "서창환", role: "admin" }}
        embeddedMode
        driveControl={<button type="button">Drive 연결</button>}
        onLogout={vi.fn()}
      >
        <div>업무</div>
      </AppShell>,
    );

    expect(screen.queryByText("Drive 연결")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "로그아웃" })).not.toBeInTheDocument();
    expect(screen.getByText("업무")).toBeInTheDocument();
  });
});
