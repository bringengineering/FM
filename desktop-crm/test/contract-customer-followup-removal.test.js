"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Core = require("../src/core");
const ContractSchedule = require("../src/contract-schedule-core");
const source = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
const esc = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const legacy = { relationshipCycleDays: 60, relationshipStartedAt: "2026-01-01", relationshipLastContactAt: "2026-09-01", relationshipNextContactAt: "2020-01-01", relationshipNextAction: "Fixture retired plan", relationshipNote: "Fixture retired note" };
const fixture = () => Core.sanitizeSharedStore({
  customers: [{ id: "customer_a", name: "Fixture customer", stage: "계약 확정", phone: "", ...legacy }],
  buildings: [{ id: "building_a", name: "Fixture building" }],
  contracts: [{ id: "contract_a", customerId: "customer_a", buildingId: "building_a", name: "Fixture contract", types: ["청소"], status: "진행 중", startDate: "2026-10-14" }],
  activities: [{ id: "activity_old", customerId: "customer_a", context: "relationship", type: "전화", occurredAt: "2026-09-01", summary: "Fixture historical consultation", previousCustomerState: { ...legacy } }],
});
function between(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, "production boundaries exist");
  return source.slice(a, b);
}

test("contract customer cards show contracts and a native detail button without reminders, and never mutate stored history", () => {
  for (const writable of [true, false]) {
    const store = fixture(), before = JSON.stringify(store);
    const ctx = vm.createContext({ store, ContractSchedule, contractCustomerModeFilter: "all", main: { innerHTML: "" }, canWriteCRM: () => writable,
      customerSalesProgress: () => ({ filterIds: [] }), customerDisplayName: c => c.name,
      customerAvatar: () => '<div class="avatar"></div>', buildingById: id => store.buildings.find(b => b.id === id),
      esc, attr: esc, empty: () => "Empty",
    });
    vm.runInContext(source.match(/const customerIsRelationshipCustomer = [\s\S]*?;\r?\n/)[0], ctx);
    vm.runInContext(between("  function relationshipContractsHtml(", "  function partnerQuoteBadge("), ctx);
    ctx.renderRelationships();
    const html = ctx.main.innerHTML;
    assert.match(html, /Fixture contract/);
    assert.match(html, /data-customer-open="customer_a"/);
    assert.match(html, /type="button"[^>]*data-customer-open/);
    assert.equal(html.includes('data-contract-edit="contract_a"'), writable);
    assert.doesNotMatch(html, /마지막 연락|다음 연락|다음 할 일|연락 주기|후속 연락|연락 지연|Fixture retired|relationship-state|relationship-facts|data-relationship-/);
    assert.equal(JSON.stringify(store), before);
    store.customers[0].name = '<img src=x onerror=bad>';
    store.contracts[0].name = '<script>bad()</script>';
    ctx.renderRelationships();
    assert.match(ctx.main.innerHTML, /&lt;img/);
    assert.match(ctx.main.innerHTML, /&lt;script/);
    assert.doesNotMatch(ctx.main.innerHTML, /<img|<script/);
  }
});

test("retired handlers, calculations, forms and styles are deleted rather than hidden", () => {
  const retired = /relationship(?:CycleDays|StartedAt|LastContactAt|NextContactAt|NextAction|Note|ActivityForm|PlanForm)|beginRelationship|addDaysIso|renderRelationshipDrawer|relationshipEditor|relationshipState|selectedCustomerDrawerMode|data-relationship-/;
  assert.doesNotMatch(source, retired);
  for (const file of ["relationships.css", "readability.css", "styles.css", "toss.css"]) {
    const css = fs.readFileSync(path.join(__dirname, "../src", file), "utf8");
    assert.doesNotMatch(css, /relationship-(?:state|facts|note|plan|detail|add|history|timeline|kpi|open|customer-guide)|data-relationship-/);
  }
  const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
  assert.match(main, /const contractCustomerDetail = retiredFollowupAbsent/);
  assert.doesNotMatch(main, /planForm\.elements\.relationship|followupForm\.requestSubmit/);
});

test("new customers have no retired defaults while historical customer and consultation data survives shared roundtrips", () => {
  const customer = Core.createCustomer({ name: "Fixture new customer" });
  for (const key of Object.keys(legacy)) assert.equal(Object.hasOwn(customer, key), false);
  const original = fixture(), before = JSON.stringify(original);
  const saved = Core.sanitizeSharedStore(original);
  for (const [key, value] of Object.entries(legacy)) assert.equal(saved.customers[0][key], value);
  assert.deepEqual(saved.activities, original.activities);
  assert.deepEqual(saved.contracts, original.contracts);
  assert.equal(JSON.stringify(original), before);
  assert.equal(Core.createCustomer({ ...legacy }).relationshipCycleDays, 60, "explicit legacy properties are retained, not migrated away");
});

test("normal customer and consultation saves retain history without reactivating a retired schedule", async () => {
  for (const formId of ["activityForm", "consultationForm"]) {
    for (const nextContactAt of ["", "2026-11-10T10:00"]) {
      const store = fixture();
      store.customers[0].nextContactAt = "";
      const history = JSON.stringify(store.activities), calls = { saved: 0, rendered: 0 };
      const raw = { customerId: "customer_a", customerType: "건물주", buildingId: "", type: "전화", occurredAt: "2026-10-14T10:00", summary: "Fixture new consultation", result: "Fixture result", nextAction: "", nextContactAt, owner: "Fixture owner" };
      const ctx = vm.createContext({ store, Core, Object, Date, FormData: class { entries() { return Object.entries(raw); } },
        cloneStore: value => structuredClone(value), customerById: id => store.customers.find(c => c.id === id),
        customerBuildings: () => store.buildings, logAudit() {}, render: () => calls.rendered++,
        renderCustomerDrawer: () => calls.rendered++, closeModal() {}, showToast() {},
        main: { querySelector: () => null }, currentView: "customers", selectedCustomerHubId: "",
        commitSharedFormMutation: async ({ beforeStore, onSaved }) => { calls.saved++; assert.equal(JSON.stringify(beforeStore.activities), history); onSaved(); },
      });
      const end = formId === "activityForm" ? "consultationForm" : "securityReturnForm";
      const code = between(`    } else if (form.id === "${formId}") {`, `    } else if (form.id === "${end}") {`).replace(/^    } else if/, "    if");
      vm.runInContext(`async function submit(form) { ${code} } }`, ctx);
      await ctx.submit({ id: formId, dataset: { customerId: "customer_a", returnView: "customers" } });
      assert.equal(calls.saved, 1);
      assert(calls.rendered > 0);
      assert.equal(store.activities.length, 2);
      assert.equal(JSON.stringify([store.activities[0]]), history);
      assert.equal(store.activities[1].context, "consultation");
      assert.equal(store.activities[1].customerId, "customer_a");
      assert.equal(store.customers[0].nextContactAt, nextContactAt ? new Date(nextContactAt).toISOString() : "");
      for (const [key, value] of Object.entries(legacy)) assert.equal(store.customers[0][key], value);
    }
  }
});
