const crypto = require("node:crypto");

const ENTITY_TYPES = new Set(["buildings", "buildingUnits", "salesUnits"]);
const OPERATIONS = new Set(["create", "update", "archive", "restore"]);
const UNIT_STATUSES = new Set(["unknown", "occupied", "vacant", "move_out_scheduled", "maintenance"]);
const SYSTEM_FIELDS = new Set([
  "id", "entityVersion", "createdAt", "createdByAuthUid", "createdByOperatorId",
  "updatedAt", "updatedByAuthUid", "updatedByOperatorId", "archivedAt",
  "archivedByAuthUid", "archivedByOperatorId",
]);
const FIELD_ALLOWLIST = Object.freeze({
  buildings: new Set([
    "name", "address", "type", "status", "ownerCustomerId", "unitCount", "manager", "memo",
    "aliases", "externalRefs", "rentDeposit", "monthlyRent", "maintenanceFee", "maintenanceIncludes",
    "maintenanceIncludeOther", "roomTypes", "roomTypeOther", "roomOptions", "roomOptionOther",
    "vacantUnitCount", "vacantUnits",
  ]),
  buildingUnits: new Set([
    "crmBuildingId", "label", "unitLabel", "floorLabel", "floorOrder", "unitOrder", "status",
    "moveOutAt", "availableFrom", "memo",
  ]),
  salesUnits: new Set([
    "prospectId", "crmBuildingUnitId", "label", "status", "moveOutAt", "availableFrom",
    "deposit", "rent", "maintenanceFee", "photoUrl", "evidenceUrl", "note",
  ]),
});
const FORBIDDEN_KEY = /(?:password|passcode|secret|token|credential|doorlock|door_lock|accesscode|access_code|keylocation|key_location|oauth|privatekey|private_key)/iu;
const PATH_FORBIDDEN = /[\u0000-\u001f\u007f.#$\[\]\/]/u;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function error(code, message = code) {
  const result = new Error(message);
  result.code = code;
  return result;
}

function fail(code, message) {
  throw error(code, message);
}

function record(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function safeId(value) {
  return typeof value === "string"
    && value.length > 0
    && value === value.trim()
    && Buffer.byteLength(value, "utf8") <= 120
    && !["__proto__", "prototype", "constructor"].includes(value)
    && !PATH_FORBIDDEN.test(value);
}

function canonicalTimestamp(value) {
  if (typeof value !== "string") return false;
  try { return new Date(value).toISOString() === value; } catch (_) { return false; }
}

function timestampAfter(now, previous) {
  if (!canonicalTimestamp(now)) fail("crm_timestamp_invalid");
  if (!canonicalTimestamp(previous) || Date.parse(now) > Date.parse(previous)) return now;
  return new Date(Date.parse(previous) + 1).toISOString();
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!record(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function assertNoSecretKeys(value) {
  if (Array.isArray(value)) return value.forEach(assertNoSecretKeys);
  if (!record(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) fail("crm_secret_field_forbidden");
    assertNoSecretKeys(child);
  }
}

function text(value, field, maximum = 4_000, required = false) {
  if (typeof value !== "string" || value !== value.trim() || (required && !value)
    || Buffer.byteLength(value, "utf8") > maximum || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(`crm_${field}_invalid`);
  }
  return value;
}

function integer(value, field, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(`crm_${field}_invalid`);
  return value;
}

function money(value, field) {
  return integer(value, field, 0, 1_000_000_000_000);
}

function date(value, field) {
  if (value === "") return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value) return value;
  }
  if (canonicalTimestamp(value)) return value;
  fail(`crm_${field}_invalid`);
}

function stringList(value, field, maximum = 100) {
  if (!Array.isArray(value) || value.length > maximum) fail(`crm_${field}_invalid`);
  const normalized = value.map(item => text(item, field, 256, true));
  if (new Set(normalized).size !== normalized.length) fail(`crm_${field}_invalid`);
  return normalized;
}

function normalizedUnitLabel(value) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().toLocaleLowerCase("ko-KR").replace(/\s+/gu, "")
    : "";
}

