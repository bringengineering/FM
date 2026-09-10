"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";

import {
  analyzeAdPackageReadiness,
  buildAdPackagePreview,
  type AdPackageReviewCandidate,
  type AdPackageReviewWorkspacePage,
  type AdReviewMedia,
} from "../lib/ad-package";
import {
  createAdPackage,
  excludeFieldMedia,
  getFieldMediaAccess,
  loadAdReviewWorkspace,
  type CreateAdPackageInput,
  type CreateAdPackageResult,
  type ExcludeFieldMediaInput,
  type ExcludeFieldMediaResult,
  type FieldMediaAccessResult,
  type LoadAdReviewWorkspaceInput,
} from "../lib/field-api.client";
import { useFieldSession } from "./FieldSessionContext";

type MediaPreviewState =
  | { status: "loading" }
  | { status: "ready"; url: string; expiresAt: string }
  | { status: "error" };

type PageLoadState = "idle" | "loading" | "error";

type AdPackageReviewProps = {
  load?: (input: LoadAdReviewWorkspaceInput) => Promise<AdPackageReviewWorkspacePage>;
  create?: (input: CreateAdPackageInput) => Promise<CreateAdPackageResult>;
  exclude?: (input: ExcludeFieldMediaInput) => Promise<ExcludeFieldMediaResult>;
  mediaAccess?: (mediaId: string) => Promise<FieldMediaAccessResult>;
  confirmExclude?: (message: string) => boolean;
  createId?: () => string;
};

function previewKey(mediaId: string, preview?: MediaPreviewState): string {
  return preview?.status === "ready"
    ? `${mediaId}:${preview.url}`
    : `${mediaId}:${preview?.status ?? "loading"}`;
}

function unitDisplayLabel(value: string): string {
  return value.endsWith("호") ? value : `${value}호`;
}

function initialSelection(candidate: AdPackageReviewCandidate) {
  const approvedMediaIds = candidate.media
    .filter((item) => item.advertisingApproved)
    .map((item) => item.id);
  const approved = new Set(approvedMediaIds);
  const latestRepresentatives = candidate.packages[0]?.representativeMediaIds
    .filter((id) => approved.has(id)) ?? [];
  const orderedPhotos = candidate.media
    .filter((item) => approved.has(item.id) && item.kind === "photo"
      && item.advertisingOrder !== undefined)
    .sort((left, right) => (left.advertisingOrder ?? 0) - (right.advertisingOrder ?? 0))
    .map((item) => item.id);
  return {
    approvedMediaIds,
    representativeMediaIds: latestRepresentatives.length
      ? latestRepresentatives
      : orderedPhotos,
  };
}

function MoveIcon({ direction }: { direction: "up" | "down" }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={direction === "up" ? "m6 14 6-6 6 6" : "m6 10 6 6 6-6"} />
    </svg>
  );
}

function PaginationControls({
  nextCursor,
  state,
  disabled,
  onLoadMore,
}: {
  nextCursor?: string;
  state: PageLoadState;
  disabled: boolean;
  onLoadMore: () => void;
}) {
  if (!nextCursor) return null;
  return (
    <div className="field-ad-pagination" aria-live="polite">
      {state === "error" ? (
        <p role="alert">후보를 더 불러오지 못했습니다. 다시 시도해 주세요.</p>
      ) : null}
      <button
        type="button"
        disabled={disabled || state === "loading"}
        onClick={onLoadMore}
      >
        {state === "loading" ? "불러오는 중" : state === "error" ? "다시 시도" : "더 보기"}
      </button>
    </div>
  );
}

function MediaPreview({
  media,
  preview,
  onRetry,
}: {
  media: AdReviewMedia;
  preview?: MediaPreviewState;
  onRetry: () => void;
}) {
  const [renderFailed, setRenderFailed] = useState(false);

  if (!preview || preview.status === "loading") {
    return <div className="field-ad-media-placeholder" aria-label={`${media.id} 미리보기 로딩 중`}>미리보기 불러오는 중</div>;
  }
  if (preview.status === "error" || renderFailed) {
    return (
      <div className="field-ad-media-placeholder" role="alert">
        <span>미리보기를 불러오지 못했습니다.</span>
        <button type="button" onClick={onRetry}>다시 시도</button>
      </div>
    );
  }
  if (media.kind === "video") {
    return (
      <video controls preload="metadata" src={preview.url} onError={() => setRenderFailed(true)}>
        영상 미리보기를 지원하지 않는 브라우저입니다.
      </video>
    );
  }
  return (
    <Image
      src={preview.url}
      alt={`${media.zone} 촬영본 ${media.id}`}
      width={640}
      height={480}
      unoptimized
      loading="lazy"
      onError={() => setRenderFailed(true)}
    />
  );
}

