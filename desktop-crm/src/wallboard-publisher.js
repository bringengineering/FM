'use strict';
const {project}=require('./company-wallboard');
const {validatePublication}=require('./wallboard-publication-schema');
const {projectApprovedStrategy,withStrategyScene}=require('./company-strategy-tv');
const {koreaDate}=require('./korea-date');
const {summarizeMonth}=require('./billing-ledger-core');
async function loadWallboardSource(client,asOf=new Date()){
 // Never call loadStore: it can resume pending mutations and merge local edits.
 const [work,records]=await Promise.all([client.loadWorkOrders(),client.dbRequest('crmShared/data/serviceRecords',{method:'GET'})]);
 if(records!==null&&(typeof records!=='object'||Array.isArray(records)))throw new Error('서버 일정 형식을 확인할 수 없습니다.');
 const year=koreaDate(asOf).slice(0,4);
 const approved=await client.dbRequest(`companyStrategyPublications/${year}`,{method:'GET'});
 let billingLedger=null,billingLedgerState;
 if(typeof client.loadBillingLedger==='function'){
  try{
   billingLedger=await client.loadBillingLedger();
   summarizeMonth(billingLedger,koreaDate(asOf).slice(0,7));
  }catch(_){billingLedger=null;billingLedgerState='unavailable';}
 }
 return {...work,calendar:{serviceRecords:Object.values(records||{})},strategy:projectApprovedStrategy(approved,work.members||[],year),billingLedger,...(billingLedgerState?{billingLedgerState}:{})};
}
function createWallboardPublisher({getIdentity,load,publish,now=()=>new Date(),setTimer=fn=>setInterval(fn,60000),clearTimer=clearInterval}){
 let active=false,busy=false,timer=null,generation=0,owner='',config=null,version=null,publishedAt=null,error='';
 const status=()=>({active,busy,version,publishedAt,error});
 function stop(){active=false;generation++;if(timer!==null)clearTimer(timer);timer=null;return status();}
 async function refresh(){
  if(!active||busy)return status();
  if(!owner||getIdentity()!==owner){stop();error='AUTH_REQUIRED';return status();}
  busy=true;const generationAtStart=generation;
  try{
   const instant=now();
   const data=await load(instant);
   if(!active||generationAtStart!==generation)return status();
   if(getIdentity()!==owner){stop();error='AUTH_REQUIRED';return status();}
   const dataDate=koreaDate(instant);
   const snapshot=validatePublication({model:project(data,dataDate),...config,dataDate});
   const result=await publish({action:'publish',snapshot,expectedVersion:version},owner);
   if(generationAtStart===generation){version=result.version;publishedAt=result.publishedAt;error='';}
  }catch(e){
   if(generationAtStart===generation){error=['VERSION_CONFLICT','AUTH_REQUIRED','FORBIDDEN'].includes(e?.code)?e.code:'SOURCE_OR_SERVER_UNAVAILABLE';if(['VERSION_CONFLICT','AUTH_REQUIRED','FORBIDDEN'].includes(error))stop();}
  }finally{busy=false;}
  return status();
 }
 async function start(input){
  if(busy)throw new Error('게시 처리 중입니다. 잠시 후 다시 시도해 주세요.');
  const identity=getIdentity();if(!identity)throw new Error('로그인이 필요합니다.');
  if(!Number.isSafeInteger(input?.expectedVersion)||input.expectedVersion<0)throw new Error('서버 버전을 먼저 확인해 주세요.');
  const checked=validatePublication({model:project({orders:[],calendar:{serviceRecords:[]}},'2026-01-01'),playlist:withStrategyScene(input.playlist),notice:input.notice,dataDate:'2026-01-01'});
  stop();owner=identity;config={playlist:checked.playlist,notice:checked.notice};version=input.expectedVersion;error='';active=true;timer=setTimer(()=>refresh());timer?.unref?.();
  await refresh();return status();
 }
 return {start,stop,status,refresh};
}
module.exports={createWallboardPublisher,loadWallboardSource};
