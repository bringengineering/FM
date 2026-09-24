'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8');

test('both CRM TV publisher paths pass the chosen instant to their source reader',()=>{
 assert.equal((source.match(/load:\s*instant\s*=>\s*loadWallboardSource\(remoteClient,\s*instant\)/gu)||[]).length,2);
});
