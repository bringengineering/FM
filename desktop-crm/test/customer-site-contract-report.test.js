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
  vm.runInContext(buildings + address + ["customerManagedBuildingChoices", "workReportBuildings", "workReportBuildingAddress", "contractBuildingField", "refreshContractBuildings"].map(fn).join("\n"),ctx);
  return ctx;
}
test("work report sites include registered customers with no building and prefer their current address",()=>{
  const h=harness(), rows=h.workReportBuildings();
  const registered=rows.find(r=>r.id==="customer:registered");
  assert.equal(registered.name,"Fixture registered site");
  assert.equal(h.workReportBuildingAddress(registered),"Fixture road 1");
  const linked=rows.find(r=>r.id==="site");
  assert.equal(linked.name,"Fixture customer label");assert.equal(h.workReportBuildingAddress(linked),"Fixture customer road 2");
  assert.equal(rows.filter(r=>r.id==="site").length,1);
  assert(rows.some(r=>r.id==="legacy"));assert(!rows.some(r=>r.id==="archived_site"||r.id==="customer:archived"));
  assert(h.workReportBuildings("missing_historical_site").some(r=>r.id==="missing_historical_site"));
});
test("contract address is readonly, escaped and never asks the user to select a separate building",()=>{
  const h=harness();h.store.customers[0].roadAddress='"><img src=x onerror=bad>';
  const html=h.contractBuildingField("registered","");
  assert.match(html,/고객 등록 주소/);assert.match(html,/readonly/);assert.match(html,/&lt;img/);
  assert.doesNotMatch(html,/<select|연결 건물|<img/);
  const address={}, hidden={value:"old"};
  const form={elements:{customerId:{value:"linked"},buildingId:hidden},querySelector:()=>address};
  h.refreshContractBuildings(form);assert.equal(address.value,"Fixture customer road 2");assert.equal(hidden.value,"site");
  form.elements.customerId.value="registered";h.refreshContractBuildings(form);
  assert.equal(hidden.value,"");assert.equal(address.value,'"><img src=x onerror=bad>');
});
