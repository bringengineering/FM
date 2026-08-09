"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import AppShell, { type FieldDestination } from "./components/AppShell";
import AuthGate from "./components/AuthGate";
import BuildingWizard from "./components/BuildingWizard";
import type { CaptureUploadCoordinator } from "./components/CaptureGuide";
import CaptureWorkspace, {
  type CaptureTarget,
} from "./components/CaptureWorkspace";
import Dashboard from "./components/Dashboard";
import FieldMapPanel from "./components/FieldMapPanel";
import FieldServiceWorker from "./components/FieldServiceWorker";
import { useFieldSession } from "./components/FieldSessionContext";
import ManagementContractQueue from "./components/ManagementContractQueue";
import { logoutFieldUser } from "./lib/auth.client";
import {
  excludeFieldMedia,
  getFieldMediaAccess,
  loadFieldCaptureWorkspace,
  saveFieldRegistration,
  startFieldCaptureSession,
  type StartFieldCaptureSessionInput,
  type StartFieldCaptureSessionResult,
} from "./lib/field-api.client";
import { createFirebaseMediaUploadPort } from "./lib/firebase-media-upload";
import { fieldAppCheckConfigurationError } from "./lib/firebase.client";
import { MediaUploadCoordinator } from "./lib/media-upload";
import {
  openOfflineQueue,
  type OfflineQueuePort,
} from "./lib/offline-queue";
import type {
  SaveFieldRegistrationInput,
  SaveFieldRegistrationResult,
} from "./lib/registration-draft";

interface CaptureRegistrationContext {
  captureSessionId: string;
  primaryUnitLocalId: string;
}

interface SaveAndBindCaptureRegistrationInput {
  input: SaveFieldRegistrationInput;
  capture: CaptureRegistrationContext;
  uid: string;
  requestId: string;
  saveRegistration: (
    input: SaveFieldRegistrationInput,
  ) => Promise<SaveFieldRegistrationResult>;
  startCaptureSession: (
    input: StartFieldCaptureSessionInput,
  ) => Promise<StartFieldCaptureSessionResult>;
  queue: Pick<OfflineQueuePort, "bindRegistration">;
  coordinator?: Pick<CaptureUploadCoordinator, "resume">;
}

export async function saveAndBindCaptureRegistration({
  input,
  capture,
  uid,
  requestId,
  saveRegistration,
  startCaptureSession,
  queue,
  coordinator,
}: SaveAndBindCaptureRegistrationInput): Promise<SaveFieldRegistrationResult> {
  const ids = await saveRegistration(input);
  const unitId = ids.unitIds[capture.primaryUnitLocalId];
  if (!unitId) throw new Error("capture_unit_binding_missing");
  await startCaptureSession({
    requestId,
    captureSessionId: capture.captureSessionId,
    visitId: ids.visitId,
    buildingId: ids.buildingId,
    unitId,
    listingId: ids.listingId,
    visitType: "initial",
  });
  await queue.bindRegistration(uid, capture.captureSessionId, ids);
  await coordinator?.resume(uid);
  return ids;
}

interface FieldWorkspaceProps {
  saveRegistration?: typeof saveFieldRegistration;
  startCaptureSession?: typeof startFieldCaptureSession;
  queueFactory?: typeof openOfflineQueue;
  coordinator?: CaptureUploadCoordinator;
  coordinatorFactory?: (queue: OfflineQueuePort) => RuntimeCaptureCoordinator;
  requestIdFactory?: () => string;
  loadCaptureTargets?: () => Promise<CaptureTarget[]>;
  loadOpenCaptureSessions?: () => Promise<import("./lib/types").CaptureSessionRecord[]>;
  getMediaAccess?: typeof getFieldMediaAccess;
  excludeMedia?: typeof excludeFieldMedia;
  logout?: typeof logoutFieldUser;
  confirmExit?: (message: string) => boolean;
}

interface RuntimeCaptureCoordinator extends CaptureUploadCoordinator {
  start(uid: string): () => void;
}

function createDefaultCaptureCoordinator(
  queue: OfflineQueuePort,
): RuntimeCaptureCoordinator {
  return new MediaUploadCoordinator(queue, createFirebaseMediaUploadPort());
}

