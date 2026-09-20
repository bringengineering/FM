(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringB2bImportCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // 외부 영업풀 ID 규칙: 공인중개 R01~R50, 이사 M01~M20, 인테리어 I01~I20, 기존건물 BO-001~007
  const POOL_ID_RULES = [
    { re: /^R(\d{2})$/, min: 1, max: 50 },
    { re: /^M(\d{2})$/, min: 1, max: 20 },
    { re: /^I(\d{2})$/, min: 1, max: 20 },
    { re: /^BO-(\d{3})$/, min: 1, max: 7 }
  ];
  const STATUS = Object.freeze({ NEW: "new", DUPLICATE: "duplicate", REVIEW: "review", ERROR: "error" });

  function text(value, limit = 200) {
    return String(value == null ? "" : value).normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, limit);
  }

  function normalizePhone(value) {
    const digits = String(value == null ? "" : value).replace(/\D/g, "");
    return digits.length >= 10 && digits.length <= 11 ? digits : "";
  }

  function validatePoolId(value) {
    const id = text(value, 20);
    return POOL_ID_RULES.some(rule => {
      const match = rule.re.exec(id);
      if (!match) return false;
      const num = Number(match[1]);
      return num >= rule.min && num <= rule.max;
    });
  }

  function toCountMap(input) {
    if (!input) return {};
    if (Array.isArray(input)) {
      return input.reduce((acc, phone) => {
        const key = normalizePhone(phone);
        if (key) acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
    }
    return typeof input === "object" ? input : {};
  }

  function classifyOne(row, index, existingPoolIdSet, phoneCounts) {
    const poolId = text(row && row.poolId, 20);
    const name = text(row && row.name, 120);
    const rawPhone = row && row.phone;
    const phone = normalizePhone(rawPhone);
    const reasons = [];

    if (!poolId) reasons.push("외부PoolID 누락");
    else if (!validatePoolId(poolId)) reasons.push("외부PoolID 규칙 위반");
    if (!name) reasons.push("사업장명 누락");
    if (!text(rawPhone)) reasons.push("전화 누락");
    else if (!phone) reasons.push("번호오류");

    const base = {
      index,
      poolId,
      name,
      phone,
      address: text(row && row.address, 240),
      bizType: text(row && row.bizType || row && row.source, 40),
      source: text(row && row.source, 40),
      priority: text(row && row.priority, 20) || "normal",
      memo: text(row && row.memo, 500),
      reasons
    };

    if (reasons.length) {
      return { ...base, status: STATUS.ERROR, selectable: false, selectedByDefault: false };
    }
    if (existingPoolIdSet.has(poolId)) {
      return { ...base, status: STATUS.DUPLICATE, selectable: false, selectedByDefault: false, reasons: ["외부PoolID 중복"] };
    }
    const phoneCount = phone ? Number(phoneCounts[phone] || 0) : 0;
    if (phoneCount >= 2) {
      return { ...base, status: STATUS.REVIEW, selectable: false, selectedByDefault: false, reasons: ["번호 일치 2건 이상 — 확인필요"] };
    }
    if (phoneCount === 1) {
      return { ...base, status: STATUS.DUPLICATE, selectable: false, selectedByDefault: false, reasons: ["전화번호 중복"] };
    }
    return { ...base, status: STATUS.NEW, selectable: true, selectedByDefault: true };
  }

  function classifyCandidates({ rows, existingPoolIds, existingPhoneCounts } = {}) {
    const list = Array.isArray(rows) ? rows : [];
    const poolSet = new Set((Array.isArray(existingPoolIds) ? existingPoolIds : []).map(id => text(id, 20)).filter(Boolean));
    const phoneCounts = toCountMap(existingPhoneCounts);
    return list.map((row, index) => classifyOne(row, index, poolSet, phoneCounts));
  }

  function makeSnapshotKey(requestId) {
    return `b2b-import-${text(requestId, 40)}`;
  }

  function buildImportRequest(classified, selectedIds, context = {}) {
    const requestId = text(context.requestId, 40);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw new Error("요청 번호가 올바르지 않습니다.");
    }
    const actor = text(context.actor, 200);
    const at = text(context.at, 40);
    const items = Array.isArray(classified) ? classified : [];
    const wanted = new Set((Array.isArray(selectedIds) ? selectedIds : []).map(id => String(id)));

    const chosen = items.filter(item => wanted.has(String(item.poolId)) || wanted.has(String(item.index)));
    const notNew = chosen.filter(item => item.status !== STATUS.NEW);
    if (notNew.length) {
      throw new Error("신규 후보만 등록할 수 있습니다. 중복·오류·확인필요 행은 선택할 수 없습니다.");
    }

    const records = chosen.map(item => ({
      poolId: item.poolId,
      name: item.name,
      phone: item.phone,
      address: item.address,
      bizType: item.bizType,
      source: item.source,
      priority: item.priority,
      memo: item.memo,
      stage: "candidate",
      verified: false,
      evidence: { registeredBy: actor, registeredAt: at, poolId: item.poolId, origin: "b2b-bulk-import" }
    }));

    // 등록(신규 생성)만 수행한다. 기존 데이터 갱신·덮어쓰기 액션은 존재하지 않는다.
    return { action: "approveB2bImport", requestId, snapshotKey: makeSnapshotKey(requestId), records };
  }

  function summarize(classified, request) {
    const items = Array.isArray(classified) ? classified : [];
    const registered = request && Array.isArray(request.records) ? request.records.length : 0;
    const error = items.filter(item => item.status === STATUS.ERROR).length;
    const skipped = Math.max(0, items.length - registered - error);
    return { total: items.length, registered, skipped, error };
  }

  // 서버·클라이언트 공용 요청 검증 계약. 전송 전(클라이언트)과 수신 후(서버) 양쪽에서 호출한다.
  function validateImportRequest(request) {
    const errors = [];
    const req = request && typeof request === "object" && !Array.isArray(request) ? request : {};
    if (req.action !== "approveB2bImport") errors.push("action");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(req.requestId || ""))) errors.push("requestId");
    const allowed = new Set(["action", "requestId", "snapshotKey", "records"]);
    if (Object.keys(req).some(key => !allowed.has(key))) errors.push("unexpectedKey");
    const records = Array.isArray(req.records) ? req.records : null;
    if (!records || !records.length) errors.push("records");
    else records.forEach((record, i) => {
      if (!validatePoolId(record && record.poolId)) errors.push("record[" + i + "].poolId");
      if (!text(record && record.name, 120)) errors.push("record[" + i + "].name");
      if (record && record.stage !== "candidate") errors.push("record[" + i + "].stage");
      if (record && record.verified !== false) errors.push("record[" + i + "].verified");
    });
    return { valid: errors.length === 0, errors };
  }

  return { STATUS, normalizePhone, validatePoolId, classifyCandidates, buildImportRequest, validateImportRequest, summarize };
});
