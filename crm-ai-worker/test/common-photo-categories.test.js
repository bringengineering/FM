import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEvidence } from "../src/photo-evidence.js";
import { COMMON_CATEGORIES, classifyPhotos } from "../src/photo-classify.js";

const observed = (category, target, features, patch = {}) => ({
  category, target, features, confidence: 96, targetConfidence: 96,
  space: "other", spaceConfidence: 95, quality: "clear",
  phase: "unknown", phaseConfidence: 0, action: "unknown", ...patch,
});
const check = row => normalizeEvidence(row, "common", COMMON_CATEGORIES);
const cases = [
  ["stairs", "floor", ["stair_landing"]],
  ["windows", "window", ["window_track"]],
  ["glass", "window", ["glass_pane"]],
  ["yard", "floor", ["outdoor_yard", "floor_surface"]],
  ["parking", "floor", ["parking_markings", "floor_surface"]],
  ["drain", "other", ["drain_grate"]],
  ["rooftop", "floor", ["rooftop_boundary", "floor_surface"]],
  ["elevator", "other", ["elevator_structure"]],
  ["walls", "wall", ["wall_surface"]],
  ["walls", "other", ["door_surface"]],
  ["fixtures", "other", ["fire_extinguisher"]],
  ["fixtures", "other", ["utility_panel"]],
  ["fixtures", "other", ["notice_board"]],
];

test("specific common areas require their own visible evidence, not just a high score", () => {
  for (const [category, target, features] of cases) {
    const row = observed(category, target, features);
    assert.equal(check(row).category, category, category);
    assert.equal(check(row).target, target, category);
    assert.equal(check(row).needsReview, false, category);
    assert.equal(check({ ...row, features: ["floor_surface"] }).category, "review", category);
    assert.equal(check({ ...row, quality: "blurred" }).category, "review", category);
  }
  for (const category of ["yard", "parking", "rooftop"]) {
    const [, target, features] = cases.find(row => row[0] === category);
    assert.equal(check(observed(category, target, features.filter(x => x !== "floor_surface"))).category, "review");
  }
});

test("landing, handrail, window track and glass stay distinct even with shared backgrounds", () => {
  assert.equal(check(observed("stairs", "floor", ["stair_landing", "balustrade"])).category, "stairs");
  assert.equal(check(observed("handrail", "other", ["steps", "balustrade"])).category, "handrail");
  assert.equal(check(observed("corridor", "floor", ["stair_landing", "floor_surface"])).category, "review");
  assert.equal(check(observed("windows", "window", ["glass_pane"])).category, "review");
  assert.equal(check(observed("glass", "window", ["window_frame"])).category, "review");
  assert.equal(check(observed("parking", "floor", ["outdoor_yard", "floor_surface"])).category, "review");
  assert.equal(check(observed("yard", "floor", ["open_walkway", "floor_surface"])).category, "review");
  assert.equal(check(observed("final", "floor", ["floor_surface", "outdoor_yard"])).category, "review");
});

test("Gemini schema exposes every common category and keeps new area decisions through the real normalizer", async () => {
  const rows = cases.slice(0, 9);
  let calls = 0;
  const result = await classifyPhotos({ kind: "common", categorySchema: "common-v2", images: rows.map((_, i) => ({ id: `local_${i}`, dataUrl: "data:image/jpeg;base64,/9j/AA==" })) }, { GEMINI_API_KEY: "synthetic" }, async (_url, options) => {
    const body = JSON.parse(options.body);
    const schema = body.generationConfig.responseJsonSchema.properties.classifications.items.properties;
    assert.deepEqual(schema.category.enum, Object.keys(COMMON_CATEGORIES));
    const prompt = body.contents[0].parts[0].text;
    assert.match(prompt, /계단과 직접 이어지는 평평한 계단참/);
    assert.match(prompt, /배경의 차 한 대만으로 주차장이라고 하지/);
    const batch = rows.slice(calls * 6, ++calls * 6);
    return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ classifications: batch.map(([category, target, features], i) => ({ id: `p${i + 1}`, ...observed(category, target, features) })) }) }] } }] });
  });
  assert.equal(calls, 2);
  assert.deepEqual(result.classifications.map(row => row.category), rows.map(row => row[0]));
  assert.deepEqual(result.classifications.map(row => row.id), rows.map((_, i) => `local_${i}`));
});
