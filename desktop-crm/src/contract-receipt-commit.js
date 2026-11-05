"use strict";
const crypto = require("node:crypto");
const Core = require("./core");
const id = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(value) && !["__proto__", "constructor", "prototype"].includes(value);
const fail = code => { throw Object.assign(new Error("계약 입금 변경을 확인해 주세요."), { code }); };
const stable = value => JSON.stringify(value, Object.keys(value).sort());
function closed(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) fail("RECEIPT_INVALID");
  return value;
}
function validate(input) {
  closed(input, ["requestId", "contractId", "dueDate", "base", "collectionStatus", "memo"]);
  if (typeof input.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)
    || !id(input.contractId) || !Core.isContractPaymentDate(input.dueDate)
    || !["입금 예정", "입금 완료"].includes(input.collectionStatus)
    || typeof input.memo !== "string" || input.memo.length > 2000) fail("RECEIPT_INVALID");
  const base = closed(input.base, ["updatedAt", "revision", "paymentDueDate", "billingCycle", "endDate", "status", "customerId", "buildingId", "amount", "collectionStatus", "memo"]);
  for (const key of ["updatedAt", "paymentDueDate", "billingCycle", "endDate", "status", "customerId", "buildingId", "collectionStatus", "memo"]) {
    if (typeof base[key] !== "string" || base[key].length > (key === "memo" ? 2000 : 160)) fail("RECEIPT_INVALID");
  }
  if (!Number.isSafeInteger(base.revision) || base.revision < 0 || base.revision >= Number.MAX_SAFE_INTEGER
    || !Number.isSafeInteger(base.amount) || base.amount < 0 || base.amount > 1_000_000_000_000) fail("RECEIPT_INVALID");
  Core.assertNoProhibitedSecrets({ memo: input.memo });
  return { ...input, base: { ...base } };
}
function intent(input, uid) {
  return crypto.createHash("sha256").update(JSON.stringify([uid, input.contractId, input.dueDate, stable(input.base), input.collectionStatus, input.memo])).digest("hex");
}
function plan(inputValue, { existing, actor, now = new Date() }) {
  const input = validate(inputValue);
  Core.assertMutationAllowed(actor);
  if (!id(actor.uid) || (actor.role === "member" && actor.marketingRole === "marketing")) fail("READ_ONLY_ACCOUNT");
  const row = Core.contractPaymentRows(existing ? [existing] : [], input.dueDate.slice(0, 7)).find(item => item.contract.id === input.contractId && item.dueDate === input.dueDate);
  if (!row) fail("RECEIPT_NOT_FOUND");
  const hash = intent(input, actor.uid);
  if (existing.receiptQuickRequestId === input.requestId) {
    if (existing.receiptQuickHash !== hash) fail("RECEIPT_CONFLICT");
    return { record: structuredClone(existing), repeated: true };
  }
  if (stable(Core.contractPaymentQuickBase(existing, input.dueDate)) !== stable(input.base)) fail("RECEIPT_CONFLICT");
  let stamp = new Date(now).getTime();
  const previous = Date.parse(existing.updatedAt);
  if (!Number.isFinite(stamp)) fail("RECEIPT_INVALID");
  if (Number.isFinite(previous)) stamp = Math.max(stamp, previous + 1);
  if (!Number.isFinite(new Date(stamp).getTime())) fail("RECEIPT_CONFLICT");
  const fields = Core.contractPaymentFields(existing, { ...existing, collectionDueDate: input.dueDate, collectionStatus: input.collectionStatus });
  const record = { ...structuredClone(existing), ...fields, memo: input.memo, updatedAt: new Date(stamp).toISOString(),
    receiptQuickVersion: input.base.revision + 1, receiptQuickRequestId: input.requestId, receiptQuickHash: hash, receiptQuickUpdatedBy: actor.uid };
  return { record, repeated: false };
}
function envelope(error) {
  const raw = String(error && error.code || "");
  const code = ({ BUILDING_SCHEDULE_CONFLICT: "RECEIPT_CONFLICT", BUILDING_SCHEDULE_WRITE_UNCONFIRMED: "RECEIPT_UNCONFIRMED",
    AUTH_REQUIRED: "SESSION_CHANGED", PASSWORD_CHANGE_REQUIRED: "READ_ONLY_ACCOUNT", MARKETING_ONLY_FORBIDDEN: "READ_ONLY_ACCOUNT" })[raw] || raw;
  const messages = {
    RECEIPT_INVALID: "입금 상태와 메모를 다시 확인해 주세요. 메모는 2,000자까지 입력할 수 있습니다.",
    RECEIPT_CONFLICT: "다른 곳에서 계약이 변경되었습니다. 최신 내용을 불러온 후 다시 확인해 주세요.",
    RECEIPT_NOT_FOUND: "입금 일정이 변경되었거나 계약을 찾을 수 없습니다. 최신 내용을 불러와 주세요.",
    RECEIPT_UNCONFIRMED: "저장 결과를 확인할 수 없습니다. 같은 내용으로 다시 저장하거나 최신 내용을 불러와 확인해 주세요.",
    SESSION_CHANGED: "로그인 상태가 변경되었습니다. 다시 로그인해 주세요.",
    READ_ONLY_ACCOUNT: "현재 계정은 계약 입금 정보를 변경할 수 없습니다.",
    PROHIBITED_SENSITIVE_VALUE: "비밀번호 등 민감정보는 메모에 저장할 수 없습니다.",
  };
  return { ok: false, code: messages[code] ? code : "RECEIPT_FAILED", error: messages[code] || "입금 정보를 저장하지 못했습니다. 연결과 권한을 확인해 주세요." };
}
module.exports = { validate, plan, envelope };
