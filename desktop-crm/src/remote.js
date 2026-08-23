const crypto = require("node:crypto");
const http = require("node:http");
const path = require("node:path");
const SparkCanonical = require("./spark-canonical");

const FIREBASE = Object.freeze({
  apiKey: "AIzaSyBKOTIuQ8pOKSuaeKFQs_6UDdDnxdjCTZg",
  databaseUrl: "https://bring-fm-default-rtdb.asia-southeast1.firebasedatabase.app",
  authPageUrl: "https://bring-fm.web.app/crm-auth/"
});
const DEFAULT_CASE_AUTOMATION_ENDPOINT = "https://script.google.com/macros/s/AKfycbxGAdtEDoNifxkM-e_Jm7dBkCnjM4oPJqz8RxZXoMoSKod5M_m9Yj2b11-nI97zmfd6Jw/exec";
const VENDOR_CSV_URL = "https://docs.google.com/spreadsheets/d/1SYC0CofvdPLE1AQax_IgLx3FFWmntXi4H6yQttV9y4A/export?format=csv&gid=0";
const WORKFLOW_ACTIONS = new Set([
  "healthCheck", "sendComplaintReceiptSms", "sendVendorEstimateMms",
  "getOwnerRecommendationPreview", "ensureOwnerDecisionLink",
  "sendOwnerRecommendationMms", "confirmOwnerRecommendationMms",
  "uploadQuoteFile", "uploadBusinessRegistration", "uploadWorkPhoto",
  "confirmQuoteAmount", "applyBusinessRegistrationToQuote", "confirmCasePayment",
  "syncPaymentBuildings", "syncPaymentSchedules", "syncPopbillBankTransactions",
  "sendPaymentReminderSms", "getPaymentReminderDeliveryStatus"
]);

const SHARED_COLLECTIONS = Object.freeze([
  "customers", "buildings", "activities", "contracts", "partnerVendors", "partnerQuotes", "tasks", "serviceRecords", "serviceContracts", "serviceSchedules",
  "securityAssets", "auditLogs", "securityIncidents",
  "salesProspects", "salesContacts", "salesUnits", "salesActivities", "salesEvents", "salesOpportunities"
]);
const CANONICAL_SHARED_COLLECTIONS = Object.freeze(["buildings", "salesUnits"]);
const PENDING_STORE_VERSION = 5;
const CANONICAL_PENDING_VERSION = 1;
function canonicalEntityMutationForValidation(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const source = Object.assign(Object.create(null), input);
  delete source.requestId;
  delete source.entityId;
  delete source.expectedVersion;
  return source;
}

function buildingUnitsMutationForValidation(input) {
  const source = canonicalEntityMutationForValidation(input);
  if (source && Array.isArray(source.units)) {
    source.units = source.units.map(item => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const copy = Object.assign(Object.create(null), item);
      delete copy.entityId;
      delete copy.expectedVersion;
      return copy;
    });
  }
  return source;
}

function canonicalMutationIntent(kind, input) {
  const source = input && typeof input === "object" && !Array.isArray(input)
    ? structuredClone(input)
    : {};
  delete source.requestId;
  delete source.buildVersion;
  if (kind === "entity" && source.operation === "create") delete source.entityId;
  return SparkCanonical.hash({ kind, input: source });
}

const PROTECTED_JSON_FORMAT = "bring-crm-protected-json";
const PROTECTED_JSON_VERSION = 1;

function presentSharedCollections(store, declaredCollections) {
  const source = store && typeof store === "object" ? store : {};
  const declared = Array.isArray(declaredCollections) ? new Set(declaredCollections) : null;
  return SHARED_COLLECTIONS.filter(collection => Object.prototype.hasOwnProperty.call(source, collection)
    && (!declared || declared.has(collection)));
}

function jsonEqual(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function mapById(items) {
  const result = {};
  for (const item of Array.isArray(items) ? items : []) {
    if (item && item.id) result[item.id] = item;
  }
  return result;
}

function listFromMap(value) {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return Object.values(value).filter(Boolean);
}

function toRemoteStore(input, actor) {
  const payload = {
    schemaVersion: Number(input.schemaVersion) || 3,
    company: input.company || {},
    updatedAt: input.updatedAt || new Date().toISOString(),
    updatedBy: actor || ""
  };
  for (const collection of SHARED_COLLECTIONS) payload[collection] = mapById(input[collection]);
  return payload;
}

function sharedRemoteProjection(Core, input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const localShape = {};
  for (const collection of SHARED_COLLECTIONS) {
    if (Object.prototype.hasOwnProperty.call(source, collection)) {
      localShape[collection] = listFromMap(source[collection]);
    }
  }
  if (Object.prototype.hasOwnProperty.call(source, "schemaVersion")) localShape.schemaVersion = source.schemaVersion;
  if (Object.prototype.hasOwnProperty.call(source, "company")) localShape.company = source.company;
  if (Object.prototype.hasOwnProperty.call(source, "updatedAt")) localShape.updatedAt = source.updatedAt;
  const sanitized = Core.sanitizeSharedStore(localShape);
  const result = {};
  if (Object.prototype.hasOwnProperty.call(source, "schemaVersion")) result.schemaVersion = sanitized.schemaVersion;
  if (Object.prototype.hasOwnProperty.call(source, "company")) result.company = sanitized.company;
  if (Object.prototype.hasOwnProperty.call(source, "updatedAt")) result.updatedAt = sanitized.updatedAt;
  if (Object.prototype.hasOwnProperty.call(source, "updatedBy")) result.updatedBy = String(source.updatedBy || "").slice(0, 320);
  for (const collection of SHARED_COLLECTIONS) {
    if (Object.prototype.hasOwnProperty.call(source, collection)) result[collection] = mapById(sanitized[collection]);
  }
  return result;
}

function mergeRemoteStore(Core, remote, local, user) {
  const base = Core.sanitizeSharedStore(local || Core.blankSharedStore());
  const source = remote && typeof remote === "object" ? remote : {};
  const merged = Object.assign({}, base, {
    company: Object.assign({}, base.company, source.company || {}),
    updatedAt: source.updatedAt || base.updatedAt
  });
  const hasRemoteRoot = Boolean(remote && typeof remote === "object");
  if (hasRemoteRoot) {
    for (const collection of SHARED_COLLECTIONS) merged[collection] = listFromMap(source[collection]);
  }
  merged.settings = Object.assign({}, base.settings, {
    owner: user && (user.displayName || user.email) || base.settings.owner
  });
  return Core.sanitizeSharedStore(merged);
}

function mergeRendererOverlays(Core, sharedStore, buildingUnits, fieldSummaries, marketingLeads) {
  return Core.sanitizeRendererStore(Object.assign({}, sharedStore || {}, {
    buildingUnits: listFromMap(buildingUnits),
    fieldSummaries: listFromMap(fieldSummaries),
    marketingLeads: listFromMap(marketingLeads)
  }));
}

function customerBuildingLinks(value) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value.buildingIdLinks
    : null;
  return source && typeof source === "object" && !Array.isArray(source) ? source : {};
}

function appendCustomerPatch(patch, customerId, previousValue, nextValue) {
  const before = previousValue && typeof previousValue === "object" && !Array.isArray(previousValue)
    ? previousValue
    : {};
  const next = nextValue && typeof nextValue === "object" && !Array.isArray(nextValue)
    ? nextValue
    : {};
  const beforeLinks = customerBuildingLinks(before);
  const nextLinks = customerBuildingLinks(next);

  for (const [buildingId, linked] of Object.entries(beforeLinks)) {
    if (linked === true && nextLinks[buildingId] !== true) {
      throw createError(
        "A customer-to-building link is append-only and cannot be changed or removed.",
        "CUSTOMER_BUILDING_LINK_IMMUTABLE"
      );
    }
  }
  for (const [buildingId, linked] of Object.entries(nextLinks)) {
    if (linked !== true) {
      throw createError(
        "A customer-to-building link must be the boolean value true.",
        "CUSTOMER_BUILDING_LINK_INVALID"
      );
    }
    if (beforeLinks[buildingId] !== true) {
      patch[`customers/${customerId}/buildingIdLinks/${buildingId}`] = true;
    }
  }

  const fields = new Set([...Object.keys(before), ...Object.keys(next)]);
  fields.delete("buildingIdLinks");
  for (const field of fields) {
    if (!jsonEqual(before[field], next[field])) {
      patch[`customers/${customerId}/${field}`] = Object.prototype.hasOwnProperty.call(next, field)
        ? next[field]
        : null;
    }
  }
}

function diffRemoteStores(previous, next) {
  const before = previous && typeof previous === "object" ? previous : {};
  const patch = {};
  for (const key of ["schemaVersion", "company", "updatedAt", "updatedBy"]) {
    if (!jsonEqual(before[key], next[key])) patch[key] = next[key] ?? null;
  }
  for (const collection of SHARED_COLLECTIONS) {
    const oldMap = before[collection] && typeof before[collection] === "object" ? before[collection] : {};
    const newMap = next[collection] && typeof next[collection] === "object" ? next[collection] : {};
    for (const id of new Set([...Object.keys(oldMap), ...Object.keys(newMap)])) {
      if (jsonEqual(oldMap[id], newMap[id])) continue;
      if (collection === "customers") appendCustomerPatch(patch, id, oldMap[id], newMap[id]);
      else patch[`${collection}/${id}`] = newMap[id] ?? null;
    }
  }
  return patch;
}

function pendingSyncPatch(Core, baseRemote, desired, currentRemote, presentCollections) {
  const base = baseRemote && typeof baseRemote === "object" ? baseRemote : {};
  const current = currentRemote && typeof currentRemote === "object" ? currentRemote : {};
  const patch = diffRemoteStores(base, desired);
  const authoritativeCollections = new Set(Array.isArray(presentCollections) ? presentCollections : SHARED_COLLECTIONS);
  const baseQuotes = base.partnerQuotes && typeof base.partnerQuotes === "object" ? base.partnerQuotes : {};
  const desiredQuotes = desired && desired.partnerQuotes && typeof desired.partnerQuotes === "object" ? desired.partnerQuotes : {};
  const currentQuotes = current.partnerQuotes && typeof current.partnerQuotes === "object" ? current.partnerQuotes : {};
  const baseVendors = base.partnerVendors && typeof base.partnerVendors === "object" ? base.partnerVendors : {};
  const desiredVendors = desired && desired.partnerVendors && typeof desired.partnerVendors === "object" ? desired.partnerVendors : {};
  const currentVendors = current.partnerVendors && typeof current.partnerVendors === "object" ? current.partnerVendors : {};

  Object.entries(desiredQuotes).forEach(([quoteId, desiredQuote]) => {
    const vendorId = String(desiredQuote && desiredQuote.vendorId || "");
    const baseQuote = baseQuotes[quoteId];
    if (!vendorId.startsWith("pvd_legacy_") || !baseQuote || String(baseQuote.vendorId || "").trim()) return;
    const quoteWithoutLink = Object.assign({}, desiredQuote);
    const normalizedBaseQuote = Core.sanitizeSharedStore({ partnerQuotes: [baseQuote] }).partnerQuotes[0] || {};
    const legacyBaseQuote = Object.assign({}, normalizedBaseQuote);
    delete quoteWithoutLink.vendorId;
    delete legacyBaseQuote.vendorId;
    if (!jsonEqual(legacyBaseQuote, quoteWithoutLink)) return;

    // A legacy link generated by sanitizeStore is a migration, not an employee
    // edit. Apply only the missing link to the latest record and never replay a
    // stale whole quote over another user's newer consultation changes.
    delete patch[`partnerQuotes/${quoteId}`];
    const currentQuote = currentQuotes[quoteId];
    const desiredVendor = desiredVendors[vendorId];
    const currentVendor = currentVendors[vendorId];
    const migrationOnlyVendor = !baseVendors[vendorId] && desiredVendor && typeof Core.partnerVendorFromQuote === "function"
      && jsonEqual(desiredVendor, Core.partnerVendorFromQuote(desiredQuote, vendorId));
    if (!currentQuote) {
      if (migrationOnlyVendor) delete patch[`partnerVendors/${vendorId}`];
      return;
    }
    if (currentQuote.vendorId && currentQuote.vendorId !== vendorId) {
      if (migrationOnlyVendor) delete patch[`partnerVendors/${vendorId}`];
      return;
    }
    if (!currentQuote.vendorId) patch[`partnerQuotes/${quoteId}/vendorId`] = vendorId;
    if (migrationOnlyVendor) {
      if (currentVendor) delete patch[`partnerVendors/${vendorId}`];
      else patch[`partnerVendors/${vendorId}`] = Core.partnerVendorFromQuote(currentQuote, vendorId);
    }
  });
  Object.keys(patch).forEach(key => {
    const collection = key.split("/", 1)[0];
    if (SHARED_COLLECTIONS.includes(collection) && !authoritativeCollections.has(collection)) delete patch[key];
  });
  return patch;
}

function assertNoCanonicalSharedPatch(patch) {
  const keys = Object.keys(patch && typeof patch === "object" ? patch : {});
  const collection = CANONICAL_SHARED_COLLECTIONS.find(name => keys.some(key => key === name || key.startsWith(`${name}/`)));
  if (!collection) return patch;
  throw createError("건물·공실 호실 변경은 현재 작업자를 선택한 뒤 정식 저장으로 처리해 주세요.", "CANONICAL_COMMIT_REQUIRED");
}

function caseDeleteAuditId(caseKey) {
  return `case_delete_${String(caseKey || "")}`;
}

function resolveDatabasePatchLocation(location, databaseRoot) {
  const normalizedLocation = String(location || "").replace(/^\/+/, "");
  if (!databaseRoot) return normalizedLocation;
  return normalizedLocation
    .replace(/^crmShared\/data(?=\/|$)/, "data")
    .replace(/^crmAccess(?=\/|$)/, "access");
}

