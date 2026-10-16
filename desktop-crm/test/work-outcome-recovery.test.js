const test=require('node:test'),assert=require('node:assert/strict');
const UI=require('../src/work-outcome-ui');
test('recovery writes snapshots in order and clears only after pending writes',async()=>{
 const calls=[];let release;const gate=new Promise(r=>release=r);
 const api={save:async x=>{calls.push(x.value.draft.summary);if(calls.length===1)await gate;return {savedAt:'now'};},clear:async()=>{calls.push('clear');return {ok:true};}};
 const r=UI.recoveryQueue(api,'w','old');const draft={summary:'first'};
 const one=r.save(draft);draft.summary='changed';const two=r.save({summary:'second'});const cleared=r.clear();release();await Promise.all([one,two,cleared]);
 assert.deepEqual(calls,['first','second','clear']);
});
test('failed local save is reported and a retry still works',async()=>{
 let fail=true;const r=UI.recoveryQueue({save:async()=>{if(fail)throw Error('disk');return {savedAt:'now'};}},'w','');
 await assert.rejects(r.save({summary:'draft'}),/disk/);fail=false;assert.equal((await r.save({summary:'draft'})).savedAt,'now');
});
test('recovery preserves original server version and rejects false save acknowledgement',async()=>{
 let sent;const r=UI.recoveryQueue({save:async x=>{sent=x;return {};}},'w','original');
 await assert.rejects(r.save({summary:'text'}));assert.equal(sent.value.baseReport,'original');
});
