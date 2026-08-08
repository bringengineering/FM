"use client";

import type { ReactNode } from "react";

export type FieldDestination =
  | "home"
  | "map"
  | "buildings"
  | "capture"
  | "packages";

type AppShellProps = {
  active: FieldDestination;
  children: ReactNode;
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
  onNavigate,
}: AppShellProps) {
  return (
    <div className="field-platform">
      <a className="field-skip-link" href="#field-main">
        본문 바로가기
      </a>

      <aside className="field-sidebar">
        <div className="field-brand" aria-label="BRING FIELD">
          <span className="field-brand-mark" aria-hidden="true">
            B
          </span>
          <span>
            <strong>BRING</strong>
            <small>FIELD</small>
          </span>
        </div>
        <Navigation
          active={active}
          className="field-desktop-nav"
          onNavigate={onNavigate}
        />
        <div className="field-sidebar-footer">
          <span className="field-avatar" aria-hidden="true">
            BR
          </span>
          <span>
            <strong>브링 담당자</strong>
            <small>내부 직원</small>
          </span>
        </div>
      </aside>

      <div className="field-workspace">
        <header className="field-topbar">
          <div className="field-mobile-brand">
            <span className="field-brand-mark" aria-hidden="true">
              B
            </span>
            <span>
              <strong>BRING</strong>
              <small>FIELD</small>
            </span>
          </div>
          <div className="field-topbar-title">
            <p>원주 건물 유지보수 지도</p>
            <strong>현장 매물 관리</strong>
          </div>
          <div className="field-sync-status" role="status">
            <span aria-hidden="true" />
            동기화 완료
          </div>
        </header>

        <main id="field-main" className="field-main" tabIndex={-1}>
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
