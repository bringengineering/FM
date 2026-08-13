const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const Core = require("../src/core");
const Sales = require("../src/sales-core");
const Remote = require("../src/remote");

const SALES_COLLECTIONS = [
  "salesProspects",
  "salesContacts",
  "salesUnits",
  "salesActivities",
  "salesEvents",
  "salesOpportunities"
];

const evidence = {
  evidenceType: "note",
  evidenceNote: "담당자가 사실관계를 확인함"
};

test("sales domain exposes the approved 13-stage funnel and supporting code sets", () => {
  assert.deepEqual(Sales.SALES_STAGES.map(stage => stage.id), [
    "candidate", "contact_ready", "first_contact", "replied", "qualified_interest",
    "meeting_confirmed", "diagnosis_done", "listing_received", "ad_published",
    "tenant_inquiry_visit", "lease_signed", "paid_management", "paused_closed"
  ]);
  assert.ok(Sales.SALES_CHANNELS.includes("sms"));
  assert.ok(Sales.SALES_SOURCES.includes("building_sign"));
  assert.ok(Sales.SALES_RESULTS.includes("no_response"));
  assert.ok(Sales.SALES_RESPONSE_CODES.includes("vacancy_now"));
  assert.ok(Sales.SALES_FAILURE_REASONS.includes("invalid_number"));
  assert.ok(Sales.SALES_SERVICE_TYPES.includes("waterproofing"));
  assert.deepEqual(Sales.OPPORTUNITY_STAGES, [
    "discovered", "quote_requested", "quote_approved", "work_completed", "revenue_recorded"
  ]);
  assert.deepEqual(Sales.LEASE_EVIDENCE_TYPES, ["broker_confirmation", "broker_handoff"]);
  assert.deepEqual(Sales.MANAGEMENT_EVIDENCE_TYPES, ["management_start", "service_contract"]);
});

test("all six sales record types have create and normalize functions", () => {
  const actor = "sales@bring.local";
  const prospect = Sales.createSalesProspect({ name: "대학로 원룸", createdBy: actor });
  const contact = Sales.createSalesContact({ prospectId: prospect.id, phone: "010-1111-2222", createdBy: actor });
  const unit = Sales.createSalesUnit({ prospectId: prospect.id, label: "201호", rent: "350000", createdBy: actor });
  const activity = Sales.createSalesActivity({ prospectId: prospect.id, type: "memo", summary: "첫 메모", createdBy: actor });
  const event = Sales.createSalesEvent({ prospectId: prospect.id, type: "prospect_created", ...evidence, createdBy: actor });
  const opportunity = Sales.createSalesOpportunity({ prospectId: prospect.id, serviceType: "waterproofing", createdBy: actor });

  assert.match(prospect.id, /^spr_/);
  assert.equal(Sales.normalizeSalesProspect(prospect).stage, "candidate");
  assert.match(contact.id, /^sct_/);
  assert.equal(Sales.normalizeSalesContact(contact).phone, "010-1111-2222");
  assert.match(unit.id, /^sun_/);
  assert.equal(Sales.normalizeSalesUnit(unit).rent, 350000);
  assert.match(activity.id, /^sac_/);
  assert.equal(Sales.normalizeSalesActivity(activity).type, "memo");
  assert.match(event.id, /^sev_/);
  assert.equal(Sales.normalizeSalesEvent(event).type, "prospect_created");
  assert.match(opportunity.id, /^sop_/);
  assert.equal(Sales.normalizeSalesOpportunity(opportunity).stage, "discovered");
});

test("event validation enforces common evidence and event-specific relations", () => {
  const missingEvidence = Sales.validateEvent({
    prospectId: "spr_1", type: "reply_received", occurredAt: "2026-08-13T00:00:00.000Z"
  });
  assert.equal(missingEvidence.valid, false);
  assert.ok(missingEvidence.errors.some(error => error.field === "evidenceType"));

  const missingUnit = Sales.validateEvent({
    prospectId: "spr_1", type: "listing_received", occurredAt: "2026-08-13T00:00:00.000Z", ...evidence
  });
  assert.equal(missingUnit.valid, false);
  assert.ok(missingUnit.errors.some(error => error.field === "unitId"));

  const validListing = Sales.validateEvent({
    prospectId: "spr_1", unitId: "sun_1", type: "listing_received",
    occurredAt: "2026-08-13T00:00:00.000Z", ...evidence, evidenceType: "broker_handoff"
  });
  assert.equal(validListing.valid, true);
});

test("stageFromEvents ignores invalid and archived events and chooses the highest evidenced stage", () => {
  const events = [
    { prospectId: "spr_1", type: "prospect_created", occurredAt: "2026-08-01T00:00:00.000Z", ...evidence },
    { prospectId: "spr_1", type: "reply_received", occurredAt: "2026-08-02T00:00:00.000Z" },
    { prospectId: "spr_1", unitId: "sun_1", type: "ad_published", channel: "naver", occurredAt: "2026-08-03T00:00:00.000Z", ...evidence },
    { prospectId: "spr_1", unitId: "sun_1", type: "lease_signed", occurredAt: "2026-08-04T00:00:00.000Z", archivedAt: "2026-08-05T00:00:00.000Z", ...evidence }
  ];
  assert.equal(Sales.stageFromEvents(events, { prospectId: "spr_1", units: [{ id: "sun_1", prospectId: "spr_1" }] }), "ad_published");
});

