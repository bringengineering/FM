import { fail, googleFetch, googleJson, syncCalendar, syncWindow } from './sync.js';
const SCOPES = ['openid','email','https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events.readonly'];
const b64 = bytes => btoa(String.fromCharCode(...bytes));
const unb64 = value => Uint8Array.from(atob(value), c=>c.charCodeAt(0));
const random = () => b64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
const response = (v,status=200) => new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
export function calendarConfigured(env) {
  try { const u=new URL(env.GOOGLE_CALENDAR_PUBLIC_ORIGIN);return env.CALENDAR_ENABLED==='true' && Boolean(env.CALENDAR_STATE && env.GOOGLE_CALENDAR_CLIENT_ID && env.GOOGLE_CALENDAR_CLIENT_SECRET && env.GOOGLE_CALENDAR_COMPANY_EMAIL) && u.protocol==='https:' && u.origin===env.GOOGLE_CALENDAR_PUBLIC_ORIGIN && !u.username && !u.password && unb64(env.CALENDAR_ENCRYPTION_KEY).length===32; } catch { return false; }
}
export function canManageCalendar(identity,env) { return identity?.emailVerified===true && String(env.CRM_ADMIN_EMAILS||'').split(',').map(s=>s.trim().toLowerCase()).includes(identity.email); }
export function calendarStatus(state,configured,canManage,now=Date.now()) {
  return {ok:true,status:!configured?'unconfigured':!state?.refresh?'disconnected':state.errorCode==='CALENDAR_RECONNECT'?'reconnect':state.errorCode || (state.lastSyncedAt && now-Date.parse(state.lastSyncedAt)>900000)?'stale':!state.selected?.length?'awaiting_selection':'connected',accountEmail:state?.accountEmail||null,selectedCalendars:state?.selected||[],lastSyncedAt:state?.lastSyncedAt||null,errorCode:state?.errorCode||null,canManage};
}
export class CompanyCalendarState {
  constructor(ctx,env,options={}) { this.storage=ctx.storage;this.env=env;this.fetchImpl=options.fetchImpl||globalThis.fetch;this.now=options.now||Date.now;this.queue=Promise.resolve(); }
  serialize(task) { const next=this.queue.then(task,task);this.queue=next.catch(()=>{});return next; }
  async load() {
    const meta=await this.storage.get('calendar');if(!meta)return {};
    const parts=await Promise.all(Array.from({length:meta.parts},(_,i)=>this.storage.get(`calendar:${i}`)));
    return JSON.parse(parts.join(''));
  }
  async save(state) {
    // Atomic shards stay below Durable Object KV's per-value limit, including UTF-8 expansion.
    const raw=JSON.stringify(state),parts=Math.ceil(raw.length/16000),old=await this.storage.get('calendar');
    await this.storage.transaction(async tx=>{for(let i=0;i<parts;i++)await tx.put(`calendar:${i}`,raw.slice(i*16000,(i+1)*16000));for(let i=parts;i<(old?.parts||0);i++)await tx.delete(`calendar:${i}`);await tx.put('calendar',{parts});});
  }
  async crypt(value,decrypt=false) {
    const key=await crypto.subtle.importKey('raw',unb64(this.env.CALENDAR_ENCRYPTION_KEY),'AES-GCM',false,['encrypt','decrypt']);
    if(decrypt) return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(value.iv),additionalData:new TextEncoder().encode('company-calendar-v1')},key,unb64(value.data)));
    const iv=crypto.getRandomValues(new Uint8Array(12));return {iv:b64(iv),data:b64(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('company-calendar-v1')},key,new TextEncoder().encode(value))))};
  }
  async token(params) { return googleJson(this.fetchImpl,'https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:this.env.GOOGLE_CALENDAR_CLIENT_ID,client_secret:this.env.GOOGLE_CALENDAR_CLIENT_SECRET,...params})}); }
  async access(state) {
    if(!state.refresh)throw fail('CALENDAR_DISCONNECTED');
    const token=await this.token({grant_type:'refresh_token',refresh_token:await this.crypt(state.refresh,true)});
    if(!token.access_token)throw fail('CALENDAR_RECONNECT');return token.access_token;
  }
  async calendars(accessToken) {
    const items=[];let pageToken='';
    for(let page=0;page<50;page++) {
      const url=new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList');url.searchParams.set('maxResults','250');if(pageToken)url.searchParams.set('pageToken',pageToken);
      const data=await googleJson(this.fetchImpl,url,{headers:{authorization:`Bearer ${accessToken}`}});
      if(!Array.isArray(data.items))throw fail('CALENDAR_INVALID_RESPONSE');
      for(const c of data.items)if(c.id && !c.deleted && c.accessRole!=='freeBusyReader')items.push({id:String(c.id),name:String(c.summaryOverride||c.summary||c.id).slice(0,300)});
      if(items.length>10000)throw fail('CALENDAR_LIMIT_EXCEEDED');pageToken=data.nextPageToken;if(!pageToken)return items;
    } throw fail('CALENDAR_LIMIT_EXCEEDED');
  }
  async reconcile(state,selected=state.selected||[],accessToken=null) {
    const token=accessToken||await this.access(state),caches={};
    let retained=0,bytes=0;
    for(const c of selected){
      const cache=await syncCalendar({calendarId:c.id,previous:state.caches?.[c.id],accessToken:token,fetchImpl:this.fetchImpl,now:this.now()});
      retained+=cache.events.length;bytes+=new TextEncoder().encode(JSON.stringify(cache)).length;
      if(retained>10000 || bytes>16000000)throw fail('CALENDAR_LIMIT_EXCEEDED');
      caches[c.id]=cache;
    }
    const next={...state,selected,caches,lastSyncedAt:new Date(this.now()).toISOString(),errorCode:null};
    await this.save(next);await this.storage.setAlarm(this.now()+300000);
    await this.watches(next,token);return next;
  }
  async stop(watch,token) { try {await googleFetch(this.fetchImpl,'https://www.googleapis.com/calendar/v3/channels/stop',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({id:watch.id,resourceId:watch.resourceId})});}catch{} }
  async watches(state,token) {
    const watches=[];
    for(const c of state.selected||[]) {
      const old=(state.watches||[]).find(w=>w.calendarId===c.id);
      if(old && old.expiration>this.now()+3600000){watches.push(old);continue;}
      try {
        const id=crypto.randomUUID(),secret=random();const data=await googleJson(this.fetchImpl,`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.id)}/events/watch`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({id,type:'web_hook',address:this.env.GOOGLE_CALENDAR_PUBLIC_ORIGIN+'/v1/calendar/webhook',token:secret,expiration:String(this.now()+604800000)})});
        if(data.id!==id || !data.resourceId || !(Number(data.expiration)>this.now()))throw fail('CALENDAR_INVALID_RESPONSE');
        watches.push({calendarId:c.id,id,token:secret,resourceId:data.resourceId,expiration:Number(data.expiration)});
      }catch{if(old)watches.push(old);}
    }
    const old=state.watches||[];state.watches=watches;await this.save(state);
    for(const w of old)if(!watches.some(v=>v.id===w.id))await this.stop(w,token);
  }
  async fetch(request) { return this.serialize(async()=>{try{return await this.handle(request);}catch(e){const code=String(e.code||'CALENDAR_TEMPORARY_FAILURE');return response({ok:false,code},code==='FORBIDDEN'?403:code==='CALENDAR_TEMPORARY_FAILURE'?503:400);}}); }
  async handle(request) {
    const url=new URL(request.url),configured=calendarConfigured(this.env);
    if(!configured)return response({ok:false,code:'CALENDAR_UNCONFIGURED'},503);
    let state=await this.load();
    if(url.pathname==='/callback' && request.method==='GET') {
      const pending=await this.storage.get('oauth');
      if(!pending || !url.searchParams.get('state') || url.searchParams.get('state')!==pending.state)throw fail('CALENDAR_OAUTH_STATE');
      await this.storage.delete('oauth');
      if(pending.expiresAt<this.now() || !url.searchParams.get('code') || url.searchParams.has('error'))throw fail('CALENDAR_OAUTH_STATE');
      const token=await this.token({grant_type:'authorization_code',code:url.searchParams.get('code'),redirect_uri:this.env.GOOGLE_CALENDAR_PUBLIC_ORIGIN+'/v1/calendar/oauth/callback',code_verifier:pending.verifier});
      const granted=new Set(String(token.scope||'').split(' ').map(s=>s==='https://www.googleapis.com/auth/userinfo.email'?'email':s));
      if(!token.refresh_token || !token.access_token || !SCOPES.every(s=>granted.has(s)) || [...granted].some(s=>!SCOPES.includes(s) && !['https://www.googleapis.com/auth/userinfo.email','https://www.googleapis.com/auth/userinfo.profile'].includes(s)))throw fail('CALENDAR_OAUTH_SCOPE');
      const user=await googleJson(this.fetchImpl,'https://openidconnect.googleapis.com/v1/userinfo',{headers:{authorization:`Bearer ${token.access_token}`}});
      if(user.email_verified!==true || String(user.email||'').toLowerCase()!==this.env.GOOGLE_CALENDAR_COMPANY_EMAIL.trim().toLowerCase())throw fail('CALENDAR_ACCOUNT_MISMATCH');
      const replacement={refresh:await this.crypt(token.refresh_token),accountEmail:user.email.toLowerCase(),selected:[],caches:{},watches:[]};
      await this.save(replacement);await this.storage.setAlarm(this.now()+300000);
      for(const w of state.watches||[])await this.stop(w,token.access_token);
      return response({ok:true,message:'Google Calendar connected. Return to CRM to select and confirm shared calendars.'});
    }
    if(url.pathname==='/webhook' && request.method==='POST') {
      const h=request.headers;
      const watch=(state.watches||[]).find(w=>w.id===h.get('x-goog-channel-id') && w.resourceId===h.get('x-goog-resource-id') && w.token===h.get('x-goog-channel-token') && w.expiration>this.now());
      if(!watch || !['sync','exists','not_exists'].includes(h.get('x-goog-resource-state')))throw fail('FORBIDDEN');
      // Notifications are hints only: never accept event data from their body.
      await this.storage.setAlarm(this.now()+1000);return response({ok:true});
    }
    if(url.pathname!=='/action' || request.method!=='POST')return response({ok:false,code:'NOT_FOUND'},404);
    const {input,identity}=await request.json(),canManage=canManageCalendar(identity,this.env),action=input?.action;
    if(!['status','events','connect','calendars','select','sync','disconnect'].includes(action))throw fail('CALENDAR_INVALID_INPUT');
    if(!['status','events'].includes(action) && !canManage)throw fail('FORBIDDEN');
    if(action==='status')return response(calendarStatus(state,true,canManage,this.now()));
    if(action==='events') {
      if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month||''))throw fail('CALENDAR_INVALID_INPUT');
      // UTC cushion permits the desktop's local-month filtering at timezone boundaries.
      const start=Date.parse(input.month+'-01T00:00:00Z')-86400000,endDate=new Date(input.month+'-01T00:00:00Z');endDate.setUTCMonth(endDate.getUTCMonth()+1);const end=endDate.getTime()+86400000;
      const events=Object.values(state.caches||{}).flatMap(c=>c.events).filter(e=>Date.parse(e.end)>start && Date.parse(e.start)<end);
      return response({ok:true,events,lastSyncedAt:state.lastSyncedAt||null,status:calendarStatus(state,true,canManage,this.now()).status,window:Object.values(state.caches||{})[0]?.window||syncWindow(this.now())});
    }
    if(action==='connect') {
      const nonce=random(),verifier=random(),digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
      await this.storage.put('oauth',{state:nonce,verifier,expiresAt:this.now()+600000});
      const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');Object.entries({client_id:this.env.GOOGLE_CALENDAR_CLIENT_ID,redirect_uri:this.env.GOOGLE_CALENDAR_PUBLIC_ORIGIN+'/v1/calendar/oauth/callback',response_type:'code',scope:SCOPES.join(' '),access_type:'offline',prompt:'consent',state:nonce,code_challenge:b64(digest).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,''),code_challenge_method:'S256',login_hint:this.env.GOOGLE_CALENDAR_COMPANY_EMAIL}).forEach(([k,v])=>url.searchParams.set(k,v));return response({ok:true,authorizationUrl:url.toString()});
    }
    if(action==='disconnect') {
      await this.save({});await this.storage.delete('oauth');await this.storage.deleteAlarm();
      try{const token=await this.access(state);for(const w of state.watches||[])await this.stop(w,token);}catch{}
      try{if(state.refresh)await googleFetch(this.fetchImpl,'https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:await this.crypt(state.refresh,true)})});}catch{}
      return response(calendarStatus({},true,canManage,this.now()));
    }
    try {
      if(action==='calendars')return response({ok:true,calendars:await this.calendars(await this.access(state))});
      if(action==='select') {
        if(input.shareConfirmed!==true)throw fail('CALENDAR_SHARE_CONFIRMATION_REQUIRED');
        if(!Array.isArray(input.calendarIds) || !input.calendarIds.length || input.calendarIds.length>5 || new Set(input.calendarIds).size!==input.calendarIds.length || input.calendarIds.some(id=>typeof id!=='string' || !id || id.length>1024))throw fail('CALENDAR_INVALID_INPUT');
        const token=await this.access(state),available=await this.calendars(token);
        const selected=input.calendarIds.map(id=>available.find(c=>c.id===id));if(selected.some(c=>!c))throw fail('CALENDAR_INVALID_INPUT');
        state=await this.reconcile(state,selected,token);
      }else state=await this.reconcile(state);
      return response(calendarStatus(state,true,canManage,this.now()));
    }catch(e){if(['CALENDAR_RECONNECT','CALENDAR_TEMPORARY_FAILURE','CALENDAR_LIMIT_EXCEEDED','CALENDAR_INVALID_RESPONSE'].includes(e.code)){state.errorCode=e.code;await this.save(state);await this.storage.setAlarm(this.now()+300000);}throw e;}
  }
  async alarm() { return this.serialize(async()=>{if(!calendarConfigured(this.env))return;const state=await this.load();if(!state.refresh)return;try{if(state.selected?.length)await this.reconcile(state);}catch(e){state.errorCode=e.code||'CALENDAR_TEMPORARY_FAILURE';await this.save(state);}finally{await this.storage.setAlarm(this.now()+300000);}}); }
}