function resolveDatabaseLocation(location, databaseRoot) {
  const companyLocation = resolveDatabasePatchLocation(location, databaseRoot);
  if (!databaseRoot) return companyLocation;
  return companyLocation ? `${databaseRoot}/${companyLocation}` : databaseRoot;
}

function createError(message, code, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function friendlySparkCanonicalError(value) {
  const code = value && typeof value.code === "string" ? value.code : "CANONICAL_CRM_COMMIT_FAILED";
  const messages = {
    crm_entity_version_conflict: "다른 컴퓨터에서 먼저 변경했습니다. 최신 내용을 다시 불러온 뒤 저장해 주세요.",
    crm_request_id_conflict: "같은 저장 요청의 내용이 달라 안전하게 중단했습니다. 창을 닫고 다시 시도해 주세요.",
    crm_building_unit_label_conflict: "같은 건물에 동일한 호실명이 이미 있습니다.",
    crm_vacancy_migration_required: "기존 공실을 실제 호실에 모두 지정한 뒤 다시 저장해 주세요.",
    crm_move_out_date_required: "공실 예정 상태에는 공실 예정일을 입력해 주세요.",
    crm_parent_not_found: "연결된 고객·건물 정보를 찾지 못했습니다. 최신 내용을 다시 불러와 주세요.",
    crm_parent_archived: "보관된 고객·건물에는 새 내용을 연결할 수 없습니다.",
    crm_parent_mismatch: "선택한 건물과 호실의 연결 정보가 일치하지 않습니다.",
    crm_mutation_forbidden: "현재 계정은 CRM 내용을 변경할 수 없습니다.",
    crm_patch_field_forbidden: "현재 화면에서 변경할 수 없는 값이 포함되어 저장하지 않았습니다.",
    crm_immutable_field_forbidden: "이미 연결된 고객·건물 관계는 이 화면에서 바꿀 수 없습니다.",
    crm_entity_not_found: "변경할 자료를 찾지 못했습니다. 최신 내용을 다시 불러와 주세요.",
    crm_entity_upgrade_required: "이 자료는 최신 형식으로 전환한 뒤 변경할 수 있습니다.",
  };
  return createError(messages[code] || "입력 내용을 확인한 뒤 다시 저장해 주세요.", code);
}

function normalizedUid(value) {
  return String(value || "").trim();
}

function normalizedEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function safeStorageAvailable(safeStorage) {
  return Boolean(safeStorage && typeof safeStorage.isEncryptionAvailable === "function" && safeStorage.isEncryptionAvailable());
}

function encodeProtectedJson(safeStorage, value) {
  if (!safeStorageAvailable(safeStorage) || typeof safeStorage.encryptString !== "function") {
    throw createError("이 PC의 보안 저장소를 사용할 수 없어 CRM 자료를 저장하지 않았습니다.", "LOCAL_ENCRYPTION_UNAVAILABLE");
  }
  const encrypted = safeStorage.encryptString(JSON.stringify(value));
  return JSON.stringify({
    format: PROTECTED_JSON_FORMAT,
    version: PROTECTED_JSON_VERSION,
    ciphertext: Buffer.from(encrypted).toString("base64")
  });
}

function decodeProtectedJson(safeStorage, rawValue) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.isBuffer(rawValue) ? rawValue.toString("utf8") : String(rawValue || ""));
  } catch (error) {
    throw createError("CRM 보호 자료 형식을 읽을 수 없습니다.", "PROTECTED_DATA_INVALID", error);
  }
  if (!parsed || parsed.format !== PROTECTED_JSON_FORMAT) return { value: parsed, encrypted: false };
  if (parsed.version !== PROTECTED_JSON_VERSION || typeof parsed.ciphertext !== "string" || !parsed.ciphertext) {
    throw createError("CRM 보호 자료 형식이 올바르지 않습니다.", "PROTECTED_DATA_INVALID");
  }
  if (!safeStorageAvailable(safeStorage) || typeof safeStorage.decryptString !== "function") {
    throw createError("이 PC의 보안 저장소를 사용할 수 없어 CRM 자료를 열지 못했습니다.", "LOCAL_ENCRYPTION_UNAVAILABLE");
  }
  try {
    return { value: JSON.parse(safeStorage.decryptString(Buffer.from(parsed.ciphertext, "base64"))), encrypted: true };
  } catch (error) {
    throw createError("이 Windows 사용자에게 허용된 CRM 보호 자료가 아닙니다.", "PROTECTED_DATA_INVALID", error);
  }
}