function createDefaultCaptureLoaders(uid: string) {
  let pending: ReturnType<typeof loadFieldCaptureWorkspace> | null = null;
  const load = () => {
    if (!uid) return Promise.reject(new Error("field_session_required"));
    if (!pending) {
      pending = loadFieldCaptureWorkspace().finally(() => {
        pending = null;
      });
    }
    return pending;
  };
  return {
    targets: async () => (await load()).targets,
    sessions: async () => (await load()).openSessions,
  };
}

const destinationTitles: Record<
  Exclude<FieldDestination, "home">,
  { eyebrow: string; title: string; description: string }
> = {
  map: {
    eyebrow: "NAVER MAP",
    title: "건물과 매물을 지도에서 확인하세요",
    description: "등록된 건물, 공실, 촬영 상태를 원주 지도 위에서 함께 관리합니다.",
  },
  buildings: {
    eyebrow: "BUILDINGS & UNITS",
    title: "건물·호실 정보",
    description: "건물 기본 정보부터 보증금, 관리비, 주차, 공실 현황까지 한곳에 기록합니다.",
  },
  capture: {
    eyebrow: "FIELD CAPTURE",
    title: "현장 촬영",
    description: "구역별 촬영 순서에 맞춰 사진과 영상을 빠짐없이 수집합니다.",
  },
  packages: {
    eyebrow: "AD PACKAGES",
    title: "광고 패키지",
    description: "당근과 네이버 부동산에 바로 활용할 사진 묶음과 매물 설명을 준비합니다.",
  },
};

function DestinationScreen({ destination }: { destination: Exclude<FieldDestination, "home"> }) {
  const copy = destinationTitles[destination];

  return (
    <section className="field-placeholder">
      <p className="field-eyebrow">{copy.eyebrow}</p>
      <h1>{copy.title}</h1>
      <p>{copy.description}</p>
      <div className="field-placeholder-card">
        <span aria-hidden="true">B</span>
        <div>
          <strong>기능을 연결하고 있습니다</strong>
          <p>등록 양식과 저장 구조가 이어지면 이 화면에서 바로 사용할 수 있습니다.</p>
        </div>
      </div>
    </section>
  );
}