test("an explicit resume event reopens a paused prospect at the chosen stage", () => {
  const actor = { email: "owner@bring.test" };
  const paused = { id: "p1", name: "대학로 원룸", stage: "paused_closed", archivedAt: "" };
  const history = [
    { id: "e1", prospectId: "p1", type: "prospect_created", occurredAt: "2026-08-01T00:00:00.000Z", ...evidence },
    { id: "e2", prospectId: "p1", type: "interest_qualified", occurredAt: "2026-08-02T00:00:00.000Z", ...evidence },
    { id: "e3", prospectId: "p1", type: "prospect_paused", occurredAt: "2026-08-03T00:00:00.000Z", evidenceType: "note", evidenceNote: "다음 학기 재연락" }
  ];
  const resumed = Sales.createSalesEvent({
    prospectId: "p1", type: "prospect_resumed", resumeStage: "qualified_interest",
    occurredAt: "2026-08-10T00:00:00.000Z", evidenceType: "resume_reason", evidenceNote: "공실 발생으로 영업 재개"
  }, { prospects: [paused], actor });
  const updated = Sales.recalculateProspectStage(paused, [...history, resumed], { prospects: [paused] }, actor, "2026-08-10T00:00:00.000Z");

  assert.ok(Sales.SALES_EVENT_TYPES.includes("prospect_resumed"));
  assert.equal(resumed.resumeStage, "qualified_interest");
  assert.equal(updated.stage, "qualified_interest");
  assert.equal(updated.updatedBy, actor.email);
  assert.equal(paused.stage, "paused_closed");
});

test("assertEvent accepts a valid explicit resume only for a paused prospect", () => {
  const resume = {
    prospectId: "p1", type: "prospect_resumed", resumeStage: "qualified_interest",
    occurredAt: "2026-08-10T00:00:00.000Z", evidenceType: "resume_reason", evidenceNote: "공실 발생으로 재개"
  };
  assert.equal(Sales.assertEvent(resume, { prospects: [{ id: "p1", stage: "paused_closed" }] }).type, "prospect_resumed");
  assert.throws(
    () => Sales.assertEvent(resume, { prospects: [{ id: "p1", stage: "qualified_interest" }] }),
    error => error && error.code === "SALES_PROSPECT_NOT_PAUSED"
  );
});

test("historical pause evidence remains valid during stage recalculation", () => {
  const paused = { id: "p1", stage: "paused_closed" };
  const events = [
    { id: "e1", prospectId: "p1", type: "reply_received", occurredAt: "2026-08-01T00:00:00.000Z", ...evidence },
    { id: "e2", prospectId: "p1", type: "prospect_paused", occurredAt: "2026-08-02T00:00:00.000Z", evidenceType: "note", evidenceNote: "다음 학기 재연락" }
  ];
  assert.equal(Sales.stageFromEvents(events, { prospectId: "p1", prospects: [paused] }), "paused_closed");
  assert.equal(Sales.recalculateProspectStage(paused, events, { prospects: [paused] }).stage, "paused_closed");
  assert.equal(Sales.validateEvent(events[0], { prospects: [paused] }).valid, false);
});

test("nextStageFromEvents follows canonical pause resume and archived-event semantics", () => {
  const events = [
    { id: "e1", prospectId: "p1", type: "interest_qualified", occurredAt: "2026-08-01T00:00:00.000Z", ...evidence },
    { id: "e2", prospectId: "p1", type: "prospect_paused", occurredAt: "2026-08-02T00:00:00.000Z", evidenceType: "note", evidenceNote: "잠시 보류" },
    { id: "e3", prospectId: "p1", type: "prospect_resumed", resumeStage: "replied", occurredAt: "2026-08-03T00:00:00.000Z", evidenceType: "resume_reason", evidenceNote: "공실 확인" },
    { id: "e5", prospectId: "p1", type: "prospect_closed", occurredAt: "2026-08-05T00:00:00.000Z", archivedAt: "2026-08-06T00:00:00.000Z", evidenceType: "note", evidenceNote: "오입력" }
  ];
  assert.equal(Sales.nextStageFromEvents("p1", events), "replied");
  assert.equal(Sales.nextStageFromEvents("p1", events), Sales.stageFromEvents(events, { prospectId: "p1" }));
});

test("opted-out contacts block new sms and call attempts", () => {
  const contacts = [{ id: "sct_1", prospectId: "spr_1", phone: "010-1111-2222", doNotContact: true }];
  const result = Sales.validateContactAttempt({ prospectId: "spr_1", contactId: "sct_1", type: "sms" }, contacts);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.code === "CONTACT_OPTED_OUT"));
  assert.throws(
    () => Sales.createSalesActivity({ prospectId: "spr_1", contactId: "sct_1", type: "call" }, { contacts }),
    error => error && error.code === "CONTACT_OPTED_OUT"
  );
});

