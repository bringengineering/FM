'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {loadWallboardSource}=require('../src/wallboard-publisher');
const board=require('../src/company-wallboard');
const {validatePublication}=require('../src/wallboard-publication-schema');
const {defaultPlaylist}=require('../src/wallboard-live-sync');
const fs=require('node:fs');
const path=require('node:path');

test('wallboard source reads the common ledger without copying contract details into publication',async()=>{
 const ledger={invoices:[{id:'i1',contractId:'private-contract',billingMonth:'2026-09',amount:100000,status:'approved'}],receipts:[{id:'r1',invoiceId:'i1',amount:40000,receivedAt:'2026-09-24',transactionRef:'secret-bank-ref',status:'approved'}]};
 const source=await loadWallboardSource({loadWorkOrders:async()=>({orders:[]}),loadBillingLedger:async()=>ledger,dbRequest:async()=>null},new Date('2026-09-25T00:00:00Z'));
 const model=board.project(source,'2026-09-25');
 assert.deepEqual(model.companyRevenue,{available:true,month:'2026-09',billed:100000,received:40000,receivable:60000,pendingCount:0,undatedPendingCount:0});
 assert.equal(JSON.stringify(model).includes('private-contract'),false);
 assert.equal(JSON.stringify(model).includes('secret-bank-ref'),false);
});

test('empty or missing ledger is unavailable, never presented as confirmed zero revenue',()=>{
 assert.equal(board.project({orders:[]},'2026-09-25').companyRevenue.available,false);
 assert.equal(board.project({orders:[],billingLedger:{invoices:[],receipts:[]}},'2026-09-25').companyRevenue.available,false);
 assert.match(board.scene(board.project({orders:[]},'2026-09-25'),'companyRevenue'),/집계 대기/);
});

test('draft-only ledger publishes a pending count without presenting unapproved money as zero',()=>{
 const model=board.project({orders:[],billingLedger:{invoices:[{id:'draft1',billingMonth:'2026-09',amount:100000,status:'draft'}],receipts:[]}},'2026-09-25');
 assert.deepEqual(model.companyRevenue,{available:false,month:'2026-09',billed:null,received:null,receivable:null,pendingCount:1,undatedPendingCount:0});
 assert.match(board.scene(model,'companyRevenue'),/확인 대기 1건/);
 assert.doesNotMatch(board.scene(model,'companyRevenue'),/0원/);
 assert.doesNotThrow(()=>validatePublication({model,playlist:[{key:'companyRevenue',enabled:true,seconds:30}],notice:'',dataDate:'2026-09-25'}));
});

test('approved revenue is validated as aggregate-only and rendered with separate billed and received values',()=>{
 const model=board.project({orders:[],billingLedger:{invoices:[{id:'i1',billingMonth:'2026-09',amount:100000,status:'approved'}],receipts:[]}},'2026-09-25');
 const publication=validatePublication({model,playlist:[{key:'companyRevenue',enabled:true,seconds:30}],notice:'',dataDate:'2026-09-25'});
 assert.equal(publication.model.companyRevenue.billed,100000);
 const html=board.scene(model,'companyRevenue');
 assert.match(html,/청구액/);assert.match(html,/입금액/);assert.match(html,/100,000/);assert.match(html,/0/);
 assert.throws(()=>validatePublication({...publication,model:{...model,companyRevenue:{...model.companyRevenue,customerName:'비공개 고객'}}}),/INVALID_INPUT/);
});

test('automatic TV playlist includes monthly revenue and web client offers its scene',async()=>{
 assert.equal(defaultPlaylist.some(item=>item.key==='companyRevenue'&&item.enabled),true);
 const {wallboardWebAssetResponse}=await import('../../crm-ai-worker/src/wallboard-web-assets.js');
 const js=await (await wallboardWebAssetResponse('/tv/app.js')).text();
 assert.match(js,/companyRevenue/);
 assert.match(js,/확정 청구액/);
 assert.match(js,/확정 입금액/);
});

test('billing read failure leaves other TV scenes publishable and labels revenue connection pending',async()=>{
 const source=await loadWallboardSource({loadWorkOrders:async()=>({orders:[{id:'task1',status:'doing',assigneeName:'김현진'}]}),loadBillingLedger:async()=>{throw Error('network');},dbRequest:async()=>null},new Date('2026-09-25T00:00:00Z'));
 const model=board.project(source,'2026-09-25');
 assert.equal(model.counts.doing,1);
 assert.equal(model.companyRevenue.available,false);
 assert.equal(model.companyRevenue.sourceStatus,'unavailable');
 assert.match(board.scene(model,'companyRevenue'),/연결 확인 중/);
 assert.doesNotThrow(()=>validatePublication({model,playlist:[{key:'companyRevenue',enabled:true,seconds:30}],notice:'',dataDate:'2026-09-25'}));
});

test('successful invoice and receipt saves signal wallboard refresh after persistence',()=>{
 const main=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8');
 assert.match(main,/secureCanonicalHandle\("crm:billing-invoice-save", input => saveAndSignalWallboard\(\(\) => remoteClient\.saveBillingInvoice\(input\), signalWallboardAfterSave\)\)/);
 assert.match(main,/secureCanonicalHandle\("crm:billing-receipt-save", input => saveAndSignalWallboard\(\(\) => remoteClient\.saveBillingReceipt\(input\), signalWallboardAfterSave\)\)/);
});

test('TV browser revenue validator rejects extra private fields',async()=>{
 const vm=require('node:vm');
 const {wallboardWebAssetResponse}=await import('../../crm-ai-worker/src/wallboard-web-assets.js');
 const js=await (await wallboardWebAssetResponse('/tv/app.js')).text();
 const helper=js.match(/function validRevenue\(r,month\)\{.*?\}(?=\s*function store\()/s)?.[0];
 assert.ok(helper);
 const validRevenue=vm.runInNewContext(`${helper};validRevenue`);
 const revenue={available:false,month:'2026-09',billed:null,received:null,receivable:null,pendingCount:null,undatedPendingCount:null};
 assert.equal(validRevenue({...revenue,sourceStatus:'unavailable'},'2026-09'),true);
 assert.equal(validRevenue({...revenue,pendingCount:1,undatedPendingCount:0},'2026-09'),true);
 assert.equal(validRevenue({...revenue,customerName:'private'},'2026-09'),false);
});
