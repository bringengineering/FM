// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { get, ref, remove, set } from "firebase/database";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const projectId = "demo-bring-weekly-report";
let environment: RulesTestEnvironment;
const available = Boolean(process.env.FIREBASE_DATABASE_EMULATOR_HOST);

const stamp = "2026-09-24T12:00:00.000Z";
const record = (id: string, authorUid: string, status: "draft" | "submitted" | "approved" = "draft") => ({
  id, projectId: "p1", authorUid, status,
  summary: "현장 확인 완료", nextActions: "다음 주 재점검",
  createdAt: stamp, updatedAt: stamp, updatedBy: authorUid,
  snapshot: {
    available: true, projectId: "p1", period: "current-week", capturedAt: stamp,
    range: { start: "2026-09-21", end: "2026-09-27" },
    counts: { total: 1, done: 1, submitted: 0, returned: 0, open: 0 },
    sources: [{ id: "w1", status: "done", assigneeUid: "u1", updatedAt: stamp }],
  },
});

beforeAll(async () => {
  if (!available) return;
  environment = await initializeTestEnvironment({
    projectId,
    database: { host: "127.0.0.1", port: 9000, rules: await readFile(resolve("../database.rules.json"), "utf8") },
  });
});
afterAll(async () => { if (available) await environment.cleanup(); });
beforeEach(async () => {
  if (!available) return;
  await environment.clearDatabase();
  await environment.withSecurityRulesDisabled(async context => {
    await set(ref(context.database(), "crmCompany/access"), {
      u1: { enabled: true, email: "u1@bring.test", role: "member", mustChangePassword: false },
      u2: { enabled: true, email: "u2@bring.test", role: "member", mustChangePassword: false },
      admin: { enabled: true, email: "admin@bring.test", role: "admin", mustChangePassword: false },
      viewer: { enabled: true, email: "viewer@bring.test", role: "viewer", mustChangePassword: false },
    });
  });
});

describe.skipIf(!available)("project weekly report rules", () => {
  it("allows own draft and manager approval, but blocks other-author writes and approved rewrites", async () => {
    const member = environment.authenticatedContext("u1", { email: "u1@bring.test", email_verified: true }).database();
    const other = environment.authenticatedContext("u2", { email: "u2@bring.test", email_verified: true }).database();
    const admin = environment.authenticatedContext("admin", { email: "admin@bring.test", email_verified: true }).database();
    const viewer = environment.authenticatedContext("viewer", { email: "viewer@bring.test", email_verified: true }).database();
    const path = "crmCompany/projectWeeklyReports/r1";
    await assertSucceeds(set(ref(member, path), record("r1", "u1")));
    await assertFails(set(ref(other, path), record("r1", "u1")));
    await assertFails(set(ref(viewer, "crmCompany/projectWeeklyReports/r2"), record("r2", "viewer")));
    await assertSucceeds(set(ref(member, path), { ...record("r1", "u1", "submitted"), submittedAt: stamp }));
    await assertFails(set(ref(member, path), { ...record("r1", "u1", "approved"), approvedAt: stamp }));
    await assertFails(set(ref(admin, path), { ...record("r1", "u1", "approved"), updatedBy: "admin", approvedAt: stamp,
      snapshot: { ...record("r1", "u1").snapshot, counts: { total: 0, done: 0, submitted: 0, returned: 0, open: 0 }, sources: [] } }));
    await assertSucceeds(set(ref(admin, path), { ...record("r1", "u1", "approved"), updatedBy: "admin", approvedAt: stamp }));
    await assertFails(set(ref(admin, path), { ...record("r1", "u1", "approved"), updatedBy: "admin", approvedAt: stamp, summary: "overwritten" }));
    await assertFails(remove(ref(admin, path)));
    await assertSucceeds(get(ref(member, path)));
  });
});
