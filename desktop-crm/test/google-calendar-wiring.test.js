const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const read=n=>fs.readFileSync(path.join(__dirname,'../src',n),'utf8');
test('Google calendar IPC is registered and uses existing secure canonical boundary',()=>{
 assert.match(read('main.js'),/secureCanonicalHandle\("crm:google-calendar"/);assert.match(read('preload.js'),/googleCalendar: input => ipcRenderer.invoke\("crm:google-calendar", input\)/);assert.ok(require('../src/mutation-policy').classification('crm:google-calendar'));
});
test('Google calendar projection is separate and invalidated on auth change',()=>{
 const app=read('app.js');assert.match(app,/googleCalendarController\?\.reset\(\)/);assert.match(app,/externalEvents: googleCalendarController\?\.snapshot\(\)\.events/);assert.match(app,/data-google-calendar-host/);assert.match(app,/60000/);
});
