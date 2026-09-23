'use strict';
const messages={INVALID_INPUT:'입력한 TV 등록 정보를 확인해 주세요.',AUTH_REQUIRED:'다시 로그인해 주세요.',FORBIDDEN:'TV 승인 권한이 없습니다.',INVALID_CODE:'등록 코드가 만료되었거나 이미 사용되었습니다.',RATE_LIMITED:'요청이 많습니다. 잠시 후 다시 시도해 주세요.',WALLBOARD_UNAVAILABLE:'TV 원격 연결 서버가 아직 준비되지 않았습니다.',NOT_FOUND:'등록된 TV를 찾지 못했습니다.'};
messages.VERSION_CONFLICT='다른 관리자가 먼저 게시했습니다. 목록을 새로고침하고 내용을 다시 확인해 주세요.';
const fail=code=>{throw Object.assign(new Error(messages[code]||'TV 연결 요청에 실패했습니다. 다시 확인해 주세요.'),{code});};
const presentationKeys=new Set(['roadmap','portfolio','weeklyTrend','health','milestones','scheduleToday','scheduleWeek','people','issues','notice']);
function validatedPresentation(value){
 if(value===null||value===undefined)return null;
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['playlist','notice'].includes(key)))fail('WALLBOARD_UNAVAILABLE');
 if(typeof value.notice!=='string'||value.notice.length>160||!Array.isArray(value.playlist)||value.playlist.length>10)fail('WALLBOARD_UNAVAILABLE');
 const seen=new Set(),playlist=value.playlist.map(item=>{
  if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(key=>!['key','enabled','seconds'].includes(key))||!presentationKeys.has(item.key)||seen.has(item.key)||typeof item.enabled!=='boolean'||!Number.isInteger(item.seconds)||item.seconds<10||item.seconds>120)fail('WALLBOARD_UNAVAILABLE');
  seen.add(item.key);return {key:item.key,enabled:item.enabled,seconds:item.seconds};
 });
 return {playlist,notice:value.notice};
}
async function requestWallboardAdmin({baseUrl,idToken,input,fetchImpl=globalThis.fetch}){
 const action=input?.action;if(!['list','approve','revoke','publish','schedule-update','cancel-update'].includes(action))fail('INVALID_INPUT');
 if(!idToken)fail('AUTH_REQUIRED');const url=new URL(baseUrl);if(url.protocol!=='https:'||url.username||url.password)fail('INVALID_INPUT');
 const body={};
 if(action==='publish'){if(!input.snapshot||typeof input.snapshot!=='object'||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0)fail('INVALID_INPUT');body.snapshot=input.snapshot;body.expectedVersion=input.expectedVersion;if(Buffer.byteLength(JSON.stringify(body),'utf8')>65536)fail('INVALID_INPUT');}
 if(action==='approve'){if(!/^[A-F0-9]{8}$/.test(input.code)||typeof input.name!=='string'||!input.name.trim()||input.name.length>60)fail('INVALID_INPUT');body.code=input.code;body.name=input.name.trim();}
 if(['revoke','schedule-update','cancel-update'].includes(action)){if(typeof input.deviceId!=='string'||!/^[a-f0-9-]{36}$/.test(input.deviceId))fail('INVALID_INPUT');body.deviceId=input.deviceId;}
 if(action==='schedule-update'){if(typeof input.targetVersion!=='string'||!/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(input.targetVersion))fail('INVALID_INPUT');body.targetVersion=input.targetVersion;}
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 try{
  const response=await fetchImpl(new URL('/v1/wallboard/'+action,url).href,{method:'POST',redirect:'error',headers:{authorization:'Bearer '+idToken,'content-type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
  const data=await response.json();if(!response.ok||data.ok!==true)fail(data.code||'WALLBOARD_UNAVAILABLE');
  if(action==='list'){
   if(!Array.isArray(data.devices)||data.devices.length>1000)fail('WALLBOARD_UNAVAILABLE');
   if(!Number.isSafeInteger(data.version)||data.version<0)fail('WALLBOARD_UNAVAILABLE');
   const semver=value=>typeof value==='string'&&/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(value)?value:null;
   const timestamp=value=>Number.isFinite(Number(value))&&Number(value)>0?Number(value):null;
   const statuses=new Set(['idle','scheduled','cancelled','downloading','ready','installing','installed','failed']);
   return {ok:true,version:data.version,presentation:validatedPresentation(data.presentation),devices:data.devices.map(d=>({id:String(d.id||''),name:String(d.name||'').slice(0,60),clientType:d.clientType==='web'?'web':'electron',createdAt:Number(d.createdAt)||0,lastSeenAt:timestamp(d.lastSeenAt),revokedAt:timestamp(d.revokedAt),receivedVersion:Number.isSafeInteger(d.receivedVersion)&&d.receivedVersion>=0?d.receivedVersion:null,clientVersion:semver(d.clientVersion),targetVersion:semver(d.targetVersion),updateStatus:statuses.has(d.updateStatus)?d.updateStatus:'idle',updateError:typeof d.updateError==='string'&&/^[A-Z0-9_]{1,60}$/.test(d.updateError)?d.updateError:null,updateApprovedAt:timestamp(d.updateApprovedAt),updateConsumedAt:timestamp(d.updateConsumedAt),updateCompletedAt:timestamp(d.updateCompletedAt)}))};
  }
  if(action==='publish'){if(data.version!==input.expectedVersion+1||!Number.isFinite(data.publishedAt))fail('WALLBOARD_UNAVAILABLE');return {ok:true,version:data.version,publishedAt:data.publishedAt};}
  if(action==='schedule-update'){if(data.status!=='scheduled'||data.targetVersion!==input.targetVersion)fail('WALLBOARD_UNAVAILABLE');return {ok:true,status:data.status,targetVersion:data.targetVersion};}
  if(action==='cancel-update'){if(data.status!=='cancelled')fail('WALLBOARD_UNAVAILABLE');return {ok:true,status:data.status};}
  if(data.status!==(action==='approve'?'approved':'revoked'))fail('WALLBOARD_UNAVAILABLE');
  return {ok:true,status:data.status};
 }catch(error){if(error.code&&messages[error.code])throw error;fail('WALLBOARD_UNAVAILABLE');}finally{clearTimeout(timer);}
}
module.exports={requestWallboardAdmin};
