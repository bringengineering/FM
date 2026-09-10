"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import type { FieldSession } from "../lib/auth.client";
import {
  subscribeOwnerNotes as defaultSubscribeOwnerNotes,
  type AppendOwnerNoteInput,
} from "../lib/field-api.client";
import {
  appendOwnerNoteDirect as defaultAppendOwnerNote,
  archiveOwnerNoteDirect as defaultArchiveOwnerNote,
} from "../lib/direct-owner-notes.client";
import type { OwnerNote, OwnerNoteDraft } from "../lib/types";

const NOTE_MAX_LENGTH = 2_000;
const OFFLINE_DELAY_MS = 5 * 60 * 1_000;
const LOAD_ERROR_MESSAGE =
  "건물주 메모를 불러올 권한이 없거나 네트워크 연결이 끊겼습니다.";

type DisplayNote = {
  id: string;
  body: string;
  recordedAt: string;
  sortAt: string;
  source: "draft" | "server";
  draft?: OwnerNoteDraft;
  server?: OwnerNote;
};

export interface OwnerNotesPanelProps {
  buildingId?: string;
  draftId: string;
  currentUser: FieldSession;
  draftNotes: OwnerNoteDraft[];
  onDraftNotesChange(notes: OwnerNoteDraft[]): void;
  disabled?: boolean;
  createId?: () => string;
  now?: () => string;
  initialExpanded?: boolean;
  appendNote?: (input: AppendOwnerNoteInput) => Promise<OwnerNote>;
  archiveNote?: (input: { buildingId: string; noteId: string }) => Promise<{
    archivedAt: string;
    archivedBy: string;
  }>;
  subscribeNotes?: typeof defaultSubscribeOwnerNotes;
}

function defaultCreateId(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("field_owner_note_secure_id_unavailable");
  }
  return globalThis.crypto.randomUUID();
}

function defaultNow(): string {
  return new Date().toISOString();
}