function createSerializedProtectedStoreCoordinator(options) {
  const fs = options.fs;
  const safeStorage = options.safeStorage;
  const target = String(options.target || "");
  let queue = Promise.resolve();
  let sequence = 0;
  const enqueue = operation => {
    const running = queue.then(operation, operation);
    queue = running.catch(() => {});
    return running;
  };
  const guardActive = guard => {
    if (!guard) return true;
    if (typeof guard.isCurrent !== "function") return false;
    try { return guard.isCurrent() === true; } catch (_) { return false; }
  };
  const remove = async file => {
    try { await fs.unlink(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
  };
  const tempName = guard => {
    const actor = String(guard && guard.actorUid || "local").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "local";
    const generation = Number.isSafeInteger(guard && guard.generation) ? guard.generation : 0;
    sequence += 1;
    return `${target}.tmp.${actor}.${generation}.${process.pid}.${sequence}`;
  };
  return {
    write(value, guard) {
      return enqueue(async () => {
        if (!guardActive(guard)) return null;
        const temp = tempName(guard);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(temp, encodeProtectedJson(safeStorage, value), "utf8");
        if (!guardActive(guard)) {
          await remove(temp);
          return null;
        }
        await fs.rename(temp, target);
        if (!guardActive(guard)) {
          // This operation still owns the serialized writer here, so removing the
          // just-renamed stale value cannot delete a later session's commit.
          await remove(target);
          return null;
        }
        return value;
      });
    },
    clear() {
      return enqueue(async () => {
        await remove(target);
        await remove(`${target}.tmp`);
      });
    }
  };
}

function retryableSyncError(error) {
  if (!error) return false;
  if (error.code === "NETWORK") return true;
  return /(?:HTTP\s*5\d\d|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|network|fetch)/i.test(String(error.message || ""));
}

function friendlyAuthMessage(message) {
  const raw = String(message || "");
  const code = raw.split(" : ")[0];
  const normalized = raw.toLowerCase();
  if (
    ["INVALID_LOGIN_CREDENTIALS", "INVALID_PASSWORD", "EMAIL_NOT_FOUND"].includes(code)
    || /auth\/(?:invalid-credential|wrong-password|user-not-found|invalid-email)/.test(normalized)
  ) return "이메일 또는 비밀번호가 올바르지 않습니다.";
  if (code === "USER_DISABLED" || normalized.includes("auth/user-disabled")) return "사용이 중지된 계정입니다. 관리자에게 문의해 주세요.";
  if (code === "TOO_MANY_ATTEMPTS_TRY_LATER" || normalized.includes("auth/too-many-requests")) return "로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.";
  if (code.startsWith("WEAK_PASSWORD") || normalized.includes("auth/weak-password")) return "새 비밀번호는 8자 이상으로 입력해 주세요.";
  if (code === "PASSWORD_LOGIN_DISABLED" || normalized.includes("auth/operation-not-allowed")) return "이메일 로그인이 아직 서버에서 활성화되지 않았습니다. 관리자에게 문의해 주세요.";
  if (normalized.includes("auth/network-request-failed") || /(?:network|fetch|econn|etimedout)/.test(normalized)) return "네트워크 연결을 확인한 뒤 다시 로그인해 주세요.";
  return "로그인 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const source = String(text || "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (char !== "\r") cell += char;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function vendorDirectoryFromCsv(text) {
  const clean = value => String(value || "").replace(/\r/g, "").trim();
  const rows = parseCsvRows(text).filter(row => row.some(value => clean(value)));
  if (rows.length < 2) return [];
  const headers = rows[0].map(value => clean(value).replace(/\s+/g, ""));
  const column = name => headers.indexOf(String(name).replace(/\s+/g, ""));
  const indexes = {
    no: column("번호"), category: column("대분류"), type: column("세부유형"), name: column("업체명"),
    address: column("주소"), phone: column("전화번호"), map: column("네이버지도검색URL"),
    promo: column("홍보URL"), rating: column("리뷰평점"), price: column("작업단가"), note: column("비고")
  };
  if (indexes.category < 0 || indexes.name < 0) return [];
  const valueAt = (row, index) => index >= 0 ? clean(row[index]) : "";
  const result = [];
  let current = null;
  rows.slice(1).forEach(row => {
    const name = valueAt(row, indexes.name);
    if (name) {
      current = {
        id: `sheet_${result.length + 1}`,
        no: valueAt(row, indexes.no),
        category: valueAt(row, indexes.category),
        type: valueAt(row, indexes.type),
        name,
        address: valueAt(row, indexes.address),
        phone: valueAt(row, indexes.phone),
        map: valueAt(row, indexes.map),
        promo: valueAt(row, indexes.promo),
        rating: valueAt(row, indexes.rating),
        price: valueAt(row, indexes.price),
        note: valueAt(row, indexes.note),
        source: "Google Sheets"
      };
      result.push(current);
      return;
    }
    if (!current) return;
    ["phone", "map", "promo", "price", "note"].forEach(field => {
      const value = valueAt(row, indexes[field]);
      if (value) current[field] = [current[field], value].filter(Boolean).join("\n");
    });
  });
  return result.filter(item => item.name && item.category);
}

class FirebaseRemoteClient {
  constructor(options) {
    this.firebase = options.firebaseConfig || FIREBASE;
    this.databaseRoot = options.databaseRoot ?? "crmCompany";
    this.Core = options.Core;
    this.fs = options.fs;
    this.safeStorage = options.safeStorage;
    this.shell = options.shell;
    this.openGoogleAuth = options.openGoogleAuth || (url => this.shell.openExternal(url));
    this.openEmailAuth = options.openEmailAuth || this.openGoogleAuth;
    this.fetch = options.fetchImpl || globalThis.fetch;
    this.sessionFile = options.sessionFile;
    this.pendingFile = options.pendingFile;
    this.canonicalPendingFile = String(options.canonicalPendingFile || "");
    this.readLocalStore = options.readLocalStore;
    this.writeLocalStore = options.writeLocalStore;
    this.clearLocalStore = options.clearLocalStore || (async () => {});
    this.onRemoteStore = options.onRemoteStore || (() => {});
    this.onAuthState = options.onAuthState || (() => {});
    this.onSyncState = options.onSyncState || (() => {});
    this.session = null;
    this.remotePayload = null;
    this.lastError = "";
    this.streamController = null;
    this.streamTask = null;
    this.summaryStreamController = null;
    this.summaryStreamTask = null;
    this.marketingLeadStreamController = null;
    this.marketingLeadStreamTask = null;
    this.reloadTimer = null;
    this.overlayReloadTimer = null;
    this.retryTimer = null;
    this.canonicalRefreshRetryTimer = null;
    this.tokenRefreshTask = null;
    this.sessionFileQueue = Promise.resolve();
    this.sessionFileSequence = 0;
    this.canonicalPendingMemory = null;
    this.canonicalMutationQueue = Promise.resolve();
    this.streamGeneration = 0;
    this.sessionGeneration = 0;
    this.stopped = false;
    this.caseSettings = {};
    this.vendorDirectoryCache = null;
    this.vendorDirectoryLoadedAt = 0;
  }

  authState() {
    return {
      required: true,
      user: this.session ? {
        uid: this.session.uid,
        email: this.session.email,
        displayName: this.session.displayName || "",
        photoUrl: this.session.photoUrl || "",
        role: ["admin", "member", "viewer"].includes(this.session.role) ? this.session.role : "viewer",
        mustChangePassword: this.session.mustChangePassword === true
      } : null,
      error: this.lastError || ""
    };
  }

  emitAuth() {
    this.onAuthState(this.authState());
  }

  emitSync(status, message, extra) {
    this.onSyncState(Object.assign({ status, message: message || "" }, extra || {}));
  }

  canMutate() {
    return this.Core.canMutate(this.session);
  }

  requireMutationPermission(value) {
    this.Core.assertMutationAllowed(this.session);
    if (value !== undefined) this.Core.assertNoProhibitedSecrets(value);
    return this.session;
  }

  markSessionStarted() {
    this.sessionGeneration += 1;
    this.stopped = false;
    return this.captureSessionGuard();
  }

  captureSessionGuard() {
    return {
      sessionRef: this.session,
      uid: String(this.session && this.session.uid || ""),
      generation: this.sessionGeneration
    };
  }

  sessionGuardActive(guard) {
    return Boolean(
      guard
      && guard.uid
      && this.session
      && (!Object.prototype.hasOwnProperty.call(guard, "sessionRef") || this.session === guard.sessionRef)
      && String(this.session.uid || "") === guard.uid
      && this.sessionGeneration === guard.generation
    );
  }

  captureSessionContext() {
    return {
      sessionRef: this.session,
      uid: String(this.session && this.session.uid || ""),
      generation: this.sessionGeneration
    };
  }

  sessionContextActive(context) {
    return Boolean(
      context
      && this.session === context.sessionRef
      && String(this.session && this.session.uid || "") === context.uid
      && this.sessionGeneration === context.generation
    );
  }

  localStoreCommitGuard(guardValue) {
    const guard = guardValue || this.captureSessionGuard();
    return Object.freeze({
      actorUid: guard.uid,
      generation: guard.generation,
      isCurrent: () => this.sessionGuardActive(guard)
    });
  }

  async readSessionLocalStore(guardValue) {
    const guard = guardValue || this.captureSessionGuard();
    if (!this.sessionGuardActive(guard)) return null;
    const value = await this.readLocalStore(this.localStoreCommitGuard(guard));
    return this.sessionGuardActive(guard) ? value : null;
  }

  async writeSessionLocalStore(value, guardValue) {
    const guard = guardValue || this.captureSessionGuard();
    if (!this.sessionGuardActive(guard)) return null;
    const written = await this.writeLocalStore(value, this.localStoreCommitGuard(guard));
    if (!this.sessionGuardActive(guard) || written === null) return null;
    return written === undefined ? value : written;
  }

  async init() {
    this.stopped = false;
    try {
      const persisted = await this.readPersistedSession();
      if (!persisted) return this.authState();
      if (persisted.fieldAuthIntegrated !== true) {
        await this.clearPersistedSession().catch(() => {});
        return this.authState();
      }
      await this.refreshFirebaseSession(persisted.refreshToken, persisted);
      await this.verifyAccess();
      await this.persistSession();
      this.lastError = "";
      this.emitAuth();
      return this.authState();
    } catch (error) {
      this.session = null;
      this.lastError = error.code === "NETWORK" ? "서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요." : "로그인이 만료되었습니다. 다시 로그인해 주세요.";
      this.emitAuth();
      return this.authState();
    }
  }

  async readPersistedSession() {
    try {
      const raw = JSON.parse(await this.fs.readFile(this.sessionFile, "utf8"));
      if (!raw || !raw.refreshToken || !this.safeStorage.isEncryptionAvailable()) return null;
      const refreshToken = this.safeStorage.decryptString(Buffer.from(raw.refreshToken, "base64"));
      return Object.assign({}, raw, { refreshToken });
    } catch (error) {
      if (error.code !== "ENOENT") console.warn("CRM auth session read failed", error.message);
      return null;
    }
  }

  enqueueSessionFileOperation(operation) {
    const running = this.sessionFileQueue.then(operation, operation);
    this.sessionFileQueue = running.catch(() => {});
    return running;
  }

  async persistSession(contextValue, sessionValue) {
    const context = contextValue || this.captureSessionContext();
    const sessionRef = sessionValue || context.sessionRef;
    if (!sessionRef || !sessionRef.refreshToken || !this.safeStorage.isEncryptionAvailable() || !this.sessionContextActive(context)) return false;
    const encrypted = this.safeStorage.encryptString(sessionRef.refreshToken).toString("base64");
    const payload = JSON.stringify({
      refreshToken: encrypted,
      uid: sessionRef.uid,
      email: sessionRef.email,
      displayName: sessionRef.displayName || "",
      photoUrl: sessionRef.photoUrl || "",
      role: sessionRef.role || "member",
      mustChangePassword: sessionRef.mustChangePassword === true,
      fieldAuthIntegrated: sessionRef.fieldAuthIntegrated === true
    });
    return this.enqueueSessionFileOperation(async () => {
      if (!this.sessionContextActive(context)) return false;
      this.sessionFileSequence += 1;
      const temp = `${this.sessionFile}.tmp.${String(sessionRef.uid || "session").replace(/[^A-Za-z0-9_-]/g, "_")}.${context.generation}.${process.pid}.${this.sessionFileSequence}`;
      await this.fs.mkdir(path.dirname(this.sessionFile), { recursive: true });
      await this.fs.writeFile(temp, payload, "utf8");
      if (!this.sessionContextActive(context)) {
        try { await this.fs.unlink(temp); } catch (error) { if (error.code !== "ENOENT") throw error; }
        return false;
      }
      await this.fs.rename(temp, this.sessionFile);
      if (!this.sessionContextActive(context)) {
        try { await this.fs.unlink(this.sessionFile); } catch (error) { if (error.code !== "ENOENT") throw error; }
        return false;
      }
      return true;
    });
  }

  async clearPersistedSession() {
    return this.enqueueSessionFileOperation(async () => {
      for (const target of [this.sessionFile, `${this.sessionFile}.tmp`]) {
        try { await this.fs.unlink(target); } catch (error) { if (error.code !== "ENOENT") throw error; }
      }
    });
  }

  async requestJson(url, options, errorCode) {
    let response;
    try {
      response = await this.fetch(url, options);
    } catch (error) {
      throw createError("서버에 연결할 수 없습니다.", "NETWORK", error);
    }
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
    if (!response.ok) {
      const detail = data && data.error && (data.error.message || data.error) || data && data.message || `HTTP ${response.status}`;
      throw createError(String(detail), errorCode || "REMOTE_ERROR");
    }
    return data;
  }

  async refreshFirebaseSession(refreshToken, hints, contextValue, commit = true) {
    const context = contextValue || this.captureSessionContext();
    const assertCurrent = () => {
      if (!this.sessionContextActive(context)) {
        throw createError("로그인 세션이 변경되었습니다.", "SESSION_CHANGED");
      }
    };
    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken });
    const token = await this.requestJson(`https://securetoken.googleapis.com/v1/token?key=${this.firebase.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    }, "AUTH_EXPIRED");
    assertCurrent();
    const tokenPayload = token && typeof token === "object" ? token : {};
    const expectedIdentity = context.sessionRef || hints || {};
    const expectedUid = normalizedUid(expectedIdentity.uid);
    const expectedEmail = normalizedEmail(expectedIdentity.email);
    const idToken = typeof tokenPayload.id_token === "string" ? tokenPayload.id_token.trim() : "";
    const tokenUid = normalizedUid(tokenPayload.user_id);
    if (!idToken || !expectedUid || !expectedEmail || !tokenUid || tokenUid !== expectedUid) {
      throw createError("로그인 계정 정보를 다시 확인해 주세요.", "AUTH_EXPIRED");
    }
    const lookup = await this.requestJson(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${this.firebase.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken })
    }, "AUTH_EXPIRED");
    assertCurrent();
    const user = lookup && lookup.users && lookup.users[0] || {};
    const lookupUid = normalizedUid(user.localId);
    const candidateEmail = normalizedEmail(user.email);
    if (
      !lookupUid
      || !candidateEmail
      || lookupUid !== expectedUid
      || candidateEmail !== expectedEmail
      || tokenUid !== lookupUid
    ) {
      throw createError("로그인 계정 정보를 다시 확인해 주세요.", "AUTH_EXPIRED");
    }
    const nextSession = {
      idToken,
      refreshToken: tokenPayload.refresh_token || refreshToken,
      expiresAt: Date.now() + Math.max(60, Number(tokenPayload.expires_in || 3600) - 60) * 1000,
      uid: tokenUid,
      email: candidateEmail,
      displayName: user.displayName || hints && hints.displayName || "",
      photoUrl: user.photoUrl || hints && hints.photoUrl || "",
      role: hints && hints.role || "viewer",
      mustChangePassword: hints && hints.mustChangePassword === true,
      fieldAuthIntegrated: hints && hints.fieldAuthIntegrated === true
    };
    assertCurrent();
    if (!commit) return nextSession;
    if (context.sessionRef) {
      Object.assign(nextSession, {
        fieldAuthIntegrated: this.session.fieldAuthIntegrated === true
      });
      Object.assign(context.sessionRef, nextSession);
    } else {
      this.session = nextSession;
      this.markSessionStarted();
    }
    return this.session;
  }

  async ensureIdToken(force) {
    if (!this.session) throw createError("로그인이 필요합니다.", "AUTH_REQUIRED");
    const context = this.captureSessionContext();
    const existing = this.tokenRefreshTask;
    if (
      existing
      && existing.sessionRef === context.sessionRef
      && existing.uid === context.uid
      && existing.generation === context.generation
    ) return existing.promise;
    if (!force && this.session.idToken && this.session.expiresAt > Date.now()) return this.session.idToken;
    let promise;
    promise = (async () => {
      const candidate = await this.refreshFirebaseSession(context.sessionRef.refreshToken, context.sessionRef, context, false);
      if (!this.sessionContextActive(context)) throw createError("로그인 세션이 변경되었습니다.", "SESSION_CHANGED");
      const currentUid = normalizedUid(context.uid);
      const currentEmail = normalizedEmail(context.sessionRef.email);
      if (!candidate.uid || !candidate.email || candidate.uid !== currentUid || candidate.email !== currentEmail) {
        throw createError("로그인 계정 정보를 다시 확인해 주세요.", "AUTH_EXPIRED");
      }
      const candidateContext = Object.assign({}, context, { sessionRef: candidate });
      await this.verifyAccess(candidateContext, candidate.idToken);
      if (!this.sessionContextActive(context)) throw createError("로그인 세션이 변경되었습니다.", "SESSION_CHANGED");
      const persisted = await this.persistSession(context, candidate);
      if (!this.sessionContextActive(context)) throw createError("로그인 세션이 변경되었습니다.", "SESSION_CHANGED");
      if (!persisted) throw createError("로그인 세션을 안전하게 저장하지 못했습니다.", "SESSION_PERSIST_FAILED");
      Object.assign(context.sessionRef, candidate);
      return context.sessionRef.idToken;
    })();
    this.tokenRefreshTask = Object.assign({}, context, { promise });
    try {
      return await promise;
    } finally {
      if (this.tokenRefreshTask && this.tokenRefreshTask.promise === promise) this.tokenRefreshTask = null;
    }
  }

  async dbRequestForRoot(location, options, databaseRoot, retried) {
    const token = await this.ensureIdToken(false);
    const suffix = options && options.query ? `&${options.query}` : "";
    const rootedLocation = resolveDatabaseLocation(location, databaseRoot);
    const url = `${this.firebase.databaseUrl}/${rootedLocation}.json?auth=${encodeURIComponent(token)}${suffix}`;
    try {
      return await this.requestJson(url, {
        method: options && options.method || "GET",
        headers: Object.assign({ "Content-Type": "application/json" }, options && options.headers || {}),
        body: options && Object.prototype.hasOwnProperty.call(options, "body") ? JSON.stringify(options.body) : undefined
      }, "DATABASE_ERROR");
    } catch (error) {
      if (!retried && error.code === "DATABASE_ERROR" && /auth|credential|token|permission/i.test(error.message)) {
        await this.ensureIdToken(true);
        return this.dbRequestForRoot(location, options, databaseRoot, true);
      }
      throw error;
    }
  }

  async dbRequest(location, options, retried) {
    return this.dbRequestForRoot(location, options, this.databaseRoot, retried);
  }

  async rootDbRequest(location, options, retried) {
    return this.dbRequestForRoot(location, options, "", retried);
  }

  async verifyAccess(contextValue, idTokenOverride) {
    const context = contextValue || this.captureSessionContext();
    const sessionRef = context.sessionRef;
    const currentContext = this.captureSessionContext();
    if (!sessionRef || !sessionRef.uid || !this.sessionContextActive(currentContext)) throw createError("로그인 정보를 확인할 수 없습니다.", "AUTH_REQUIRED");
    let access;
    if (idTokenOverride) {
      const rootedLocation = resolveDatabaseLocation(`crmAccess/${sessionRef.uid}`, this.databaseRoot);
      const url = `${this.firebase.databaseUrl}/${rootedLocation}.json?auth=${encodeURIComponent(idTokenOverride)}`;
      access = await this.requestJson(url, { method: "GET", headers: { "Content-Type": "application/json" } }, "DATABASE_ERROR");
    } else {
      access = await this.dbRequest(`crmAccess/${sessionRef.uid}`, { method: "GET" }, true);
    }
    if (!this.sessionContextActive(currentContext)) throw createError("로그인 세션이 변경되었습니다.", "SESSION_CHANGED");
    const sameEmail = access && String(access.email || "").toLowerCase() === String(sessionRef.email || "").toLowerCase();
    if (!access || access.enabled !== true || !sameEmail) {
      throw createError("회사에서 허용한 이메일이 아닙니다.", "ACCESS_DENIED");
    }
    const role = String(access.role || "");
    if (!["admin", "member", "viewer"].includes(role)) {
      throw createError("계정 권한이 올바르게 설정되지 않았습니다. 관리자에게 문의해 주세요.", "ACCESS_DENIED");
    }
    sessionRef.role = role;
    sessionRef.mustChangePassword = access.mustChangePassword === true;
    return access;
  }

  async exchangeEmailPassword(credentials) {
    const email = String(credentials && credentials.email || "").trim().toLowerCase();
    const password = String(credentials && credentials.password || "");
    if (!email || !password) throw createError("이메일과 비밀번호를 입력해 주세요.", "LOGIN_FAILED");
    let auth;
    try {
      auth = await this.requestJson(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${this.firebase.apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, returnSecureToken: true })
      }, "LOGIN_FAILED");
    } catch (error) {
      throw createError(friendlyAuthMessage(error.message), error.code || "LOGIN_FAILED", error);
    }
    this.session = {
      idToken: auth.idToken,
      refreshToken: auth.refreshToken,
      expiresAt: Date.now() + Math.max(60, Number(auth.expiresIn || 3600) - 60) * 1000,
      uid: auth.localId,
      email: auth.email || email,
      displayName: auth.displayName || "",
      photoUrl: auth.photoUrl || "",
      role: "viewer",
      mustChangePassword: false
    };
    this.markSessionStarted();
    await this.verifyAccess();
    await this.persistSession();
    this.lastError = "";
    this.emitAuth();
    return this.session;
  }

  async exchangeGoogleCredential(credential) {
    const tokenType = credential && credential.type === "access_token" ? "access_token" : "id_token";
    const providerToken = credential && credential.token || "";
    if (!providerToken) throw createError("Google 인증 정보를 받지 못했습니다.", "LOGIN_FAILED");
    const postBody = new URLSearchParams({ [tokenType]: providerToken, providerId: "google.com" }).toString();
    const auth = await this.requestJson(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${this.firebase.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postBody, requestUri: "http://localhost", returnIdpCredential: true, returnSecureToken: true })
    }, "LOGIN_FAILED");
    if (!auth.emailVerified) throw createError("이메일 확인이 완료된 Google 계정만 사용할 수 있습니다.", "ACCESS_DENIED");
    this.session = {
      idToken: auth.idToken,
      refreshToken: auth.refreshToken,
      expiresAt: Date.now() + Math.max(60, Number(auth.expiresIn || 3600) - 60) * 1000,
      uid: auth.localId,
      email: auth.email,
      displayName: auth.displayName || auth.fullName || "",
      photoUrl: auth.photoUrl || "",
      role: "viewer",
      fieldAuthIntegrated: true
    };
    this.markSessionStarted();
    await this.verifyAccess();
    await this.persistSession();
    this.lastError = "";
    this.emitAuth();
    return this.session;
  }

  async exchangeFirebaseCredential(credential) {
    const idToken = String(credential && credential.idToken || "");
    const refreshToken = String(credential && credential.refreshToken || "");
    if (!idToken || idToken.length > 12000 || !refreshToken || refreshToken.length > 4096) {
      throw createError("Firebase 로그인 세션을 받지 못했습니다.", "LOGIN_FAILED");
    }
    const lookup = await this.requestJson(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${this.firebase.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken })
    }, "LOGIN_FAILED");
    const user = lookup && lookup.users && lookup.users[0] || {};
    if (!user.localId || !user.email) throw createError("Firebase 사용자 정보를 확인하지 못했습니다.", "LOGIN_FAILED");
    this.session = {
      idToken,
      refreshToken,
      expiresAt: Date.now() + 55 * 60 * 1000,
      uid: user.localId,
      email: user.email,
      displayName: user.displayName || "",
      photoUrl: user.photoUrl || "",
      role: "viewer",
      mustChangePassword: false,
      fieldAuthIntegrated: true
    };
    this.markSessionStarted();
    await this.verifyAccess();
    await this.persistSession();
    this.lastError = "";
    this.emitAuth();
    return this.session;
  }

  async receiveGoogleCredential() {
    const state = crypto.randomBytes(32).toString("base64url");
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;
      const finish = (error, token) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        server.close();
        if (error) reject(error); else resolve(token);
      };
      const server = http.createServer((request, response) => {
        const callback = new URL(request.url, "http://127.0.0.1");
        if (callback.pathname !== "/callback") {
          response.writeHead(404).end();
          return;
        }
        if (request.method !== "POST") {
          response.writeHead(405, { Allow: "POST" }).end();
          return;
        }
        let body = "";
        request.setEncoding("utf8");
        request.on("data", chunk => {
          body += chunk;
          if (body.length > 16000) request.destroy();
        });
        request.on("error", error => finish(createError("로그인 응답을 받지 못했습니다.", "LOGIN_FAILED", error)));
        request.on("end", () => {
          try {
            const fields = new URLSearchParams(body);
            const receivedState = fields.get("state") || "";
            const token = fields.get("provider_token") || fields.get("google_id_token") || "";
            const tokenType = fields.get("provider_token_type") || "id_token";
            const error = fields.get("error") || "";
            if (receivedState !== state) throw createError("로그인 확인값이 일치하지 않습니다.", "LOGIN_FAILED");
            if (error) throw createError(error, "LOGIN_FAILED");
            if (!token || token.length > 12000) throw createError("Google 인증 정보를 받지 못했습니다.", "LOGIN_FAILED");
            if (!["id_token", "access_token"].includes(tokenType)) throw createError("Google 인증 형식을 확인하지 못했습니다.", "LOGIN_FAILED");
            response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
            response.end("<!doctype html><meta charset='utf-8'><title>BRING CRM 로그인 완료</title><body style='font-family:sans-serif;text-align:center;padding:70px;background:#eef9ff;color:#17364d'><h2>로그인이 완료되었습니다.</h2><p>이 창을 닫고 BRING CRM으로 돌아가세요.</p></body>");
            finish(null, { token, type: tokenType });
          } catch (error) {
            response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
            response.end("로그인을 완료하지 못했습니다.");
            finish(error);
          }
        });
      });
      server.on("error", error => finish(createError("로그인 연결을 열지 못했습니다.", "LOGIN_FAILED", error)));
      server.listen(0, "127.0.0.1", async () => {
        try {
          const port = server.address().port;
          const authUrl = new URL(this.firebase.authPageUrl);
          authUrl.searchParams.set("port", String(port));
          authUrl.searchParams.set("state", state);
          await this.openGoogleAuth(authUrl.toString());
        } catch (error) {
          finish(createError("기본 브라우저에서 로그인 페이지를 열지 못했습니다.", "LOGIN_FAILED", error));
        }
      });
      timer = setTimeout(() => finish(createError("로그인 시간이 초과되었습니다. 다시 시도해 주세요.", "LOGIN_TIMEOUT")), 180000);
    });
  }

  async receiveEmailCredential(credentials) {
    const email = String(credentials && credentials.email || "").trim().toLowerCase();
    const password = String(credentials && credentials.password || "");
    if (!email || !password) throw createError("이메일과 비밀번호를 입력해 주세요.", "LOGIN_FAILED");
    const state = crypto.randomBytes(32).toString("base64url");
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;
      const finish = (error, credential) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        server.close();
        if (error) reject(error); else resolve(credential);
      };
      const server = http.createServer((request, response) => {
        const callback = new URL(request.url, "http://127.0.0.1");
        if (callback.pathname !== "/callback") return response.writeHead(404).end();
        if (request.method !== "POST") return response.writeHead(405, { Allow: "POST" }).end();
        let body = "";
        request.setEncoding("utf8");
        request.on("data", chunk => {
          body += chunk;
          if (body.length > 20000) request.destroy();
        });
        request.on("error", error => finish(createError("로그인 응답을 받지 못했습니다.", "LOGIN_FAILED", error)));
        request.on("end", () => {
          try {
            const fields = new URLSearchParams(body);
            if ((fields.get("state") || "") !== state) throw createError("로그인 확인값이 일치하지 않습니다.", "LOGIN_FAILED");
            const idToken = fields.get("firebase_id_token") || "";
            const refreshToken = fields.get("firebase_refresh_token") || "";
            if (!idToken || idToken.length > 12000 || !refreshToken || refreshToken.length > 4096) {
              throw createError("Firebase 로그인 세션을 받지 못했습니다.", "LOGIN_FAILED");
            }
            response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
            response.end("<!doctype html><meta charset='utf-8'><title>BRING CRM 로그인 완료</title><p>로그인이 완료되었습니다.</p>");
            finish(null, { idToken, refreshToken });
          } catch (error) {
            response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
            response.end("로그인을 완료하지 못했습니다.");
            finish(error);
          }
        });
      });
      server.on("error", error => finish(createError("로그인 연결을 열지 못했습니다.", "LOGIN_FAILED", error)));
      server.listen(0, "127.0.0.1", async () => {
        try {
          const port = server.address().port;
          const authUrl = new URL(this.firebase.authPageUrl);
          authUrl.searchParams.set("port", String(port));
          authUrl.searchParams.set("state", state);
          await this.openEmailAuth(authUrl.toString(), credentials);
        } catch (error) {
          finish(createError(friendlyAuthMessage(error.message), "LOGIN_FAILED", error));
        }
      });
      timer = setTimeout(() => finish(createError("로그인 시간이 초과되었습니다. 다시 시도해 주세요.", "LOGIN_TIMEOUT")), 60000);
    });
  }

  async login(credentials) {
    await this.logout(false);
    try {
      const credential = await this.receiveEmailCredential(credentials);
      await this.exchangeFirebaseCredential(credential);
      const data = this.session.mustChangePassword ? null : await this.loadStore();
      return { ok: true, auth: this.authState(), data };
    } catch (error) {
      this.stopStream();
      this.session = null;
      this.remotePayload = null;
      await this.clearPersistedSession().catch(() => {});
      await this.clearLocalStore().catch(() => {});
      this.lastError = error.message;
      this.emitAuth();
      throw error;
    }
  }

  async loginWithGoogle() {
    await this.logout(false);
    try {
      const credential = await this.receiveGoogleCredential();
      await this.exchangeGoogleCredential(credential);
      const data = await this.loadStore();
      return { ok: true, auth: this.authState(), data };
    } catch (error) {
      this.stopStream();
      this.session = null;
      this.remotePayload = null;
      await this.clearPersistedSession().catch(() => {});
      await this.clearLocalStore().catch(() => {});
      this.lastError = error.message;
      this.emitAuth();
      throw error;
    }
  }

  async changePassword(newPassword) {
    if (!this.session) throw createError("로그인이 필요합니다.", "AUTH_REQUIRED");
    const password = String(newPassword || "");
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      throw createError("새 비밀번호는 영문과 숫자를 포함해 8자 이상 입력해 주세요.", "WEAK_PASSWORD");
    }
    let updated;
    try {
      updated = await this.requestJson(`https://identitytoolkit.googleapis.com/v1/accounts:update?key=${this.firebase.apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: await this.ensureIdToken(false), password, returnSecureToken: true })
      }, "PASSWORD_CHANGE_FAILED");
    } catch (error) {
      throw createError(friendlyAuthMessage(error.message), error.code || "PASSWORD_CHANGE_FAILED", error);
    }
    if (updated.idToken) this.session.idToken = updated.idToken;
    if (updated.refreshToken) this.session.refreshToken = updated.refreshToken;
    this.session.expiresAt = Date.now() + Math.max(60, Number(updated.expiresIn || 3600) - 60) * 1000;
    await this.dbRequest(`crmAccess/${this.session.uid}/mustChangePassword`, { method: "PUT", body: false, query: "print=silent" });
    this.session.mustChangePassword = false;
    await this.persistSession();
    this.lastError = "";
    this.emitAuth();
    const data = await this.loadStore();
    return { ok: true, auth: this.authState(), data };
  }

  async logout(notify = true) {
    this.stopStream();
    this.session = null;
    this.remotePayload = null;
    this.lastError = "";
    await this.clearPersistedSession().catch(() => {});
    await this.clearLocalStore().catch(error => console.warn("CRM local cache clear failed", error.message));
    if (notify) this.emitAuth();
    return { ok: true };
  }

  async readPendingStore() {
    try {
      const decoded = decodeProtectedJson(this.safeStorage, await this.fs.readFile(this.pendingFile, "utf8"));
      const raw = decoded.value;
      let pending;
      if (raw && raw.version === PENDING_STORE_VERSION && raw.store) {
        pending = {
          version: PENDING_STORE_VERSION,
          actorUid: String(raw.actorUid || ""),
          actorRole: String(raw.actorRole || ""),
          store: this.Core.sanitizeSharedStore(raw.store),
          presentCollections: presentSharedCollections(raw.store, raw.presentCollections),
          baseRemote: sharedRemoteProjection(this.Core, raw.baseRemote),
          createdAt: raw.createdAt || ""
        };
      } else if (raw && raw.version === 4 && raw.store) {
        pending = {
          version: 4,
          actorUid: String(raw.actorUid || ""),
          actorRole: String(raw.actorRole || ""),
          store: this.Core.sanitizeSharedStore(raw.store),
          presentCollections: presentSharedCollections(raw.store, raw.presentCollections),
          baseRemote: sharedRemoteProjection(this.Core, raw.baseRemote),
          createdAt: raw.createdAt || ""
        };
      } else if (raw && raw.version === 3 && raw.store) {
        pending = {
          version: 3,
          actorUid: String(raw.actorUid || ""),
          actorRole: String(raw.actorRole || ""),
          store: this.Core.sanitizeSharedStore(raw.store),
          presentCollections: presentSharedCollections(raw.store),
          baseRemote: sharedRemoteProjection(this.Core, raw.baseRemote),
          createdAt: raw.createdAt || ""
        };
      } else if (raw && raw.version === 2 && raw.store) {
        pending = {
          version: 2,
          actorUid: "",
          actorRole: "",
          store: this.Core.sanitizeSharedStore(raw.store),
          presentCollections: presentSharedCollections(raw.store),
          baseRemote: sharedRemoteProjection(this.Core, raw.baseRemote),
          legacyUnbound: true
        };
      } else {
        pending = {
          version: 1,
          actorUid: "",
          actorRole: "",
          store: this.Core.sanitizeSharedStore(raw),
          presentCollections: presentSharedCollections(raw),
          baseRemote: {},
          legacyUnbound: true
        };
      }
      if (!decoded.encrypted && pending.actorUid) {
        await this.writePendingPayload(Object.assign({}, pending, { version: PENDING_STORE_VERSION }));
      }
      return pending;
    } catch (error) {
      if (error.code !== "ENOENT") console.warn("CRM pending sync read failed", error.message);
      if (["PROTECTED_DATA_INVALID", "LOCAL_ENCRYPTION_UNAVAILABLE"].includes(error.code)) {
        await this.clearPendingStore().catch(() => {});
        this.emitSync("error", "보호된 저장 대기 자료를 읽을 수 없어 안전하게 제거했습니다.", { pending: false });
      }
      return null;
    }
  }

  async writePendingPayload(payload) {
    const target = this.pendingFile;
    const temp = `${target}.tmp`;
    const safePayload = payload && payload.store ? Object.assign({}, payload, {
      store: this.Core.sanitizeSharedStore(payload.store),
      presentCollections: presentSharedCollections(payload.store, payload.presentCollections),
      baseRemote: sharedRemoteProjection(this.Core, payload.baseRemote)
    }) : payload;
    await this.fs.mkdir(path.dirname(target), { recursive: true });
    await this.fs.writeFile(temp, encodeProtectedJson(this.safeStorage, safePayload), "utf8");
    await this.fs.rename(temp, target);
  }

  async writePendingStore(data, baseRemote) {
    const session = this.requireMutationPermission(data);
    const store = this.Core.sanitizeSharedStore(data);
    await this.writePendingPayload({
      version: PENDING_STORE_VERSION,
      actorUid: session.uid,
      actorRole: session.role || "member",
      store,
      presentCollections: SHARED_COLLECTIONS.slice(),
      baseRemote: sharedRemoteProjection(this.Core, baseRemote),
      createdAt: new Date().toISOString()
    });
  }

  async clearPendingStore() {
    for (const target of [this.pendingFile, `${this.pendingFile}.tmp`]) {
      try { await this.fs.unlink(target); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }

  async acceptPendingForCurrentUser(pending, guardValue) {
    const guard = guardValue || this.captureSessionGuard();
    if (!this.sessionGuardActive(guard)) return false;
    const validActor = pending && pending.actorUid && pending.actorUid === guard.uid
      && ["admin", "member"].includes(pending.actorRole);
    if (!this.canMutate() || !validActor) {
      if (!this.sessionGuardActive(guard)) return false;
      await this.clearPendingStore();
      if (!this.sessionGuardActive(guard)) return false;
      this.emitSync("syncing", "이전 사용자 또는 권한이 확인되지 않은 저장 대기 자료를 안전하게 제거했습니다.", { pending: false });
      return false;
    }
    try {
      this.Core.assertNoProhibitedSecrets(pending.store);
    } catch (error) {
      if (!this.sessionGuardActive(guard)) return false;
      await this.clearPendingStore();
      if (!this.sessionGuardActive(guard)) return false;
      this.emitSync("syncing", "저장할 수 없는 민감정보가 포함된 대기 자료를 제거했습니다.", { pending: false });
      return false;
    }
    return true;
  }

  async fetchRemotePayload() {
    return this.dbRequest("crmShared/data", { method: "GET" });
  }

  async loadCanonicalBuildingUnits(guardValue) {
    const guard = guardValue || this.captureSessionGuard();
    if (!this.sessionGuardActive(guard)) return null;
    const value = await this.dbRequest("crmShared/data/buildingUnits", { method: "GET" });
    return this.sessionGuardActive(guard) ? value : null;
  }

  async loadFieldSummaries(guardValue) {
    const guard = guardValue || this.captureSessionGuard();
    if (!this.sessionGuardActive(guard)) return null;
    const value = await this.dbRequest("fieldSummaries", { method: "GET" });
    return this.sessionGuardActive(guard) ? value : null;
  }

  async loadMarketingLeadInbox(guardValue) {
    const guard = guardValue || this.captureSessionGuard();
    if (!this.sessionGuardActive(guard)) return null;
    const value = await this.dbRequest("marketingLeadInbox", { method: "GET" });
    return this.sessionGuardActive(guard) ? value : null;
  }

  async loadDriveImportCandidates() {
    if (!this.session) throw createError("로그인이 필요합니다.", "AUTH_REQUIRED");
    const value = await this.dbRequest("driveImportCandidates", { method: "GET" });
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  async decideDriveImport(input) {
    if (!this.session || this.session.role !== "admin") throw createError("관리자만 Drive 자료를 승인하거나 반려할 수 있습니다.", "PERMISSION_DENIED");
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const action = String(source.action || "");
    if (!new Set(["approveDriveImport", "rejectDriveImport"]).has(action)) throw createError("허용되지 않은 Drive 검토 요청입니다.", "INVALID_DRIVE_IMPORT_ACTION");
    const driveFileId = String(source.driveFileId || "");
    const requestId = String(source.requestId || "");
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(driveFileId) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw createError("Drive 검토 요청을 확인해 주세요.", "INVALID_DRIVE_IMPORT_REQUEST");
    const allowed = action === "approveDriveImport"
      ? new Set(["action", "driveFileId", "requestId", "approved"])
      : new Set(["action", "driveFileId", "requestId", "reason"]);
    if (Object.keys(source).some(key => !allowed.has(key))) throw createError("Drive 검토 요청에 허용되지 않은 값이 있습니다.", "INVALID_DRIVE_IMPORT_REQUEST");
    const idToken = await this.ensureIdToken(false);
    let response;
    try {
      response = await this.fetch(DEFAULT_CASE_AUTOMATION_ENDPOINT, {
        method: "POST",
        redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(Object.assign({}, source, { idToken }))
      });
    } catch (error) {
      throw createError("Drive 검토 서버에 연결할 수 없습니다.", "NETWORK", error);
    }
    const raw = await response.text();
    let result = null;
    try { result = raw ? JSON.parse(raw) : null; } catch (_) { result = null; }
    if (!response.ok || !result || result.ok !== true || !result.result || result.result.requestId !== requestId) {
      throw createError(result && result.message || "Drive 검토 결과를 확인하지 못했습니다.", "DRIVE_IMPORT_FAILED");
    }
    return result;
  }

  async loadRendererOverlays(guardValue) {
    const guard = guardValue || this.captureSessionGuard();
    const [buildingUnits, fieldSummaries, marketingLeads] = await Promise.all([
      this.loadCanonicalBuildingUnits(guard),
      this.loadFieldSummaries(guard),
      this.loadMarketingLeadInbox(guard)
    ]);
    if (!this.sessionGuardActive(guard)) return null;
    return this.Core.sanitizeRendererOverlays({ buildingUnits, fieldSummaries, marketingLeads });
  }

  async refreshRendererSnapshot(sharedStore, notify, guardValue) {
    const guard = guardValue || this.captureSessionGuard();
    if (!this.sessionGuardActive(guard)) return null;
    const shared = this.Core.sanitizeSharedStore(sharedStore || await this.readSessionLocalStore(guard));
    if (!this.sessionGuardActive(guard)) return null;
    const overlays = await this.loadRendererOverlays(guard);
    if (!overlays || !this.sessionGuardActive(guard)) return null;
    const renderer = mergeRendererOverlays(this.Core, shared, overlays.buildingUnits, overlays.fieldSummaries, overlays.marketingLeads);
    if (!this.sessionGuardActive(guard)) return null;
    if (notify) {
      if (!this.sessionGuardActive(guard)) return null;
      this.onRemoteStore(renderer);
    }
    return renderer;
  }

  async refreshAfterCanonicalCommit(guardValue) {
    const guard = guardValue || this.captureSessionGuard();
    if (!this.sessionGuardActive(guard)) return null;
    const remote = await this.fetchRemotePayload();
    if (!this.sessionGuardActive(guard)) return null;
    this.remotePayload = remote && typeof remote === "object" ? remote : {};
    const local = await this.readSessionLocalStore(guard);
    if (!this.sessionGuardActive(guard)) return null;
    const merged = mergeRemoteStore(this.Core, this.remotePayload, local, this.session);
    if (!this.sessionGuardActive(guard)) return null;
    const written = await this.writeSessionLocalStore(merged, guard);
    if (!written) return null;
    if (!this.sessionGuardActive(guard)) return null;
    return this.refreshRendererSnapshot(merged, true, guard);
  }

  enqueueCanonicalMutation(operation) {
    const running = this.canonicalMutationQueue.then(operation, operation);
    this.canonicalMutationQueue = running.catch(() => {});
    return running;
  }

  async readCanonicalPendingMutation() {
    if (!this.canonicalPendingFile) {
      return this.canonicalPendingMemory ? structuredClone(this.canonicalPendingMemory) : null;
    }
    try {
      const decoded = decodeProtectedJson(this.safeStorage, await this.fs.readFile(this.canonicalPendingFile, "utf8"));
      const raw = decoded.value;
      if (!decoded.encrypted || !raw || raw.version !== CANONICAL_PENDING_VERSION
        || !["entity", "buildingUnits"].includes(raw.kind)
        || typeof raw.actorUid !== "string" || !raw.actorUid
        || !["admin", "member"].includes(raw.actorRole)
        || !raw.input || typeof raw.input !== "object" || Array.isArray(raw.input)) {
        throw createError("보호된 정식 CRM 저장 대기 자료가 올바르지 않습니다.", "PROTECTED_DATA_INVALID");
      }
      const intent = canonicalMutationIntent(raw.kind, raw.input);
      if (raw.intent !== intent) {
        throw createError("보호된 정식 CRM 저장 대기 자료가 변경되었습니다.", "PROTECTED_DATA_INVALID");
      }
      return {
        version: CANONICAL_PENDING_VERSION,
        actorUid: raw.actorUid,
        actorRole: raw.actorRole,
        kind: raw.kind,
        intent,
        input: structuredClone(raw.input),
        createdAt: String(raw.createdAt || ""),
      };
    } catch (error) {
      if (error && error.code === "ENOENT") return null;
      throw error;
    }
  }

  async writeCanonicalPendingMutation(kind, input) {
    const session = this.requireMutationPermission();
    const payload = {
      version: CANONICAL_PENDING_VERSION,
      actorUid: session.uid,
      actorRole: session.role,
      kind,
      intent: canonicalMutationIntent(kind, input),
      input: structuredClone(input),
      createdAt: new Date().toISOString(),
    };
    if (!this.canonicalPendingFile) {
      this.canonicalPendingMemory = payload;
      return payload;
    }
    const target = this.canonicalPendingFile;
    const temp = `${target}.tmp`;
    await this.fs.mkdir(path.dirname(target), { recursive: true });
    await this.fs.writeFile(temp, encodeProtectedJson(this.safeStorage, payload), "utf8");
    await this.fs.rename(temp, target);
    return payload;
  }

  async clearCanonicalPendingMutation() {
    this.canonicalPendingMemory = null;
    if (!this.canonicalPendingFile) return;
    for (const target of [this.canonicalPendingFile, `${this.canonicalPendingFile}.tmp`]) {
      try { await this.fs.unlink(target); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }

  async recoverCanonicalPendingMutationLocked() {
    const pending = await this.readCanonicalPendingMutation();
    if (!pending) return null;
    const session = this.requireMutationPermission();
    if (pending.actorUid !== session.uid) {
      throw createError("다른 로그인 계정의 확인되지 않은 저장 요청이 남아 있습니다. 해당 계정으로 다시 로그인해 먼저 확인해 주세요.", "CANONICAL_PENDING_USER_MISMATCH");
    }
    const reducer = pending.kind === "entity" ? SparkCanonical.reduceEntity : SparkCanonical.reduceBuildingUnits;
    let result;
    try {
      result = await this.runSparkCanonicalTransaction(pending.input, reducer);
    } catch (error) {
      // A canonical reducer/rules rejection after a receipt lookup is
      // definitive: the atomic receipt is absent, so this request did not
      // commit. Remove only those proven failures; transport failures keep the
      // exact request journal for another confirmation attempt.
      if (error && String(error.code || "").startsWith("crm_")) {
        await this.clearCanonicalPendingMutation();
      }
      throw error;
    }
    if (!result) throw createError("저장 결과를 확인하기 전에 로그인 세션이 변경되었습니다.", "SESSION_CHANGED");
    await this.clearCanonicalPendingMutation();
    return { pending, result };
  }

  async resumeCanonicalPendingMutation() {
    return this.enqueueCanonicalMutation(() => this.recoverCanonicalPendingMutationLocked());
  }

  async executeCanonicalMutation(kind, input, reducer) {
    return this.enqueueCanonicalMutation(async () => {
      const pending = await this.readCanonicalPendingMutation();
      if (pending) {
        const sameIntent = pending.kind === kind && pending.intent === canonicalMutationIntent(kind, input);
        const recovered = await this.recoverCanonicalPendingMutationLocked();
        if (sameIntent) return recovered.result;
        throw createError("이전에 결과 확인이 중단된 저장을 먼저 복구했습니다. 최신 화면을 확인한 뒤 현재 작업을 다시 저장해 주세요.", "CANONICAL_PENDING_RECOVERED");
      }
      await this.writeCanonicalPendingMutation(kind, input);
      try {
        const result = await this.runSparkCanonicalTransaction(input, reducer);
        // Preserve the existing stale-session contract: the renderer receives
        // no result, while the encrypted journal remains for the original user
        // to confirm with the same request after signing in again.
        if (!result) return null;
        await this.clearCanonicalPendingMutation();
        return result;
      } catch (error) {
        const code = String(error && error.code || "");
        const definitive = code.startsWith("crm_")
          || ["CANONICAL_PENDING_USER_MISMATCH", "PROTECTED_DATA_INVALID", "LOCAL_ENCRYPTION_UNAVAILABLE"].includes(code);
        if (definitive) await this.clearCanonicalPendingMutation();
        throw error;
      }
    });
  }

  scheduleCanonicalRefreshRetry(guardValue) {
    const guard = guardValue || this.captureSessionGuard();
    if (!this.sessionGuardActive(guard)) return;
    clearTimeout(this.canonicalRefreshRetryTimer);
    this.canonicalRefreshRetryTimer = setTimeout(async () => {
      if (!this.sessionGuardActive(guard)) return;
      try {
        const refreshed = await this.refreshAfterCanonicalCommit(guard);
        if (!refreshed || !this.sessionGuardActive(guard)) return;
        this.emitSync("connected", "정식 CRM 저장 결과와 최신 현장 정보를 반영했습니다.", { pending: false });
      } catch (_) {
        if (!this.stopped && this.sessionGuardActive(guard)) this.scheduleCanonicalRefreshRetry(guard);
      }
    }, 2500);
  }

  async commitCanonicalCrmEntity(input) {
    this.requireMutationPermission(canonicalEntityMutationForValidation(input));
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const request = Object.assign({}, source, {
      requestId: source.requestId || crypto.randomUUID(),
    });
    const result = await this.executeCanonicalMutation("entity", request, SparkCanonical.reduceEntity);
    if (!result) return null;
    const guard = this.captureSessionGuard();
    try {
      await this.refreshAfterCanonicalCommit(guard);
      if (!this.sessionGuardActive(guard)) return null;
    } catch (_) {
      if (!this.sessionGuardActive(guard)) return null;
      this.scheduleCanonicalRefreshRetry(guard);
    }
    return result;
  }

  async dbReadWithEtag(location, retried) {
    const token = await this.ensureIdToken(false);
    const rootedLocation = resolveDatabaseLocation(location, this.databaseRoot);
    const url = `${this.firebase.databaseUrl}/${rootedLocation}.json?auth=${encodeURIComponent(token)}`;
    let response;
    try {
      response = await this.fetch(url, {
        method: "GET",
        headers: { Accept: "application/json", "X-Firebase-ETag": "true" },
      });
    } catch (cause) {
      throw createError("공용 서버에 연결할 수 없습니다.", "NETWORK", cause);
    }
    const raw = await response.text();
    let value = null;
    try { value = raw ? JSON.parse(raw) : null; } catch (_) { value = null; }
    if (!response.ok) {
      const detail = value && value.error || `HTTP ${response.status}`;
      if (!retried && /auth|credential|token|permission/i.test(String(detail))) {
        await this.ensureIdToken(true);
        return this.dbReadWithEtag(location, true);
      }
      throw createError(String(detail), "DATABASE_ERROR");
    }
    const etag = response.headers && typeof response.headers.get === "function"
      ? String(response.headers.get("etag") || response.headers.get("ETag") || "")
      : "";
    if (!etag) throw createError("동시 편집 확인값을 받지 못했습니다.", "DATABASE_ETAG_MISSING");
    return { value, etag };
  }

  async dbAtomicPatch(location, patch, retried) {
    const token = await this.ensureIdToken(false);
    const rootedLocation = resolveDatabaseLocation(location, this.databaseRoot);
    const url = `${this.firebase.databaseUrl}/${rootedLocation}.json?auth=${encodeURIComponent(token)}&print=silent`;
    let response;
    try {
      response = await this.fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } catch (cause) {
      throw createError("공용 서버에 연결할 수 없습니다.", "NETWORK", cause);
    }
    const raw = await response.text();
    let payload = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch (_) { payload = null; }
    if (!response.ok) {
      const detail = payload && payload.error || `HTTP ${response.status}`;
      if (!retried && (response.status === 401 || /auth|credential|token/i.test(String(detail)))) {
        await this.ensureIdToken(true);
        return this.dbAtomicPatch(location, patch, true);
      }
      const error = createError("서버가 동시 저장 또는 데이터 규칙 위반으로 변경을 거부했습니다.", "DATABASE_WRITE_REJECTED");
      error.status = Number(response.status) || 0;
      throw error;
    }
    return true;
  }

  async runSparkCanonicalTransaction(input, reducer) {
    this.requireMutationPermission();
    const guard = this.captureSessionGuard();
    await this.verifyAccess();
    if (!this.sessionGuardActive(guard)) throw createError("로그인 세션이 변경되었습니다.", "SESSION_CHANGED");
    const actor = { uid: this.session.uid, operatorId: input.operatorId, role: this.session.role };
    let lastConflict = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const snapshot = await this.dbReadWithEtag("crmShared/data");
      if (!this.sessionGuardActive(guard)) throw createError("로그인 세션이 변경되었습니다.", "SESSION_CHANGED");
      let decision;
      try {
        decision = reducer(snapshot.value || {}, input, actor, new Date().toISOString());
      } catch (error) {
        throw friendlySparkCanonicalError(error);
      }
      if (decision.result && decision.result.repeated === true) return decision.result;
      try {
        await this.dbAtomicPatch("crmShared/data", SparkCanonical.atomicMutationPatch(snapshot.value || {}, decision.data));
        if (!this.sessionGuardActive(guard)) return null;
        return decision.result;
      } catch (error) {
        if (error && ["NETWORK", "DATABASE_WRITE_REJECTED"].includes(error.code)) {
          // A PATCH can commit even if its response is lost. The append-only
          // receipt makes the retry idempotent; the ETag reveals intervening
          // server state before a Rules version conflict is retried.
          try {
            const check = await this.dbReadWithEtag("crmShared/data");
            const repeated = reducer(check.value || {}, input, actor, new Date().toISOString());
            if (repeated.result && repeated.result.repeated === true) return repeated.result;
            if (error.code === "NETWORK" || check.etag !== snapshot.etag) {
              lastConflict = createError("다른 컴퓨터의 변경과 충돌했습니다.", "crm_entity_version_conflict");
              continue;
            }
          } catch (checkError) {
            if (checkError && typeof checkError.code === "string" && checkError.code.startsWith("crm_")) {
              throw friendlySparkCanonicalError(checkError);
            }
          }
        }
        if (error && error.code === "DATABASE_WRITE_REJECTED") {
          throw createError("저장 권한 또는 데이터 규칙을 확인해 주세요.", "crm_mutation_forbidden", error);
        }
        throw error;
      }
    }
    throw lastConflict || createError("다른 컴퓨터의 변경과 충돌했습니다.", "crm_entity_version_conflict");
  }

  async configureBuildingUnits(input) {
    this.requireMutationPermission(buildingUnitsMutationForValidation(input));
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const request = Object.assign({}, source, {
      requestId: source.requestId || crypto.randomUUID(),
    });
    const result = await this.executeCanonicalMutation("buildingUnits", request, SparkCanonical.reduceBuildingUnits);
    if (!result) return null;
    const guard = this.captureSessionGuard();
    try {
      await this.refreshAfterCanonicalCommit(guard);
      if (!this.sessionGuardActive(guard)) return null;
    } catch (_) {
      if (!this.sessionGuardActive(guard)) return null;
      this.scheduleCanonicalRefreshRetry(guard);
    }
    return result;
  }

  async loadOperations() {
    if (!this.session) throw createError("로그인이 필요합니다.", "AUTH_REQUIRED");
    const [casePayload, paymentPayload, caseSettings] = await Promise.all([
      this.rootDbRequest("cases", { method: "GET" }),
      this.dbRequest("paymentCalendars/shared", { method: "GET" }),
      this.rootDbRequest("caseSettings", { method: "GET" }).catch(() => ({}))
    ]);
    this.caseSettings = caseSettings && typeof caseSettings === "object" ? caseSettings : {};
    const cases = Object.entries(casePayload || {}).map(([key, value]) => Object.assign({ id: key }, value || {}, { firebaseKey: key }));
    return {
      cases,
      payments: paymentPayload && typeof paymentPayload === "object" ? paymentPayload : {},
      caseSettings: {
        vendorQuoteReplyEmail: String(this.caseSettings.vendorQuoteReplyEmail || ""),
        paymentScheduleSheet: this.caseSettings.paymentScheduleSheet || {},
        automationBuild: String(this.caseSettings.caseAutomationEndpointVersion || "")
      },
      loadedAt: new Date().toISOString()
    };
  }

  async loadVendorDirectory(force) {
    if (!this.session) throw createError("로그인이 필요합니다.", "AUTH_REQUIRED");
    if (!force && this.vendorDirectoryCache && Date.now() - this.vendorDirectoryLoadedAt < 60000) {
      return { ok: true, vendors: this.vendorDirectoryCache, loadedAt: new Date(this.vendorDirectoryLoadedAt).toISOString(), cached: true };
    }
    let response;
    try {
      response = await this.fetch(`${VENDOR_CSV_URL}&t=${Date.now()}`, { cache: "no-store" });
    } catch (error) {
      throw createError("최신 업체 목록에 연결할 수 없습니다.", "NETWORK", error);
    }
    if (!response.ok) throw createError(`업체 목록 응답 오류: HTTP ${response.status}`, "REMOTE_ERROR");
    const vendors = vendorDirectoryFromCsv(await response.text());
    if (!vendors.length) throw createError("업체 목록에서 업체명과 업종을 찾지 못했습니다.", "REMOTE_ERROR");
    this.vendorDirectoryCache = vendors;
    this.vendorDirectoryLoadedAt = Date.now();
    return { ok: true, vendors, loadedAt: new Date(this.vendorDirectoryLoadedAt).toISOString(), cached: false };
  }

  async runWorkflowAction(input) {
    this.requireMutationPermission();
    const source = input && typeof input === "object" ? input : {};
    const validationSource = Object.assign({}, source);
    if (validationSource.file && typeof validationSource.file === "object") {
      validationSource.file = Object.assign({}, validationSource.file, { fileBody: "" });
    }
    this.Core.assertNoProhibitedSecrets(validationSource);
    const action = String(source.action || "").trim();
    if (!WORKFLOW_ACTIONS.has(action)) throw createError("허용되지 않은 업무 실행 요청입니다.", "INVALID_WORKFLOW_ACTION");
    // The workflow receives a Firebase ID token, so its destination must be a
    // build-time trust decision. Shared settings cannot replace this endpoint.
    const endpoint = DEFAULT_CASE_AUTOMATION_ENDPOINT;
    const idToken = await this.ensureIdToken(false);
    const payload = Object.assign({}, source, {
      action,
      uid: this.session.uid,
      idToken,
      adminEmail: this.session.email || "",
      adminUid: this.session.uid || ""
    });
    delete payload.endpoint;
    if (payload.file) {
      const size = Number(payload.file.size || 0);
      if (!payload.file.fileName || !payload.file.fileBody || size < 1 || size > 5 * 1024 * 1024) {
        throw createError("업로드 파일은 5MB 이하만 사용할 수 있습니다.", "INVALID_WORKFLOW_FILE");
      }
    }
    let response;
    try {
      response = await this.fetch(endpoint, {
        method: "POST",
        redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      throw createError("업무 자동화 서버에 연결할 수 없습니다.", "NETWORK", error);
    }
    const text = await response.text();
    let result = null;
    try { result = text ? JSON.parse(text) : null; } catch (_) { result = null; }
    if (!response.ok) throw createError(result && result.message || `업무 실행 오류: HTTP ${response.status}`, "WORKFLOW_ACTION_FAILED");
    if (!result || result.ok !== true) throw createError(result && result.message || "업무 실행 결과를 확인하지 못했습니다.", "WORKFLOW_ACTION_FAILED");
    return result;
  }

  async saveWorkflowCase(input) {
    this.requireMutationPermission(input);
    const source = input && typeof input === "object" ? input : {};
    const isNew = source.create === true;
    const generatedKey = `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const caseKey = String(source.caseKey || (isNew ? generatedKey : "")).trim();
    if (!caseKey || caseKey.length > 120 || /[.#$\[\]\/]/.test(caseKey)) throw createError("케이스 번호를 확인해 주세요.", "INVALID_CASE");

    const trashAction = String(source.trashAction || "");
    if (trashAction === "delete") {
      if (isNew || source.fields || source.stepKey || source.vendorSelection) throw createError("영구 삭제 요청을 확인해 주세요.", "INVALID_CASE");
      const existing = await this.rootDbRequest(`cases/${caseKey}`, { method: "GET" });
      if (!existing || existing.deleted !== true) throw createError("휴지통에 있는 케이스만 영구 삭제할 수 있습니다.", "INVALID_CASE");
      const audit = this.Core.createAuditLog({
        id: caseDeleteAuditId(caseKey),
        category: "삭제",
        targetType: "케이스",
        targetId: caseKey,
        targetLabel: String(existing.ticketNo || existing.id || caseKey).slice(0, 120),
        action: "케이스 영구 삭제",
        actor: this.session.displayName || this.session.email || "CRM 사용자",
        actorUid: this.session.uid || "",
        actorEmail: this.session.email || "",
        reason: "휴지통 케이스 영구 삭제"
      });
      const auditPath = this.databaseRoot
        ? `${this.databaseRoot}/${resolveDatabasePatchLocation(`crmShared/data/auditLogs/${audit.id}`, this.databaseRoot)}`
        : `crmShared/data/auditLogs/${audit.id}`;
      await this.rootDbRequest("", { method: "PATCH", body: {
        [`cases/${caseKey}`]: null,
        [auditPath]: audit
      }, query: "print=silent" });
      return { ok: true, caseKey, deleted: true, auditId: audit.id };
    }

    const fieldLimits = {
      name: 80, phone: 40, email: 160, building: 120, room: 80, address: 240,
      crmCustomerId: 120, crmBuildingId: 120,
      grade: 40, urgency: 40, issueType: 80, summary: 1200, memo: 1200
    };
    const patch = {};
    const fields = source.fields && typeof source.fields === "object" ? source.fields : {};
    Object.entries(fields).forEach(([field, value]) => {
      if (!Object.prototype.hasOwnProperty.call(fieldLimits, field)) return;
      patch[field] = String(value || "").trim().slice(0, fieldLimits[field]);
    });
    for (const field of ["crmCustomerId", "crmBuildingId"]) {
      if (patch[field] && !/^[A-Za-z0-9_-]{1,120}$/.test(patch[field])) throw createError("CRM 연결 정보를 확인해 주세요.", "INVALID_CASE_LINK");
      if (Object.prototype.hasOwnProperty.call(patch, field) && !patch[field]) patch[field] = null;
    }
    const referenceChecks = [];
    if (patch.crmCustomerId) referenceChecks.push(this.dbRequest(`crmShared/data/customers/${patch.crmCustomerId}`, { method: "GET" }).then(value => ({ type: "고객", value })));
    if (patch.crmBuildingId) referenceChecks.push(this.dbRequest(`crmShared/data/buildings/${patch.crmBuildingId}`, { method: "GET" }).then(value => ({ type: "건물", value })));
    if (referenceChecks.length) {
      const references = await Promise.all(referenceChecks);
      const missing = references.find(reference => !reference.value || typeof reference.value !== "object");
      if (missing) throw createError(`연결한 ${missing.type} 정보가 서버에서 변경되었거나 삭제되었습니다. 목록을 새로고침한 뒤 다시 선택해 주세요.`, "INVALID_CASE_LINK");
    }

    if (trashAction) {
      if (!['trash', 'restore'].includes(trashAction)) throw createError("케이스 휴지통 작업을 확인해 주세요.", "INVALID_CASE");
      if (trashAction === "trash") {
        const deletedAt = new Date().toISOString();
        patch.deleted = true;
        patch.deletedAt = deletedAt;
        patch.deletedBy = this.session.email || "CRM 사용자";
      } else {
        patch.deleted = null;
        patch.deletedAt = null;
        patch.deletedBy = null;
      }
    }

    const stepKey = String(source.stepKey || "");
    if (stepKey) {
      if (!/^c(?:[1-9]|1[0-7])$/.test(stepKey)) throw createError("업무 단계를 확인해 주세요.", "INVALID_CASE_STEP");
      if (Object.prototype.hasOwnProperty.call(source, "stepStatus")) {
        const stepStatus = String(source.stepStatus || "wait");
        if (!["wait", "doing", "done"].includes(stepStatus)) throw createError("단계 상태를 확인해 주세요.", "INVALID_CASE_STEP");
        patch[`status/${stepKey}`] = stepStatus === "wait" ? null : stepStatus;
        const stepIndex = Number(stepKey.slice(1));
        if (stepStatus === "done" && stepIndex < this.Core.WORKFLOW_STEPS.length && source.startNext !== false) {
          patch[`status/c${stepIndex + 1}`] = "doing";
        }
      }
      if (Object.prototype.hasOwnProperty.call(source, "stepNote")) {
        patch[`note/${stepKey}`] = String(source.stepNote || "").trim().slice(0, 4000) || null;
      }
    }

    const vendorSelection = source.vendorSelection && typeof source.vendorSelection === "object" ? source.vendorSelection : null;
    if (vendorSelection) {
      const vendor = vendorSelection.vendor && typeof vendorSelection.vendor === "object" ? vendorSelection.vendor : {};
      const rawId = String(vendorSelection.id || vendor.id || "").trim();
      const vendorId = rawId.replace(/[.#$\[\]\/]/g, "_").slice(0, 120);
      if (!vendorId) throw createError("선택할 업체를 확인해 주세요.", "INVALID_VENDOR");
      if (vendorSelection.selected === false) patch[`vendorSelections/${vendorId}`] = null;
      else {
        const limited = {};
        const limits = { id: 120, category: 80, type: 120, name: 120, address: 240, phone: 120, map: 500, promo: 1000, rating: 80, price: 1000, note: 2000, source: 80 };
        Object.entries(limits).forEach(([field, limit]) => { if (vendor[field] !== undefined) limited[field] = String(vendor[field] || "").trim().slice(0, limit); });
        limited.id = vendorId;
        patch[`vendorSelections/${vendorId}`] = limited;
      }
    }

    const now = new Date().toISOString();
    if (Object.prototype.hasOwnProperty.call(fields, "crmCustomerId") || Object.prototype.hasOwnProperty.call(fields, "crmBuildingId")) {
      patch.crmLinkMethod = "crm_manual";
      patch.crmLinkedAt = now;
      patch.crmLinkedBy = this.session.email || "CRM 사용자";
    }
    if (isNew) {
      const stamp = now.replace(/[-:TZ.]/g, "").slice(0, 14);
      patch.id = caseKey;
      patch.ticketNo = String(source.ticketNo || `BR-${stamp.slice(0, 8)}-${stamp.slice(8, 14)}`).slice(0, 40);
      patch.createdAt = now;
      patch.receivedAt = now;
      patch.grade = patch.grade || "스탠다드";
      patch["status/c1"] = "doing";
    }
    patch.updatedAt = now;
    patch.crmUpdatedAt = now;
    patch.crmUpdatedBy = this.session.email || "CRM 사용자";
    if (!Object.keys(patch).length) throw createError("저장할 케이스 내용이 없습니다.", "INVALID_CASE");

    await this.rootDbRequest(`cases/${caseKey}`, { method: "PATCH", body: patch, query: "print=silent" });
    return { ok: true, caseKey, updatedAt: now, patch };
  }

  async savePaymentOverride(input) {
    this.requireMutationPermission(input);
    const month = String(input && input.month || "");
    const scheduleId = String(input && input.scheduleId || "");
    const status = String(input && input.status || "auto");
    const reason = String(input && input.reason || "").trim().slice(0, 200);
    if (!/^\d{4}-\d{2}$/.test(month) || !/^[A-Za-z0-9_-]{1,120}$/.test(scheduleId)) throw createError("입금 일정 정보를 확인해 주세요.", "INVALID_PAYMENT");
    if (!["auto", "paid", "manual_unpaid", "review"].includes(status)) throw createError("허용되지 않은 입금 상태입니다.", "INVALID_PAYMENT");
    const now = new Date().toISOString();
    const auditId = `a_crm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const override = status === "auto" ? null : { status, reason, at: now, by: this.session.email || "CRM 사용자" };
    const patch = {
      [`overrides/${month}/${scheduleId}`]: override,
      [`audit/${auditId}`]: { action: status === "auto" ? "CRM 자동판정 복원" : "CRM 입금 상태 수동 변경", details: { scheduleId, month, status, reason }, at: now, by: this.session.email || "CRM 사용자" }
    };
    await this.dbRequest("paymentCalendars/shared", { method: "PATCH", body: patch, query: "print=silent" });
    return { ok: true, override };
  }

  async savePaymentSchedule(input) {
    this.requireMutationPermission(input);
    const source = input && typeof input === "object" ? input : {};
    const scheduleId = String(source.scheduleId || `crm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`).trim();
    if (!/^[A-Za-z0-9_-]{6,120}$/.test(scheduleId)) throw createError("납부 일정 번호를 확인해 주세요.", "INVALID_PAYMENT");
    const text = (value, limit) => String(value || "").trim().slice(0, limit);
    const amount = Math.round(Number(String(source.amount || "").replace(/[^0-9]/g, "")) || 0);
    const dueDay = Math.max(1, Math.min(31, Number(source.dueDay) || 1));
    const startMonth = text(source.startMonth, 7);
    const endMonth = text(source.endMonth, 7);
    if (!text(source.buildingName, 120) || !text(source.tenantName, 80) || amount < 1 || !/^\d{4}-\d{2}$/.test(startMonth)) {
      throw createError("건물·세입자·금액·시작 월을 확인해 주세요.", "INVALID_PAYMENT");
    }
    if (endMonth && !/^\d{4}-\d{2}$/.test(endMonth)) throw createError("종료 월을 확인해 주세요.", "INVALID_PAYMENT");
    const now = new Date().toISOString();
    const existing = await this.dbRequest(`paymentCalendars/shared/schedules/${scheduleId}`, { method: "GET" }).catch(() => null) || {};
    const schedule = Object.assign({}, existing, {
      id: scheduleId,
      buildingId: text(source.buildingId, 120) || `crm_building_${Buffer.from(text(source.buildingName, 120)).toString("hex").slice(0, 30)}`,
      buildingName: text(source.buildingName, 120),
      buildingAddress: text(source.buildingAddress || existing.buildingAddress, 240),
      unit: text(source.unit, 80),
      tenantName: text(source.tenantName, 80),
      tenantPhone: text(source.tenantPhone, 40),
      payerName: text(source.payerName, 80) || text(source.tenantName, 80),
      amount, dueDay, startMonth, endMonth,
      active: source.active !== false,
      source: "crm",
      previousSource: existing.source && existing.source !== "crm" ? existing.source : existing.previousSource || "",
      updatedAt: now,
      updatedBy: this.session.email || "CRM 사용자",
      createdAt: existing.createdAt || now
    });
    const auditId = `a_crm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    await this.dbRequest("paymentCalendars/shared", { method: "PATCH", body: {
      [`schedules/${scheduleId}`]: schedule,
      [`audit/${auditId}`]: { action: existing.id ? "CRM 납부 일정 수정" : "CRM 납부 일정 등록", details: { scheduleId, buildingName: schedule.buildingName, unit: schedule.unit }, at: now, by: this.session.email || "CRM 사용자" }
    }, query: "print=silent" });
    return { ok: true, schedule };
  }

  async deletePaymentSchedule(input) {
    this.requireMutationPermission(input);
    const scheduleId = String(input && input.scheduleId || "").trim();
    if (!/^[A-Za-z0-9_-]{6,120}$/.test(scheduleId)) throw createError("납부 일정 번호를 확인해 주세요.", "INVALID_PAYMENT");
    const paymentData = await this.dbRequest("paymentCalendars/shared", { method: "GET" }).catch(() => null) || {};
    const schedule = paymentData.schedules && paymentData.schedules[scheduleId];
    if (!schedule) throw createError("삭제할 납부 일정을 찾지 못했습니다.", "PAYMENT_NOT_FOUND");
    if (schedule.source !== "crm") throw createError("동기화된 일정은 CRM에서 삭제할 수 없습니다. 사용 상태를 종료로 변경해 주세요.", "PAYMENT_DELETE_BLOCKED");
    const hasOverride = Object.values(paymentData.overrides || {}).some(month => month && month[scheduleId]);
    const hasReminder = Object.values(paymentData.rentSms || {}).some(month => month && month[scheduleId]);
    const normalizeName = value => String(value || "").toLowerCase().replace(/\s+/g, "").replace(/[^0-9a-zㄱ-ㅣ가-힣]/g, "");
    const schedulePayer = normalizeName(schedule.payerName || schedule.tenantName);
    const hasTransaction = Object.values(paymentData.transactions || {}).some(transaction => {
      if (!transaction || transaction.active === false) return false;
      if (String(transaction.scheduleId || transaction.matchedScheduleId || "") === scheduleId) return true;
      if (Array.isArray(transaction.reviewScheduleIds) && transaction.reviewScheduleIds.includes(scheduleId)) return true;
      return String(transaction.buildingId || "") === String(schedule.buildingId || "")
        && Math.round(Number(transaction.amount) || 0) === Math.round(Number(schedule.amount) || 0)
        && normalizeName(transaction.payerName) === schedulePayer;
    });
    if (hasOverride || hasReminder || hasTransaction) throw createError("입금·상태·알림 기록이 연결된 일정은 삭제할 수 없습니다. 사용 상태를 종료로 변경해 주세요.", "PAYMENT_HAS_HISTORY");
    const now = new Date().toISOString();
    const auditId = `a_crm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    await this.dbRequest("paymentCalendars/shared", { method: "PATCH", body: {
      [`schedules/${scheduleId}`]: null,
      [`audit/${auditId}`]: { action: "CRM 납부 일정 삭제", details: { scheduleId, buildingName: schedule.buildingName, unit: schedule.unit }, at: now, by: this.session.email || "CRM 사용자" }
    }, query: "print=silent" });
    return { ok: true, scheduleId };
  }

  async savePaymentBankBinding(input) {
    this.requireMutationPermission(input);
    const source = input && typeof input === "object" ? input : {};
    const buildingId = String(source.buildingId || "").trim();
    const accountRef = String(source.accountRef || "").trim();
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(buildingId)) throw createError("건물을 확인해 주세요.", "INVALID_PAYMENT");
    if (accountRef && !/^pb_[A-Za-z0-9_-]{6,80}$/.test(accountRef)) throw createError("연결할 입금계좌를 확인해 주세요.", "INVALID_PAYMENT");
    const now = new Date().toISOString();
    const binding = accountRef ? {
      accountRef,
      bankCode: String(source.bankCode || "").slice(0, 20),
      accountName: String(source.accountName || "").slice(0, 120),
      accountLast4: String(source.accountLast4 || "").replace(/\D/g, "").slice(-4),
      buildingId,
      buildingName: String(source.buildingName || "").slice(0, 120),
      updatedAt: now,
      updatedBy: this.session.email || "CRM 사용자"
    } : null;
    const auditId = `a_crm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    await this.dbRequest("paymentCalendars/shared", { method: "PATCH", body: {
      [`bankBindings/${buildingId}`]: binding,
      [`audit/${auditId}`]: { action: binding ? "CRM 건물 입금계좌 연결" : "CRM 건물 입금계좌 연결 해제", details: { buildingId, accountRef }, at: now, by: this.session.email || "CRM 사용자" }
    }, query: "print=silent" });
    return { ok: true, binding };
  }

  async pushStore(input, guardValue) {
    this.requireMutationPermission(input);
    const guard = guardValue || this.captureSessionGuard();
    if (!this.sessionGuardActive(guard)) throw createError("로그인 세션이 변경되었습니다.", "SESSION_CHANGED");
    const data = this.Core.sanitizeSharedStore(input);
    data.updatedAt = new Date().toISOString();
    const next = toRemoteStore(data, this.session && this.session.email);
    const current = this.remotePayload && typeof this.remotePayload === "object"
      ? this.remotePayload
      : await this.fetchRemotePayload() || {};
    if (!this.sessionGuardActive(guard)) return null;
    const patch = diffRemoteStores(current, next);
    assertNoCanonicalSharedPatch(patch);
    if (Object.keys(patch).length) {
      await this.dbRequest("crmShared/data", { method: "PATCH", body: patch, query: "print=silent" });
      if (!this.sessionGuardActive(guard)) return null;
    }
    this.remotePayload = next;
    const local = await this.readSessionLocalStore(guard);
    if (!local || !this.sessionGuardActive(guard)) return null;
    const merged = mergeRemoteStore(this.Core, next, Object.assign({}, local, { settings: data.settings }), this.session);
    const written = await this.writeSessionLocalStore(merged, guard);
    if (!written || !this.sessionGuardActive(guard)) return null;
    await this.clearPendingStore();
    if (!this.sessionGuardActive(guard)) return null;
    this.emitSync("connected", "공용 서버와 동기화됨", { updatedAt: merged.updatedAt, pending: false });
    return merged;
  }

  async syncPending(pendingValue, guardValue) {
    const guard = guardValue || this.captureSessionGuard();
    if (!this.sessionGuardActive(guard)) return null;
    const pending = pendingValue || await this.readPendingStore();
    if (!this.sessionGuardActive(guard) || !pending) return null;
    if (!await this.acceptPendingForCurrentUser(pending, guard)) return null;
    if (!this.sessionGuardActive(guard)) return null;
    this.emitSync("syncing", "저장 대기 자료를 서버로 보내는 중", { pending: true });
    const currentRemote = await this.fetchRemotePayload() || {};
    if (!this.sessionGuardActive(guard)) return null;
    const desired = toRemoteStore(pending.store, this.session.email);
    const patch = pendingSyncPatch(this.Core, pending.baseRemote || {}, desired, currentRemote, pending.presentCollections);
    assertNoCanonicalSharedPatch(patch);
    if (Object.keys(patch).length) {
      if (!this.sessionGuardActive(guard)) return null;
      await this.dbRequest("crmShared/data", { method: "PATCH", body: patch, query: "print=silent" });
      if (!this.sessionGuardActive(guard)) return null;
    }
    const refreshedRemote = await this.fetchRemotePayload() || {};
    if (!this.sessionGuardActive(guard)) return null;
    this.remotePayload = refreshedRemote;
    const local = await this.readSessionLocalStore(guard);
    if (!this.sessionGuardActive(guard)) return null;
    const merged = mergeRemoteStore(this.Core, this.remotePayload, Object.assign({}, local, { settings: pending.store.settings }), this.session);
    if (!this.sessionGuardActive(guard)) return null;
    const written = await this.writeSessionLocalStore(merged, guard);
    if (!written) return null;
    if (!this.sessionGuardActive(guard)) return null;
    await this.clearPendingStore();
    if (!this.sessionGuardActive(guard)) return null;
    this.emitSync("connected", "저장 대기 자료를 공용 서버에 반영했습니다.", { updatedAt: merged.updatedAt, pending: false });
    if (!this.sessionGuardActive(guard)) return null;
    const renderer = await this.refreshRendererSnapshot(merged, false, guard);
    if (!renderer || !this.sessionGuardActive(guard)) return null;
    this.onRemoteStore(renderer);
    if (!this.sessionGuardActive(guard)) return null;
    this.startStream();
    return renderer;
  }

  schedulePendingRetry(guardValue) {
    const guard = guardValue || this.captureSessionGuard();
    if (!this.sessionGuardActive(guard)) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(async () => {
      if (!this.sessionGuardActive(guard)) return;
      try { await this.syncPending(undefined, guard); }
      catch (error) {
        if (!this.sessionGuardActive(guard)) return;
        if (retryableSyncError(error)) this.schedulePendingRetry(guard);
        else this.emitSync("error", error.message || "저장 대기 자료를 동기화하지 못했습니다.", { pending: true });
      }
    }, 8000);
  }

  async loadStore() {
    if (!this.session) throw createError("로그인이 필요합니다.", "AUTH_REQUIRED");
    if (this.session.mustChangePassword) throw createError("새 비밀번호를 먼저 설정해 주세요.", "PASSWORD_CHANGE_REQUIRED");
    const guard = this.captureSessionGuard();
    const local = await this.readSessionLocalStore(guard);
    if (!this.sessionGuardActive(guard)) return null;
    try {
      const recovered = await this.resumeCanonicalPendingMutation();
      if (!this.sessionGuardActive(guard)) return null;
      if (recovered) this.emitSync("syncing", "중단되었던 정식 CRM 저장 결과를 안전하게 복구했습니다.", { pending: false });
    } catch (error) {
      if (!this.sessionGuardActive(guard)) return null;
      if (error && error.code === "CANONICAL_PENDING_USER_MISMATCH") {
        this.emitSync("error", error.message, { pending: true });
      } else if (retryableSyncError(error)) {
        this.emitSync("pending", "확인 중이던 정식 CRM 저장을 연결 시 같은 요청 번호로 다시 확인합니다.", { pending: true });
      } else {
        throw error;
      }
    }
    this.emitSync("syncing", "공용 서버에서 최신 자료를 확인하는 중");
    const remote = await this.fetchRemotePayload();
    if (!this.sessionGuardActive(guard)) return null;
    this.remotePayload = remote;
    const pending = await this.readPendingStore();
    if (!this.sessionGuardActive(guard)) return null;
    if (pending) {
      try {
        const synced = await this.syncPending(pending, guard);
        if (!this.sessionGuardActive(guard)) return null;
        if (synced) return synced;
      }
      catch (error) {
        if (!this.sessionGuardActive(guard)) return null;
        if (!retryableSyncError(error)) throw error;
        this.emitSync("pending", "인터넷 연결 시 자동으로 다시 동기화합니다.", { pending: true });
        this.schedulePendingRetry(guard);
        return local;
      }
    }
    const merged = mergeRemoteStore(this.Core, this.remotePayload, local, this.session);
    if (!this.sessionGuardActive(guard)) return null;
    const written = await this.writeSessionLocalStore(merged, guard);
    if (!written) return null;
    if (!this.sessionGuardActive(guard)) return null;
    this.emitSync("connected", "공용 서버와 동기화됨", { updatedAt: merged.updatedAt, pending: false });
    if (!this.sessionGuardActive(guard)) return null;
    this.startStream();
    if (!this.sessionGuardActive(guard)) return null;
    return this.refreshRendererSnapshot(merged, false, guard);
  }

  async saveStore(input) {
    this.requireMutationPermission(input);
    const guard = this.captureSessionGuard();
    const overlays = this.Core.sanitizeRendererOverlays(input);
    const local = this.Core.sanitizeSharedStore(input);
    local.updatedAt = new Date().toISOString();
    try {
      const result = await this.pushStore(local, guard);
      if (!result || !this.sessionGuardActive(guard)) throw createError("로그인 세션이 변경되었습니다.", "SESSION_CHANGED");
      this.startStream();
      return { ok: true, data: mergeRendererOverlays(this.Core, result, overlays.buildingUnits, overlays.fieldSummaries, overlays.marketingLeads), pending: false };
    } catch (error) {
      if (!this.sessionGuardActive(guard)) throw createError("로그인 세션이 변경되었습니다.", "SESSION_CHANGED", error);
      if (!retryableSyncError(error)) throw error;
      const written = await this.writeSessionLocalStore(local, guard);
      if (!written || !this.sessionGuardActive(guard)) throw createError("로그인 세션이 변경되었습니다.", "SESSION_CHANGED");
      await this.writePendingStore(local, this.remotePayload);
      if (!this.sessionGuardActive(guard)) throw createError("로그인 세션이 변경되었습니다.", "SESSION_CHANGED");
      this.emitSync("pending", "서버 연결 시 자동으로 저장됩니다.", { pending: true });
      this.schedulePendingRetry(guard);
      return { ok: true, data: mergeRendererOverlays(this.Core, local, overlays.buildingUnits, overlays.fieldSummaries, overlays.marketingLeads), pending: true, warning: error.message };
    }
  }

  scheduleRemoteReload() {
    const guard = this.captureSessionGuard();
    if (!this.sessionGuardActive(guard)) return;
    clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => this.reloadFromRemote(guard).catch(error => {
      if (this.sessionGuardActive(guard)) {
        this.emitSync("offline", error.message || "공용 서버 연결이 끊겼습니다.");
      }
    }), 180);
  }

  scheduleOverlayReload() {
    const guard = this.captureSessionGuard();
    if (!this.sessionGuardActive(guard)) return;
    clearTimeout(this.overlayReloadTimer);
    this.overlayReloadTimer = setTimeout(() => this.reloadRendererOverlays(guard).catch(() => {
      if (this.sessionGuardActive(guard)) {
        this.emitSync("offline", "현장 요약 정보를 다시 불러오는 중입니다.", { pending: false });
      }
    }), 180);
  }

  async reloadRendererOverlays(guardValue) {
    const guard = guardValue || this.captureSessionGuard();
    if (!this.sessionGuardActive(guard)) return null;
    const local = await this.readSessionLocalStore(guard);
    if (!this.sessionGuardActive(guard)) return null;
    return this.refreshRendererSnapshot(local, true, guard);
  }

  async reloadFromRemote(guardValue) {
    const guard = guardValue || this.captureSessionGuard();
    if (!this.sessionGuardActive(guard)) return null;
    const pending = await this.readPendingStore();
    if (!this.sessionGuardActive(guard)) return null;
    if (pending) {
      const synced = await this.syncPending(pending, guard);
      if (!this.sessionGuardActive(guard)) return null;
      if (synced) return;
    }
    const remote = await this.fetchRemotePayload();
    if (!this.sessionGuardActive(guard)) return null;
    this.remotePayload = remote || {};
    const local = await this.readSessionLocalStore(guard);
    if (!this.sessionGuardActive(guard)) return null;
    const merged = mergeRemoteStore(this.Core, this.remotePayload, local, this.session);
    if (!this.sessionGuardActive(guard)) return null;
    const written = await this.writeSessionLocalStore(merged, guard);
    if (!written) return null;
    if (!this.sessionGuardActive(guard)) return null;
    this.emitSync("connected", "다른 사용자의 최신 변경을 반영했습니다.", { updatedAt: merged.updatedAt, pending: false });
    if (!this.sessionGuardActive(guard)) return null;
    return this.refreshRendererSnapshot(merged, true, guard);
  }

  startStream() {
    if (!this.session) return;
    this.stopped = false;
    const generation = this.streamGeneration;
    if (!this.streamTask) {
      let trackedShared;
      trackedShared = this.streamLoop("crmShared/data", "shared", generation).finally(() => {
        if (this.streamTask === trackedShared) this.streamTask = null;
      });
      this.streamTask = trackedShared;
    }
    if (!this.summaryStreamTask) {
      let trackedSummary;
      trackedSummary = this.streamLoop("fieldSummaries", "fieldSummaries", generation).finally(() => {
        if (this.summaryStreamTask === trackedSummary) this.summaryStreamTask = null;
      });
      this.summaryStreamTask = trackedSummary;
    }
    if (!this.marketingLeadStreamTask) {
      let trackedMarketingLeads;
      trackedMarketingLeads = this.streamLoop("marketingLeadInbox", "marketingLeadInbox", generation).finally(() => {
        if (this.marketingLeadStreamTask === trackedMarketingLeads) this.marketingLeadStreamTask = null;
      });
      this.marketingLeadStreamTask = trackedMarketingLeads;
    }
  }

  stopStream() {
    this.stopped = true;
    this.sessionGeneration += 1;
    this.streamGeneration += 1;
    if (this.streamController) this.streamController.abort();
    if (this.summaryStreamController) this.summaryStreamController.abort();
    if (this.marketingLeadStreamController) this.marketingLeadStreamController.abort();
    this.streamController = null;
    this.summaryStreamController = null;
    this.marketingLeadStreamController = null;
    this.streamTask = null;
    this.summaryStreamTask = null;
    this.marketingLeadStreamTask = null;
    clearTimeout(this.reloadTimer);
    clearTimeout(this.overlayReloadTimer);
    clearTimeout(this.retryTimer);
    clearTimeout(this.canonicalRefreshRetryTimer);
  }

  handleStreamEvent(kind, eventName) {
    if (eventName === "put" || eventName === "patch") {
      return ["fieldSummaries", "marketingLeadInbox"].includes(kind) ? this.scheduleOverlayReload() : this.scheduleRemoteReload();
    }
    if (eventName === "auth_revoked" || eventName === "cancel") {
      if (this.session) this.session.expiresAt = 0;
      this.sessionGeneration += 1;
      if (this.streamController) this.streamController.abort();
      if (this.summaryStreamController) this.summaryStreamController.abort();
      if (this.marketingLeadStreamController) this.marketingLeadStreamController.abort();
    }
    return undefined;
  }

  async streamLoop(location, kind, generation) {
    const controllerKey = kind === "fieldSummaries"
      ? "summaryStreamController"
      : kind === "marketingLeadInbox" ? "marketingLeadStreamController" : "streamController";
    const sessionGuard = this.captureSessionGuard();
    while (
      !this.stopped
      && this.session
      && generation === this.streamGeneration
      && this.sessionGuardActive(sessionGuard)
    ) {
      const controller = new AbortController();
      this[controllerKey] = controller;
      try {
        const token = await this.ensureIdToken(false);
        if (!this.sessionGuardActive(sessionGuard)) break;
        const rootedLocation = resolveDatabaseLocation(location, this.databaseRoot);
        const url = `${this.firebase.databaseUrl}/${rootedLocation}.json?auth=${encodeURIComponent(token)}`;
        const response = await this.fetch(url, { headers: { Accept: "text/event-stream" }, signal: controller.signal });
        if (!response.ok || !response.body) throw createError(`실시간 연결 실패 (${response.status})`, "STREAM_ERROR");
        if (kind === "shared") this.emitSync("connected", "공용 서버 실시간 연결됨", { pending: false });
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let eventName = "";
        let dataLines = [];
        const dispatch = () => {
          if (this.sessionGuardActive(sessionGuard)) this.handleStreamEvent(kind, eventName);
          eventName = "";
          dataLines = [];
        };
        while (!this.stopped) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let newline;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, newline).replace(/\r$/, "");
            buffer = buffer.slice(newline + 1);
            if (!line) dispatch();
            else if (line.startsWith("event:")) eventName = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
          }
        }
      } catch (error) {
        if (!this.stopped && error.name !== "AbortError" && kind === "shared") {
          this.emitSync("offline", "실시간 연결을 다시 시도하는 중");
        }
      } finally {
        if (this[controllerKey] === controller) this[controllerKey] = null;
      }
      if (!this.stopped && this.sessionGuardActive(sessionGuard) && generation === this.streamGeneration) await delay(2500);
    }
  }

  close() {
    this.stopStream();
  }
}

module.exports = {
  FIREBASE,
  DEFAULT_CASE_AUTOMATION_ENDPOINT,
  VENDOR_CSV_URL,
  WORKFLOW_ACTIONS,
  SHARED_COLLECTIONS,
  PROTECTED_JSON_FORMAT,
  encodeProtectedJson,
  decodeProtectedJson,
  createSerializedProtectedStoreCoordinator,
  retryableSyncError,
  resolveDatabasePatchLocation,
  resolveDatabaseLocation,
  parseCsvRows,
  vendorDirectoryFromCsv,
  mapById,
  listFromMap,
  toRemoteStore,
  sharedRemoteProjection,
  mergeRemoteStore,
  mergeRendererOverlays,
  diffRemoteStores,
  pendingSyncPatch,
  caseDeleteAuditId,
  FirebaseRemoteClient
};
