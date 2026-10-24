"use client";

type FieldStatusStateProps = {
  status: "loading" | "empty" | "error" | "security" | "offline";
  onRetry?: () => void;
  compact?: boolean;
};

const COPY = {
  loading: {
    title: "현장 업무를 불러오고 있습니다",
    body: "서버에서 최신 배정과 현황을 확인하고 있습니다.",
  },
  empty: {
    title: "표시할 현장 업무가 없습니다",
    body: "현재 조건에 맞는 업무가 없습니다. 다른 현황 카드를 선택해 보세요.",
  },
  error: {
    title: "현황을 불러오지 못했습니다",
    body: "집계 확인 필요 · 연결 상태를 확인한 뒤 다시 시도해 주세요.",
  },
  security: {
    title: "현장 업무 연결 확인 필요",
    body: "보안 연결을 확인하지 못했습니다. 관리자 설정과 네트워크를 확인한 뒤 다시 시도해 주세요.",
  },
  offline: {
    title: "현재 오프라인입니다",
    body: "새 현황은 연결 후 확인할 수 있습니다. 기기에 보관된 촬영 원본은 삭제되지 않습니다.",
  },
} as const;

export default function FieldStatusState({
  status,
  onRetry,
  compact = false,
}: FieldStatusStateProps) {
  const copy = COPY[status];
  const blocking = status === "error" || status === "security" || status === "offline";
  return (
    <section
      className={`field-v2-status field-v2-status-${status}${compact ? " compact" : ""}`}
      role={blocking ? "alert" : "status"}
      aria-live={blocking ? "assertive" : "polite"}
      aria-busy={status === "loading" ? "true" : undefined}
    >
      <span className="field-v2-status-mark" aria-hidden="true" />
      <div>
        <h1>{copy.title}</h1>
        <p>{copy.body}</p>
      </div>
      {onRetry && blocking ? (
        <button className="field-v2-action" type="button" onClick={onRetry}>
          다시 시도
        </button>
      ) : null}
    </section>
  );
}
