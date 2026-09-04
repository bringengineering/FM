// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("FIELD production entry", () => {
  it("routes standalone phones to the direct-access app and CRM embeds to the v2 shell", async () => {
    const page = await readFile(resolve("app/field/page.tsx"), "utf8");

    // 현장 직원 폰은 v1(직접 접근) — Cloud Functions 없이 촬영·검수가 동작하는 유일한 경로
    expect(page).toContain('import("./FieldApp")');
    // CRM 데스크톱 임베드는 v2 셸 그대로
    expect(page).toContain('import("./components/v2/FieldV2App")');
    expect(page).toContain("classifyFieldV2EntryUrl");
    // 분류는 경량 모듈에서 가져와야 한다 — v2 를 정적 import 하면 지연 로드가 무의미해진다
    expect(page).toContain('from "./lib/entry-kind"');
    expect(page).not.toMatch(/import\s+\{[^}]*\}\s+from\s+"\.\/components\/v2\/FieldV2App"/u);
    expect(page).toContain('=== "standalone"');
    // 판별은 브라우저에서만 가능하다(정적 프리렌더 시점에는 URL 이 없다)
    expect(page).toContain('"use client"');
  });

  it("keeps the v2 shell free of the legacy app graph", async () => {
    const root = await readFile(resolve("app/field/components/v2/FieldV2App.tsx"), "utf8");

    expect(root).toContain("FieldDesktopLogoutObserver");
    expect(root).toContain("FieldV2AuthGate");
    expect(root).toContain("FieldOperatorPicker");
    expect(root).toContain("FieldOperationsHome");
    expect(root).toContain("consumeDesktopHandoffFromUrl");
    // v2 셸 자체는 여전히 레거시 그래프를 직접 끌어오지 않는다(경계 유지)
    expect(root).not.toMatch(/direct-field-api|direct-drive|drive-auth|repository\.client|DesktopFieldBootstrap|AppShell/u);
  });
});
