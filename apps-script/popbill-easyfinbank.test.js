"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "complaint-intake-to-firebase.gs"), "utf8");

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Function not found: ${name}`);
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = braceStart; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (current === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (current === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === quote) quote = "";
      continue;
    }
    if (current === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (current === "\"" || current === "'" || current === "`") {
      quote = current;
      continue;
    }
    if (current === "{") depth += 1;
    if (current === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unclosed function: ${name}`);
}

const context = {
  String,
  Boolean,
  JSON,
  Object,
  Array,
  POPBILL_EASYFINBANK_SCOPE: ["180", "member"],
  POPBILL_API_VERSION: "2.0"
};
vm.createContext(context);
vm.runInContext([
  extractFunction("popbillBoolean_"),
  extractFunction("popbillConfigFromValues_"),
  extractFunction("popbillTokenRequestBody_"),
  extractFunction("popbillStringToSign_")
].join("\n"), context);

const config = context.popbillConfigFromValues_({
  POPBILL_IS_TEST: "true",
  POPBILL_LINK_ID: "LINK_ID",
  POPBILL_SECRET_KEY: "SECRET",
  POPBILL_CORP_NUM: "748-28-01935",
  POPBILL_USER_ID: "bringengineering1008"
});
assert.equal(config.isTest, true);
assert.equal(config.serviceId, "POPBILL_TEST");
assert.equal(config.corpNum, "7482801935");
assert.equal(config.apiBaseUrl, "https://popbill-test.linkhub.co.kr");

assert.deepEqual(
  JSON.parse(context.popbillTokenRequestBody_("748-28-01935")),
  { access_id: "7482801935", scope: ["180", "member"] }
);
assert.equal(
  context.popbillStringToSign_("POPBILL_TEST", "DIGEST", "2026-07-29T01:02:03Z", "*"),
  [
    "POST",
    "DIGEST",
    "2026-07-29T01:02:03Z",
    "*",
    "2.0",
    "/POPBILL_TEST/Token"
  ].join("\n")
);

assert.throws(
  () => context.popbillConfigFromValues_({
    POPBILL_LINK_ID: "",
    POPBILL_SECRET_KEY: "",
    POPBILL_CORP_NUM: "7482801935"
  }),
  /POPBILL_LINK_ID.*POPBILL_SECRET_KEY/
);

assert.match(source, /POPBILL_EASYFINBANK_SCOPE = \["180", "member"\]/);
assert.match(source, /Utilities\.computeHmacSha256Signature/);
assert.match(source, /Utilities\.base64Decode\(config\.secretKey\)/);
assert.match(source, /\/EasyFin\/Bank\?TG=BankAccount/);
assert.doesNotMatch(
  extractFunction("verifyPopbillEasyFinBankConnection"),
  /secretKey|accountNumber:\s*number/,
  "연결 확인 로그에는 비밀키나 전체 계좌번호를 포함하지 않는다"
);

console.log("popbill easyfinbank tests passed");
