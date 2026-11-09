import { defineConfig } from "vitest/config";

export default defineConfig({
  // Tests import mobile-field sources, whose tsconfig extends expo/tsconfig.base.
  // CI installs only functions dependencies, so do not resolve per-file tsconfigs.
  oxc: { tsconfig: false } as never,
  test: {
    include: ["test/**/*.test.ts"],
  },
});
