import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {createDocumentDeliveryHandler, sendNcpDocument, readNcpDocumentStatus} from "../src/document-delivery.js";

const time = Date.parse("2026-10-13T00:00:00Z");
const env = {CRM_ADMIN_EMAILS: "admin@example.com", DOCUMENT_DELIVERY_ENABLED: "true", KAKAO_DOCUMENT_TEMPLATES_APPROVED: "true", KAKAO_MONTHLY_REPORT_TEMPLATE_APPROVED: "false",
  NCP_ACCESS_KEY: "fixture-access", NCP_SECRET_KEY: "fixture-secret", NCP_BIZ_MESSAGE_SERVICE_ID: "ncp:kkobizmsg:kr:fixture:bring_care_kakao", KAKAO_CHANNEL_ID: "@fixture"};
const outgoing = {channel: "kakao", phone: "01000000000", templateCode: "BRINGCOMPLETIONREPORTV1", env,
  variables: {고객명: "TEST", 문서명: "가상 보고서", 만료일: "2026-10-20", 문서링크: "bring-crm-ai-gateway.bringengineering1008.workers.dev/d/fixture_token_123456"}};
const accepted = {statusCode: "202", statusName: "processing", requestId: "request_fixture", messages: [{messageId: "provider_fixture", requestStatusCode: "A000"}]};

test("NCP resource colons and HMAC use the exact documented request path", async () => {
  let request;
  await sendNcpDocument(outgoing, {now: () => time, fetchImpl: async (url, init) => {request = {url, init}; return Response.json(accepted, {status: 202});}});
  const path = "/alimtalk/v2/services/ncp:kkobizmsg:kr:fixture:bring_care_kakao/messages";
  assert.equal(request.url, "https://sens.apigw.ntruss.com" + path);
  assert.equal(request.init.headers["x-ncp-apigw-signature-v2"], createHmac("sha256", "fixture-secret").update(`POST ${path}\n${time}\nfixture-access`).digest("base64"));
  assert.equal(request.init.redirect, "manual");
  assert.ok(request.init.signal);
  assert.equal(JSON.parse(request.init.body).templateCode, "BRINGCOMPLETIONREPORTV1");
});

for (const [http, code] of [[401,"DELIVERY_PROVIDER_AUTH_FAILED"],[403,"DELIVERY_PROVIDER_AUTH_FAILED"],[404,"DELIVERY_PROVIDER_SERVICE_NOT_FOUND"],[429,"DELIVERY_PROVIDER_LIMITED"],[400,"DELIVERY_PROVIDER_REJECTED"],[503,"DELIVERY_STATUS_UNKNOWN"]]) {
  test(`provider HTTP ${http} exposes only a safe category`, async () => {
    await assert.rejects(sendNcpDocument(outgoing, {fetchImpl: async () => Response.json({error: "SECRET_SENTINEL", phone: "01000000000"}, {status: http})}), error => error.code === code && !/SECRET_SENTINEL|01000000000/.test(error.message));
  });
}
test("HTTP acceptance alone never proves AlimTalk request or delivery success", async () => {
  await assert.rejects(sendNcpDocument(outgoing, {fetchImpl: async () => Response.json({...accepted, messages: [{messageId:"provider_fixture",requestStatusCode:"A001"}]}, {status:202})}), {code:"DELIVERY_PROVIDER_REJECTED"});
  await assert.rejects(sendNcpDocument(outgoing, {fetchImpl: async () => Response.json({requestId:"request_fixture"}, {status:202})}), {code:"DELIVERY_STATUS_UNKNOWN"});
  await assert.rejects(sendNcpDocument(outgoing, {fetchImpl: async () => {throw new Error("token=SECRET_SENTINEL");}}), {code:"DELIVERY_STATUS_UNKNOWN"});
});

