import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEvidence, FEATURES } from "../src/photo-evidence.js";
import { CATEGORIES, normalizePairs, classifyPhotos, readPhotoClassificationPayload } from "../src/photo-classify.js";
import { monthlyEvidence } from "../src/monthly-photo-evidence.js";
const base = { category: "aircon", space: "unknown", target: "aircon", confidence: 95, spaceConfidence: 0, targetConfidence: 96, quality: "clear", features: ["aircon_body"], phase: "unknown", phaseConfidence: 0, action: "unknown" };
const normalize = row => normalizeEvidence({ ...base, ...row }, "moveIn", CATEGORIES);

test("document and messenger evidence overrides apparent fixtures and never becomes a work photo", () => {
  for (const marker of ["screen_capture", "document_layout"]) {
    const row = normalize({ confidence: 99, phase: "during", phaseConfidence: 99, action: "wiping", features: ["aircon_body", "cleaning_contact", marker] });
    assert.equal(row.category, "review"); assert.equal(row.target, "unknown"); assert.equal(row.phase, "unknown");
    assert.ok(row.needsReview); assert.ok(row.issues.includes("non_work")); assert.match(row.reason, /문서·메신저/);
  }
  // A small sign photographed in a real scene is not itself a document screenshot.
  assert.equal(normalize({ features: ["aircon_body"] }).category, "aircon");
});

test("visible bathroom plumbing can be retained as a known other target", () => {
  const row = normalize({ category: "bath", space: "bath", spaceConfidence: 95, target: "other", features: ["room_fixtures", "plumbing_fixture"] });
  assert.equal(row.category, "bath"); assert.equal(row.target, "other"); assert.equal(row.space, "bath");
});

test("named room fixtures recover known rooms, a lone sink or bucket does not", () => {
  const kitchen = { category: "kitchen", space: "kitchen", spaceConfidence: 95, target: "sink", features: ["sink_bowl", "cabinet_interior"] };
  assert.equal(normalize(kitchen).space, "kitchen");
  assert.equal(normalize(kitchen).category, "kitchen");
  assert.equal(normalize({ ...kitchen, features: ["sink_bowl"] }).space, "unknown");
  assert.equal(normalize({ ...kitchen, features: ["sink_bowl", "waste_bins"] }).space, "unknown");
  assert.equal(normalize({ category: "bath", space: "bath", spaceConfidence: 90, target: "other", features: ["bath_fixture", "plumbing_fixture"] }).space, "bath");
});

test("common floor includes visibly bounded open walkways, not unidentified floor closeups", () => {
  const categories = { corridor: "복도·공용 바닥", review: "분류 확인 필요" };
  const observed = { ...base, category: "corridor", space: "other", spaceConfidence: 90, target: "floor",
    features: ["open_walkway", "floor_surface", "cleaning_contact", "active_hand_contact"],
    phase: "during", phaseConfidence: 90, action: "scrubbing", contact: "driving_tool", water: "none" };
  const check = changes => normalizeEvidence({ ...observed, ...changes }, "common", categories);
  assert.equal(check({}).category, "corridor"); assert.equal(check({}).space, "other");
  assert.equal(check({}).target, "floor"); assert.equal(check({}).phase, "during");
  for (const features of [["floor_surface"], ["open_walkway"], ["sky", "floor_surface"]]) {
    assert.equal(check({ features }).category, "review");
  }
  assert.equal(check({ features: ["open_walkway", "floor_surface"] }).phase, "unknown");
  assert.equal(check({ quality: "blurred" }).category, "review");
  assert.equal(check({ target: "window", features: [...observed.features, "window_frame"] }).category, "review");
});

test("a visible ceiling surface does not require a light fixture or become a wall", () => {
  const categories = { lighting: "조명·천장", review: "분류 확인 필요" };
  const observed = { ...base, category: "lighting", target: "other", features: ["ceiling_surface", "cleaning_contact", "active_hand_contact"],
    phase: "during", phaseConfidence: 90, action: "sweeping", contact: "driving_tool", water: "none" };
  const check = changes => normalizeEvidence({ ...observed, ...changes }, "common", categories);
  assert.equal(check({}).category, "lighting"); assert.equal(check({}).target, "other");
  assert.equal(check({}).phase, "during"); assert.equal(check({}).space, "unknown");
  assert.equal(check({ features: ["ceiling_surface"] }).phase, "unknown");
  assert.equal(check({ features: ["ceiling_fixture"] }).category, "lighting");
  assert.equal(check({ features: ["wall_surface"], target: "wall" }).category, "review");
  assert.equal(check({ features: ["ceiling_surface", "wall_surface"], target: "wall" }).category, "review");
});