test("calculateKpis counts only valid completion evidence with unique prospect and unit semantics", () => {
  const events = [
    { id: "e1", prospectId: "p1", type: "contact_attempted", channel: "sms", owner: "김현진", result: "no_response", occurredAt: "2026-08-01T00:00:00.000Z", ...evidence },
    { id: "e2", prospectId: "p1", type: "contact_attempted", channel: "call", owner: "김현진", result: "no_response", occurredAt: "2026-08-02T00:00:00.000Z", ...evidence },
    { id: "e3", prospectId: "p1", type: "reply_received", occurredAt: "2026-08-03T00:00:00.000Z", ...evidence },
    { id: "e4", prospectId: "p1", unitId: "u1", type: "listing_received", occurredAt: "2026-08-04T00:00:00.000Z", ...evidence, evidenceType: "broker_handoff" },
    { id: "e5", prospectId: "p1", unitId: "u1", type: "listing_received", occurredAt: "2026-08-05T00:00:00.000Z", ...evidence, evidenceType: "broker_handoff" },
    { id: "e6", prospectId: "p1", unitId: "u1", type: "ad_published", channel: "naver", occurredAt: "2026-08-06T00:00:00.000Z", ...evidence },
    { id: "e7", prospectId: "p1", unitId: "u2", type: "ad_published", occurredAt: "2026-08-07T00:00:00.000Z" },
    { id: "e8", prospectId: "p2", unitId: "u3", type: "lease_signed", occurredAt: "2026-08-08T00:00:00.000Z", archivedAt: "2026-08-09T00:00:00.000Z", ...evidence }
  ];
  const opportunities = [
    { id: "o1", prospectId: "p1", serviceType: "waterproofing", stage: "quote_approved", quoteAmount: 500000 },
    { id: "o2", prospectId: "p1", serviceType: "move_out_cleaning", stage: "revenue_recorded", revenueAmount: 100000, evidenceUrl: "https://example.test/receipt", workCompletedAt: "2026-08-08T00:00:00.000Z", revenueRecordedAt: "2026-08-09T00:00:00.000Z" },
    { id: "o3", prospectId: "p2", serviceType: "repair", stage: "revenue_recorded", revenueAmount: 200000 },
    { id: "o4", prospectId: "p2", serviceType: "repair", stage: "revenue_recorded", revenueAmount: 900000, evidenceUrl: "https://example.test/receipt", archivedAt: "2026-08-10T00:00:00.000Z" }
  ];
  const kpis = Sales.calculateKpis({
    salesProspects: [{ id: "p1" }, { id: "p2" }, { id: "p3", archivedAt: "2026-08-01T00:00:00.000Z" }],
    salesUnits: [{ id: "u1", prospectId: "p1" }, { id: "u2", prospectId: "p1" }],
    salesEvents: events,
    salesOpportunities: opportunities
  });

  assert.equal(kpis.activeProspects, 2);
  assert.equal(kpis.contactedProspects, 1);
  assert.equal(kpis.respondedProspects, 1);
  assert.equal(kpis.listingUnits, 1);
  assert.equal(kpis.adPublishedUnits, 1);
  assert.equal(kpis.leaseSignedUnits, 0);
  assert.equal(kpis.completedOpportunities, 1);
  assert.equal(kpis.revenueRecorded, 100000);
});

test("follow-up KPI day boundaries use Asia Seoul instead of UTC", () => {
  const kpis = Sales.calculateKpis({
    salesProspects: [
      { id: "today", stage: "candidate", nextActionAt: "2026-08-13T01:00:00.000Z" },
      { id: "overdue", stage: "candidate", nextActionAt: "2026-08-12T14:59:00.000Z" }
    ]
  }, { now: "2026-08-12T16:00:00.000Z" });
  assert.equal(kpis.todayFollowUps, 1);
  assert.equal(kpis.overdueFollowUps, 1);
});

test("opportunity transitions follow the approved five-stage order", () => {
  assert.equal(Sales.canTransitionOpportunityStage("discovered", "quote_requested"), true);
  assert.equal(Sales.canTransitionOpportunityStage("quote_requested", "work_completed"), false);
  assert.equal(Sales.canTransitionOpportunityStage("revenue_recorded", "work_completed"), false);
});

test("core store and existing Firebase serializer preserve all six sales collections", () => {
  const blank = Core.blankStore();
  for (const collection of SALES_COLLECTIONS) assert.deepEqual(blank[collection], []);
  assert.ok(blank.schemaVersion >= 3);

  const input = Object.fromEntries(SALES_COLLECTIONS.map((collection, index) => [collection, [{ id: `${collection}_${index}` }]]));
  const sanitized = Core.sanitizeStore(input);
  for (const collection of SALES_COLLECTIONS) assert.equal(sanitized[collection].length, 1);

  const remote = Remote.toRemoteStore(sanitized, "sales@bring.local");
  for (const collection of SALES_COLLECTIONS) assert.equal(Object.keys(remote[collection]).length, 1);
  const merged = Remote.mergeRemoteStore(Core, remote, Core.blankStore(), { displayName: "영업 담당" });
  for (const collection of SALES_COLLECTIONS) assert.equal(merged[collection].length, 1);

  assert.ok(SALES_COLLECTIONS.every(collection => Remote.SHARED_COLLECTIONS.includes(collection)));
});

test("sales-core is loaded after core and before app without adding another page", async () => {
  const html = await readFile(path.join(__dirname, "..", "src", "index.html"), "utf8");
  assert.ok(html.indexOf("./core.js") < html.indexOf("./sales-core.js"));
  assert.ok(html.indexOf("./sales-core.js") < html.indexOf("./app.js"));
});

