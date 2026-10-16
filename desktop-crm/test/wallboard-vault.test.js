const test=require('node:test'),assert=require('node:assert/strict');
const {createWindowsVault}=require('../src/wallboard-vault');
test('vault refuses unprotected storage before touching disk',async()=>{
 const vault=createWindowsVault({credential:'unused',platform:'win32',safeStorage:{isEncryptionAvailable:()=>false}});
 await assert.rejects(vault.write('a'.repeat(64)),/보호 저장소/);await assert.rejects(vault.read(),/보호 저장소/);
});
