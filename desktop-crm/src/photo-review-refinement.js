"use strict";

const MAX_REVIEW = 6;
const ACTIONS = ["wiping", "sweeping", "mopping", "scrubbing", "washing", "collecting"];
function uncertainAction(row) {
  // The Worker retains an observed action even when its phase/cleaning-contact
  // evidence was insufficient. A known area must not hide that unresolved axis.
  // Static photos with no action are not all sent for another paid analysis.
  return row?.phase === "unknown" && row.quality === "clear" && ACTIONS.includes(row.action)
    && !(Array.isArray(row.features) && row.features.some(x => ["inactive_tool", "cloth_display"].includes(x)));
}
const eligible = row => row?.analysisVersion === 2 && (row.needsReview || row.phase === "during" || uncertainAction(row))
  && !row.manual && !row.issues?.includes("non_work");
const priority = row => Number(row.phase === "during") * 2 + Number(row.issues?.includes("contradiction")) + Number(uncertainAction(row)) * 0.5;
function reviewCandidates(classifications) {
  return (Array.isArray(classifications) ? classifications : [])
    .filter(eligible)
    .sort((a, b) => priority(b) - priority(a))
    .slice(0, MAX_REVIEW).map(row => row.id);
}

function mergeReview(first, second) {
  const reviewed = new Map((second || []).map(row => [row.id, row]));
  return first.map(old => {
    const next = reviewed.get(old.id);
    if (!next || old.manual || (!old.needsReview && old.phase !== "during" && !uncertainAction(old)) || old.issues?.includes("non_work")) return old;
    if (next.issues?.includes("non_work")) return { ...next, category: "review", space: "unknown", target: "unknown", phase: "unknown",
      action: "unknown", phaseConfidence: 0, needsReview: true, candidates: [], reviewState: "disagreement",
      reason: "재검토에서 문서·메신저 화면으로 판단되어 현장 사진 배치를 보류했습니다." };
    // Review can invalidate an automatic action claim without losing a known
    // object/room. A missing provider row is not contradictory visual evidence.
    const evidence = Array.isArray(next.features) ? next.features : [];
    // A second score below the acceptance threshold is an abstention, not a
    // contradiction, when it still observes the same valid action and target.
    // This never promotes an unknown first-pass phase or overrides contrary tools.
    const corroboratesAction = next.quality === "clear" && next.action === old.action
      && ACTIONS.includes(next.action)
      && next.target !== "unknown" && next.target === old.target
      && evidence.includes("cleaning_contact")
      && (evidence.includes("active_hand_contact") || evidence.includes("water_flow"))
      && !evidence.some(x => ["inactive_tool", "cloth_display"].includes(x))
      && !next.issues?.some(x => ["non_work", "missing_result"].includes(x));
    const phaseDisagrees = old.phase === "during" && next.phase === "unknown" && next.quality === "clear" && !corroboratesAction && !next.issues?.includes("missing_result");
    const holdPhase = row => phaseDisagrees ? { ...row, phase: "unknown", phaseConfidence: 0,
      action: "unknown", issues: [...new Set([...(row.issues || []), "phase_uncertain"])],
      reason: `${row.reason || "대상 분류는 유지합니다."} 작업 동작 판단이 달라 단계를 확인해 주세요.`.slice(0, 120) } : row;
    const conflicts = ["category", "space", "target"].some(axis => {
      const unknown = axis === "category" ? "review" : "unknown";
      return old[axis] && next[axis] && old[axis] !== unknown && next[axis] !== unknown && old[axis] !== next[axis];
    });
    if (conflicts) return holdPhase({ ...old, category: "review", needsReview: true, reviewState: "disagreement",
      issues: [...new Set([...(old.issues || []), "review_disagreement"])],
      candidates: [...new Set([old.category, next.category, ...(next.candidates || [])])].filter(x => x !== "review").slice(0, 2),
      reason: "전체·확대 재검토의 판단이 달라 보류했습니다. 후보를 직접 확인해 주세요." });
    if (next.needsReview) return holdPhase({ ...old, reviewState: "checked", reason: `${old.reason} 확대 재검토 후에도 확인이 필요합니다.`.slice(0, 120) });
    return holdPhase({ ...next,
      ...(next.space === "unknown" && old.space && old.space !== "unknown" ? { space: old.space, spaceConfidence: old.spaceConfidence } : {}),
      ...(old.phase === "during" && next.phase === "unknown" && !phaseDisagrees ? { phase: old.phase, phaseConfidence: old.phaseConfidence, action: old.action } : {}),
      reviewState: "checked", reason: `${next.reason} 전체·확대 재검토됨.`.slice(0, 120) });
  });
}

module.exports = Object.freeze({ MAX_REVIEW, reviewCandidates, mergeReview });