test("public aliases support the shared UI contract and stable actor metadata", () => {
  const at = "2026-08-13T09:00:00.000Z";
  const actor = { email: "owner@bring.test" };
  assert.equal(Sales.SALES_STAGES[0].code, "candidate");
  assert.equal(Sales.SALES_EVENT_TYPES, Sales.EVENT_TYPES);
  assert.equal(Sales.SERVICE_TYPES, Sales.SALES_SERVICE_TYPES);
  const prospect = Sales.createProspect({ name: "대학로 원룸" }, actor, at);
  assert.equal(prospect.createdAt, at);
  assert.equal(prospect.createdBy, actor.email);
  assert.equal(prospect.updatedBy, actor.email);
  assert.doesNotThrow(() => Sales.assertProspect(prospect));
  assert.equal(Sales.createContact({ prospectId: prospect.id, phone: "010-1234-5678" }, actor, at).createdBy, actor.email);
  assert.equal(Sales.createUnit({ prospectId: prospect.id, label: "201호" }, actor, at).createdBy, actor.email);
});

test("shared UI assertions use stable errors and helpers do not mutate records", () => {
  assert.throws(() => Sales.assertProspect({ name: "", address: "" }), error => error.code === "SALES_PROSPECT_IDENTITY_REQUIRED");
  assert.throws(() => Sales.assertContact({ prospectId: "", phone: "" }), error => error.code === "SALES_CONTACT_REQUIRED");
  assert.throws(() => Sales.assertUnit({ prospectId: "p1", label: "" }), error => error.code === "SALES_UNIT_REQUIRED");

  const original = { id: "p1", archivedAt: "", updatedAt: "old" };
  const archived = Sales.archiveRecord(original, { email: "owner@bring.test" }, "2026-08-13T10:00:00.000Z");
  assert.equal(original.archivedAt, "");
  assert.equal(archived.archivedBy, "owner@bring.test");
  const restored = Sales.restoreRecord(archived, { email: "owner@bring.test" }, "2026-08-13T11:00:00.000Z");
  assert.equal(restored.archivedAt, "");
  assert.equal(restored.updatedAt, "2026-08-13T11:00:00.000Z");
});

test("normalized-address duplicates exclude the current and archived records", () => {
  const candidate = { id: "current", address: "강원도 원주시 대학로 1" };
  const records = [
    { id: "same", address: "강원 원주시 대학로 1" },
    { id: "archived", address: "강원도 원주시 대학로 1", archivedAt: "2026-08-01" },
    candidate
  ];
  assert.deepEqual(Sales.duplicateProspects(records, candidate).map(item => item.id), ["same"]);
});

test("UI KPI contract exposes the approved result names and excludes paused prospects", () => {
  const at = "2026-08-13T09:00:00.000Z";
  const event = (id, type, unitId) => ({ id, prospectId: "p1", unitId, type, channel: type === "ad_published" ? "naver" : "", occurredAt: at, evidenceType: type === "listing_received" ? "broker_handoff" : "note", evidenceNote: "확인" });
  const kpis = Sales.computeSalesKpis({
    salesProspects: [
      { id: "p1", owner: "김현진", nextActionAt: "2026-08-12", archivedAt: "", stage: "ad_published" },
      { id: "p2", owner: "김현진", archivedAt: "", stage: "paused_closed" }
    ],
    salesUnits: [{ id: "u1", prospectId: "p1" }],
    salesEvents: [event("e1", "listing_received", "u1"), event("e2", "listing_received", "u1"), event("e3", "ad_published", "u1")],
    salesOpportunities: []
  }, { from: "2026-08-13T00:00:00.000Z", to: "2026-08-14T00:00:00.000Z", now: at });
  assert.equal(kpis.activeProspects, 1);
  assert.equal(kpis.listingReceivedUnits, 1);
  assert.equal(kpis.adPublishedUnits, 1);
  assert.equal(kpis.overdueFollowups, 1);
  assert.deepEqual(kpis.activeByOwner, { "김현진": 1 });
});

test("events and revenue never leak through when every known prospect is paused or archived", () => {
  const at = "2026-08-13T09:00:00.000Z";
  const kpis = Sales.calculateKpis({
    salesProspects: [
      { id: "p1", stage: "paused_closed", archivedAt: "" },
      { id: "p2", stage: "lease_signed", archivedAt: "2026-08-12T00:00:00.000Z" }
    ],
    salesEvents: [{ id: "e1", prospectId: "p1", unitId: "u1", type: "lease_signed", occurredAt: at, evidenceNote: "확인" }],
    salesOpportunities: [{ id: "o1", prospectId: "p1", serviceType: "repair", stage: "revenue_recorded", revenueAmount: 100000, evidenceNote: "입금 확인" }]
  });
  assert.equal(kpis.activeProspects, 0);
  assert.equal(kpis.leaseSignedUnits, 0);
  assert.equal(kpis.revenueRecorded, 0);
});

test("event normalization preserves creation metadata and records editor metadata", () => {
  const event = Sales.normalizeSalesEvent({
    id: "e1", prospectId: "p1", type: "prospect_created", evidenceNote: "등록",
    createdAt: "2026-08-01T00:00:00.000Z", createdBy: "creator@bring.test"
  }, { email: "editor@bring.test" }, "2026-08-13T09:00:00.000Z");
  assert.equal(event.createdAt, "2026-08-01T00:00:00.000Z");
  assert.equal(event.createdBy, "creator@bring.test");
  assert.equal(event.updatedAt, "2026-08-13T09:00:00.000Z");
  assert.equal(event.updatedBy, "editor@bring.test");
});

