import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import miniflare from "miniflare";
import monthlyTemplate from '../templates/BRINGMONTHLYREPORTV1.json' with {type:'json'};
const {Miniflare, convertV4MiniflareOptions} = miniflare;

// Exercise the real Workers fetch implementation, not Node's more permissive
// Request constructor. Never connect to a real provider or use real credentials.
const source = readFileSync(new URL("../src/document-delivery.js", import.meta.url), "utf8");
const fixture = {NCP_ACCESS_KEY: "fixture-access", NCP_SECRET_KEY: "fixture-secret", NCP_BIZ_MESSAGE_SERVICE_ID: "ncp:kkobizmsg:kr:fixture:service", KAKAO_CHANNEL_ID: "@fixture"};
const template = "BRINGCOMPLETIONREPORTV1";

async function runtime(script, method, uri, body, status = 200, headers = {}) {
  const calls = [];
  // Replace every outbound destination, including any unexpected redirect.
  // There is no network fallback, real recipient or real credential.
  const outboundService = async request => {
    const url = new URL(request.url);
    calls.push({origin: url.origin, path: url.pathname + url.search, method: request.method});
    assert.equal(url.origin, "https://sens.apigw.ntruss.com");
    if (typeof body === 'function') return body(request);
    assert.equal(url.pathname + url.search, uri);
    assert.equal(request.method, method);
    return new Response(JSON.stringify(body), {status, headers: {"content-type": "application/json", ...headers}});
  };
  const bundled = await build({stdin: {contents: source + "\n" + script, resolveDir: fileURLToPath(new URL('../src/', import.meta.url)), loader: 'js'}, bundle: true, write: false, platform: 'browser', format: 'esm', logLevel: 'silent'});
  const legacyOptions = {modules: true, host: "127.0.0.1", compatibilityDate: "2026-08-28", script: bundled.outputFiles[0].text, bindings: fixture, outboundService};
  const mf = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(legacyOptions) : legacyOptions);
  try {
    const response = await mf.dispatchFetch("http://localhost/probe");
    return {value: await response.json(), calls};
  } finally { await mf.dispose(); }
}

test("real workerd reaches the read-only NCP connection probe", async () => {
  const uri = "/alimtalk/v2/services/ncp:kkobizmsg:kr:fixture:service/templates?channelId=%40fixture&templateCode=BRINGCOMPLETIONREPORTV1&pageSize=1";
  const script = `export default {async fetch(request, env) {return Response.json({connection: await readNcpDocumentConnection("${template}", env)});}};`;
  const {value, calls} = await runtime(script, "GET", uri, [{channelId: "@fixture", templateCode: template, templateInspectionStatus: "COMPLETE", templateStatus: "ACTIVE", isBlock: false, isDormant: false}]);
  assert.equal(value.connection, "READY"); assert.equal(calls.length, 1);
});

test("real workerd sends exactly the one mocked AlimTalk request and validates its acknowledgement", async () => {
  const uri = "/alimtalk/v2/services/ncp:kkobizmsg:kr:fixture:service/messages";
  const script = `export default {async fetch(request, env) {try {const result=await sendNcpDocument({channel:"kakao",phone:"01000000000",templateCode:"${template}",env,variables:{고객명:"TEST",문서명:"TEST ONLY",만료일:"2026-10-20",문서링크:"bring-crm-ai-gateway.bringengineering1008.workers.dev/d/fixture_only_token_123"}});return Response.json({ok:true,result});} catch(error) {return Response.json({ok:false,code:error.code,diagnosticCode:error.diagnosticCode});}}};`;
  const {value, calls} = await runtime(script, "POST", uri, {statusCode: "202", messages: [{messageId: "provider_fixture", requestStatusCode: "A000"}]}, 202);
  assert.equal(value.ok, true); assert.equal(value.result.providerMessageId, "provider_fixture"); assert.equal(calls.length, 1);
});

test("real workerd rejects the old error redirect mode before any outbound request", async () => {
  const script = `export default {async fetch() {try {await fetch("https://sens.apigw.ntruss.com/probe",{redirect:"error"});return Response.json({rejected:false});}catch(error){return Response.json({rejected:error.message.includes("Invalid redirect value")});}}};`;
  const {value, calls} = await runtime(script, "GET", "/probe", {});
  assert.equal(value.rejected, true); assert.equal(calls.length, 0);
});

test("real workerd checks exact monthly template approval then sends one AlimTalk", async () => {
  const script = `export default {async fetch(request, env) {const result=await sendNcpDocument({channel:"kakao",phone:"01000000000",templateCode:"BRINGMONTHLYREPORTV1",document:{documentType:"monthly_report"},env:{...env,KAKAO_MONTHLY_REPORT_ENABLED:"true"},variables:{건물주소:"테스트로 0",문서명:"TEST ONLY",보고월:"2026-09",만료일:"2026-10-23",문서링크:"example.invalid/fixture"}});return Response.json({ok:true,result});}};`;
  const {value,calls}=await runtime(script,null,null,async request=>{
    assert.match(request.url,/\/alimtalk\/v2\//);
    if(request.method==='GET') return Response.json([{...monthlyTemplate,channelId:'@fixture',templateInspectionStatus:'COMPLETE',templateStatus:'ACTIVE',isBlock:false,isDormant:false}]);
    assert.equal(request.method,'POST');const sent=await request.json();assert.equal(sent.templateCode,monthlyTemplate.templateCode);assert.match(sent.messages[0].content,/매월 1회/);assert.match(sent.messages[0].content,/1511-3873/);
    return Response.json({statusCode:'202',messages:[{messageId:'provider_fixture',requestStatusCode:'A000'}]});
  });
  assert.equal(value.ok,true);assert.equal(calls.length,2);assert.deepEqual(calls.map(call=>call.method),['GET','POST']);
});

test("real workerd refuses provider redirects without following or forwarding signed headers", async () => {
  const uri = "/alimtalk/v2/services/ncp:kkobizmsg:kr:fixture:service/templates?channelId=%40fixture&templateCode=BRINGCOMPLETIONREPORTV1&pageSize=1";
  const script = `export default {async fetch(request, env) {return Response.json({connection:await readNcpDocumentConnection("${template}",env)});}};`;
  const {value, calls} = await runtime(script, "GET", uri, {}, 302, {location:"http://127.0.0.1/private"});
  assert.equal(value.connection, "PROVIDER_REJECTED"); assert.equal(calls.length, 1);
});
