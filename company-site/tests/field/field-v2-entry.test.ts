// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("FIELD v2 production entry", () => {
  it("mounts the CRM-native root without importing the legacy app graph", async () => {
    const page = await readFile(resolve("app/field/page.tsx"), "utf8");
    const root = await readFile(resolve("app/field/components/v2/FieldV2App.tsx"), "utf8");

    expect(page).toContain('import FieldV2App from "./components/v2/FieldV2App"');
    expect(page).not.toContain("./FieldApp");
    expect(root).toContain("FieldDesktopLogoutObserver");
    expect(root).toContain("FieldV2AuthGate");
    expect(root).toContain("FieldOperatorPicker");
    expect(root).toContain("FieldOperationsHome");
    expect(root).toContain("consumeDesktopHandoffFromUrl");
    expect(root).not.toMatch(/direct-field-api|direct-drive|drive-auth|repository\.client|DesktopFieldBootstrap|AppShell/u);
  });
});
