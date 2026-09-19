// Repository must provide durable, serializable transactions. Never use eventual KV.
// Identity is trusted only after the HTTP boundary verifies the employee token.
const TTL=10*60*1000;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
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
  async begin(){
   const pendingToken=token(),digest=await hash(pendingToken);
   return run(s=>{
    if(Object.keys(s.pending).length>=20)return {error:'RATE_LIMITED'};
    let code;do{code=crypto.randomUUID().replaceAll('-','').slice(0,8).toUpperCase();}while(Object.values(s.pending).some(p=>p.code===code));
    const expiresAt=now()+TTL;s.pending[digest]={code,expiresAt,status:'pending'};
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
    s.devices[deviceHash]={id:deviceId,name:p.name,approvedBy:p.approvedBy,createdAt:now(),lastSeenAt:null,revokedAt:null};
    delete s.pending[digest];return {status:'approved',deviceId,deviceToken};
   });
  },
  async authenticate(deviceToken){
   if(typeof deviceToken!=='string'||!/^[a-f0-9]{64}$/.test(deviceToken))fail('INVALID_TOKEN');
   const digest=await hash(deviceToken);
   return run(s=>{const d=s.devices[digest];if(!d||d.revokedAt!==null)return {error:'INVALID_TOKEN'};d.lastSeenAt=now();return {id:d.id,name:d.name};});
  },
  async revoke(deviceId,identity){
   admin(identity);
   return run(s=>{const d=Object.values(s.devices).find(d=>d.id===deviceId);if(!d)return {error:'NOT_FOUND'};d.revokedAt=now();return {status:'revoked'};});
  },
  async list(identity){admin(identity);return run(s=>({devices:Object.values(s.devices).map(({id,name,createdAt,lastSeenAt,revokedAt})=>({id,name,createdAt,lastSeenAt,revokedAt}))}));}
 };
}
