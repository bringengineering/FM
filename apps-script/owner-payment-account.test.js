/**
 * 입금 계좌 fail-closed 동작 검증.
 * 계좌가 설정되지 않았거나 예시값이면 건물주에게 보여주지도, 저장하지도 않아야 한다.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sourcePath = path.join(__dirname, "complaint-intake-to-firebase.gs");
const source = fs.readFileSync(sourcePath, "utf8");

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Apps Script function not found: ${name}`);
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const current = source[index];
    if (current === "{") depth += 1;
    else if (current === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated function: ${name}`);
}

const FUNCTIONS = [
  "ownerPaymentAccountDigits_",
  "validateOwnerPaymentAccount_",
  "tryResolveOwnerPaymentAccount_",
  "resolveOwnerPaymentAccount_",
];

/** properties 가 null 이면 PropertiesService 자체가 없는 환경(테스트 하네스)을 흉내낸다. */
function makeContext(properties) {
  const context = {
    console,
    String,
    Number,
    Object,
    Array,
    JSON,
    Error,
    OWNER_PAYMENT_ACCOUNT_NUMBER_PROPERTY: "OWNER_PAYMENT_ACCOUNT_NUMBER",
    OWNER_PAYMENT_ACCOUNT_HOLDER_PROPERTY: "OWNER_PAYMENT_ACCOUNT_HOLDER",
    OWNER_PAYMENT_ACCOUNT_PLACEHOLDERS: ["123456789012"],
    OWNER_PAYMENT_ACCOUNT_UNSET_MESSAGE: "입금 계좌가 설정되지 않았습니다.",
  };
  if (properties) {
    context.PropertiesService = {
      getScriptProperties() {
        return { getProperty: (key) => (key in properties ? properties[key] : null) };
      },
    };
  }
  vm.createContext(context);
  vm.runInContext(FUNCTIONS.map(extractFunction).join("\n\n"), context, { filename: sourcePath });
  return context;
}

const VALID = {
  OWNER_PAYMENT_ACCOUNT_NUMBER: "352-0000-0000-11",
  OWNER_PAYMENT_ACCOUNT_HOLDER: "브링케어",
};

test("소스에 예시 계좌번호가 남아 있지 않다", () => {
  assert.ok(!source.includes("123-456-789012"), "하드코딩된 예시 계좌가 소스에 남아 있으면 안 된다");
});

test("설정된 계좌를 정상적으로 읽는다", () => {
  const ctx = makeContext(VALID);
  // vm 컨텍스트에서 만들어진 객체라 프로토타입이 달라 값으로 비교한다.
  const account = ctx.tryResolveOwnerPaymentAccount_();
  assert.equal(account.accountNumber, "352-0000-0000-11");
  assert.equal(account.accountHolder, "브링케어");
  assert.equal(ctx.resolveOwnerPaymentAccount_().accountHolder, "브링케어");
});

test("계좌가 설정되지 않으면 표시용은 null, 저장용은 예외", () => {
  const ctx = makeContext({});
  assert.equal(ctx.tryResolveOwnerPaymentAccount_(), null);
  assert.throws(() => ctx.resolveOwnerPaymentAccount_(), /입금 계좌가 설정되지 않았습니다/);
});

test("예시(placeholder) 계좌번호는 거부한다", () => {
  const ctx = makeContext({
    OWNER_PAYMENT_ACCOUNT_NUMBER: "123-456-789012",
    OWNER_PAYMENT_ACCOUNT_HOLDER: "브링케어",
  });
  assert.equal(ctx.tryResolveOwnerPaymentAccount_(), null, "예시 계좌는 절대 통과하면 안 된다");
  assert.throws(() => ctx.resolveOwnerPaymentAccount_(), /입금 계좌가 설정되지 않았습니다/);
});

test("하이픈 유무와 상관없이 예시 계좌를 거부한다", () => {
  const ctx = makeContext({
    OWNER_PAYMENT_ACCOUNT_NUMBER: "123456789012",
    OWNER_PAYMENT_ACCOUNT_HOLDER: "브링케어",
  });
  assert.equal(ctx.tryResolveOwnerPaymentAccount_(), null);
});

test("형식이 잘못된 값은 거부한다", () => {
  const ctx = makeContext(VALID);
  const bad = [
    { accountNumber: "", accountHolder: "브링케어" },
    { accountNumber: "352-0000-0000-11", accountHolder: "" },
    { accountNumber: "계좌번호문의", accountHolder: "브링케어" },
    { accountNumber: "12-34", accountHolder: "브링케어" },
    { accountNumber: "352 0000 0000", accountHolder: "브링케어" },
  ];
  for (const account of bad) {
    assert.equal(ctx.validateOwnerPaymentAccount_(account), null, JSON.stringify(account));
  }
});

test("예금주만 있고 계좌번호가 없으면 거부한다", () => {
  const ctx = makeContext({ OWNER_PAYMENT_ACCOUNT_HOLDER: "브링케어" });
  assert.equal(ctx.tryResolveOwnerPaymentAccount_(), null);
});
