import { describe, expect, it, vi } from "vitest";

import {
  createDesktopFieldBridge,
  createFieldBridgeEnvelope,
  normalizeFieldRoute,
  validateDesktopFieldEnvelope,
} from "../../app/field/lib/v2/desktop-bridge.client";

const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";

describe("FIELD browser desktop bridge", () => {
  it("rejects the wrong origin, source, direction, secret keys, hashes, and oversized payloads", () => {
    const navigation = createFieldBridgeEnvelope("field.navigate", {
      route: "/field?embedded=crm",
    }, REQUEST_ID);
    expect(validateDesktopFieldEnvelope(navigation, "crmToField").ok).toBe(true);
    expect(validateDesktopFieldEnvelope({ ...navigation, protocolVersion: 1 }, "crmToField").ok).toBe(false);
    expect(validateDesktopFieldEnvelope(createFieldBridgeEnvelope("field.navigate", {
      route: "/field?token=secret",
    }, REQUEST_ID), "crmToField").ok).toBe(false);
    expect(validateDesktopFieldEnvelope(createFieldBridgeEnvelope("field.command", {
      command: "claimJob",
      operatorId: "operator_kim",
      args: { accessToken: "secret" },
    }, REQUEST_ID), "crmToField").ok).toBe(false);
    expect(validateDesktopFieldEnvelope(createFieldBridgeEnvelope("field.command", {
      command: "claimJob",
      operatorId: "operator_kim",
      args: { note: "x".repeat(33_000) },
    }, REQUEST_ID), "crmToField").ok).toBe(false);
  });

  it("accepts only the exact embedded FIELD route contract", () => {
    expect(normalizeFieldRoute("/field?embedded=crm&tab=jobs&scope=mine&filter=assigned&date=2026-08-14&jobId=job_1"))
      .toBe("/field?embedded=crm&tab=jobs&scope=mine&filter=assigned&date=2026-08-14&jobId=job_1");
    for (const route of [
      "/field",
      "/field?tab=jobs",
      "/field/anything?embedded=crm",
      "/field?embedded=other",
      "/field?embedded=crm&embedded=crm",
      "/field?embedded=crm&search=private",
      "/field?embedded=crm&token=secret",
      "/field?embedded=crm#jobs",
      "/field?embedded=crm&date=2026-02-31",
      "/field?embedded=crm&scope=everyone",
      "/field?embedded=crm&filter=password%3D1234",
    ]) expect(normalizeFieldRoute(route), route).toBeNull();
  });

  it("opens the create composer locally and rejects incomplete direct create commands", () => {
    expect(validateDesktopFieldEnvelope(createFieldBridgeEnvelope("field.command", {
      command: "openCreateJob",
      operatorId: "operator_kim",
      args: {},
    }, REQUEST_ID), "crmToField").ok).toBe(true);
    expect(validateDesktopFieldEnvelope(createFieldBridgeEnvelope("field.command", {
      command: "createJob",
      operatorId: "operator_kim",
      args: { route: "/field?embedded=crm" },
    }, REQUEST_ID), "crmToField").ok).toBe(false);
    expect(validateDesktopFieldEnvelope(createFieldBridgeEnvelope("field.command", {
      command: "switchOperator",
      operatorId: "operator_kim",
      args: { nextOperatorId: "operator_hwang" },
    }, REQUEST_ID), "crmToField").ok).toBe(false);
  });

  it("uses exact Task5 ack and command-result envelopes", () => {
    expect(validateDesktopFieldEnvelope(createFieldBridgeEnvelope(
      "field.ack", { ok: true }, REQUEST_ID,
    ), "fieldToCrm").ok).toBe(true);
    expect(validateDesktopFieldEnvelope(createFieldBridgeEnvelope(
      "field.ack", { ok: true, error: { code: "NO" } }, REQUEST_ID,
    ), "fieldToCrm").ok).toBe(false);
    expect(validateDesktopFieldEnvelope(createFieldBridgeEnvelope(
      "field.ack", { ok: false }, REQUEST_ID,
    ), "fieldToCrm").ok).toBe(false);
    expect(validateDesktopFieldEnvelope(createFieldBridgeEnvelope("field.commandResult", {
      ok: true,
      result: { visitId: "visit_1", jobIds: ["job_1"], repeated: false },
    }, REQUEST_ID), "fieldToCrm").ok).toBe(true);
    expect(validateDesktopFieldEnvelope(createFieldBridgeEnvelope("field.commandResult", {
      ok: true,
      result: { jobIds: ["job_1"] },
    }, REQUEST_ID), "fieldToCrm").ok).toBe(false);
  });

  it("validates exact least-privilege arguments for every bridge command", () => {
    const valid: Array<[string, Record<string, unknown>]> = [
      ["openCreateJob", {}],
      ["claimJob", { jobId: "job_1" }],
      ["assignJob", { jobId: "job_1", assignedOperatorId: "operator_hwang", reason: "관리자 재배정" }],
      ["changeVisit", { visitId: "visit_1", reason: "방문일 변경", dueDate: "2026-08-15", priority: "high" }],
      ["transitionStatus", { jobId: "job_1", toStatus: "accepted" }],
      ["reviewJob", { jobId: "job_1", decision: "approved" }],
    ];
    for (const [command, args] of valid) {
      expect(validateDesktopFieldEnvelope(createFieldBridgeEnvelope("field.command", {
        command, operatorId: "operator_kim", args,
      }, REQUEST_ID), "crmToField").ok, command).toBe(true);
    }
    for (const [command, args] of [
      ["openCreateJob", { route: "/field?embedded=crm" }],
      ["claimJob", { jobId: "job_1", assignedOperatorId: "operator_kim" }],
      ["assignJob", { jobId: "job_1", assignedOperatorId: "operator_hwang" }],
      ["changeVisit", { visitId: "visit_1", reason: "방문일 변경", dueDate: "2026-02-31" }],
      ["transitionStatus", { jobId: "job_1", toStatus: "unknown" }],
      ["reviewJob", { jobId: "job_1", decision: "delete" }],
    ] as Array<[string, Record<string, unknown>]>) {
      expect(validateDesktopFieldEnvelope(createFieldBridgeEnvelope("field.command", {
        command, operatorId: "operator_kim", args,
      }, REQUEST_ID), "crmToField").ok, command).toBe(false);
    }
  });

  it("sends explicit authenticated, missing, and expired readiness states", () => {
    const sent: unknown[] = [];
    const bridge = createDesktopFieldBridge({
      post: (value) => sent.push(value),
      subscribe: () => () => undefined,
      command: vi.fn(),
      currentOperatorId: () => null,
      navigate: vi.fn(),
      pendingUploads: () => ({ count: 0, risk: "none" }),
    });
    bridge.start("session");
    bridge.sendReady("/field?embedded=crm", "missing");
    bridge.sendReady("/field?embedded=crm", "expired");
    bridge.sendReady("/field?embedded=crm", "authenticated", "operator_kim");
    expect(sent).toMatchObject([
      { payload: { session: "missing" } },
      { payload: { session: "expired" } },
      { payload: { session: "authenticated", operatorId: "operator_kim" } },
    ]);
  });

  it("handles one command once, replays its safe result, and cancels stale sessions", async () => {
    const sent: unknown[] = [];
    let receive: ((event: MessageEvent) => void) | undefined;
    const command = vi.fn(async () => ({
      visitId: "visit_1",
      jobIds: ["job_1"],
      repeated: false,
    }));
    const bridge = createDesktopFieldBridge({
      post: (value) => sent.push(value),
      subscribe: (listener) => {
        receive = listener;
        return () => { receive = undefined; };
      },
      command,
      currentOperatorId: () => "operator_kim",
      navigate: vi.fn(),
      pendingUploads: () => ({ count: 0, risk: "none" }),
    });
    bridge.start("session_a");
    const envelope = createFieldBridgeEnvelope("field.command", {
      command: "openCreateJob",
      operatorId: "operator_kim",
      args: {},
    }, REQUEST_ID);
    receive?.(new MessageEvent("message", {
      data: envelope,
      origin: "https://bring-fm.web.app",
      source: window,
    }));
    await vi.waitFor(() => expect(command).toHaveBeenCalledOnce());
    expect(command).toHaveBeenCalledWith(
      "openCreateJob",
      {},
      expect.objectContaining({
        operatorId: "operator_kim",
        requestId: REQUEST_ID,
        signal: expect.any(AbortSignal),
      }),
    );
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    receive?.(new MessageEvent("message", {
      data: envelope,
      origin: "https://bring-fm.web.app",
      source: window,
    }));
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(command).toHaveBeenCalledOnce();
    expect(sent[1]).toEqual(sent[0]);

    bridge.setSession("session_b");
    receive?.(new MessageEvent("message", {
      data: envelope,
      origin: "https://bring-fm.web.app",
      source: window,
    }));
    await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(2));
    bridge.stop();
  });

  it("ignores messages not relayed by the exact FIELD window and origin", () => {
    const command = vi.fn();
    let receive: ((event: MessageEvent) => void) | undefined;
    const bridge = createDesktopFieldBridge({
      post: vi.fn(),
      subscribe: (listener) => { receive = listener; return () => undefined; },
      command,
      currentOperatorId: () => "operator_kim",
      navigate: vi.fn(),
      pendingUploads: () => ({ count: 0, risk: "none" }),
    });
    bridge.start("session_a");
    const envelope = createFieldBridgeEnvelope("field.command", {
      command: "claimJob", operatorId: "operator_kim", args: { jobId: "job_1" },
    }, REQUEST_ID);
    receive?.(new MessageEvent("message", { data: envelope, origin: "https://evil.test" }));
    expect(command).not.toHaveBeenCalled();
  });

  it("rejects an operator-switch race before executing a mutation", async () => {
    const sent: unknown[] = [];
    const command = vi.fn(async () => ({ ok: true }));
    let receive: ((event: MessageEvent) => void) | undefined;
    const bridge = createDesktopFieldBridge({
      post: (value) => sent.push(value),
      subscribe: (listener) => { receive = listener; return () => undefined; },
      command,
      currentOperatorId: () => "operator_hwang",
      navigate: vi.fn(),
      pendingUploads: () => ({ count: 0, risk: "none" }),
    });
    bridge.start("session_a");
    receive?.(new MessageEvent("message", {
      data: createFieldBridgeEnvelope("field.command", {
        command: "claimJob",
        operatorId: "operator_kim",
        args: { jobId: "job_1" },
      }, REQUEST_ID),
      origin: "https://bring-fm.web.app",
      source: window,
    }));

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(command).not.toHaveBeenCalled();
    expect(sent[0]).toMatchObject({
      type: "field.commandResult",
      requestId: REQUEST_ID,
      payload: { ok: false, error: { code: "FIELD_OPERATOR_CHANGED" } },
    });
  });

  it("passes the same request ID after a bridge reload so the server can deduplicate", async () => {
    const observed: string[] = [];
    const envelope = createFieldBridgeEnvelope("field.command", {
      command: "transitionStatus",
      operatorId: "operator_kim",
      args: { jobId: "job_1", toStatus: "accepted" },
    }, REQUEST_ID);

    for (const session of ["renderer_before_reload", "renderer_after_reload"]) {
      let receive: ((event: MessageEvent) => void) | undefined;
      const bridge = createDesktopFieldBridge({
        post: vi.fn(),
        subscribe: (listener) => { receive = listener; return () => undefined; },
        command: vi.fn(async (_command, _args, context) => {
          observed.push(context.requestId);
          return { ok: true };
        }),
        currentOperatorId: () => "operator_kim",
        navigate: vi.fn(),
        pendingUploads: () => ({ count: 0, risk: "none" }),
      });
      bridge.start(session);
      receive?.(new MessageEvent("message", {
        data: envelope,
        origin: "https://bring-fm.web.app",
        source: window,
      }));
      await vi.waitFor(() => expect(observed).toHaveLength(session === "renderer_before_reload" ? 1 : 2));
      bridge.stop();
    }
    expect(observed).toEqual([REQUEST_ID, REQUEST_ID]);
  });

  it("aborts timed out and explicitly cancelled work without a late reply", async () => {
    vi.useFakeTimers();
    const sent: unknown[] = [];
    const signals: AbortSignal[] = [];
    let receive: ((event: MessageEvent) => void) | undefined;
    const command = vi.fn((_command, _args, context) => {
      signals.push(context.signal);
      return new Promise((resolve) => {
        context.signal.addEventListener("abort", () => resolve({ late: true }), { once: true });
      });
    });
    const bridge = createDesktopFieldBridge({
      post: (value) => sent.push(value),
      subscribe: (listener) => { receive = listener; return () => undefined; },
      command,
      currentOperatorId: () => "operator_kim",
      navigate: vi.fn(),
      pendingUploads: () => ({ count: 0, risk: "none" }),
    });
    bridge.start("session_a");
    const first = createFieldBridgeEnvelope("field.command", {
      command: "claimJob", operatorId: "operator_kim", args: { jobId: "job_1" },
    }, REQUEST_ID);
    receive?.(new MessageEvent("message", { data: first, origin: "https://bring-fm.web.app", source: window }));
    await vi.waitFor(() => expect(command).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(signals[0].aborted).toBe(true);
    expect(sent).toHaveLength(0);

    const secondId = "223e4567-e89b-42d3-a456-426614174000";
    receive?.(new MessageEvent("message", {
      data: createFieldBridgeEnvelope("field.command", {
        command: "claimJob", operatorId: "operator_kim", args: { jobId: "job_2" },
      }, secondId),
      origin: "https://bring-fm.web.app",
      source: window,
    }));
    await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(2));
    receive?.(new MessageEvent("message", {
      data: createFieldBridgeEnvelope("field.cancel", { targetRequestId: secondId }),
      origin: "https://bring-fm.web.app",
      source: window,
    }));
    await Promise.resolve();
    expect(signals[1].aborted).toBe(true);
    expect(sent).toHaveLength(0);
    bridge.stop();
    vi.useRealTimers();
  });

  it("awaits a fresh pending upload count before deciding logout", async () => {
    const sent: any[] = [];
    let receive: ((event: MessageEvent) => void) | undefined;
    let resolveCount!: (value: { count: number; risk: "high" }) => void;
    const pending = new Promise<{ count: number; risk: "high" }>((resolve) => { resolveCount = resolve; });
    const bridge = createDesktopFieldBridge({
      post: (value) => sent.push(value),
      subscribe: (listener) => { receive = listener; return () => undefined; },
      command: vi.fn(),
      currentOperatorId: () => null,
      navigate: vi.fn(),
      pendingUploads: () => pending,
    });
    bridge.start("session");
    receive?.(new MessageEvent("message", {
      data: createFieldBridgeEnvelope("crm.logoutCheck", { reason: "logout" }, REQUEST_ID),
      origin: "https://bring-fm.web.app",
      source: window,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent).toHaveLength(0);
    resolveCount({ count: 3, risk: "high" });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      type: "field.logoutDecision",
      payload: { pending: true, count: 3, risk: "high" },
    });
    bridge.stop();
  });

  it("returns a typed failure when pending upload state cannot be read", async () => {
    const sent: unknown[] = [];
    let receive: ((event: MessageEvent) => void) | undefined;
    const bridge = createDesktopFieldBridge({
      post: (value) => sent.push(value),
      subscribe: (listener) => { receive = listener; return () => undefined; },
      command: vi.fn(),
      currentOperatorId: () => null,
      navigate: vi.fn(),
      pendingUploads: async () => { throw new Error("indexeddb unavailable"); },
    });
    bridge.start("session");
    receive?.(new MessageEvent("message", {
      data: createFieldBridgeEnvelope("crm.logoutCheck", { reason: "logout" }, REQUEST_ID),
      origin: "https://bring-fm.web.app",
      source: window,
    }));
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      type: "field.logoutDecision",
      requestId: REQUEST_ID,
      payload: { ok: false, error: { code: "FIELD_PENDING_UPLOADS_UNKNOWN" } },
    });
    bridge.stop();
  });

  it("never acknowledges navigation unless the runtime explicitly restored every field", async () => {
    const sent: any[] = [];
    let receive: ((event: MessageEvent) => void) | undefined;
    const navigate = vi.fn(async () => false);
    const bridge = createDesktopFieldBridge({
      post: (value) => sent.push(value),
      subscribe: (listener) => { receive = listener; return () => undefined; },
      command: vi.fn(),
      currentOperatorId: () => "operator_kim",
      navigate,
      pendingUploads: () => ({ count: 0, risk: "none" }),
    });
    bridge.start("session");
    const payload = {
      route: "/field?embedded=crm",
      operatorId: "operator_kim",
      selectedJobId: "job_1",
      filter: { kpi: "todayVisits" },
      scrollTop: 420,
      search: "101",
    };
    receive?.(new MessageEvent("message", {
      data: createFieldBridgeEnvelope("field.navigate", payload, REQUEST_ID),
      origin: "https://bring-fm.web.app",
      source: window,
    }));

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(navigate).toHaveBeenCalledWith(payload);
    expect(sent[0]).toMatchObject({
      type: "field.ack",
      requestId: REQUEST_ID,
      payload: { ok: false, error: { code: "FIELD_NAVIGATION_UNAVAILABLE" } },
    });
    bridge.stop();
  });

  it("acknowledges navigation only after an explicit successful restoration", async () => {
    const sent: any[] = [];
    let receive: ((event: MessageEvent) => void) | undefined;
    const bridge = createDesktopFieldBridge({
      post: (value) => sent.push(value),
      subscribe: (listener) => { receive = listener; return () => undefined; },
      command: vi.fn(),
      currentOperatorId: () => "operator_kim",
      navigate: async () => true,
      pendingUploads: () => ({ count: 0, risk: "none" }),
    });
    bridge.start("session");
    receive?.(new MessageEvent("message", {
      data: createFieldBridgeEnvelope("field.navigate", {
        route: "/field?embedded=crm",
        operatorId: "operator_kim",
        selectedJobId: "",
        filter: {},
        scrollTop: 0,
        search: "",
      }, REQUEST_ID),
      origin: "https://bring-fm.web.app",
      source: window,
    }));

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ type: "field.ack", payload: { ok: true } });
    bridge.stop();
  });

  it("preserves only explicit safe command error codes, never raw messages", async () => {
    const sent: any[] = [];
    let receive: ((event: MessageEvent) => void) | undefined;
    const bridge = createDesktopFieldBridge({
      post: (value) => sent.push(value),
      subscribe: (listener) => { receive = listener; return () => undefined; },
      command: async () => {
        throw Object.assign(new Error("sensitive internal explanation"), { code: "FIELD_CREATE_UNAVAILABLE" });
      },
      currentOperatorId: () => "operator_kim",
      navigate: vi.fn(),
      pendingUploads: () => ({ count: 0, risk: "none" }),
    });
    bridge.start("session");
    receive?.(new MessageEvent("message", {
      data: createFieldBridgeEnvelope("field.command", {
        command: "openCreateJob", operatorId: "operator_kim", args: {},
      }, REQUEST_ID),
      origin: "https://bring-fm.web.app",
      source: window,
    }));
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].payload).toEqual({ ok: false, error: { code: "FIELD_CREATE_UNAVAILABLE" } });
    expect(JSON.stringify(sent[0])).not.toContain("sensitive internal explanation");
    bridge.stop();
  });

  it("fails a command whose success result belongs to a different command", async () => {
    const sent: any[] = [];
    let receive: ((event: MessageEvent) => void) | undefined;
    const bridge = createDesktopFieldBridge({
      post: (value) => sent.push(value),
      subscribe: (listener) => { receive = listener; return () => undefined; },
      command: async () => ({ visitId: "visit_1", jobIds: ["job_1"], repeated: false }),
      currentOperatorId: () => "operator_kim",
      navigate: async () => true,
      pendingUploads: () => ({ count: 0, risk: "none" }),
    });
    bridge.start("session");
    receive?.(new MessageEvent("message", {
      data: createFieldBridgeEnvelope("field.command", {
        command: "claimJob",
        operatorId: "operator_kim",
        args: { jobId: "job_1" },
      }, REQUEST_ID),
      origin: "https://bring-fm.web.app",
      source: window,
    }));

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      type: "field.commandResult",
      payload: { ok: false, error: { code: "FIELD_REQUEST_FAILED" } },
    });
    bridge.stop();
  });
});
