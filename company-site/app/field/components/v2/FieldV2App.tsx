"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  logoutFieldV2User,
  type FieldV2AuthState,
  type FieldV2Session,
} from "../../lib/v2-auth.client";
import {
  consumeDesktopHandoffFromUrl,
  isDesktopHandoffBootstrapUrl,
  isExactCrmEmbeddedUrl,
} from "../../lib/desktop-handoff.client";
import {
  ensureFieldAppCheckToken,
  fieldAppCheckConfigurationErrorFor,
} from "../../lib/firebase.client";
import { openOfflineQueue } from "../../lib/offline-queue";
import {
  createDesktopFieldBridge,
  defaultDesktopFieldBridgeDependencies,
  type FieldBridgeCommand,
} from "../../lib/v2/desktop-bridge.client";
import { createFieldV2Api, type FieldMutationCommand } from "../../lib/v2/field-v2-api.client";
import {
  loadActiveOperatorProfiles,
  readOperatorPreference,
  writeOperatorPreference,
  type FieldOperatorProfile,
} from "../../lib/v2/operator-profile.client";
import BrandLogo from "../BrandLogo";
import FieldServiceWorker from "../FieldServiceWorker";
import FieldDesktopLogoutObserver, { observeFieldDesktopLogout } from "./FieldDesktopLogoutObserver";
import FieldOperationsHome, {
  type FieldOperationsHomeHandle,
  type FieldOperationsNavigationPayload,
} from "./FieldOperationsHome";
import FieldOperatorPicker from "./FieldOperatorPicker";
import FieldStatusState from "./FieldStatusState";
import FieldV2AuthGate from "./FieldV2AuthGate";

function currentEmbeddedRoute(): string {
  return "/field?embedded=crm";
}

function uploadRisk(count: number): "none" | "low" | "medium" | "high" {
  if (count <= 0) return "none";
  if (count <= 2) return "low";
  if (count <= 9) return "medium";
  return "high";
}

const NAVIGATION_RUNTIME_WAIT_MS = 8_000;
const NAVIGATION_RETRY_MS = 25;

export interface FieldEmbeddedRuntime {
  readonly operatorId: string;
  readonly pendingUploads: { readonly known: boolean; readonly count: number };
  readonly ready: boolean;
  command(
    command: FieldBridgeCommand,
    args: Record<string, unknown>,
    context: { operatorId: string; requestId: string; signal: AbortSignal },
  ): Promise<unknown>;
  navigate(payload: Record<string, unknown>): Promise<boolean>;
}