test("inactive-tool evidence wins over high action confidence and contact, even after display cap", () => {
  for (const marker of ["inactive_tool", "supporting_hand", "cloth_display"]) {
    const row = normalize({ phase: "during", phaseConfidence: 99, action: "sweeping", features: ["aircon_body", "cleaning_contact", "floor_surface", "window_frame", "sink_bowl", "cabinet_interior", "toilet_bowl", "wall_surface", marker] });
    assert.equal(row.phase, "unknown"); assert.equal(row.action, "unknown");
    assert.equal(row.category, "aircon");
  }
});
test("appliance unknown-room classification has independent confidence and does not require guessing a room", () => {
  const a = normalize({}); assert.equal(a.category, "aircon"); assert.equal(a.target, "aircon"); assert.equal(a.space, "unknown"); assert.equal(a.needsReview, false);
  assert.match(a.reason, /에어컨 본체/);
  assert.doesNotMatch(normalize({ features: ["aircon_body", "<script>"] }).reason, /<script>/);
  const b = normalize({ confidence: 30 }); assert.equal(b.category, "review"); assert.equal(b.target, "aircon");
  assert.equal(normalize({ targetConfidence: 30 }).target, "unknown");
});
test("inconsistent hood/bath/floor is held even at score 99", () => {
  const a = normalize({ category: "hood", space: "bath", spaceConfidence: 99, target: "floor", features: ["room_fixtures", "floor_surface"] });
  assert.equal(a.category, "review"); assert.ok(a.issues.includes("contradiction")); assert.equal(a.target, "floor");
});
test("loose plastic/mesh does not identify an appliance; decisive frame/body does", () => {
  assert.equal(normalize({ features: ["plastic_mesh"] }).category, "review");
  assert.equal(normalize({ features: ["plastic_mesh", "aircon_filter_frame"] }).category, "aircon");
  assert.equal(normalize({ category: "refrigerator", target: "refrigerator", features: ["transparent_drawer"] }).category, "review");
  assert.equal(normalize({ category: "refrigerator", target: "refrigerator", features: ["transparent_drawer", "shelf_rail"] }).category, "refrigerator");
});
test("during needs clear photo, contact and permitted action; standing person or clean surface is not enough", () => {
  const a = { phase: "during", phaseConfidence: 95, action: "wiping", contact: "wiping_surface", water: "none", features: ["aircon_body", "cleaning_contact", "active_hand_contact"] };
  assert.equal(normalize(a).phase, "during");
  for (const change of [{ quality: "blurred" }, { features: ["aircon_body"] }, { action: "standing" }, { phase: "after" }]) assert.equal(normalize({ ...a, ...change }).phase, "unknown");
  assert.equal(normalize({ ...a, features: ["aircon_body", "cleaning_contact"] }).phase, "unknown");
  assert.equal(normalize({ ...a, features: [...a.features, "supporting_hand"] }).phase, "during");
  assert.equal(normalize({ ...a, features: [...a.features, "inactive_tool"] }).phase, "unknown");
  assert.equal(normalize({ ...a, action: "washing", contact: "none", water: "jet_to_target", features: ["aircon_body", "cleaning_contact", "water_flow"] }).phase, "during");
});

