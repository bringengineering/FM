const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluate } = require("../src/photo-classification-evaluation");

test("unverified real-photo pairs are not counted as measured false or correct pairs", () => {
  const labels = [{ id: "a", phase: "unknown" }, { id: "b", phase: "unknown" }];
  const result = evaluate(labels, { classifications: [], pairs: [{ beforeId: "a", afterId: "b" }] });
  assert.deepEqual(result.pairs, { accepted: 1, correct: 0, falsePairs: 0, unverifiedPairs: 1 });
});
test("abstaining on every photo cannot masquerade as perfect accuracy", () => {
  const labels = [{ id: "a", category: "aircon" }, { id: "b", category: "hood" }];
  const result = evaluate(labels, { classifications: labels.map(row => ({ id: row.id, category: "review" })) });
  assert.equal(result.axes.category.acceptedPrecision, null); assert.equal(result.axes.category.coverage, 0); assert.equal(result.axes.category.reviewRate, 1);
});
test("accepted precision, coverage and false before/after pairs are reported separately", () => {
  const labels = [{ id: "a", category: "aircon", phase: "before", scene: "scene1" }, { id: "b", category: "hood", phase: "after", scene: "scene2" }];
  const result = evaluate(labels, { classifications: [{ id: "a", category: "aircon" }, { id: "b", category: "aircon" }], pairs: [{ beforeId: "a", afterId: "b" }], apiCalls: 2, durationMs: 500 });
  assert.equal(result.axes.category.acceptedPrecision, 0.5); assert.equal(result.axes.category.coverage, 1); assert.equal(result.pairs.falsePairs, 1);
  assert.equal(result.measurements.apiCalls, 2); assert.equal(JSON.stringify(result).includes("scene1"), false);
});
