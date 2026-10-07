"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

import type {
  StartFieldCaptureSessionInput,
  StartFieldCaptureSessionResult,
} from "../lib/field-api.client";
import type {
  OfflineQueuePort,
  QueuedMediaRecord,
} from "../lib/offline-queue";
import type { CaptureSessionRecord } from "../lib/types";
import {
  EMPTY_UPLOAD_SUMMARY,
  type UploadSummary,
} from "../lib/upload-summary";
import CaptureGuide, {
  type CaptureContext,
  type CaptureGuideProps,
  type CaptureUploadCoordinator,
} from "./CaptureGuide";
import { useFieldSession } from "./FieldSessionContext";

export interface CaptureTarget {
  id: string;
  buildingId: string;
  buildingName: string;
  unitId?: string;
  unitLabel?: string;
  listingId?: string;
  source: "management" | "advertising";
}

export interface CaptureWorkspaceProps {
  loadTargets: () => Promise<CaptureTarget[]>;
  loadOpenSessions: () => Promise<CaptureSessionRecord[]>;
  startSession: (
    input: StartFieldCaptureSessionInput,
  ) => Promise<StartFieldCaptureSessionResult>;
  queue: OfflineQueuePort;
  coordinator: CaptureUploadCoordinator;
  getFieldMediaAccess?: CaptureGuideProps["getFieldMediaAccess"];
  excludeFieldMedia?: CaptureGuideProps["excludeFieldMedia"];
  uploadSummary?: UploadSummary;
  uploadSummaryDelayed?: boolean;
}

interface WorkspaceSnapshot {
  ownerUid: string;
  loadVersion: number;
  targets: CaptureTarget[];
  openSessions: CaptureSessionRecord[];
  pendingRecords: QueuedMediaRecord[];
  selectedTargetId: string;
  loadError?: string;
}

interface ActiveCapture {
  ownerUid: string;
  session: CaptureSessionRecord;
  target: CaptureTarget;
}

interface StartAttempt {
  ownerUid: string;
  targetId: string;
  input: StartFieldCaptureSessionInput;
}

interface StartState {
  ownerUid: string;
  targetId: string;
  busy: boolean;
  failed: boolean;
  error?: string;
}

function secureUuidV4(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    throw new Error("capture_secure_random_unavailable");
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10).join(""),
  ].join("-");
}

function targetLabel(target: CaptureTarget): string {
  return target.unitLabel
    ? `${target.buildingName} · ${target.unitLabel}`
    : target.buildingName;
}

function sourceLabel(source: CaptureTarget["source"]): string {
  return source === "management" ? "관리 계약" : "광고 매물";
}

function targetForSession(
  session: CaptureSessionRecord,
  targets: CaptureTarget[],
): CaptureTarget | undefined {
  if (session.listingId) {
    return targets.find((target) => (
      target.source === "advertising"
      && target.listingId === session.listingId
      && target.buildingId === session.buildingId
      && target.unitId === session.unitId
    ));
  }
  return targets.find((target) => (
    target.source === "management"
    && target.buildingId === session.buildingId
    && target.unitId === session.unitId
  ));
}

function updatedAtValue(session: CaptureSessionRecord): number {
  const value = Date.parse(session.updatedAt || session.createdAt);
  return Number.isFinite(value) ? value : 0;
}

function ownedOpenSessions(
  sessions: CaptureSessionRecord[],
  uid: string,
  targets: CaptureTarget[],
): CaptureSessionRecord[] {
  return sessions
    .filter((session) => (
      session.createdBy === uid
      && session.status === "open"
      && Boolean(targetForSession(session, targets))
    ))
    .sort((left, right) => (
      updatedAtValue(right) - updatedAtValue(left)
      || right.id.localeCompare(left.id)
    ));
}

function ownedPendingRecords(
  records: QueuedMediaRecord[],
  uid: string,
): QueuedMediaRecord[] {
  return records.filter((record) => (
    record.uid === uid && record.descriptor.uploadState !== "finalized"
  ));
}

function captureContext(active: ActiveCapture): CaptureContext {
  const { session } = active;
  return {
    mode: "visit",
    captureSessionId: session.id,
    buildingId: session.buildingId,
    ...(session.unitId === undefined ? {} : { unitId: session.unitId }),
    ...(session.listingId === undefined
      ? {}
      : { listingId: session.listingId }),
    visitId: session.visitId,
  };
}

function formatSessionTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "시각 확인 불가";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function CaptureWorkspace({
  loadTargets,
  loadOpenSessions,
  startSession,
  queue,
  coordinator,
  getFieldMediaAccess,
  excludeFieldMedia,
  uploadSummary = EMPTY_UPLOAD_SUMMARY,
  uploadSummaryDelayed = false,
}: CaptureWorkspaceProps) {
  const session = useFieldSession();
  const [loadVersion, setLoadVersion] = useState(0);
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [activeCapture, setActiveCapture] = useState<ActiveCapture | null>(null);
  const [startState, setStartState] = useState<StartState | null>(null);
  const startAttempt = useRef<StartAttempt | null>(null);
  const pendingRefreshId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const ownerUid = session.uid;
    const requestedVersion = loadVersion;
    void Promise.all([
      loadTargets(),
      loadOpenSessions(),
      queue.listPending(ownerUid),
    ]).then(([targets, sessions, pendingRecords]) => {
      if (cancelled) return;
      const availableTargets = [...targets];
      setSnapshot((current) => {
        const previousSelection = current?.ownerUid === ownerUid
          ? current.selectedTargetId
          : "";
        const selectedTargetId = availableTargets.some(
          (target) => target.id === previousSelection,
        )
          ? previousSelection
          : availableTargets[0]?.id ?? "";
        return {
          ownerUid,
          loadVersion: requestedVersion,
          targets: availableTargets,
          openSessions: ownedOpenSessions(sessions, ownerUid, availableTargets),
          pendingRecords: ownedPendingRecords(pendingRecords, ownerUid),
          selectedTargetId,
        };
      });
    }).catch(() => {
      if (cancelled) return;
      setSnapshot({
        ownerUid,
        loadVersion: requestedVersion,
        targets: [],
        openSessions: [],
        pendingRecords: [],
        selectedTargetId: "",
        loadError: "촬영 대상을 불러오지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.",
      });
    });
    return () => {
      cancelled = true;
    };
  }, [loadOpenSessions, loadTargets, loadVersion, queue, session.uid]);

  const currentSnapshot = snapshot?.ownerUid === session.uid
    && snapshot.loadVersion === loadVersion
    ? snapshot
    : null;
  const currentActiveCapture = activeCapture?.ownerUid === session.uid
    ? activeCapture
    : null;
  const currentStartState = startState?.ownerUid === session.uid
    ? startState
    : null;

  const managementTargets = useMemo(() => (
    currentSnapshot?.targets.filter((target) => target.source === "management")
      ?? []
  ), [currentSnapshot]);
  const advertisingTargets = useMemo(() => (
    currentSnapshot?.targets.filter((target) => target.source === "advertising")
      ?? []
  ), [currentSnapshot]);
  const selectedTarget = currentSnapshot?.targets.find(
    (target) => target.id === currentSnapshot.selectedTargetId,
  );

  const refreshPending = useCallback(async () => {
    const ownerUid = session.uid;
    const refreshId = pendingRefreshId.current + 1;
    pendingRefreshId.current = refreshId;
    try {
      const records = await queue.listPending(ownerUid);
      if (pendingRefreshId.current !== refreshId) return;
      setSnapshot((current) => current?.ownerUid === ownerUid
        ? {
            ...current,
            pendingRecords: ownedPendingRecords(records, ownerUid),
          }
        : current);
    } catch {
      // CaptureGuide keeps its own actionable upload state if this summary refresh fails.
    }
  }, [queue, session.uid]);

  const handleDescriptorsChange = useCallback(() => {
    void refreshPending();
  }, [refreshPending]);

  const handleTargetChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const targetId = event.currentTarget.value;
    startAttempt.current = null;
    setStartState(null);
    setSnapshot((current) => current?.ownerUid === session.uid
      ? { ...current, selectedTargetId: targetId }
      : current);
  };

  const resumeSession = (captureSession: CaptureSessionRecord) => {
    if (!currentSnapshot) return;
    const target = targetForSession(captureSession, currentSnapshot.targets);
    if (!target) return;
    setStartState(null);
    setActiveCapture({
      ownerUid: session.uid,
      session: captureSession,
      target,
    });
  };

  const beginNewSession = async () => {
    if (!selectedTarget || currentStartState?.busy) return;
    const ownerUid = session.uid;
    const existingAttempt = startAttempt.current;
    let attempt: StartAttempt;
    try {
      attempt = existingAttempt?.ownerUid === ownerUid
        && existingAttempt.targetId === selectedTarget.id
        ? existingAttempt
        : {
            ownerUid,
            targetId: selectedTarget.id,
            input: {
              requestId: secureUuidV4(),
              captureSessionId: secureUuidV4(),
              visitId: secureUuidV4(),
              buildingId: selectedTarget.buildingId,
              ...(selectedTarget.unitId === undefined
                ? {}
                : { unitId: selectedTarget.unitId }),
              ...(selectedTarget.listingId === undefined
                ? {}
                : { listingId: selectedTarget.listingId }),
              visitType: "vacancyRefresh",
            },
          };
    } catch {
      setStartState({
        ownerUid,
        targetId: selectedTarget.id,
        busy: false,
        failed: true,
        error: "안전한 촬영 번호를 만들지 못했습니다. 브라우저를 새로고침해 주세요.",
      });
      return;
    }
    startAttempt.current = attempt;
    setStartState({
      ownerUid,
      targetId: selectedTarget.id,
      busy: true,
      failed: false,
    });
    try {
      const result = await startSession(attempt.input);
      if (
        result.captureSessionId !== attempt.input.captureSessionId
        || result.visitId !== attempt.input.visitId
      ) {
        throw new Error("capture_session_response_mismatch");
      }
      if (session.uid !== ownerUid) return;
      const now = new Date().toISOString();
      const nextSession: CaptureSessionRecord = {
        id: result.captureSessionId,
        requestId: attempt.input.requestId,
        buildingId: attempt.input.buildingId,
        ...(attempt.input.unitId === undefined
          ? {}
          : { unitId: attempt.input.unitId }),
        ...(attempt.input.listingId === undefined
          ? {}
          : { listingId: attempt.input.listingId }),
        visitId: result.visitId,
        createdBy: ownerUid,
        status: "open",
        createdAt: now,
        updatedAt: now,
      };
      setSnapshot((current) => current?.ownerUid === ownerUid
        ? {
            ...current,
            openSessions: [
              nextSession,
              ...current.openSessions.filter((item) => item.id !== nextSession.id),
            ],
          }
        : current);
      setActiveCapture({ ownerUid, session: nextSession, target: selectedTarget });
      setStartState({
        ownerUid,
        targetId: selectedTarget.id,
        busy: false,
        failed: false,
      });
      startAttempt.current = null;
      void refreshPending();
    } catch {
      if (session.uid !== ownerUid) return;
      setStartState({
        ownerUid,
        targetId: selectedTarget.id,
        busy: false,
        failed: true,
        error: "방문 촬영을 시작하지 못했습니다. 같은 정보로 다시 시도해 주세요.",
      });
    }
  };

  const pendingRecords = currentSnapshot?.pendingRecords ?? [];
  const retryingSelectedTarget = Boolean(
    currentStartState?.failed
    && currentStartState.targetId === selectedTarget?.id,
  );

  return (
    <section className="field-capture-workspace" aria-labelledby="capture-workspace-title">
      <header className="field-capture-workspace-header">
        <div>
          <p className="field-eyebrow">ASSIGNED CAPTURE</p>
          <h1 id="capture-workspace-title">현장 촬영</h1>
          <p>배정받은 관리 건물과 광고 매물을 구분해 촬영합니다.</p>
        </div>
        <div
          className="field-capture-workspace-summary"
          aria-label="휴대전화 전체 업로드 현황"
        >
          <div className="field-capture-upload-counts">
            <span>오늘 <strong>{uploadSummary.todayTotal}</strong></span>
            <span>업로드 중 <strong>{uploadSummary.uploading}</strong></span>
            <span>완료 <strong>{uploadSummary.completedToday}</strong></span>
            <span>실패 <strong>{uploadSummary.failed}</strong></span>
          </div>
          <div
            className="field-capture-upload-progress"
            role="progressbar"
            aria-label="오늘 업로드 진행률"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={uploadSummary.progressPercent}
          >
            <span style={{ width: `${uploadSummary.progressPercent}%` }} />
          </div>
          <small>
            오늘 진행률 {uploadSummary.progressPercent}%
            {uploadSummaryDelayed ? " · 갱신 지연" : ""}
          </small>
        </div>
      </header>

      {!currentSnapshot ? (
        <p className="field-capture-workspace-status" role="status">
          배정된 촬영 업무를 불러오는 중입니다.
        </p>
      ) : null}

      {currentSnapshot?.loadError ? (
        <div className="field-capture-workspace-error" role="alert">
          <p>{currentSnapshot.loadError}</p>
          <button type="button" onClick={() => setLoadVersion((value) => value + 1)}>
            다시 불러오기
          </button>
        </div>
      ) : null}

      {currentSnapshot && !currentSnapshot.loadError ? (
        <>
          <section className="field-capture-target-panel" aria-labelledby="capture-target-title">
            <div>
              <h2 id="capture-target-title">새 방문 촬영</h2>
              <p>촬영할 대상을 먼저 선택하세요. 관리와 광고 배정은 서로 섞이지 않습니다.</p>
            </div>
            {currentSnapshot.targets.length > 0 ? (
              <div className="field-capture-target-control">
                <label htmlFor="field-capture-target">촬영 대상</label>
                <select
                  id="field-capture-target"
                  value={currentSnapshot.selectedTargetId}
                  disabled={Boolean(currentStartState?.busy)}
                  onChange={handleTargetChange}
                >
                  {managementTargets.length > 0 ? (
                    <optgroup label="관리 계약 건물">
                      {managementTargets.map((target) => (
                        <option value={target.id} key={target.id}>
                          {targetLabel(target)}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {advertisingTargets.length > 0 ? (
                    <optgroup label="광고 매물">
                      {advertisingTargets.map((target) => (
                        <option value={target.id} key={target.id}>
                          {targetLabel(target)}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
                {selectedTarget ? (
                  <div className="field-capture-target-meta">
                    <span className={`field-capture-source-badge ${selectedTarget.source}`}>
                      {sourceLabel(selectedTarget.source)}
                    </span>
                    <strong>{targetLabel(selectedTarget)}</strong>
                  </div>
                ) : null}
                <button
                  className="field-capture-start"
                  type="button"
                  disabled={!selectedTarget || Boolean(currentStartState?.busy)}
                  aria-busy={currentStartState?.busy || undefined}
                  onClick={() => void beginNewSession()}
                >
                  {currentStartState?.busy
                    ? "촬영 세션 만드는 중"
                    : retryingSelectedTarget
                      ? "같은 정보로 다시 시도"
                      : "새 방문 촬영 시작"}
                </button>
                {currentStartState?.error ? (
                  <p className="field-capture-start-error" role="alert">
                    {currentStartState.error}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="field-capture-workspace-empty">
                현재 배정된 촬영 대상이 없습니다. 관리자에게 배정 상태를 확인해 주세요.
              </p>
            )}
          </section>

          <section className="field-open-session-section" aria-labelledby="open-session-title">
            <div className="field-open-session-heading">
              <div>
                <h2 id="open-session-title">진행 중 촬영</h2>
                <p>최근에 작업한 세션부터 이어서 할 수 있습니다.</p>
              </div>
              <span>{currentSnapshot.openSessions.length}건</span>
            </div>
            {currentSnapshot.openSessions.length > 0 ? (
              <div className="field-open-session-list">
                {currentSnapshot.openSessions.map((captureSession) => {
                  const target = targetForSession(
                    captureSession,
                    currentSnapshot.targets,
                  );
                  if (!target) return null;
                  const sessionPending = pendingRecords.filter((record) => (
                    record.captureSessionId === captureSession.id
                  ));
                  const sessionFailed = sessionPending.filter((record) => (
                    record.descriptor.uploadState === "failed"
                  )).length;
                  return (
                    <article
                      className="field-open-session-card"
                      data-testid="open-capture-session"
                      data-session-id={captureSession.id}
                      key={captureSession.id}
                    >
                      <div data-testid={`open-session-${captureSession.id}`}>
                        <div className="field-open-session-card-heading">
                          <span className={`field-capture-source-badge ${target.source}`}>
                            {sourceLabel(target.source)}
                          </span>
                          <time dateTime={captureSession.updatedAt}>
                            {formatSessionTime(captureSession.updatedAt)}
                          </time>
                        </div>
                        <h3>{targetLabel(target)}</h3>
                        <p>
                          {sessionPending.length}개 대기 · {sessionFailed}개 재시도
                        </p>
                        <button
                          type="button"
                          onClick={() => resumeSession(captureSession)}
                        >
                          진행 중 촬영 이어서 하기
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="field-capture-workspace-empty">
                이어서 할 촬영이 없습니다. 위에서 새 방문 촬영을 시작해 주세요.
              </p>
            )}
          </section>
        </>
      ) : null}

      {currentActiveCapture ? (
        <section className="field-active-capture" aria-labelledby="active-capture-title">
          <header>
            <div>
              <span className={`field-capture-source-badge ${currentActiveCapture.target.source}`}>
                {sourceLabel(currentActiveCapture.target.source)}
              </span>
              <h2 id="active-capture-title">
                {targetLabel(currentActiveCapture.target)} 촬영 중
              </h2>
            </div>
            <button type="button" onClick={() => setActiveCapture(null)}>
              촬영 목록으로 돌아가기
            </button>
          </header>
          <CaptureGuide
            key={`${session.uid}:${currentActiveCapture.session.id}`}
            context={captureContext(currentActiveCapture)}
            queue={queue}
            coordinator={coordinator}
            getFieldMediaAccess={getFieldMediaAccess}
            excludeFieldMedia={excludeFieldMedia}
            onDescriptorsChange={handleDescriptorsChange}
          />
        </section>
      ) : null}
    </section>
  );
}
