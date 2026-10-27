"use strict";

// An edit is the difference from the snapshot the editor actually saw, not
// the difference between an old renderer and the latest server document.
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
const protectedCollections = new Set(["buildings", "salesUnits", "serviceRecords"]);
const protectedCustomerFields = new Set(["marketing", "marketingUpdatedAt", "marketingUpdatedBy", "photoDataUrl", "avatarUrl", "localPath", "buildingIdLinks"]);
const segment = value => /^[A-Za-z0-9_-]{1,120}$/.test(value) && !forbidden.has(value);
const stable = value => value && typeof value === "object"
  ? Array.isArray(value) ? value.map(stable) : Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
  : value ?? null;
const same = (left, right) => JSON.stringify(stable(left)) === JSON.stringify(stable(right));
const at = (value, path) => path.split("/").reduce((node, key) => node && Object.hasOwn(node, key) ? node[key] : undefined, value);
const conflict = (partial = false) => Object.assign(new Error(partial
  ? "다른 사용자의 변경과 충돌했습니다. 일부 항목은 이미 저장되었을 수 있습니다. 입력 내용을 유지했으니 최신 자료를 확인해 주세요."
  : "다른 사용자가 같은 항목을 변경했습니다. 입력 내용을 유지했으니 최신 자료를 확인한 뒤 다시 저장해 주세요."), { code: "SHARED_SAVE_CONFLICT", partial });

function buildSharedSavePlan({ base = {}, desired = {}, current = {}, currentRaw = current, intent = {} }) {
  const patch = {}, customerWrites = [], handled = new Set();
  for (const [path, value] of Object.entries(intent)) {
    const parts = path.split("/");
    if (!parts.every(segment)) throw Object.assign(new Error("저장 항목을 확인해 주세요."), { code: "SHARED_SAVE_INVALID" });
    if (protectedCollections.has(parts[0])) continue;
    if (parts.length === 1 && ["updatedAt", "updatedBy"].includes(parts[0])) { patch[path] = value; continue; }
    if (parts[0] === "customers") {
      const id = parts[1], field = parts[2];
      if (parts.length !== 3 || protectedCustomerFields.has(field)) continue;
      const before = base.customers?.[id], next = desired.customers?.[id], live = current.customers?.[id];
      if (!before || !next) {
        if (handled.has(id)) continue;
        handled.add(id);
        if (same(live, next)) continue;
        if (!same(live, before)) throw conflict();
        const create = next ? structuredClone(next) : null;
        if (create) for (const key of protectedCustomerFields) delete create[key];
        // Whole-record deletion/replacement with append-only links is denied by
        // existing Rules as well. Never turn a generic form into a link editor.
        if (Object.keys(before?.buildingIdLinks || {}).length) throw conflict();
        customerWrites.push({ path: `customers/${id}`, expected: at(currentRaw, `customers/${id}`), value: create });
        continue;
      }
      if (!live) throw conflict(); // A stale form must never resurrect a deletion.
      if (same(at(current, path), value)) continue;
      if (field !== "updatedAt" && !same(at(current, path), at(base, path))) throw conflict();
      customerWrites.push({ path, expected: at(currentRaw, path), value });
      continue;
    }
    if (same(at(current, path), value)) continue;
    if (!same(at(current, path), at(base, path))) throw conflict();
    patch[path] = value;
  }
  return { patch, customerWrites };
}

function applySharedSavePatch(source, patch) {
  const result = structuredClone(source || {});
  for (const [path, value] of Object.entries(patch)) {
    const parts = path.split("/");
    if (!parts.every(segment)) throw Object.assign(new Error("저장 항목을 확인해 주세요."), { code: "SHARED_SAVE_INVALID" });
    let node = result;
    for (const key of parts.slice(0, -1)) {
      if (!node[key] || typeof node[key] !== "object" || Array.isArray(node[key])) node[key] = {};
      node = node[key];
    }
    if (value == null) delete node[parts.at(-1)];
    else node[parts.at(-1)] = structuredClone(value);
  }
  return result;
}

module.exports = { buildSharedSavePlan, applySharedSavePatch, same, at, conflict };
