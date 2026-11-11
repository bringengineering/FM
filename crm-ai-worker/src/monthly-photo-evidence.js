// Visible subjects/actions only. Free-form model prose is not an owner-facing fact.
export const SUBJECTS = Object.freeze({ entrance: "출입구", corridor: "공용 복도", stairs: "계단·계단참", handrail: "난간·손잡이", window: "창호·창틀", floor: "바닥", drain: "배수구", pipe: "배관", wall: "벽면", ceiling: "천장·조명", equipment: "설비·기기", waste: "폐기물·잔류 물품", notice: "게시물", exterior: "건물 외부", work_scene: "작업 현장", unknown: "확인 필요" });
export const ACTIONS = Object.freeze({ wiping: "닦는 작업 모습", sweeping: "쓰는 작업 모습", mopping: "물걸레 작업 모습", scrubbing: "문지르는 작업 모습", washing: "세척 작업 모습", collecting: "물품을 수거하는 모습", none: "현장 사진" });
export function monthlyEvidence(row) {
  if (row.suitable !== true || row.quality !== "clear" || row.relevance !== "supported"
    || !Object.hasOwn(SUBJECTS, row.subject) || row.subject === "unknown" || !Object.hasOwn(ACTIONS, row.action)) return null;
  // Merely present tools/people cannot become action evidence. Completion, safety
  // and unseen inspections are not expressible in this closed caption vocabulary.
  const action = row.action !== "none" && row.actionVisible === true ? row.action : "none";
  return { caption: `${SUBJECTS[row.subject]} · ${ACTIONS[action]}`,
    reason: action === "none" ? "날짜·활동 맥락과 관련된 대상이 보이는 사진" : "대상에 접촉하는 실제 작업 동작이 보이는 사진" };
}
