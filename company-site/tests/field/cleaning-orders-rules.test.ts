// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { get, ref, set } from "firebase/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PROJECT_ID = "demo-bring-cleaning-rules";
const EMULATOR = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
const AVAILABLE = Boolean(EMULATOR);
const PORT = Number(EMULATOR?.split(":").at(-1) || 9000);
const COMPANY_EMAIL = "admin@bring.test";
const TV_EMAIL = "wallboard@bring.test";

let environment: RulesTestEnvironment;

it("keeps raw cleaning quote revisions server-owned and unavailable to CRM or TV clients", async () => {
  const rules = JSON.parse(await readFile(resolve("../database.rules.json"), "utf8")) as {
  rules: { crmCompany: Record<string, unknown> };
  };
  expect(rules.rules.crmCompany.cleaningOrderQuotes).toEqual({ ".read": false, ".write": false });
});

describe.runIf(AVAILABLE)("cleaning orders and wallboard database access", () => {
  beforeAll(async () => {
    environment = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      database: {
        host: "127.0.0.1",
        port: PORT,
        rules: await readFile(resolve("../database.rules.json"), "utf8"),
      },
    });
    await environment.withSecurityRulesDisabled(async context => {
      await set(ref(context.database(), "crmCompany/access/admin"), {
        enabled: true,
        email: COMPANY_EMAIL,
        role: "admin",
      });
      await set(ref(context.database(), "crmCompany/wallboardReaders/tv"), {
        enabled: true,
        email: TV_EMAIL,
      });
      await set(ref(context.database(), "crmCompany/cleaningOrders/order-1"), {
        id: "order-1",
        customerId: "customer-1",
        buildingId: "building-1",
        title: "synthetic test order",
      });
      await set(ref(context.database(), "crmCompany/cleaningOrders/11111111-1111-4111-8111-111111111111"), {
        id: "11111111-1111-4111-8111-111111111111",
        customerId: "customer-1",
        buildingId: "building-1",
        title: "synthetic linked order",
      });
      await set(ref(context.database(), "crmCompany/cleaningOrderQuotes/11111111-1111-4111-8111-111111111111"), {
        orderId: "11111111-1111-4111-8111-111111111111",
        buildingId: "building-1",
        latestRevision: 1,
        latestQuoteId: "33333333-3333-4333-8333-333333333333",
        revisions: { "33333333-3333-4333-8333-333333333333": { id: "33333333-3333-4333-8333-333333333333", status: "pending_review", totalAmount: 120000 } },
      });
      await set(ref(context.database(), "crmCompany/wallboard/cleaningOperations"), {
        total: 1,
        updatedAt: "2026-09-26T00:00:00.000Z",
      });
    });
  });

  afterAll(async () => {
    await environment?.cleanup();
  });

  it("denies CRM and TV clients direct access to raw cleaning orders", async () => {
    const admin = environment.authenticatedContext("admin", {
      email: COMPANY_EMAIL,
      email_verified: true,
    }).database();
    const tv = environment.authenticatedContext("tv", {
      email: TV_EMAIL,
      email_verified: true,
    }).database();

    await assertFails(get(ref(admin, "crmCompany/cleaningOrders/order-1")));
    await assertFails(get(ref(tv, "crmCompany/cleaningOrders/order-1")));
    await assertFails(get(ref(admin, "crmCompany/cleaningOrderQuotes/11111111-1111-4111-8111-111111111111")));
    await assertFails(get(ref(tv, "crmCompany/cleaningOrderQuotes/11111111-1111-4111-8111-111111111111")));
    await assertFails(set(ref(admin, "crmCompany/cleaningOrders/client-write"), { title: "blocked" }));
    await assertFails(set(ref(tv, "crmCompany/cleaningOrders/tv-write"), { title: "blocked" }));
    await assertFails(set(ref(admin, "crmCompany/cleaningOrderQuotes/client-write"), { totalAmount: 1 }));
    await assertFails(set(ref(tv, "crmCompany/cleaningOrderQuotes/tv-write"), { totalAmount: 1 }));
  });

  it("allows only the enabled TV reader to read the aggregate cleaning projection", async () => {
    const tv = environment.authenticatedContext("tv", {
      email: TV_EMAIL,
      email_verified: true,
    }).database();
    const admin = environment.authenticatedContext("admin", {
      email: COMPANY_EMAIL,
      email_verified: true,
    }).database();
    const projection = ref(tv, "crmCompany/wallboard/cleaningOperations");

    await assertSucceeds(get(projection));
    await assertFails(set(projection, { total: 999 }));
    await assertFails(get(ref(admin, "crmCompany/wallboard/cleaningOperations")));
  });

  it("allows an authenticated CRM member to link a result report only to an existing order on the same building", async () => {
    const admin = environment.authenticatedContext("admin", {
      email: COMPANY_EMAIL,
      email_verified: true,
    }).database();
    const report = {
      id: "report-valid",
      cleaningOrderId: "11111111-1111-4111-8111-111111111111",
      buildingId: "building-1",
      kind: "stairs",
      workDate: "2026-09-26",
      updatedAt: "2026-09-26T12:00:00.000Z",
      updatedBy: "admin",
    };

    await assertSucceeds(set(ref(admin, "crmCompany/workReports/report-valid"), report));
    await assertFails(set(ref(admin, "crmCompany/workReports/report-wrong-building"), {
      ...report,
      id: "report-wrong-building",
      buildingId: "building-2",
    }));
    await assertFails(set(ref(admin, "crmCompany/workReports/report-missing-order"), {
      ...report,
      id: "report-missing-order",
      cleaningOrderId: "22222222-2222-4222-8222-222222222222",
    }));
    await assertFails(set(ref(admin, "crmCompany/workReports/report-invalid-category"), {
      ...report,
      id: "report-invalid-category",
      category: "unrecognized",
    }));
  });

  it("accepts only Google Drive view links for report evidence", async () => {
    const admin = environment.authenticatedContext("admin", {
      email: COMPANY_EMAIL,
      email_verified: true,
    }).database();
    const report = {
      id: "report-drive-link",
      cleaningOrderId: "11111111-1111-4111-8111-111111111111",
      buildingId: "building-1",
      kind: "stairs",
      workDate: "2026-09-26",
      updatedAt: "2026-09-26T12:00:00.000Z",
      updatedBy: "admin",
      items: [{
        key: "stairFloor", label: "계단실 바닥", status: "done",
        before: [{ id: "before-1", driveFileId: "drive-file-1", webViewLink: "https://drive.google.com/file/d/drive-file-1/view" }],
        after: [{ id: "after-1", driveFileId: "drive-file-2", webViewLink: "https://docs.google.com/document/d/drive-file-2/edit" }],
      }],
    };
    await assertSucceeds(set(ref(admin, "crmCompany/workReports/report-drive-link"), report));
    await assertFails(set(ref(admin, "crmCompany/workReports/report-unsafe-link"), {
      ...report,
      id: "report-unsafe-link",
      items: [{
        ...report.items[0],
        before: [{ ...report.items[0].before[0], webViewLink: "https://attacker.example/fake-drive-page" }],
      }],
    }));
  });

  it("freezes linked result reports during review and completion, then unlocks them for requested revisions", async () => {
    const admin = environment.authenticatedContext("admin", {
      email: COMPANY_EMAIL,
      email_verified: true,
    }).database();
    const report = {
      id: "report-freeze",
      cleaningOrderId: "11111111-1111-4111-8111-111111111111",
      buildingId: "building-1",
      kind: "stairs",
      workDate: "2026-09-26",
      updatedAt: "2026-09-26T12:00:00.000Z",
      updatedBy: "admin",
    };
    await set(ref(admin, "crmCompany/workReports/report-freeze"), report);
    await environment.withSecurityRulesDisabled(async context => {
      await set(ref(context.database(), "crmCompany/cleaningOrders/11111111-1111-4111-8111-111111111111/status"), "review_pending");
    });

    await assertFails(set(ref(admin, "crmCompany/workReports/report-freeze"), {
      ...report,
      updatedAt: "2026-09-26T12:00:30.000Z",
    }));

    await environment.withSecurityRulesDisabled(async context => {
      await set(ref(context.database(), "crmCompany/cleaningOrders/11111111-1111-4111-8111-111111111111/status"), "revision_requested");
    });
    await assertSucceeds(set(ref(admin, "crmCompany/workReports/report-freeze"), {
      ...report,
      updatedAt: "2026-09-26T12:00:45.000Z",
    }));

    await environment.withSecurityRulesDisabled(async context => {
      await set(ref(context.database(), "crmCompany/cleaningOrders/11111111-1111-4111-8111-111111111111/status"), "completed");
    });

    await assertFails(set(ref(admin, "crmCompany/workReports/report-freeze"), {
      ...report,
      updatedAt: "2026-09-26T12:01:00.000Z",
    }));
    await assertFails(set(ref(admin, "crmCompany/workReports/report-freeze"), {
      ...report,
      cleaningOrderId: "",
    }));
    await assertFails(set(ref(admin, "crmCompany/workReports/report-after-complete"), {
      ...report,
      id: "report-after-complete",
    }));
  });
});
