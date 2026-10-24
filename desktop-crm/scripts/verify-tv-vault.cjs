// No window or network. Use a caller-provided temporary directory only.
const {app,safeStorage}=require('electron');
const path=require('node:path'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
const {createWindowsVault}=require('../src/wallboard-vault');
const [folder,phase]=process.argv.slice(2);
if(!folder||!['write','read'].includes(phase))throw new Error('Temporary folder and write/read phase required');
app.setPath('userData',path.resolve(folder));app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const credential=path.join(folder,'test-device.bin');const vault=createWindowsVault({credential,safeStorage});
 const synthetic='a'.repeat(64);
 if(phase==='write'){assert.equal(await vault.read(),null);await vault.write(synthetic);assert.ok(!(await fs.readFile(credential)).includes(Buffer.from(synthetic)));}
 else{assert.equal(await vault.read(),synthetic);await vault.clear();assert.equal(await vault.read(),null);}
 console.log('PASS Windows protected storage '+phase);app.exit(0);
}).catch(()=>{console.error('Windows protected storage verification failed');app.exit(1);});
