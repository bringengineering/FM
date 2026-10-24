// @vitest-environment node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { get, ref, set } from "firebase/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const available = Boolean(process.env.FIREBASE_DATABASE_EMULATOR_HOST);
let env: RulesTestEnvironment;
const access = (email: string, role: string, enabled = true) => ({ email, role, enabled });
const trip = (uid: string) => ({ id: "trip-1", vehicleId: "ev4-001", userUid: uid, driverName: "홍길동", purpose: "현장 점검", destination: "원주", startOdometer: 1200, evidenceDriveFileId: "drive_file_123456", evidenceDriveUrl: "https://drive.google.com/file/d/drive_file_123456/view", evidenceFileName: "20261025-1800_홍길동_1200km_trip-1.jpg", evidenceUploadState: "complete", status: "active", startedAt: "2026-10-25T09:00:00.000Z", updatedAt: "2026-10-25T09:00:00.000Z" });
const reservation = (uid: string) => ({ id: "reservation-1", vehicleId: "ev4-001", userUid: uid, driverName: "홍길동", purpose: "주말 현장", destination: "서울", startAt: "2026-10-31T00:00:00.000Z", endAt: "2026-10-31T05:00:00.000Z", approvalType: "weekend", status: "pending", createdAt: "2026-10-25T09:00:00.000Z", updatedAt: "2026-10-25T09:00:00.000Z" });

beforeAll(async () => {
  if (!available) return;
  env = await initializeTestEnvironment({ projectId: "demo-bring-fleet", database: { host: "127.0.0.1", port: 9000, rules: await readFile(resolve("../database.rules.json"), "utf8") } });
});
beforeEach(async () => {
  if (!available) return;
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async (c) => set(ref(c.database(), "crmCompany/access"), {
    admin: access("admin@bring.kr", "admin"), member: access("member@bring.kr", "member"), viewer: access("viewer@bring.kr", "viewer"), disabled: access("off@bring.kr", "member", false),
  }));
});
afterAll(async () => env?.cleanup());

describe("fleet database rules source", () => {
  it("declares a deny-by-default fleetManagement subtree", async () => {
    const source = await readFile(resolve("../database.rules.json"), "utf8");
    expect(source).toContain('"fleetManagement"');
    expect(source).toContain("child('userUid')");
  });
});

describe.runIf(available)("fleet database rules", () => {
  const db = (uid: string, email: string) => env.authenticatedContext(uid, { email, email_verified: true }).database();
  it("denies anonymous, disabled and viewer writes while permitting approved reads", async () => {
    await assertFails(get(ref(env.unauthenticatedContext().database(), "crmCompany/fleetManagement")));
    await assertFails(set(ref(db("disabled", "off@bring.kr"), "crmCompany/fleetManagement/trips/trip-1"), trip("disabled")));
    await assertSucceeds(get(ref(db("viewer", "viewer@bring.kr"), "crmCompany/fleetManagement")));
    await assertFails(set(ref(db("viewer", "viewer@bring.kr"), "crmCompany/fleetManagement/trips/trip-1"), trip("viewer")));
  });
  it("lets a member create only their own valid trip", async () => {
    await assertSucceeds(set(ref(db("member", "member@bring.kr"), "crmCompany/fleetManagement/trips/trip-1"), trip("member")));
    await assertFails(set(ref(db("member", "member@bring.kr"), "crmCompany/fleetManagement/trips/trip-2"), { ...trip("admin"), id: "trip-2" }));
  });
  it("rejects trips without meaningful purpose, destination or completed Drive evidence", async () => {
    const member = db("member", "member@bring.kr");
    await assertFails(set(ref(member, "crmCompany/fleetManagement/trips/trip-1"), { ...trip("member"), purpose: " " }));
    await assertFails(set(ref(member, "crmCompany/fleetManagement/trips/trip-1"), { ...trip("member"), destination: " " }));
    const { evidenceDriveFileId: _evidenceDriveFileId, ...withoutEvidence } = trip("member");
    expect(_evidenceDriveFileId).toBeTruthy();
    await assertFails(set(ref(member, "crmCompany/fleetManagement/trips/trip-1"), withoutEvidence));
    await assertFails(set(ref(member, "crmCompany/fleetManagement/trips/trip-1"), { ...trip("member"), evidenceUploadState: "pending" }));
    await assertFails(set(ref(member, "crmCompany/fleetManagement/trips/trip-1"), { ...trip("member"), evidenceUrl: "data:image/jpeg;base64,AQ==" }));
  });
  it("allows member reservation creation but reserves decisions for admins", async () => {
    const member = db("member", "member@bring.kr");
    await assertSucceeds(set(ref(member, "crmCompany/fleetManagement/reservations/reservation-1"), reservation("member")));
    await assertFails(set(ref(member, "crmCompany/fleetManagement/reservations/reservation-1/status"), "approved"));
    await assertSucceeds(set(ref(db("admin", "admin@bring.kr"), "crmCompany/fleetManagement/reservations/reservation-1"), { ...reservation("member"), status: "approved" }));
  });
  it("reserves vehicle and contract administration for admins", async () => {
    const vehicle = { id: "ev4-001", name: "EV4 공용차", plate: "12가3456", odometer: 1200, status: "available", updatedAt: "2026-10-25T09:00:00.000Z" };
    await assertFails(set(ref(db("member", "member@bring.kr"), "crmCompany/fleetManagement/vehicles/ev4-001"), vehicle));
    await assertSucceeds(set(ref(db("admin", "admin@bring.kr"), "crmCompany/fleetManagement/vehicles/ev4-001"), vehicle));
  });
});