test("holding a wet filter and stationary tap cannot claim an action without literal contact or flow", () => {
  const claimed = { phase: "during", phaseConfidence: 99, action: "washing", contact: "holding_object", water: "droplets_only", features: ["aircon_body", "cleaning_contact", "active_hand_contact", "water_flow"] };
  for (const water of ["droplets_only", "wet_surface", "none", "unknown", "<script>"]) {
    const row = normalize({ ...claimed, water });
    assert.equal(row.phase, "unknown"); assert.equal(row.action, "unknown");
    assert.equal(row.category, "aircon"); assert.equal(row.target, "aircon");
  }
  assert.equal(normalize({ ...claimed, water: "jet_to_target" }).phase, "during");
  assert.equal(normalize({ ...claimed, contact: "wiping_surface", action: "wiping" }).phase, "during");
  assert.equal(normalize({ ...claimed, contact: undefined, water: undefined }).phase, "unknown");
  assert.equal(normalize({ ...claimed, contact: "bracing" }).phase, "unknown");
});
test("pair requires visible change and two distinct fixed anchors, never only time or duplicate anchors", () => {
  const images = [{ id: "a", captureMinute: 0 }, { id: "b", captureMinute: 90 }];
  const pair = { beforeId: "a", afterId: "b", matchConfidence: 99, phaseConfidence: 99, evidence: "stain_reduced", anchors: ["tile_pattern", "fixture_position"] };
  const check = change => normalizePairs(JSON.stringify({ pairs: [{ ...pair, ...change }] }), images);
  assert.equal(check({}).length, 1);
  for (const change of [{ evidence: "same_scene_time" }, { anchors: [] }, { anchors: ["tile_pattern", "tile_pattern"] }, { anchors: ["<script>", "fixture_position"] }]) assert.equal(check(change).length, 0);
});
test("review sends whole/detail with aliases only; bounds and errors stay closed", async () => {
  const jpeg = "data:image/jpeg;base64,/9j/AA==";
  const request = images => new Request("https://test.invalid", { method: "POST", body: JSON.stringify({ kind: "moveIn", mode: "review", images }) });
  const payload = await readPhotoClassificationPayload(request([{ id: "private_id", dataUrl: jpeg, detailDataUrl: jpeg }]));
  let calls = 0;
  const result = await classifyPhotos(payload, { GEMINI_API_KEY: "synthetic" }, async (_, init) => {
    calls++; const body = JSON.parse(init.body); assert.doesNotMatch(init.body, /private_id/);
    assert.equal(body.contents[0].parts.filter(p => p.inline_data).length, 2);
    return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ classifications: [{ id: "p1", ...base }] }) }] } }] });
  });
  assert.equal(calls, 1); assert.equal(result.classifications[0].id, "private_id");
  await assert.rejects(() => readPhotoClassificationPayload(request(Array.from({ length: 7 }, (_, i) => ({ id: String(i), dataUrl: jpeg })))), { code: "INPUT_TOO_LARGE" });
  await assert.rejects(() => readPhotoClassificationPayload(request([{ id: "a", dataUrl: jpeg, detailDataUrl: "data:image/jpeg;base64,AAAA" }])), { code: "INVALID_INPUT" });
});

test("nested enum arrays avoid provider grammar expansion but keep local bounds", async () => {
  const result = await classifyPhotos({ kind: "moveIn", images: [{ id: "local1", dataUrl: "data:image/jpeg;base64,/9j/AA==" }] }, { GEMINI_API_KEY: "synthetic" }, async (_, init) => {
    const schema = JSON.parse(init.body).generationConfig.responseJsonSchema.properties.classifications.items.properties;
    assert.equal(schema.features.maxItems, undefined);
    assert.equal(schema.candidates.maxItems, undefined);
    assert.deepEqual(schema.features.items.enum, FEATURES);
    const row = { id: "p1", ...base, features: [...FEATURES, "untrusted-feature"], candidates: [...Object.keys(CATEGORIES), "untrusted-category"] };
    return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ classifications: [row] }) }] } }] });
  });
  const row = result.classifications[0];
  assert.ok(row.features.length <= 8); assert.ok(row.candidates.length <= 2);
  assert.equal(JSON.stringify(row).includes("untrusted"), false);
  // Non-work markers after the eight-item display cap still deny classification.
  assert.ok(row.issues.includes("non_work")); assert.equal(row.category, "review");
});
test("monthly captions cannot echo model prose or claim unobserved completion/inspection", () => {
  const row = { suitable: true, quality: "clear", relevance: "supported", subject: "stairs", action: "mopping", actionVisible: true, caption: "완료, 비밀번호 1234" };
  assert.deepEqual(monthlyEvidence(row), { caption: "계단·계단참 · 물걸레 작업 모습", reason: "대상에 접촉하는 실제 작업 동작이 보이는 사진" });
  assert.equal(monthlyEvidence({ ...row, actionVisible: false }).caption, "계단·계단참 · 현장 사진");
  for (const change of [{ quality: "blurred" }, { relevance: "uncertain" }, { subject: "personal_data" }, { action: "inspection_complete" }]) assert.equal(monthlyEvidence({ ...row, ...change }), null);
});
