import { calendarConfigured, calendarStatus, canManageCalendar } from './state.js';
import { syncWindow } from './sync.js';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
const stub=env=>env.CALENDAR_STATE.get(env.CALENDAR_STATE.idFromName('company-calendar-v1'));
export async function calendarPublic(request,env) {
  const url=new URL(request.url),callback=url.pathname==='/v1/calendar/oauth/callback';
  if(request.method!==(callback?'GET':'POST'))return json({ok:false,code:'METHOD_NOT_ALLOWED'},405);
  if(!calendarConfigured(env))return json({ok:false,code:'CALENDAR_UNCONFIGURED'},503);
  if(callback && url.origin!==env.GOOGLE_CALENDAR_PUBLIC_ORIGIN)return json({ok:false,code:'FORBIDDEN'},403);
  if(url.search.length>4096)return json({ok:false,code:'CALENDAR_INVALID_INPUT'},400);
  return stub(env).fetch(new Request('https://calendar.internal/'+(callback?'callback'+url.search:'webhook'),{method:request.method,headers:callback?{}:request.headers}));
}
export async function calendarAction(request,identity,env) {
  let input;try{if(Number(request.headers.get('content-length'))>8192)throw Error();const text=await request.text();if(new TextEncoder().encode(text).length>8192)throw Error();input=JSON.parse(text);}catch{return json({ok:false,code:'CALENDAR_INVALID_INPUT'},400);}
  if(!input || Array.isArray(input) || typeof input!=='object' || !['status','events','connect','calendars','select','sync','disconnect'].includes(input.action))return json({ok:false,code:'CALENDAR_INVALID_INPUT'},400);
  const keys=input.action==='select'?['action','calendarIds','shareConfirmed']:input.action==='events'?['action','month']:['action'];
  if(Object.keys(input).some(k=>!keys.includes(k)))return json({ok:false,code:'CALENDAR_INVALID_INPUT'},400);
  const canManage=canManageCalendar(identity,env);
  if(!['status','events'].includes(input.action) && !canManage)return json({ok:false,code:'FORBIDDEN'},403);
  if(!calendarConfigured(env)){
    if(input.action==='status')return json(calendarStatus({},false,canManage));
    if(input.action==='events')return json({ok:true,events:[],status:'unconfigured',lastSyncedAt:null,window:syncWindow()});
    return json({ok:false,code:'CALENDAR_UNCONFIGURED'},503);
  }
  return stub(env).fetch(new Request('https://calendar.internal/action',{method:'POST',body:JSON.stringify({input,identity})}));
}
