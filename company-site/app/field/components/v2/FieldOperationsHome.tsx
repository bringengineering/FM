"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  fieldWorkspaceItemCopy,
  fieldWorkspaceItemId,
  isPlainFieldRecord,
  isSafeFieldId,
  type FieldCrmRole,
  type FieldKpis,
  type FieldOperationsWorkspace,
  type FieldWorkspaceItem,
  type FieldWorkspaceScope,
} from "../../lib/v2/contracts";
import {
  mergeFieldWorkspaceItems,
  type FieldDesktopCommand,
  type LoadFieldWorkspaceOptions,
} from "../../lib/v2/field-v2-api.client";
import { normalizeFieldRoute } from "../../lib/v2/desktop-bridge.client";
import FieldStatusState from "./FieldStatusState";

type KpiKey = keyof FieldKpis;

export type LoadFieldOperationsWorkspace = (
  options?: LoadFieldWorkspaceOptions,
) => Promise<FieldOperationsWorkspace>;

export interface FieldOperationsHomeProps {
  role: FieldCrmRole;
  operatorId: string;
  loadWorkspace: LoadFieldOperationsWorkspace;
  onCommand?: (command: FieldDesktopCommand, args: Record<string, unknown>) => Promise<unknown>;
  onNavigateItem?: (item: FieldWorkspaceItem, destination: "execute" | "detail" | "review") => void;
  search?: string;
  initialFilter?: KpiKey | null;
  onSearchChange?: (search: string) => void;
}

export interface FieldOperationsNavigationPayload {
  readonly route: string;
  readonly selectedJobId?: string;
  readonly filter?: unknown;
  readonly scrollTop?: number;
  readonly search?: string;
}

export interface FieldOperationsHomeHandle {
  restoreNavigation(payload: FieldOperationsNavigationPayload): Promise<boolean>;
}

const KPI_DEFINITIONS: readonly {
  key: KpiKey;
  label: string;
  title: string;
  tone: "primary" | "success" | "warning" | "danger";
}[] = [
  { key: "todayVisits", label: "오늘 방문", title: "오늘 방문 업무", tone: "primary" },
  { key: "capturePending", label: "촬영 대기", title: "촬영 대기 업무", tone: "primary" },
  { key: "uploadFailures", label: "업로드 실패", title: "업로드 실패 업무", tone: "danger" },
  { key: "reviewPending", label: "광고 검수 대기", title: "광고 검수 대기 업무", tone: "warning" },
  { key: "unassigned", label: "미배정", title: "미배정 업무", tone: "warning" },
  { key: "overdue", label: "기한 초과", title: "기한 초과 업무", tone: "danger" },
  { key: "adminActionRequired", label: "관리자 조치 필요", title: "관리자 조치 필요 업무", tone: "danger" },
] as const;
const KPI_KEY_SET = new Set<KpiKey>(KPI_DEFINITIONS.map(({ key }) => key));

