'use strict';
const crypto=require('node:crypto');
const TV_CHANNEL_POINTER_URL='https://raw.githubusercontent.com/bringengineering/FM/tv-update-channel/latest.json';
const MAX_POINTER_BYTES=4096,MAX_MANIFEST_BYTES=131072,MAX_INSTALLER_BYTES=2*1024*1024*1024,TIMEOUT_MS=12000;
const fail=(code,message)=>{throw Object.assign(new Error(code+(message?': '+message:'')),{code});};
const plain=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
function exact(value,keys){return plain(value)&&Object.keys(value).sort().join('\0')===[...keys].sort().join('\0');}
function version(value){const text=String(value||''),match=/^(\d+)\.(\d+)\.(\d+)$/.exec(text);if(!match)return '';const normalized=match.slice(1).map(Number);return normalized.every(v=>Number.isSafeInteger(v)&&v>=0)&&normalized.join('.')===text?text:'';}
function validSha512(value){const text=String(value||'');if(!/^[A-Za-z0-9+/]+={0,2}$/.test(text))return false;try{const bytes=Buffer.from(text,'base64');return bytes.length===64&&bytes.toString('base64')===text;}catch{return false;}}
const unquote=value=>{const text=String(value||'').trim();return text.length>=2&&((text[0]==="'"&&text.at(-1)==="'")||(text[0]==='"'&&text.at(-1)==='"'))?text.slice(1,-1):text;};
function top(lines,key){const matches=lines.map(line=>line.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`))).filter(Boolean);return matches.length===1?unquote(matches[0][1]):'';}
function parseManifest(text){
 const lines=String(text||'').replace(/\r\n?/g,'\n').split('\n'),markers=[];lines.forEach((line,index)=>{if(line==='files:')markers.push(index);});if(markers.length!==1)fail('TV_UPDATE_MANIFEST_MISMATCH');
 const entries=[];let current=null;
 for(let i=markers[0]+1;i<lines.length;i++){const line=lines[i];if(line&&!/^\s/.test(line))break;if(!line.trim())continue;const url=line.match(/^\s{2}-\s+url:\s*(.+?)\s*$/);if(url){current={url:unquote(url[1]),sha512:'',size:null};entries.push(current);continue;}const item=line.match(/^\s{4}(sha512|size):\s*(.+?)\s*$/);if(!current||!item)fail('TV_UPDATE_MANIFEST_MISMATCH');if(item[1]==='sha512')current.sha512=unquote(item[2]);else current.size=/^\d+$/.test(item[2])?Number(item[2]):NaN;}
 const parsed={version:top(lines,'version'),path:top(lines,'path'),sha512:top(lines,'sha512'),file:entries.length===1?entries[0]:null};if(!parsed.version||!parsed.path||!validSha512(parsed.sha512)||!parsed.file||!parsed.file.url||!validSha512(parsed.file.sha512)||!Number.isSafeInteger(parsed.file.size)||parsed.file.size<=0)fail('TV_UPDATE_MANIFEST_MISMATCH');return parsed;
}
function assets(v){return {installer:`BRING.TV.Setup.${v}.exe`,blockmap:`BRING.TV.Setup.${v}.exe.blockmap`,manifest:'latest-tv.yml'};}
function parseTvChannelPointer(source){
 let value;const text=String(source||'');if(!text||Buffer.byteLength(text)>MAX_POINTER_BYTES)fail('TV_UPDATE_POINTER_INVALID');
 try{value=JSON.parse(text);}catch{fail('TV_UPDATE_POINTER_INVALID');}
 if(!exact(value,['schemaVersion','tag','version','publishedAt','installer','manifest'])||value.schemaVersion!==1||!exact(value.installer,['name','size','sha512'])||!exact(value.manifest,['name','size','sha256']))fail('TV_UPDATE_POINTER_INVALID');
 const v=version(value.version),expected=assets(v),published=String(value.publishedAt||'');
 if(!v||value.tag!==`tv-v${v}`||value.installer.name!==expected.installer||value.manifest.name!==expected.manifest||!Number.isSafeInteger(value.installer.size)||value.installer.size<=0||value.installer.size>MAX_INSTALLER_BYTES||!validSha512(value.installer.sha512)||!Number.isSafeInteger(value.manifest.size)||value.manifest.size<=0||value.manifest.size>MAX_MANIFEST_BYTES||!/^[a-f0-9]{64}$/.test(String(value.manifest.sha256||''))||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T/.test(published)||!Number.isFinite(Date.parse(published)))fail('TV_UPDATE_POINTER_INVALID');
 return Object.freeze({schemaVersion:1,tag:value.tag,version:v,publishedAt:published,installer:Object.freeze({...value.installer}),manifest:Object.freeze({...value.manifest})});
}
async function fetchText(fetchImpl,url,maxBytes,signal){
 const response=await fetchImpl(url,{method:'GET',redirect:'error',headers:{accept:'application/octet-stream','user-agent':'BRING-TV-Updater'},signal});
 if(!response||response.ok!==true||response.redirected)fail('TV_UPDATE_CHANNEL_UNAVAILABLE');
 const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.byteLength===0||bytes.byteLength>maxBytes)fail('TV_UPDATE_BODY_INVALID');
 return new TextDecoder().decode(bytes);
}
function assertManifest(text,pointer){
 const source=String(text||''),digest=crypto.createHash('sha256').update(source).digest('hex');
 if(Buffer.byteLength(source)!==pointer.manifest.size||digest!==pointer.manifest.sha256)fail('TV_UPDATE_MANIFEST_MISMATCH');
 let manifest;try{manifest=parseManifest(source);}catch{fail('TV_UPDATE_MANIFEST_MISMATCH');}
 if(manifest.version!==pointer.version||manifest.path!==pointer.installer.name||manifest.file.url!==pointer.installer.name||manifest.sha512!==pointer.installer.sha512||manifest.file.sha512!==pointer.installer.sha512||manifest.file.size!==pointer.installer.size)fail('TV_UPDATE_MANIFEST_MISMATCH');
 return manifest;
}
async function resolveTvChannel({fetchImpl=globalThis.fetch,timeoutMs=TIMEOUT_MS}={}){
 if(typeof fetchImpl!=='function')fail('TV_UPDATE_FETCH_UNAVAILABLE');const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{
  const pointer=parseTvChannelPointer(await fetchText(fetchImpl,TV_CHANNEL_POINTER_URL,MAX_POINTER_BYTES,controller.signal));
  const manifestUrl=`https://github.com/bringengineering/FM/releases/download/${encodeURIComponent(pointer.tag)}/${pointer.manifest.name}`;
  assertManifest(await fetchText(fetchImpl,manifestUrl,MAX_MANIFEST_BYTES,controller.signal),pointer);
  return Object.freeze({tag:pointer.tag,version:pointer.version,publishedAt:pointer.publishedAt,feedUrl:`https://github.com/bringengineering/FM/releases/download/${encodeURIComponent(pointer.tag)}/`,pointer});
 }catch(error){if(error?.code)throw error;fail('TV_UPDATE_CHANNEL_UNAVAILABLE');}finally{clearTimeout(timer);}
}
module.exports={TV_CHANNEL_POINTER_URL,assets,parseTvChannelPointer,resolveTvChannel,assertManifest};
