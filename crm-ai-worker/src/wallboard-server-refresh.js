import wallboard from '../../desktop-crm/src/company-wallboard.js';
import {validatePublication} from './wallboard-publication.js';
import {exchangeWallboardReaderToken} from './wallboard-service-auth.js';

const MAX_SOURCE_BYTES=2*1024*1024;
const paths=['workOrders','projects','data/serviceRecords','access','teamProfiles'];
const defaultPlaylist=[['roadmap',40],['portfolio',25],['weeklyTrend',20],['health',20],['milestones',25],['scheduleToday',30],['scheduleWeek',30],['people',25],['issues',20],['notice',30]].map(([key,seconds])=>({key,enabled:true,seconds}));
const fail=code=>{throw Object.assign(new Error(code),{code});};
const contactPattern=/(?:0\d{1,2}[- .]?\d{3,4}[- .]?\d{4}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i;
const addressPattern=/(?:[가-힣A-Za-z0-9]+(?:대로|로|길)\s*\d{1,4}(?:-\d{1,4})?|[가-힣]+(?:동|읍|면|리)\s*\d{1,4}(?:-\d{1,4})?|\d{1,4}\s*(?:번지|호))/u;
const privateText=value=>contactPattern.test(String(value||''))||addressPattern.test(String(value||''));
function rows(value){
 if(value===null)return [];
 if(!value||typeof value!=='object'||Array.isArray(value))fail('WALLBOARD_UNAVAILABLE');
 return Object.entries(value).map(([id,item])=>{
  if(!item||typeof item!=='object'||Array.isArray(item))fail('WALLBOARD_UNAVAILABLE');
  return {...item,id};
 });
}
async function readSource(path,{env,idToken,fetchImpl,readTimeoutMs}){
 const root=String(env.WALLBOARD_FIREBASE_DATABASE_URL||'').replace(/\/$/,'');
 if(!/^https:\/\/[a-z0-9.-]+\.firebasedatabase\.app$/i.test(root))fail('WALLBOARD_UNAVAILABLE');
 const url=new URL(`${root}/crmCompany/${path}.json`);
 url.searchParams.set('auth',idToken);
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),readTimeoutMs);
 try{
 const response=await fetchImpl(url.toString(),{method:'GET',cache:'no-store',redirect:'manual',headers:{accept:'application/json'},signal:controller.signal});
 if(response.status===401||response.status===403)fail('FORBIDDEN');
 if(!response.ok)fail('WALLBOARD_UNAVAILABLE');
 const contentLength=Number(response.headers.get('content-length'));
 if(Number.isFinite(contentLength)&&contentLength>MAX_SOURCE_BYTES)fail('WALLBOARD_UNAVAILABLE');
 const reader=response.body?.getReader();
 if(!reader)fail('WALLBOARD_UNAVAILABLE');
 let length=0;const chunks=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>MAX_SOURCE_BYTES){await reader.cancel();fail('WALLBOARD_UNAVAILABLE');}chunks.push(value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{const value=JSON.parse(new TextDecoder().decode(bytes));if(value!==null&&(!value||typeof value!=='object'||Array.isArray(value)))fail('WALLBOARD_UNAVAILABLE');return value;}
 catch{fail('WALLBOARD_UNAVAILABLE');}
 }catch(error){if(error?.code)throw error;fail('WALLBOARD_UNAVAILABLE');}
 finally{clearTimeout(timeout);}
}
async function command(stub,action,input={}){
 const response=await stub.fetch(new Request('https://wallboard-internal/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,input,identity:{uid:'server-refresh',isAdmin:true},token:''})}));
 const result=await response.json();
 if(!response.ok||!result.ok)fail(['VERSION_CONFLICT','STALE_REFRESH'].includes(result.code)?result.code:'WALLBOARD_UNAVAILABLE');
 return result;
}
async function rebuildWallboard({idToken,identity,serviceReader=false,env,fetchImpl=fetch,now=Date.now,readTimeoutMs=8000}){
 if(!idToken||!env?.WALLBOARD_DEVICES)fail('FORBIDDEN');
 const timeout=Number.isInteger(readTimeoutMs)&&readTimeoutMs>=1&&readTimeoutMs<=15000?readTimeoutMs:8000;
 const access=await readSource('access',{env,idToken,fetchImpl,readTimeoutMs:timeout});
 if(!serviceReader){
  const requester=access?.[identity.uid];
  if(requester?.enabled!==true||requester.mustChangePassword===true||String(requester.email||'').trim().toLowerCase()!==String(identity.email||'').trim().toLowerCase())fail('FORBIDDEN');
 }
 const stub=env.WALLBOARD_DEVICES.get(env.WALLBOARD_DEVICES.idFromName('bring-company-wallboard'));
 const {refreshToken}=await command(stub,'begin-refresh');
 const remainingPaths=paths.filter(path=>path!=='access');
 const values=await Promise.all(remainingPaths.map(path=>readSource(path,{env,idToken,fetchImpl,readTimeoutMs:timeout})));
 const source={access,...Object.fromEntries(remainingPaths.map((path,index)=>[path,values[index]]))};
 const members=rows(source.access).filter(user=>user.enabled===true&&user.mustChangePassword!==true).map(user=>({uid:user.id,displayName:String(source.teamProfiles?.[user.id]?.displayName||user.displayName||'')}));
 const orders=rows(source.workOrders);
 const memberNames=new Map(members.map(member=>[member.uid,member.displayName]));
 const safeNames=new Set(members.map(member=>member.displayName).filter(name=>/^[\p{L} .·-]{2,40}$/u.test(name)));
 const safeName=(name)=>safeNames.has(String(name||''))?String(name):'담당자 미정';
 const namedOrders=orders.map(order=>({...order,assigneeName:safeName(memberNames.get(order.assigneeUid)||order.assigneeName)}));
 const namedProjects=rows(source.projects).map(item=>({...item,name:privateText(item.name)?'프로젝트명 확인 필요':item.name,owner:safeName(item.owner)}));
 const dateParts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now())).map(part=>[part.type,part.value]));
 const dataDate=`${dateParts.year}-${dateParts.month}-${dateParts.day}`;
 const model=wallboard.project({orders:namedOrders,projects:namedProjects,members,calendar:{serviceRecords:rows(source['data/serviceRecords'])}},dataDate);
 for(let attempt=0;attempt<2;attempt++){
  const current=await command(stub,'list');
  const priorNotice=current.presentation?.notice||'';
  const snapshot=validatePublication({model,playlist:current.presentation?.playlist||defaultPlaylist,notice:privateText(priorNotice)?'공지 내용 확인 필요':priorNotice,dataDate});
  if(new TextEncoder().encode(JSON.stringify(snapshot)).byteLength>65536)fail('WALLBOARD_UNAVAILABLE');
  try{const result=await command(stub,'publish-if-changed',{snapshot,expectedVersion:current.version,refreshToken});return {version:result.version,publishedAt:result.publishedAt};}
  catch(error){if(error.code!=='VERSION_CONFLICT'||attempt===1)throw error;}
 }
 fail('WALLBOARD_UNAVAILABLE');
}

export async function refreshWallboardFromFirebase(options){
 if(!options?.identity?.uid||!options.identity.emailVerified)fail('FORBIDDEN');
 return rebuildWallboard(options);
}

export async function refreshWallboardFromService({env,fetchImpl=fetch,now=Date.now,readTimeoutMs=8000}){
 if(!env?.WALLBOARD_DEVICES)fail('WALLBOARD_UNAVAILABLE');
 const idToken=await exchangeWallboardReaderToken({env,fetchImpl});
 return rebuildWallboard({idToken,serviceReader:true,env,fetchImpl,now,readTimeoutMs});
}
