'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const rules=JSON.parse(fs.readFileSync(path.join(__dirname,'../../database.rules.json'),'utf8')).rules.crmCompany;
const snap=value=>({val:()=>value??null,child:key=>snap(key.split('/').reduce((part,segment)=>part?.[segment],value))});
const reader=(email='tv@example.test',verified=true,enabled=true)=>({
 auth:{uid:'tv',token:{email,email_verified:verified}},
 root:snap({crmCompany:{access:{},wallboardReaders:{tv:{email:'tv@example.test',enabled}}}}),
 $year:'2026',
});
const allowed=(expression,context)=>vm.runInNewContext(expression,context)===true;

test('verified enabled TV reader can read only the approved year record',()=>{
 const published=rules.companyStrategyPublications;
 assert.equal(allowed(published.$year['.read'],reader()),true);
 assert.equal(allowed(published.$year['.read'],reader('other@example.test')),false);
 assert.equal(allowed(published.$year['.read'],reader('tv@example.test',false)),false);
 assert.equal(allowed(published.$year['.read'],reader('tv@example.test',true,false)),false);
 assert.equal(allowed(published['.read'],reader()),false);
 assert.equal(allowed(rules.companyStrategyDrafts.$year['.read'],reader()),false);
 assert.equal(allowed(published.$year['.write'],reader()),false);
});