export function FieldWorkspace({
  saveRegistration = saveFieldRegistration,
  startCaptureSession = startFieldCaptureSession,
  queueFactory = openOfflineQueue,
  coordinator: suppliedCoordinator,
  coordinatorFactory = createDefaultCaptureCoordinator,
  requestIdFactory = () => crypto.randomUUID(),
  loadCaptureTargets: suppliedTargetLoader,
  loadOpenCaptureSessions: suppliedSessionLoader,
  getMediaAccess = getFieldMediaAccess,
  excludeMedia = excludeFieldMedia,
  logout = logoutFieldUser,
  confirmExit = (message) => window.confirm(message),
}: FieldWorkspaceProps = {}) {
  const session = useFieldSession();
  const [active, setActive] = useState<FieldDestination>("home");
  const [queue, setQueue] = useState<OfflineQueuePort | null>(null);
  const [coordinator, setCoordinator] = useState<CaptureUploadCoordinator | null>(
    suppliedCoordinator ?? null,
  );
  const [pendingCount, setPendingCount] = useState(0);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState<string>();
  const stopCoordinatorRef = useRef<(() => void) | undefined>(undefined);
  const runtimeCoordinatorRef = useRef<RuntimeCaptureCoordinator | null>(null);
  const defaultCaptureLoaders = useMemo(
    () => createDefaultCaptureLoaders(session.uid),
    [session.uid],
  );
  const captureTargetLoader = suppliedTargetLoader ?? defaultCaptureLoaders.targets;
  const captureSessionLoader = suppliedSessionLoader ?? defaultCaptureLoaders.sessions;

  useEffect(() => {
    let cancelled = false;
    let openedQueue: OfflineQueuePort | null = null;
    let stopCoordinator: (() => void) | undefined;
    void queueFactory()
      .then((nextQueue) => {
        if (cancelled) {
          nextQueue.close();
          return;
        }
        openedQueue = nextQueue;
        const nextCoordinator = suppliedCoordinator
          ?? coordinatorFactory(nextQueue);
        if (!suppliedCoordinator) {
          runtimeCoordinatorRef.current = nextCoordinator as RuntimeCaptureCoordinator;
          stopCoordinator = runtimeCoordinatorRef.current.start(session.uid);
          stopCoordinatorRef.current = stopCoordinator;
        }
        setQueue(nextQueue);
        setCoordinator(nextCoordinator);
        void nextQueue.countPending(session.uid).then((count) => {
          if (!cancelled) setPendingCount(count);
        }).catch(() => undefined);
      })
      .catch(() => {
        if (!cancelled) setQueue(null);
      });
    return () => {
      cancelled = true;
      const stop = stopCoordinatorRef.current;
      if (stop && stop === stopCoordinator) {
        stop();
        stopCoordinatorRef.current = undefined;
      }
      runtimeCoordinatorRef.current = null;
      openedQueue?.close();
    };
  }, [coordinatorFactory, queueFactory, session.uid, suppliedCoordinator]);

  async function handleLogout() {
    if (logoutBusy) return;
    setLogoutBusy(true);
    setLogoutError(undefined);
    let stoppedRuntime: RuntimeCaptureCoordinator | null = null;
    try {
      if (!queue) throw new Error("capture_queue_unavailable");
      const count = await queue.countPending(session.uid);
      setPendingCount(count);
      if (count > 0 && !confirmExit(
        `서버 등록 대기 파일이 ${count}개 있습니다. 로그아웃하면 이 계정으로 다시 로그인할 때까지 업로드가 멈춥니다. 로그아웃할까요?`,
      )) return;
      stoppedRuntime = runtimeCoordinatorRef.current;
      stopCoordinatorRef.current?.();
      stopCoordinatorRef.current = undefined;
      setActive("home");
      await logout();
    } catch {
      if (stoppedRuntime && !stopCoordinatorRef.current) {
        stopCoordinatorRef.current = stoppedRuntime.start(session.uid);
      }
      setLogoutError("로그아웃에 실패했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setLogoutBusy(false);
    }
  }

  return (
    <AppShell
      active={active}
      session={session}
      pendingCount={pendingCount}
      logoutBusy={logoutBusy}
      logoutError={logoutError}
      onLogout={() => void handleLogout()}
      onNavigate={setActive}
    >
      {active === "home" ? (
        <Dashboard onNavigate={setActive} />
      ) : active === "map" ? (
        <FieldMapPanel />
      ) : active === "buildings" ? (
        <section className="field-building-workspace">
          <ManagementContractQueue />
          <BuildingWizard
            session={session}
            queue={queue ?? undefined}
            coordinator={coordinator ?? undefined}
            onCompleteWithCapture={async (input, capture) => {
              if (!queue) throw new Error("capture_queue_unavailable");
              return saveAndBindCaptureRegistration({
                input,
                capture,
                uid: session.uid,
                requestId: requestIdFactory(),
                saveRegistration,
                startCaptureSession,
                queue,
                coordinator: coordinator ?? undefined,
              });
            }}
          />
        </section>
      ) : active === "capture" ? (
        queue && coordinator ? (
          <CaptureWorkspace
            loadTargets={captureTargetLoader}
            loadOpenSessions={captureSessionLoader}
            startSession={startCaptureSession}
            queue={queue}
            coordinator={coordinator}
            getFieldMediaAccess={getMediaAccess}
            excludeFieldMedia={async (input) => {
              await excludeMedia(input);
            }}
          />
        ) : (
          <section className="field-placeholder" aria-live="polite">
            <p className="field-eyebrow">FIELD CAPTURE</p>
            <h1>현장 촬영 준비 중</h1>
            <p>기기 저장소와 안전한 업로드 연결을 확인하고 있습니다.</p>
          </section>
        )
      ) : (
        <DestinationScreen destination={active} />
      )}
    </AppShell>
  );
}

export default function FieldApp() {
  if (fieldAppCheckConfigurationError) {
    return (
      <main className="field-auth-screen">
        <section className="field-auth-card" role="alert">
          <p className="field-eyebrow">SECURITY CONFIGURATION</p>
          <h1>서비스 설정 확인 필요</h1>
          <p>{fieldAppCheckConfigurationError}</p>
        </section>
      </main>
    );
  }
  return (
    <>
      <FieldServiceWorker />
      <AuthGate><FieldWorkspace /></AuthGate>
    </>
  );
}