test("receipt query returns only delivery state and never customer/provider bodies", async () => {
  const record = {channel:"kakao",providerMessageId:"provider_fixture"};
  for (const [provider, expected] of [
    [{messageStatusCode:"0000",messageStatusName:"success"},{status:"delivered"}],
    [{messageStatusName:"processing"},{status:"requested"}],
    [{messageStatusCode:"3016",messageStatusName:"fail"},{status:"failed",failureCode:"3016"}],
    [{messageStatusCode:"3005",messageStatusName:"fail"},{status:"unknown",failureCode:"3005"}],
  ]) {
    const result = await readNcpDocumentStatus(record, env, {fetchImpl: async () => Response.json({messageId:"provider_fixture",requestStatusCode:"A000",content:"SECRET_SENTINEL",to:"01000000000",...provider})});
    assert.deepEqual(result,expected);
    assert.doesNotMatch(JSON.stringify(result),/SECRET_SENTINEL|01000000000/);
  }
  await assert.rejects(readNcpDocumentStatus(record, env, {fetchImpl: async () => Response.json({messageId:"wrong",messageStatusCode:"0000",messageStatusName:"success"})}), {code:"DELIVERY_STATUS_UNAVAILABLE"});
});

function harness(options = {}) {
  const values = new Map(), calls = [];
  const storage = {async put(key,value){values.set(key,value);}, async get(key,type){if(options.coldReads && key.startsWith("doc:"))return null;const value=values.get(key);return type==="json"&&value?JSON.parse(value):value||null;}};
  const handler = createDocumentDeliveryHandler({now:()=>time, sendProvider: async input => {calls.push(input);if(options.error)throw Object.assign(Error(options.error),{code:options.error});return {providerMessageId:"provider_fixture"};}, readProvider:async()=>({status:"delivered"})});
  const runtime = {...env,DOCUMENT_DELIVERY:storage};
  const input = {documentId:"report_fixture",customerId:"customer_fixture",documentType:"completion_report",documentName:"TEST 仮想報告書",expiresAt:"2026-10-20T00:00:00Z",mimeType:"application/pdf",bytes:btoa("%PDF-1.7\nTEST ONLY\n%%EOF"),
    delivery:{channel:"kakao",idempotencyKey:"request_fixture_123",customerName:"TEST",phone:"01000000000"}};
  const send = (identity={email:"admin@example.com"}, payload=input) => handler(new Request("https://gateway.test/v1/document-delivery/documents-and-messages",{method:"POST",body:JSON.stringify(payload)}),identity,runtime);
  return {values,calls,handler,runtime,input,send,options};
}
test("combined PDF/send avoids a fresh KV read and deduplicates sequential requests",async()=>{
  const h=harness({coldReads:true});
  const first=await (await h.send()).json(), second=await (await h.send()).json();
  assert.equal(first.status,"requested");assert.deepEqual(first,second);assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].document.bytes,h.input.bytes);
});
test("ambiguous provider outcome preserves the PDF and never automatically sends twice",async()=>{
  const h=harness({error:"DELIVERY_STATUS_UNKNOWN"});const result=await (await h.send()).json();
  assert.equal(result.status,"unknown");await h.send();assert.equal(h.calls.length,1);
  assert.equal(JSON.parse(h.values.get(`doc:${result.documentId}`)).revokedAt,undefined);
});
test("confirmed provider rejection revokes only the new link and permits explicit retry",async()=>{
  const h=harness({error:"DELIVERY_PROVIDER_AUTH_FAILED"});const response=await h.send(), result=await response.json();
  assert.equal(response.status,502);assert.equal(result.code,"DELIVERY_PROVIDER_AUTH_FAILED");
  assert.ok(JSON.parse(h.values.get(`doc:${result.documentId}`)).revokedAt);
  h.options.error="";assert.equal((await (await h.send()).json()).status,"requested");assert.equal(h.calls.length,2);
});
test("combined route denies anonymous/staff, unapproved monthly reports and invalid recipients before sending",async()=>{
  const h=harness();assert.equal((await h.send(null)).status,401);assert.equal((await h.send({email:"staff@example.com"})).status,403);
  await assert.rejects(h.send(undefined,{...h.input,documentType:"monthly_report",reportMonth:"2026-10"}),{code:"DELIVERY_UNAVAILABLE"});
  await assert.rejects(h.send(undefined,{...h.input,delivery:{...h.input.delivery,phone:"invalid"}}),{code:"INVALID_INPUT"});
  assert.equal(h.values.size,0);assert.equal(h.calls.length,0);
});
test("stored message status is refreshed with the provider's actual delivery result",async()=>{
  const h=harness();const sent=await (await h.send()).json();
  const response=await h.handler(new Request(`https://gateway.test/v1/document-delivery/messages/${sent.messageId}`),{email:"admin@example.com"},h.runtime);
  assert.equal((await response.json()).status,"delivered");assert.equal(h.calls.length,1);
});
