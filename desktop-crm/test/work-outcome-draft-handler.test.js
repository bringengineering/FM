const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function setup(role='member'){
 const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8');
 const fn=source.match(/async function handleWorkOutcomeDraft\(action, input\) \{[\s\S]*?\n\}/);assert.ok(fn,'authenticated draft handler exists');
 let received;
 const store={load:async(...args)=>{received=args;return {draft:{summary:'mine'}};}};
 const context={remoteClient:{requireOfficeSession:()=>({uid:'actual-user',role}),captureSessionGuard:()=>({}),sessionGuardActive:()=>true,firebase:{databaseUrl:'company-db'},databaseRoot:'crmCompany'},isMarketingOnlySession:()=>false,getWorkOutcomeDraftStore:()=>store};
 vm.createContext(context);vm.runInContext(fn[0],context);return {call:context.handleWorkOutcomeDraft,received:()=>received};
}
test('draft identity is taken from active session, never input owner',async()=>{
 const c=setup();await c.call('load',{orderId:'w1',uid:'victim',company:'other'});
 assert.equal(c.received()[0].uid,'actual-user');assert.equal(c.received()[0].company,'company-db/crmCompany');
});
test('viewers cannot read local editing drafts',async()=>{await assert.rejects(setup('viewer').call('load',{orderId:'w1'}));});
test('draft bridge uses trusted canonical IPC and explicitly classified channels',()=>{
 const main=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8'),preload=fs.readFileSync(path.join(__dirname,'../src/preload.js'),'utf8');
 const policy=require('../src/mutation-policy');
 for(const action of ['load','save','clear']){
   const channel=`crm:work-outcome-draft-${action}`;
   assert.ok(main.includes(`secureCanonicalHandle("${channel}"`));
   assert.ok(preload.includes(`ipcRenderer.invoke("${channel}"`));
   assert.equal(policy.classification(channel),action==='load'?'control':'mutation');
 }
});
