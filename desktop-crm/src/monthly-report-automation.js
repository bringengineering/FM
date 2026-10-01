(function attach(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringMonthlyReportAutomation = api;
})(typeof globalThis === "object" ? globalThis : this, function create() {
  "use strict";
  function representativePhotos(photos, limit = 12) {
    const groups = new Map();
    for (const photo of photos) {
      const key = `${photo.date}:${photo.activityName || ""}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(photo);
    }
    const selected = [];
    while (selected.length < limit && [...groups.values()].some(items => items.length)) {
      for (const items of groups.values()) if (items.length && selected.length < limit) selected.push(items.shift());
    }
    return selected.sort((a, b) => a.date.localeCompare(b.date));
  }
  async function run({ find, select, draft, isCurrent, onProgress = () => {} }) {
    const check = () => { if (!isCurrent()) throw Object.assign(new Error("보고서 선택이나 로그인 상태가 변경되어 자동 작성을 중단했습니다."), { code: "REPORT_CHANGED" }); };
    check();
    onProgress("활동사진 찾는 중…");
    const found = await find();
    check();
    if (!found || found.ok !== true || !Array.isArray(found.photos)) throw new Error("활동사진 검색 결과를 확인하지 못했습니다.");
    const candidates = found.photos.slice(0, 120);
    const warnings = found.truncated || found.photos.length > 120 ? ["검색 범위를 초과하거나 읽지 못한 폴더·사진이 있어 일부만 검토했습니다. 활동사진 폴더를 확인해 주세요."] : [];
    if (!candidates.length) warnings.push("해당 건물·보고월과 일치하는 사진이 없습니다. CRM 기록만으로 초안을 작성했습니다.");
    const chosen = [];
    for (let at = 0; at < candidates.length; at += 24) {
      check();
      onProgress(`Gemini 사진 검토 중… ${Math.floor(at / 24) + 1}/${Math.ceil(candidates.length / 24)}`);
      const batch = candidates.slice(at, at + 24);
      const result = await select(batch);
      check();
      if (!result || result.ok !== true || !Array.isArray(result.selected)) throw new Error("Gemini 사진 선택을 완료하지 못했습니다.");
      for (const item of result.selected) {
        const candidate = batch.find(photo => photo.id === item.id);
        if (!candidate || chosen.some(photo => photo.id === item.id)) throw new Error("Gemini 사진 선택 결과를 확인하지 못했습니다.");
        chosen.push({ ...candidate, caption: String(item.caption || "현장 사진").slice(0, 140), thumbnail: "" });
      }
      warnings.push(...(Array.isArray(result.warnings) ? result.warnings.filter(item => typeof item === "string") : []));
    }
    const photos = representativePhotos(chosen);
    if (candidates.length && !photos.length) warnings.push("Gemini가 보고서에 적합한 사진을 찾지 못해 CRM 기록만 사용했습니다.");
    onProgress("Gemini 보고서 작성 중…");
    const generated = await draft(photos);
    check();
    if (!generated || generated.ok !== true || !generated.narrative?.summary) throw new Error("Gemini 보고서 초안을 확인하지 못했습니다.");
    return { generated, photos, candidates, warning: [...new Set(warnings)].join(" ").slice(0, 900) };
  }
  return { run, representativePhotos };
});
