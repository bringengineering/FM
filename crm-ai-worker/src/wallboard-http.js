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

const webHeaders={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const sessionCookie=value=>`bring_tv_session=${value}; HttpOnly; Secure; SameSite=Strict; Path=/tv; Max-Age=31536000`;
const clearSessionCookie='bring_tv_session=; HttpOnly; Secure; SameSite=Strict; Path=/tv; Max-Age=0';
function webReply(value,statusCode=200,headers={}){return new Response(JSON.stringify(value),{status:statusCode,headers:{...webHeaders,...headers}});}
function cookieValue(request,name){
 for(const part of String(request.headers.get('cookie')||'').split(';')){const [key,...rest]=part.trim().split('=');if(key===name)return rest.join('=');}
 return '';
}
async function webRateLimit(request,env){
 const rate=await env.WALLBOARD_RATE_LIMITER.limit({key:'wallboard-web:'+String(request.headers.get('cf-connecting-ip')||'unknown')});
 return rate?.success===true;
}
async function webCommand(env,action,input={},token=''){
 const stub=env.WALLBOARD_DEVICES.get(env.WALLBOARD_DEVICES.idFromName('bring-company-wallboard'));
 return stub.fetch(new Request('https://wallboard-internal/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,input,identity:null,token})}));
}
export async function wallboardWebRequest(request,env){
 const url=new URL(request.url),path=url.pathname;
 if(!['/tv/api/pair/start','/tv/api/pair/poll','/tv/api/display'].includes(path))return webReply({ok:false,code:'NOT_FOUND'},404);
 if(env.WALLBOARD_ENABLED!=='true'||!env.WALLBOARD_DEVICES||!env.WALLBOARD_RATE_LIMITER)return webReply({ok:false,code:'WALLBOARD_UNAVAILABLE'},503);
 const origin=request.headers.get('origin');
 if(origin&&origin!==url.origin)return webReply({ok:false,code:'FORBIDDEN'},403);
 try{
  if(path==='/tv/api/display'){
   if(request.method!=='GET')return webReply({ok:false,code:'METHOD_NOT_ALLOWED'},405);
   const token=cookieValue(request,'bring_tv_session');
   if(!/^[a-f0-9]{64}$/.test(token))return webReply({ok:false,code:'AUTH_REQUIRED'},401,{'set-cookie':clearSessionCookie});
   const response=await webCommand(env,'display',{},token),data=await response.json();
   if(!response.ok)return webReply(data,response.status,response.status===401?{'set-cookie':clearSessionCookie}:{});
   return webReply(data);
  }
  if(request.method!=='POST')return webReply({ok:false,code:'METHOD_NOT_ALLOWED'},405);
  if(!await webRateLimit(request,env))return webReply({ok:false,code:'RATE_LIMITED'},429);
  if(path==='/tv/api/pair/start'){
   const response=await webCommand(env,'start',{clientType:'web'}),data=await response.json();
   return webReply(data,response.status);
  }
  const input=await body(request,4096),pendingToken=String(input?.pendingToken||'');
  if(Object.keys(input||{}).some(key=>key!=='pendingToken')||!/^[a-f0-9]{64}$/.test(pendingToken))return webReply({ok:false,code:'INVALID_INPUT'},400);
  const response=await webCommand(env,'poll',{},pendingToken),data=await response.json();
  if(!response.ok)return webReply(data,response.status);
  if(data.status!=='approved')return webReply({ok:true,status:'pending'});
  if(!/^[a-f0-9]{64}$/.test(data.deviceToken))return webReply({ok:false,code:'WALLBOARD_UNAVAILABLE'},503);
  return webReply({ok:true,status:'approved',deviceId:data.deviceId},200,{'set-cookie':sessionCookie(data.deviceToken)});
 }catch(error){
  const code=Object.hasOwn(status,error?.code)?error.code:'WALLBOARD_UNAVAILABLE';
  return webReply({ok:false,code},status[code]||503);
 }
}