test("validation context can carry actor metadata for activities and events", () => {
  const at = "2026-08-13T09:00:00.000Z";
  const actor = { email: "owner@bring.test" };
  const contact = { id: "c1", prospectId: "p1", phone: "010-1234-5678", doNotContact: false };
  const activity = Sales.createSalesActivity({
    prospectId: "p1", contactId: "c1", type: "sms", summary: "공실 확인"
  }, { contacts: [contact], actor }, at);
  assert.equal(activity.createdBy, actor.email);
  assert.equal(activity.updatedBy, actor.email);

  const event = Sales.createSalesEvent({
    prospectId: "p1", contactId: "c1", type: "contact_verified", evidenceNote: "통화로 확인"
  }, { contacts: [contact], units: [], actor }, at);
  assert.equal(event.createdBy, actor.email);
  assert.equal(event.updatedBy, actor.email);
});

test("event relations must be active and belong to the same prospect", () => {
  const base = { prospectId: "p1", occurredAt: "2026-08-13T09:00:00.000Z", ...evidence };
  const context = {
    prospects: [{ id: "p1" }],
    contacts: [
      { id: "c-other", prospectId: "p2", phone: "010-1111-1111" },
      { id: "c-archived", prospectId: "p1", phone: "010-2222-2222", archivedAt: "2026-08-12T00:00:00.000Z" },
      { id: "c-valid", prospectId: "p1", phone: "010-3333-3333" }
    ],
    units: [
      { id: "u-other", prospectId: "p2" },
      { id: "u-archived", prospectId: "p1", archivedAt: "2026-08-12T00:00:00.000Z" },
      { id: "u-valid", prospectId: "p1" }
    ]
  };
  for (const unitId of ["u-other", "u-archived", "u-missing"]) {
    const result = Sales.validateEvent({ ...base, type: "listing_received", unitId }, context);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(error => error.code === "UNIT_NOT_ACTIVE_FOR_PROSPECT"));
  }
  for (const contactId of ["c-other", "c-archived", "c-missing"]) {
    const result = Sales.validateEvent({ ...base, type: "contact_verified", contactId }, context);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(error => error.code === "CONTACT_NOT_ACTIVE_FOR_PROSPECT"));
  }
  assert.equal(Sales.validateEvent({ ...base, type: "listing_received", unitId: "u-valid", evidenceType: "broker_handoff" }, context).valid, true);
  assert.equal(Sales.validateEvent({ ...base, type: "contact_verified", contactId: "c-valid" }, context).valid, true);
  const orphanProspect = Sales.validateEvent({ ...base, type: "reply_received" }, { prospects: [{ id: "p2" }] });
  assert.ok(orphanProspect.errors.some(error => error.code === "PROSPECT_NOT_ACTIVE"));
  const wrongOptionalContact = Sales.validateEvent({ ...base, type: "reply_received", contactId: "c-other" }, context);
  assert.ok(wrongOptionalContact.errors.some(error => error.code === "CONTACT_NOT_ACTIVE_FOR_PROSPECT"));
  const wrongOptionalUnit = Sales.validateEvent({ ...base, type: "reply_received", unitId: "u-other" }, context);
  assert.ok(wrongOptionalUnit.errors.some(error => error.code === "UNIT_NOT_ACTIVE_FOR_PROSPECT"));
});

test("KPI evidence requires an active prospect and valid active relations", () => {
  const event = { id: "e1", prospectId: "p1", unitId: "u1", type: "listing_received", occurredAt: "2026-08-13T09:00:00.000Z", ...evidence, evidenceType: "broker_handoff" };
  const orphan = Sales.calculateKpis({ salesProspects: [], salesUnits: [{ id: "u1", prospectId: "p1" }], salesEvents: [event] });
  assert.equal(orphan.listingUnits, 0);

  const wrongUnit = Sales.calculateKpis({
    salesProspects: [{ id: "p1" }],
    salesUnits: [{ id: "u1", prospectId: "p2" }],
    salesEvents: [event]
  });
  assert.equal(wrongUnit.listingUnits, 0);

  const valid = Sales.calculateKpis({
    salesProspects: [{ id: "p1" }],
    salesUnits: [{ id: "u1", prospectId: "p1" }],
    salesEvents: [event]
  });
  assert.equal(valid.listingUnits, 1);
});

