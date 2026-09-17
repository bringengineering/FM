const test=require('node:test');const assert=require('node:assert/strict');const Core=require('../src/core');
test('structured hashes and UUIDs cannot randomly trip resident-number detector, real numbers still blocked',()=>{
 const hash='a'.repeat(20)+'9901011234567'+'a'.repeat(31);const uuid='12345678-1234-4234-8234-990101123456';
 assert.deepEqual(Core.findProhibitedSecrets({sha256:hash,snapshotJSON:JSON.stringify({sha256:hash,id:uuid})}),[]);
 assert.throws(()=>Core.assertNoProhibitedSecrets({memo:'주민등록번호 990101-1234567'}),/주민등록번호/);
 assert.throws(()=>Core.assertNoProhibitedSecrets({memo:'9901011234567'}),/주민등록번호/);
 assert.throws(()=>Core.assertNoProhibitedSecrets({memo:'비밀번호: '+hash}),/비밀번호/);
 assert.throws(()=>Core.assertNoProhibitedSecrets({memo:hash+' / 990101-1234567'}),/주민등록번호/);
 assert.throws(()=>Core.assertNoProhibitedSecrets({memo:'주민등록번호: '+hash}),/주민등록번호/);
 assert.throws(()=>Core.assertNoProhibitedSecrets({snapshotJSON:JSON.stringify({memo:'주민등록번호: '+hash})}),/주민등록번호/);
 assert.throws(()=>Core.assertNoProhibitedSecrets({password:hash}),/비밀번호/);
 assert.throws(()=>Core.assertNoProhibitedSecrets({snapshotJSON:JSON.stringify({hash,memo:'990101-1234567'})}),/주민등록번호/);
});

test('snapshot JSON preserves checks on keys, numeric values and duplicate members',()=>{
 for(const snapshotJSON of [JSON.stringify({'990101-1234567':'x'}),JSON.stringify({memo:9901011234567}),JSON.stringify({'비밀번호: abcd1234':'x'}),'"990101-1234567"','{"memo":"990101-1234567","memo":"safe"}'])assert.throws(()=>Core.assertNoProhibitedSecrets({snapshotJSON}),/주민등록번호|비밀번호/);
});
