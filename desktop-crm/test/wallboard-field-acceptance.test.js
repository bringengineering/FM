'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluate}=require('../scripts/wallboard-field-acceptance');

test('requires 30 complete, uniquely identified real-save observations',()=>{
 const rows=Array.from({length:30},(_,i)=>({id:`save-${i+1}`,savedAt:1000+i*20000,publishedAt:2000+i*20000,receivedAt:5000+i*20000}));
 const result=evaluate(rows);
 assert.equal(result.count,30);
 assert.equal(result.medianMs,4000);
 assert.equal(result.p95Ms,4000);
 assert.equal(result.withinTenSeconds,30);
 assert.equal(result.latencyTargetMet,true);
 assert.equal(result.evidenceStatus,'TIMING_ONLY');
 assert.throws(()=>evaluate(rows.slice(0,29)),/30/);
 assert.throws(()=>evaluate([...rows.slice(0,29),{...rows[29],id:'save-1'}]),/duplicate/);
});

test('does not call a slow, out-of-order, or incomplete TV run passing',()=>{
 const rows=Array.from({length:30},(_,i)=>({id:`save-${i+1}`,savedAt:1000+i*20000,publishedAt:i*20000+2000,receivedAt:1000+i*20000+(i===29?15000:4000)}));
 const result=evaluate(rows);
 assert.equal(result.withinTenSeconds,29);
 assert.equal(result.latencyTargetMet,false);
 assert.equal(result.p95Ms,4000);
 assert.throws(()=>evaluate(rows.map((row,i)=>i===0?{...row,publishedAt:row.savedAt-1}:row)),/order/);
 assert.throws(()=>evaluate(rows.map((row,i)=>i===0?{...row,receivedAt:null}:row)),/timestamp/);
});
