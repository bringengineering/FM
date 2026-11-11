const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");
const assert = require("assert");

const sourcePath = path.join(__dirname, "complaint-intake-to-firebase.gs");
const source = fs.readFileSync(sourcePath, "utf8");

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  let depth = 0;
  let opened = false;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
      opened = true;
    } else if (source[index] === "}") {
      depth -= 1;
      if (opened && depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

function constant(name) {
  const match = source.match(new RegExp(`const ${name} = ([^;]+);`));
  assert.ok(match, `missing constant ${name}`);
  return `const ${name} = ${match[1]};`;
}

const store = {};
const PropertiesService = {
  getScriptProperties() {
    return {
      getProperty: key => Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null,
      setProperty: (key, value) => {
        assert.ok(Buffer.byteLength(String(value), "utf8") <= 9000, `${key} exceeds the property size limit`);
        store[key] = String(value);
      },
      setProperties: values => Object.keys(values).forEach(key => {
        assert.ok(Buffer.byteLength(String(values[key]), "utf8") <= 9000, `${key} exceeds the property size limit`);
        store[key] = String(values[key]);
      }),
      deleteProperty: key => { delete store[key]; },
      getProperties: () => Object.assign({}, store)
    };
  }
};
const Utilities = {
  DigestAlgorithm: { SHA_256: "sha256" },
  Charset: { UTF_8: "utf8" },
  computeDigest: (algorithm, value) => Array.from(crypto.createHash(algorithm).update(String(value), "utf8").digest()),
  computeHmacSha256Signature: (data, key) =>
    Array.from(crypto.createHmac("sha256", Buffer.from(key)).update(Buffer.from(data)).digest()),
  newBlob: text => ({ getBytes: () => Array.from(Buffer.from(String(text), "utf8")) }),
  base64Decode: text => Array.from(Buffer.from(String(text), "base64")),
  base64EncodeWebSafe: bytes => Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_"),
  formatDate: (date, timeZone, pattern) => {
    assert.equal(pattern, "yyyy-MM-dd");
    return new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  }
};
let triggerEnsured = 0;
const context = {
  Date, Math, Number, String, Object, Array, JSON, Buffer,
  PropertiesService,
  Utilities,
  ensurePaymentNotificationTrigger_: () => { triggerEnsured += 1; }
};
vm.createContext(context);
vm.runInContext([
  constant("AUTOMATION_BUILD"),
  constant("PAYMENT_NOTIFICATION_CONFIG_PROPERTY"),
  constant("PAYMENT_NOTIFICATION_LEDGER_PREFIX"),
  constant("PAYMENT_NOTIFICATION_BINDINGS_PREFIX"),
  constant("PAYMENT_NOTIFICATION_LEDGER_RETENTION_DAYS"),
  constant("POPBILL_ACCOUNT_REF_KEY_PROPERTY"),
  constant("SCRIPT_PROPERTY_CHUNK_CHARS"),
  extractFunction("scriptPropertyChunkedRead_"),
  extractFunction("scriptPropertyChunkedWrite_"),
  extractFunction("paymentNotificationSafeBindings_"),
  extractFunction("paymentNotificationParseConfig_"),
  extractFunction("paymentNotificationReadAdminBindings_"),
  extractFunction("rememberPaymentNotificationAutomation_"),
  extractFunction("paymentNotificationConfig_"),
  extractFunction("paymentNotificationDateKey_"),
  extractFunction("paymentNotificationLedgerKey_"),
  extractFunction("paymentNotificationLedger_"),
  extractFunction("cleanupPaymentNotificationLedgers_"),
  extractFunction("popbillAccountRefKey_"),
  extractFunction("popbillBankAccountRef_")
].join("\n"), context);

function clearStore() {
  Object.keys(store).forEach(key => delete store[key]);
}

// 1) 발송 기록: 하루 수백 건이어도 속성 크기 한도를 넘지 않고, 다시 읽어도 그대로다.
{
  clearStore();
  const ledger = context.paymentNotificationLedger_("2026-07-30");
  const ids = [];
  for (let index = 0; index < 1500; index += 1) {
    const id = `tenant_overdue_schedule-${"x".repeat(40)}-${index}_2026-07-29`;
    ids.push(id);
    ledger.add(id);
  }
  ledger.save();
  const reread = context.paymentNotificationLedger_("2026-07-30");
  assert.ok(ids.every(id => reread.has(id)), "저장한 발송 기록을 모두 다시 찾는다");
  assert.equal(reread.has("tenant_due_other_2026-07-30"), false);
  assert.ok(Number(store["PAYMENT_NOTIFICATION_LEDGER_20260730#n"]) > 1, "큰 기록은 여러 속성으로 나눠 저장한다");
}

// 2) 예전 형식(이벤트 ID 전체 JSON) 기록도 읽고, 저장 시 새 형식으로 옮긴다.
{
  clearStore();
  store.PAYMENT_NOTIFICATION_LEDGER_20260728 = JSON.stringify({ "tenant_overdue_s1_2026-07-27": true });
  const ledger = context.paymentNotificationLedger_("2026-07-28");
  assert.equal(ledger.has("tenant_overdue_s1_2026-07-27"), true, "예전 기록으로 이미 보낸 알림을 다시 보내지 않는다");
  ledger.add("tenant_overdue_s2_2026-07-27");
  ledger.save();
  assert.equal(store.PAYMENT_NOTIFICATION_LEDGER_20260728, undefined);
  const reread = context.paymentNotificationLedger_("2026-07-28");
  assert.equal(reread.has("tenant_overdue_s1_2026-07-27"), true);
  assert.equal(reread.has("tenant_overdue_s2_2026-07-27"), true);
}

// 3) 오래된 기록 정리는 나눠 저장한 속성까지 함께 지운다.
{
  clearStore();
  store["PAYMENT_NOTIFICATION_LEDGER_20260501#0"] = "a";
  store["PAYMENT_NOTIFICATION_LEDGER_20260501#n"] = "1";
  store.PAYMENT_NOTIFICATION_LEDGER_20260502 = "{}";
  store["PAYMENT_NOTIFICATION_LEDGER_20260725#n"] = "0";
  context.cleanupPaymentNotificationLedgers_("2026-07-30");
  assert.deepEqual(Object.keys(store), ["PAYMENT_NOTIFICATION_LEDGER_20260725#n"]);
}

// 4) 다른 관리자가 캘린더를 열어도 기존 자동 알림 계좌 연결이 사라지지 않는다.
{
  clearStore();
  const bindingA = { buildingA: { accountRef: "pb_aaaaaaaaaaaaaaaaaaaaaaaa", buildingName: "햇빛빌라" } };
  // 예전 형식 설정(한 관리자 전체 덮어쓰기)에서 시작한다.
  store.PAYMENT_NOTIFICATION_AUTOMATION_CONFIG = JSON.stringify({
    uid: "adminAAA", adminEmail: "a@example.com", bankBindings: bindingA, updatedAt: "2026-07-01T00:00:00.000Z"
  });
  assert.deepEqual(Object.keys(context.paymentNotificationConfig_().bankBindings), ["buildingA"], "예전 설정도 그대로 읽는다");
  context.rememberPaymentNotificationAutomation_({ uid: "adminBBB", adminEmail: "b@example.com" }, {});
  assert.deepEqual(Object.keys(context.paymentNotificationConfig_().bankBindings), ["buildingA"], "연결 없는 관리자가 열어도 유지");
  context.rememberPaymentNotificationAutomation_(
    { uid: "adminBBB", adminEmail: "b@example.com" },
    { buildingB: { accountRef: "pb_bbbbbbbbbbbbbbbbbbbbbbbb", buildingName: "달빛빌라" } }
  );
  assert.deepEqual(Object.keys(context.paymentNotificationConfig_().bankBindings).sort(), ["buildingA", "buildingB"], "관리자별 연결을 합친다");
  context.rememberPaymentNotificationAutomation_({ uid: "adminAAA", adminEmail: "a@example.com" }, {});
  assert.deepEqual(Object.keys(context.paymentNotificationConfig_().bankBindings), ["buildingB"], "본인이 해제한 연결만 빠진다");
  assert.ok(triggerEnsured >= 3);
}

// 5) 계좌 연결 ID는 처음 정한 키로 고정돼, 팝빌 SecretKey를 바꿔도 같다.
{
  clearStore();
  const account = { bankCode: "0088", accountNumber: "110123451076" };
  const oldSecret = Buffer.from("old-secret-key").toString("base64");
  const before = context.popbillBankAccountRef_(account, { secretKey: oldSecret });
  assert.equal(store.POPBILL_ACCOUNT_REF_KEY, oldSecret, "처음에는 기존 SecretKey로 키를 정해 기존 연결을 유지한다");
  const after = context.popbillBankAccountRef_(account, { secretKey: Buffer.from("new-secret-key").toString("base64") });
  assert.equal(after, before, "SecretKey를 바꿔도 계좌 연결 ID가 같다");
  assert.match(before, /^pb_[A-Za-z0-9_-]{24}$/);
}

console.log("payment notification storage tests passed");
