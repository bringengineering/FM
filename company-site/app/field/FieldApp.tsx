"use client";

import { useEffect, useState } from "react";

import AppShell, { type FieldDestination } from "./components/AppShell";
import AuthGate from "./components/AuthGate";
import BuildingWizard from "./components/BuildingWizard";
import type { CaptureUploadCoordinator } from "./components/CaptureGuide";
import Dashboard from "./components/Dashboard";
import FieldMapPanel from "./components/FieldMapPanel";
import { useFieldSession } from "./components/FieldSessionContext";
import ManagementContractQueue from "./components/ManagementContractQueue";
import {
  saveFieldRegistration,
  startFieldCaptureSession,
  type StartFieldCaptureSessionInput,
  type StartFieldCaptureSessionResult,
} from "./lib/field-api.client";
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
  requestIdFactory?: () => string;
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
  coordinator,
  requestIdFactory = () => crypto.randomUUID(),
}: FieldWorkspaceProps = {}) {
  const session = useFieldSession();
  const [active, setActive] = useState<FieldDestination>("home");
  const [queue, setQueue] = useState<OfflineQueuePort | null>(null);

  useEffect(() => {
    let cancelled = false;
    let openedQueue: OfflineQueuePort | null = null;
    void queueFactory()
      .then((nextQueue) => {
        if (cancelled) {
          nextQueue.close();
          return;
        }
        openedQueue = nextQueue;
        setQueue(nextQueue);
      })
      .catch(() => {
        if (!cancelled) setQueue(null);
      });
    return () => {
      cancelled = true;
      openedQueue?.close();
    };
  }, [queueFactory, session.uid]);

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
            coordinator={coordinator}
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
                coordinator,
              });
            }}
          />
        </section>
      ) : (
        <DestinationScreen destination={active} />
      )}
    </AppShell>
  );
}

export default function FieldApp() {
  return <AuthGate><FieldWorkspace /></AuthGate>;
}