function normalizePatch(entityType, operation, value) {
  if (!record(value) || Buffer.byteLength(JSON.stringify(value), "utf8") > 24_000) fail("crm_patch_invalid");
  assertNoSecretKeys(value);
  const allowed = FIELD_ALLOWLIST[entityType];
  const result = {};
  for (const [key, raw] of Object.entries(value)) {
    if (SYSTEM_FIELDS.has(key)) fail("crm_immutable_field_forbidden");
    if (!allowed.has(key)) fail("crm_patch_field_forbidden");
    if (entityType === "buildings") {
      if (["name", "address"].includes(key)) result[key] = text(raw, key, 1_000, true);
      else if (["type", "status", "manager"].includes(key)) result[key] = text(raw, key, 256);
      else if (key === "memo") result[key] = text(raw, key);
      else if (key === "ownerCustomerId") {
        if (raw !== "" && !safeId(raw)) fail("crm_owner_customer_id_invalid");
        result[key] = raw;
      } else if (key === "unitCount") result[key] = integer(raw, key, 0, 100_000);
      else if (["rentDeposit", "monthlyRent", "maintenanceFee"].includes(key)) result[key] = money(raw, key);
      else if (key === "vacantUnitCount") result[key] = integer(raw, key, 0, 100_000);
      else if (["maintenanceIncludes", "roomTypes", "roomOptions", "aliases"].includes(key)) result[key] = stringList(raw, key);
      else if (key === "vacantUnits") result[key] = stringList(raw, key, 200);
      else if (["maintenanceIncludeOther", "roomTypeOther", "roomOptionOther"].includes(key)) result[key] = text(raw, key);
      else if (key === "externalRefs") {
        if (!record(raw) || Object.keys(raw).length !== 1 || !Object.hasOwn(raw, "paymentBuildingIds")) fail("crm_patch_field_forbidden");
        result[key] = { paymentBuildingIds: stringList(raw.paymentBuildingIds, "external_refs") };
      }
    } else if (entityType === "buildingUnits") {
      if (key === "crmBuildingId") {
        if (!safeId(raw)) fail("crm_parent_id_invalid");
        result[key] = raw;
      } else if (["label", "unitLabel"].includes(key)) {
        if ((key === "unitLabel" && Object.hasOwn(value, "label")) || Object.hasOwn(result, "label")) fail("crm_patch_field_forbidden");
        result.label = text(raw, "unit_label", 256, true);
      } else if (key === "floorLabel") result[key] = text(raw, key, 256);
      else if (key === "floorOrder") result[key] = integer(raw, key, -1_000, 1_000);
      else if (key === "unitOrder") result[key] = integer(raw, key, 0, 100_000);
      else if (key === "status") {
        if (!UNIT_STATUSES.has(raw)) fail("crm_status_invalid");
        result[key] = raw;
      } else if (["moveOutAt", "availableFrom"].includes(key)) result[key] = date(raw, key);
      else if (key === "memo") result[key] = text(raw, key);
    } else {
      if (["prospectId", "crmBuildingUnitId"].includes(key)) {
        if (!safeId(raw)) fail("crm_parent_id_invalid");
        result[key] = raw;
      } else if (key === "label") result[key] = text(raw, "unit_label", 256, true);
      else if (key === "status") result[key] = text(raw, key, 256);
      else if (["moveOutAt", "availableFrom"].includes(key)) result[key] = date(raw, key);
      else if (["deposit", "rent", "maintenanceFee"].includes(key)) result[key] = money(raw, key);
      else if (["photoUrl", "evidenceUrl", "note"].includes(key)) result[key] = text(raw, key);
    }
  }
  if (operation === "create") {
    if (entityType === "buildings" && (!Object.hasOwn(result, "name") || !Object.hasOwn(result, "address"))) fail("crm_create_fields_required");
    if (entityType === "buildingUnits" && (!Object.hasOwn(result, "crmBuildingId") || !Object.hasOwn(result, "label"))) fail("crm_create_fields_required");
    if (entityType === "salesUnits" && (!Object.hasOwn(result, "prospectId") || !Object.hasOwn(result, "label"))) fail("crm_create_fields_required");
  }
  return result;
}

