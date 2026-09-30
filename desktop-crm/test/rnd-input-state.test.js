const {test}=require('node:test');const assert=require('node:assert/strict');
test('pending form clear preserves edits made while saving and after session reset',async()=>{
 const {createInputState}=await import('../src/rnd-control/input-state.mjs');const state=createInputState();
 state.touch('research');const first=state.version('research');state.touch('research');
 assert.equal(state.delete('research',first),false);assert.equal(state.size,1);
 assert.equal(state.delete('research',state.version('research')),true);assert.equal(state.size,0);
 state.touch('admin');const priorSession=state.version('admin');state.clear();state.touch('admin');
 assert.equal(state.delete('admin',priorSession),false);assert.equal(state.size,1);
});
