const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../src/photo-pair-review");
const P = require("../src/report-photo-plan");
const R = require("../src/work-report-core");
const M = require("../src/building-report-core");
const Refine = require("../src/photo-review-refinement");
const Pdf = require("../src/work-report-pdf");
const Client = require("../src/ai-photo-classifier-client");
const jpeg = "data:image/jpeg;base64,/9j/AA==";
const file = id => ({ id, name: `${id}.JPG`, mimeType: "image/jpeg" });
const plan = () => P.planFromTree({ name: "입주청소(검증용)_20261012", files: [file("a"), file("b")] }, { kind: "moveIn" });

test("identified document screenshots are held without another paid visual review", () => {
  const first = [{ id: "a", analysisVersion: 2, category: "review", needsReview: true, issues: ["non_work"] }];
  assert.deepEqual(Refine.reviewCandidates(first), []);
  assert.deepEqual(Refine.mergeReview(first, [{ id: "a", category: "aircon", needsReview: false }]), first);
});

test("transport retains independent confidence without treating unknown room as unknown object", async () => {
  const result = await Client.classifyPhotosWithGateway({
    endpoint: "https://bring-crm-ai-gateway.bringengineering1008.workers.dev/v1/photo-classify", idToken: "synthetic",
    input: { kind: "moveIn", images: [{ id: "a", dataUrl: jpeg }] },
    fetchImpl: async () => Response.json({ ok: true, requestId: "synthetic-review", classifications: [{ id: "a", analysisVersion: 2, category: "aircon", space: "unknown", target: "aircon", confidence: 95, spaceConfidence: 0, targetConfidence: 96, phase: "unknown", needsReview: false }] }),
  });
  assert.equal(result.classifications[0].spaceConfidence, 0);
  assert.equal(result.classifications[0].targetConfidence, 96);
  assert.equal(result.classifications[0].target, "aircon");
});

test("known appliance survives unknown room and during persists through confirmation, retry, draft and PDFs", () => {
  const decision = { id: "a", analysisVersion: 2, category: "aircon", space: "unknown", target: "aircon", phase: "during", phaseConfidence: 95, reason: "에어컨 본체와 청소 접촉" };
  let result = V.decorate(P.applyPhotoClassifications(plan(), [decision]), [decision]);
  assert.equal(V.flatten(result).find(r => r.id === "a").itemKey, "aircon");
  assert.equal(V.pendingRows(result).length, 1);
  result = V.confirm(V.update(result, ["a"], { phase: "during" }), ["a"], true);
  result = V.decorate(P.applyPhotoClassifications(result, [{ ...decision, category: "review" }]), [{ ...decision, target: "hood" }]);
  const a = V.flatten(result).find(r => r.id === "a");
  assert.equal(a.phase, "during"); assert.equal(a.file.reviewTarget, "aircon"); assert.equal(a.file.reviewConfirmed, true);
  const draft = P.toReportDraft(V.draftPlan(result), { core: R }).draft;
  assert.equal(draft.items.find(i => i.key === "aircon").during.length, 1);
  assert.equal(R.progress(draft), 0);
  const report = R.normalizeReport({ ...draft, id: "r1", buildingId: "b1", workDate: "2026-10-12" });
  assert.equal(R.validateReport(report).ok, true);
  for (const type of ["owner", "program"]) {
    const html = Pdf.createWorkReportHtml(report, type, { images: { a: jpeg } });
    assert.equal(html.split(jpeg).length - 1, 1); assert.match(html, /작업 중/);
  }
  const synced = V.syncDraftPhotos([{ ...report.items.find(i => i.key === "aircon"), during: [{ id: "a", driveFileId: "a", caption: "수동 설명" }] }], draft.items, ["a"]);
  assert.equal(synced.items.find(i => i.key === "aircon").during[0].caption, "수동 설명");
});

test("v2 contradictions do not get silently re-derived into an accepted category", () => {
  const result = V.decorate(plan(), [{ id: "a", analysisVersion: 2, category: "review", space: "bath", target: "floor", phase: "during", phaseConfidence: 95 }]);
  assert.equal(V.flatten(result).find(r => r.id === "a").itemKey, "");
  assert.equal(V.flatten(V.draftPlan(result)).length, 0);
});

