import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEvidence } from "../src/photo-evidence.js";
import { classifyPhotos, readPhotoClassificationPayload, COMMON_CATEGORIES, LEGACY_COMMON_CATEGORIES, COMMON_CATEGORY_SCHEMA } from "../src/photo-classify.js";
const jpeg = "data:image/jpeg;base64,/9j/AA==";
const observed = (category, target, features, extra = {}) => ({ category, target, features, confidence: 95, targetConfidence: 95, space: "unknown", spaceConfidence: 0, phase: "unknown", phaseConfidence: 0, action: "unknown", quality: "clear", ...extra });
const result = row => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ classifications: [{ id: "p1", ...row }] }) }] } }] });
const normalize = row => normalizeEvidence(row, "common", COMMON_CATEGORIES);

test("existing clients receive only their original categories; expanded categories require an explicit capability", async () => {
  for (const categorySchema of [undefined, COMMON_CATEGORY_SCHEMA]) {
    const input = { kind: "common", images: [{ id: "anonymous", dataUrl: jpeg }], ...(categorySchema ? { categorySchema } : {}) };
    const payload = await readPhotoClassificationPayload(new Request("https://test.invalid", { method: "POST", body: JSON.stringify(input) }));
    const response = await classifyPhotos(payload, { GEMINI_API_KEY: "synthetic" }, async (_url, options) => {
      const schema = JSON.parse(options.body).generationConfig.responseJsonSchema.properties.classifications.items.properties;
      assert.deepEqual(schema.category.enum, Object.keys(categorySchema ? COMMON_CATEGORIES : LEGACY_COMMON_CATEGORIES));
      assert.deepEqual(schema.candidates.items.enum, schema.category.enum);
      return result(observed("fixtures", "other", ["utility_panel"]));
    });
    assert.equal(response.classifications[0].category, categorySchema ? "fixtures" : "review");
  }
  for (const input of [{ kind: "common", categorySchema: "anything" }, { kind: "moveIn", categorySchema: COMMON_CATEGORY_SCHEMA }]) {
    await assert.rejects(readPhotoClassificationPayload(new Request("https://test.invalid", { method: "POST", body: JSON.stringify({ ...input, images: [{ id: "a", dataUrl: jpeg }] }) })), { code: "INVALID_INPUT" });
  }
});

test("a mounted utility panel, extinguisher or notice board is a fixture without inferring an action", () => {
  for (const feature of ["utility_panel", "fire_extinguisher", "notice_board"]) {
    const row = normalize(observed("fixtures", "other", [feature]));
    assert.equal(row.category, "fixtures"); assert.equal(row.target, "other"); assert.equal(row.needsReview, false); assert.equal(row.phase, "unknown");
    assert.equal(normalize(observed("fixtures", "wall", ["wall_surface"])).category, "review");
    // Real noticeboards remain distinct from a provider claim of a screenshot.
    const screen = normalize(observed("fixtures", "other", [feature, "screen_capture"]));
    assert.equal(screen.category, "review"); assert.ok(screen.issues.includes("non_work"));
  }
});

test("review diagnostics separate score, missing structure and incompatible targets", () => {
  const low = normalize(observed("windows", "window", ["window_track"], { confidence: 60 }));
  assert.ok(low.issues.includes("category_score_low")); assert.match(low.reason, /60점.*75점/); assert.equal(low.target, "window");
  const structure = normalize(observed("drain", "floor", ["floor_surface"]));
  assert.ok(structure.issues.includes("category_evidence_missing")); assert.match(structure.reason, /대상|시각 근거/);
  const conflict = normalize(observed("drain", "floor", ["floor_surface", "drain_grate"]));
  assert.ok(conflict.issues.includes("category_target_conflict")); assert.equal(conflict.category, "review");
  const target = normalize(observed("fixtures", "other", ["utility_panel"], { targetConfidence: 60 }));
  assert.ok(target.issues.includes("target_score_low")); assert.equal(target.category, "fixtures"); assert.equal(target.needsReview, true);
});

test("provider guidance addresses observed drain/bin and floor/background confusions", async () => {
  const response = await classifyPhotos({ kind: "common", categorySchema: COMMON_CATEGORY_SCHEMA, images: [{ id: "a", dataUrl: jpeg }] }, { GEMINI_API_KEY: "synthetic" }, async (_url, options) => {
    const prompt = JSON.parse(options.body).contents[0].parts[0].text;
    assert.match(prompt, /배수구 위 쓰레기를 쓰레기통/);
    assert.match(prompt, /배경입니다.*recycle로 바꾸지/);
    assert.match(prompt, /글자가 많다는 이유로 document_layout이나 screen_capture를 넣지/);
    assert.match(prompt, /소화기·공용 설비함·계량기함·벽 부착 안내 게시판/);
    return result(observed("drain", "other", ["drain_grate"]));
  });
  assert.equal(response.classifications[0].category, "drain");
});
