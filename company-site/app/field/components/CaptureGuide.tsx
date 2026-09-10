"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type SyntheticEvent,
} from "react";

import {
  CAPTURE_ZONES,
  describeCaptureFile,
  evaluateVerticalVideo,
  type CaptureZoneDefinition,
} from "../lib/capture-policy";
import {
  ensureCaptureCapacity,
  openOfflineQueue,
  requestPersistentCaptureStorage,
  type OfflineQueuePort,
  type QueuedMediaRecord,
} from "../lib/offline-queue";
import type {
  CaptureAttachmentDescriptor,
  MediaZone,
} from "../lib/types";
import { useFieldSession } from "./FieldSessionContext";

export type CaptureContext =
  | {
      mode: "draft";
      draftId: string;
      captureSessionId: string;
      unitLocalId: string;
    }
  | {
      mode: "visit";
      captureSessionId: string;
      buildingId: string;
      unitId?: string;
      listingId?: string;
      visitId: string;
    };

export interface CaptureUploadCoordinator {
  resume(uid: string): Promise<void>;
  retry(uid: string, mediaId: string): Promise<void>;
  exclude?(
    uid: string,
    mediaId: string,
    requestServerExclusion?: boolean,
  ): Promise<void>;
}

export interface CaptureGuideProps {
  context: CaptureContext;
  queue?: OfflineQueuePort;
  coordinator?: CaptureUploadCoordinator;
  onDescriptorsChange?: (
    descriptors: CaptureAttachmentDescriptor[],
  ) => void;
  getFieldMediaAccess?: (
    mediaId: string,
  ) => Promise<{ url: string; expiresAt: string }>;
  excludeFieldMedia?: (input: {
    mediaId: string;
    requestId: string;
  }) => Promise<void>;
}

type EnqueueInput = Parameters<OfflineQueuePort["enqueue"]>[0];

interface PendingVideo {
  enqueueInput: EnqueueInput;
  fileInput: HTMLInputElement;
  previewUrl: string;
  scopeKey: string;
  replaces?: QueuedMediaRecord;
}

interface SignedPreview {
  url: string;
  expiresAt: string;
}

const EXCLUDED_MARKER = "capture_excluded";
const VIDEO_METADATA_TIMEOUT_MS = 5_000;
const ACCESS_REFRESH_EARLY_MS = 30_000;

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

function captureBinding(context: CaptureContext): EnqueueInput["binding"] {
  if (context.mode === "draft") {
    return {
      draftId: context.draftId,
      unitLocalId: context.unitLocalId,
    };
  }
  return {
    buildingId: context.buildingId,
    ...(context.unitId === undefined ? {} : { unitId: context.unitId }),
    ...(context.listingId === undefined
      ? {}
      : { listingId: context.listingId }),
    visitId: context.visitId,
  };
}

function isExcluded(record: QueuedMediaRecord): boolean {
  return record.lastError === EXCLUDED_MARKER
    || record.descriptor.failureCode === EXCLUDED_MARKER;
}

function canDecodePhoto(descriptor: CaptureAttachmentDescriptor): boolean {
  return descriptor.kind === "photo"
    && descriptor.mimeType !== "image/heic"
    && descriptor.mimeType !== "image/heif";
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "용량 확인 불가";
  if (value < 1_024) return `${value} B`;
  if (value < 1_024 * 1_024) return `${(value / 1_024).toFixed(1)} KB`;
  return `${(value / (1_024 * 1_024)).toFixed(1)} MB`;
}

function uploadStatus(record: QueuedMediaRecord): string {
  if (record.driveSyncState === "complete") return "Drive 동기화 완료";
  switch (record.descriptor.uploadState) {
    case "queued":
      return "Drive 업로드 대기";
    case "uploading":
      return `Drive 업로드 중 ${Math.round(record.descriptor.uploadProgress)}%`;
    case "objectStored":
    case "finalizing":
      return "Drive 등록 중";
    case "finalized":
      return "Drive 등록 완료";
    case "failed":
      return "업로드 실패 · 다시 시도해 주세요";
  }
}

function errorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "capture_unknown";
  if (code === "capture_storage_quota") {
    return "기기 저장 공간이 부족합니다. 불필요한 파일을 정리한 뒤 다시 촬영해 주세요.";
  }
  if (code === "capture_file_too_large") {
    return "파일 용량이 너무 큽니다. 더 짧게 촬영한 뒤 다시 시도해 주세요.";
  }
  if (code === "capture_mime_not_allowed") {
    return "지원하지 않는 파일 형식입니다. 기본 카메라 형식으로 다시 촬영해 주세요.";
  }
  if (code === "capture_exclude_unavailable") {
    return "Drive 저장 사진을 제외할 수 없습니다. 연결을 확인한 뒤 다시 시도해 주세요.";
  }
  if (code === "drive_connection_required" || code === "drive_authorization_required") {
    return "화면 위의 ‘Google Drive 연결’을 먼저 눌러 회사 계정으로 연결해 주세요.";
  }
  if (code === "drive_root_access_denied") {
    return "BRING Drive 폴더 편집 권한이 없습니다. 회사 계정과 폴더 권한을 확인해 주세요.";
  }
  if (code === "drive_temporarily_unavailable") {
    return "Google Drive 연결이 일시적으로 불안정합니다. 잠시 뒤 다시 시도해 주세요.";
  }
  return "촬영 파일을 저장하지 못했습니다. 다시 시도해 주세요.";
}

function validVideoMetadata(video: HTMLVideoElement):
  CaptureAttachmentDescriptor["videoMetadata"] | undefined {
  const durationSeconds = video.duration;
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (
    !Number.isFinite(durationSeconds)
    || !Number.isFinite(width)
    || !Number.isFinite(height)
    || durationSeconds < 0
    || width <= 0
    || height <= 0
  ) {
    return undefined;
  }
  return { durationSeconds, width, height };
}