test("time gap alone never populates move-in phases, even with timestamp filenames", () => {
  const result = P.planFromTree({ name: "입주청소(검증용)_20261012", files: [{ ...file("a"), name: "20261012_090000.jpg" }, { ...file("b"), name: "20261012_140000.jpg" }] }, { kind: "moveIn" });
  assert.ok(P.photoReviewRows(result).every(row => row.phase === "unsorted"));
});

test("refinement budget is six, manual/confident rows excluded and disagreement is not majority voting", () => {
  const first = Array.from({ length: 30 }, (_, i) => ({ id: String(i), analysisVersion: 2, category: "review", space: "unknown", target: "aircon", needsReview: true, issues: [] }));
  first[0].manual = true; first[1].needsReview = false; first[20].issues = ["contradiction"];
  const ids = Refine.reviewCandidates(first);
  assert.equal(ids.length, 6); assert.equal(ids[0], "20"); assert.ok(!ids.includes("0") && !ids.includes("1"));
  const next = Refine.mergeReview(first, [{ ...first[2], category: "hood", target: "hood", needsReview: false }]);
  assert.equal(next[2].category, "review"); assert.equal(next[2].target, "aircon"); assert.equal(next[2].reviewState, "disagreement");
  assert.deepEqual(Refine.mergeReview(first, []), first);
  const independent = Refine.mergeReview([{ ...first[2], space: "bath", phase: "during", phaseConfidence: 95 }], [{ ...first[2], category: "aircon", space: "unknown", phase: "unknown", needsReview: false }])[0];
  assert.equal(independent.category, "aircon"); assert.equal(independent.space, "bath"); assert.equal(independent.phase, "during");
  const missing = Refine.mergeReview([{ id: "m", needsReview: true }], [{ id: "m", category: "aircon", space: "unknown", needsReview: false }])[0];
  assert.equal(missing.space, "unknown");
});

test("review-only details have JPEG bounds, six-photo cap and no arbitrary URL", () => {
  const image = { id: "a", dataUrl: jpeg, detailDataUrl: jpeg };
  assert.equal(Client.validatePhotoClassificationInput({ kind: "moveIn", mode: "review", images: [image] }).images[0].detailDataUrl, jpeg);
  assert.throws(() => Client.validatePhotoClassificationInput({ kind: "moveIn", images: [image] }));
  assert.throws(() => Client.validatePhotoClassificationInput({ kind: "moveIn", mode: "review", images: [{ ...image, detailDataUrl: "https://private.invalid" }] }));
  assert.throws(() => Client.validatePhotoClassificationInput({ kind: "moveIn", mode: "review", images: Array.from({ length: 7 }, (_, i) => ({ ...image, id: String(i) })) }));
});

test("automatic during claims are rechecked and disagreement holds only the phase", () => {
  const old = { id: "action-a", analysisVersion: 2, category: "windows", space: "other", target: "window", needsReview: false, quality: "clear", phase: "during", phaseConfidence: 90, action: "wiping", issues: [], reason: "창틀 구조" };
  assert.deepEqual(Refine.reviewCandidates([old]), [old.id]);
  const next = { ...old, phase: "unknown", action: "unknown" };
  const merged = Refine.mergeReview([old], [next])[0];
  assert.equal(merged.category, "windows"); assert.equal(merged.target, "window");
  assert.equal(merged.phase, "unknown"); assert.equal(merged.phaseConfidence, 0);
  assert.ok(merged.issues.includes("phase_uncertain"));
  assert.deepEqual(Refine.mergeReview([{ ...old, manual: true }], [next]), [{ ...old, manual: true }]);
  assert.deepEqual(Refine.mergeReview([old], []), [old]);
  const missing = { ...next, category: "review", needsReview: true, quality: "unknown", issues: ["missing_result"] };
  assert.equal(Refine.mergeReview([old], [missing])[0].phase, "during");
});

