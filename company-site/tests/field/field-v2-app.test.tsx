import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import FieldV2AuthGate from "../../app/field/components/v2/FieldV2AuthGate";
import {
  classifyFieldV2EntryUrl,
  FieldEmbeddedBridgeHost,
  readFreshPendingUploadCount,
} from "../../app/field/components/v2/FieldV2App";
import type { FieldV2Session } from "../../app/field/lib/v2-auth.client";

const SESSION: FieldV2Session = {
  uid: "shared_uid",
  email: "team@bring.test",
  displayName: "브링 공용 계정",
  role: "member",
};

describe("FIELD v2 app gateway", () => {
  it("never downgrades a malformed embedded or handoff URL to standalone login", () => {
    expect(classifyFieldV2EntryUrl(new URL("https://bring-fm.web.app/field"))).toBe("standalone");
    expect(classifyFieldV2EntryUrl(new URL("https://bring-fm.web.app/field?embedded=crm"))).toBe("embedded");
    expect(classifyFieldV2EntryUrl(new URL(
      `https://bring-fm.web.app/field?desktop_handoff=${"A".repeat(43)}&embedded=crm`,
    ))).toBe("bootstrap");

    for (const rawUrl of [
      "https://bring-fm.web.app/field?embedded=crm&extra=1",
      "https://bring-fm.web.app/field?embedded=crm#jobs",
      `https://bring-fm.web.app/field?embedded=crm&desktop_handoff=${"A".repeat(42)}`,
      `https://bring-fm.web.app/field/jobs?desktop_handoff=${"A".repeat(43)}&embedded=crm`,
    ]) {
      expect(classifyFieldV2EntryUrl(new URL(rawUrl)), rawUrl).toBe("invalid-embedded");
    }
  });

  it("never offers login inside CRM and clears an A session on the next auth epoch", async () => {
    let emit!: (session: FieldV2Session | null) => void;
    const observe = vi.fn((listener: typeof emit) => { emit = listener; return vi.fn(); });
    render(
      <FieldV2AuthGate embedded observeSession={observe} login={vi.fn()}>
        {(session) => <div>{session.uid}</div>}
      </FieldV2AuthGate>,
    );
    emit(SESSION);
    expect(await screen.findByText("shared_uid")).toBeVisible();
    emit(null);
    await waitFor(() => expect(screen.queryByText("shared_uid")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Google/ })).not.toBeInTheDocument();
    expect(screen.getByText("CRM에서 다시 연결해 주세요.")).toBeVisible();
  });

  it("allows ordinary Google login only in standalone mode", async () => {
    const login = vi.fn(async () => SESSION);
    let emit!: (session: FieldV2Session | null) => void;
    render(
      <FieldV2AuthGate
        embedded={false}
        observeSession={(listener) => { emit = listener; listener(null, "missing"); return vi.fn(); }}
        login={login}
      >
        {(session) => <div>{session.displayName}</div>}
      </FieldV2AuthGate>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Google로 로그인" }));
    await waitFor(() => expect(login).toHaveBeenCalledOnce());
    expect(screen.queryByText(SESSION.displayName)).not.toBeInTheDocument();
    emit(SESSION);
    expect(await screen.findByText("브링 공용 계정")).toBeVisible();
  });

  it("does not let a late login promise override a newer signed-out auth epoch", async () => {
    let emit!: (session: FieldV2Session | null, state?: "checking" | "missing" | "authenticated" | "unavailable") => void;
    let resolveLogin!: (session: FieldV2Session) => void;
    render(
      <FieldV2AuthGate
        embedded={false}
        observeSession={(listener) => { emit = listener; listener(null, "missing"); return vi.fn(); }}
        login={() => new Promise((resolve) => { resolveLogin = resolve; })}
      >
        {(session) => <div>{session.uid}</div>}
      </FieldV2AuthGate>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Google/ }));
    emit(null, "missing");
    resolveLogin(SESSION);
    await Promise.resolve();
    expect(screen.queryByText("shared_uid")).not.toBeInTheDocument();
  });

  it("does not send false-missing ready while auth is still checking", async () => {
    const post = vi.spyOn(window, "postMessage");
    const { rerender } = render(
      <FieldEmbeddedBridgeHost authState="checking" session={null} runtime={null} />,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(post.mock.calls.map(([message]) => message).filter((message: any) => message.type === "field.ready"))
      .toHaveLength(0);

    rerender(<FieldEmbeddedBridgeHost authState="missing" session={null} runtime={null} />);
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "field.ready",
        payload: expect.objectContaining({ session: "missing" }),
      }),
      "https://bring-fm.web.app",
    ));

    post.mockClear();
    rerender(<FieldEmbeddedBridgeHost authState="authenticated" session={null} runtime={null} />);
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "field.ready",
        payload: expect.objectContaining({ session: "authenticated" }),
      }),
      "https://bring-fm.web.app",
    ));
    post.mockRestore();
  });

  it("suppresses a transient missing ready throughout an explicit desktop logout", async () => {
    const post = vi.spyOn(window, "postMessage");
    const { rerender } = render(
      <FieldEmbeddedBridgeHost authState="authenticated" session={SESSION} runtime={null} />,
    );
    await waitFor(() => expect(post.mock.calls.map(([message]) => message).some((message: any) => (
      message.type === "field.ready" && message.payload.session === "authenticated"
    ))).toBe(true));
    post.mockClear();

    window.dispatchEvent(new Event("bring-field-logout-started"));
    rerender(<FieldEmbeddedBridgeHost authState="missing" session={null} runtime={null} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(post.mock.calls.map(([message]) => message).filter((message: any) => message.type === "field.ready"))
      .toHaveLength(0);

    window.dispatchEvent(new CustomEvent("bring-field-logout-failed", {
      detail: { requestId: "623e4567-e89b-42d3-a456-426614174000" },
    }));
    await waitFor(() => expect(post.mock.calls.map(([message]) => message).some((message: any) => (
      message.type === "field.ready" && message.payload.session === "missing"
    ))).toBe(true));
    post.mockRestore();
  });

  it("approves zero pending uploads only for an authoritative no-session state", async () => {
    const post = vi.spyOn(window, "postMessage");
    const { rerender } = render(
      <FieldEmbeddedBridgeHost authState="checking" session={null} runtime={null} />,
    );
    const request = {
      protocolVersion: 2,
      type: "crm.logoutCheck",
      requestId: "123e4567-e89b-42d3-a456-426614174000",
      payload: { reason: "logout" },
    };
    window.dispatchEvent(new MessageEvent("message", {
      data: request,
      origin: "https://bring-fm.web.app",
      source: window,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(post.mock.calls.map(([message]) => message).some((message: any) => (
      message.type === "field.logoutDecision"
      && message.requestId === request.requestId
      && message.payload.ok === false
      && message.payload.error?.code === "FIELD_PENDING_UPLOADS_UNKNOWN"
    ))).toBe(true);

    rerender(<FieldEmbeddedBridgeHost authState="missing" session={null} runtime={null} />);
    window.dispatchEvent(new MessageEvent("message", {
      data: { ...request, requestId: "223e4567-e89b-42d3-a456-426614174000" },
      origin: "https://bring-fm.web.app",
      source: window,
    }));
    await waitFor(() => expect(post.mock.calls.map(([message]) => message).some((message: any) => (
      message.type === "field.logoutDecision"
      && message.requestId === "223e4567-e89b-42d3-a456-426614174000"
      && message.payload.count === 0
    ))).toBe(true));
    post.mockRestore();
  });

  it("holds an early desktop navigation until the authenticated runtime can restore it", async () => {
    const post = vi.spyOn(window, "postMessage");
    const { rerender } = render(
      <FieldEmbeddedBridgeHost authState="authenticated" session={SESSION} runtime={null} />,
    );
    const requestId = "523e4567-e89b-42d3-a456-426614174000";
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        protocolVersion: 2,
        type: "field.navigate",
        requestId,
        payload: {
          route: "/field?embedded=crm",
          operatorId: "operator_kim",
          selectedJobId: "",
          filter: {},
          scrollTop: 0,
          search: "",
        },
      },
      origin: "https://bring-fm.web.app",
      source: window,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(post.mock.calls.map(([message]) => message).some((message: any) => (
      message.type === "field.ack" && message.requestId === requestId
    ))).toBe(false);

    const navigate = vi.fn(async () => true);
    rerender(<FieldEmbeddedBridgeHost
      authState="authenticated"
      session={SESSION}
      runtime={{
        operatorId: "operator_kim",
        pendingUploads: { known: true, count: 0 },
        ready: true,
        command: vi.fn(),
        navigate,
      }}
    />);
    await waitFor(() => expect(post.mock.calls.map(([message]) => message).some((message: any) => (
      message.type === "field.ack"
      && message.requestId === requestId
      && message.payload.ok === true
    ))).toBe(true));
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ route: "/field?embedded=crm" }));
    post.mockRestore();
  });

  it("reads the authoritative queue for logout even while the display cache is unknown", async () => {
    const post = vi.spyOn(window, "postMessage");
    render(<FieldEmbeddedBridgeHost
      authState="authenticated"
      session={SESSION}
      readPendingUploadCount={async (uid) => {
        expect(uid).toBe(SESSION.uid);
        return 2;
      }}
      runtime={{
        operatorId: "operator_kim",
        pendingUploads: { known: false, count: 0 },
        ready: false,
        command: vi.fn(),
        navigate: vi.fn(async () => false),
      }}
    />);
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        protocolVersion: 2,
        type: "crm.logoutCheck",
        requestId: "323e4567-e89b-42d3-a456-426614174000",
        payload: { reason: "logout" },
      },
      origin: "https://bring-fm.web.app",
      source: window,
    }));
    await waitFor(() => expect(post.mock.calls.map(([message]) => message).some((message: any) => (
      message.type === "field.logoutDecision"
      && message.requestId === "323e4567-e89b-42d3-a456-426614174000"
      && message.payload.pending === true
      && message.payload.count === 2
    ))).toBe(true));
    post.mockRestore();
  });

  it("does not return one user's queue count after the authenticated session changes", async () => {
    const post = vi.spyOn(window, "postMessage");
    let resolveCount!: (count: number) => void;
    const readPendingUploadCount = vi.fn(() => new Promise<number>((resolve) => { resolveCount = resolve; }));
    const runtime = {
      operatorId: "operator_kim",
      pendingUploads: { known: false, count: 0 },
      ready: false,
      command: vi.fn(),
      navigate: vi.fn(async () => false),
    };
    const { rerender } = render(<FieldEmbeddedBridgeHost
      authState="authenticated"
      session={SESSION}
      runtime={runtime}
      readPendingUploadCount={readPendingUploadCount}
    />);
    const requestId = "423e4567-e89b-42d3-a456-426614174000";
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        protocolVersion: 2,
        type: "crm.logoutCheck",
        requestId,
        payload: { reason: "logout" },
      },
      origin: "https://bring-fm.web.app",
      source: window,
    }));
    await waitFor(() => expect(readPendingUploadCount).toHaveBeenCalledWith(SESSION.uid));
    rerender(<FieldEmbeddedBridgeHost
      authState="authenticated"
      session={{ ...SESSION, uid: "other_uid" }}
      runtime={runtime}
      readPendingUploadCount={readPendingUploadCount}
    />);
    resolveCount(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(post.mock.calls.map(([message]) => message).some((message: any) => (
      message.type === "field.logoutDecision" && message.requestId === requestId
    ))).toBe(false);
    post.mockRestore();
  });

  it("always closes the one-shot queue used by a fresh logout count", async () => {
    const close = vi.fn();
    const countPending = vi.fn(async () => 4);
    const openQueue = vi.fn(async () => ({ countPending, close }) as any);
    await expect(readFreshPendingUploadCount(SESSION.uid, openQueue as any)).resolves.toBe(4);
    expect(countPending).toHaveBeenCalledWith(SESSION.uid);
    expect(close).toHaveBeenCalledOnce();

    countPending.mockRejectedValueOnce(new Error("indexeddb unavailable"));
    await expect(readFreshPendingUploadCount(SESSION.uid, openQueue as any)).rejects.toThrow("indexeddb unavailable");
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("preserves FIELD_SESSION_UNAVAILABLE when authenticated runtime security is not ready", async () => {
    const post = vi.spyOn(window, "postMessage");
    render(<FieldEmbeddedBridgeHost
      authState="authenticated"
      session={SESSION}
      runtime={{
        operatorId: "operator_kim",
        pendingUploads: { known: true, count: 0 },
        ready: false,
        command: vi.fn(),
        navigate: vi.fn(async () => false),
      }}
    />);
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        protocolVersion: 2,
        type: "field.command",
        requestId: "423e4567-e89b-42d3-a456-426614174000",
        payload: {
          command: "claimJob",
          operatorId: "operator_kim",
          args: { jobId: "job_1" },
        },
      },
      origin: "https://bring-fm.web.app",
      source: window,
    }));
    await waitFor(() => expect(post.mock.calls.map(([message]) => message).some((message: any) => (
      message.type === "field.commandResult"
      && message.requestId === "423e4567-e89b-42d3-a456-426614174000"
      && message.payload.error?.code === "FIELD_SESSION_UNAVAILABLE"
    ))).toBe(true));
    post.mockRestore();
  });
});
