import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

describe("CRM account setup emulator isolation", () => {
  it("uses dedicated local emulators and deny-all database rules without editing production configuration", () => {
    const config = JSON.parse(readFileSync(resolve(root, "firebase.account-setup-emulators.json"), "utf8")) as {
      database?: { rules?: string };
      functions?: Array<{ source?: string; codebase?: string }>;
      emulators?: Record<string, { port?: number }>;
    };
    const rulesPath = config.database?.rules;
    expect(rulesPath).toBe("functions/test/fixtures/crm-account-setup-emulator.rules.json");
    expect(config.functions).toEqual([{ source: "functions", codebase: "field-platform" }]);
    expect(config.emulators?.auth?.port).toBe(9099);
    expect(config.emulators?.database?.port).toBe(9000);
    expect(config.emulators?.functions?.port).toBe(5001);

    const rules = JSON.parse(readFileSync(resolve(root, rulesPath!), "utf8")) as {
      rules?: { [key: string]: unknown };
    };
    expect(rules.rules).toEqual({ ".read": false, ".write": false });

    const productionConfig = JSON.parse(readFileSync(resolve(root, "firebase.json"), "utf8")) as {
      database?: { rules?: string };
    };
    expect(productionConfig.database?.rules).toBe("database.rules.json");
  });
});