export default function CaptureGuide({
  context,
  queue: suppliedQueue,
  coordinator,
  onDescriptorsChange,
  getFieldMediaAccess,
  excludeFieldMedia,
}: CaptureGuideProps) {
  const session = useFieldSession();
  const [ownedQueue, setOwnedQueue] = useState<OfflineQueuePort | null>(null);
  const activeQueue = suppliedQueue ?? ownedQueue;
  const [records, setRecords] = useState<QueuedMediaRecord[]>([]);
  const [pendingVideo, setPendingVideo] = useState<PendingVideo | null>(null);
  const [message, setMessage] = useState("");
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const [busyMediaIds, setBusyMediaIds] = useState<Set<string>>(() => new Set());
  const [previewSources, setPreviewSources] = useState<Record<string, string>>({});
  const localPreviewUrls = useRef(new Map<string, string>());
  const signedPreviews = useRef(new Map<string, SignedPreview>());
  const signedTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const inputRefs = useRef(new Map<MediaZone, HTMLInputElement>());
  const galleryInputRefs = useRef(new Map<MediaZone, HTMLInputElement>());
  const replacementRef = useRef<QueuedMediaRecord | null>(null);
  const pendingVideoRef = useRef<PendingVideo | null>(null);
  const pendingVideoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metadataUpdates = useRef(new Set<string>());
  const scopeKey = `${session.uid}\u0000${context.captureSessionId}`;
  const activeScope = useRef(scopeKey);

  useEffect(() => {
    if (suppliedQueue) return undefined;
    let cancelled = false;
    let opened: OfflineQueuePort | null = null;
    void openOfflineQueue()
      .then((queue) => {
        if (cancelled) {
          queue.close();
          return;
        }
        opened = queue;
        setOwnedQueue(queue);
      })
      .catch(() => {
        if (!cancelled) setError("촬영 저장소를 열지 못했습니다. 페이지를 새로고침해 주세요.");
      });
    return () => {
      cancelled = true;
      opened?.close();
      setOwnedQueue(null);
    };
  }, [suppliedQueue]);

  const revokeLocalPreview = useCallback((mediaId: string) => {
    const url = localPreviewUrls.current.get(mediaId);
    if (!url) return;
    URL.revokeObjectURL(url);
    localPreviewUrls.current.delete(mediaId);
  }, []);

  const clearTransientPreviews = useCallback(() => {
    for (const mediaId of [...localPreviewUrls.current.keys()]) {
      revokeLocalPreview(mediaId);
    }
    for (const timer of signedTimers.current.values()) clearTimeout(timer);
    signedTimers.current.clear();
    signedPreviews.current.clear();
    const pending = pendingVideoRef.current;
    if (pending) URL.revokeObjectURL(pending.previewUrl);
    pendingVideoRef.current = null;
    if (pendingVideoTimer.current) clearTimeout(pendingVideoTimer.current);
    pendingVideoTimer.current = null;
  }, [revokeLocalPreview]);

  const refreshPreviewSources = useCallback(() => {
    const next: Record<string, string> = {};
    for (const [mediaId, preview] of signedPreviews.current) {
      next[mediaId] = preview.url;
    }
    for (const [mediaId, url] of localPreviewUrls.current) {
      next[mediaId] = url;
    }
    setPreviewSources(next);
  }, []);

  const schedulePreviewSourcesRefresh = useCallback(() => {
    void Promise.resolve().then(refreshPreviewSources);
  }, [refreshPreviewSources]);

  const loadRecords = useCallback(async () => {
    if (!activeQueue) return;
    const requestedScope = `${session.uid}\u0000${context.captureSessionId}`;
    const loaded = await activeQueue.list(
      session.uid,
      context.captureSessionId,
    );
    if (activeScope.current !== requestedScope) return;
    setRecords(loaded.filter((record) => (
      record.uid === session.uid
      && record.captureSessionId === context.captureSessionId
      && !isExcluded(record)
    )));
  }, [activeQueue, context.captureSessionId, session.uid]);

  useEffect(() => {
    activeScope.current = scopeKey;
    clearTransientPreviews();
    replacementRef.current = null;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled || activeScope.current !== scopeKey) return;
      refreshPreviewSources();
      setRecords([]);
      setPendingVideo(null);
      setMessage("");
      setWarning("");
      setError("");
      setBusyMediaIds(new Set());
      void loadRecords().catch(() => {
        if (activeScope.current === scopeKey) {
          setError("촬영 목록을 불러오지 못했습니다. 다시 시도해 주세요.");
        }
      });
    });
    return () => {
      cancelled = true;
      if (activeScope.current === scopeKey) activeScope.current = "";
      clearTransientPreviews();
    };
  }, [clearTransientPreviews, loadRecords, refreshPreviewSources, scopeKey]);

  useEffect(() => {
    const desired = new Set<string>();
    for (const record of records) {
      if (
        record.blob
        && (record.descriptor.kind === "video" || canDecodePhoto(record.descriptor))
      ) {
        desired.add(record.mediaId);
        if (!localPreviewUrls.current.has(record.mediaId)) {
          localPreviewUrls.current.set(
            record.mediaId,
            URL.createObjectURL(record.blob),
          );
        }
      }
    }
    for (const mediaId of [...localPreviewUrls.current.keys()]) {
      if (!desired.has(mediaId)) {
        revokeLocalPreview(mediaId);
      }
    }
    schedulePreviewSourcesRefresh();
  }, [records, revokeLocalPreview, schedulePreviewSourcesRefresh]);

  useEffect(() => {
    const timers = signedTimers.current;
    const desired = new Set(records.filter((record) => (
      record.descriptor.uploadState === "finalized"
      && !record.blob
    )).map((record) => record.mediaId));
    for (const [mediaId, timer] of timers) {
      clearTimeout(timer);
      timers.delete(mediaId);
    }
    for (const mediaId of [...signedPreviews.current.keys()]) {
      if (!desired.has(mediaId)) signedPreviews.current.delete(mediaId);
    }
    if (!getFieldMediaAccess) {
      schedulePreviewSourcesRefresh();
      return undefined;
    }

    let cancelled = false;
    const expectedScope = scopeKey;
    const loadAccess = async (mediaId: string): Promise<void> => {
      try {
        const access = await getFieldMediaAccess(mediaId);
        if (
          cancelled
          || activeScope.current !== expectedScope
          || !desired.has(mediaId)
        ) {
          return;
        }
        const expiresAt = Date.parse(access.expiresAt);
        if (!Number.isFinite(expiresAt) || typeof access.url !== "string") return;
        signedPreviews.current.set(mediaId, access);
        refreshPreviewSources();
        const refreshDelay = Math.max(
          1_000,
          expiresAt - Date.now() - ACCESS_REFRESH_EARLY_MS,
        );
        const timer = setTimeout(() => {
          signedPreviews.current.delete(mediaId);
          refreshPreviewSources();
          void loadAccess(mediaId);
        }, refreshDelay);
        timers.set(mediaId, timer);
      } catch {
        if (!cancelled && activeScope.current === expectedScope) {
          setWarning("Drive 미리보기를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
        }
      }
    };

    for (const mediaId of desired) {
      const current = signedPreviews.current.get(mediaId);
      if (!current) {
        void loadAccess(mediaId);
        continue;
      }
      const refreshDelay = Math.max(
        1_000,
        Date.parse(current.expiresAt) - Date.now() - ACCESS_REFRESH_EARLY_MS,
      );
      timers.set(mediaId, setTimeout(() => {
        signedPreviews.current.delete(mediaId);
        refreshPreviewSources();
        void loadAccess(mediaId);
      }, refreshDelay));
    }

    return () => {
      cancelled = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, [
    getFieldMediaAccess,
    records,
    refreshPreviewSources,
    schedulePreviewSourcesRefresh,
    scopeKey,
  ]);

  useEffect(() => {
    onDescriptorsChange?.(records.map((record) => record.descriptor));
  }, [onDescriptorsChange, records]);

  const resumeAfterCommit = useCallback((committedScope: string) => {
    if (!coordinator || activeScope.current !== committedScope) return;
    void coordinator.resume(session.uid)
      .then(() => loadRecords())
      .catch(() => {
        if (activeScope.current === committedScope) {
          setWarning("Drive 업로드를 시작하지 못했습니다. 연결되면 다시 시도합니다.");
        }
      });
  }, [coordinator, loadRecords, session.uid]);

  const markExcluded = useCallback(async (
    record: QueuedMediaRecord,
    committedScope: string,
    requestServerExclusion = true,
  ) => {
    if (!activeQueue) throw new Error("capture_queue_unavailable");
    if (coordinator?.exclude) {
      await coordinator.exclude(
        session.uid,
        record.mediaId,
        requestServerExclusion,
      );
      revokeLocalPreview(record.mediaId);
      if (activeScope.current === committedScope) await loadRecords();
      return;
    }
    if (requestServerExclusion && record.descriptor.uploadState === "finalized") {
      if (!excludeFieldMedia) throw new Error("capture_exclude_unavailable");
      await excludeFieldMedia({
        mediaId: record.mediaId,
        requestId: secureUuidV4(),
      });
    }
    await activeQueue.patch(session.uid, record.mediaId, {
      blob: undefined,
      lastError: EXCLUDED_MARKER,
      descriptor: {
        ...record.descriptor,
        uploadState: "finalized",
        uploadProgress: 100,
        failureCode: EXCLUDED_MARKER,
      },
    });
    revokeLocalPreview(record.mediaId);
    if (activeScope.current === committedScope) await loadRecords();
  }, [
    activeQueue,
    coordinator,
    excludeFieldMedia,
    loadRecords,
    revokeLocalPreview,
    session.uid,
  ]);

  const enqueueCommittedFile = useCallback(async (
    enqueueInput: EnqueueInput,
    committedScope: string,
    input: HTMLInputElement,
    replaces?: QueuedMediaRecord,
  ) => {
    if (!activeQueue) throw new Error("capture_queue_unavailable");
    await activeQueue.enqueue(enqueueInput);
    void requestPersistentCaptureStorage();
    if (activeScope.current !== committedScope) return;
    setMessage("기기에 저장됨 · Drive 업로드 대기");
    // The finalizer excludes the predecessor in the same authorized multi-path
    // commit as the replacement. Hide it locally now, but keep the server copy
    // available if the new upload is interrupted or rejected.
    if (replaces) {
      await markExcluded(
        replaces,
        committedScope,
        enqueueInput.descriptor.replacesMediaId === undefined,
      );
    }
    await loadRecords();
    input.value = "";
    resumeAfterCommit(committedScope);
  }, [activeQueue, loadRecords, markExcluded, resumeAfterCommit]);

  const clearPendingVideo = useCallback((revoke: boolean) => {
    const pending = pendingVideoRef.current;
    if (pendingVideoTimer.current) clearTimeout(pendingVideoTimer.current);
    pendingVideoTimer.current = null;
    pendingVideoRef.current = null;
    if (pending && revoke) URL.revokeObjectURL(pending.previewUrl);
    setPendingVideo(null);
  }, []);

  const commitPendingVideo = useCallback(async (
    mediaId: string,
    metadata: CaptureAttachmentDescriptor["videoMetadata"],
    timedOut: boolean,
  ) => {
    const pending = pendingVideoRef.current;
    if (!pending || pending.enqueueInput.mediaId !== mediaId) return;
    pendingVideoRef.current = null;
    if (pendingVideoTimer.current) clearTimeout(pendingVideoTimer.current);
    pendingVideoTimer.current = null;
    const descriptor = metadata
      ? { ...pending.enqueueInput.descriptor, videoMetadata: metadata }
      : pending.enqueueInput.descriptor;
    try {
      await enqueueCommittedFile(
        { ...pending.enqueueInput, descriptor },
        pending.scopeKey,
        pending.fileInput,
        pending.replaces,
      );
      if (activeScope.current !== pending.scopeKey) {
        URL.revokeObjectURL(pending.previewUrl);
        return;
      }
      localPreviewUrls.current.set(mediaId, pending.previewUrl);
      refreshPreviewSources();
      if (timedOut && activeScope.current === pending.scopeKey) {
        setWarning(
          "영상 정보를 확인하지 못했습니다. 원본은 저장되었으며 Drive 업로드 전에 다시 확인합니다.",
        );
      }
      setPendingVideo(null);
    } catch (caught) {
      URL.revokeObjectURL(pending.previewUrl);
      pending.fileInput.value = "";
      if (activeScope.current === pending.scopeKey) {
        setError(errorMessage(caught));
        setPendingVideo(null);
      }
    }
  }, [enqueueCommittedFile, refreshPreviewSources]);

  const prepareCapture = useCallback(async (
    zone: CaptureZoneDefinition,
    file: File,
    input: HTMLInputElement,
  ) => {
    if (!activeQueue) throw new Error("capture_queue_unavailable");
    await ensureCaptureCapacity(file.size);
    const mediaId = secureUuidV4();
    const descriptor = describeCaptureFile(file, {
      mediaId,
      captureSessionId: context.captureSessionId,
      zone: zone.id,
      slotId: `${zone.id}-${mediaId.slice(0, 8)}`,
      required: zone.required,
    });
    const replaces = replacementRef.current?.descriptor.zone === zone.id
      ? replacementRef.current
      : undefined;
    replacementRef.current = null;
    const replacesFinalizedServerMedia = replaces
      && replaces.descriptor.uploadState === "finalized"
      && Boolean(replaces.storagePath)
      && !replaces.descriptor.failureCode
      && !isExcluded(replaces);
    const nextDescriptor = replacesFinalizedServerMedia
      ? { ...descriptor, replacesMediaId: replaces.mediaId }
      : descriptor;
    return {
      enqueueInput: {
        uid: session.uid,
        mediaId,
        requestId: secureUuidV4(),
        captureSessionId: context.captureSessionId,
        descriptor: nextDescriptor,
        binding: captureBinding(context),
        blob: file,
      } satisfies EnqueueInput,
      input,
      replaces,
      scopeKey,
    };
  }, [activeQueue, context, scopeKey, session.uid]);

  const handlePhoto = useCallback(async (
    zone: CaptureZoneDefinition,
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) {
      replacementRef.current = null;
      return;
    }
    setError("");
    setWarning("");
    try {
      for (const file of files) {
        const prepared = await prepareCapture(zone, file, input);
        await enqueueCommittedFile(
          prepared.enqueueInput,
          prepared.scopeKey,
          input,
          prepared.replaces,
        );
      }
    } catch (caught) {
      input.value = "";
      if (activeScope.current === scopeKey) setError(errorMessage(caught));
    }
  }, [enqueueCommittedFile, prepareCapture, scopeKey]);

  const handleVideo = useCallback(async (
    zone: CaptureZoneDefinition,
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) {
      replacementRef.current = null;
      return;
    }
    setError("");
    setWarning("");
    clearPendingVideo(true);
    try {
      const prepared = await prepareCapture(zone, file, input);
      const pending: PendingVideo = {
        enqueueInput: prepared.enqueueInput,
        fileInput: prepared.input,
        scopeKey: prepared.scopeKey,
        replaces: prepared.replaces,
        previewUrl: URL.createObjectURL(file),
      };
      pendingVideoRef.current = pending;
      setPendingVideo(pending);
      pendingVideoTimer.current = setTimeout(() => {
        void commitPendingVideo(pending.enqueueInput.mediaId, undefined, true);
      }, VIDEO_METADATA_TIMEOUT_MS);
    } catch (caught) {
      input.value = "";
      if (activeScope.current === scopeKey) setError(errorMessage(caught));
    }
  }, [clearPendingVideo, commitPendingVideo, prepareCapture, scopeKey]);

  const handlePendingVideoMetadata = useCallback((
    event: SyntheticEvent<HTMLVideoElement>,
  ) => {
    const pending = pendingVideoRef.current;
    if (!pending) return;
    void commitPendingVideo(
      pending.enqueueInput.mediaId,
      validVideoMetadata(event.currentTarget),
      false,
    );
  }, [commitPendingVideo]);

  const handleStoredVideoMetadata = useCallback(async (
    record: QueuedMediaRecord,
    event: SyntheticEvent<HTMLVideoElement>,
  ) => {
    if (
      record.descriptor.videoMetadata
      || metadataUpdates.current.has(record.mediaId)
      || !activeQueue
    ) {
      return;
    }
    const metadata = validVideoMetadata(event.currentTarget);
    if (!metadata) return;
    metadataUpdates.current.add(record.mediaId);
    try {
      await activeQueue.patch(session.uid, record.mediaId, {
        descriptor: { ...record.descriptor, videoMetadata: metadata },
      });
      await loadRecords();
    } finally {
      metadataUpdates.current.delete(record.mediaId);
    }
  }, [activeQueue, loadRecords, session.uid]);

  const openCamera = useCallback((
    zone: CaptureZoneDefinition,
    replaces?: QueuedMediaRecord,
  ) => {
    replacementRef.current = replaces ?? null;
    inputRefs.current.get(zone.id)?.click();
  }, []);

  const openGallery = useCallback((zone: CaptureZoneDefinition) => {
    replacementRef.current = null;
    galleryInputRefs.current.get(zone.id)?.click();
  }, []);

  const excludeRecord = useCallback(async (record: QueuedMediaRecord) => {
    const operationScope = scopeKey;
    setBusyMediaIds((current) => new Set(current).add(record.mediaId));
    setError("");
    try {
      await markExcluded(record, operationScope);
    } catch (caught) {
      if (activeScope.current === operationScope) setError(errorMessage(caught));
    } finally {
      setBusyMediaIds((current) => {
        const next = new Set(current);
        next.delete(record.mediaId);
        return next;
      });
    }
  }, [markExcluded, scopeKey]);

  const retryRecord = useCallback(async (record: QueuedMediaRecord) => {
    if (!coordinator) return;
    const operationScope = scopeKey;
    setBusyMediaIds((current) => new Set(current).add(record.mediaId));
    setError("");
    try {
      await coordinator.retry(session.uid, record.mediaId);
      if (activeScope.current === operationScope) await loadRecords();
    } catch (caught) {
      if (activeScope.current === operationScope) setError(errorMessage(caught));
    } finally {
      setBusyMediaIds((current) => {
        const next = new Set(current);
        next.delete(record.mediaId);
        return next;
      });
    }
  }, [coordinator, loadRecords, scopeKey, session.uid]);

  const previewSource = (record: QueuedMediaRecord): string | undefined => {
    return previewSources[record.mediaId];
  };

  const hasIncompleteRequiredZone = CAPTURE_ZONES.some((zone) => {
    if (!zone.required) return false;
    const validCount = records.filter((record) => {
      if (record.descriptor.zone !== zone.id) return false;
      if (zone.kind !== "video") return true;
      const metadata = record.descriptor.videoMetadata;
      return metadata ? evaluateVerticalVideo(metadata).countsAsComplete : false;
    }).length;
    return validCount < zone.minimum;
  });

  return (
    <section className="field-capture-guide" aria-label="사진·영상 촬영 안내">
      <header className="field-capture-guide-header">
        <div>
          <p className="field-eyebrow">GUIDED CAPTURE</p>
          <h2>광고용 사진·영상 촬영</h2>
          <p>구역별 안내에 맞춰 촬영하면 기기에 먼저 안전하게 저장됩니다.</p>
        </div>
        <span>촬영본은 기기에 먼저 보관되고 Google Drive로 자동 업로드됩니다.</span>
      </header>

      {message ? <p className="field-upload-state" aria-live="polite">{message}</p> : null}
      {warning ? <p className="field-capture-warning" role="alert">{warning}</p> : null}
      {error ? <p className="field-capture-error" role="alert">{error}</p> : null}
      {hasIncompleteRequiredZone ? (
        <p className="field-capture-requirement">필수 촬영 미완료</p>
      ) : (
        <p className="field-capture-requirement complete">필수 촬영 완료</p>
      )}

      <div className="field-capture-zone-grid">
        {CAPTURE_ZONES.map((zone) => {
          const zoneRecords = records.filter((record) =>
            record.descriptor.zone === zone.id);
          const validCount = zoneRecords.filter((record) => {
            if (zone.kind !== "video") return true;
            const metadata = record.descriptor.videoMetadata;
            return metadata
              ? evaluateVerticalVideo(metadata).countsAsComplete
              : false;
          }).length;
          const incomplete = zone.required && validCount < zone.minimum;
          const pendingForZone = pendingVideo?.enqueueInput.descriptor.zone === zone.id
            ? pendingVideo
            : null;

          return (
            <article
              className="field-capture-zone"
              data-testid="capture-zone"
              data-zone={zone.id}
              key={zone.id}
            >
              <header>
                <div>
                  <h3>{zone.label}</h3>
                  <span className={zone.required ? "required" : "optional"}>
                    {zone.required ? "필수" : "선택"}
                  </span>
                </div>
                <strong data-testid={`capture-count-${zone.id}`}>
                  {validCount} / {zone.minimum}
                </strong>
              </header>
              <p>{zone.guide}</p>
              {incomplete
                ? <em>{zone.minimum - validCount}개 더 촬영 필요</em>
                : <em className="complete">촬영 기준 충족</em>}

              {zone.kind === "photo" ? (
                <>
                  <input
                    ref={(node) => {
                      if (node) inputRefs.current.set(zone.id, node);
                      else inputRefs.current.delete(zone.id);
                    }}
                    className="field-sr-only"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    aria-label={`${zone.label} 사진 촬영`}
                    onChange={(event) => void handlePhoto(zone, event)}
                  />
                  <input
                    ref={(node) => {
                      if (node) galleryInputRefs.current.set(zone.id, node);
                      else galleryInputRefs.current.delete(zone.id);
                    }}
                    className="field-sr-only"
                    type="file"
                    accept="image/*"
                    multiple
                    aria-label={`${zone.label} 사진첩에서 추가`}
                    onChange={(event) => void handlePhoto(zone, event)}
                  />
                </>
              ) : (
                <>
                  <input
                    ref={(node) => {
                      if (node) inputRefs.current.set(zone.id, node);
                      else inputRefs.current.delete(zone.id);
                    }}
                    className="field-sr-only"
                    type="file"
                    accept="video/*"
                    capture="environment"
                    aria-label={`${zone.label} 촬영`}
                    onChange={(event) => void handleVideo(zone, event)}
                  />
                  <input
                    ref={(node) => {
                      if (node) galleryInputRefs.current.set(zone.id, node);
                      else galleryInputRefs.current.delete(zone.id);
                    }}
                    className="field-sr-only"
                    type="file"
                    accept="video/*"
                    aria-label={`${zone.label} 사진첩에서 추가`}
                    onChange={(event) => void handleVideo(zone, event)}
                  />
                </>
              )}
              <div className="field-capture-add-actions">
                <button
                  className="field-capture-camera"
                  type="button"
                  disabled={!activeQueue || Boolean(pendingVideo)}
                  onClick={() => openCamera(zone)}
                >
                  {zone.kind === "photo" ? "카메라로 촬영" : "영상 촬영"}
                </button>
                <button
                  className="field-capture-gallery"
                  type="button"
                  disabled={!activeQueue || Boolean(pendingVideo)}
                  onClick={() => openGallery(zone)}
                >
                  사진첩에서 추가
                </button>
              </div>

              <div className="field-capture-preview-grid">
                {pendingForZone ? (
                  <article className="field-capture-preview">
                    <video
                      aria-label="세로영상 미리보기"
                      controls
                      playsInline
                      preload="metadata"
                      src={pendingForZone.previewUrl}
                      onLoadedMetadata={handlePendingVideoMetadata}
                    />
                    <p>{pendingForZone.enqueueInput.descriptor.originalFileName}</p>
                    <span>영상 정보 확인 중</span>
                  </article>
                ) : null}

                {zoneRecords.map((record) => {
                  const source = previewSource(record);
                  const videoEvaluation = record.descriptor.kind === "video"
                    && record.descriptor.videoMetadata
                    ? evaluateVerticalVideo(record.descriptor.videoMetadata)
                    : null;
                  const busy = busyMediaIds.has(record.mediaId);
                  return (
                    <article className="field-capture-preview" key={record.mediaId}>
                      {record.descriptor.kind === "photo"
                        && canDecodePhoto(record.descriptor)
                        && source ? (
                          // Native object URLs and short-lived signed URLs are not
                          // compatible with Next's build-time image optimization.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={source}
                            alt={`${zone.label} 미리보기`}
                          />
                        ) : null}
                      {record.descriptor.kind === "video" && source ? (
                        <video
                          aria-label="세로영상 미리보기"
                          controls
                          playsInline
                          preload="metadata"
                          src={source}
                          onLoadedMetadata={(event) =>
                            void handleStoredVideoMetadata(record, event)}
                        />
                      ) : null}
                      {!source || (
                        record.descriptor.kind === "photo"
                        && !canDecodePhoto(record.descriptor)
                      ) ? (
                        <div className="field-capture-file-fallback">
                          <strong>{record.descriptor.originalFileName}</strong>
                          <span>{formatBytes(record.descriptor.sizeBytes)}</span>
                        </div>
                      ) : null}
                      <p>{record.descriptor.originalFileName}</p>
                      <span className="field-upload-state">
                        {uploadStatus(record)}
                      </span>
                      {record.descriptor.kind === "video"
                        && !record.descriptor.videoMetadata ? (
                          <small className="field-capture-warning">
                            영상 정보 확인 대기 · Drive 업로드 전에 다시 확인합니다.
                          </small>
                        ) : null}
                      {videoEvaluation?.warnings.map((item) => (
                        <small className="field-capture-warning" key={item}>
                          {item}
                        </small>
                      ))}
                      <div className="field-capture-preview-actions">
                        <button
                          type="button"
                          disabled={busy || Boolean(pendingVideo)}
                          aria-label={`${zone.label} ${zone.kind === "photo" ? "사진" : "영상"} 교체`}
                          onClick={() => openCamera(zone, record)}
                        >
                          교체
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          aria-label={`${zone.label} ${zone.kind === "photo" ? "사진" : "영상"} 제외`}
                          onClick={() => void excludeRecord(record)}
                        >
                          제외
                        </button>
                        {record.descriptor.uploadState === "failed" ? (
                          <button
                            type="button"
                            disabled={busy || !coordinator}
                            aria-label={`${zone.label} 업로드 다시 시도`}
                            onClick={() => void retryRecord(record)}
                          >
                            다시 시도
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
