"use strict";

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
  let quote = "";
  let escaped = false;
  for (let index = braceStart; index < source.length; index += 1) {
    const current = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === quote) quote = "";
      continue;
    }
    if (current === "\"" || current === "'" || current === "`") {
      quote = current;
      continue;
    }
    if (current === "{") depth += 1;
    if (current === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unclosed Apps Script function: ${name}`);
}

let deliveryResponse = {
  ok: true,
  json: {
    requestStatusCode: "A000",
    requestStatusName: "success",
    requestStatusDesc: "성공",
    messageStatusCode: "3016",
    messageStatusName: "fail",
    messageStatusDesc: "NoMatchedTemplateException",
    templateCode: "BRINGRENTREMINDERV1",
    to: "01055553077",
    content: "sensitive message body"
  }
};
let savedRecord = null;
let requestedUri = "";

const context = {
  String,
  Date,
  Object,
  AUTOMATION_BUILD: "complaint-workflow-20260730-v50",
  firebasePaymentCalendarUrl_(uid, childPath) {
    return `${uid}/${childPath}`;
  },
  firebaseReadJson_() {
    return {
      ok: true,
      provider: "kakao_alimtalk",
      messageId: "message-id-303",
      templateCode: "BRINGRENTREMINDERV1",
      phoneMasked: "010-****-3077"
    };
  },
  getKakaoAlimTalkConfig_() {
    return {
      enabled: true,
      serviceId: "ncp:kkobizmsg:kr:test:sens",
      accessKey: "test-access",
      secretKey: "test-secret"
    };
  },
  sensGetJson_(uri) {
    requestedUri = uri;
    return deliveryResponse;
  },
  firebaseAuthorizedWriteRequest_(url, method, value) {
    savedRecord = { url, method, value };
  }
};

vm.createContext(context);
vm.runInContext(extractFunction("handlePaymentReminderDeliveryStatus_"), context, { filename: sourcePath });

const failed = context.handlePaymentReminderDeliveryStatus_({
  uid: "admin-uid",
  idToken: "redacted-token",
  scheduleId: "sched_303",
  month: "2026-07"
});

assert.equal(failed.ok, true);
assert.equal(failed.delivered, false);
assert.equal(failed.deliveryStatus, "failed");
assert.equal(failed.messageStatusCode, "3016");
assert.equal(failed.messageStatusDesc, "NoMatchedTemplateException");
assert.match(requestedUri, /\/alimtalk\/v2\/services\/ncp%3Akkobizmsg%3Akr%3Atest%3Asens\/messages\/message-id-303$/);
assert.equal(savedRecord.method, "put");
assert.equal(savedRecord.value.deliveryStatus, "failed");
assert.equal(savedRecord.value.deliveryCode, "3016");
assert.equal(JSON.stringify(failed).includes("01055553077"), false);
assert.equal(JSON.stringify(failed).includes("sensitive message body"), false);
assert.equal(JSON.stringify(savedRecord).includes("redacted-token"), false);

deliveryResponse = {
  ok: true,
  json: {
    requestStatusCode: "A000",
    requestStatusName: "success",
    messageStatusCode: "0000",
    messageStatusName: "success",
    messageStatusDesc: "정상 발송",
    completeTime: "2026-07-29T16:26:30"
  }
};
const delivered = context.handlePaymentReminderDeliveryStatus_({
  uid: "admin-uid",
  idToken: "redacted-token",
  scheduleId: "sched_303",
  month: "2026-07"
});
assert.equal(delivered.delivered, true);
assert.equal(delivered.deliveryStatus, "delivered");
assert.equal(savedRecord.value.deliveredAt, "2026-07-29T16:26:30");

assert.match(source, /payload\.action === "getPaymentReminderDeliveryStatus"/);
assert.match(source, /makeNcpSignature_\("GET", uri/);
assert.match(source, /const AUTOMATION_BUILD = "complaint-workflow-20260730-v50"/);

console.log("PASS Kakao AlimTalk final delivery status lookup and safe Firebase record");
