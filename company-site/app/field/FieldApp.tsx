"use client";

import { useEffect, useMemo, useState } from "react";

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
}

interface RuntimeCaptureCoordinator extends CaptureUploadCoordinator {
  start(uid: string): () => void;
}

function createDefaultCaptureCoordinator(
  queue: OfflineQueuePort,
): RuntimeCaptureCoordinator {
  return new MediaUploadCoordinator(queue, createFirebaseMediaUploadPort());
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
}: FieldWorkspaceProps = {}) {
  const session = useFieldSession();
  const [active, setActive] = useState<FieldDestination>("home");
  const [queue, setQueue] = useState<OfflineQueuePort | null>(null);
  const [coordinator, setCoordinator] = useState<CaptureUploadCoordinator | null>(
    suppliedCoordinator ?? null,
  );
  const captureLoaders = useMemo(() => {
    let pending: ReturnType<typeof loadFieldCaptureWorkspace> | null = null;
    const load = () => {
      if (!pending) {
        pending = loadFieldCaptureWorkspace().finally(() => {
          pending = null;
        });
      }
      return pending;
    };
    return {
      targets: suppliedTargetLoader ?? (async () => (await load()).targets),
      sessions: suppliedSessionLoader ?? (async () => (await load()).openSessions),
    };
  }, [session.uid, suppliedSessionLoader, suppliedTargetLoader]);

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
          stopCoordinator = (nextCoordinator as RuntimeCaptureCoordinator)
            .start(session.uid);
        }
        setQueue(nextQueue);
        setCoordinator(nextCoordinator);
      })
      .catch(() => {
        if (!cancelled) setQueue(null);
      });
    return () => {
      cancelled = true;
      stopCoordinator?.();
      openedQueue?.close();
    };
  }, [coordinatorFactory, queueFactory, session.uid, suppliedCoordinator]);

  return (
    <AppShell active={active} onNavigate={setActive}>
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
            loadTargets={captureLoaders.targets}
            loadOpenSessions={captureLoaders.sessions}
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
  return (
    <>
      <FieldServiceWorker />
      <AuthGate><FieldWorkspace /></AuthGate>
    </>
  );
}
