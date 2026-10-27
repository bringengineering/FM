"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const Core = require("../src/core");
const { FirebaseRemoteClient, toRemoteStore, mergeRemoteStore } = require("../src/remote");
const { applySharedSavePatch, at, same } = require("../src/shared-save-core");
function harness(options = {}) {
  const base = Core.blankSharedStore();
  base.customers = [Core.createCustomer({id:"fixture_a",name:"Fixture A",notes:"Original note"}), Core.createCustomer({id:"fixture_b",name:"Fixture B"})];
  base.buildings = [Core.createBuilding({id:"fixture_site",name:"Fixture site"})];
  const state = {server:toRemoteStore(base,"fixture@bring.test"), writes:[], patches:[], reads:[]};
  let local = structuredClone(base);
  const client = new FirebaseRemoteClient({Core,fs:{},safeStorage:{},shell:{},sessionFile:"session.json",pendingFile:"pending.json",
    readLocalStore:async()=>local,writeLocalStore:async value=>(local=value), fetchImpl:async()=>{throw Error("Unexpected network");}});
  client.session = {uid:"fixture_user",email:"fixture@bring.test",role:"member",expiresAt:Date.now()+60000,idToken:"fixture-token"};
  client.remotePayload=structuredClone(state.server);
  client.fetchRemotePayload=async()=>structuredClone(state.server);
  client.clearPendingStore=async()=>{};client.startStream=()=>{};
  const key=location=>location.replace(/^crmShared\/data\//,"");
  client.dbReadWithEtag=async location=>{
    const path=key(location), value=structuredClone(at(state.server,path)??null), etag=JSON.stringify(value);
    state.reads.push(path);options.afterRead?.(path,state,client);return {value,etag};
  };
  client.dbConditionalPut=async(location,value,etag)=>{
    const path=key(location);
    if(etag!==JSON.stringify(at(state.server,path)??null))throw Object.assign(Error("conditional conflict"),{code:"BUILDING_SCHEDULE_CONFLICT"});
    state.writes.push({path,value});state.server=applySharedSavePatch(state.server,{[path]:value});return true;
  };
  client.dbRequest=async(location,request)=>{
    assert.equal(location,"crmShared/data");assert.equal(request.method,"PATCH");
    state.patches.push(request.body);state.server=applySharedSavePatch(state.server,request.body);
  };
  const input = () => {const value=structuredClone(base);value.__crmSaveBase=structuredClone(base);return value;};
  return {base,state,client,input};
}
test("editing one alias preserves other operators' notes, unrelated customers, new records and protected collections",async()=>{
  const h=harness(),input=h.input();input.customers[0].nickname="My alias";
  h.state.server.customers.fixture_a.notes="Other operator note";
  h.state.server.customers.fixture_b.name="Other operator name";
  h.state.server.customers.fixture_new={id:"fixture_new",name:"New remote customer"};
  h.state.server.buildings.fixture_site.name="New site name";
  h.state.server.futureCollection={keep:true};
  const result=await h.client.saveStoreNow(input);
  assert.equal(result.ok,true);assert.equal(result.pending,false);
  assert.equal(h.state.server.customers.fixture_a.nickname,"My alias");
  assert.equal(h.state.server.customers.fixture_a.notes,"Other operator note");
  assert.equal(h.state.server.customers.fixture_b.name,"Other operator name");
  assert.ok(h.state.server.customers.fixture_new);assert.equal(h.state.server.buildings.fixture_site.name,"New site name");
  assert.deepEqual(h.state.writes.map(write=>write.path),["customers/fixture_a/nickname"]);
  assert.equal(result.data.customers.find(row=>row.id==="fixture_b").name,"Other operator name");
  assert.equal(h.state.server.futureCollection.keep,true);
});
test("the same customer field changed since opening the form is rejected before any write",async()=>{
  const h=harness(),input=h.input();input.customers[0].notes="My note";
  h.state.server.customers.fixture_a.notes="Other note";
  await assert.rejects(h.client.saveStoreNow(input),error=>error.code==="SHARED_SAVE_CONFLICT"&&!error.partial);
  assert.equal(h.state.writes.length,0);assert.equal(h.state.patches.length,0);
  assert.equal(h.state.server.customers.fixture_a.notes,"Other note");
});
test("a race after reading the field is rejected by the actual conditional write boundary",async()=>{
  const h=harness({afterRead:(path,state)=>{if(path.endsWith("/nickname"))state.server.customers.fixture_a.nickname="Racing alias";}});
  const input=h.input();input.customers[0].nickname="My alias";
  await assert.rejects(h.client.saveStoreNow(input),error=>error.code==="SHARED_SAVE_CONFLICT");
  assert.equal(h.state.server.customers.fixture_a.nickname,"Racing alias");assert.equal(h.state.writes.length,0);
});
test("partial multi-field conflicts never report success or roll back another operator's field",async()=>{
  const h=harness({afterRead:(path,state)=>{if(path.endsWith("/notes"))state.server.customers.fixture_a.notes="Racing note";}});
  const input=h.input();input.customers[0].nickname="My alias";input.customers[0].notes="My note";
  await assert.rejects(h.client.saveStoreNow(input),error=>error.code==="SHARED_SAVE_CONFLICT"&&error.partial===true);
  assert.equal(h.state.server.customers.fixture_a.nickname,"My alias");assert.equal(h.state.server.customers.fixture_a.notes,"Racing note");
  assert.equal(h.state.patches.length,0);
});
test("retrying a committed field with its original base is idempotent",async()=>{
  const h=harness(),input=h.input();input.customers[0].nickname="My alias";
  await h.client.saveStoreNow(input);const count=h.state.writes.length;
  await h.client.saveStoreNow(input);assert.equal(h.state.writes.length,count);
});
test("stale edits cannot resurrect a deleted customer or replace append-only building links",async()=>{
  const h=harness(),input=h.input();input.customers[0].nickname="My alias";
  delete h.state.server.customers.fixture_a;
  await assert.rejects(h.client.saveStoreNow(input),error=>error.code==="SHARED_SAVE_CONFLICT");
  assert.equal(h.state.writes.length,0);
  const linked=harness(), next=linked.input();
  linked.state.server.customers.fixture_a.buildingIdLinks={fixture_site:true};
  next.customers[0].nickname="Allowed field update";
  await linked.client.saveStoreNow(next);
  assert.equal(linked.state.server.customers.fixture_a.buildingIdLinks.fixture_site,true);
  assert.deepEqual(linked.state.writes.map(row=>row.path),["customers/fixture_a/nickname"]);
});
test("new customers use null-record CAS and viewer or marketing-only sessions cannot write",async()=>{
  const h=harness(),input=h.input();input.customers.push(Core.createCustomer({id:"fixture_created",name:"New fixture"}));
  await h.client.saveStoreNow(input);assert.ok(h.state.writes.some(row=>row.path==="customers/fixture_created"));
  for(const role of ["viewer","marketing"]){
    const denied=harness();denied.client.session.role=role==="marketing"?"member":role;if(role==="marketing")denied.client.session.marketingRole="marketing";
    await assert.rejects(denied.client.saveStoreNow(denied.input()));assert.equal(denied.state.reads.length,0);assert.equal(denied.state.writes.length,0);
  }
});
test("protected marketing, photos and building links never become generic field writes",async()=>{
  const h=harness(),input=h.input();input.customers[0].nickname="Alias";
  h.state.server.customers.fixture_a.marketing={firstSource:"referral",_version:7};
  await h.client.saveStoreNow(input);
  assert.equal(h.state.server.customers.fixture_a.marketing._version,7);
  assert.equal(h.state.writes.some(row=>/marketing|photo|buildingIdLinks/.test(row.path)),false);
  assert.equal(same({b:1,a:2},{a:2,b:1}),true);
});
test("a final patch failure after customer writes reports a partial save",async()=>{
  const h=harness(), input=h.input();input.customers[0].nickname="Committed alias";
  h.client.dbRequest=async()=>{throw Object.assign(Error("offline"),{code:"NETWORK"});};
  await assert.rejects(h.client.saveStoreNow(input),error=>error.code==="SHARED_SAVE_UNCONFIRMED"&&error.partial===true&&/일부/.test(error.message));
  assert.equal(h.state.server.customers.fixture_a.nickname,"Committed alias");
});
test("customer timestamps are conditional fields, never an unconditional patch that can recreate a deleted customer",async()=>{
  const h=harness(), input=h.input();input.customers[0].nickname="Edited";input.customers[0].updatedAt="2026-10-27T00:00:00.000Z";
  await h.client.saveStoreNow(input);
  assert.ok(h.state.writes.some(write=>write.path==="customers/fixture_a/updatedAt"));
  assert.ok(h.state.patches.every(patch=>!Object.keys(patch).some(path=>path.startsWith("customers/fixture_a/"))));
});
test("deletion between field writes is rejected without recreating a partial customer",async()=>{
  const h=harness(), input=h.input();
  input.customers[0].nickname="Edited";input.customers[0].updatedAt="2026-10-27T00:00:00.000Z";
  const put=h.client.dbConditionalPut;
  h.client.dbConditionalPut=async(location,value,etag, retried, guard)=>{
    const path=location.replace(/^crmShared\/data\//,"");
    if(path.startsWith("customers/fixture_a/")&&!h.state.server.customers.fixture_a) throw Object.assign(Error("permission denied"),{code:"DATABASE_ERROR"});
    const result=await put(location,value,etag,retried,guard);
    if(path==="customers/fixture_a/nickname") delete h.state.server.customers.fixture_a;
    return result;
  };
  await assert.rejects(h.client.saveStoreNow(input),error=>["SHARED_SAVE_CONFLICT","SHARED_SAVE_UNCONFIRMED"].includes(error.code));
  assert.equal(h.state.server.customers.fixture_a,undefined);
  assert.ok(h.state.patches.every(patch=>!Object.keys(patch).some(path=>path.startsWith("customers/fixture_a/"))));
});
