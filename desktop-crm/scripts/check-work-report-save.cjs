"use strict";
// Real renderer with synthetic records; all non-local requests are blocked.
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{spawn}=require("node:child_process");
const {chromium}=require("playwright");
function installFixture() {
  const R=window.BringWorkReportCore;
  const report=R.normalizeReport({id:"wr_save_test",buildingId:"b1",buildingName:"가상 관리빌딩",workDate:"2026-10-06",createdAt:"2026-10-06T01:00:00Z",updatedAt:"2026-10-06T01:00:00Z",summary:"선택한 현장 사진을 구역별로 정리했습니다."});
  report.items.forEach(item=>Object.assign(item,{status:"skipped",note:"이번 작업 대상 제외"}));
  Object.assign(report.items[0],{status:"done",note:"현장 점검 완료",before:[{id:"p1",driveFileId:"synthetic_before"}],after:[{id:"p2",driveFileId:"synthetic_after"}]});
  const state=window.__saveQA={calls:[],report};
  Object.assign(window.bringCRM,{
    loadWorkReports:async()=>({reports:[state.report],admin:true,canWork:true}),
    driveStatus:async()=>({connected:true}),
    exportWorkReport:async input=>{state.calls.push(["pdf",input]);return {ok:true};},
    saveWorkReport:async input=>{state.calls.push(["save"]);state.report={...input,updatedAt:new Date().toISOString()};return state.report;},
    saveCustomerDocument:async input=>{state.calls.push(["archive",input]);state.record={id:"saved_wr_fixture",title:"가상 관리빌딩 작업 결과보고서",buildingId:"b1",driveFileId:"synthetic_pdf",updatedAt:new Date().toISOString(),savedCustomerDocument:{version:1,kind:"workReport",customerId:"u1",recipientPhone:"01000000000",reportId:state.report.id,reportUpdatedAt:state.report.updatedAt,sha256:"a".repeat(64),size:100}};return {ok:true,record:state.record};},
    sendSavedCustomerDocument:async input=>{state.calls.push(["send",input]);return {ok:true,record:{...state.record,workReportDelivery:{status:"requested",requestedAt:new Date().toISOString()}}};},
  });
}
async function main(){
  const server=spawn(process.execPath,["scripts/operations-check-preview.js"],{cwd:path.resolve(__dirname,".."),windowsHide:true,stdio:["ignore","pipe","pipe"]});
  let browser;
  try {
    const origin=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error("startup timeout")),15000);server.stdout.on("data",buf=>{const match=String(buf).match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});server.once("error",reject);});
    browser=await chromium.launch({headless:true,channel:process.env.BRING_QA_BROWSER_CHANNEL||"chrome"});
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    await context.route("**/*",route=>{const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();if(url.pathname==="/preview-fixture.js")return route.fulfill({contentType:"text/javascript",body:fs.readFileSync(path.join(__dirname,"operations-check-preview-fixture.js"),"utf8")+`\n(${installFixture.toString()})();`});return route.continue();});
    const page=await context.newPage(), errors=[];page.on("pageerror",error=>errors.push(error.message));
    page.setDefaultTimeout(15000);
    await page.goto(origin+"/?view=workReports&unifiedSeed=1",{waitUntil:"domcontentloaded",timeout:60000});
    console.log("Renderer loaded; checking save actions.");
    const workspace=page.locator('[data-workspace-enter="operations"][data-workspace-enter-folder="documents"]');if(await workspace.isVisible())await workspace.click();
    await page.locator('[data-view="workReports"]').evaluate(button=>button.click());
    await page.locator('[data-report-edit="wr_save_test"]').click();
    const localPdf=page.locator('[data-report-draft-pdf]');await localPdf.scrollIntoViewIfNeeded();assert.equal(await localPdf.isEnabled(),true);
    await localPdf.click();await page.waitForFunction(()=>window.__saveQA.calls.some(e=>e[0]==="pdf"));
    assert.deepEqual(await page.evaluate(()=>window.__saveQA.calls.map(e=>e[0])),["pdf"]);
    const output=process.env.BRING_QA_OUTPUT;
    if(output){fs.mkdirSync(output,{recursive:true});await page.locator('.wr-ai-finish').screenshot({path:path.join(output,"work-report-save-actions.png")});}
    await page.locator('[data-report-form] button[type="submit"]').click();
    await page.locator('#confirmationTitle').filter({hasText:"저장되었습니다."}).waitFor();
    assert.match(await page.locator('#confirmationDescription').textContent(),/고객 알림을 보내시겠습니까/);
    if(output)await page.locator('#confirmationContent').screenshot({path:path.join(output,"work-report-save-confirmation.png")});
    await page.locator('.confirmation-actions [data-confirm-choice="cancel"]').click();
    assert.deepEqual(await page.evaluate(()=>window.__saveQA.calls.map(e=>e[0])),["pdf","save","archive"]);
    await page.locator('[data-report-edit="wr_save_test"]').click();
    await page.locator('[data-report-form] button[type="submit"]').click();
    await page.locator('.confirmation-actions [data-confirm-choice="confirm"]').click();
    await page.waitForFunction(()=>window.__saveQA.calls.filter(e=>e[0]==="send").length===1);
    const sent=await page.evaluate(()=>window.__saveQA.calls.find(e=>e[0]==="send")[1]);assert.equal(sent.customerId,"u1");assert.equal(sent.documentId,"saved_wr_fixture");
    assert.deepEqual(errors,[]);
    console.log("PASS real renderer: local PDF without CRM writes; CRM + PDF before Yes/No; No never sends; Yes sends exactly the saved PDF to the selected building owner. No external requests.");
  }finally{await browser?.close();server.kill();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
