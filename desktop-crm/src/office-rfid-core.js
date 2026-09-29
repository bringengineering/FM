(function attachOfficeRfidCore(root, factory) {
  const api = factory(typeof require === "function" ? require : null);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringOfficeRfidCore = api;
})(typeof globalThis === "object" ? globalThis : this, function createOfficeRfidCore(nodeRequire) {
  "use strict";

  const USER_ID = /^[A-Za-z0-9._-]{1,128}$/;
  const CARD_CODE = /^[0-9]{6,20}$/;
  const FINGERPRINT = /^[a-f0-9]{64}$/;
  const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  const MAX_CARDS = 500;
  const HASH_NAMESPACE = "bring-crm-rfid-v1:";

  function normalizeUserId(value) {
    const text = typeof value === "string" ? value : "";
    return USER_ID.test(text) ? text : "";
  }

  function normalizeCardCode(value) {
    const text = typeof value === "string" ? value.replace(/[\r\n]+$/g, "") : "";
    return CARD_CODE.test(text) ? text : "";
  }

  function fingerprintCardCode(value) {
    const cardCode = normalizeCardCode(value);
    if (!cardCode || !nodeRequire) return "";
    const crypto = nodeRequire("node:crypto");
    return crypto.createHash("sha256").update(`${HASH_NAMESPACE}${cardCode}`, "utf8").digest("hex");
  }

  function normalizeStoredMap(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const entries = Object.entries(source);
    if (entries.length > MAX_CARDS) throw new Error("등록된 카드 수가 허용 범위를 초과했습니다.");
    const result = Object.create(null);
    for (const [fingerprint, raw] of entries) {
      const row = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
      const keys = Object.keys(row);
      const userId = normalizeUserId(row.userId);
      const last4 = typeof row.last4 === "string" && /^[0-9]{4}$/.test(row.last4) ? row.last4 : "";
      const registeredAt = typeof row.registeredAt === "string" && ISO_TIME.test(row.registeredAt) ? row.registeredAt : "";
      const registeredBy = normalizeUserId(row.registeredBy);
      if (!FINGERPRINT.test(fingerprint)
        || keys.length !== 4
        || keys.some(key => !["userId", "last4", "registeredAt", "registeredBy"].includes(key))
        || !userId || !last4 || !registeredAt || !registeredBy) {
        throw new Error("저장된 RFID 카드 정보를 확인할 수 없습니다.");
      }
      result[fingerprint] = Object.freeze({ userId, last4, registeredAt, registeredBy });
    }
    return result;
  }

  function summaries(value) {
    const stored = Array.isArray(value)
      ? value.reduce((rows, raw) => {
        const row = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
        const userId = normalizeUserId(row.userId);
        const last4 = typeof row.last4 === "string" && /^[0-9]{4}$/.test(row.last4) ? row.last4 : "";
        const registeredAt = typeof row.registeredAt === "string" && ISO_TIME.test(row.registeredAt) ? row.registeredAt : "";
        if (userId && last4 && registeredAt) rows.push(Object.freeze({ userId, last4, registeredAt }));
        return rows;
      }, [])
      : Object.values(normalizeStoredMap(value)).map(row => Object.freeze({
        userId: row.userId,
        last4: row.last4,
        registeredAt: row.registeredAt,
      }));
    const byUser = new Map();
    summariesLoop: for (const row of stored) {
      if (byUser.has(row.userId)) continue summariesLoop;
      byUser.set(row.userId, row);
    }
    return Object.freeze([...byUser.values()].sort((a, b) => a.userId.localeCompare(b.userId)));
  }

  function replaceCard(value, input) {
    const stored = normalizeStoredMap(value);
    const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const userId = normalizeUserId(source.userId);
    const cardCode = normalizeCardCode(source.cardCode);
    const registeredBy = normalizeUserId(source.registeredBy);
    const registeredAt = typeof source.registeredAt === "string" && ISO_TIME.test(source.registeredAt) ? source.registeredAt : "";
    const fingerprint = fingerprintCardCode(cardCode);
    if (!userId || !cardCode || !registeredBy || !registeredAt || !fingerprint) {
      throw new Error("직원과 카드 정보를 확인해 주세요.");
    }
    const duplicate = stored[fingerprint];
    if (duplicate && duplicate.userId !== userId) {
      const error = new Error("이미 다른 직원에게 등록된 카드입니다.");
      error.code = "RFID_CARD_DUPLICATE";
      throw error;
    }
    const next = Object.create(null);
    Object.entries(stored).forEach(([key, row]) => {
      if (row.userId !== userId && key !== fingerprint) next[key] = row;
    });
    next[fingerprint] = duplicate && duplicate.userId === userId ? duplicate : {
      userId,
      last4: cardCode.slice(-4),
      registeredAt,
      registeredBy,
    };
    return { map: next, fingerprint };
  }

  function removeCard(value, userIdValue) {
    const stored = normalizeStoredMap(value);
    const userId = normalizeUserId(userIdValue);
    if (!userId) throw new Error("카드를 해제할 직원을 확인해 주세요.");
    const next = Object.create(null);
    Object.entries(stored).forEach(([fingerprint, row]) => {
      if (row.userId !== userId) next[fingerprint] = row;
    });
    return next;
  }

  function registeredForUser(value, userIdValue) {
    const userId = normalizeUserId(userIdValue);
    return summaries(value).find(row => row.userId === userId) || null;
  }

  return Object.freeze({
    MAX_CARDS,
    normalizeUserId,
    normalizeCardCode,
    fingerprintCardCode,
    normalizeStoredMap,
    summaries,
    replaceCard,
    removeCard,
    registeredForUser,
  });
});
