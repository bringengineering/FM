"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import AppShell, { type FieldDestination } from "./components/AppShell";
import AdPackageReview from "./components/AdPackageReview";
import AuthGate from "./components/AuthGate";
import BuildingWizard from "./components/BuildingWizard";
import type { CaptureUploadCoordinator } from "./components/CaptureGuide";
import CaptureWorkspace, {
  type CaptureTarget,
} from "./components/CaptureWorkspace";
import Dashboard from "./components/Dashboard";
import DesktopFieldBootstrap from "./components/DesktopFieldBootstrap";
import DriveConnectionControl from "./components/DriveConnectionControl";
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
import { createFirebaseDirectAdPackageApi } from "./lib/direct-ad-package.client";
import { createFirebaseDirectDriveMediaUploadPort } from "./lib/direct-drive-media-upload";
import { createFirebaseDirectFieldApi } from "./lib/direct-field-api.client";
import { fieldAppCheckConfigurationError } from "./lib/firebase.client";
import { MediaUploadCoordinator } from "./lib/media-upload";
import {
  openOfflineQueue,
  type OfflineQueuePort,
} from "./lib/offline-queue";
import {
  EMPTY_UPLOAD_SUMMARY,
  summarizeUploadRecords,
  type UploadSummary,
} from "./lib/upload-summary";
import type {
  SaveFieldRegistrationInput,
  SaveFieldRegistrationResult,
} from "./lib/registration-draft";
import { firebaseRegistrationDraftServer } from "./lib/server-registration-draft.client";

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
  embeddedMode?: boolean;
}

interface RuntimeCaptureCoordinator extends CaptureUploadCoordinator {
  start(uid: string): () => void;
}

interface UploadSummarySnapshot {
  ownerUid: string;
  summary: UploadSummary;
  delayed: boolean;
}

function createDefaultCaptureCoordinator(
  queue: OfflineQueuePort,
): RuntimeCaptureCoordinator {
  return new MediaUploadCoordinator(queue, createFirebaseDirectDriveMediaUploadPort(queue));
}

