const test=require('node:test'),assert=require('node:assert/strict');
test('original backup inspection sends bounded summary only and stops session changes',async()=>{
 const {createOriginalBackupInspection}=require('../src/rnd-control/original-backup-inspection');let generation=1,reads=0;const actor={uid:'u',email:'u@company.test',role:'admin'};
 const options={access:async()=>actor,captureSession:()=>generation,isCurrent:g=>g===generation,chooseFile:async()=>({canceled:false,filePaths:['trusted.zip']}),read:async()=>{reads++;return Buffer.from('fixture');},verify:async()=>({metadata:{projects:[{id:'p'}],visits:[],importJobs:[]},fileCount:2,manifest:{unverifiedLinkCount:1}}),validate:async()=>{}};
 const inspect=createOriginalBackupInspection(options),result=await inspect();assert.deepEqual(result,{verified:true,projectCount:1,visitCount:0,importJobCount:0,fileCount:2,unverifiedLinkCount:1,originVerified:false,fullBackup:false,restoreReady:false,cloudWrites:false});assert.equal(reads,1);await assert.rejects(()=>inspect({path:'renderer.zip'}));
 await assert.rejects(()=>createOriginalBackupInspection({...options,chooseFile:async()=>{generation++;return{filePaths:['x']};}})(),/세션/);assert.equal(reads,1);
});
test('bounded original backup file read refuses size growth and closes its handle',async()=>{
 const {readOriginalBackupFile}=require('../src/rnd-control/original-backup-inspection');let closed=0;const handle={stat:async()=>({isFile:()=>true,size:3}),read:async(buffer,offset,length,position)=>{if(position===0){Buffer.from([0,255,128]).copy(buffer,offset);return{bytesRead:3};}return{bytesRead:0};},close:async()=>{closed++;}};
 assert.deepEqual(await readOriginalBackupFile('trusted',{open:async()=>handle,check:async()=>{}}),Buffer.from([0,255,128]));assert.equal(closed,1);
 await assert.rejects(()=>readOriginalBackupFile('trusted',{open:async()=>({...handle,stat:async()=>({isFile:()=>true,size:105*1024*1024})}),check:async()=>{}}));assert.equal(closed,2);
});
