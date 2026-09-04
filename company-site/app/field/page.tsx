"use client";

import { Suspense, lazy, useEffect, useState } from "react";

import { classifyFieldV2EntryUrl } from "./lib/entry-kind";

/**
 * 현장앱 진입점.
 *
 * 두 앱이 서로 다른 인증·데이터 모델 위에 있어 하나로 합칠 수 없다.
 *
 *   현장 직원 폰(PWA)  → FieldApp(v1)
 *       Realtime Database 와 Google Drive 에 직접 접근한다. Cloud Functions 가
 *       배포되지 않는 현재 구성에서 촬영·검수가 실제로 동작하는 유일한 경로다.
 *
 *   CRM 데스크톱 임베드 → FieldV2App(v2)
 *       CRM 과의 postMessage 브리지·핸드오프를 담당한다. 기존 동작 그대로 둔다.
 *
 * 배경과 선택지는 docs/현장앱-복구-결정안.md 에 정리돼 있다.
 *
 * 정적 프리렌더 시점에는 URL 을 알 수 없으므로 판별은 브라우저에서 한다.
 * 두 앱은 지연 로드해, 폰에서 필요 없는 쪽 번들을 받지 않게 한다.
 */
const FieldApp = lazy(() => import("./FieldApp"));
const FieldV2App = lazy(() => import("./components/v2/FieldV2App"));

type FieldEntryTarget = "checking" | "standalone" | "crm-shell";

function FieldEntryLoading() {
  return (
    <div className="field-entry-loading" role="status" aria-live="polite">
      현장 화면을 준비하고 있습니다…
    </div>
  );
}

export default function FieldPage() {
  const [target, setTarget] = useState<FieldEntryTarget>("checking");

  useEffect(() => {
    const kind = classifyFieldV2EntryUrl(new URL(window.location.href));
    // standalone 이 아닌 모든 진입(embedded·bootstrap·invalid-embedded)은
    // CRM 셸이 자체적으로 처리해야 하므로 v2 로 보낸다.
    setTarget(kind === "standalone" ? "standalone" : "crm-shell");
  }, []);

  if (target === "checking") return <FieldEntryLoading />;

  return (
    <Suspense fallback={<FieldEntryLoading />}>
      {target === "standalone" ? <FieldApp /> : <FieldV2App />}
    </Suspense>
  );
}