function navigationKpiFilter(value: unknown): KpiKey | null | undefined {
  if (!isPlainFieldRecord(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.length === 0) return null;
  if (keys.length !== 1 || keys[0] !== "kpi") return undefined;
  if (value.kpi === null) return null;
  return typeof value.kpi === "string" && KPI_KEY_SET.has(value.kpi as KpiKey)
    ? value.kpi as KpiKey
    : undefined;
}

const WORKFLOW_LABELS: Record<string, string> = {
  requested: "요청",
  assigned: "배정",
  accepted: "수락",
  in_progress: "진행 중",
  evidence_ready: "증거 작성 완료",
  review_pending: "검수 대기",
  changes_requested: "수정 요청",
  approved: "승인",
  completed: "완료",
  cancelled: "취소",
};
const UPLOAD_LABELS: Record<string, string> = {
  none: "업로드 없음",
  queued: "업로드 대기",
  uploading: "업로드 중",
  partial_failure: "일부 실패",
  failed: "업로드 실패",
  synced: "동기화 완료",
};
const JOB_LABELS: Record<string, string> = {
  vacancy_capture: "공실 촬영",
  move_out_check: "퇴실 확인",
  cleaning_before_after: "청소 전후 촬영",
  maintenance_inspection: "정기 시설점검",
  complaint_check: "민원 현장확인",
  repair_before_after: "수리 전후 촬영",
};

function seoulToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function millisecondsUntilNextSeoulDay(): number {
  const now = Date.now();
  const seoul = new Date(now + 9 * 60 * 60 * 1_000);
  const nextUtc = Date.UTC(
    seoul.getUTCFullYear(),
    seoul.getUTCMonth(),
    seoul.getUTCDate() + 1,
  ) - 9 * 60 * 60 * 1_000;
  return Math.max(250, nextUtc - now + 25);
}

function active(item: FieldWorkspaceItem): boolean {
  return !item.archivedAt && !["completed", "cancelled"].includes(item.workflowStatus);
}

function matchesKpi(item: FieldWorkspaceItem, filter: KpiKey | null, today: string): boolean {
  if (!filter) return true;
  if (!active(item)) return false;
  if (filter === "todayVisits") return item.dueDate === today;
  if (filter === "capturePending") {
    return ["vacancy_capture", "cleaning_before_after", "complaint_check", "repair_before_after"].includes(item.jobType)
      && ["requested", "assigned", "accepted", "in_progress"].includes(item.workflowStatus);
  }
  if (filter === "uploadFailures") return ["partial_failure", "failed"].includes(item.uploadStatus);
  if (filter === "reviewPending") return item.jobType === "vacancy_capture" && item.workflowStatus === "review_pending";
  if (filter === "unassigned") return item.assignedOperatorId === null;
  if (filter === "overdue") return item.dueDate < today;
  return item.adminActionRequired;
}

function matchesSearch(item: FieldWorkspaceItem, search: string): boolean {
  const needle = search.trim().toLocaleLowerCase("ko");
  if (!needle) return true;
  const copy = fieldWorkspaceItemCopy(item);
  return [
    fieldWorkspaceItemId(item), copy.parentName, copy.address, copy.unitLabel,
    item.assignedOperatorId ?? "",
  ].some((value) => value.toLocaleLowerCase("ko").includes(needle));
}

function executionLabel(item: FieldWorkspaceItem): string {
  if (item.jobType === "maintenance_inspection" || item.jobType === "complaint_check") return "점검 시작";
  if (item.jobType === "move_out_check") return "퇴실 확인 시작";
  if (item.jobType === "cleaning_before_after") return "청소 기록 시작";
  if (item.jobType === "repair_before_after") return "수리 기록 시작";
  return "촬영 시작";
}

function primaryAction(
  item: FieldWorkspaceItem,
  navigable: boolean,
  operatorId: string,
): { label: string; kind: "claim" | "accept" | "navigate"; destination?: "execute" | "detail" | "review" } | null {
  if (item.assignedOperatorId === null) return { label: "내가 맡기", kind: "claim" };
  if (item.assignedOperatorId !== operatorId) return null;
  if (item.workflowStatus === "assigned") return { label: "수락", kind: "accept" };
  if (!navigable) return null;
  if (["accepted", "in_progress", "changes_requested"].includes(item.workflowStatus)) {
    return { label: executionLabel(item), kind: "navigate", destination: "execute" };
  }
  if (item.workflowStatus === "review_pending") {
    return { label: "검수", kind: "navigate", destination: "review" };
  }
  return null;
}

function KpiSkeleton() {
  return (
    <span className="field-v2-kpi-skeleton" data-testid="field-kpi-skeleton" aria-hidden="true">
      <i />
      <b />
    </span>
  );
}

const FieldOperationsHome = forwardRef<FieldOperationsHomeHandle, FieldOperationsHomeProps>(function FieldOperationsHome({
  role,
  operatorId,
  loadWorkspace,
  onCommand,
  onNavigateItem,
  search = "",
  initialFilter = null,
  onSearchChange,
}, forwardedRef) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [workspace, setWorkspace] = useState<FieldOperationsWorkspace | null>(null);
  const [scope, setScope] = useState<FieldWorkspaceScope>("personal");
  const [filter, setFilter] = useState<KpiKey | null>(initialFilter);
  const [announcement, setAnnouncement] = useState("현장 업무를 확인하고 있습니다.");
  const [loadingMore, setLoadingMore] = useState(false);
  const [actionId, setActionId] = useState("");
  const [selectedJobId, setSelectedJobId] = useState("");
  const [currentRoute, setCurrentRoute] = useState("/field?embedded=crm");
  const homeRef = useRef<HTMLElement | null>(null);
  const revision = useRef(0);
  const operatorEpoch = useRef(operatorId);
  operatorEpoch.current = operatorId;

  const load = useCallback(async (nextScope: FieldWorkspaceScope) => {
    const current = ++revision.current;
    setStatus("loading");
    setWorkspace(null);
    setAnnouncement("최신 현장 업무를 불러오고 있습니다.");
    try {
      const next = await loadWorkspace({ scope: nextScope, limit: 50 });
      if (revision.current !== current) return;
      setWorkspace(next);
      setStatus("loaded");
      setAnnouncement(`현장 업무 ${next.items.length}건을 불러왔습니다.`);
    } catch {
      if (revision.current !== current) return;
      setStatus("error");
      setAnnouncement("현황을 불러오지 못했습니다. 집계 확인 필요.");
    }
  }, [loadWorkspace]);

  useEffect(() => {
    setLoadingMore(false);
    setActionId("");
  }, [operatorId, scope]);

  useEffect(() => {
    void load(scope);
    return () => { revision.current += 1; };
  }, [load, operatorId, scope]);

  const [today, setToday] = useState(seoulToday);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const checkDay = () => {
      const nextDay = seoulToday();
      setToday((current) => {
        if (current !== nextDay) void load(scope);
        return nextDay;
      });
    };
    const schedule = () => {
      timer = setTimeout(() => {
        checkDay();
        schedule();
      }, millisecondsUntilNextSeoulDay());
    };
    schedule();
    const onVisible = () => { if (document.visibilityState === "visible") checkDay(); };
    const onFocus = () => checkDay();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [load, scope]);
  const visible = useMemo(() => (workspace?.items ?? []).filter((item) => (
    matchesKpi(item, filter, today) && matchesSearch(item, search)
  )), [filter, search, today, workspace]);
  const selected = KPI_DEFINITIONS.find((definition) => definition.key === filter);

  useImperativeHandle(forwardedRef, () => ({
    async restoreNavigation(payload) {
      const route = normalizeFieldRoute(payload.route);
      const nextFilter = navigationKpiFilter(payload.filter ?? {});
      const nextSelectedJobId = payload.selectedJobId ?? "";
      const nextScrollTop = payload.scrollTop ?? 0;
      const nextSearch = payload.search ?? "";
      if (
        route !== "/field?embedded=crm"
        || nextFilter === undefined
        || typeof nextSelectedJobId !== "string"
        || (nextSelectedJobId !== "" && !isSafeFieldId(nextSelectedJobId))
        || typeof nextSearch !== "string"
        || !Number.isSafeInteger(nextScrollTop)
        || nextScrollTop < 0
        || nextScrollTop > 10_000_000
        || (nextSearch !== search && !onSearchChange)
      ) return false;
      const selectedItem = nextSelectedJobId
        ? workspace?.items.find((item) => fieldWorkspaceItemId(item) === nextSelectedJobId)
        : undefined;
      if (nextSelectedJobId && (
        !selectedItem
        || !matchesKpi(selectedItem, nextFilter, today)
        || !matchesSearch(selectedItem, nextSearch)
      )) return false;

      setCurrentRoute(route);
      setFilter(nextFilter);
      setSelectedJobId(nextSelectedJobId);
      if (nextSearch !== search) onSearchChange?.(nextSearch);
      const home = homeRef.current;
      if (!home) return false;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 0));
        if (homeRef.current !== home) return false;
        const selectedRows = home.querySelectorAll('[data-selected="true"]');
        const selectedCommitted = nextSelectedJobId
          ? selectedRows.length === 1
            && selectedRows[0]?.getAttribute("data-field-job-id") === nextSelectedJobId
          : selectedRows.length === 0;
        if (
          home.dataset.fieldRoute !== route
          || home.dataset.fieldFilter !== (nextFilter ?? "")
          || home.dataset.fieldSearch !== nextSearch
          || home.dataset.fieldSelectedJobId !== nextSelectedJobId
          || !selectedCommitted
        ) continue;

        const documentScroller = document.scrollingElement ?? document.documentElement;
        documentScroller.scrollTop = nextScrollTop;
        await new Promise((resolve) => window.setTimeout(resolve, 0));
        return homeRef.current === home
          && home.dataset.fieldRoute === route
          && home.dataset.fieldFilter === (nextFilter ?? "")
          && home.dataset.fieldSearch === nextSearch
          && home.dataset.fieldSelectedJobId === nextSelectedJobId
          && documentScroller.scrollTop === nextScrollTop;
      }
      return false;
    },
  }), [onSearchChange, search, today, workspace]);

  async function loadMore() {
    if (!workspace?.nextCursor || loadingMore) return;
    const currentRevision = revision.current;
    const currentOperator = operatorId;
    const currentWorkspace = workspace;
    setLoadingMore(true);
    try {
      const next = await loadWorkspace({ scope, limit: 50, cursor: currentWorkspace.nextCursor! });
      if (revision.current !== currentRevision || operatorEpoch.current !== currentOperator) return;
      setWorkspace(Object.freeze({
        ...next,
        items: mergeFieldWorkspaceItems(currentWorkspace.items, next.items),
      }));
      setAnnouncement(`현장 업무 ${next.items.length}건을 더 불러왔습니다.`);
    } catch {
      setAnnouncement("추가 업무를 불러오지 못했습니다. 다시 시도해 주세요.");
    } finally {
      if (revision.current === currentRevision && operatorEpoch.current === currentOperator) {
        setLoadingMore(false);
      }
    }
  }

  async function runItemAction(item: FieldWorkspaceItem) {
    const id = fieldWorkspaceItemId(item);
    const action = primaryAction(item, Boolean(onNavigateItem), operatorId);
    if (!action || role === "viewer" || actionId) return;
    if (action.kind === "navigate") {
      onNavigateItem?.(item, action.destination ?? "detail");
      return;
    }
    if (!onCommand) return;
    const currentRevision = revision.current;
    const currentOperator = operatorId;
    setActionId(id);
    try {
      if (action.kind === "claim") {
        await onCommand("claimJob", { jobId: id });
      } else {
        await onCommand("transitionStatus", { jobId: id, toStatus: "accepted" });
      }
      if (revision.current !== currentRevision || operatorEpoch.current !== currentOperator) return;
      await load(scope);
    } catch {
      if (revision.current !== currentRevision || operatorEpoch.current !== currentOperator) return;
      setAnnouncement("업무를 변경하지 못했습니다. 연결 상태를 확인해 주세요.");
    } finally {
      if (revision.current === currentRevision && operatorEpoch.current === currentOperator) setActionId("");
    }
  }

  return (
    <section
      ref={homeRef}
      className="field-v2-home"
      role="region"
      aria-label="현장 업무 현황"
      aria-busy={status === "loading" ? "true" : "false"}
      data-field-route={currentRoute}
      data-field-filter={filter ?? ""}
      data-field-search={search}
      data-field-selected-job-id={selectedJobId}
    >
      <p className="field-v2-live" aria-live="polite">{announcement}</p>
      <header className="field-v2-home-heading">
        <div>
          <p>BRING FIELD</p>
          <h1>현장 업무</h1>
          <span>CRM에서 확보한 공실·관리 업무를 현장에서 실행하고 증거로 남깁니다.</span>
        </div>
        {role === "admin" ? (
          <div className="field-v2-scope" role="group" aria-label="업무 범위">
            <button type="button" aria-pressed={scope === "personal"} onClick={() => setScope("personal")}>내 업무</button>
            <button type="button" aria-pressed={scope === "team"} onClick={() => setScope("team")}>팀 전체</button>
          </div>
        ) : <span className="field-v2-personal-scope">내 업무</span>}
      </header>

      <div className="field-v2-kpi-grid" aria-label="핵심 현황">
        {KPI_DEFINITIONS.map((definition) => status === "loaded" && workspace ? (
          <button
            className="field-v2-kpi-button"
            data-tone={definition.tone}
            type="button"
            key={definition.key}
            aria-label={`${definition.label} ${workspace.kpis[definition.key]}건 보기`}
            aria-pressed={filter === definition.key}
            onClick={() => setFilter((current) => current === definition.key ? null : definition.key)}
          >
            <span>{definition.label}</span>
            <strong>{workspace.kpis[definition.key].toLocaleString("ko-KR")}<small>건</small></strong>
            <em>업무 목록 보기</em>
          </button>
        ) : (
          <KpiSkeleton key={definition.key} />
        ))}
      </div>

      {status === "error" ? (
        <FieldStatusState status="error" onRetry={() => void load(scope)} />
      ) : status === "loaded" && workspace ? (
        <section className="field-v2-work-panel" aria-labelledby="field-v2-work-list-title">
          <header>
            <div>
              <p>{scope === "team" ? "팀 현장 운영" : "내 현장 운영"}</p>
              <h2 id="field-v2-work-list-title">{selected?.title ?? "현장 업무 목록"}</h2>
            </div>
            <span>{visible.length.toLocaleString("ko-KR")}건 표시</span>
          </header>
          {visible.length === 0 && workspace.nextCursor === null ? <FieldStatusState status="empty" compact /> : visible.length === 0 ? (
            <p className="field-v2-page-continuation">현재 페이지에는 조건에 맞는 업무가 없습니다. 다음 자료를 불러와 확인해 주세요.</p>
          ) : (
            <div className="field-v2-work-list">
              {visible.map((item) => {
                const id = fieldWorkspaceItemId(item);
                const copy = fieldWorkspaceItemCopy(item);
                const action = primaryAction(item, Boolean(onNavigateItem), operatorId);
                return (
                  <article
                    className="field-v2-work-row"
                    key={id}
                    data-field-job-id={id}
                    data-selected={selectedJobId === id ? "true" : undefined}
                  >
                    <div className="field-v2-work-main">
                      <span>{JOB_LABELS[item.jobType]}</span>
                      <h3>{copy.parentName} <b>{copy.unitLabel}</b></h3>
                      <p>{copy.address}</p>
                    </div>
                    <dl>
                      <div><dt>예정일</dt><dd>{item.dueDate}</dd></div>
                      <div><dt>진행</dt><dd>{WORKFLOW_LABELS[item.workflowStatus]}</dd></div>
                      <div><dt>업로드</dt><dd>{UPLOAD_LABELS[item.uploadStatus]}</dd></div>
                      <div><dt>담당자</dt><dd>{item.assignedOperatorId ?? "미배정"}</dd></div>
                    </dl>
                    {role !== "viewer" && action && (action.kind === "navigate" ? onNavigateItem : onCommand) ? (
                      <button
                        className="field-v2-action"
                        type="button"
                        disabled={Boolean(actionId)}
                        onClick={() => void runItemAction(item)}
                      >
                        {actionId === id ? "처리 중…" : action.label}
                      </button>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
          {workspace.nextCursor ? (
            <button
              className="field-v2-action field-v2-load-more"
              type="button"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? "불러오는 중…" : "더 보기"}
            </button>
          ) : null}
        </section>
      ) : null}
    </section>
  );
});

export default FieldOperationsHome;
