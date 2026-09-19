const actions={start:[],poll:[],approve:['code','name'],revoke:['deviceId'],list:[],publish:['snapshot','expectedVersion'],'schedule-update':['deviceId','targetVersion'],'cancel-update':['deviceId'],display:['clientVersion','updateStatus','updateError']};
const status={AUTH_REQUIRED:401,FORBIDDEN:403,INVALID_INPUT:400,INPUT_TOO_LARGE:413,RATE_LIMITED:429};
const reply=(code,http,cors)=>Response.json({ok:false,code},{status:http,headers:{...cors,'cache-control':'no-store','x-content-type-options':'nosniff'}});
async function body(request,limit=4096){
 const reader=request.body?.getReader();if(!reader)return {};
 let length=0;const chunks=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit){await reader.cancel();throw Object.assign(new Error(),{code:'INPUT_TOO_LARGE'});}chunks.push(value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{return JSON.parse(new TextDecoder().decode(bytes)||'{}');}catch{throw Object.assign(new Error(),{code:'INVALID_INPUT'});}
}
export async function wallboardRequest(request,env,{verifyIdentity,cors={}}){
 const action=new URL(request.url).pathname.slice('/v1/wallboard/'.length);
 if(!Object.hasOwn(actions,action))return reply('NOT_FOUND',404,cors);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(request.method!=='POST')return reply('METHOD_NOT_ALLOWED',405,cors);
 if(env.WALLBOARD_ENABLED!=='true'||!env.WALLBOARD_DEVICES||!env.WALLBOARD_RATE_LIMITER)return reply('WALLBOARD_UNAVAILABLE',503,cors);
 try{
  const rate=await env.WALLBOARD_RATE_LIMITER.limit({key:'wallboard:'+String(request.headers.get('cf-connecting-ip')||'unknown')});
  if(!rate.success)return reply('RATE_LIMITED',429,cors);
  const input=await body(request,action==='publish'?65536:4096);
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!actions[action].includes(k)))return reply('INVALID_INPUT',400,cors);
  const token=/^Bearer\s+([^\s]+)$/i.exec(request.headers.get('authorization')||'')?.[1]||'';
  if(action==='display'&&input.clientVersion!==undefined&&(typeof input.clientVersion!=='string'||!/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(input.clientVersion)))return reply('INVALID_INPUT',400,cors);
  if(action==='display'&&input.updateStatus!==undefined&&!['idle','downloading','ready','installing','installed','failed'].includes(input.updateStatus))return reply('INVALID_INPUT',400,cors);
  if(action==='display'&&input.updateError!==undefined&&(typeof input.updateError!=='string'||!/^[A-Z0-9_]{1,80}$/.test(input.updateError)))return reply('INVALID_INPUT',400,cors);
  let identity=null;
  if(['approve','revoke','list','publish','schedule-update','cancel-update'].includes(action)){
   const verified=await verifyIdentity(token);
   const admins=new Set(String(env.CRM_ADMIN_EMAILS||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean));
   if(!verified?.emailVerified||!admins.has(verified.email))return reply('FORBIDDEN',403,cors);
   identity={uid:verified.uid,isAdmin:true};
  }
  if(action==='approve'&&(!/^[A-F0-9]{8}$/.test(input.code)||typeof input.name!=='string'||!input.name.trim()||input.name.length>60))return reply('INVALID_INPUT',400,cors);
  if(action==='revoke'&&(typeof input.deviceId!=='string'||!/^[a-f0-9-]{36}$/.test(input.deviceId)))return reply('INVALID_INPUT',400,cors);
  if(['schedule-update','cancel-update'].includes(action)&&(typeof input.deviceId!=='string'||!/^[a-f0-9-]{36}$/.test(input.deviceId)))return reply('INVALID_INPUT',400,cors);
  if(action==='schedule-update'&&(typeof input.targetVersion!=='string'||!/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(input.targetVersion)))return reply('INVALID_INPUT',400,cors);
  if(['poll','display'].includes(action)&&!/^[a-f0-9]{64}$/.test(token))return reply('AUTH_REQUIRED',401,cors);
  const stub=env.WALLBOARD_DEVICES.get(env.WALLBOARD_DEVICES.idFromName('bring-company-wallboard'));
  const response=await stub.fetch(new Request('https://wallboard-internal/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,input,identity,token:['poll','display'].includes(action)?token:''})}));
  return new Response(response.body,{status:response.status,headers:{...cors,'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
 }catch(error){const code=Object.hasOwn(status,error?.code)?error.code:'WALLBOARD_UNAVAILABLE';return reply(code,status[code]||503,cors);}
}