export default function AdPackageReview({
  load = loadAdReviewWorkspace,
  create = createAdPackage,
  exclude = excludeFieldMedia,
  mediaAccess = getFieldMediaAccess,
  confirmExclude = (message) => window.confirm(message),
  createId = () => crypto.randomUUID(),
}: AdPackageReviewProps) {
  const session = useFieldSession();
  const canReview = session.role === "admin" || session.role === "reviewer";
  const [loadResult, setLoadResult] = useState<
    ({ status: "ready" } & AdPackageReviewWorkspacePage) | { status: "error" } | null
  >(null);
  const [pageLoadState, setPageLoadState] = useState<PageLoadState>("idle");
  const [selectedListingId, setSelectedListingId] = useState<string>();
  const [mutationListingId, setMutationListingId] = useState<string>();
  const loadRequest = useRef(0);
  const pageRequest = useRef(0);
  const pageLoadBusy = useRef(false);

  useEffect(() => {
    if (!canReview) return;
    const request = ++loadRequest.current;
    pageRequest.current += 1;
    pageLoadBusy.current = false;
    let cancelled = false;
    void load({}).then((page) => {
      if (!cancelled && request === loadRequest.current) {
        setLoadResult({ status: "ready", ...page });
        setPageLoadState("idle");
      }
    }).catch(() => {
      if (!cancelled && request === loadRequest.current) setLoadResult({ status: "error" });
    });
    return () => {
      cancelled = true;
      pageRequest.current += 1;
      pageLoadBusy.current = false;
    };
  }, [canReview, load]);

  if (!canReview) {
    return (
      <section className="field-ad-review field-ad-permission">
        <p className="field-eyebrow">AD PACKAGES</p>
        <h1>광고 패키지 검토 권한이 필요합니다</h1>
        <p>광고 후보와 임대 조건은 검수 담당자와 관리자만 확인할 수 있습니다. 권한이 필요하면 관리자에게 요청해 주세요.</p>
      </section>
    );
  }

  if (!loadResult) {
    return (
      <section className="field-ad-review" aria-live="polite">
        <p className="field-eyebrow">AD PACKAGES</p>
        <h1>광고 후보 불러오는 중</h1>
        <p>검토 가능한 매물과 촬영본을 불러오고 있습니다.</p>
      </section>
    );
  }

  if (loadResult.status === "error") {
    return (
      <section className="field-ad-review" role="alert">
        <p className="field-eyebrow">AD PACKAGES</p>
        <h1>광고 후보를 불러오지 못했습니다</h1>
        <p>네트워크 연결을 확인한 뒤 패키지 메뉴를 다시 열어 주세요.</p>
      </section>
    );
  }

  const candidates = loadResult.candidates;
  const candidate = candidates.find((item) => item.listing.id === selectedListingId)
    ?? candidates[0];

  async function handleLoadMore() {
    const cursor = loadResult?.status === "ready" ? loadResult.nextCursor : undefined;
    if (!cursor || pageLoadBusy.current || mutationListingId !== undefined) return;
    pageLoadBusy.current = true;
    const request = ++pageRequest.current;
    const initialRequest = loadRequest.current;
    setPageLoadState("loading");
    try {
      const page = await load({ cursor });
      if (request !== pageRequest.current || initialRequest !== loadRequest.current) return;
      setLoadResult((current) => {
        if (!current || current.status !== "ready" || current.nextCursor !== cursor) return current;
        const existingIds = new Set(current.candidates.map((item) => item.listing.id));
        const appended = page.candidates.filter((item) => {
          if (existingIds.has(item.listing.id)) return false;
          existingIds.add(item.listing.id);
          return true;
        });
        return {
          status: "ready",
          candidates: [...current.candidates, ...appended],
          ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
        };
      });
      setPageLoadState("idle");
    } catch {
      if (request === pageRequest.current && initialRequest === loadRequest.current) {
        setPageLoadState("error");
      }
    } finally {
      if (request === pageRequest.current) pageLoadBusy.current = false;
    }
  }

  if (!candidate) {
    return (
      <section className="field-ad-review">
        <p className="field-eyebrow">AD PACKAGES</p>
        <h1>광고 패키지 검토</h1>
        <p>현재 검토할 수 있는 광고 후보가 없습니다.</p>
        <PaginationControls
          nextCursor={loadResult.nextCursor}
          state={pageLoadState}
          disabled={mutationListingId !== undefined}
          onLoadMore={() => void handleLoadMore()}
        />
      </section>
    );
  }

  return (
    <section className="field-ad-review">
      <header className="field-ad-review-header">
        <div>
          <p className="field-eyebrow">AD PACKAGES</p>
          <h1>광고 패키지 검토</h1>
          <p>완료된 촬영본을 확인하고 대표사진 순서와 광고 문구를 확정합니다.</p>
        </div>
        <strong>{candidates.length}개 후보</strong>
      </header>

      {candidates.length > 1 ? (
        <nav className="field-ad-candidates" aria-label="광고 후보 선택">
          {candidates.map((item) => (
            <button
              type="button"
              key={item.listing.id}
              aria-current={item.listing.id === candidate.listing.id ? "page" : undefined}
              disabled={mutationListingId !== undefined}
              onClick={() => setSelectedListingId(item.listing.id)}
            >
              <strong>{item.building.name}</strong>
              <span>{unitDisplayLabel(item.unit.unitLabel)}</span>
            </button>
          ))}
        </nav>
      ) : null}

      <PaginationControls
        nextCursor={loadResult.nextCursor}
        state={pageLoadState}
        disabled={mutationListingId !== undefined}
        onLoadMore={() => void handleLoadMore()}
      />

      <CandidateReview
        key={candidate.listing.id}
        candidate={candidate}
        create={create}
        exclude={exclude}
        mediaAccess={mediaAccess}
        confirmExclude={confirmExclude}
        createId={createId}
        onExcluded={(listingId, mediaId) => setLoadResult((current) => {
          if (!current || current.status !== "ready") return current;
          return {
            ...current,
            candidates: current.candidates.map((item) => item.listing.id === listingId
              ? { ...item, media: item.media.filter((entry) => entry.id !== mediaId) }
              : item),
          };
        })}
        onMutationStart={() => setMutationListingId(candidate.listing.id)}
        onMutationEnd={() => setMutationListingId((current) => (
          current === candidate.listing.id ? undefined : current
        ))}
      />
    </section>
  );
}

