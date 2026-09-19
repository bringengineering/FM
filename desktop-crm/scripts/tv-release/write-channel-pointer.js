'use strict';
const fs=require('node:fs'),path=require('node:path');
const fail=code=>{throw Object.assign(new Error(code),{code});};
function createPointer(verified,publishedAt=new Date().toISOString()){
 if(!verified||verified.schemaVersion!==1||verified.tag!==`tv-v${verified.version}`||!/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(String(verified.version||''))||verified.signature?.status!=='Valid'||!Number.isFinite(Date.parse(publishedAt)))fail('TV_CHANNEL_INPUT_INVALID');
 const installer=verified.installer,manifest=verified.manifest;
 if(!installer||!manifest||installer.name!==`BRING.TV.Setup.${verified.version}.exe`||manifest.name!=='latest-tv.yml'||!Number.isSafeInteger(installer.size)||installer.size<=0||!Number.isSafeInteger(manifest.size)||manifest.size<=0||typeof installer.sha512!=='string'||typeof manifest.sha256!=='string')fail('TV_CHANNEL_INPUT_INVALID');
 return {schemaVersion:1,tag:verified.tag,version:verified.version,publishedAt,installer:{name:installer.name,size:installer.size,sha512:installer.sha512},manifest:{name:manifest.name,size:manifest.size,sha256:manifest.sha256}};
}
function option(name){const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:'';}
if(require.main===module){try{const source=option('--verified'),output=option('--output');if(!source||!output)fail('TV_CHANNEL_INPUT_INVALID');const pointer=createPointer(JSON.parse(fs.readFileSync(path.resolve(source),'utf8')));fs.writeFileSync(path.resolve(output),JSON.stringify(pointer,null,2)+'\n',{encoding:'utf8',flag:'wx'});}catch(error){process.stderr.write(String(error.code||error.message));process.exitCode=1;}}
module.exports={createPointer};
