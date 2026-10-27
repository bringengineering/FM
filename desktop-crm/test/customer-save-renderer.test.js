"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const source=fs.readFileSync(path.join(__dirname,"../src/app.js"),"utf8");
const fn=name=>source.match(new RegExp(`^  async function ${name}\\([^]*?^  \\}`,"m"))[0];
test("strict renderer saves carry the opening baseline and conflicts preserve inputs without success",async()=>{
  const original={customers:[{id:"fixture",nickname:"Before",notes:"Opening note"}]};
  const changed=structuredClone(original);changed.customers[0].nickname="Typed alias";
  const ctx=vm.createContext({store:changed,synchronizedStore:structuredClone(original),saveTimer:null,queuedSave:null,saveInFlight:false,clearTimeout,
    cloneStore:value=>structuredClone(value),waitForSaveIdle:async()=>{},flushPendingRemote:()=>{},ensureSalesStore:()=>{},updateSyncUI:()=>{},
    messages:[],captured:null,saved:false,api:{},showToast:message=>ctx.messages.push(message)});
  ctx.api.saveNow=async payload=>{ctx.captured=payload;throw Error("다른 사용자가 같은 항목을 변경했습니다.");};
  vm.runInContext(fn("saveStoreNow")+"\n"+fn("commitSharedFormMutation"),ctx);
  const form={dataset:{},values:{nickname:"Typed alias"}};
  const result=await ctx.commitSharedFormMutation({form,beforeStore:original,onSaved:()=>{ctx.saved=true;}});
  assert.equal(result,false);assert.equal(ctx.saved,false);assert.equal(form.values.nickname,"Typed alias");
  assert.equal(ctx.captured.customers[0].nickname,"Typed alias");
  assert.equal(ctx.captured.__crmSaveBase.customers[0].nickname,"Before");
  assert.equal(ctx.captured.__crmSaveBase.customers[0].notes,"Opening note");
  assert.equal(form.dataset.submitting,undefined);assert.match(ctx.messages[0],/같은 항목/);
});
test("background saves retain the pre-rebase baseline rather than claiming remote edits as the original",()=>{
  const start=source.indexOf("  async function saveStore()"),end=source.indexOf("  async function saveStoreNow()",start),body=source.slice(start,end);
  assert.ok(body.indexOf("const saveBase")<body.indexOf("if (pendingRemoteStore)"));
  assert.match(body,/payload\.__crmSaveBase = saveBase/);
});