export function FieldEmbeddedBridgeHost({
  authState,
  session,
  runtime,
}: {
  authState: FieldV2AuthState;
  session: FieldV2Session | null;
  runtime: FieldEmbeddedRuntime | null;
}) {
  const bridgeRef = useRef<ReturnType<typeof createDesktopFieldBridge> | null>(null);
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const authStateRef = useRef(authState);
  authStateRef.current = authState;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const hostActiveRef = useRef(true);
  const logoutInProgressRef = useRef(false);
  const [logoutInProgress, setLogoutInProgress] = useState(false);

  useEffect(() => {
    const started = () => {
      logoutInProgressRef.current = true;
      setLogoutInProgress(true);
    };
    const failed = () => {
      logoutInProgressRef.current = false;
      setLogoutInProgress(false);
    };
    window.addEventListener("bring-field-logout-started", started);
    window.addEventListener("bring-field-logout-failed", failed);
    return () => {
      window.removeEventListener("bring-field-logout-started", started);
      window.removeEventListener("bring-field-logout-failed", failed);
    };
  }, []);

  useEffect(() => {
    const bridge = createDesktopFieldBridge(defaultDesktopFieldBridgeDependencies(
      async (command, args, context) => {
        const current = runtimeRef.current;
        if (!current?.ready) {
          throw Object.assign(new Error("field_session_unavailable"), { code: "FIELD_SESSION_UNAVAILABLE" });
        }
        return current.command(command, args, context);
      },
      async (payload) => {
        const deadline = Date.now() + NAVIGATION_RUNTIME_WAIT_MS;
        while (hostActiveRef.current && Date.now() < deadline) {
          const current = runtimeRef.current;
          if (current && await current.navigate(payload)) return true;
          await new Promise((resolve) => window.setTimeout(resolve, NAVIGATION_RETRY_MS));
        }
        return false;
      },
      () => {
        const currentAuthState = authStateRef.current;
        if (currentAuthState === "missing") return { count: 0, risk: "none" };
        if (currentAuthState !== "authenticated" || !sessionRef.current || !runtimeRef.current) {
          throw new Error("field_pending_uploads_unknown");
        }
        const pending = runtimeRef.current?.pendingUploads;
        if (!pending?.known) throw new Error("field_pending_uploads_unknown");
        const count = pending.count;
        return { count, risk: uploadRisk(count) };
      },
      () => runtimeRef.current?.operatorId || null,
    ));
    hostActiveRef.current = true;
    bridge.start("field_missing");
    bridgeRef.current = bridge;
    return () => {
      hostActiveRef.current = false;
      bridge.stop();
      bridgeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge) return;
    if (authState === "checking" || logoutInProgressRef.current) return;
    const sessionState = authState === "missing"
      ? "missing"
      : authState === "authenticated"
        ? "authenticated"
        : "expired";
    const operatorId = runtime?.operatorId || undefined;
    bridge.setSession(`${session?.uid ?? "missing"}:${sessionState}`);
    bridge.sendReady(currentEmbeddedRoute(), sessionState, operatorId);
    const pending = runtime?.pendingUploads;
    if (sessionState === "missing" || (sessionState === "authenticated" && pending?.known)) {
      const count = sessionState === "missing" ? 0 : pending!.count;
      bridge.sendPendingUploads(count, uploadRisk(count));
    }
  }, [authState, logoutInProgress, runtime?.operatorId, runtime?.pendingUploads.count, runtime?.pendingUploads.known, session]);

  return null;
}