test("known category with unresolved observed action is independently rechecked without reviewing every static photo", async () => {
  const old = { id: "floor-action", analysisVersion: 2, category: "corridor", space: "other", target: "floor", needsReview: false,
    quality: "clear", phase: "unknown", phaseConfidence: 85, action: "mopping", features: ["active_hand_contact"], issues: [] };
  const staticPhoto = { ...old, id: "static", action: "unknown", features: [] };
  assert.deepEqual(Refine.reviewCandidates([staticPhoto, old]), [old.id]);
  assert.deepEqual(Refine.reviewCandidates([{ ...old, manual: true }, { ...old, issues: ["non_work"] }, { ...old, features: ["inactive_tool"] }]), []);
  assert.equal(Refine.reviewCandidates(Array.from({ length: 20 }, (_, i) => ({ ...old, id: `action-${i}` }))).length, 6);
  const next = (await Client.classifyPhotosWithGateway({
    endpoint: "https://bring-crm-ai-gateway.bringengineering1008.workers.dev/v1/photo-classify", idToken: "synthetic",
    input: { kind: "common", mode: "review", images: [{ id: old.id, dataUrl: jpeg }] },
    fetchImpl: async () => Response.json({ ok: true, requestId: "phase-recheck", classifications: [{ ...old, phase: "during", phaseConfidence: 90,
      features: ["cleaning_contact", "active_hand_contact"] }] }),
  })).classifications[0];
  const result = Refine.mergeReview([old], [next])[0];
  assert.equal(result.phase, "during"); assert.equal(result.category, "corridor"); assert.equal(result.reviewState, "checked");
  assert.equal(Refine.mergeReview([old], [{ ...next, phase: "unknown" }])[0].phase, "unknown");
  assert.deepEqual(Refine.mergeReview([old], []), [old]);
  assert.deepEqual(Refine.mergeReview([staticPhoto], [{ ...next, id: staticPhoto.id }]), [staticPhoto]);
  assert.equal(Refine.mergeReview([old], [{ ...next, category: "stairs" }])[0].category, "review");
  const document = Refine.mergeReview([old], [{ ...next, category: "review", target: "unknown", phase: "unknown", needsReview: true, issues: ["non_work"] }])[0];
  assert.equal(document.category, "review"); assert.equal(document.target, "unknown");
  assert.equal(document.phase, "unknown"); assert.equal(document.reviewState, "disagreement");
  assert.deepEqual(Refine.reviewCandidates([document]), []);
  assert.deepEqual(Refine.mergeReview([{ ...old, manual: true }], [document]), [{ ...old, manual: true }]);
});

test("monthly near-identical scenes remain on different visits/activities, exact duplicate bytes do not", () => {
  const a = { id: "a", date: "2026-10-01", activityName: "공용부청소", imageHash: "hash-a", sceneHash: "0".repeat(64), sceneTone: [10, 10, 10], sceneRatio: 1 };
  const b = { ...a, id: "b", date: "2026-10-08", imageHash: "hash-b" };
  assert.equal(M.representativePhotos([a, b]).length, 2);
  assert.equal(M.representativePhotos([a, { ...b, date: a.date }]).length, 1);
  assert.equal(M.representativePhotos([a, { ...b, date: a.date, activityName: "배관 점검" }]).length, 2);
  assert.equal(M.representativePhotos([a, { ...b, imageHash: a.imageHash }]).length, 1);
});

test("review abstention with matching visible action survives real client transport without promoting unknown", async () => {
  const old = { id: "water-a", analysisVersion: 2, category: "review", target: "floor", needsReview: true, quality: "clear", phase: "during", phaseConfidence: 90, action: "washing", issues: [] };
  const wire = { ...old, phase: "unknown", phaseConfidence: 80, features: ["floor_surface", "water_flow", "cleaning_contact", "untrusted-feature"] };
  const transport = async row => (await Client.classifyPhotosWithGateway({
    endpoint: "https://bring-crm-ai-gateway.bringengineering1008.workers.dev/v1/photo-classify", idToken: "synthetic",
    input: { kind: "common", mode: "review", images: [{ id: old.id, dataUrl: jpeg }] },
    fetchImpl: async () => Response.json({ ok: true, requestId: "test-review", classifications: [row] }),
  })).classifications[0];
  const next = await transport(wire);
  assert.deepEqual(next.features, ["water_flow", "cleaning_contact"]);
  assert.equal(next.action, "washing");
  assert.equal(Refine.mergeReview([old], [next])[0].phase, "during");
  for (const change of [{ features: ["inactive_tool", "water_flow", "cleaning_contact"] }, { features: [] }, { action: "unknown" }, { target: "aircon" }, { issues: ["non_work"] }]) {
    assert.equal(Refine.mergeReview([old], [await transport({ ...wire, ...change })])[0].phase, "unknown");
  }
  const unknown = { ...old, phase: "unknown", phaseConfidence: 0 };
  assert.equal(Refine.mergeReview([unknown], [next])[0].phase, "unknown");
  assert.equal((await transport({ ...wire, action: "<script>" })).action, "unknown");
});