function validateEntityInput(input) {
  if (!record(input)) fail("crm_request_invalid");
  const allowed = new Set(["buildVersion", "operatorId", "requestId", "entityType", "entityId", "operation", "expectedVersion", "patch", "reason"]);
  if (Object.keys(input).some(key => !allowed.has(key)) || !safeId(input.operatorId) || input.operatorId.includes("@") || !REQUEST_ID.test(input.requestId)
    || !ENTITY_TYPES.has(input.entityType) || !safeId(input.entityId) || !OPERATIONS.has(input.operation)
    || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0
    || (input.operation === "create" ? input.expectedVersion !== 0 : input.expectedVersion === 0)
    || typeof input.buildVersion !== "string" || !input.buildVersion || Buffer.byteLength(input.buildVersion, "utf8") > 64) {
    fail("crm_request_invalid");
  }
  if (input.reason !== undefined) text(input.reason, "reason", 1_000, true);
  const patch = normalizePatch(input.entityType, input.operation, input.patch);
  if (input.operation === "update" && Object.keys(patch).length === 0) fail("crm_patch_empty");
  if (["archive", "restore"].includes(input.operation) && Object.keys(patch).length) fail("crm_archive_patch_forbidden");
  return { ...input, patch };
}

function activeEntity(collection, id, code = "crm_parent_not_found") {
  const value = record(collection) ? collection[id] : null;
  if (!record(value) || value.id !== id) fail(code);
  if (value.archivedAt) fail("crm_parent_archived");
  return value;
}

function assertActor(actor) {
  if (!record(actor) || !safeId(actor.uid) || !safeId(actor.operatorId) || actor.operatorId.includes("@") || !["admin", "member"].includes(actor.role)) {
    fail("crm_mutation_forbidden");
  }
}

function actorFields(actor, now, existing) {
  const updatedAt = timestampAfter(now, existing && existing.updatedAt);
  return { updatedAt, updatedByAuthUid: actor.uid, updatedByOperatorId: actor.operatorId };
}

function isArchived(entity) {
  return record(entity) && typeof entity.archivedAt === "string" && entity.archivedAt.length > 0;
}

function unitProjection(data, buildingId, replacements = new Map()) {
  const units = new Map(Object.entries(record(data.buildingUnits) ? data.buildingUnits : {}));
  for (const [id, value] of replacements) units.set(id, value);
  const active = [...units.values()].filter(unit => record(unit) && unit.crmBuildingId === buildingId && !isArchived(unit));
  const labels = new Set();
  for (const unit of active) {
    const label = normalizedUnitLabel(unit.label);
    if (!label || labels.has(label)) fail("crm_building_unit_label_conflict");
    labels.add(label);
  }
  const vacant = active.filter(unit => unit.status === "vacant").sort((left, right) => {
    const floor = (Number.isSafeInteger(left.floorOrder) ? left.floorOrder : Number.MAX_SAFE_INTEGER)
      - (Number.isSafeInteger(right.floorOrder) ? right.floorOrder : Number.MAX_SAFE_INTEGER);
    if (floor) return floor;
    const order = (Number.isSafeInteger(left.unitOrder) ? left.unitOrder : Number.MAX_SAFE_INTEGER)
      - (Number.isSafeInteger(right.unitOrder) ? right.unitOrder : Number.MAX_SAFE_INTEGER);
    return order || String(left.label).localeCompare(String(right.label), "ko-KR");
  });
  return { active, vacantLabels: vacant.map(unit => unit.label) };
}

function legacyVacancyState(building, projection) {
  const named = Array.isArray(building.vacantUnits) ? building.vacantUnits.map(normalizedUnitLabel).filter(Boolean) : [];
  const count = Number.isSafeInteger(building.vacantUnitCount) ? building.vacantUnitCount : named.length;
  const actual = new Set(projection.vacantLabels.map(normalizedUnitLabel));
  return {
    resolved: named.every(label => actual.has(label)) && projection.vacantLabels.length >= count,
    missing: named.filter(label => !actual.has(label)),
    shortfall: Math.max(count - projection.vacantLabels.length, 0),
  };
}

function mirrorBuildingVacancy(data, buildingId, replacements, actor, now, requireResolution) {
  const buildings = record(data.buildings) ? data.buildings : {};
  const building = activeEntity(buildings, buildingId);
  const before = unitProjection(data, buildingId);
  const after = unitProjection(data, buildingId, replacements);
  if (after.active.length > 200) fail("crm_building_unit_batch_too_large");
  const beforeLegacy = legacyVacancyState(building, before);
  const afterLegacy = legacyVacancyState(building, after);
  if (requireResolution && !afterLegacy.resolved) fail("crm_vacancy_migration_required");
  return { building, beforeLegacy, afterLegacy, after };
}