function milliseconds(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatRecordedAt(value: string): string {
  const parsed = milliseconds(value);
  if (!parsed) return "기록 시간 확인 필요";

  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function mergeNotes(
  serverNotes: OwnerNote[],
  optimisticNotes: OwnerNote[],
  draftNotes: OwnerNoteDraft[],
): DisplayNote[] {
  const merged = new Map<string, DisplayNote>();

  for (const note of draftNotes) {
    merged.set(note.localId, {
      id: note.localId,
      body: note.body,
      recordedAt: note.recordedAt,
      sortAt: note.recordedAt,
      source: "draft",
      draft: note,
    });
  }

  for (const note of [...optimisticNotes, ...serverNotes]) {
    merged.set(note.id, {
      id: note.id,
      body: note.body,
      recordedAt: note.recordedAt,
      sortAt: note.createdAt,
      source: "server",
      server: note,
    });
  }

  return [...merged.values()].sort(
    (left, right) => milliseconds(right.sortAt) - milliseconds(left.sortAt),
  );
}

export default function OwnerNotesPanel({
  buildingId,
  draftId,
  currentUser,
  draftNotes,
  onDraftNotesChange,
  disabled = false,
  createId = defaultCreateId,
  now = defaultNow,
  initialExpanded = false,
  appendNote = defaultAppendOwnerNote,
  archiveNote = defaultArchiveOwnerNote,
  subscribeNotes = defaultSubscribeOwnerNotes,
}: OwnerNotesPanelProps) {
  const generatedId = useId();
  const titleId = `${generatedId}-owner-notes-title`;
  const bodyId = `${generatedId}-owner-notes-body`;
  const editorId = `${generatedId}-owner-notes-editor`;
  const [expanded, setExpanded] = useState(initialExpanded);
  const [body, setBody] = useState("");
  const [serverNotes, setServerNotes] = useState<OwnerNote[]>([]);
  const [optimisticNotes, setOptimisticNotes] = useState<OwnerNote[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [showAllForBuilding, setShowAllForBuilding] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [validationError, setValidationError] = useState("");
  const [loadError, setLoadError] = useState("");
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const wasExpandedRef = useRef(false);
  const draftNotesRef = useRef(draftNotes);
  const onDraftNotesChangeRef = useRef(onDraftNotesChange);
  const busyRef = useRef<string | null>(null);
  const mountedRef = useRef(false);
  const buildingIdRef = useRef(buildingId);

  draftNotesRef.current = draftNotes;
  onDraftNotesChangeRef.current = onDraftNotesChange;
  buildingIdRef.current = buildingId;

  const replaceDraftNotes = useCallback((next: OwnerNoteDraft[]) => {
    draftNotesRef.current = next;
    onDraftNotesChangeRef.current(next);
  }, []);

  const updateDraftNotes = useCallback((
    update: (notes: OwnerNoteDraft[]) => OwnerNoteDraft[],
  ) => {
    replaceDraftNotes(update(draftNotesRef.current));
  }, [replaceDraftNotes]);

  const claimBusy = useCallback((key: string): boolean => {
    if (busyRef.current) return false;
    busyRef.current = key;
    setBusyAction(key);
    return true;
  }, []);

  const releaseBusy = useCallback((key: string) => {
    if (busyRef.current !== key) return;
    busyRef.current = null;
    if (mountedRef.current) setBusyAction(null);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      busyRef.current = null;
    };
  }, []);

  useEffect(() => {
    const wasExpanded = wasExpandedRef.current;
    wasExpandedRef.current = expanded;
    if (!expanded || wasExpanded) return;

    const schedule = globalThis.requestAnimationFrame
      ? globalThis.requestAnimationFrame.bind(globalThis)
      : (callback: FrameRequestCallback) => globalThis.setTimeout(callback, 0);
    const cancel = globalThis.cancelAnimationFrame
      ? globalThis.cancelAnimationFrame.bind(globalThis)
      : globalThis.clearTimeout.bind(globalThis);
    const requestId = schedule(() => editorRef.current?.focus());

    return () => cancel(requestId);
  }, [expanded]);

  useEffect(() => {
    setServerNotes([]);
    setOptimisticNotes([]);
    setLoadError("");
    setStatus("");
  }, [buildingId]);

  const showingAll = Boolean(buildingId && showAllForBuilding === buildingId);

  useEffect(() => {
    if (!buildingId) return;

    let active = true;
    let unsubscribe: () => void = () => undefined;
    try {
      unsubscribe = subscribeNotes(
        buildingId,
        (notes) => {
          if (!active) return;
          setServerNotes(notes);
          const receivedIds = new Set(notes.map((note) => note.id));
          setOptimisticNotes((current) => current.filter(
            (note) => !receivedIds.has(note.id),
          ));
          setLoadError("");
        },
        () => {
          if (!active) return;
          setLoadError(LOAD_ERROR_MESSAGE);
          setStatus("메모 불러오기 실패");
        },
        showingAll ? {} : { limit: 50 },
      );
    } catch {
      if (active) {
        setLoadError(LOAD_ERROR_MESSAGE);
        setStatus("메모 불러오기 실패");
      }
    }

    return () => {
      active = false;
      unsubscribe();
    };
  }, [buildingId, showingAll, subscribeNotes]);

  const visibleNotes = useMemo(
    () => mergeNotes(serverNotes, optimisticNotes, draftNotes),
    [draftNotes, optimisticNotes, serverNotes],
  );

  const sendDraftToServer = useCallback(async (
    note: OwnerNoteDraft,
    actionKey: string,
  ) => {
    const targetBuildingId = buildingIdRef.current;
    if (!targetBuildingId) {
      releaseBusy(actionKey);
      return;
    }

    setValidationError("");
    setStatus("서버 저장 중");
    try {
      const saved = await appendNote({
        buildingId: targetBuildingId,
        localId: note.localId,
        body: note.body,
        recordedAt: note.recordedAt,
      });
      if (!mountedRef.current || buildingIdRef.current !== targetBuildingId) return;

      setOptimisticNotes((current) => [
        saved,
        ...current.filter((item) => item.id !== saved.id),
      ]);
      updateDraftNotes((current) => current.filter(
        (item) => item.localId !== note.localId,
      ));
      setStatus("서버 저장 완료");
    } catch {
      if (!mountedRef.current || buildingIdRef.current !== targetBuildingId) return;
      setStatus("서버 저장 대기 · 다시 시도");
    } finally {
      releaseBusy(actionKey);
    }
  }, [appendNote, releaseBusy, updateDraftNotes]);

  const handleSave = useCallback(() => {
    if (disabled) return;
    const trimmed = body.trim();
    if (!trimmed) {
      setValidationError("메모 내용을 입력해 주세요.");
      return;
    }
    if (trimmed.length > NOTE_MAX_LENGTH) {
      setValidationError("메모는 2,000자 이내로 입력해 주세요.");
      return;
    }

    let localId: string;
    let recordedAt: string;
    try {
      localId = createId();
      recordedAt = now();
    } catch {
      setValidationError("메모 식별자를 만들지 못했습니다. 다시 시도해 주세요.");
      return;
    }

    const note: OwnerNoteDraft = {
      localId,
      draftId,
      body: trimmed,
      recordedAt,
    };
    const actionKey = `save:${localId}`;
    if (!claimBusy(actionKey)) return;

    updateDraftNotes((current) => [
      note,
      ...current.filter((item) => item.localId !== note.localId),
    ]);
    setBody("");
    setValidationError("");

    if (!buildingIdRef.current) {
      setStatus("기기 저장됨 · 건물 등록 시 서버 전송");
      releaseBusy(actionKey);
      return;
    }
    void sendDraftToServer(note, actionKey);
  }, [body, claimBusy, createId, disabled, draftId, now, releaseBusy, sendDraftToServer, updateDraftNotes]);

  const handleRetry = useCallback((note: OwnerNoteDraft) => {
    if (disabled || !buildingIdRef.current) return;
    const actionKey = `retry:${note.localId}`;
    if (!claimBusy(actionKey)) return;
    void sendDraftToServer(note, actionKey);
  }, [claimBusy, disabled, sendDraftToServer]);

  const handleArchive = useCallback(async (note: OwnerNote) => {
    if (disabled) return;
    const targetBuildingId = buildingIdRef.current;
    if (!targetBuildingId || currentUser.role !== "admin") return;
    const actionKey = `archive:${note.id}`;
    if (!claimBusy(actionKey)) return;

    setStatus("메모 보관 중");
    setValidationError("");
    try {
      await archiveNote({ buildingId: targetBuildingId, noteId: note.id });
      if (!mountedRef.current || buildingIdRef.current !== targetBuildingId) return;
      setServerNotes((current) => current.filter((item) => item.id !== note.id));
      setOptimisticNotes((current) => current.filter((item) => item.id !== note.id));
      setStatus("메모 보관 완료");
    } catch {
      if (mountedRef.current && buildingIdRef.current === targetBuildingId) {
        setStatus("메모 보관 실패 · 다시 시도해 주세요");
      }
    } finally {
      releaseBusy(actionKey);
    }
  }, [archiveNote, claimBusy, currentUser.role, disabled, releaseBusy]);

  const summary = visibleNotes[0]?.body || "아직 기록된 전달사항이 없습니다.";

  return (
    <aside className="field-owner-notes" aria-labelledby={titleId}>
      <div className="field-owner-notes-header">
        <div className="field-owner-notes-heading">
          <h2 id={titleId}>건물주 전달사항</h2>
          <p title={summary}>{summary}</p>
        </div>
        <button
          type="button"
          className="field-owner-notes-toggle"
          aria-expanded={expanded}
          aria-controls={bodyId}
          disabled={disabled}
          onClick={() => setExpanded((current) => !current)}
        >
          메모 추가
        </button>
      </div>

      <p className="field-owner-notes-status" aria-live="polite" aria-atomic="true">
        {status || "\u00a0"}
      </p>

      {expanded ? (
        <div id={bodyId} className="field-owner-notes-body">
          <div className="field-owner-notes-editor">
            <label htmlFor={editorId}>새 건물주 전달사항</label>
            <textarea
              ref={editorRef}
              id={editorId}
              value={body}
              maxLength={NOTE_MAX_LENGTH}
              disabled={disabled}
              aria-invalid={Boolean(validationError)}
              aria-describedby={validationError ? `${editorId}-error` : `${editorId}-counter`}
              onChange={(event) => {
                setBody(event.target.value);
                if (validationError) setValidationError("");
              }}
              placeholder="건물주 요청, 출입 방법, 방문 전 연락사항을 기록하세요."
            />
            <div className="field-owner-notes-editor-meta">
              <span id={`${editorId}-counter`}>{body.length.toLocaleString("ko-KR")} / 2,000</span>
              <button type="button" disabled={disabled || Boolean(busyAction)} onClick={handleSave}>
                {busyAction?.startsWith("save:") ? "저장 중" : "메모 저장"}
              </button>
            </div>
            {validationError ? (
              <p id={`${editorId}-error`} className="field-owner-notes-error" role="alert">
                {validationError}
              </p>
            ) : null}
          </div>

          {loadError ? (
            <p className="field-owner-notes-error" role="alert">{loadError}</p>
          ) : null}

          {visibleNotes.length > 0 ? (
            <ol className="field-owner-notes-list" aria-label="기록된 건물주 전달사항">
              {visibleNotes.map((note) => {
                const delayed = Boolean(
                  note.source === "server"
                  && note.server
                  && Math.abs(
                    milliseconds(note.server.createdAt)
                    - milliseconds(note.server.recordedAt),
                  ) > OFFLINE_DELAY_MS,
                );
                const archiveInFlight = busyAction === `archive:${note.id}`;

                return (
                  <li key={note.id}>
                    <p>{note.body}</p>
                    <div className="field-owner-notes-item-meta">
                      <span>
                        {note.server?.createdByName || currentUser.displayName} ·{" "}
                        <time dateTime={note.recordedAt}>{formatRecordedAt(note.recordedAt)}</time>
                      </span>
                      {delayed ? <span>오프라인에서 기록됨</span> : null}
                    </div>
                    {note.source === "draft" && note.draft && buildingId ? (
                      <button
                        type="button"
                        className="field-owner-notes-secondary"
                        disabled={disabled || Boolean(busyAction)}
                        onClick={() => handleRetry(note.draft as OwnerNoteDraft)}
                      >
                        {busyAction === `retry:${note.id}` ? "재시도 중" : "다시 시도"}
                      </button>
                    ) : null}
                    {note.source === "server" && note.server && buildingId
                      && currentUser.role === "admin" ? (
                        <button
                          type="button"
                          className="field-owner-notes-secondary"
                          disabled={disabled || Boolean(busyAction)}
                          onClick={() => void handleArchive(note.server as OwnerNote)}
                        >
                          {archiveInFlight ? "보관 중" : "메모 보관"}
                        </button>
                      ) : null}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="field-owner-notes-empty">첫 전달사항을 기록해 주세요.</p>
          )}

          {buildingId ? (
            <button
              type="button"
              className="field-owner-notes-show-all"
              disabled={disabled || Boolean(busyAction)}
              onClick={() => setShowAllForBuilding((current) => (
                current === buildingId ? null : buildingId
              ))}
            >
              {showingAll ? "최근 메모만 보기" : "전체 메모 보기"}
            </button>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
