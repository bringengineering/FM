// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { get, ref, remove, set } from "firebase/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

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
    await set(ref(context.database(), "crmCompany/workOrders/w1"), {
      id: "w1", projectId: "p1", status: "done", assigneeUid: "u1", updatedAt: stamp,
    });
  });
});

describe.skipIf(!available)("project weekly report rules", () => {
  it("rejects source IDs and statuses that do not match saved work orders", async () => {
    const member = environment.authenticatedContext("u1", { email: "u1@bring.test", email_verified: true }).database();
    const path = "crmCompany/projectWeeklyReports/forged";
    const fakeId = record("forged", "u1", "submitted");
    fakeId.snapshot.sources[0].id = "missing";
    await assertFails(set(ref(member, path), fakeId));
    const fakeStatus = record("forged", "u1", "submitted");
    fakeStatus.snapshot.sources[0].status = "doing";
    fakeStatus.snapshot.counts = { total: 1, done: 0, submitted: 0, returned: 0, open: 1 };
    await assertFails(set(ref(member, path), fakeStatus));
  });

  it("freezes submitted evidence and stores an immutable manager review separately", async () => {
    const member = environment.authenticatedContext("u1", { email: "u1@bring.test", email_verified: true }).database();
    const other = environment.authenticatedContext("u2", { email: "u2@bring.test", email_verified: true }).database();
    const admin = environment.authenticatedContext("admin", { email: "admin@bring.test", email_verified: true }).database();
    const viewer = environment.authenticatedContext("viewer", { email: "viewer@bring.test", email_verified: true }).database();
    const path = "crmCompany/projectWeeklyReports/r1";
    await assertSucceeds(set(ref(member, path), record("r1", "u1")));
    await assertFails(set(ref(other, path), record("r1", "u1")));
    await assertFails(set(ref(viewer, "crmCompany/projectWeeklyReports/r2"), record("r2", "viewer")));
    await assertSucceeds(set(ref(member, path), { ...record("r1", "u1", "submitted"), submittedAt: stamp }));
    await assertFails(set(ref(member, path), { ...record("r1", "u1", "submitted"), summary: "overwritten" }));
    await assertFails(set(ref(admin, path), { ...record("r1", "u1", "submitted"), updatedBy: "admin",
      snapshot: { ...record("r1", "u1").snapshot, sources: [{ id: "w2", status: "done", assigneeUid: "u2", updatedAt: stamp }] } }));
    const reviewPath = "crmCompany/projectWeeklyReportReviews/r1";
    const review = { status: "approved", projectId: "p1", authorUid: "u1", reviewerUid: "admin", reviewedAt: stamp };
    await assertFails(set(ref(member, reviewPath), { ...review, reviewerUid: "u1" }));
    await assertFails(set(ref(admin, reviewPath), { ...review, status: "returned" }));
    await assertSucceeds(set(ref(admin, reviewPath), review));
    await assertFails(set(ref(admin, reviewPath), { ...review, status: "returned", reviewNote: "changed" }));
    await assertFails(remove(ref(admin, reviewPath)));
    await assertFails(remove(ref(admin, path)));
    const stored = (await get(ref(member, path))).val();
    expect(stored.snapshot.sources[0].id).toBe("w1");
    expect(stored.status).toBe("submitted");
  });
});
