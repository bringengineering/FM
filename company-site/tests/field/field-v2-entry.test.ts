// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("FIELD production entry", () => {
  // v2 는 릴리스 설정(fieldPlatform/v2/config/release)과 CRM 계정 연결
  // (crmCompany/access, crmCompany/teamProfiles)이 준비되어야 동작한다.
  // 그때까지 운영 진입점은 v1 이다.
  it("현재 운영 진입점은 v1(FieldApp) 이다", async () => {
    const page = await readFile(resolve("app/field/page.tsx"), "utf8");

    expect(page).toContain('import FieldApp from "./FieldApp"');
    expect(page).not.toContain("components/v2/FieldV2App");
  });

  it("v2 루트는 손대지 않은 채 보존되어 있다", async () => {
    const root = await readFile(
      resolve("app/field/components/v2/FieldV2App.tsx"),
      "utf8",
    );

    expect(root).toContain("FieldDesktopLogoutObserver");
    expect(root).toContain("FieldV2AuthGate");
    expect(root).toContain("FieldOperatorPicker");
    expect(root).toContain("FieldOperationsHome");
    expect(root).toContain("consumeDesktopHandoffFromUrl");
    expect(root).not.toMatch(
      /direct-field-api|direct-drive|drive-auth|repository\.client|DesktopFieldBootstrap|AppShell/u,
    );
  });
});