function writeVacancyMirror(data, plan, actor, now) {
  if (!plan.afterLegacy.resolved) return;
  data.buildings[plan.building.id] = {
    ...plan.building,
    vacantUnitCount: plan.after.vacantLabels.length,
    vacantUnits: plan.after.vacantLabels,
    entityVersion: plan.building.entityVersion + 1,
    ...actorFields(actor, now, plan.building),
  };
}

function addReceiptAndAudit(data, scope, requestId, requestHash, actor, now, result, audit) {
  data.canonicalReceipts = record(data.canonicalReceipts) ? data.canonicalReceipts : {};
  data.canonicalAuditLogs = record(data.canonicalAuditLogs) ? data.canonicalAuditLogs : {};
  data.canonicalReceipts[requestId] = { scope, requestId, requestHash, actorUid: actor.uid, result, createdAt: now };
  const auditId = `audit_${hash({ scope, requestId }).slice(0, 32)}`;
  data.canonicalAuditLogs[auditId] = { id: auditId, scope, requestId, authUid: actor.uid, operatorId: actor.operatorId, occurredAt: now, ...audit };
}

function repeatedReceipt(data, requestId, requestHash, scope) {
  const receipt = record(data.canonicalReceipts) ? data.canonicalReceipts[requestId] : null;
  if (!receipt) return null;
  if (!record(receipt) || receipt.scope !== scope || receipt.requestHash !== requestHash || !record(receipt.result)) fail("crm_request_id_conflict");
  return { ...clone(receipt.result), repeated: true };
}

