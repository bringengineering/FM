const test=require('node:test'),assert=require('node:assert/strict');
const {createCrmContextSnapshot}=require('../src/rnd-control/crm-context');
const fetchedAt='2026-09-17T00:00:00Z';
test('CRM missing data is unknown while confirmed empty lists have zero counts',()=>{
 assert.equal(createCrmContextSnapshot(null,{fetchedAt}).counts.customers,null);
 assert.equal(createCrmContextSnapshot({}, {fetchedAt}).status,'PARTIAL');
 const empty=createCrmContextSnapshot({customers:[],buildings:[],updatedAt:fetchedAt},{fetchedAt});
 assert.equal(empty.status,'CURRENT');assert.equal(empty.counts.customers,0);
});
test('CRM snapshot retains ledger IDs and excludes contact, address, money and secret fields',()=>{
 const raw={customers:{key:{id:'c',name:'Company',phone:'private',token:'secret'}},buildings:[{id:'b',ownerCustomerId:'c',address:'private',amount:100}],updatedAt:fetchedAt};
 const snapshot=createCrmContextSnapshot(raw,{fetchedAt});
 assert.deepEqual(snapshot.customers,[{id:'c',sourceKey:'key',name:'Company'}]);
 assert.deepEqual(snapshot.buildings,[{id:'b',ownerCustomerId:'c'}]);assert.equal(JSON.stringify(snapshot).includes('private'),false);
 assert.equal(raw.customers.key.phone,'private');
});
test('CRM old, absent and future timestamps are never reported as current',()=>{
 const data={customers:[],buildings:[]};
 assert.equal(createCrmContextSnapshot({...data,updatedAt:'2026-09-01T00:00:00Z'},{fetchedAt}).status,'STALE');
 assert.equal(createCrmContextSnapshot(data,{fetchedAt}).status,'UPDATED_TIME_UNKNOWN');
 assert.equal(createCrmContextSnapshot({...data,updatedAt:'2026-09-18T00:00:00Z'},{fetchedAt}).status,'UPDATED_TIME_UNKNOWN');
 assert.throws(()=>createCrmContextSnapshot({customers:[{id:'c'},{id:'c'}],buildings:[]},{fetchedAt}),/중복/);
});
test('Firebase sparse array holes do not hide valid ledger records or permit malformed non-null entries',()=>{
 const customers=[null,{id:'c1'},undefined,{id:'c2'}];
 const snapshot=createCrmContextSnapshot({customers,buildings:[],updatedAt:fetchedAt},{fetchedAt});
 assert.deepEqual(snapshot.customers,[{id:'c1'},{id:'c2'}]);assert.equal(snapshot.counts.customers,2);
 assert.equal(customers.length,4);
 assert.throws(()=>createCrmContextSnapshot({customers:[{id:'c'},false],buildings:[]},{fetchedAt}),/항목 형식/);
});
