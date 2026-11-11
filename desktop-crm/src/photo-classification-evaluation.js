"use strict";

// Offline evaluation only: no images, network, names, URLs or credentials needed.
// Labels must be independently checked, not copied from model predictions.
function evaluate(labels, run) {
  if (!Array.isArray(labels) || !labels.length || labels.length > 5000) throw new Error("Invalid labels");
  const expected = new Map();
  for (const row of labels) {
    if (!row || typeof row.id !== "string" || expected.has(row.id)) throw new Error("Invalid labels");
    expected.set(row.id, row);
  }
  if (!run || !Array.isArray(run.classifications) || run.classifications.length > 5000) throw new Error("Invalid run");
  const predictions = new Map();
  for (const row of run.classifications) {
    if (!row || !expected.has(row.id) || predictions.has(row.id)) throw new Error("Unexpected prediction");
    predictions.set(row.id, row);
  }
  const axes = {};
  for (const axis of ["category", "space", "target", "phase"]) {
    let labeled = 0, accepted = 0, correct = 0, abstained = 0;
    for (const label of labels) {
      if (typeof label[axis] !== "string") continue;
      labeled++;
      const value = predictions.get(label.id)?.[axis];
      if (!value || ["review", "unknown", "unsorted"].includes(value)) { abstained++; continue; }
      accepted++;
      if (value === label[axis]) correct++;
    }
    axes[axis] = { labeled, accepted, correct, abstained,
      acceptedPrecision: accepted ? correct / accepted : null,
      coverage: labeled ? accepted / labeled : null,
      reviewRate: labeled ? abstained / labeled : null };
  }
  const pairs = Array.isArray(run.pairs) ? run.pairs : [];
  const used = new Set(); let correctPairs = 0, falsePairs = 0, unverifiedPairs = 0;
  for (const pair of pairs) {
    if (!expected.has(pair?.beforeId) || !expected.has(pair.afterId) || used.has(pair.beforeId) || used.has(pair.afterId) || pair.beforeId === pair.afterId) throw new Error("Invalid pairs");
    used.add(pair.beforeId); used.add(pair.afterId);
    const a = expected.get(pair.beforeId), b = expected.get(pair.afterId);
    const sceneKnown = typeof a.scene === "string" && a.scene && typeof b.scene === "string" && b.scene;
    const phaseKnown = ["before", "during", "after"].includes(a.phase) && ["before", "during", "after"].includes(b.phase);
    if ((sceneKnown && a.scene !== b.scene) || (phaseKnown && (a.phase !== "before" || b.phase !== "after"))) falsePairs++;
    else if (sceneKnown && phaseKnown) correctPairs++;
    else unverifiedPairs++;
  }
  const finite = value => Number.isFinite(value) && value >= 0 ? value : null;
  return { sampleCount: labels.length, axes, pairs: { accepted: pairs.length, correct: correctPairs, falsePairs, unverifiedPairs },
    measurements: { durationMs: finite(run.durationMs), apiCalls: finite(run.apiCalls) } };
}

module.exports = Object.freeze({ evaluate });
