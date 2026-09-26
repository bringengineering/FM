'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('confirmed building schedule changes request TV refresh, but repeated saves do not',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8');
 const start=source.indexOf('secureCanonicalHandle("crm:building-schedule-commit"');
 const end=source.indexOf('secureCanonicalHandle("crm:marketing-read"',start);
 assert.ok(start>=0&&end>start);
 const handler=source.slice(start,end);
 assert.match(handler,/if \(!result\.repeated && !localTestMode\) signalWallboardAfterSave\(\)/);
 assert.ok(handler.indexOf('if (!result.repeated && !localTestMode) signalWallboardAfterSave()')>handler.indexOf('if (!result || !result.record)'));
});
