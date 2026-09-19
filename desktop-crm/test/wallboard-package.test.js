const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('TV package is isolated from CRM identity, source, release feed and output',()=>{
 const file=path.join(__dirname,'../electron-builder.tv.cjs');assert.ok(fs.existsSync(file),'separate TV build configuration required');const config=require(file);
 assert.equal(config.appId,'kr.co.bringengineering.wallboard');assert.equal(config.productName,'BRING TV');assert.equal(config.extraMetadata.main,'src/wallboard-tv-main.js');assert.equal(config.extraMetadata.name,'bring-tv');assert.equal(config.directories.output,'dist-tv');assert.equal(config.publish,null);
 assert.ok(config.files.includes('src/wallboard-tv-main.js'));assert.ok(!config.files.includes('src/**/*'));assert.ok(!config.files.includes('src/main.js'));assert.ok(!config.files.includes('src/remote.js'));assert.equal(config.nsis.runAfterFinish,false);assert.equal(config.nsis.deleteAppDataOnUninstall,false);
});
