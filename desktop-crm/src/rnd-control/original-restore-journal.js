const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const key=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(x),hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x),sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const targetFields=['projectId','artifactId','versionId','sha256','sizeBytes'],contextFields=['sourceProviderFileId',...targetFields];
const fail=()=>{throw Error('복원 업로드 원장 형식·연결 오류');};
function normalize(input){const x=structuredClone(input);if(!x||Object.keys(x).sort().join(',')!=='actorUid,files,mappingSHA256,previewId,sourceZipSHA256'||!key(x.actorUid)||!key(x.previewId)||!hash(x.mappingSHA256)||!hash(x.sourceZipSHA256)||!Array.isArray(x.files)||x.files.length>1000)fail();const seen=new Set();let total=0;
 for(const file of x.files){const t=file?.target;if(!file||Object.keys(file).sort().join(',')!=='sourceProviderFileId,target'||!key(file.sourceProviderFileId)||!t||Object.keys(t).sort().join(',')!==[...targetFields].sort().join(',')||![t.projectId,t.artifactId,t.versionId].every(key)||!hash(t.sha256)||!Number.isSafeInteger(t.sizeBytes)||t.sizeBytes<1)fail();total+=t.sizeBytes;const id=[t.projectId,t.artifactId,t.versionId].join(':');if(seen.has(id)||total>100*1024*1024)fail();seen.add(id);}return x;}
