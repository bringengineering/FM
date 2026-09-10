(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringContractReadinessCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const text = (value, max = 500) => String(value == null ? "" : value).trim().slice(0, max);
  const statuses = new Set(["pending", "complete", "not_applicable"]);

  function normalizeItem(item = {}) {
    return { id: text(item.id, 100), label: text(item.label, 300), party: text(item.party, 40), required: item.required !== false, evidence: text(item.evidence, 500) };
  }
  function normalizeVersion(version) {
    if (!version || typeof version !== "object" || Array.isArray(version)) return null;
    return { revisionId: text(version.revisionId, 160), modifiedAt: text(version.modifiedAt, 40), approvedAt: text(version.approvedAt, 40), approvedBy: text(version.approvedBy, 160), items: (Array.isArray(version.items) ? version.items : []).map(normalizeItem).filter(item => item.id && item.label) };
  }
  function normalizeSourceRegistry(sources) {
    return (Array.isArray(sources) ? sources : []).map(source => ({
      id: text(source.id, 100), driveFileId: text(source.driveFileId, 200), title: text(source.title, 300), contractType: text(source.contractType, 100),
      approvedVersion: normalizeVersion(source.approvedVersion), pendingVersion: normalizeVersion(source.pendingVersion),
      lastCheckedAt: text(source.lastCheckedAt, 40), syncError: text(source.syncError, 500)
    })).filter(source => source.id && source.driveFileId);
  }
  function diffApprovedTemplate(previous = {}, next = {}) {
    const before = new Map((previous.items || []).map(item => [String(item.id), normalizeItem(item)]));
    const after = new Map((next.items || []).map(item => [String(item.id), normalizeItem(item)]));
    const result = [];
    for (const [id, item] of before) {
      if (!after.has(id)) result.push({ kind: "removed", id, before: item, after: null });
      else if (JSON.stringify(item) !== JSON.stringify(after.get(id))) result.push({ kind: "changed", id, before: item, after: after.get(id) });
    }
    for (const [id, item] of after) if (!before.has(id)) result.push({ kind: "added", id, before: null, after: item });
    const order = { changed: 0, removed: 1, added: 2 };
    return result.sort((left, right) => order[left.kind] - order[right.kind] || left.id.localeCompare(right.id));
  }
  function createReadinessChecklist(input = {}) {
    const version = normalizeVersion(input.source?.approvedVersion);
    if (!version || !version.revisionId) throw new Error("승인된 계약 기준이 없습니다.");
    const now = new Date().toISOString();
    return {
      id: `ready_${text(input.customerId, 80)}_${Date.now()}`, customerId: text(input.customerId, 100), contractId: text(input.contractId, 100),
      contractType: text(input.contractType, 100), owner: text(input.owner, 100), dueDate: text(input.dueDate, 10),
      sourceDriveFileId: text(input.source.driveFileId, 200), sourceRevisionId: version.revisionId,
      items: version.items.map(item => ({ ...item, status: "pending", note: "", completedAt: "", completedBy: "" })),
      createdAt: now, updatedAt: now
    };
  }
  function summarizeReadiness(checklist = {}) {
    const requiredItems = (Array.isArray(checklist.items) ? checklist.items : []).filter(item => item.required !== false && item.status !== "not_applicable");
    const complete = requiredItems.filter(item => statuses.has(item.status) && item.status === "complete").length;
    const required = requiredItems.length;
    return { required, complete, pending: Math.max(0, required - complete), percent: required ? Math.round(complete / required * 100) : 100 };
  }
  return { normalizeSourceRegistry, diffApprovedTemplate, createReadinessChecklist, summarizeReadiness };
});
