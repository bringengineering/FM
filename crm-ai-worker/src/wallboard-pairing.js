// Repository must provide durable, serializable transactions. Never use eventual KV.
import {validatePublication} from './wallboard-publication.js';
// Identity is trusted only after the HTTP boundary verifies the employee token.
const TTL=10*60*1000;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
const version=value=>typeof value==='string'&&/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(value)?value:null;
const updateStatuses=new Set(['idle','downloading','ready','installing','installed','failed']);
const clientTypes=new Set(['electron','web']);
async function hash(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('');}
function admin(identity){if(identity?.isAdmin!==true||typeof identity.uid!=='string'||!identity.uid)fail('FORBIDDEN');}
function initialize(s,now){
 s.pending??={};s.devices??={};s.attempts??={};
 for(const [key,p] of Object.entries(s.pending))if(p.expiresAt<=now)delete s.pending[key];
 for(const [key,p] of Object.entries(s.attempts))if(p.until<=now)delete s.attempts[key];
}
export function createPairingService({repository,now=Date.now}){
 if(typeof repository?.transaction!=='function')throw new TypeError('Atomic repository required');
 async function run(fn){const result=await repository.transaction(s=>{initialize(s,now());return fn(s);});if(result?.error)fail(result.error);return result;}
 return {
  async begin(clientType='electron'){
   if(!clientTypes.has(clientType))fail('INVALID_INPUT');
   const pendingToken=token(),digest=await hash(pendingToken);
   return run(s=>{
    if(Object.keys(s.pending).length>=20)return {error:'RATE_LIMITED'};
    let code;do{code=crypto.randomUUID().replaceAll('-','').slice(0,8).toUpperCase();}while(Object.values(s.pending).some(p=>p.code===code));
    const expiresAt=now()+TTL;s.pending[digest]={code,expiresAt,status:'pending',clientType};
    return {code,pendingToken,expiresAt};
   });
  },
  async approve(code,name,identity){
   admin(identity);
   if(typeof name!=='string'||!name.trim()||name.length>60)fail('INVALID_INPUT');
   const key=await hash(identity.uid);
   return run(s=>{
    const attempt=s.attempts[key]??={count:0,until:now()+60000};
    if(++attempt.count>10)return {error:'RATE_LIMITED'};
    const entry=Object.values(s.pending).find(p=>p.code===code&&p.status==='pending');
    if(!entry)return {error:'INVALID_CODE'};
    if(Object.values(s.devices).filter(d=>!d.revokedAt).length>=20)return {error:'DEVICE_LIMIT'};
    entry.status='approved';entry.name=name.trim();entry.approvedBy=identity.uid;
    return {status:'approved'};
   });
  },
  async poll(pendingToken){
   if(typeof pendingToken!=='string'||!/^[a-f0-9]{64}$/.test(pendingToken))fail('INVALID_TOKEN');
   const digest=await hash(pendingToken),deviceToken=token(),deviceHash=await hash(deviceToken);
   return run(s=>{
    const p=s.pending[digest];if(!p)return {error:'INVALID_TOKEN'};
    if(p.status==='pending')return {status:'pending'};
    if(Object.values(s.devices).filter(d=>!d.revokedAt).length>=20)return {error:'DEVICE_LIMIT'};
    const deviceId=crypto.randomUUID();
    s.devices[deviceHash]={id:deviceId,name:p.name,clientType:clientTypes.has(p.clientType)?p.clientType:'electron',approvedBy:p.approvedBy,createdAt:now(),lastSeenAt:null,revokedAt:null};
    delete s.pending[digest];return {status:'approved',deviceId,deviceToken};
   });
  },
  async authenticate(deviceToken){
   if(typeof deviceToken!=='string'||!/^[a-f0-9]{64}$/.test(deviceToken))fail('INVALID_TOKEN');
   const digest=await hash(deviceToken);
   return run(s=>{const d=s.devices[digest];if(!d||d.revokedAt!==null)return {error:'INVALID_TOKEN'};d.lastSeenAt=now();return {id:d.id,name:d.name,clientType:clientTypes.has(d.clientType)?d.clientType:'electron'};});
  },
  async revoke(deviceId,identity){
   admin(identity);
   return run(s=>{const d=Object.values(s.devices).find(d=>d.id===deviceId);if(!d)return {error:'NOT_FOUND'};d.revokedAt=now();return {status:'revoked'};});
  },
  async scheduleUpdate(deviceId,targetVersion,identity){
   admin(identity);
   if(typeof deviceId!=='string'||!deviceId||!version(targetVersion))fail('INVALID_INPUT');
   return run(s=>{
    const device=Object.values(s.devices).find(d=>d.id===deviceId&&d.revokedAt===null);
    if(!device)return {error:'NOT_FOUND'};
    if((clientTypes.has(device.clientType)?device.clientType:'electron')==='web')return {error:'INVALID_INPUT'};
    device.targetVersion=targetVersion;device.updateStatus='scheduled';device.updateError=null;
    device.updateApprovedBy=identity.uid;device.updateApprovedAt=now();device.updateConsumedAt=null;device.updateCompletedAt=null;
    return {status:'scheduled',targetVersion};
   });
  },
  async cancelUpdate(deviceId,identity){
   admin(identity);
   if(typeof deviceId!=='string'||!deviceId)fail('INVALID_INPUT');
   return run(s=>{
    const device=Object.values(s.devices).find(d=>d.id===deviceId&&d.revokedAt===null);
    if(!device)return {error:'NOT_FOUND'};
    device.targetVersion=null;device.updateStatus='cancelled';device.updateError=null;device.updateApprovedBy=null;device.updateApprovedAt=null;device.updateConsumedAt=null;
    return {status:'cancelled'};
   });
  },
  async publish(input,expectedVersion,identity){
   admin(identity);const snapshot=validatePublication(input);
   if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0)fail('INVALID_INPUT');
   return run(s=>{if((s.board?.version||0)!==expectedVersion)return {error:'VERSION_CONFLICT'};s.board={...snapshot,version:expectedVersion+1,publishedAt:now()};return {version:s.board.version,publishedAt:s.board.publishedAt};});
  },
  async beginRefresh(identity){
   admin(identity);
   if(identity.uid!=='server-refresh')fail('FORBIDDEN');
   const refreshToken=crypto.randomUUID();
   return run(s=>{s.refreshToken=refreshToken;return {refreshToken};});
  },
  async publishIfChanged(input,expectedVersion,identity,refreshToken){
   admin(identity);const snapshot=validatePublication(input);
   if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0)fail('INVALID_INPUT');
   if(refreshToken!==undefined&&(identity.uid!=='server-refresh'||typeof refreshToken!=='string'||!refreshToken))fail('FORBIDDEN');
   return run(s=>{
    if(refreshToken!==undefined&&s.refreshToken!==refreshToken)return {error:'STALE_REFRESH'};
    if((s.board?.version||0)!==expectedVersion)return {error:'VERSION_CONFLICT'};
    const prior=s.board;
    if(prior&&JSON.stringify({model:prior.model,playlist:prior.playlist,notice:prior.notice,dataDate:prior.dataDate})===JSON.stringify(snapshot))return {version:prior.version,publishedAt:prior.publishedAt};
    s.board={...snapshot,version:expectedVersion+1,publishedAt:now()};
    return {version:s.board.version,publishedAt:s.board.publishedAt};
   });
  },
  async readBoard(deviceToken,clientVersion,report={}){
   if(clientVersion!==undefined&&(typeof clientVersion!=='string'||!/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(clientVersion)))throw Object.assign(new Error('INVALID_INPUT'),{code:'INVALID_INPUT'});
   if(!report||typeof report!=='object'||Array.isArray(report)||Object.keys(report).some(k=>!['updateStatus','updateError'].includes(k)))fail('INVALID_INPUT');
   if(report.updateStatus!==undefined&&!updateStatuses.has(report.updateStatus))fail('INVALID_INPUT');
   if(report.updateError!==undefined&&(typeof report.updateError!=='string'||!/^[A-Z0-9_]{1,80}$/.test(report.updateError)))fail('INVALID_INPUT');
   if(typeof deviceToken!=='string'||!/^[a-f0-9]{64}$/.test(deviceToken))fail('INVALID_TOKEN');
   const digest=await hash(deviceToken);
   return run(s=>{
    const device=s.devices[digest];if(!device||device.revokedAt!==null)return {error:'INVALID_TOKEN'};
    device.lastSeenAt=now();if(clientVersion!==undefined)device.clientVersion=clientVersion;
    if(Number.isSafeInteger(s.board?.version))device.receivedVersion=s.board.version;
    if(device.targetVersion&&clientVersion===device.targetVersion){
     device.targetVersion=null;device.updateStatus='installed';device.updateError=null;device.updateCompletedAt=now();device.updateApprovedBy=null;device.updateConsumedAt=null;
    }else if(device.targetVersion&&report.updateStatus!==undefined){
     device.updateStatus=report.updateStatus;device.updateError=report.updateStatus==='failed'?(report.updateError||'UNKNOWN'):null;
     if(report.updateStatus!=='idle'&&device.updateConsumedAt===null)device.updateConsumedAt=now();
    }
    const clientType=clientTypes.has(device.clientType)?device.clientType:'electron';
    return {board:s.board?structuredClone(s.board):null,update:clientType==='electron'&&device.targetVersion&&clientVersion!==device.targetVersion?{targetVersion:device.targetVersion}:null};
   });
  },
  async list(identity){admin(identity);return run(s=>({version:s.board?.version||0,presentation:s.board?{playlist:structuredClone(s.board.playlist),notice:s.board.notice}:null,devices:Object.values(s.devices).map(({id,name,clientType,createdAt,lastSeenAt,revokedAt,receivedVersion,clientVersion,targetVersion,updateStatus,updateError,updateApprovedAt,updateConsumedAt,updateCompletedAt})=>({id,name,clientType:clientTypes.has(clientType)?clientType:'electron',createdAt,lastSeenAt,revokedAt,receivedVersion:Number.isSafeInteger(receivedVersion)?receivedVersion:null,clientVersion:clientVersion||null,targetVersion:targetVersion||null,updateStatus:updateStatus||'idle',updateError:updateError||null,updateApprovedAt:updateApprovedAt||null,updateConsumedAt:updateConsumedAt||null,updateCompletedAt:updateCompletedAt||null}))}));}
 };
}
