"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const source=fs.readFileSync(path.join(__dirname,"../src/app.js"),"utf8");
const start=source.indexOf('      const applySiteAddress = !existing || raw.applySiteAddress === "true";');
const end=source.indexOf("      const addressKeys",start);
assert.ok(start>=0&&end>start);
function resolveAddress(existing,raw){
  return vm.runInNewContext(`(function(){${source.slice(start,end)};return {address,roadAddress,jibunAddress};})()`,{existing,raw,name:"Fixture",showToast:message=>({error:message})});
}
test("rental saves preserve canonical addresses unless explicit address correction is selected",()=>{
  const existing={id:"fixture_site",roadAddress:"Current site road",jibunAddress:"Current lot",address:"Current site road"},before=JSON.stringify(existing);
  const kept=resolveAddress(existing,{roadAddress:"Unselected change",jibunAddress:"Unselected lot"});
  assert.equal(kept.address,"Current site road");assert.equal(kept.jibunAddress,"Current lot");assert.equal(JSON.stringify(existing),before);
  const changed=resolveAddress(existing,{applySiteAddress:"true",roadAddress:"Confirmed new site road",jibunAddress:"Confirmed lot"});
  assert.equal(changed.address,"Confirmed new site road");assert.equal(changed.roadAddress,"Confirmed new site road");
  assert.equal(JSON.stringify(existing),before,"form parsing must not mutate a canonical record before its versioned commit");
});
test("empty explicit corrections are rejected and legacy addresses are preserved by normal saves",()=>{
  assert.match(resolveAddress({address:"Legacy site address"},{applySiteAddress:"true",roadAddress:"",jibunAddress:""}).error,/하나 이상/);
  assert.equal(resolveAddress({address:"Legacy site address"},{}).address,"Legacy site address");
  const form=source.slice(source.indexOf("  function buildingEditor("),source.indexOf("  function updateVacancyScheduleGuide"));
  assert.match(form,/name="applySiteAddress" value="true"/);assert.doesNotMatch(form,/name="applySiteAddress"[^>]*checked/);
  assert.match(form,/현장 주소 확인·정정/);assert.match(form,/기존 문서는 유지/);
});
