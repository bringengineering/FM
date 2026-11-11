(function attachCompanyStrategyCore(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.BringCompanyStrategyCore=api;
})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 const fail=error=>({ok:false,error});
 const value=(input,max)=>typeof input==='string'?input.trim().slice(0,max):null;
 const id=input=>typeof input==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(input)?input:'';
 const uid=input=>typeof input==='string'&&/^[A-Za-z0-9._-]{1,128}$/.test(input)?input:'';
 const number=input=>input===null||input===undefined||input===''?null:typeof input==='number'&&Number.isFinite(input)?input:NaN;
 const GOAL_PERIODS=new Set(['annual','H1','H2','Q1','Q2','Q3','Q4',...Array.from({length:12},(_,index)=>`M${String(index+1).padStart(2,'0')}`)]);
 const MILESTONE_STATUSES=new Set(['not_started','in_progress','done']);
 const MAX_GOALS=40;
 const MAX_DIRECTION_ITEMS=12;
 function validCalendarDate(input){
  if(typeof input!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(input))return false;
  const date=new Date(`${input}T00:00:00Z`);
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===input;
 }
 function validateDirectionItems(input,label){
  if(!Array.isArray(input)||input.length>MAX_DIRECTION_ITEMS)return fail(`${label} 항목 수를 확인해 주세요.`);
  const ids=new Set(),items=[];
  for(const item of input){
   const itemId=id(item?.id),title=value(item?.title,80),description=value(item?.description??'',240);
   if(!itemId||ids.has(itemId)||!title||String(item.title).length>80||description===null||String(item.description??'').length>240)return fail(`${label} 내용을 확인해 주세요.`);
   ids.add(itemId);items.push({id:itemId,title,description});
  }
  return {ok:true,items};
 }
 function periodBounds(period,year){
  if(!GOAL_PERIODS.has(period)||!Number.isInteger(Number(year))||Number(year)<2000||Number(year)>2099)return fail('기간을 확인해 주세요.');
  const y=Number(year),month=period.startsWith('M')?Number(period.slice(1)):period.startsWith('Q')?(Number(period.slice(1))-1)*3+1:0;
  if(period==='annual')return {start:`${y}-01-01`,end:`${y}-12-31`};
  if(period==='H1')return {start:`${y}-01-01`,end:`${y}-06-30`};
  if(period==='H2')return {start:`${y}-07-01`,end:`${y}-12-31`};
  const startMonth=month,endMonth=period.startsWith('Q')?month+2:month;
  const endDay=new Date(Date.UTC(y,endMonth,0)).getUTCDate();
  return {start:`${y}-${String(startMonth).padStart(2,'0')}-01`,end:`${y}-${String(endMonth).padStart(2,'0')}-${String(endDay).padStart(2,'0')}`};
 }
 function periodsForDate(input){
  if(typeof input!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(input)||!Number.isFinite(Date.parse(`${input}T00:00:00Z`))||new Date(`${input}T00:00:00Z`).toISOString().slice(0,10)!==input)return fail('날짜를 확인해 주세요.');
  const [year,month]=input.split('-').map(Number),half=month<=6?'H1':'H2';
  return {month:`M${String(month).padStart(2,'0')}`,quarter:`Q${Math.ceil(month/3)}`,half,annual:'annual'};
 }
 function periodLabel(period){if(period==='annual')return '연간';if(period==='H1')return '상반기';if(period==='H2')return '하반기';if(/^Q[1-4]$/.test(period))return `${period.slice(1)}분기`;if(/^M(0[1-9]|1[0-2])$/.test(period))return `${Number(period.slice(1))}월`;return '';}
 function validateDraft(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.year!=='string'||!/^20[0-9]{2}$/.test(input.year))return fail('연도를 확인해 주세요.');
  const vision=value(input.vision,500);
  if(vision===null||String(input.vision).length>500)return fail('비전은 500자 이내로 입력해 주세요.');
  if(!Array.isArray(input.organization)||input.organization.length>30||!Array.isArray(input.goals)||input.goals.length>MAX_GOALS)return fail('조직·목표 항목 수를 확인해 주세요.');
  const themes=validateDirectionItems(input.strategicThemes??[],'전략 과제');if(!themes.ok)return themes;
  const values=validateDirectionItems(input.coreValues??[],'핵심 가치');if(!values.ok)return values;
  const people=[],known=new Set();
  for(const item of input.organization){
   const personUid=uid(item?.uid),role=value(item?.role,60),reportsToUid=item?.reportsToUid===''?'':uid(item?.reportsToUid);
   if(!personUid||!role||String(item.role).length>60||(!reportsToUid&&item.reportsToUid!=='')||known.has(personUid))return fail('조직 역할을 확인해 주세요.');
   known.add(personUid);people.push({uid:personUid,role,reportsToUid});
  }
  const parents=new Map(people.map(person=>[person.uid,person.reportsToUid]));
  for(const person of people){
   const seen=new Set([person.uid]);let parent=person.reportsToUid;
   while(parent){if(!parents.has(parent)||seen.has(parent))return fail('조직 보고 관계를 확인해 주세요.');seen.add(parent);parent=parents.get(parent);}
  }
  const goals=[],goalIds=new Set();
  for(const item of input.goals){
   const goalId=id(item?.id),period=item?.period,title=value(item?.title,200),unit=item?.unit,source=value(item?.source,200);
   if(!goalId||goalIds.has(goalId)||!GOAL_PERIODS.has(period)||!title||String(item.title).length>200||!['count','percent','krw','day','milestone'].includes(unit)||source===null||String(item.source).length>200)return fail('목표 항목을 확인해 주세요.');
   goalIds.add(goalId);
   const baseline=number(item.baseline),target=number(item.target),current=number(item.current);
   const ownerUid=item.ownerUid===undefined||item.ownerUid===null||item.ownerUid===''?undefined:uid(item.ownerUid);
   const businessUnit=item.businessUnit===undefined||item.businessUnit===null||item.businessUnit===''?undefined:value(item.businessUnit,80);
   const themeId=item.themeId===undefined||item.themeId===null||item.themeId===''?undefined:id(item.themeId);
   const startDate=item.startDate===undefined||item.startDate===null||item.startDate===''?undefined:item.startDate;
   const dueDate=item.dueDate===undefined||item.dueDate===null||item.dueDate===''?undefined:item.dueDate;
   if((item.ownerUid!==undefined&&item.ownerUid!==null&&item.ownerUid!==''&&!ownerUid)||(item.businessUnit!==undefined&&item.businessUnit!==null&&item.businessUnit!==''&&(!businessUnit||String(item.businessUnit).length>80))||(item.themeId!==undefined&&item.themeId!==null&&item.themeId!==''&&(!themeId||!themes.items.some(theme=>theme.id===themeId)))||(startDate!==undefined&&!validCalendarDate(startDate))||(dueDate!==undefined&&!validCalendarDate(dueDate))||(startDate!==undefined&&dueDate!==undefined&&dueDate<startDate))return fail('목표 담당·사업부·기간을 확인해 주세요.');
   if([baseline,target,current].some(n=>Number.isNaN(n)))return fail('목표 수치를 확인해 주세요.');
   if(unit==='milestone'&&([baseline,target,current].some(n=>n!==null)||(item.milestoneStatus!==undefined&&item.milestoneStatus!==null&&!MILESTONE_STATUSES.has(item.milestoneStatus))))return fail('마일스톤 상태와 수치를 확인해 주세요.');
   if(unit!=='milestone'&&item.milestoneStatus!==undefined)return fail('마일스톤 상태를 확인해 주세요.');
   goals.push({id:goalId,period,title,unit,baseline,target,current,source,...(unit==='milestone'&&item.milestoneStatus?{milestoneStatus:item.milestoneStatus}:{}),...(ownerUid?{ownerUid}:{}),...(businessUnit?{businessUnit}:{}),...(themeId?{themeId}:{}),...(startDate?{startDate}:{}),...(dueDate?{dueDate}:{})});
  }
  return {ok:true,draft:{year:input.year,vision,organization:people,goals,strategicThemes:themes.items,coreValues:values.items}};
 }
 function validatePublication(input){
  const checked=validateDraft(input);if(!checked.ok)return checked;
  const {draft}=checked;
  if(!draft.vision||!draft.goals.some(goal=>goal.period==='annual'))return fail('게시에는 비전과 연간 목표가 필요합니다.');
  if(draft.goals.some(goal=>!goal.source||(goal.unit!=='milestone'&&goal.target===null)))return fail('목표값과 출처를 확인해 주세요.');
  return checked;
 }
 function projectStrategy(input){
  const checked=validateDraft(input);if(!checked.ok)return {available:false};
  const {draft}=checked;
  return {available:true,year:draft.year,vision:draft.vision,organization:draft.organization,strategicThemes:draft.strategicThemes,coreValues:draft.coreValues,goals:draft.goals.map(goal=>({
   ...goal,
   percent:goal.unit==='milestone'||!goal.source||goal.baseline===null||goal.target===null||goal.current===null||goal.target===goal.baseline?null:Math.max(0,Math.min(100,Math.round((goal.current-goal.baseline)/(goal.target-goal.baseline)*100))),
  }))};
 }
 return Object.freeze({validateDraft,validatePublication,projectStrategy,periodBounds,periodsForDate,periodLabel,goalPeriods:[...GOAL_PERIODS],maxGoals:MAX_GOALS});
});