function FieldV2Workspace({
  session,
  embedded,
  onEmbeddedRuntime,
}: {
  session: FieldV2Session;
  embedded: boolean;
  onEmbeddedRuntime(runtime: FieldEmbeddedRuntime | null): void;
}) {
  const [profiles, setProfiles] = useState<readonly FieldOperatorProfile[]>([]);
  const [operatorId, setOperatorId] = useState("");
  const [profilesStatus, setProfilesStatus] = useState<"loading" | "ready" | "error">("loading");
  const [appCheckStatus, setAppCheckStatus] = useState<"checking" | "ready" | "error">("checking");
  const [search, setSearch] = useState("");
  const [pendingUploads, setPendingUploads] = useState({ known: false, count: 0 });
  const homeRef = useRef<FieldOperationsHomeHandle | null>(null);
  const operatorRef = useRef(operatorId);
  operatorRef.current = operatorId;

  const retryAppCheck = useCallback(() => {
    setAppCheckStatus("checking");
    void ensureFieldAppCheckToken()
      .then(() => setAppCheckStatus("ready"))
      .catch(() => setAppCheckStatus("error"));
  }, []);

  useEffect(() => { retryAppCheck(); }, [retryAppCheck]);
  useEffect(() => {
    let active = true;
    setProfilesStatus("loading");
    void loadActiveOperatorProfiles()
      .then((next) => {
        if (!active) return;
        setProfiles(next);
        setOperatorId(readOperatorPreference(window.localStorage, session.uid, next) ?? "");
        setProfilesStatus("ready");
      })
      .catch(() => { if (active) setProfilesStatus("error"); });
    return () => { active = false; };
  }, [session.uid]);

  useEffect(() => {
    let active = true;
    let queue: Awaited<ReturnType<typeof openOfflineQueue>> | null = null;
    const refresh = () => void (queue
      ? queue.countPending(session.uid)
      : openOfflineQueue().then((opened) => {
        queue = opened;
        return opened.countPending(session.uid);
      }))
      .then((count: number) => { if (active) setPendingUploads({ known: true, count }); })
      .catch(() => { if (active) setPendingUploads({ known: false, count: 0 }); });
    void refresh();
    const timer = window.setInterval(refresh, 15_000);
    return () => { active = false; window.clearInterval(timer); queue?.close(); };
  }, [session.uid]);

  const api = useMemo(() => operatorId ? createFieldV2Api({ operatorId }) : null, [operatorId]);

  const chooseOperator = useCallback((nextOperatorId: string) => {
    if (!profiles.some((profile) => profile.operatorId === nextOperatorId)) return;
    writeOperatorPreference(window.localStorage, session.uid, nextOperatorId);
    setOperatorId(nextOperatorId);
  }, [profiles, session.uid]);

  useEffect(() => {
    if (!embedded) return;
    const runtime: FieldEmbeddedRuntime = {
      operatorId,
      pendingUploads,
      ready: Boolean(api && operatorId && appCheckStatus === "ready"),
      async command(command, args, context) {
        if (context.operatorId !== operatorRef.current) {
          throw Object.assign(new Error("field_operator_changed"), { code: "FIELD_OPERATOR_CHANGED" });
        }
        if (command === "openCreateJob") {
          if (session.role === "viewer") {
            throw Object.assign(new Error("field_viewer_read_only"), { code: "FIELD_VIEWER_READ_ONLY" });
          }
          throw Object.assign(new Error("field_create_unavailable"), { code: "FIELD_CREATE_UNAVAILABLE" });
        }
        if (command === "reviewJob") {
          throw Object.assign(new Error("field_review_unavailable"), { code: "FIELD_REVIEW_UNAVAILABLE" });
        }
        if (session.role === "viewer") {
          throw Object.assign(new Error("field_viewer_read_only"), { code: "FIELD_VIEWER_READ_ONLY" });
        }
        if (!api || appCheckStatus !== "ready") {
          throw Object.assign(new Error("field_session_unavailable"), {
            code: "FIELD_SESSION_UNAVAILABLE",
          });
        }
        const result = await api.runCommand(command as FieldMutationCommand, args, {
          requestId: context.requestId,
          signal: context.signal,
        });
        if (context.operatorId !== operatorRef.current) {
          throw Object.assign(new Error("field_operator_changed"), { code: "FIELD_OPERATOR_CHANGED" });
        }
        return result;
      },
      async navigate(payload) {
        if (typeof payload.operatorId === "string" && payload.operatorId !== operatorRef.current) {
          chooseOperator(payload.operatorId);
          return false;
        }
        if (!homeRef.current) return false;
        return homeRef.current.restoreNavigation(payload as unknown as FieldOperationsNavigationPayload);
      },
    };
    onEmbeddedRuntime(runtime);
    return () => onEmbeddedRuntime(null);
  }, [api, appCheckStatus, chooseOperator, embedded, onEmbeddedRuntime, operatorId, pendingUploads, session.role]);

  if (fieldAppCheckConfigurationErrorFor(embedded) || appCheckStatus === "error") {
    return <FieldStatusState status="security" onRetry={retryAppCheck} />;
  }
  if (appCheckStatus === "checking" || profilesStatus === "loading") return <FieldStatusState status="loading" />;
  if (profilesStatus === "error") return <FieldStatusState status="error" onRetry={() => window.location.reload()} />;

  const picker = (
    <FieldOperatorPicker
      profiles={profiles}
      value={operatorId}
      compact={embedded && Boolean(operatorId)}
      onChange={chooseOperator}
    />
  );

  if (!operatorId || !api) {
    return <main className="field-v2-root field-v2-select-root">{!embedded ? <BrandLogo /> : null}{picker}</main>;
  }

  return (
    <main className={`field-v2-root${embedded ? " field-v2-embedded" : " field-v2-standalone"}`}>
      {!embedded ? (
        <header className="field-v2-standalone-header">
          <BrandLogo />
          {picker}
          <button className="field-v2-action field-v2-action-muted" type="button" onClick={() => void logoutFieldV2User()}>로그아웃</button>
        </header>
      ) : null}
      <FieldOperationsHome
        ref={homeRef}
        role={session.role}
        operatorId={operatorId}
        search={search}
        onSearchChange={setSearch}
        loadWorkspace={api.loadWorkspace}
        onCommand={session.role === "viewer" ? undefined : (command, args) => {
          if (command === "openCreateJob" || command === "reviewJob") throw new Error("field_command_unavailable");
          return api.runCommand(command as FieldMutationCommand, args);
        }}
      />
    </main>
  );
}