test("approved event types enforce their own completion evidence", () => {
  const at = "2026-08-13T09:00:00.000Z";
  const base = { prospectId: "p1", occurredAt: at, ...evidence };
  const first = Sales.validateEvent({ ...base, type: "contact_attempted" });
  assert.equal(first.valid, false);
  assert.deepEqual(
    new Set(first.errors.map(error => error.code)),
    new Set(["CONTACT_CHANNEL_REQUIRED", "CONTACT_OWNER_REQUIRED", "CONTACT_RESULT_REQUIRED"])
  );
  assert.equal(Sales.validateEvent({ ...base, type: "contact_attempted", channel: "sms", owner: "김현진", result: "no_response" }).valid, true);

  const ad = Sales.validateEvent({ ...base, type: "ad_published", unitId: "u1" });
  assert.ok(ad.errors.some(error => error.code === "AD_CHANNEL_REQUIRED"));
  assert.ok(Sales.AD_CHANNELS.includes("naver"));
  assert.ok(Sales.AD_CHANNELS.includes("daangn"));
  assert.ok(Sales.validateEvent({ ...base, type: "ad_published", unitId: "u1", channel: "not-blank" }).errors.some(error => error.code === "AD_CHANNEL_INVALID"));
  assert.equal(Sales.validateEvent({ ...base, type: "ad_published", unitId: "u1", channel: "naver" }).valid, true);

  const weakListing = Sales.validateEvent({ ...base, type: "listing_received", unitId: "u1", evidenceType: "note" });
  assert.ok(weakListing.errors.some(error => error.code === "BROKER_HANDOFF_REQUIRED"));
  assert.equal(Sales.validateEvent({ ...base, type: "listing_received", unitId: "u1", evidenceType: "broker_handoff" }).valid, true);

  const weakLease = Sales.validateEvent({ ...base, type: "lease_signed", unitId: "u1", evidenceType: "note" });
  assert.ok(weakLease.errors.some(error => error.code === "BROKER_CONFIRMATION_REQUIRED"));
  assert.equal(Sales.validateEvent({ ...base, type: "lease_signed", unitId: "u1", evidenceType: "broker_confirmation" }).valid, true);

  const weakManagement = Sales.validateEvent({ ...base, type: "paid_management_started", evidenceType: "management_start" });
  assert.ok(weakManagement.errors.some(error => error.code === "MANAGEMENT_START_REQUIRED"));
  assert.ok(weakManagement.errors.some(error => error.code === "MANAGEMENT_SCOPE_REQUIRED"));
  assert.equal(Sales.validateEvent({
    ...base, type: "paid_management_started", evidenceType: "management_start",
    managementStartedAt: at, serviceScope: "공실·입퇴실 일정과 민원 접수"
  }).valid, true);
  const invalidFirstEnums = Sales.validateEvent({
    ...base, type: "contact_attempted", channel: "carrier_pigeon", owner: "김현진", result: "mystery"
  });
  assert.ok(invalidFirstEnums.errors.some(error => error.code === "CONTACT_CHANNEL_INVALID"));
  assert.ok(invalidFirstEnums.errors.some(error => error.code === "CONTACT_RESULT_INVALID"));
});

test("explicitly invalid event occurrence time is rejected instead of replaced with now", () => {
  const raw = { prospectId: "p1", type: "reply_received", occurredAt: "not-a-date", ...evidence };
  const normalized = Sales.normalizeSalesEvent(raw);
  assert.equal(normalized.occurredAt, "not-a-date");
  assert.equal(Sales.validateEvent(normalized).valid, false);
  assert.throws(() => Sales.createSalesEvent(raw), error => error.code === "OCCURRED_AT_INVALID");
});

test("an explicit doNotContact false clears a legacy optOut flag", () => {
  const contact = Sales.normalizeSalesContact({
    id: "c1", prospectId: "p1", phone: "010-1111-2222", optOut: true,
    doNotContact: false, doNotContactAt: "2026-08-01T00:00:00.000Z", doNotContactReason: "과거 요청"
  });
  assert.equal(contact.doNotContact, false);
  assert.equal(contact.optOut, false);
  assert.equal(contact.doNotContactAt, "");
  assert.equal(contact.doNotContactReason, "");
});

test("editing an address always recomputes one Unicode-punctuation-normalized key", () => {
  const edited = Sales.normalizeSalesProspect({
    id: "p1", address: "강원도 원주시, 대학로(1) #A-동!", normalizedAddress: "stale-key"
  });
  assert.equal(edited.normalizedAddress, "강원원주시대학로1a동");
  assert.equal(Sales.normalizeAddress("강원 원주시 대학로 1 A동"), edited.normalizedAddress);
});

test("assertions reject explicitly invalid enum values instead of accepting normalized fallbacks", () => {
  assert.throws(() => Sales.assertProspect({ name: "건물", source: "unknown-source" }), error => error.code === "SALES_PROSPECT_SOURCE_INVALID");
  assert.throws(() => Sales.assertProspect({ name: "건물", stage: "unknown-stage" }), error => error.code === "SALES_PROSPECT_STAGE_INVALID");
  assert.throws(() => Sales.assertContact({ prospectId: "p1", phone: "010", source: "unknown-source" }), error => error.code === "SALES_CONTACT_SOURCE_INVALID");
  assert.throws(() => Sales.assertUnit({ prospectId: "p1", label: "101", status: "broken" }), error => error.code === "SALES_UNIT_STATUS_INVALID");
  assert.throws(() => Sales.assertActivity({ prospectId: "p1", type: "fax", summary: "내용" }), error => error.code === "SALES_ACTIVITY_TYPE_INVALID");
  assert.throws(() => Sales.assertActivity({ prospectId: "p1", type: "memo", result: "mystery", summary: "내용" }), error => error.code === "SALES_ACTIVITY_RESULT_INVALID");
  assert.throws(() => Sales.assertOpportunity({ prospectId: "p1", serviceType: "moving", stage: "discovered" }), error => error.code === "SALES_OPPORTUNITY_SERVICE_INVALID");
  assert.throws(() => Sales.assertOpportunity({ prospectId: "p1", serviceType: "repair", stage: "done" }), error => error.code === "SALES_OPPORTUNITY_STAGE_INVALID");
  assert.throws(() => Sales.assertEvent({ prospectId: "p1", type: "made_up", occurredAt: "2026-08-13", ...evidence }), error => error.code === "SALES_EVENT_TYPE_INVALID");
  assert.throws(() => Sales.assertEvent({ prospectId: "p1", type: "contact_attempted", channel: "fax", owner: "담당", result: "no_response", occurredAt: "2026-08-13", ...evidence }), error => error.code === "SALES_EVENT_CHANNEL_INVALID");
});