function createDefaultCaptureLoaders(
  uid: string,
  loadFieldCaptureWorkspaceDirect: () => ReturnType<typeof loadFieldCaptureWorkspace>,
) {
  let pending: ReturnType<typeof loadFieldCaptureWorkspaceDirect> | null = null;
  const load = () => {
    if (!uid) return Promise.reject(new Error("field_session_required"));
    if (!pending) {
      pending = loadFieldCaptureWorkspaceDirect().finally(() => {
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
  saveRegistration: suppliedSaveRegistration,
  startCaptureSession: suppliedStartCaptureSession,
  queueFactory = openOfflineQueue,
  coordinator: suppliedCoordinator,
  coordinatorFactory = createDefaultCaptureCoordinator,
  requestIdFactory = () => crypto.randomUUID(),
  loadCaptureTargets: suppliedTargetLoader,
  loadOpenCaptureSessions: suppliedSessionLoader,
  getMediaAccess: suppliedGetMediaAccess,
  excludeMedia: suppliedExcludeMedia,
  logout = logoutFieldUser,
  confirmExit = (message) => window.confirm(message),
  embeddedMode = false,
}: FieldWorkspaceProps = {}) {
  const session = useFieldSession();
  const [active, setActive] = useState<FieldDestination>("home");
  const [queue, setQueue] = useState<OfflineQueuePort | null>(null);
  const [coordinator, setCoordinator] = useState<CaptureUploadCoordinator | null>(
    suppliedCoordinator ?? null,
  );
  const [uploadSnapshot, setUploadSnapshot] = useState<UploadSummarySnapshot>({
    ownerUid: session.uid,
    summary: EMPTY_UPLOAD_SUMMARY,
    delayed: false,
  });
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState<string>();
  const stopCoordinatorRef = useRef<(() => void) | undefined>(undefined);
  const runtimeCoordinatorRef = useRef<RuntimeCaptureCoordinator | null>(null);
  const refreshUploadsRef = useRef<() => Promise<void>>(async () => undefined);
  const directFieldApi = useMemo(() => createFirebaseDirectFieldApi({
    uid: session.uid,
    role: session.role,
    displayName: session.displayName,
  }), [session.displayName, session.role, session.uid]);
  const directAdApi = useMemo(() => (
    session.role === "admin" || session.role === "reviewer"
      ? createFirebaseDirectAdPackageApi({ uid: session.uid, role: session.role })
      : null
  ), [session.role, session.uid]);
  const saveRegistration = suppliedSaveRegistration ?? directFieldApi.saveRegistration;
  const startCaptureSession = suppliedStartCaptureSession ?? directFieldApi.startCaptureSession;
  const getMediaAccess = suppliedGetMediaAccess ?? directAdApi?.mediaAccess ?? getFieldMediaAccess;
  const excludeMedia = suppliedExcludeMedia ?? directAdApi?.exclude ?? excludeFieldMedia;
  const defaultCaptureLoaders = useMemo(
    () => createDefaultCaptureLoaders(session.uid, directFieldApi.loadCaptureWorkspace),
    [directFieldApi, session.uid],
  );
  const captureTargetLoader = suppliedTargetLoader ?? defaultCaptureLoaders.targets;
  const captureSessionLoader = suppliedSessionLoader ?? defaultCaptureLoaders.sessions;
  const uploadSummary = uploadSnapshot.ownerUid === session.uid
    ? uploadSnapshot.summary
    : EMPTY_UPLOAD_SUMMARY;
  const uploadSummaryDelayed = uploadSnapshot.ownerUid === session.uid
    ? uploadSnapshot.delayed
    : false;

  useEffect(() => {
    let cancelled = false;
    let refreshRevision = 0;
    let openedQueue: OfflineQueuePort | null = null;
    let stopCoordinator: (() => void) | undefined;
    let refreshInterval: number | undefined;
    let refreshOnEvent: (() => void) | undefined;
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
        const refreshUploads = async () => {
          const revision = ++refreshRevision;
          try {
            const records = await nextQueue.list(session.uid);
            if (cancelled || revision !== refreshRevision) return;
            setUploadSnapshot({
              ownerUid: session.uid,
              summary: summarizeUploadRecords(records),
              delayed: false,
            });
          } catch {
            if (cancelled || revision !== refreshRevision) return;
            setUploadSnapshot((current) => current.ownerUid === session.uid
              ? { ...current, delayed: true }
              : {
                  ownerUid: session.uid,
                  summary: EMPTY_UPLOAD_SUMMARY,
                  delayed: true,
                });
          }
        };
        refreshUploadsRef.current = refreshUploads;
        refreshOnEvent = () => void refreshUploads();
        window.addEventListener("focus", refreshOnEvent);
        window.addEventListener("online", refreshOnEvent);
        refreshInterval = window.setInterval(refreshOnEvent, 1_000);
        void refreshUploads();
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
      refreshUploadsRef.current = async () => undefined;
      if (refreshOnEvent) {
        window.removeEventListener("focus", refreshOnEvent);
        window.removeEventListener("online", refreshOnEvent);
      }
      if (refreshInterval !== undefined) window.clearInterval(refreshInterval);
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
      if (count > 0 && !confirmExit(
        `Drive 업로드 대기 파일이 ${count}개 있습니다. 로그아웃하면 이 계정으로 다시 로그인할 때까지 업로드가 멈춥니다. 로그아웃할까요?`,
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
      uploadSummary={uploadSummary}
      uploadSummaryDelayed={uploadSummaryDelayed}
      logoutBusy={logoutBusy}
      logoutError={logoutError}
      embeddedMode={embeddedMode}
      driveControl={(
        <DriveConnectionControl
          onConnected={async () => {
            await coordinator?.resume(session.uid);
            await refreshUploadsRef.current();
          }}
        />
      )}
      onLogout={() => void handleLogout()}
      onNavigate={setActive}
    >
      {active === "home" ? (
        <Dashboard onNavigate={setActive} />
      ) : active === "map" ? (
        <FieldMapPanel />
      ) : active === "buildings" ? (
        <section className="field-building-workspace">
          <ManagementContractQueue approve={directFieldApi.setManagementContractStatus} />
          <BuildingWizard
            session={session}
            draftServer={firebaseRegistrationDraftServer}
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
            uploadSummary={uploadSummary}
            uploadSummaryDelayed={uploadSummaryDelayed}
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
      ) : active === "packages" ? (
        directAdApi ? (
          <AdPackageReview
            load={directAdApi.load}
            create={directAdApi.create}
            exclude={directAdApi.exclude}
            mediaAccess={directAdApi.mediaAccess}
          />
        ) : <AdPackageReview />
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
  const embeddedMode = typeof window !== "undefined"
    && new URL(window.location.href).searchParams.get("embedded") === "crm";
  return (
    <>
      <FieldServiceWorker />
      {embeddedMode ? (
        <DesktopFieldBootstrap directSession>
          <AuthGate interactiveLogin={false}>
            <FieldWorkspace embeddedMode />
          </AuthGate>
        </DesktopFieldBootstrap>
      ) : (
        <AuthGate><FieldWorkspace /></AuthGate>
      )}
    </>
  );
}