/** Main-private append-only disk journal. Atomic directory slots prevent cross-instance duplicates; unfinished slots remain visible. */
function createOriginalRestoreJournal(directory,{maxAttempts=100}={}){
 if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>100)fail();const root=path.resolve(directory),attemptRoot=path.join(root,'attempts');
 async function guard(target){const absolute=path.resolve(target),relative=path.relative(root,absolute);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('복원 원장 경로가 보관 폴더를 벗어났습니다');let current=path.parse(absolute).root;
  for(const part of absolute.slice(current.length).split(path.sep).filter(Boolean)){current=path.join(current,part);let info;try{info=await fs.lstat(current,{bigint:true});}catch(error){if(error.code==='ENOENT')return;throw error;}if(info.isSymbolicLink())throw Error('복원 원장 연결 경로는 사용할 수 없습니다');const actual=await fs.realpath(current);let equal=process.platform==='win32'?actual.toLowerCase()===current.toLowerCase():actual===current;if(!equal&&process.platform==='win32'&&/~[0-9]+(?:\\|$)/.test(current)){const canonical=await fs.lstat(actual,{bigint:true});equal=!canonical.isSymbolicLink()&&info.ino!==0n&&info.dev===canonical.dev&&info.ino===canonical.ino&&info.isDirectory()===canonical.isDirectory();}if(!equal)throw Error('복원 원장 경로가 변경되었습니다');}
 }
 async function mkdir(folder,options){await guard(folder);const result=await fs.mkdir(folder,options);await guard(folder);return result;}
 async function rename(from,to){await guard(from);await guard(to);await fs.rename(from,to);await guard(to);}
 async function unlink(file){await guard(file);await fs.unlink(file);}
 async function rmdir(folder){await guard(folder);await fs.rmdir(folder);}
 async function readdir(folder){await guard(folder);const result=await fs.readdir(folder);await guard(folder);return result;}
 async function stat(file){await guard(file);return fs.lstat(file);}
 async function write(file,value){await guard(file);const temporary=file+'.partial',handle=await fs.open(temporary,'wx',0o600);try{await handle.writeFile(JSON.stringify(value));await handle.sync();}finally{await handle.close();}await rename(temporary,file);}
 async function read(file){await guard(file);const handle=await fs.open(file,'r');try{const size=(await handle.stat()).size;if(size>1024*1024)fail();const buf=Buffer.alloc(size+1);let offset=0;while(offset<buf.length){const {bytesRead}=await handle.read(buf,offset,buf.length-offset,null);if(!bytesRead)break;offset+=bytesRead;}if(offset!==size)fail();return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buf.subarray(0,size)));}finally{await handle.close();}}
 const location=id=>{if(!hash(id))fail();return path.join(attemptRoot,id);};
 async function manifest(id){const m=await read(path.join(location(id),'manifest.json'));const normalized=normalize(m);if(sha([normalized.actorUid,normalized.mappingSHA256,normalized.sourceZipSHA256])!==id)fail();return normalized;}
 async function begin(input){const m=normalize(input),id=sha([m.actorUid,m.mappingSHA256,m.sourceZipSHA256]),quota=path.join(root,'quotas',m.actorUid);await mkdir(quota,{recursive:true});let slot;
  for(let i=0;i<maxAttempts;i++){const candidate=path.join(quota,String(i));try{await mkdir(candidate);slot=candidate;break;}catch(error){if(error.code!=='EEXIST')throw error;}}if(!slot)throw Error('복원 업로드 기록 한도 · 기존 작업을 검토하세요');
  await write(path.join(slot,'attempt.json'),{attemptId:id});await mkdir(attemptRoot,{recursive:true});try{await mkdir(location(id));}catch(error){if(error.code==='EEXIST'){await unlink(path.join(slot,'attempt.json'));await rmdir(slot);throw Error('이미 예약된 복원 업로드 · 중복 실행하지 않습니다');}throw error;}
  await write(path.join(location(id),'manifest.json'),m);return id;
 }
 function validateEvent(m,input){const event=Object.fromEntries(Object.entries(structuredClone(input)).filter(([,v])=>v!==undefined));if(!['UPLOAD_STARTED','UPLOAD_VERIFIED','UPLOAD_UNCERTAIN'].includes(event.type))fail();const allowed=new Set(['type',...contextFields,...(event.type==='UPLOAD_VERIFIED'?['providerFileId','verifiedAt']:event.type==='UPLOAD_UNCERTAIN'?['providerFileId','observedAt']:[])]);if(Object.keys(event).some(k=>!allowed.has(k)))fail();
  const index=m.files.findIndex(file=>contextFields.every(k=>event[k]===(k==='sourceProviderFileId'?file[k]:file.target[k])));if(index<0)fail();if(event.type==='UPLOAD_VERIFIED'&&(!key(event.providerFileId)||typeof event.verifiedAt!=='string'||!Number.isFinite(Date.parse(event.verifiedAt))))fail();if(event.type==='UPLOAD_UNCERTAIN'&&(event.providerFileId!==undefined||event.observedAt!==undefined)&&(!key(event.providerFileId)||typeof event.observedAt!=='string'||!Number.isFinite(Date.parse(event.observedAt))))fail();
  return{event,index};
 }
 async function append(id,input){const m=await manifest(id),{event,index}=validateEvent(m,input);
  const parent=location(id),started=path.join(parent,index+'-started'),terminal=path.join(parent,index+'-terminal');if(event.type!=='UPLOAD_STARTED'){const previous=await read(path.join(started,'event.json'));if(previous.type!=='UPLOAD_STARTED'||contextFields.some(k=>previous[k]!==event[k]))fail();}
  const slot=event.type==='UPLOAD_STARTED'?started:terminal;try{await mkdir(slot);}catch(error){if(error.code==='EEXIST')throw Error('이미 기록된 복원 파일 상태 · 중복 실행하지 않습니다');throw error;}await write(path.join(slot,'event.json'),event);
 }
 async function get(uid,id){if(!key(uid))fail();const m=await manifest(id);if(m.actorUid!==uid)throw Error('복원 원장 계정 연결 오류');const events=[];let incomplete=false;
   for(let i=0;i<m.files.length;i++)for(const phase of ['started','terminal']){const folder=path.join(location(id),i+'-'+phase);try{await stat(folder);}catch(error){if(error.code==='ENOENT')continue;throw error;}try{const {event,index}=validateEvent(m,await read(path.join(folder,'event.json')));if(index!==i||(phase==='started')!==(event.type==='UPLOAD_STARTED'))fail();events.push(event);}catch(error){if(error.code==='ENOENT'){incomplete=true;continue;}throw error;}}
return{...m,attemptId:id,events,incomplete};}
 async function list(uid){if(!key(uid))fail();const quota=path.join(root,'quotas',uid);let slots;try{slots=await readdir(quota);}catch(error){if(error.code==='ENOENT')return[];throw error;}if(slots.length>100||slots.some(s=>! /^(0|[1-9][0-9]?)$/.test(s)))fail();const records=[];
  for(const slot of slots.sort((a,b)=>Number(a)-Number(b))){let id,m;try{id=(await read(path.join(quota,slot,'attempt.json'))).attemptId;m=await manifest(id);}catch(error){if(error.code==='ENOENT'){records.push({attemptId:id??null,incomplete:true,events:[]});continue;}throw error;}if(m.actorUid!==uid)fail();records.push(await get(uid,id));

  }return records;
 }
 return{begin,append,list,get};
}
module.exports={createOriginalRestoreJournal};
