const test=require('node:test');
const assert=require('node:assert/strict');
const {FirebaseRemoteClient}=require('../src/remote');
const Core=require('../src/core');
function client(){const c=Object.create(FirebaseRemoteClient.prototype);c.Core=Core;c.session={uid:'fixture',role:'admin'};c.sessionGeneration=1;c.loadRendererOverlays=async()=>({buildingUnits:[],fieldSummaries:[]});return c;}
test('existing root fetch preserves raw fields and explicit successful scope without saving metadata',async()=>{
 const c=client();let reads=0;c.dbRequest=async()=>{reads++;return {contracts:{c1:{id:'c1',types:['unknown']}}};};
 await c.fetchRemotePayload();const data=await c.refreshRendererSnapshot(Core.blankSharedStore(),false);
 assert.equal(reads,1);assert.deepEqual(data.operationsCheckReceipt.source.contracts[0].types,['unknown']);
 assert.equal(data.operationsCheckReceipt.availability.buildings,true);
 assert.equal(data.operationsCheckReceipt.uid,'fixture');
 assert.equal(Core.sanitizeSharedStore(data).operationsCheckReceipt,undefined);
 const cached=await c.refreshRendererSnapshot(Core.blankSharedStore(),false);
 assert.equal(cached.operationsCheckReceipt.receivedAt,data.operationsCheckReceipt.receivedAt);
 c.session={uid:'other',role:'viewer'};c.sessionGeneration++;
 assert.equal((await c.refreshRendererSnapshot(Core.blankSharedStore(),false)).operationsCheckReceipt,undefined);
});
test('failed or stale root reads never create successful receipt',async()=>{
 const c=client();c.dbRequest=async()=>{throw new Error('offline');};await assert.rejects(c.fetchRemotePayload());assert.equal(c.operationsCheckReceipt,undefined);
 c.dbRequest=async()=>{c.sessionGeneration++;return {};};await c.fetchRemotePayload();assert.equal(c.operationsCheckReceipt,undefined);
});
