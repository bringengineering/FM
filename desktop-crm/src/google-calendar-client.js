'use strict';
const messages = {
  AUTH_REQUIRED: '다시 로그인해 주세요.', FORBIDDEN: '캘린더 연결을 관리할 권한이 없습니다.',
  CALENDAR_UNCONFIGURED: '회사 Google 캘린더 연결 설정이 필요합니다.',
  CALENDAR_RECONNECT: 'Google 캘린더 읽기 권한을 다시 승인해 주세요.',
  CALENDAR_INVALID_INPUT: '캘린더 선택과 입력 내용을 확인해 주세요.',
  CALENDAR_TEMPORARY_FAILURE: 'Google 캘린더를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
};
function failure(code) {
  const safe = Object.hasOwn(messages, code) ? code : 'CALENDAR_TEMPORARY_FAILURE';
  return Object.assign(new Error(messages[safe]), {code:safe});
}
function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure('CALENDAR_INVALID_INPUT');
  const fields = {status:[],connect:[],calendars:[],select:['calendarIds','shareConfirmed'],sync:[],events:['month'],disconnect:[]};
  if (typeof input.action!=='string' || !Object.hasOwn(fields,input.action) || Object.keys(input).some(k=>!['action',...fields[input.action]].includes(k))) throw failure('CALENDAR_INVALID_INPUT');
  if (input.action==='events' && (typeof input.month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month))) throw failure('CALENDAR_INVALID_INPUT');
  if (input.action==='select') {
    if (input.shareConfirmed!==true || !Array.isArray(input.calendarIds) || input.calendarIds.length<1 || input.calendarIds.length>5 || input.calendarIds.some(id=>typeof id!=='string'||!id.trim()||id.length>1024) || new Set(input.calendarIds).size!==input.calendarIds.length) throw failure('CALENDAR_INVALID_INPUT');
  }
  return structuredClone(input);
}
function authorizationUrl(value) {
  let url; try {url=new URL(value);} catch {throw failure('CALENDAR_INVALID_INPUT');}
  if (url.protocol!=='https:' || url.hostname!=='accounts.google.com' || url.port || url.username || url.password || url.pathname!=='/o/oauth2/v2/auth' || url.searchParams.get('response_type')!=='code' || !url.searchParams.get('client_id') || !url.searchParams.get('state')) throw failure('CALENDAR_INVALID_INPUT');
  return url.href;
}
async function calendarRequest({endpoint,idToken,input,fetchImpl=globalThis.fetch,timeoutMs=20000}) {
  const payload=validateInput(input);
  const url=new URL(endpoint);
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/v1/calendar'||url.search||url.hash) throw failure('CALENDAR_INVALID_INPUT');
  if(!idToken) throw failure('AUTH_REQUIRED');
  const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),timeoutMs);
  try {
    const response=await fetchImpl(url.href,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${idToken}`},body:JSON.stringify(payload),signal:abort.signal,redirect:'error'});
    if(response.status===404 && payload.action==='status') return {ok:true,status:'unconfigured',selectedCalendars:[],canManage:false};
    let value;try{value=await response.json();}catch{throw failure('CALENDAR_TEMPORARY_FAILURE');}
    if(!response.ok||value?.ok!==true) throw failure(value?.code);
    return value;
  } catch(error) {throw failure(error?.code);} finally {clearTimeout(timer);}
}
module.exports={validateInput,calendarRequest,authorizationUrl,failure};
