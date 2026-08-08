"use client";

import { useState } from "react";

import AppShell, { type FieldDestination } from "./components/AppShell";

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

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14M14 7l5 5-5 5" />
    </svg>
  );
}

function Dashboard({ onNavigate }: { onNavigate: (next: FieldDestination) => void }) {
  return (
    <div className="field-dashboard">
      <section className="field-welcome">
        <div>
          <p className="field-eyebrow">TODAY · 원주</p>
          <h1>현장 업무를 시작해볼까요?</h1>
          <p>촬영부터 광고 준비까지, 오늘 필요한 작업을 한곳에서 이어가세요.</p>
        </div>
        <button
          type="button"
          className="field-primary-action"
          onClick={() => onNavigate("buildings")}
        >
          <span aria-hidden="true">+</span>
          새 건물·매물 등록
        </button>
      </section>

      <section className="field-metrics" aria-label="업무 현황">
        <article>
          <span className="field-metric-icon field-metric-icon-blue" aria-hidden="true">
            12
          </span>
          <div>
            <p>관리 중 매물</p>
            <strong>12건</strong>
            <small>이번 주 +3</small>
          </div>
        </article>
        <article>
          <span className="field-metric-icon field-metric-icon-orange" aria-hidden="true">
            4
          </span>
          <div>
            <p>촬영 필요</p>
            <strong>4건</strong>
            <small>오늘 2건 예정</small>
          </div>
        </article>
        <article>
          <span className="field-metric-icon field-metric-icon-green" aria-hidden="true">
            7
          </span>
          <div>
            <p>광고 준비 완료</p>
            <strong>7건</strong>
            <small>검수 대기 1건</small>
          </div>
        </article>
      </section>

      <div className="field-dashboard-grid">
        <section className="field-panel field-today-panel">
          <div className="field-panel-heading">
            <div>
              <p className="field-eyebrow">TODAY&apos;S WORK</p>
              <h2>오늘의 현장 업무</h2>
            </div>
            <button type="button" onClick={() => onNavigate("map")}>
              지도에서 보기 <ArrowIcon />
            </button>
          </div>

          <div className="field-task-list">
            <button type="button" onClick={() => onNavigate("capture")}>
              <span className="field-task-time">10:30</span>
              <span className="field-task-body">
                <strong>단계동 853-2 · 302호</strong>
                <small>원룸 · 사진 8장 / 영상 1개 필요</small>
              </span>
              <span className="field-task-badge field-task-badge-blue">촬영 예정</span>
            </button>
            <button type="button" onClick={() => onNavigate("buildings")}>
              <span className="field-task-time">14:00</span>
              <span className="field-task-body">
                <strong>무실동 1720-1 · 501호</strong>
                <small>투룸 · 임대 조건 확인</small>
              </span>
              <span className="field-task-badge field-task-badge-orange">정보 확인</span>
            </button>
            <button type="button" onClick={() => onNavigate("packages")}>
              <span className="field-task-time">완료</span>
              <span className="field-task-body">
                <strong>반곡동 1903-6 · 201호</strong>
                <small>당근·네이버 광고 묶음 생성</small>
              </span>
              <span className="field-task-badge field-task-badge-green">준비 완료</span>
            </button>
          </div>
        </section>

        <aside className="field-panel field-assignment-panel">
          <div className="field-panel-heading">
            <div>
              <p className="field-eyebrow">MY AREA</p>
              <h2>담당 구역</h2>
            </div>
          </div>
          <div className="field-area-card">
            <span className="field-area-pin" aria-hidden="true">
              ●
            </span>
            <div>
              <strong>단계동 · 무실동</strong>
              <p>오늘 방문 2곳 · 미완료 1건</p>
            </div>
          </div>
          <div className="field-progress-copy">
            <span>이번 주 촬영 진행률</span>
            <strong>72%</strong>
          </div>
          <div className="field-progress" aria-label="이번 주 촬영 진행률 72%">
            <span />
          </div>
          <button className="field-secondary-action" type="button" onClick={() => onNavigate("map")}>
            담당 구역 지도 열기
          </button>
        </aside>
      </div>
    </div>
  );
}

function DestinationPlaceholder({ destination }: { destination: Exclude<FieldDestination, "home"> }) {
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

export default function FieldApp() {
  const [active, setActive] = useState<FieldDestination>("home");

  return (
    <AppShell active={active} onNavigate={setActive}>
      {active === "home" ? (
        <Dashboard onNavigate={setActive} />
      ) : (
        <DestinationPlaceholder destination={active} />
      )}
    </AppShell>
  );
}
