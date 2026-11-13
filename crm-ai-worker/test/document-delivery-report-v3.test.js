import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
import {createDocumentDeliveryHandler, documentTemplate, sendNcpDocument} from "../src/document-delivery.js";
const Message = createRequire(import.meta.url)("../../desktop-crm/src/work-report-message.js");
const template = JSON.parse(fs.readFileSync(new URL("../templates/BRINGCOMPLETIONREPORTV3.json", import.meta.url), "utf8"));
const info = Message.details({siteAddress:"강원특별자치도 예시시 예시로 123, 201호 (예시동)", title:"공용부 청소", ownerName:"내부 별칭"});
const env = {NCP_ACCESS_KEY:"fixture-access", NCP_SECRET_KEY:"fixture-secret", NCP_BIZ_MESSAGE_SERVICE_ID:"ncp:kkobizmsg:kr:fixture:service", KAKAO_CHANNEL_ID:"@fixture"};
const variables = {고객명:"내부 별칭", 건물주소:info.buildingAddress, 작업명:info.workName, 문서명:Message.documentName(info), 만료일:"2026-10-22", 문서링크:"bring-crm-ai-gateway.bringengineering1008.workers.dev/d/fixture_token_123456"};
const outgoing = {channel:"kakao",phone:"01000000000",templateCode:template.templateCode,variables,env};
const approved = extra => ({...template,channelId:"@fixture",templateInspectionStatus:"COMPLETE",templateStatus:"ACTIVE",isBlock:false,isDormant:false,...extra});
const accepted = {statusCode:"202",messages:[{messageId:"provider_fixture",requestStatusCode:"A000"}]};

test("report V3 sends the approved short-address copy, work name and new support number", async () => {
  const requests = [];
  await sendNcpDocument(outgoing, {fetchImpl:async (_url, init) => {
    requests.push(init);
    return Response.json(init.method === "GET" ? [approved()] : accepted);
  }});
  assert.equal(requests.length, 2);
  const message = JSON.parse(requests[1].body).messages[0];
  assert.equal(message.content, "[BRING CARE 작업 결과보고서 안내]\n예시시 예시로 123 건물주님, 공용부 청소 결과 보고서가 발행되었습니다.\n\n작업명: 예시시 예시로 123 공용부 청소 결과보고서\n열람기한: 2026-10-22\n\n아래 버튼에서 결과보고서를 확인해 주세요.\n문의: 1551-3873");
  assert.doesNotMatch(message.content, /내부 별칭|강원특별자치도|201호|033-748-8919/);
  assert.equal(message.buttons[0].name, "결과보고서 확인");
  assert.ok(message.content.length < 250);
});

test("report V3 rejects missing, unapproved or mismatching provider templates before a message POST", async () => {
  for (const row of [null,approved({templateInspectionStatus:"INSPECTING"}),approved({content:template.content.replace("1551-3873","1511-3873")}),approved({content:template.content.replace("1551-3873","0000-0000")}),approved({buttons:[]})]) {
    let posts = 0;
    await assert.rejects(sendNcpDocument(outgoing, {fetchImpl:async (_url, init) => {if(init.method === "POST") posts++;return Response.json(row ? [row] : []);}}), {code:"DELIVERY_CONFIGURATION_ERROR"});
    assert.equal(posts, 0);
  }
});

test("superseded support-number template codes cannot issue new provider requests", async () => {
  for (const templateCode of ["BRINGCOMPLETIONREPORTV2", "BRINGMONTHLYREPORTV1"]) {
    let calls = 0;
    await assert.rejects(sendNcpDocument({...outgoing, templateCode}, {fetchImpl: async () => {calls++; throw new Error("unexpected provider request");}}), {code: "DELIVERY_UNAVAILABLE"});
    assert.equal(calls, 0);
  }
});

test("legacy reports, quotations and monthly report template selection remain compatible", () => {
  assert.equal(documentTemplate("completion_report"), "BRINGCOMPLETIONREPORTV1");
  assert.equal(documentTemplate("completion_report", info), "BRINGCOMPLETIONREPORTV3");
  assert.equal(documentTemplate("quote"), "BRINGCUSTOMERQUOTEV1");
  assert.equal(documentTemplate("monthly_report"), "BRINGMONTHLYREPORTV2");
});

test("document creation binds V3 fields to the stored report, computes its title and validates all metadata", async () => {
  const values = new Map(), calls = [];
  const storage = {async put(key,value){values.set(key,value);},async get(key,type){const value=values.get(key);return type==="json"&&value?JSON.parse(value):value||null;}};
  const handler = createDocumentDeliveryHandler({now:()=>Date.parse("2026-10-15T00:00:00Z"),wait:async()=>{},sendProvider:async input=>{calls.push(input);return {providerMessageId:"provider_fixture"};}});
  const runtime = {...env,CRM_ADMIN_EMAILS:"admin@example.com",DOCUMENT_DELIVERY_ENABLED:"true",KAKAO_DOCUMENT_TEMPLATES_APPROVED:"true",DOCUMENT_DELIVERY:storage};
  const input = {documentId:"report_fixture",customerId:"customer_fixture",documentType:"completion_report",documentName:"ignored caller title",completionReport:info,expiresAt:"2026-10-22T00:00:00Z",mimeType:"application/pdf",bytes:btoa("%PDF-1.7\nTEST ONLY\n%%EOF"),delivery:{channel:"kakao",idempotencyKey:"fixture_report_v3_123",customerName:"内部分類",phone:"01000000000"}};
  const send = payload => handler(new Request("https://gateway.test/v1/document-delivery/documents-and-messages",{method:"POST",body:JSON.stringify(payload)}),{email:"admin@example.com"},runtime);
  const sent = await (await send(input)).json();
  assert.equal(sent.status, "requested");
  assert.equal(calls[0].templateCode, "BRINGCOMPLETIONREPORTV3");
  assert.equal(calls[0].document.documentName, Message.documentName(info));
  assert.deepEqual(calls[0].document.completionReport, info);
  for (const completionReport of [{...info,extra:true},{...info,buildingAddress:""},{...info,workName:"가".repeat(201)},{...info,buildingAddress:"주소\n새 문구"},null]) {
    await assert.rejects(send({...input,completionReport,delivery:{...input.delivery,idempotencyKey:crypto.randomUUID()}}),{code:"INVALID_INPUT"});
  }
  await assert.rejects(send({...input,documentType:"quote",delivery:{...input.delivery,idempotencyKey:crypto.randomUUID()}}),{code:"INVALID_INPUT"});
  assert.equal(calls.length,1);
});
