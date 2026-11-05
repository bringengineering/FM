const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {verifyAssets}=require('../scripts/tv-release/verify-assets');
const {createPointer}=require('../scripts/tv-release/write-channel-pointer');
const {writeUpdateManifest}=require('../scripts/tv-release/write-update-manifest');
function fixture(){
 const dist=fs.mkdtempSync(path.join(os.tmpdir(),'bring-tv-release-')),version='0.2.0',installerName=`BRING.TV.Setup.${version}.exe`,installer=Buffer.from('signed installer fixture');
 fs.writeFileSync(path.join(dist,installerName),installer);fs.writeFileSync(path.join(dist,installerName+'.blockmap'),'blockmap');
 writeUpdateManifest({dist,version,releaseDate:'2026-09-20T00:00:00Z'});
 return {dist,version};
}
test('release verifier accepts exactly three matched assets and a pinned company signature',async t=>{
 const f=fixture();t.after(()=>fs.rmSync(f.dist,{recursive:true,force:true}));
 const result=await verifyAssets({dist:f.dist,version:f.version,expectedPublisher:'BRING Engineering',expectedThumbprint:'AA11',signatureCheck:async()=>({status:'Valid',publisher:'BRING Engineering',thumbprint:'AA11'})});
 assert.equal(result.installer.name,'BRING.TV.Setup.0.2.0.exe');assert.equal(result.installer.size,24);assert.match(result.installer.sha512,/^[A-Za-z0-9+/]+={0,2}$/);assert.match(result.manifest.sha256,/^[a-f0-9]{64}$/);
 const pointer=createPointer(result,'2026-09-20T01:02:03.000Z');assert.deepEqual(Object.keys(pointer),['schemaVersion','tag','version','publishedAt','installer','manifest']);assert.equal(pointer.tag,'tv-v0.2.0');
});
test('release verifier blocks unsigned files and unexpected assets',async t=>{
 const f=fixture();t.after(()=>fs.rmSync(f.dist,{recursive:true,force:true}));
 await assert.rejects(verifyAssets({dist:f.dist,version:f.version,expectedPublisher:'BRING Engineering',expectedThumbprint:'AA11',signatureCheck:async()=>({status:'NotSigned',publisher:'',thumbprint:''})}),/TV_SIGNATURE_INVALID/);
 fs.writeFileSync(path.join(f.dist,'unexpected.txt'),'no');
 await assert.rejects(verifyAssets({dist:f.dist,version:f.version,expectedPublisher:'BRING Engineering',expectedThumbprint:'AA11',signatureCheck:async()=>({status:'Valid',publisher:'BRING Engineering',thumbprint:'AA11'})}),/TV_RELEASE_ASSET_SET_INVALID/);
});
