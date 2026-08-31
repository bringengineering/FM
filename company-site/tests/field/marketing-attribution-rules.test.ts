// @vitest-environment node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { ref, set, update } from "firebase/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const PROJECT_ID = "demo-bring-marketing-attribution";
const HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || "";
let environment: RulesTestEnvironment;
const claims = (email: string) => ({ email, email_verified: true });
const access = {
  admin: { enabled: true, email: "admin@test", role: "admin", operatorId: "operator" },
  marketingA: { enabled: true, email: "a@test", role: "member", marketingRole: "marketing", operatorId: "operator" },
  marketingB: { enabled: true, email: "b@test", role: "member", marketingRole: "marketing", operatorId: "operator" },
  disabled: { enabled: false, email: "disabled@test", role: "member", marketingRole: "marketing", operatorId: "operator" },
  password: { enabled: true, email: "password@test", role: "member", marketingRole: "marketing", operatorId: "operator", mustChangePassword: true },
  viewer: { enabled: true, email: "viewer@test", role: "viewer", marketingRole: "viewer", operatorId: "operator" },
  sales: { enabled: true, email: "sales@test", role: "member", marketingRole: "sales", operatorId: "operator" },
};
const record = (uid: string, version: number, keyword: string) => ({ keyword, _version: version, _updatedAtMs: { ".sv": "timestamp" }, _updatedByAuthUid: uid, _updatedByOperatorId: "operator" });

async function rest(database: any, path: string, options: { method?: string; etag?: string; body?: unknown } = {}) {
  const repo = database._repo || database._repoInternal || database._delegate?._repoInternal;
  const token = await (repo.authTokenProvider_ || repo.authTokenProvider).getToken(false);
  const headers: Record<string, string> = { Authorization: `Bearer ${token.accessToken}` };
  if (!options.method) headers["X-Firebase-ETag"] = "true";
  if (options.etag) headers["If-Match"] = options.etag;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`http://${HOST}/${path}.json?ns=${PROJECT_ID}`, { method: options.method || "GET", headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const text = await response.text();
  return { status: response.status, etag: response.headers.get("etag") || "", value: text ? JSON.parse(text) : null };
}

describe("marketing attribution exact-child rules", () => {
  beforeAll(async () => { environment = await initializeTestEnvironment({ projectId: PROJECT_ID, database: { rules: await readFile(resolve(process.cwd(), "../database.rules.json"), "utf8"), host: HOST.split(":")[0], port: Number(HOST.split(":")[1]) } }); });
  beforeEach(async () => { await environment.clearDatabase(); await environment.withSecurityRulesDisabled(async context => set(ref(context.database()), { crmCompany: { access, teamProfiles: { operator: { active: true } }, data: { customers: { customer1: { id: "customer1", name: "keep" }, customer2: { id: "customer2", name: "sales keep" } } } }, cases: { case1: { id: "case1", caseParty: "브링", title: "keep" } } })); });
  afterAll(async () => { if (environment) await environment.cleanup(); });

  it("returns 412 for stale exact-child ETag and succeeds only after reviewed retry", async () => {
    const a = environment.authenticatedContext("marketingA", claims("a@test")).database();
    const b = environment.authenticatedContext("marketingB", claims("b@test")).database();
    const aRead = await rest(a, "cases/case1/marketing"); const bRead = await rest(b, "cases/case1/marketing");
    expect(aRead.status).toBe(200); expect(bRead.etag).toBe(aRead.etag);
    expect((await rest(a, "cases/case1/marketing", { method: "PUT", etag: aRead.etag, body: record("marketingA", 1, "first") })).status).toBe(200);
    expect((await rest(b, "cases/case1/marketing", { method: "PUT", etag: bRead.etag, body: record("marketingB", 1, "stale") })).status).toBe(412);
    const reviewed = await rest(b, "cases/case1/marketing"); expect(reviewed.value.keyword).toBe("first");
    expect((await rest(b, "cases/case1/marketing", { method: "PUT", etag: reviewed.etag, body: record("marketingB", 2, "reviewed") })).status).toBe(200);
    expect((await rest(a, "cases/case1/marketing")).value.keyword).toBe("reviewed");
  });

  it("allows admin, sales, and active marketing exact child only while denying other identities and siblings", async () => {
    const marketing = environment.authenticatedContext("marketingA", claims("a@test")).database();
    await assertSucceeds(set(ref(marketing, "crmCompany/data/customers/customer1/marketing"), record("marketingA", 1, "valid")));
    await assertFails(update(ref(marketing, "crmCompany/data/customers/customer1"), { name: "forged", marketingUpdatedBy: "marketingA" }));
    const admin = environment.authenticatedContext("admin", claims("admin@test")).database();
    await assertSucceeds(set(ref(admin, "cases/case1/marketing"), record("admin", 1, "admin")));
    const sales = environment.authenticatedContext("sales", claims("sales@test")).database();
    await assertSucceeds(set(ref(sales, "crmCompany/data/customers/customer2/marketing"), record("sales", 1, "sales")));
    await assertFails(set(ref(sales, "crmCompany/marketing/daily/forged"), { id: "forged" }));
    for (const [uid, email] of [["disabled", "disabled@test"], ["password", "password@test"], ["viewer", "viewer@test"]]) await assertFails(set(ref(environment.authenticatedContext(uid, claims(email)).database(), "crmCompany/data/customers/customer1/marketing"), record(uid, 1, "denied")));
    await assertFails(set(ref(environment.authenticatedContext("marketingA", claims("wrong@test")).database(), "crmCompany/data/customers/customer1/marketing"), record("marketingA", 2, "wrong")));
  });

  it("upgrades one legacy attribution without metadata to version one then requires exact increments", async () => {
    await environment.withSecurityRulesDisabled(async context => set(ref(context.database(), "cases/case1/marketing"), { keyword: "legacy" }));
    const marketing = environment.authenticatedContext("marketingA", claims("a@test")).database();
    const legacy = await rest(marketing, "cases/case1/marketing");
    expect((await rest(marketing, "cases/case1/marketing", { method: "PUT", etag: legacy.etag, body: record("marketingA", 1, "upgraded") })).status).toBe(200);
    const versionOne = await rest(marketing, "cases/case1/marketing");
    await assertFails(set(ref(marketing, "cases/case1/marketing"), record("marketingA", 1, "invalid-repeat")));
    expect((await rest(marketing, "cases/case1/marketing", { method: "PUT", etag: versionOne.etag, body: record("marketingA", 2, "version-two") })).status).toBe(200);
  });
});