type FieldEntryState =
  | { readonly status: "checking"; readonly embedded: boolean }
  | { readonly status: "ready"; readonly embedded: boolean }
  | { readonly status: "error"; readonly embedded: true };

export type FieldV2EntryKind = "standalone" | "embedded" | "bootstrap" | "invalid-embedded";

export function classifyFieldV2EntryUrl(url: URL): FieldV2EntryKind {
  if (isExactCrmEmbeddedUrl(url)) return "embedded";
  if (isDesktopHandoffBootstrapUrl(url)) return "bootstrap";
  if (url.searchParams.has("embedded") || url.searchParams.has("desktop_handoff")) {
    return "invalid-embedded";
  }
  return "standalone";
}

export default function FieldV2App() {
  const [entry, setEntry] = useState<FieldEntryState>({ status: "checking", embedded: false });
  const [session, setSession] = useState<FieldV2Session | null>(null);
  const [runtime, setRuntime] = useState<FieldEmbeddedRuntime | null>(null);
  const [authState, setAuthState] = useState<FieldV2AuthState>("checking");

  useEffect(() => {
    let active = true;
    const url = new URL(window.location.href);
    const kind = classifyFieldV2EntryUrl(url);
    if (kind === "embedded") {
      setEntry({ status: "ready", embedded: true });
      return () => { active = false; };
    }
    if (kind === "standalone") {
      setEntry({ status: "ready", embedded: false });
      return () => { active = false; };
    }
    if (kind === "invalid-embedded") {
      setEntry({ status: "error", embedded: true });
      return () => { active = false; };
    }
    setEntry({ status: "checking", embedded: true });
    void consumeDesktopHandoffFromUrl(url)
      .then((result) => {
        if (!active) return;
        setEntry(result.mode === "crm" && result.consumed
          ? { status: "ready", embedded: true }
          : { status: "error", embedded: true });
      })
      .catch(() => {
        if (active) setEntry({ status: "error", embedded: true });
      });
    return () => { active = false; };
  }, []);

  const onSessionChange = useCallback((next: FieldV2Session | null) => {
    setSession(next);
    if (next === null) setRuntime(null);
  }, []);
  const onEmbeddedRuntime = useCallback((next: FieldEmbeddedRuntime | null) => setRuntime(next), []);
  if (entry.status !== "ready") {
    return (
      <>
        <FieldServiceWorker />
        {entry.embedded ? <FieldDesktopLogoutObserver /> : null}
        <FieldStatusState
          status={entry.status === "checking" ? "loading" : "security"}
          onRetry={entry.status === "error"
            ? () => window.dispatchEvent(new Event("bring-field-reconnect-request"))
            : undefined}
        />
      </>
    );
  }
  const embedded = entry.embedded;
  return (
    <>
      <FieldServiceWorker />
      {embedded ? <FieldDesktopLogoutObserver /> : null}
      {embedded ? (
        <FieldEmbeddedBridgeHost authState={authState} session={session} runtime={runtime} />
      ) : null}
      <FieldV2AuthGate
        embedded={embedded}
        onSessionChange={onSessionChange}
        onAuthStateChange={setAuthState}
      >
        {(activeSession) => (
          <FieldV2Workspace
            key={activeSession.uid}
            session={activeSession}
            embedded={embedded}
            onEmbeddedRuntime={onEmbeddedRuntime}
          />
        )}
      </FieldV2AuthGate>
    </>
  );
}

export { observeFieldDesktopLogout };
