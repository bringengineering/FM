const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const file=require('node:path').join(__dirname,'../src/google-calendar-ui.js');const UI=fs.existsSync(file)?require(file):{};
test('snapshot works in renderer environments without structuredClone and stays isolated',()=>{
 const vm=require('node:vm');const context=vm.createContext({});vm.runInContext(fs.readFileSync(file,'utf8'),context);
 const c=context.BringGoogleCalendarUI.createController({request:async()=>({ok:true})});const copy=c.snapshot();copy.events.push({id:'local'});assert.equal(c.snapshot().events.length,0);
});
test('denied calendar actions discard cached events and selection',async()=>{
 for(const code of ['AUTH_REQUIRED','FORBIDDEN']){
  let deny=false;const c=UI.createController({request:async input=>deny?{ok:false,code}:input.action==='status'?{ok:true,status:'connected',selectedCalendars:[{id:'c'}]}:{ok:true,events:[{id:'e',calendarId:'c'}],status:'connected'}});
  await c.load('2026-09');deny=true;await c.act({action:'sync'},'2026-09');assert.deepEqual(c.snapshot().events,[]);assert.deepEqual(c.snapshot().selectedCalendars,[]);assert.equal(c.snapshot().status,'reconnect');
 }
});
test('unconfigured calendar is explicitly not connected and cannot start OAuth',()=>{
 assert.equal(typeof UI.render,'function');const html=UI.render({status:'unconfigured'},true);assert.match(html,/설정 필요/);assert.doesNotMatch(html,/data-google-calendar-action="connect"/);
});
test('calendar selection requires explicit sharing confirmation and escapes titles',()=>{
 assert.equal(typeof UI.render,'function');const html=UI.render({status:'awaiting_selection',calendars:[{id:'x',name:'<script>bad</script>'}]},true);assert.match(html,/data-google-calendar-share/);assert.match(html,/data-google-calendar-id/);assert.doesNotMatch(html,/<script>/);
 assert.doesNotMatch(UI.render({status:'connected'},false),/data-google-calendar-action="(?:connect|select|disconnect)"/);
});
test('late response after reset cannot restore another login calendar data',async()=>{
 assert.equal(typeof UI.createController,'function');let resolve;const c=UI.createController({request:()=>new Promise(r=>resolve=r)});const pending=c.load('2026-09');c.reset();resolve({ok:true,status:'connected',events:[{id:'secret'}]});await pending;assert.deepEqual(c.snapshot().events,[]);
});
test('transient failure keeps last good events but reports stale',async()=>{
 assert.equal(typeof UI.createController,'function');let fail=false;const c=UI.createController({request:async input=>{if(fail)throw Error('offline');return input.action==='status'?{ok:true,status:'connected',selectedCalendars:[{id:'c'}]}:{ok:true,status:'connected',events:[{id:'e',calendarId:'c'}]};}});await c.load('2026-09');fail=true;await c.load('2026-09');assert.equal(c.snapshot().status,'stale');assert.equal(c.snapshot().events.length,1);
});
test('permission failure completes the attempted month so render does not immediately retry',async()=>{
 const c=UI.createController({request:async()=>{throw Object.assign(Error('denied'),{code:'FORBIDDEN'});}});await c.load('2026-09');assert.equal(c.snapshot().loadedMonth,'2026-09');assert.equal(c.snapshot().status,'reconnect');
});
test('serialized IPC denial clears previously cached events',async()=>{
 let deny=false;const c=UI.createController({request:async input=>deny?{ok:false,code:'FORBIDDEN'}:input.action==='status'?{ok:true,status:'connected',selectedCalendars:[{id:'c'}]}:{ok:true,events:[{id:'e',calendarId:'c'}],status:'connected'}});await c.load('2026-09');deny=true;await c.load('2026-09');assert.deepEqual(c.snapshot().events,[]);assert.equal(c.snapshot().status,'reconnect');
});