test("activity assertions reject cross-prospect optional relations", () => {
  const context = {
    contacts: [{ id: "c1", prospectId: "p2", phone: "010-1111-2222" }],
    units: [{ id: "u1", prospectId: "p2" }]
  };
  assert.throws(() => Sales.assertActivity({
    prospectId: "p1", contactId: "c1", type: "call", result: "no_response", summary: "연락"
  }, context), error => error.code === "SALES_ACTIVITY_CONTACT_INVALID");
  assert.throws(() => Sales.assertActivity({
    prospectId: "p1", unitId: "u1", type: "memo", result: "follow_up", summary: "호실 메모"
  }, context), error => error.code === "SALES_ACTIVITY_UNIT_INVALID");
});

test("actor objects without an email never stringify into audit metadata", () => {
  const record = Sales.createSalesProspect({ name: "건물" }, { name: "이름만 있음" }, "2026-08-13T09:00:00.000Z");
  assert.equal(record.createdBy, "");
  assert.equal(record.updatedBy, "");
  assert.equal(Sales.archiveRecord(record, { name: "이름만 있음" }, "2026-08-13T10:00:00.000Z").archivedBy, "");
});

test("opportunity milestone timestamps are immutable and generated on each transition", () => {
  const actor = { email: "owner@bring.test" };
  const completedAt = "2026-08-10T09:00:00.000Z";
  const editedAt = "2026-08-11T09:00:00.000Z";
  const revenueAt = "2026-08-12T09:00:00.000Z";
  const completed = Sales.createSalesOpportunity({
    id: "o1", prospectId: "p1", serviceType: "repair", stage: "work_completed", evidenceNote: "작업 사진 확인"
  }, actor, completedAt);
  assert.equal(completed.workCompletedAt, completedAt);
  const edited = Sales.createSalesOpportunity({ ...completed, requirements: "메모 수정" }, actor, editedAt);
  assert.equal(edited.workCompletedAt, completedAt);
  const revenue = Sales.createSalesOpportunity({
    ...edited, stage: "revenue_recorded", revenueAmount: 100000, evidenceNote: "입금 확인"
  }, actor, revenueAt);
  assert.equal(revenue.workCompletedAt, completedAt);
  assert.equal(revenue.revenueRecordedAt, revenueAt);
  const laterEdit = Sales.createSalesOpportunity({ ...revenue, requirements: "정산 메모" }, actor, "2026-08-13T09:00:00.000Z");
  assert.equal(laterEdit.revenueRecordedAt, revenueAt);
});

test("legacy opportunity milestones use stable record metadata and undated legacy records stay out of KPIs", () => {
  assert.deepEqual(Sales.OPPORTUNITY_MILESTONE_POLICY, {
    version: 1,
    legacyFallback: "updatedAt_then_createdAt",
    undatedLegacy: "excluded_from_stage_kpis"
  });
  const legacyAt = "2026-07-20T09:00:00.000Z";
  const legacy = Sales.normalizeSalesOpportunity({
    id: "legacy", prospectId: "p1", serviceType: "repair", stage: "revenue_recorded",
    revenueAmount: 200000, evidenceNote: "기존 입금기록", createdAt: "2026-07-01T09:00:00.000Z", updatedAt: legacyAt
  });
  assert.equal(legacy.workCompletedAt, legacyAt);
  assert.equal(legacy.revenueRecordedAt, legacyAt);
  assert.equal(legacy.milestoneDateSource, "legacy_record_metadata");

  const kpis = Sales.calculateKpis({
    salesProspects: [{ id: "p1" }],
    salesOpportunities: [
      legacy,
      { id: "undated", prospectId: "p1", serviceType: "repair", stage: "revenue_recorded", revenueAmount: 900000, evidenceNote: "날짜 없음" }
    ]
  }, { from: "2026-07-01T00:00:00.000Z", to: "2026-08-01T00:00:00.000Z" });
  assert.equal(kpis.completedOpportunities, 1);
  assert.equal(kpis.revenueRecorded, 200000);

  const rawLegacyKpis = Sales.calculateKpis({
    salesProspects: [{ id: "p1" }],
    salesOpportunities: [{
      id: "raw-legacy", prospectId: "p1", serviceType: "repair", stage: "revenue_recorded",
      revenueAmount: 300000, evidenceNote: "기존 입금기록", createdAt: "2026-07-01T09:00:00.000Z", updatedAt: legacyAt
    }]
  }, { from: "2026-07-01T00:00:00.000Z", to: "2026-08-01T00:00:00.000Z" });
  assert.equal(rawLegacyKpis.completedOpportunities, 1);
  assert.equal(rawLegacyKpis.revenueRecorded, 300000);
});

test("opportunity KPI windows use work and revenue milestone dates, not mutable updatedAt", () => {
  const kpis = Sales.calculateKpis({
    salesProspects: [{ id: "p1" }],
    salesOpportunities: [
      { id: "inside", prospectId: "p1", serviceType: "repair", stage: "revenue_recorded", revenueAmount: 100000, evidenceNote: "입금", workCompletedAt: "2026-08-10T09:00:00.000Z", revenueRecordedAt: "2026-08-12T09:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" },
      { id: "revenue-outside", prospectId: "p1", serviceType: "repair", stage: "revenue_recorded", revenueAmount: 200000, evidenceNote: "입금", workCompletedAt: "2026-08-11T09:00:00.000Z", revenueRecordedAt: "2026-09-01T09:00:00.000Z", updatedAt: "2026-08-12T00:00:00.000Z" },
      { id: "work-outside", prospectId: "p1", serviceType: "repair", stage: "work_completed", evidenceNote: "완료", workCompletedAt: "2026-07-30T09:00:00.000Z", updatedAt: "2026-08-12T00:00:00.000Z" }
    ]
  }, { from: "2026-08-01T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z" });
  assert.equal(kpis.completedOpportunities, 2);
  assert.equal(kpis.revenueRecorded, 100000);
});