function CandidateReview({
  candidate,
  create,
  exclude,
  mediaAccess,
  confirmExclude,
  createId,
  onExcluded,
  onMutationStart,
  onMutationEnd,
}: Required<Pick<AdPackageReviewProps, "create" | "exclude" | "mediaAccess" | "confirmExclude" | "createId">> & {
  candidate: AdPackageReviewCandidate;
  onExcluded: (listingId: string, mediaId: string) => void;
  onMutationStart: () => void;
  onMutationEnd: () => void;
}) {
  const selection = useMemo(() => initialSelection(candidate), [candidate]);
  const [media, setMedia] = useState(candidate.media);
  const [approvedMediaIds, setApprovedMediaIds] = useState(selection.approvedMediaIds);
  const [representativeMediaIds, setRepresentativeMediaIds] = useState(selection.representativeMediaIds);
  const [previews, setPreviews] = useState<Record<string, MediaPreviewState>>(() => Object.fromEntries(
    candidate.media.map((item) => [item.id, { status: "loading" }]),
  ));
  const [excludeBusyId, setExcludeBusyId] = useState<string>();
  const [submitState, setSubmitState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState<string>();
  const previewRequests = useRef<Record<string, number>>({});
  const submissionRequest = useRef(0);
  const reviewCandidate = useMemo(() => ({ ...candidate, media }), [candidate, media]);
  const mediaIds = useMemo(() => media.map((item) => item.id), [media]);

  useEffect(() => {
    let cancelled = false;
    for (const mediaId of mediaIds) {
      const request = (previewRequests.current[mediaId] ?? 0) + 1;
      previewRequests.current[mediaId] = request;
      void mediaAccess(mediaId).then(({ url, expiresAt }) => {
        if (!cancelled && previewRequests.current[mediaId] === request) {
          setPreviews((current) => ({
            ...current,
            [mediaId]: { status: "ready", url, expiresAt },
          }));
        }
      }).catch(() => {
        if (!cancelled && previewRequests.current[mediaId] === request) {
          setPreviews((current) => ({ ...current, [mediaId]: { status: "error" } }));
        }
      });
    }
    return () => { cancelled = true; };
  }, [mediaAccess, mediaIds]);

  const requestPreview = useCallback((mediaId: string) => {
    const request = (previewRequests.current[mediaId] ?? 0) + 1;
    previewRequests.current[mediaId] = request;
    setPreviews((current) => ({ ...current, [mediaId]: { status: "loading" } }));
    void mediaAccess(mediaId).then(({ url, expiresAt }) => {
      if (previewRequests.current[mediaId] === request) {
        setPreviews((current) => ({
          ...current,
          [mediaId]: { status: "ready", url, expiresAt },
        }));
      }
    }).catch(() => {
      if (previewRequests.current[mediaId] === request) {
        setPreviews((current) => ({ ...current, [mediaId]: { status: "error" } }));
      }
    });
  }, [mediaAccess]);

  useEffect(() => {
    const ready = Object.entries(previews).filter(
      (entry): entry is [string, Extract<MediaPreviewState, { status: "ready" }>] => (
        entry[1].status === "ready"
      ),
    );
    if (ready.length === 0) return;
    const refreshAt = Math.min(...ready.map(([, item]) => (
      Date.parse(item.expiresAt) - 60_000
    )));
    const timer = window.setTimeout(() => {
      const threshold = Date.now() + 60_000;
      ready
        .filter(([, item]) => Date.parse(item.expiresAt) <= threshold)
        .forEach(([mediaId]) => requestPreview(mediaId));
    }, Math.max(1_000, refreshAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [previews, requestPreview]);

  const approved = new Set(approvedMediaIds);
  const representatives = new Set(representativeMediaIds);
  const readiness = analyzeAdPackageReadiness(reviewCandidate, approvedMediaIds, representativeMediaIds);
  const preview = buildAdPackagePreview(reviewCandidate, approvedMediaIds, representativeMediaIds);

  function resetSubmissionMessage() {
    setSubmitState("idle");
    setMessage(undefined);
  }

  function toggleApproved(item: AdReviewMedia) {
    if (approved.has(item.id)) {
      setApprovedMediaIds((items) => items.filter((id) => id !== item.id));
      setRepresentativeMediaIds((items) => items.filter((id) => id !== item.id));
    } else {
      setApprovedMediaIds((items) => [...items, item.id]);
    }
    resetSubmissionMessage();
  }

  function toggleRepresentative(mediaId: string) {
    if (!approved.has(mediaId)) return;
    setRepresentativeMediaIds((items) => items.includes(mediaId)
      ? items.filter((id) => id !== mediaId)
      : [...items, mediaId]);
    resetSubmissionMessage();
  }

  function moveRepresentative(mediaId: string, offset: -1 | 1) {
    setRepresentativeMediaIds((items) => {
      const index = items.indexOf(mediaId);
      const target = index + offset;
      if (index < 0 || target < 0 || target >= items.length) return items;
      const next = [...items];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    resetSubmissionMessage();
  }

  async function handleExclude(item: AdReviewMedia) {
    if (excludeBusyId || !confirmExclude(`${item.id} 촬영본을 광고 검토에서 제외할까요? 원본은 삭제되지 않습니다.`)) return;
    setExcludeBusyId(item.id);
    setMessage(undefined);
    try {
      await exclude({ mediaId: item.id, requestId: createId() });
      previewRequests.current[item.id] = (previewRequests.current[item.id] ?? 0) + 1;
      setMedia((items) => items.filter((entry) => entry.id !== item.id));
      setPreviews((items) => Object.fromEntries(
        Object.entries(items).filter(([mediaId]) => mediaId !== item.id),
      ));
      setApprovedMediaIds((items) => items.filter((id) => id !== item.id));
      setRepresentativeMediaIds((items) => items.filter((id) => id !== item.id));
      onExcluded(candidate.listing.id, item.id);
    } catch {
      setMessage("촬영본을 제외하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setExcludeBusyId(undefined);
    }
  }

  async function handleCreate() {
    if (!readiness.ready || submitState === "loading") return;
    const request = ++submissionRequest.current;
    setSubmitState("loading");
    setMessage(undefined);
    onMutationStart();
    try {
      const result = await create({
        requestId: createId(),
        listingId: candidate.listing.id,
        approvedMediaIds: [...approvedMediaIds],
        representativeMediaIds: [...representativeMediaIds],
      });
      if (request !== submissionRequest.current || result.listingId !== candidate.listing.id) return;
      setSubmitState("success");
      setMessage(`${result.version}버전 생성 요청 완료`);
    } catch {
      if (request !== submissionRequest.current) return;
      setSubmitState("error");
      setMessage("광고 패키지를 생성하지 못했습니다. 선택 항목을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      if (request === submissionRequest.current) onMutationEnd();
    }
  }

  return (
    <>

      <div className="field-ad-title-card">
        <div>
          <span>{candidate.listing.status}</span>
          <h2>{candidate.building.name} · {unitDisplayLabel(candidate.unit.unitLabel)}</h2>
          <p>{candidate.building.roadAddress}</p>
        </div>
        <small>최근 패키지 {candidate.packages[0] ? `${candidate.packages[0].version}버전` : "없음"}</small>
      </div>

      <section className="field-ad-section" aria-labelledby="field-ad-media-title">
        <div className="field-ad-section-heading">
          <div>
            <p className="field-eyebrow">FINALIZED MEDIA</p>
            <h2 id="field-ad-media-title">광고 포함 촬영본</h2>
          </div>
          <span>{approvedMediaIds.length}/{media.length}개 선택</span>
        </div>
        <div className="field-ad-media-grid">
          {media.map((item) => (
            <article className="field-ad-media-card" key={item.id}>
              <MediaPreview
                key={previewKey(item.id, previews[item.id])}
                media={item}
                preview={previews[item.id]}
                onRetry={() => requestPreview(item.id)}
              />
              <div className="field-ad-media-meta">
                <strong>{item.zone}</strong>
                <span>{item.id}</span>
                {item.zone === "verticalVideo" && item.captureQualityState !== "valid"
                  ? <em>세로영상 검증 필요</em>
                  : null}
              </div>
              <label className="field-ad-check">
                <input
                  type="checkbox"
                  checked={approved.has(item.id)}
                  onChange={() => toggleApproved(item)}
                  aria-label={`광고 포함 ${item.id}`}
                />
                <span>광고에 포함</span>
              </label>
              <div className="field-ad-media-actions">
                {item.kind === "photo" ? (
                  <button
                    type="button"
                    disabled={!approved.has(item.id)}
                    aria-pressed={representatives.has(item.id)}
                    onClick={() => toggleRepresentative(item.id)}
                  >
                    {representatives.has(item.id) ? "대표사진 해제" : "대표사진 선택"}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={excludeBusyId === item.id}
                  onClick={() => void handleExclude(item)}
                  aria-label={`${item.id} 제외`}
                >
                  {excludeBusyId === item.id ? "제외 중" : "제외"}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="field-ad-section" aria-labelledby="field-ad-order-title">
        <div className="field-ad-section-heading">
          <div>
            <p className="field-eyebrow">REPRESENTATIVE ORDER</p>
            <h2 id="field-ad-order-title">대표사진 순서</h2>
          </div>
          <span>버튼으로 순서 이동</span>
        </div>
        <ol className="field-ad-order-list" aria-label="대표사진 순서">
          {representativeMediaIds.map((mediaId, index) => (
            <li key={mediaId}>
              <span>{index + 1}</span>
              <strong>{mediaId}</strong>
              <div>
                <button
                  type="button"
                  disabled={index === 0}
                  aria-label={`${mediaId} 위로 이동`}
                  onClick={() => moveRepresentative(mediaId, -1)}
                >
                  <MoveIcon direction="up" />
                </button>
                <button
                  type="button"
                  disabled={index === representativeMediaIds.length - 1}
                  aria-label={`${mediaId} 아래로 이동`}
                  onClick={() => moveRepresentative(mediaId, 1)}
                >
                  <MoveIcon direction="down" />
                </button>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div className="field-ad-preview-grid">
        <section className="field-ad-copy-preview" role="region" aria-label="당근 설명 미리보기">
          <p className="field-eyebrow">DAANGN PREVIEW</p>
          <h2>당근 설명</h2>
          <pre>{preview.daangnDescription}</pre>
        </section>
        <section className="field-ad-copy-preview" role="region" aria-label="네이버 입력정보 미리보기">
          <p className="field-eyebrow">NAVER PREVIEW</p>
          <h2>네이버 입력정보</h2>
          <dl>
            {preview.naverFields.map((field) => (
              <div key={field.label}>
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      <section className="field-ad-submit">
        {!readiness.ready ? (
          <ul aria-label="생성할 수 없는 이유">
            {readiness.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        ) : <p>필수 검토가 완료되었습니다.</p>}
        <button
          type="button"
          disabled={!readiness.ready || submitState === "loading"}
          onClick={() => void handleCreate()}
        >
          {submitState === "loading" ? "생성 요청 중" : "광고 패키지 생성"}
        </button>
        {message ? (
          <p role={submitState === "success" ? "status" : "alert"}>{message}</p>
        ) : null}
      </section>
    </>
  );
}
