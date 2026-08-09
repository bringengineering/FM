"use client";

import { useState } from "react";

import AppShell, { type FieldDestination } from "./components/AppShell";
import AuthGate from "./components/AuthGate";
import BuildingWizard from "./components/BuildingWizard";
import Dashboard from "./components/Dashboard";
import FieldMapPanel from "./components/FieldMapPanel";
import { useFieldSession } from "./components/FieldSessionContext";
import ManagementContractQueue from "./components/ManagementContractQueue";
import { saveFieldRegistration } from "./lib/field-api.client";
import { toSaveFieldRegistrationInput } from "./lib/registration-draft";

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

function FieldWorkspace() {
  const session = useFieldSession();
  const [active, setActive] = useState<FieldDestination>("home");

  return (
    <AppShell active={active} onNavigate={setActive}>
      {active === "home" ? (
        <Dashboard onNavigate={setActive} />
      ) : active === "map" ? (
        <FieldMapPanel />
      ) : active === "buildings" ? (
        <section className="field-building-workspace">
          <ManagementContractQueue />
          <BuildingWizard
            session={session}
            onComplete={async (draft) => {
              await saveFieldRegistration(toSaveFieldRegistrationInput(draft));
            }}
          />
        </section>
      ) : (
        <DestinationPlaceholder destination={active} />
      )}
    </AppShell>
  );
}

export default function FieldApp() {
  return <AuthGate><FieldWorkspace /></AuthGate>;
}