test("normalization does not invent a milestone date for an undated legacy opportunity", () => {
  const undated = Sales.normalizeSalesOpportunity({
    id: "legacy-undated", prospectId: "p1", serviceType: "repair", stage: "revenue_recorded",
    revenueAmount: 50000, evidenceNote: "과거 기록"
  });
  assert.equal(undated.workCompletedAt, "");
  assert.equal(undated.revenueRecordedAt, "");
  assert.equal(undated.milestoneDateSource, "legacy_undated");
  assert.equal(Sales.validateOpportunity(undated).valid, true);
  const kpis = Sales.calculateKpis({ salesProspects: [{ id: "p1" }], salesOpportunities: [undated] });
  assert.equal(kpis.completedOpportunities, 0);
  assert.equal(kpis.revenueRecorded, 0);
});

test("editing an undated legacy completed opportunity does not create a current milestone", () => {
  const legacy = Sales.normalizeSalesOpportunity({
    id: "legacy-undated", prospectId: "p1", serviceType: "repair", stage: "work_completed",
    evidenceNote: "과거 완료 기록"
  });
  const edited = Sales.createSalesOpportunity(
    { ...legacy, requirements: "메모만 수정" },
    { email: "owner@bring.test" },
    "2026-08-13T09:00:00.000Z"
  );
  assert.equal(edited.workCompletedAt, "");
  assert.equal(edited.milestoneDateSource, "legacy_undated");
});

test("an explicit legacy opportunity stage transition timestamps only the milestone being crossed", () => {
  const actor = { email: "owner@bring.test" };
  const transitionAt = "2026-08-13T09:00:00.000Z";
  const legacyQuote = Sales.normalizeSalesOpportunity({
    id: "legacy-quote", prospectId: "p1", serviceType: "repair", stage: "quote_approved"
  });
  const completed = Sales.createSalesOpportunity({
    ...legacyQuote, stage: "work_completed", evidenceNote: "작업 완료 확인"
  }, actor, transitionAt, "quote_approved");
  assert.equal(completed.workCompletedAt, transitionAt);
  assert.equal(completed.milestoneDateSource, "transition_time");

  const legacyCompleted = Sales.normalizeSalesOpportunity({
    id: "legacy-work", prospectId: "p1", serviceType: "repair", stage: "work_completed", evidenceNote: "과거 완료"
  });
  const revenue = Sales.createSalesOpportunity({
    ...legacyCompleted, stage: "revenue_recorded", revenueAmount: 100000, evidenceNote: "입금 확인"
  }, actor, transitionAt, "work_completed");
  assert.equal(revenue.workCompletedAt, "");
  assert.equal(revenue.revenueRecordedAt, transitionAt);
  assert.equal(revenue.milestoneDateSource, "legacy_undated");
});

test("opportunity relations must point to an active prospect and same-prospect active unit", () => {
  const opportunity = { id: "o1", prospectId: "p1", unitId: "u1", serviceType: "repair", stage: "quote_requested" };
  const wrongUnit = Sales.validateOpportunity(opportunity, {
    prospects: [{ id: "p1" }], units: [{ id: "u1", prospectId: "p2" }]
  });
  assert.ok(wrongUnit.errors.some(error => error.code === "UNIT_NOT_ACTIVE_FOR_PROSPECT"));
  const missingProspect = Sales.validateOpportunity(opportunity, {
    prospects: [{ id: "p2" }], units: [{ id: "u1", prospectId: "p1" }]
  });
  assert.ok(missingProspect.errors.some(error => error.code === "PROSPECT_NOT_ACTIVE"));
  assert.equal(Sales.validateOpportunity(opportunity, {
    prospects: [{ id: "p1" }], units: [{ id: "u1", prospectId: "p1" }]
  }).valid, true);

  const kpis = Sales.calculateKpis({
    salesProspects: [{ id: "p1" }],
    salesUnits: [{ id: "u1", prospectId: "p2" }],
    salesOpportunities: [{
      ...opportunity, stage: "revenue_recorded", workCompletedAt: "2026-08-10T00:00:00.000Z",
      revenueRecordedAt: "2026-08-11T00:00:00.000Z", revenueAmount: 100000, evidenceNote: "입금"
    }]
  });
  assert.equal(kpis.completedOpportunities, 0);
  assert.equal(kpis.revenueRecorded, 0);
});

test("stage calculation rejects orphan related events when relation collections are provided", () => {
  const event = {
    prospectId: "p1", unitId: "u1", type: "listing_received", occurredAt: "2026-08-13T09:00:00.000Z", ...evidence, evidenceType: "broker_handoff"
  };
  assert.equal(Sales.stageFromEvents([event], { prospectId: "p1", units: [{ id: "u1", prospectId: "p2" }] }), "candidate");
  assert.equal(Sales.nextStageFromEvents("p1", [event], { units: [{ id: "u1", prospectId: "p2" }] }), "candidate");
});