function reduceEntity(currentData, rawInput, actor, now = new Date().toISOString()) {
  assertActor(actor);
  const input = validateEntityInput(rawInput);
  const requestHash = hash(input);
  const scope = "sparkCanonicalCrmEntityV1";
  const data = clone(record(currentData) ? currentData : {});
  const repeated = repeatedReceipt(data, input.requestId, requestHash, scope);
  if (repeated) return { data, result: repeated };
  data[input.entityType] = record(data[input.entityType]) ? data[input.entityType] : {};
  const existingValue = data[input.entityType][input.entityId];
  const existing = record(existingValue) ? existingValue : null;
  if (input.operation === "create") {
    if (existingValue !== undefined && existingValue !== null) fail("crm_entity_version_conflict");
  } else {
    if (!existing || existing.id !== input.entityId) fail("crm_entity_not_found");
    if (!Number.isSafeInteger(existing.entityVersion) || existing.entityVersion < 1) fail("crm_entity_upgrade_required");
    if (existing.entityVersion !== input.expectedVersion) fail("crm_entity_version_conflict");
    if (input.operation === "archive" && isArchived(existing)) fail("crm_entity_already_archived");
    if (input.operation === "restore" && !isArchived(existing)) fail("crm_entity_not_archived");
    if (input.operation === "update" && isArchived(existing)) fail("crm_entity_archived");
  }
  const parentField = input.entityType === "buildingUnits" ? "crmBuildingId" : input.entityType === "salesUnits" ? "prospectId" : "";
  if (existing && parentField && Object.hasOwn(input.patch, parentField) && input.patch[parentField] !== existing[parentField]) fail("crm_immutable_field_forbidden");
  if (input.entityType === "salesUnits" && existing && existing.crmBuildingUnitId
    && Object.hasOwn(input.patch, "crmBuildingUnitId") && input.patch.crmBuildingUnitId !== existing.crmBuildingUnitId) fail("crm_immutable_field_forbidden");
  const entityVersion = input.operation === "create" ? 1 : input.expectedVersion + 1;
  const next = { ...(existing ? clone(existing) : {}), ...clone(input.patch), id: input.entityId, entityVersion, ...actorFields(actor, now, existing) };
  if (existing && record(existing.externalRefs) && Object.hasOwn(input.patch, "externalRefs")) {
    const requested = record(input.patch.externalRefs) ? clone(input.patch.externalRefs) : {};
    for (const [key, values] of Object.entries(existing.externalRefs)) {
      if (!key.startsWith("field") || !Array.isArray(values)) continue;
      requested[key] = [...new Set([...values, ...(Array.isArray(requested[key]) ? requested[key] : [])])];
    }
    next.externalRefs = requested;
  }
  if (!existing) Object.assign(next, {
    createdAt: next.updatedAt, createdByAuthUid: actor.uid, createdByOperatorId: actor.operatorId,
    archivedAt: "", archivedByAuthUid: "", archivedByOperatorId: "",
  });
  if (input.operation === "archive") Object.assign(next, { archivedAt: next.updatedAt, archivedByAuthUid: actor.uid, archivedByOperatorId: actor.operatorId });
  if (input.operation === "restore") Object.assign(next, { archivedAt: "", archivedByAuthUid: "", archivedByOperatorId: "" });
  if (input.entityType === "buildingUnits" && next.status === "move_out_scheduled" && !next.moveOutAt && !next.availableFrom) fail("crm_move_out_date_required");
  if (input.entityType === "buildings") {
    if (existing && Object.hasOwn(input.patch, "ownerCustomerId") && input.patch.ownerCustomerId !== existing.ownerCustomerId) fail("crm_owner_change_requires_atomic_link");
    if (next.ownerCustomerId) activeEntity(data.customers, next.ownerCustomerId);
    const formal = unitProjection(data, input.entityId);
    if (existing && formal.active.length && (Object.hasOwn(input.patch, "vacantUnits") || Object.hasOwn(input.patch, "vacantUnitCount"))) {
      const labels = formal.vacantLabels;
      if (next.vacantUnitCount !== labels.length || hash((next.vacantUnits || []).map(normalizedUnitLabel).sort()) !== hash(labels.map(normalizedUnitLabel).sort())) fail("crm_patch_field_forbidden");
    }
  }
  if (input.entityType === "buildingUnits") {
    activeEntity(data.buildings, next.crmBuildingId);
    const plan = mirrorBuildingVacancy(data, next.crmBuildingId, new Map([[input.entityId, next]]), actor, now, false);
    if (!plan.beforeLegacy.resolved) {
      if (["create", "restore"].includes(input.operation)
        || plan.afterLegacy.missing.length > plan.beforeLegacy.missing.length
        || plan.afterLegacy.shortfall > plan.beforeLegacy.shortfall) fail("crm_vacancy_migration_required");
    }
    data[input.entityType][input.entityId] = next;
    writeVacancyMirror(data, plan, actor, now);
  } else {
    if (input.entityType === "salesUnits") {
      const prospect = activeEntity(data.salesProspects, next.prospectId);
      if (next.crmBuildingUnitId) {
        const unit = activeEntity(data.buildingUnits, next.crmBuildingUnitId);
        if (!prospect.crmBuildingId || unit.crmBuildingId !== prospect.crmBuildingId) fail("crm_parent_mismatch");
      }
    }
    data[input.entityType][input.entityId] = next;
  }
  if (input.entityType === "buildings" && input.operation === "create" && next.ownerCustomerId) {
    const customer = data.customers[next.ownerCustomerId];
    // Keep the legacy buildingIds array readable, but do not rewrite it here.
    // A deterministic child-map link lets the multi-location PATCH add this
    // relationship without replacing concurrent phone, memo, or link edits on
    // the customer record from another computer.
    customer.buildingIdLinks = {
      ...(record(customer.buildingIdLinks) ? customer.buildingIdLinks : {}),
      [input.entityId]: true,
    };
  }
  const resultBase = { entityType: input.entityType, entityId: input.entityId, entityVersion, updatedAt: next.updatedAt, archivedAt: next.archivedAt || "" };
  addReceiptAndAudit(data, scope, input.requestId, requestHash, actor, now, resultBase, {
    action: `crm.canonical.${input.entityType}.${input.operation}`, entityType: input.entityType, entityId: input.entityId,
    beforeVersion: input.operation === "create" ? 0 : input.expectedVersion, afterVersion: entityVersion,
    changedFields: input.operation === "update" ? Object.keys(input.patch).sort() : [], reason: input.reason || "",
  });
  return { data, result: { ...resultBase, repeated: false } };
}

function deterministicUnitId(buildingId, label) {
  return `unit_${hash({ buildingId, normalizedLabel: normalizedUnitLabel(label) }).slice(0, 32)}`;
}

