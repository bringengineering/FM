import test from 'node:test';
import assert from 'node:assert/strict';
import {validateWallboardBillingLedger} from '../src/wallboard-billing-source.js';

const now='2026-09-25T00:00:00.000Z';
const invoice={id:'i1',contractId:'contract1',contractType:'regular',billingMonth:'2026-09',dueDate:'2026-09-30',amount:100000,status:'approved',revision:2,updatedAt:now,updatedBy:'admin1',approvedAt:now,approvedBy:'admin1'};
const receipt={id:'r1',invoiceId:'i1',receivedAt:'2026-09-25',amount:40000,transactionRef:'bank-ref1',evidenceRef:'drive-private',status:'approved',revision:2,updatedAt:now,updatedBy:'admin1',approvedAt:now,approvedBy:'admin1'};

test('validates protected billing maps without altering the input',()=>{
 const raw={invoices:{i1:invoice},receipts:{r1:receipt}};
 const before=structuredClone(raw);
 const result=validateWallboardBillingLedger(raw);
 assert.deepEqual(result,{invoices:[invoice],receipts:[receipt]});
 assert.deepEqual(raw,before);
});

test('missing ledger is an unconfirmed empty source, not an approved zero',()=>{
 assert.deepEqual(validateWallboardBillingLedger(null),{invoices:[],receipts:[]});
});

test('accepts a returned draft while keeping its audit metadata local',()=>{
 const draft={...invoice,status:'draft',revision:2,returnPending:true,
  returnHistory:{request1:{reason:'금액 증빙을 다시 확인해 주세요',returnedBy:'admin1',returnedAt:now,revision:2}}};
 delete draft.approvedAt;delete draft.approvedBy;
 assert.deepEqual(validateWallboardBillingLedger({invoices:{i1:draft}}).invoices,[draft]);
});

test('rejects malformed records and unknown fields without echoing source data',()=>{
 for(const invoices of [
  {i1:{...invoice,id:'wrong'}},
  {i1:{...invoice,approvedAt:undefined}},
  {i1:{...invoice,amount:1.5}},
  {i1:{...invoice,dueDate:'2026-09-31'}},
  {i1:{...invoice,customerName:'private'}},
  {i1:{...invoice,returnHistory:{r1:{reason:'x',returnedBy:'admin1',returnedAt:now,revision:2}}}},
 ])assert.throws(()=>validateWallboardBillingLedger({invoices}),error=>error.message==='WALLBOARD_UNAVAILABLE');
});

test('rejects duplicate active invoice natural keys',()=>{
 const second={...invoice,id:'i2'};
 assert.throws(()=>validateWallboardBillingLedger({invoices:{i1:invoice,i2:second}}),/WALLBOARD_UNAVAILABLE/);
});

test('rejects orphan receipts, unapproved parents and repeated approved bank references',()=>{
 assert.throws(()=>validateWallboardBillingLedger({receipts:{r1:receipt}}),/WALLBOARD_UNAVAILABLE/);
 assert.throws(()=>validateWallboardBillingLedger({invoices:{i1:{...invoice,status:'draft'}},receipts:{r1:receipt}}),/WALLBOARD_UNAVAILABLE/);
 assert.throws(()=>validateWallboardBillingLedger({invoices:{i1:invoice},receipts:{r1:receipt,r2:{...receipt,id:'r2'}}}),/WALLBOARD_UNAVAILABLE/);
});

test('rejects unsafe aggregate totals and prototype keys',()=>{
 const huge={...invoice,amount:Number.MAX_SAFE_INTEGER};
 assert.throws(()=>validateWallboardBillingLedger({invoices:{i1:huge,i2:{...huge,id:'i2',contractId:'contract2'}}}),/WALLBOARD_UNAVAILABLE/);
 const unsafe=JSON.parse('{"invoices":{"__proto__":{}}}');
 assert.throws(()=>validateWallboardBillingLedger(unsafe),/WALLBOARD_UNAVAILABLE/);
});
