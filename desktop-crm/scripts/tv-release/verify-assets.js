'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const {assets,assertManifest}=require('../../src/tv-update-policy');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const semver=value=>/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(String(value||''))?String(value):'';
const hash=(algorithm,bytes,encoding)=>crypto.createHash(algorithm).update(bytes).digest(encoding);
function authenticode(file){
 return new Promise((resolve,reject)=>{
  const command="$s=Get-AuthenticodeSignature -LiteralPath $env:BRING_TV_VERIFY_PATH; [pscustomobject]@{status=[string]$s.Status;publisher=[string]$s.SignerCertificate.Subject;thumbprint=[string]$s.SignerCertificate.Thumbprint}|ConvertTo-Json -Compress";
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,env:{...process.env,BRING_TV_VERIFY_PATH:file},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>8192)child.kill();});child.stderr.on('data',chunk=>{stderr+=chunk;if(stderr.length>8192)child.kill();});
  child.once('error',()=>reject(Object.assign(new Error('TV_SIGNATURE_CHECK_FAILED'),{code:'TV_SIGNATURE_CHECK_FAILED'})));
  child.once('close',code=>{if(code!==0)return reject(Object.assign(new Error('TV_SIGNATURE_CHECK_FAILED'),{code:'TV_SIGNATURE_CHECK_FAILED'}));try{resolve(JSON.parse(stdout));}catch{reject(Object.assign(new Error('TV_SIGNATURE_CHECK_FAILED'),{code:'TV_SIGNATURE_CHECK_FAILED'}));}});
 });
}
async function verifyAssets({dist,version,expectedPublisher,expectedThumbprint,signatureCheck=authenticode}){
 const v=semver(version);if(!v||typeof dist!=='string'||!dist||typeof expectedPublisher!=='string'||!expectedPublisher||typeof expectedThumbprint!=='string'||!expectedThumbprint)fail('TV_RELEASE_INPUT_INVALID');
 const root=path.resolve(dist),names=assets(v),expected=[names.installer,names.blockmap,names.manifest].sort();let entries;
 try{entries=fs.readdirSync(root,{withFileTypes:true}).filter(entry=>entry.isFile()&&entry.name!=='builder-debug.yml').map(entry=>entry.name).sort();}catch{fail('TV_RELEASE_ASSET_SET_INVALID');}
 if(entries.length!==expected.length||entries.some((name,index)=>name!==expected[index]))fail('TV_RELEASE_ASSET_SET_INVALID');
 const installerPath=path.join(root,names.installer),blockmapPath=path.join(root,names.blockmap),manifestPath=path.join(root,names.manifest);
 const installer=fs.readFileSync(installerPath),blockmap=fs.readFileSync(blockmapPath),manifest=fs.readFileSync(manifestPath);
 if(!installer.length||!blockmap.length||!manifest.length)fail('TV_RELEASE_ASSET_INVALID');
 const installerMeta={name:names.installer,size:installer.length,sha512:hash('sha512',installer,'base64')};
 const manifestMeta={name:names.manifest,size:manifest.length,sha256:hash('sha256',manifest,'hex')};
 assertManifest(manifest.toString('utf8'),{version:v,installer:installerMeta,manifest:manifestMeta});
 const signature=await signatureCheck(installerPath),publisher=String(signature?.publisher||''),thumbprint=String(signature?.thumbprint||'').replace(/\s/g,'').toUpperCase();
 if(signature?.status!=='Valid'||publisher!==expectedPublisher||thumbprint!==expectedThumbprint.replace(/\s/g,'').toUpperCase())fail('TV_SIGNATURE_INVALID');
 return {schemaVersion:1,tag:`tv-v${v}`,version:v,installer:installerMeta,blockmap:{name:names.blockmap,size:blockmap.length,sha256:hash('sha256',blockmap,'hex')},manifest:manifestMeta,signature:{status:'Valid',publisher,thumbprint}};
}
function option(name){const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:'';}
if(require.main===module){verifyAssets({dist:option('--dist'),version:option('--version'),expectedPublisher:process.env.BRING_TV_CERT_SUBJECT||'',expectedThumbprint:process.env.BRING_TV_CERT_THUMBPRINT||''}).then(result=>process.stdout.write(JSON.stringify(result))).catch(error=>{process.stderr.write(String(error.code||error.message));process.exitCode=1;});}
module.exports={verifyAssets,authenticode};
