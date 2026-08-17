import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import FieldOperationsHome, {
  type FieldOperationsHomeHandle,
} from "../../app/field/components/v2/FieldOperationsHome";
import FieldDesktopLogoutObserver from "../../app/field/components/v2/FieldDesktopLogoutObserver";
import FieldStatusState from "../../app/field/components/v2/FieldStatusState";

const ITEM = Object.freeze({
  id: "job_1",
  visitId: "visit_1",
  jobType: "vacancy_capture" as const,
  jobPolicyVersion: "FIELD_V2_VACANCY_CAPTURE",
  checklistId: "VACANCY_CAPTURE_V1",
  crmSalesProspectId: "prospect_1",
  crmSalesUnitId: "sales_unit_1",
  assignedOperatorId: "operator_kim",
  dueDate: "2026-08-14",
  priority: "normal" as const,
  workflowStatus: "assigned" as const,
  uploadStatus: "none" as const,
  sourceSnapshot: {
    parentType: "salesProspect" as const,
    parentId: "prospect_1",
    parentName: "상지 원룸",
    address: "강원 원주시 상지대길 1",
    unitType: "salesUnit" as const,
    unitId: "sales_unit_1",
    unitLabel: "101호",
    depositWon: 5_000_000,
    monthlyRentWon: 400_000,
    maintenanceFeeWon: 50_000,
  },
  sourceVersion: {
    parentUpdatedAt: "2026-08-14T01:00:00.000Z",
    unitUpdatedAt: "2026-08-14T01:30:00.000Z",
  },
  sourceHash: "a".repeat(64),
  mediaCount: 0,
  uploadFailureCount: 0,
  adminActionRequired: false,
  createdAt: "2026-08-14T02:00:00.000Z",
  createdByAuthUid: "shared_uid",
  createdByOperatorId: "operator_kim",
  updatedAt: "2026-08-14T02:00:00.000Z",
  updatedByAuthUid: "shared_uid",
  updatedByOperatorId: "operator_kim",
  archivedAt: null,
});
const WORKSPACE = Object.freeze({
  items: [ITEM],
  kpis: {
    todayVisits: 1,
    capturePending: 2,
    uploadFailures: 0,
    reviewPending: 1,
    unassigned: 0,
    overdue: 1,
    adminActionRequired: 0,
  },
  scope: "personal" as const,
  nextCursor: null,
});