function validateBatchInput(input) {
  if (!record(input)) fail("crm_request_invalid");
  const allowed = new Set(["buildVersion", "operatorId", "requestId", "buildingId", "units"]);
  if (Object.keys(input).some(key => !allowed.has(key)) || !safeId(input.operatorId) || input.operatorId.includes("@") || !REQUEST_ID.test(input.requestId)
    || !safeId(input.buildingId) || typeof input.buildVersion !== "string" || !input.buildVersion
    || Buffer.byteLength(input.buildVersion, "utf8") > 64 || !Array.isArray(input.units)) fail("crm_request_invalid");
  if (!input.units.length) fail("crm_building_unit_batch_empty");
  if (input.units.length > 200 || Buffer.byteLength(JSON.stringify(input.units), "utf8") > 156 * 1024) fail("crm_building_unit_batch_too_large");
  const labels = new Set();
  const units = input.units.map(item => {
    if (!record(item)) fail("crm_request_invalid");
    const keys = new Set(["entityId", "expectedVersion", "label", "floorLabel", "floorOrder", "unitOrder", "status"]);
    if (Object.keys(item).some(key => !keys.has(key))) fail("crm_patch_field_forbidden");
    const hasId = Object.hasOwn(item, "entityId");
    if (hasId !== Object.hasOwn(item, "expectedVersion") || (hasId && (!safeId(item.entityId) || !Number.isSafeInteger(item.expectedVersion) || item.expectedVersion < 1))) fail("crm_request_invalid");
    const label = text(item.label, "unit_label", 256, true);
    const normalized = normalizedUnitLabel(label);
    if (!normalized || labels.has(normalized)) fail("crm_building_unit_label_conflict");
    labels.add(normalized);
    if (!UNIT_STATUSES.has(item.status)) fail("crm_status_invalid");
    if (item.status === "move_out_scheduled" && !hasId) fail("crm_move_out_date_required");
    return {
      ...(hasId ? { entityId: item.entityId, expectedVersion: item.expectedVersion } : {}),
      label, floorLabel: text(item.floorLabel, "floorLabel", 256, true),
      floorOrder: integer(item.floorOrder, "floorOrder", -1_000, 1_000),
      unitOrder: integer(item.unitOrder, "unitOrder", 0, 100_000), status: item.status,
    };
  });
  return { ...input, units };
}

function reduceBuildingUnits(currentData, rawInput, actor, now = new Date().toISOString()) {
  assertActor(actor);
  const input = validateBatchInput(rawInput);
  const requestHash = hash(input);
  const scope = "sparkCanonicalBuildingUnitsV1";
  const data = clone(record(currentData) ? currentData : {});
  const repeated = repeatedReceipt(data, input.requestId, requestHash, scope);
  if (repeated) return { data, result: repeated };
  activeEntity(data.buildings, input.buildingId);
  data.buildingUnits = record(data.buildingUnits) ? data.buildingUnits : {};
  const currentByLabel = new Map();
  for (const [id, unit] of Object.entries(data.buildingUnits)) {
    if (!record(unit) || unit.crmBuildingId !== input.buildingId || isArchived(unit)) continue;
    const label = normalizedUnitLabel(unit.label);
    if (!label || currentByLabel.has(label)) fail("crm_building_unit_label_conflict");
    currentByLabel.set(label, { id, unit });
  }
  const planned = new Map();
  const entityIds = [];
  let createdCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  for (const requested of input.units) {
    let id;
    let existing = null;
    if (requested.entityId) {
      id = requested.entityId;
      existing = data.buildingUnits[id];
      if (!record(existing) || existing.id !== id || isArchived(existing) || existing.crmBuildingId !== input.buildingId
        || existing.entityVersion !== requested.expectedVersion || normalizedUnitLabel(existing.label) !== normalizedUnitLabel(requested.label)) fail("crm_entity_version_conflict");
    } else {
      if (currentByLabel.has(normalizedUnitLabel(requested.label))) fail("crm_entity_version_conflict");
      id = deterministicUnitId(input.buildingId, requested.label);
      if (Object.hasOwn(data.buildingUnits, id)) fail("crm_entity_version_conflict");
    }
    if (planned.has(id)) fail("crm_entity_version_conflict");
    entityIds.push(id);
    const structure = { label: requested.label, floorLabel: requested.floorLabel, floorOrder: requested.floorOrder, unitOrder: requested.unitOrder };
    if (existing) {
      if (Object.entries(structure).every(([key, value]) => existing[key] === value)) {
        unchangedCount += 1;
        planned.set(id, existing);
      } else {
        const next = { ...clone(existing), ...structure, entityVersion: existing.entityVersion + 1, ...actorFields(actor, now, existing) };
        planned.set(id, next);
        updatedCount += 1;
      }
    } else {
      const updatedAt = timestampAfter(now);
      planned.set(id, {
        id, crmBuildingId: input.buildingId, ...structure, status: requested.status, moveOutAt: "", availableFrom: "", memo: "",
        entityVersion: 1, createdAt: updatedAt, createdByAuthUid: actor.uid, createdByOperatorId: actor.operatorId,
        updatedAt, updatedByAuthUid: actor.uid, updatedByOperatorId: actor.operatorId,
        archivedAt: "", archivedByAuthUid: "", archivedByOperatorId: "",
      });
      createdCount += 1;
    }
  }
  const plan = mirrorBuildingVacancy(data, input.buildingId, planned, actor, now, true);
  for (const [id, unit] of planned) data.buildingUnits[id] = unit;
  writeVacancyMirror(data, plan, actor, now);
  const resultBase = { buildingId: input.buildingId, totalUnits: input.units.length, createdCount, updatedCount, unchangedCount, entityIds, updatedAt: now };
  addReceiptAndAudit(data, scope, input.requestId, requestHash, actor, now, resultBase, {
    action: "crm.canonical.buildingUnits.configure", entityType: "buildingUnits", entityId: input.buildingId,
    createdCount, updatedCount, unchangedCount,
  });
  return { data, result: { ...resultBase, repeated: false } };
}

