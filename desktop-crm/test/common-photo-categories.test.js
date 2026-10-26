const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../src/work-report-core");
const P = require("../src/report-photo-plan");
const PDF = require("../src/work-report-pdf");
const { classifyPhotosWithGateway } = require("../src/ai-photo-classifier-client");

const keys = ["glass", "yard", "parking", "drain", "rooftop", "elevator", "walls"];
const jpg = id => ({ id, name: `${id}.jpg`, mimeType: "image/jpeg" });

test("new common categories survive gateway transport, draft, saved report and both PDF copies", async () => {
  const { COMMON_CATEGORIES } = await import("../../crm-ai-worker/src/photo-classify.js");
  assert.deepEqual(Object.keys(COMMON_CATEGORIES).filter(key => key !== "review").sort(), R.itemCatalogFor("common").map(item => item.key).sort());
  const result = await classifyPhotosWithGateway({
    endpoint: "https://bring-crm-ai-gateway.bringengineering1008.workers.dev/v1/photo-classify",
    idToken: "synthetic", input: { kind: "common", images: keys.map(id => ({ id, dataUrl: "data:image/jpeg;base64,/9j/4AAB" })) },
    fetchImpl: async () => Response.json({ ok: true, requestId: "fixture", classifications: keys.map(id => ({ id, category: id, confidence: 96, phase: "during", phaseConfidence: 96, action: "wiping", analysisVersion: 2, quality: "clear", needsReview: false })) }),
  });
  let plan = P.applyPhotoClassifications(P.planFromTree({ files: keys.map(jpg) }, { kind: "common" }), result.classifications);
  assert.deepEqual(P.photoReviewRows(plan).map(row => row.itemKey).sort(), keys.slice().sort());
  // A manual correction wins even when another model pass chooses a new category.
  plan = P.assignPhotoCategory(plan, "yard", "parking");
  plan = P.applyPhotoClassifications(plan, [{ id: "yard", category: "yard", confidence: 99, phase: "during", phaseConfidence: 96 }]);
  assert.equal(P.photoReviewRows(plan).find(row => row.id === "yard").itemKey, "parking");
  const draft = P.toReportDraft(plan, { core: R, requireResolved: true });
  const saved = R.normalizeReport(JSON.parse(JSON.stringify({ ...draft.draft, id: "fixture", buildingId: "b", workDate: "2026-10-26" })));
  assert.equal(R.photoCount(saved), keys.length);
  assert.equal(R.progress(saved), 0);
  assert.equal(PDF.workReportPdfPhotos(saved).length, keys.length);
  for (const copy of ["owner", "program"]) {
    const html = PDF.createWorkReportHtml(saved, copy);
    for (const item of saved.items.filter(item => item.during.length)) assert.ok(html.includes(item.label), `${copy}: ${item.key}`);
    assert.equal((html.match(/사진 없음/g) || []).length, keys.length);
  }
});

test("optional categories stay out of empty reports, and old windows records keep their saved labels and photos", () => {
  assert.equal(R.itemsFor("common").some(item => keys.includes(item.key)), false);
  const saved = R.normalizeReport({ kind: "common", items: [{ key: "windows", label: "공용 창호", detail: "기존 범위", during: [{ id: "old" }] }] });
  const window = saved.items.find(item => item.key === "windows");
  assert.equal(window.label, "공용 창호"); assert.equal(window.detail, "기존 범위"); assert.equal(window.during[0].id, "old");
  const selected = R.normalizeReport({ kind: "common", items: keys.map(key => ({ key, during: [{ id: key }] })) });
  assert.equal(R.photoCount(selected), keys.length);
});

test("specific folder names do not collapse back into generic floor or door categories", () => {
  for (const [name, key] of [["마당 바닥 청소", "yard"], ["주차장 바닥", "parking"], ["옥상 바닥", "rooftop"], ["배수구 청소", "drain"], ["공용 창문", "glass"], ["창틀 레일", "windows"], ["엘리베이터", "elevator"], ["외벽", "walls"]]) {
    assert.equal(P.itemKeyForFolder("common", name), key, name);
  }
});