describe("CRM-native FIELD operations home", () => {
  it("renders real authoritative KPI values and drills every card into the list", async () => {
    render(
      <FieldOperationsHome
        role="member"
        operatorId="operator_kim"
        loadWorkspace={async () => ({
          ...WORKSPACE,
          kpis: { ...WORKSPACE.kpis, unassigned: 2 },
          items: [ITEM, { ...ITEM, id: "job_2", assignedOperatorId: null }],
        })}
      />,
    );

    expect(await screen.findByRole("heading", { name: "현장 업무" })).toBeVisible();
    const unassigned = screen.getByRole("button", { name: "미배정 2건 보기" });
    expect(unassigned).toBeVisible();
    fireEvent.click(unassigned);
    expect(unassigned).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "미배정 업무" })).toBeVisible();
    expect(screen.getByText("101호")).toBeVisible();
    expect(screen.queryByText("24")).not.toBeInTheDocument();

    for (const label of [
      "오늘 방문 1건 보기",
      "촬영 대기 2건 보기",
      "업로드 실패 0건 보기",
      "광고 검수 대기 1건 보기",
      "기한 초과 1건 보기",
      "관리자 조치 필요 0건 보기",
    ]) expect(screen.getByRole("button", { name: label })).toBeVisible();
  });

  it("shows collection failure as 확인 필요 with one retry instead of zero", async () => {
    const loadWorkspace = vi.fn(async () => {
      throw new Error("unavailable");
    });
    render(
      <FieldOperationsHome
        role="member"
        operatorId="operator_kim"
        loadWorkspace={loadWorkspace}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("현황을 불러오지 못했습니다");
    expect(screen.getByText(/집계 확인 필요 ·/)).toBeVisible();
    expect(screen.queryByText("0건")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(loadWorkspace).toHaveBeenCalledTimes(2));
  });

  it("reserves loading card space and hides every mutation control from viewers", async () => {
    let resolve!: () => void;
    const pending = new Promise<typeof WORKSPACE>((done) => {
      resolve = () => done(WORKSPACE);
    });
    render(
      <FieldOperationsHome
        role="viewer"
        operatorId="operator_kim"
        loadWorkspace={() => pending}
      />,
    );
    const busy = screen.getByRole("region", { name: "현장 업무 현황" });
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(screen.getAllByTestId("field-kpi-skeleton")).toHaveLength(7);
    resolve();
    expect(await screen.findByText("상지 원룸")).toBeVisible();
    expect(screen.queryByRole("button", { name: /^(내가 맡기|수락|촬영 시작|점검 시작|퇴실 확인 시작|검수)$/ })).not.toBeInTheDocument();
  });

  it("uses the required blocking App Check recovery copy", () => {
    render(<FieldStatusState status="security" onRetry={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("현장 업무 연결 확인 필요");
    expect(screen.getByRole("button", { name: "다시 시도" })).toHaveClass("field-v2-action");
  });

  it("uses claimFieldJob for self-claim and refreshes from the authoritative server result", async () => {
    const requested = { ...ITEM, assignedOperatorId: null, workflowStatus: "requested" as const };
    let calls = 0;
    const loadWorkspace = vi.fn(async () => {
      calls += 1;
      return {
        ...WORKSPACE,
        items: calls === 1 ? [requested] : [{
          ...requested,
          assignedOperatorId: "operator_kim",
          workflowStatus: "assigned" as const,
        }],
      };
    });
    const onCommand = vi.fn(async () => ({
      ...requested,
      assignedOperatorId: "operator_kim",
      workflowStatus: "assigned",
    }));
    render(
      <FieldOperationsHome
        role="member"
        operatorId="operator_kim"
        loadWorkspace={loadWorkspace}
        onCommand={onCommand}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "내가 맡기" }));
    await waitFor(() => expect(onCommand).toHaveBeenCalledWith("claimJob", { jobId: "job_1" }));
    await waitFor(() => expect(loadWorkspace).toHaveBeenCalledTimes(2));
  });

  it("never renders a no-op action and labels runnable work by job type", async () => {
    const accepted = { ...ITEM, workflowStatus: "accepted" as const };
    const onNavigateItem = vi.fn();
    const { rerender } = render(
      <FieldOperationsHome
        role="member"
        operatorId="operator_kim"
        loadWorkspace={async () => ({ ...WORKSPACE, items: [accepted] })}
      />,
    );
    expect(await screen.findByText("상지 원룸")).toBeVisible();
    expect(screen.queryByRole("button", { name: "촬영 시작" })).not.toBeInTheDocument();

    rerender(
      <FieldOperationsHome
        role="member"
        operatorId="operator_kim"
        loadWorkspace={async () => ({
          ...WORKSPACE,
          items: [{ ...accepted, jobType: "maintenance_inspection" as const }],
        })}
        onNavigateItem={onNavigateItem}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "점검 시작" }));
    expect(onNavigateItem).toHaveBeenCalledWith(expect.objectContaining({ id: "job_1" }), "execute");
  });

  it("restores the exact supported desktop route state and rejects unsupported filters", async () => {
    const ref = createRef<FieldOperationsHomeHandle>();
    const onSearchChange = vi.fn();
    function ControlledHome() {
      const [search, setSearch] = useState("");
      return (
        <FieldOperationsHome
          ref={ref}
          role="member"
          operatorId="operator_kim"
          search={search}
          loadWorkspace={async () => WORKSPACE}
          onSearchChange={(next) => {
            onSearchChange(next);
            setSearch(next);
          }}
        />
      );
    }
    render(<ControlledHome />);
    expect(await screen.findByText("상지 원룸")).toBeVisible();

    await expect(ref.current?.restoreNavigation({
      route: "/field?embedded=crm",
      selectedJobId: "job_1",
      filter: { kpi: "todayVisits" },
      scrollTop: 420,
      search: "101호",
    })).resolves.toBe(true);
    const home = screen.getByRole("region", { name: "현장 업무 현황" });
    expect(home).toHaveAttribute("data-field-route", "/field?embedded=crm");
    expect(document.scrollingElement ?? document.documentElement).toHaveProperty("scrollTop", 420);
    expect(home.querySelector('[data-field-job-id="job_1"]')).toHaveAttribute("data-selected", "true");
    expect(onSearchChange).toHaveBeenCalledWith("101호");

    await expect(ref.current?.restoreNavigation({
      route: "/field?embedded=crm",
      selectedJobId: "",
      filter: { workflowStatus: "assigned" },
      scrollTop: 0,
      search: "",
    })).resolves.toBe(false);
  });

  it("restores the document scroller even when the auto-height home section cannot scroll", async () => {
    const ref = createRef<FieldOperationsHomeHandle>();
    render(
      <FieldOperationsHome
        ref={ref}
        role="member"
        operatorId="operator_kim"
        loadWorkspace={async () => WORKSPACE}
      />,
    );
    expect(await screen.findByText("상지 원룸")).toBeVisible();
    const home = screen.getByRole("region", { name: "현장 업무 현황" });
    Object.defineProperty(home, "scrollTop", {
      configurable: true,
      get: () => 0,
      set: vi.fn(),
    });

    await expect(ref.current?.restoreNavigation({
      route: "/field?embedded=crm",
      selectedJobId: "job_1",
      filter: {},
      scrollTop: 420,
      search: "",
    })).resolves.toBe(true);
    expect(document.scrollingElement ?? document.documentElement).toHaveProperty("scrollTop", 420);
  });

  it("fails navigation when the actual document scroller clamps the requested position", async () => {
    const ref = createRef<FieldOperationsHomeHandle>();
    render(
      <FieldOperationsHome
        ref={ref}
        role="member"
        operatorId="operator_kim"
        loadWorkspace={async () => WORKSPACE}
      />,
    );
    expect(await screen.findByText("상지 원룸")).toBeVisible();
    const scroller = document.scrollingElement ?? document.documentElement;
    const original = Object.getOwnPropertyDescriptor(scroller, "scrollTop");
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      get: () => 100,
      set: vi.fn(),
    });
    try {
      await expect(ref.current?.restoreNavigation({
        route: "/field?embedded=crm",
        selectedJobId: "job_1",
        filter: {},
        scrollTop: 420,
        search: "",
      })).resolves.toBe(false);
    } finally {
      if (original) Object.defineProperty(scroller, "scrollTop", original);
      else Reflect.deleteProperty(scroller, "scrollTop");
    }
  });

  it("discards an old operator's deferred page and mutation completions after an A-to-B switch", async () => {
    let resolveMore!: (value: typeof WORKSPACE) => void;
    let resolveCommand!: (value: unknown) => void;
    const operatorA = {
      ...ITEM,
      id: "job_b",
      visitId: "visit_b",
      assignedOperatorId: "operator_a",
      sourceSnapshot: { ...ITEM.sourceSnapshot, unitLabel: "B호" },
    };
    const operatorB = { ...operatorA, assignedOperatorId: "operator_b" };
    let initialLoads = 0;
    const loadWorkspace = vi.fn((options?: { cursor?: string }) => {
      if (options?.cursor) return new Promise<typeof WORKSPACE>((resolve) => { resolveMore = resolve; });
      initialLoads += 1;
      return Promise.resolve({
        ...WORKSPACE,
        items: [initialLoads === 1 ? operatorA : operatorB],
        nextCursor: "more",
      });
    });
    const onCommand = vi.fn(() => new Promise((resolve) => { resolveCommand = resolve; }));
    const { rerender } = render(
      <FieldOperationsHome
        role="member"
        operatorId="operator_a"
        loadWorkspace={loadWorkspace}
        onCommand={onCommand}
      />,
    );
    expect(await screen.findByText("B호")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "더 보기" }));
    fireEvent.click(screen.getByRole("button", { name: "수락" }));
    rerender(
      <FieldOperationsHome
        role="member"
        operatorId="operator_b"
        loadWorkspace={loadWorkspace}
        onCommand={onCommand}
      />,
    );
    await waitFor(() => expect(loadWorkspace).toHaveBeenCalledTimes(3));
    expect(screen.getByRole("button", { name: "더 보기" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "수락" })).toBeEnabled();
    resolveMore({ ...WORKSPACE, items: [{ ...ITEM, sourceSnapshot: { ...ITEM.sourceSnapshot, unitLabel: "A호" } }] });
    resolveCommand({ ok: true });
    await waitFor(() => expect(screen.queryByText("A호")).not.toBeInTheDocument());
  });

  it("refreshes the KST date and workspace after midnight instead of pinning yesterday", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T14:59:59.500Z")); // 23:59:59.500 KST
    const loadWorkspace = vi.fn(async () => WORKSPACE);
    render(
      <FieldOperationsHome
        role="member"
        operatorId="operator_kim"
        loadWorkspace={loadWorkspace}
      />,
    );
    await vi.waitFor(() => expect(loadWorkspace).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => expect(loadWorkspace).toHaveBeenCalledTimes(2));
    vi.useRealTimers();
  });

  it("does not call a focus refresh an unbounded number of times before midnight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00.000Z"));
    const loadWorkspace = vi.fn(async () => WORKSPACE);
    render(<FieldOperationsHome role="member" operatorId="operator_kim" loadWorkspace={loadWorkspace} />);
    await vi.waitFor(() => expect(loadWorkspace).toHaveBeenCalledOnce());
    for (let index = 0; index < 25; index += 1) window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(loadWorkspace).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("does not show true empty while a filtered next page can still contain work", async () => {
    const loadWorkspace = vi.fn(async (options?: { cursor?: string }) => options?.cursor
      ? { ...WORKSPACE, items: [ITEM], nextCursor: null }
      : { ...WORKSPACE, items: [], nextCursor: "page_2" });
    render(
      <FieldOperationsHome
        role="member"
        operatorId="operator_kim"
        loadWorkspace={loadWorkspace}
        initialFilter="todayVisits"
      />,
    );
    expect(await screen.findByRole("button", { name: "더 보기" })).toBeVisible();
    expect(screen.queryByText("표시할 현장 업무가 없습니다")).not.toBeInTheDocument();
  });

  it("does not expose another operator's execution controls in team scope", async () => {
    render(
      <FieldOperationsHome
        role="admin"
        operatorId="operator_kim"
        loadWorkspace={async () => ({
          ...WORKSPACE,
          scope: "team",
          items: [{ ...ITEM, assignedOperatorId: "operator_hwang" }],
        })}
        onCommand={vi.fn(async () => ({}))}
        onNavigateItem={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "팀 전체" }));
    expect(await screen.findByText("operator_hwang")).toBeVisible();
    expect(screen.queryByRole("button", { name: /^(수락|촬영 시작|점검 시작)$/ })).not.toBeInTheDocument();
  });

  it("keeps the auth-only desktop logout handshake mounted on a blocked security screen", async () => {
    const logout = vi.fn(async () => undefined);
    const completed = vi.fn();
    window.localStorage.setItem("bring.field.v2.operator.shared_uid", JSON.stringify({
      operatorId: "operator_kim",
      selectedAt: "2026-08-14T03:00:00.000Z",
    }));
    window.addEventListener("bring-field-logout-complete", completed);
    render(
      <>
        <FieldDesktopLogoutObserver logout={logout} />
        <FieldStatusState status="security" onRetry={vi.fn()} />
      </>,
    );

    window.dispatchEvent(new CustomEvent("bring-crm-logout", {
      detail: { requestId: "123e4567-e89b-42d3-a456-426614174000" },
    }));
    await waitFor(() => expect(logout).toHaveBeenCalledOnce());
    await waitFor(() => expect(completed).toHaveBeenCalledOnce());
    expect(window.localStorage.getItem("bring.field.v2.operator.shared_uid")).not.toBeNull();
    window.removeEventListener("bring-field-logout-complete", completed);
  });

  it("accepts only exact UUID-correlated logout detail", async () => {
    const logout = vi.fn(async () => undefined);
    render(<FieldDesktopLogoutObserver logout={logout} />);

    for (const detail of [
      { requestId: "not-a-uuid" },
      { requestId: "123e4567-e89b-42d3-a456-426614174000", extra: true },
      { requestId: "123e4567-e89b-02d3-a456-426614174000" },
      "123e4567-e89b-42d3-a456-426614174000",
    ]) {
      window.dispatchEvent(new CustomEvent("bring-crm-logout", { detail }));
    }
    await Promise.resolve();
    expect(logout).not.toHaveBeenCalled();

    window.dispatchEvent(new CustomEvent("bring-crm-logout", {
      detail: { requestId: "123e4567-e89b-42d3-a456-426614174000" },
    }));
    await waitFor(() => expect(logout).toHaveBeenCalledOnce());
  });

  it("reports a generic logout failure and lets the same blocked screen retry successfully", async () => {
    const logout = vi.fn()
      .mockRejectedValueOnce(new Error("sensitive provider detail"))
      .mockResolvedValueOnce(undefined);
    const failed = vi.fn();
    const completed = vi.fn();
    window.addEventListener("bring-field-logout-failed", failed);
    window.addEventListener("bring-field-logout-complete", completed);
    render(<FieldDesktopLogoutObserver logout={logout} />);

    window.dispatchEvent(new CustomEvent("bring-crm-logout", {
      detail: { requestId: "123e4567-e89b-42d3-a456-426614174000" },
    }));
    await waitFor(() => expect(failed).toHaveBeenCalledOnce());
    expect(completed).not.toHaveBeenCalled();
    expect((failed.mock.calls[0][0] as CustomEvent).detail).toEqual({ requestId: "123e4567-e89b-42d3-a456-426614174000" });

    window.dispatchEvent(new CustomEvent("bring-crm-logout", {
      detail: { requestId: "223e4567-e89b-42d3-a456-426614174000" },
    }));
    await waitFor(() => expect(completed).toHaveBeenCalledOnce());
    expect((completed.mock.calls[0][0] as CustomEvent).detail).toEqual({ requestId: "223e4567-e89b-42d3-a456-426614174000" });
    window.removeEventListener("bring-field-logout-failed", failed);
    window.removeEventListener("bring-field-logout-complete", completed);
  });

  it("marks desktop logout in progress before Firebase sign-out can publish a missing session", async () => {
    let resolveLogout!: () => void;
    const logout = vi.fn(() => new Promise<void>((resolve) => { resolveLogout = resolve; }));
    const started = vi.fn();
    const completed = vi.fn();
    window.addEventListener("bring-field-logout-started", started);
    window.addEventListener("bring-field-logout-complete", completed);
    render(<FieldDesktopLogoutObserver logout={logout} />);

    window.dispatchEvent(new CustomEvent("bring-crm-logout", {
      detail: { requestId: "323e4567-e89b-42d3-a456-426614174000" },
    }));

    expect(started).toHaveBeenCalledOnce();
    await waitFor(() => expect(logout).toHaveBeenCalledOnce());
    expect(completed).not.toHaveBeenCalled();

    resolveLogout();
    await waitFor(() => expect(completed).toHaveBeenCalledOnce());
    window.removeEventListener("bring-field-logout-started", started);
    window.removeEventListener("bring-field-logout-complete", completed);
  });
});
