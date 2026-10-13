const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
const functionSource = source.slice(source.indexOf("  async function refreshCustomerAlimTalkDelivery("), source.indexOf("  async function refreshDocumentDeliveryCapabilities("));

function harness(result) {
  let reads = 0;
  const state = {receipt: {messageId: "fixture_message", status: "unknown", generation: 1}};
  const context = {customerAlimTalkState: state, authGeneration: 1, currentView: "customerAlimTalk", canAdministerSecurity: () => true,
    renderCustomerAlimTalk: () => {}, api: {readCustomerDocumentDelivery: async () => {reads++; return result;}}};
  vm.runInNewContext(functionSource, context);
  return {state, context, reads: () => reads};
}
test("unknown receipts show an allowlisted connection diagnosis without claiming failed delivery or resending", async () => {
  const h = harness({ok: true, status: "unknown", connectionCode: "AUTH_REJECTED", diagnosticCode: "PROVIDER_NETWORK_ERROR"});
  await h.context.refreshCustomerAlimTalkDelivery();
  assert.match(h.state.result, /인증·권한을 거절/); assert.match(h.state.result, /업체 통신 오류/);
  assert.equal(h.state.receipt.status, "unknown"); assert.equal(h.reads(), 1);
  assert.match(h.state.result, /중복 발송하지/);
});
test("malicious diagnostic strings and provider bodies are never displayed", async () => {
  const h = harness({ok: true, status: "unknown", connectionCode: "<script>SECRET_SENTINEL</script>", diagnosticCode: "constructor", content: "PRIVATE_SENTINEL"});
  await h.context.refreshCustomerAlimTalkDelivery();
  assert.doesNotMatch(h.state.result, /SECRET_SENTINEL|PRIVATE_SENTINEL|constructor|script/);
  h.context.canAdministerSecurity = () => false;
  await h.context.refreshCustomerAlimTalkDelivery(); assert.equal(h.reads(), 1);
});
