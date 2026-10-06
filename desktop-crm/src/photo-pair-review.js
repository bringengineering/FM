(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./photo-capture-time") : root.BringPhotoCaptureTime);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringPhotoPairReview = api;
})(typeof globalThis === "object" ? globalThis : this, function (Capture) {
  "use strict";
  const SPACES = Object.freeze({ living: "거실", bedroom: "방", kitchen: "주방", bath: "욕실", veranda: "베란다", entrance: "현관", other: "기타 공간", unknown: "확인 필요" });
  const TARGETS = Object.freeze({ floor: "바닥", window: "창호·새시", sink: "세면대·싱크대", cabinet: "수납장", hood: "후드·필터", toilet: "변기", wall: "벽면", aircon: "에어컨", refrigerator: "냉장고", other: "기타 대상", unknown: "확인 필요" });
  const EVIDENCE = Object.freeze({ debris_removed: "같은 장소의 먼지·쓰레기 감소를 비교한 AI 추천입니다.", stain_reduced: "같은 표면의 오염 변화를 비교한 AI 추천입니다.", items_removed: "같은 장소의 잔류물 변화를 비교한 AI 추천입니다.", same_scene_time: "같은 장면과 원본 촬영 순서로 추천했습니다. 실제 작업 전·후인지 확인해 주세요." });
  const list = value => Array.isArray(value) ? value.filter(Boolean) : [];
  const key = (value, labels) => Object.hasOwn(labels, value) ? value : "unknown";
  const flatten = plan => list(plan?.buckets).flatMap(bucket => ["before", "after", "unsorted"].flatMap(phase => list(bucket[phase]).map(file => ({ id: String(file.id), file, phase, itemKey: bucket.itemKey || bucket.manualItemKey || "" }))));
  function rebuild(plan, rows) {
    const buckets = new Map();
    rows.forEach(row => {
      if (!buckets.has(row.itemKey)) buckets.set(row.itemKey, { itemKey: row.itemKey, folder: "사진 구역 추천", before: [], after: [], unsorted: [], heic: [], skipped: 0 });
      const bucket = buckets.get(row.itemKey); bucket[row.phase].push(row.file);
      if (/^image\/hei[cf]$/u.test(row.file.mimeType || "")) bucket.heic.push(row.file);
    });
    return { ...plan, pairReview: true, buckets: [...buckets.values()] };
  }
  function categoryFor(space, target) {
    if (key(space, SPACES) === "unknown" || key(target, TARGETS) === "unknown") return "";
    if (["hood", "aircon", "refrigerator"].includes(target)) return target;
    if (space === "bath" || space === "veranda") return space;
    if (target === "window") return "window";
    if (space === "kitchen" && ["sink", "cabinet"].includes(target)) return "kitchen";
    if (target === "cabinet") return "storage";
    if (target === "floor") return "floor";
    return "finish";
  }
  const resolved = row => !!row.itemKey && key(row.file.reviewSpace, SPACES) !== "unknown" && key(row.file.reviewTarget, TARGETS) !== "unknown" && ["before", "after"].includes(row.phase);
  function withCaptureTimes(plan, times) {
    const byId = new Map(list(times).map(row => [String(row.id), Capture.normalize(row.captureTime)]));
    return rebuild(plan, flatten(plan).map(row => byId.has(row.id) ? { ...row, file: { ...row.file, captureTime: byId.get(row.id) } } : row));
  }
  function byCaptureTime(left, right) {
    const a = Capture.normalize(left.file.captureTime), b = Capture.normalize(right.file.captureTime);
    return a && b ? a.local.localeCompare(b.local) : a ? -1 : b ? 1 : 0;
  }
  function decorate(plan, classifications) {
    const decisions = new Map(list(classifications).map(row => [String(row.id), row]));
    return rebuild(plan, flatten(plan).map(row => {
      const decision = decisions.get(row.id);
      if (!decision) return row;
      if (row.file.reviewManual || row.file.reviewConfirmed) return { ...row, itemKey: categoryFor(row.file.reviewSpace, row.file.reviewTarget) };
      const space = key(decision.space, SPACES); const target = key(decision.target, TARGETS);
      return { ...row, phase: row.file.reviewAutoPhase ? "unsorted" : row.phase, itemKey: categoryFor(space, target) || row.itemKey, file: { ...row.file, reviewSpace: space, reviewTarget: target, reviewConfirmed: false, reviewPair: "" } };
    }));
  }
  function comparisonGroups(plan) {
    const groups = new Map();
    flatten(plan).sort(byCaptureTime).filter(row => !row.file.reviewConfirmed && !row.file.reviewPair && key(row.file.reviewSpace, SPACES) !== "unknown" && key(row.file.reviewTarget, TARGETS) !== "unknown").forEach(row => {
      const id = `${row.file.reviewSpace}:${row.file.reviewTarget}`;
      if (!groups.has(id)) groups.set(id, []); groups.get(id).push(row.id);
    });
    // A 30-photo boundary must not separate all early shots from all late shots.
    // Interleave ends only for large groups; no photo is assigned a phase here.
    return [...groups.values()].filter(ids => ids.length > 1).map(ids => {
      if (ids.length <= 30) return ids;
      const mixed = [];
      for (let lo = 0, hi = ids.length - 1; lo <= hi; lo += 1, hi -= 1) {
        mixed.push(ids[lo]); if (hi !== lo) mixed.push(ids[hi]);
      }
      return mixed;
    });
  }
  function applyPairs(plan, pairs) {
    const rows = flatten(plan).map(row => ({ ...row, file: { ...row.file } })); const byId = new Map(rows.map(row => [row.id, row])); const used = new Set();
    for (const pair of list(pairs)) {
      const before = byId.get(pair.beforeId), after = byId.get(pair.afterId);
      if (!before || !after || before === after || used.has(before.id) || used.has(after.id) || !Object.hasOwn(EVIDENCE, pair.evidence)) continue;
      if (before.file.reviewSpace !== after.file.reviewSpace || before.file.reviewTarget !== after.file.reviewTarget || key(before.file.reviewSpace, SPACES) === "unknown" || key(before.file.reviewTarget, TARGETS) === "unknown") continue;
      if ([before, after].some(row => row.file.reviewConfirmed || row.file.reviewPair || row.file.reviewUnpaired)) continue;
      const gap = Capture.differenceMinutes(before.file.captureTime, after.file.captureTime);
      if (Number.isFinite(gap) && gap <= 0) continue;
      if (pair.evidence === "same_scene_time" && (!Number.isFinite(gap) || gap < 40)) continue;
      // Explicit names/time hints and manual choices outrank visual suggestions.
      if ((before.phase !== "unsorted" && before.phase !== "before") || (after.phase !== "unsorted" && after.phase !== "after")) continue;
      const pairId = `pair:${before.id}:${after.id}`;
      before.file.reviewAutoPhase = before.phase === "unsorted"; after.file.reviewAutoPhase = after.phase === "unsorted";
      before.phase = "before"; after.phase = "after";
      for (const row of [before, after]) { used.add(row.id); Object.assign(row.file, { reviewPair: pairId, reviewConfirmed: false, phaseReason: EVIDENCE[pair.evidence] }); }
    }
    return rebuild(plan, rows);
  }
  function update(plan, ids, changes) {
    const selected = new Set(ids); const all = flatten(plan); const broken = new Set(all.filter(row => selected.has(row.id)).map(row => row.file.reviewPair).filter(Boolean));
    return rebuild(plan, all.map(row => {
      const file = { ...row.file };
      if (broken.has(file.reviewPair)) Object.assign(file, { reviewPair: "", reviewConfirmed: false, reviewUnpaired: true });
      if (!selected.has(row.id)) return { ...row, file };
      if (changes.space !== undefined) file.reviewSpace = key(changes.space, SPACES);
      if (changes.target !== undefined) file.reviewTarget = key(changes.target, TARGETS);
      Object.assign(file, { reviewManual: true, reviewConfirmed: false });
      const phase = ["before", "after", "unsorted"].includes(changes.phase) ? changes.phase : row.phase;
      if (changes.phase !== undefined) { file.phaseReason = "사용자가 직접 선택했습니다."; file.reviewAutoPhase = false; }
      return { ...row, file, phase, itemKey: categoryFor(file.reviewSpace, file.reviewTarget) };
    }));
  }
  function confirm(plan, ids, checked) {
    const selected = new Set(ids);
    return rebuild(plan, flatten(plan).map(row => ({ ...row, file: { ...row.file, reviewConfirmed: selected.has(row.id) ? checked === true && resolved(row) : row.file.reviewConfirmed } })));
  }
  function swap(plan, pairId) {
    return rebuild(plan, flatten(plan).map(row => row.file.reviewPair === pairId ? { ...row, phase: row.phase === "before" ? "after" : "before", file: { ...row.file, reviewManual: true, reviewAutoPhase: false, reviewConfirmed: false, phaseReason: "사용자가 전·후를 바꿨습니다." } } : row));
  }
  function manualPair(plan, ids) {
    const selected = flatten(plan).filter(row => ids.includes(row.id));
    if (selected.length !== 2 || selected.some(row => !resolved(row)) || selected[0].phase === selected[1].phase || selected[0].file.reviewSpace !== selected[1].file.reviewSpace || selected[0].file.reviewTarget !== selected[1].file.reviewTarget) return null;
    const clean = update(plan, ids, {}); const pairId = `manual:${ids.join(":")}`;
    return rebuild(clean, flatten(clean).map(row => ids.includes(row.id) ? { ...row, file: { ...row.file, reviewPair: pairId, phaseReason: "사용자가 같은 장소의 전·후 사진으로 묶었습니다." } } : row));
  }
  function groups(plan) {
    const result = new Map();
    for (const row of flatten(plan).sort(byCaptureTime)) {
      const id = row.file.reviewPair || `single:${row.id}`;
      if (!result.has(id)) result.set(id, { id, space: key(row.file.reviewSpace, SPACES), target: key(row.file.reviewTarget, TARGETS), paired: !!row.file.reviewPair, rows: [] });
      result.get(id).rows.push(row);
    }
    return [...result.values()];
  }
  // Pair evidence is an AI hint, never a display or report admission requirement.
  // Different targets in the same room and unequal phase counts share one card.
  function areaGroups(plan) {
    const result = new Map();
    for (const row of flatten(plan).filter(resolved).sort(byCaptureTime)) {
      const space = row.file.reviewSpace;
      if (!result.has(space)) result.set(space, { space, rows: [], before: [], after: [] });
      const group = result.get(space);
      group.rows.push(row); group[row.phase].push(row);
    }
    return Object.keys(SPACES).filter(space => result.has(space)).map(space => result.get(space));
  }
  const pendingRows = plan => flatten(plan).filter(row => !resolved(row)).sort(byCaptureTime);
  function mergeSelection(incoming, existing, append = false) {
    const previous = new Map(flatten(existing).map(row => [row.id, row]));
    const selected = new Map();
    for (const row of flatten(incoming)) selected.set(row.id, previous.get(row.id) || row);
    if (append) for (const row of previous.values()) if (!selected.has(row.id)) selected.set(row.id, row);
    return rebuild({ ...incoming, selectedCount: selected.size, photoCount: selected.size }, [...selected.values()]);
  }
  function confirmedPlan(plan) { return rebuild(plan, flatten(plan).filter(row => row.file.reviewConfirmed && resolved(row))); }
  function mergeReviewed(existing, incoming) {
    const oldPhotos = new Map(list(existing).flatMap(item => list(item.before).concat(list(item.after))).map(photo => [photo.driveFileId || photo.id, photo]));
    const incomingIds = new Set(list(incoming).flatMap(item => list(item.before).concat(list(item.after))).map(photo => photo.driveFileId || photo.id));
    const items = list(existing).map(item => ({ ...item, before: list(item.before).filter(photo => !incomingIds.has(photo.driveFileId || photo.id)), after: list(item.after).filter(photo => !incomingIds.has(photo.driveFileId || photo.id)) }));
    for (const source of list(incoming)) {
      let target = items.find(item => item.key === source.key);
      if (!target) { target = { ...source, before: [], after: [] }; items.push(target); }
      for (const phase of ["before", "after"]) target[phase].push(...list(source[phase]).map(photo => ({ ...photo, ...oldPhotos.get(photo.driveFileId || photo.id) })));
    }
    return { items, added: [...incomingIds].filter(id => !oldPhotos.has(id)).length };
  }
  return Object.freeze({ SPACES, TARGETS, flatten, resolved, decorate, withCaptureTimes, byCaptureTime, comparisonGroups, applyPairs, update, confirm, swap, manualPair, groups, areaGroups, pendingRows, mergeSelection, confirmedPlan, mergeReviewed, categoryFor });
});
