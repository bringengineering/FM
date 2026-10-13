import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {createDocumentDeliveryHandler, readNcpDocumentConnection} from "../src/document-delivery.js";

const env = {NCP_ACCESS_KEY: "fixture-access", NCP_SECRET_KEY: "fixture-secret", NCP_BIZ_MESSAGE_SERVICE_ID: "ncp:kkobizmsg:kr:fixture:service", KAKAO_CHANNEL_ID: "@fixture"};
const code = "BRINGCOMPLETIONREPORTV1";
const ready = [{templateCode: code, channelId: "@fixture", templateInspectionStatus: "COMPLETE", templateStatus: "ACTIVE", isBlock: false, isDormant: false, content: "SECRET_SENTINEL"}];

test("connection diagnosis signs one bounded GET and sends no message or customer data", async () => {
  let request;
  const value = await readNcpDocumentConnection(code, env, {now: () => 1791849600000, fetchImpl: async (url, init) => {request = {url, init}; return Response.json(ready);}});
  assert.equal(value, "READY"); assert.equal(request.init.method, "GET"); assert.equal(request.init.body, undefined);
  const uri = "/alimtalk/v2/services/ncp:kkobizmsg:kr:fixture:service/templates?channelId=%40fixture&templateCode=BRINGCOMPLETIONREPORTV1&pageSize=1";
  assert.equal(request.url, "https://sens.apigw.ntruss.com" + uri);
  assert.equal(request.init.headers["x-ncp-apigw-signature-v2"], createHmac("sha256", "fixture-secret").update(`GET ${uri}\n1791849600000\nfixture-access`).digest("base64"));
  assert.equal(request.init.redirect, "error"); assert.ok(request.init.signal);
  assert.doesNotMatch(value, /SECRET_SENTINEL|fixture-access|fixture-secret/);
});

test("connection diagnosis distinguishes auth, service, network, template and response errors without raw bodies", async () => {
  for (const [response, expected] of [[Response.json({error: "SECRET_SENTINEL"}, {status: 401}), "AUTH_REJECTED"],
    [Response.json({}, {status: 404}), "SERVICE_NOT_FOUND"], [Response.json([], {status: 200}), "TEMPLATE_NOT_FOUND"],
    [Response.json([{...ready[0], templateInspectionStatus: "REGISTER"}]), "TEMPLATE_NOT_READY"],
    [new Response("SECRET_SENTINEL"), "PROVIDER_RESPONSE_INVALID"]]) {
    assert.equal(await readNcpDocumentConnection(code, env, {fetchImpl: async () => response}), expected);
  }
  assert.equal(await readNcpDocumentConnection(code, env, {fetchImpl: async () => {throw new Error("SECRET_SENTINEL");}}), "PROVIDER_NETWORK_ERROR");
  assert.equal(await readNcpDocumentConnection(code, {...env, KAKAO_CHANNEL_ID: "invalid\nchannel"}), "CONFIGURATION_ERROR");
});

test("querying an existing unknown request diagnoses the connection, never retries its POST", async () => {
  let sends = 0, reads = 0;
  const stored = {ok: true, messageId: "fixture_message", status: "unknown", channel: "kakao", templateId: code};
  const runtime = {...env, CRM_ADMIN_EMAILS: "admin@example.com", DOCUMENT_DELIVERY: {get: async () => structuredClone(stored)}};
  const handler = createDocumentDeliveryHandler({sendProvider: async () => {sends++;}, readConnection: async () => {reads++;return "AUTH_REJECTED";}});
  const request = () => new Request("https://gateway.test/v1/document-delivery/messages/fixture_message");
  assert.equal((await handler(request(), null, runtime)).status, 401);
  assert.equal((await handler(request(), {email: "member@example.com"}, runtime)).status, 403);
  assert.equal(reads, 0);
  const result = await (await handler(request(), {email: "admin@example.com"}, runtime)).json();
  assert.equal(result.status, "unknown"); assert.equal(result.connectionCode, "AUTH_REJECTED");
  assert.equal(reads, 1); assert.equal(sends, 0);
});
