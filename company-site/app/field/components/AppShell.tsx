"use client";

import type { ReactNode } from "react";

import type { FieldSession } from "../lib/auth.client";
import {
  EMPTY_UPLOAD_SUMMARY,
  type UploadSummary,
} from "../lib/upload-summary";
import BrandLogo from "./BrandLogo";

export type FieldDestination =
  | "home"
  | "map"
  | "buildings"
  | "capture"
  | "packages";

type AppShellProps = {
  active: FieldDestination;
  children: ReactNode;
  session: FieldSession;
  uploadSummary?: UploadSummary;
  uploadSummaryDelayed?: boolean;
  logoutBusy?: boolean;
  logoutError?: string;
  driveControl?: ReactNode;
  onLogout: () => void;
  onNavigate?: (destination: FieldDestination) => void;
};

type NavigationItem = {
  id: FieldDestination;
  label: string;
  icon: ReactNode;
};

const navigation: NavigationItem[] = [
  {
    id: "home",
    label: "홈",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m4 10 8-6 8 6v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1v-9Z" />
      </svg>
    ),
  },
  {
    id: "map",
    label: "지도",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m9 18-5 2V6l5-2 6 2 5-2v14l-5 2-6-2Z" />
        <path d="M9 4v14M15 6v14" />
      </svg>
    ),
  },
  {
    id: "buildings",
    label: "건물",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 21V4h10v17M15 9h4v12M3 21h18" />
        <path d="M8 8h4M8 12h4M8 16h4" />
      </svg>
    ),
  },
  {
    id: "capture",
    label: "촬영",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h4l1.5-2h5L16 7h4v12H4V7Z" />
        <circle cx="12" cy="13" r="3.5" />
      </svg>
    ),
  },
  {
    id: "packages",
    label: "패키지",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m4 8 8-4 8 4-8 4-8-4Z" />
        <path d="m4 8 8 4 8-4v8l-8 4-8-4V8Z" />
      </svg>
    ),
  },
];

function Navigation({
  active,
  className,
  onNavigate,
}: Pick<AppShellProps, "active" | "onNavigate"> & { className: string }) {
  return (
    <nav className={className} aria-label="주요 메뉴">
      {navigation.map((item) => (
        <button
          className="field-nav-item"
          type="button"
          key={item.id}
          aria-current={active === item.id ? "page" : undefined}
          aria-label={item.label}
          onClick={() => onNavigate?.(item.id)}
        >
          <span className="field-nav-icon">{item.icon}</span>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

export default function AppShell({
  active,
  children,
  session,
  uploadSummary = EMPTY_UPLOAD_SUMMARY,
  uploadSummaryDelayed = false,
  logoutBusy = false,
  logoutError,
  driveControl,
  onLogout,
  onNavigate,
}: AppShellProps) {
  const roleLabel = session.role === "admin"
    ? "관리자"
    : session.role === "reviewer"
      ? "검수 담당자"
      : "내부 직원";
  const avatar = session.displayName.trim().slice(0, 2).toUpperCase() || "BR";

  return (
    <div className="field-platform">
      <a className="field-skip-link" href="#field-main">
        본문 바로가기
      </a>

      <aside className="field-sidebar">
        <div className="field-brand">
          <BrandLogo />
        </div>
        <Navigation
          active={active}
          className="field-desktop-nav"
          onNavigate={onNavigate}
        />
        <div className="field-sidebar-footer">
          <span className="field-avatar" aria-hidden="true">
            {avatar}
          </span>
          <span>
            <strong>{session.displayName}</strong>
            <small>{roleLabel}</small>
          </span>
          <button
            className="field-nav-item"
            type="button"
            disabled={logoutBusy}
            onClick={onLogout}
          >
            로그아웃
          </button>
        </div>
      </aside>

      <div className="field-workspace">
        <header className="field-topbar">
          <div className="field-mobile-brand">
            <BrandLogo />
          </div>
          <div className="field-topbar-title">
            <p>원주 건물 유지보수 지도</p>
            <strong>현장 매물 관리</strong>
          </div>
          <div className="field-topbar-actions">
            {driveControl}
            <div
              className="field-sync-status field-upload-summary-compact"
              role="status"
              aria-label="업로드 현황"
              title={uploadSummaryDelayed ? "업로드 현황 갱신이 지연되고 있습니다." : undefined}
            >
              <span aria-hidden="true" />
              <span>오늘 <strong>{uploadSummary.todayTotal}</strong></span>
              <span>업로드 중 <strong>{uploadSummary.uploading}</strong></span>
              <span>완료 <strong>{uploadSummary.completedToday}</strong></span>
              <span>실패 <strong>{uploadSummary.failed}</strong></span>
              {uploadSummaryDelayed ? <small>갱신 지연</small> : null}
            </div>
            <button
              className="field-sync-status"
              type="button"
              disabled={logoutBusy}
              onClick={onLogout}
            >
              {logoutBusy ? "로그아웃 중…" : "로그아웃"}
            </button>
          </div>
        </header>

        <main id="field-main" className="field-main" tabIndex={-1}>
          {logoutError ? <p className="field-inline-error" role="alert">{logoutError}</p> : null}
          {children}
        </main>
      </div>

      <Navigation
        active={active}
        className="field-mobile-nav"
        onNavigate={onNavigate}
      />
    </div>
  );
}