const ATOMIC_MUTATION_ROOTS = new Set([
  "buildings", "buildingUnits", "salesUnits", "customers",
  "canonicalReceipts", "canonicalAuditLogs",
]);

function atomicMutationPatch(beforeValue, afterValue) {
  const before = record(beforeValue) ? beforeValue : {};
  const after = record(afterValue) ? afterValue : {};
  const digest = value => value === undefined ? "__undefined__" : hash(value);
  const changedRoots = new Set([...Object.keys(before), ...Object.keys(after)]
    .filter(key => digest(before[key]) !== digest(after[key])));
  for (const key of changedRoots) {
    if (!ATOMIC_MUTATION_ROOTS.has(key)) fail("crm_atomic_patch_scope_invalid");
  }
  const patch = {};
  for (const collection of [...changedRoots].sort()) {
    const oldCollection = record(before[collection]) ? before[collection] : {};
    const newCollection = record(after[collection]) ? after[collection] : {};
    const ids = new Set([...Object.keys(oldCollection), ...Object.keys(newCollection)]);
    for (const id of [...ids].sort()) {
      if (!safeId(id)) fail("crm_atomic_patch_scope_invalid");
      if (Object.hasOwn(oldCollection, id) && !Object.hasOwn(newCollection, id)) {
        fail("crm_physical_delete_forbidden");
      }
      if (digest(oldCollection[id]) !== digest(newCollection[id])) {
        if (collection !== "customers") {
          patch[`${collection}/${id}`] = clone(newCollection[id]);
          continue;
        }
        const oldCustomer = record(oldCollection[id]) ? oldCollection[id] : {};
        const newCustomer = record(newCollection[id]) ? newCollection[id] : {};
        const oldLinks = record(oldCustomer.buildingIdLinks) ? oldCustomer.buildingIdLinks : {};
        const newLinks = record(newCustomer.buildingIdLinks) ? newCustomer.buildingIdLinks : {};
        const oldBase = clone(oldCustomer);
        const newBase = clone(newCustomer);
        delete oldBase.buildingIdLinks;
        delete newBase.buildingIdLinks;
        if (digest(oldBase) !== digest(newBase)) fail("crm_atomic_customer_patch_invalid");
        for (const buildingId of Object.keys(oldLinks)) {
          if (!safeId(buildingId) || oldLinks[buildingId] !== true || newLinks[buildingId] !== true) {
            fail("crm_atomic_customer_patch_invalid");
          }
        }
        for (const [buildingId, linked] of Object.entries(newLinks)) {
          if (!safeId(buildingId) || linked !== true) fail("crm_atomic_customer_patch_invalid");
          if (!Object.hasOwn(oldLinks, buildingId)) {
            patch[`customers/${id}/buildingIdLinks/${buildingId}`] = true;
          }
        }
      }
    }
  }
  if (!Object.keys(patch).length || Buffer.byteLength(JSON.stringify(patch), "utf8") > 1_000_000) {
    fail("crm_atomic_patch_invalid");
  }
  return patch;
}

module.exports = {
  reduceEntity,
  reduceBuildingUnits,
  atomicMutationPatch,
  normalizedUnitLabel,
  deterministicUnitId,
  hash,
};
