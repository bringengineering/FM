"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), vm = require("node:vm"), fs = require("node:fs"), path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
const fn = name => source.match(new RegExp(`^  function ${name}\\([\\s\\S]*?^  \\}`, "m"))[0];
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function harness() {
  const store = { customers: [{id:"registered", name:"Fixture registered site", roadAddress:"Fixture road 1", buildingIds:[]}, {id:"linked", name:"Fixture customer label", roadAddress:"Fixture customer road 2", buildingIds:["site"]}, {id:"archived", name:"Archived fixture", archivedAt:"fixture", buildingIds:[]}], buildings: [{id:"site", name:"Old site label", address:"Old site address", ownerCustomerId:"linked"}, {id:"legacy", name:"Legacy unowned site", address:"Legacy road"}, {id:"archived_site", archivedAt:"fixture"}] };
  const ctx = vm.createContext({store, esc, attr:esc, customerPhoneText:()=>"", managementStatusForCustomer:()=>"", customerDisplayName:c=>c.name,
    customerById:id=>store.customers.find(c=>c.id===id), buildingById:id=>store.buildings.find(b=>b.id===id)});
  const buildings = source.match(/^  const customerBuildings = customer => \{[\s\S]*?^  \};/m)[0];
  const address = source.match(/^  const customerManagedBuildingAddress = [\s\S]*?""\)\.trim\(\);/m)[0];
  ctx.Core={customerBuildingIds:c=>c.buildingIds||[]};
  vm.runInContext(buildings + address + ["customerManagedBuildingChoices", "workReportBuildings", "workReportBuildingAddress", "workReportAddressParts", "contractBuildingField", "refreshContractBuildings", "refreshContractBuildingAddress", "customerFromForm"].map(fn).join("\n"),ctx);
  return ctx;
}
test("work report picker uses customer addresses even when multiple buildings are linked",()=>{
  const h=harness(), rows=h.workReportBuildings();
  const registered=rows.find(r=>r.id==="customer:registered");
  assert.equal(registered.name,"Fixture registered site");
  assert.equal(h.workReportBuildingAddress(registered),"Fixture road 1");
  const linked=rows.find(r=>r.id==="customer:linked");
  assert.equal(linked.name,"Fixture customer label");assert.equal(h.workReportBuildingAddress(linked),"Fixture customer road 2");
  h.store.buildings.push({id:"another",ownerCustomerId:"linked"});
  assert.equal(h.workReportBuildings().filter(r=>r.id==="customer:linked").length,1);
  assert(!rows.some(r=>r.id==="site"||r.id==="legacy"||r.id==="customer:archived"));
  assert(h.workReportBuildings("legacy").some(r=>r.id==="legacy"));
  assert(h.workReportBuildings("missing_historical_site").some(r=>r.id==="missing_historical_site"));
});

test("report form maps customer selection directly to customer ID and keeps old building reports",()=>{
  const h=harness(), R=require("../src/work-report-core");
  let raw={buildingId:"customer:linked",siteAddress:"Fixture customer road 2",siteAddressDetail:"301호",workDate:"2026-10-27"};
  const form={elements:{buildingId:{type:"select-one"}},querySelector:()=>null};
  h.document={querySelector:()=>form};h.FormData=class {entries(){return Object.entries(raw);}};
  h.reportCore=()=>R;h.reportState={draft:R.normalizeReport({id:"wr_test",workDate:"2026-10-27"})};
  vm.runInContext(fn("readReportForm"),h);
  let draft=h.readReportForm();
  assert.equal(draft.customerId,"linked");assert.equal(draft.buildingId,"");
  assert.equal(draft.siteAddress,"Fixture customer road 2 301호");assert.equal(draft.buildingName,"Fixture customer label");
  h.reportState.draft=draft;raw={...raw,buildingId:""};
  draft=h.readReportForm();assert.equal(draft.customerId,undefined);assert.equal(draft.buildingId,"");
  h.reportState.draft=R.normalizeReport({id:"wr_test",buildingId:"site",workDate:"2026-10-27"});
  raw={...raw,buildingId:"site",siteAddress:"Old site address",siteAddressDetail:""};
  draft=h.readReportForm();assert.equal(draft.buildingId,"site");assert.equal(draft.customerId,undefined);
  h.reportState.draft=R.normalizeReport({id:"wr_test",customerId:"linked",updatedAt:"2026-10-27T00:00:00Z",workDate:"2026-10-27"});
  form.elements.buildingId.type="hidden";raw={...raw,buildingId:"",siteAddress:"Fixture customer road 2"};
  draft=h.readReportForm();assert.equal(draft.customerId,"linked");assert.equal(draft.buildingId,"");
});

