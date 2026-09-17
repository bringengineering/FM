const {createHash}=require('node:crypto'),{readStoredZip}=require('./zip-reader'),{buildOriginalBackup}=require('./original-backup');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
/** Internal verification only. A matching hash is integrity evidence, not trusted company origin or restore approval. */
async function verifyOriginalBackup(bytes,{check}){
 await check();const files=readStoredZip(bytes),fail=()=>{throw Error('원본 보관 목록·자료 대조 실패');};
 const parse=(name,limit)=>{const data=files.get(name);if(!data||data.length>limit)fail();try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));}catch{fail();}};
 const manifest=parse('manifest.json',1024*1024),metadata=parse('metadata.json',20*1024*1024);
 if(manifest?.kind!=='BRING_RND_ENUMERATED_ORIGINAL_PACKAGE'||manifest.version!==1||manifest.fullBackup!==false||manifest.restoreReady!==false||manifest.cloudWrites!==false||manifest.allEnumeratedOriginalsIncluded!==true||manifest.metadataSHA256!==hash(files.get('metadata.json'))||!Array.isArray(manifest.files)||manifest.files.length>1000)fail();
 await check();const rebuilt=await buildOriginalBackup(metadata,{check,download:async ref=>{const data=files.get('originals/'+ref.providerFileId+'.bin');if(!data)fail();const saved=manifest.files.find(file=>file.providerFileId===ref.providerFileId);return{reference:ref,bytes:data,...(saved&&Object.hasOwn(saved,'fileName')?{fileName:saved.fileName}:{}),...(saved&&Object.hasOwn(saved,'mimeType')?{mimeType:saved.mimeType}:{})};}});
 const expected=rebuilt.manifest;
 if(manifest.scope!==expected.scope||manifest.unverifiedLinkCount!==expected.unverifiedLinkCount||manifest.files.length!==expected.files.length)fail();
 for(let i=0;i<expected.files.length;i++){const keys=Object.keys(expected.files[i]);if(!manifest.files[i]||Object.keys(manifest.files[i]).length!==keys.length||keys.some(k=>manifest.files[i][k]!==expected.files[i][k]))fail();}
 const names=new Set(['metadata.json','manifest.json',...expected.files.map(f=>f.path)]);if(files.size!==names.size||[...files.keys()].some(name=>!names.has(name)))fail();
 await check();return{metadata,manifest,originals:new Map(expected.files.map(f=>[f.path,files.get(f.path)])),fileCount:expected.files.length,fullBackup:false,restoreReady:false,originVerified:false,cloudWrites:false};
}
module.exports={verifyOriginalBackup};