test("multiple buildings are all offered and contracts never silently choose the first",()=>{
  const h=harness();h.store.buildings.push({id:"site_b",name:"Second fixture site",roadAddress:"Second site road",ownerCustomerId:"linked"});
  const choices=h.customerManagedBuildingChoices().filter(row=>row.customer?.id==="linked");
  assert.deepEqual(Array.from(choices,row=>row.value).sort(),["site","site_b"]);
  const empty=h.contractBuildingField("linked","");
  assert.match(empty,/data-contract-building-select required/);assert.doesNotMatch(empty,/<option value="site" selected/);
  const selected=h.contractBuildingField("linked","site_b");
  assert.match(selected,/<option value="site_b" selected/);assert.match(selected,/value="Second site road"/);
  assert.doesNotMatch(selected,/value="Fixture customer road 2"/);
  const select={value:"site_b"},address={};
  const form={elements:{customerId:{value:"linked"},buildingId:select},querySelector:key=>key==="[data-contract-customer-address]"?address:null};
  h.refreshContractBuildingAddress(form);assert.equal(address.value,"Second site road");
  h.refreshContractBuildings(form);assert.equal(select.value,"");assert.equal(address.value,"");
});

test("work and monthly report address policy agrees and historical report addresses stay untouched",()=>{
  const h=harness(),Monthly=require("../src/building-report-core");
  const building=h.store.buildings.find(row=>row.id==="site"),original=JSON.stringify(building);
  h.store.customers.find(row=>row.id==="linked").roadAddress="Edited customer address only";
  const site=h.workReportBuildings("site").find(row=>row.id==="site");
  assert.equal(h.workReportBuildingAddress(site),Monthly.buildBuildingMonthlyReport({building,month:"2026-10"}).address);
  assert.equal(site.ownerCustomerId,building.ownerCustomerId);
  assert.equal(JSON.stringify(building),original);
  const parts=h.workReportAddressParts({siteAddress:"Saved historical address 301"},building);
  assert.equal(parts.base,"Saved historical address 301");assert.equal(parts.detail,"");
  building.address="";building.roadAddress="";
  assert.equal(h.workReportBuildingAddress(h.workReportBuildings("site").find(row=>row.id==="site")),"");
});
test("contract address is readonly and escaped while linked buildings remain explicitly selectable",()=>{
  const h=harness();h.store.customers[0].roadAddress='"><img src=x onerror=bad>';
  const html=h.contractBuildingField("registered","");
  assert.match(html,/고객 등록 주소/);assert.match(html,/readonly/);assert.match(html,/&lt;img/);
  assert.match(html,/data-contract-building-select/);assert.doesNotMatch(html,/<img/);
  const address={}, hidden={value:"old"};
  const form={elements:{customerId:{value:"linked"},buildingId:hidden},querySelector:selector=>selector==="[data-contract-customer-address]"?address:null};
  h.refreshContractBuildings(form);assert.equal(address.value,"Old site address");assert.equal(hidden.value,"site");
  form.elements.customerId.value="registered";h.refreshContractBuildings(form);
  assert.equal(hidden.value,"");assert.equal(address.value,'"><img src=x onerror=bad>');
});
