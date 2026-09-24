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
 function validateDraft(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.year!=='string'||!/^20[0-9]{2}$/.test(input.year))return fail('연도를 확인해 주세요.');
  const vision=value(input.vision,500);
  if(vision===null||String(input.vision).length>500)return fail('비전은 500자 이내로 입력해 주세요.');
  if(!Array.isArray(input.organization)||input.organization.length>30||!Array.isArray(input.goals)||input.goals.length>30)return fail('조직·목표 항목 수를 확인해 주세요.');
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
   if(!goalId||goalIds.has(goalId)||!['annual','H1','H2'].includes(period)||!title||String(item.title).length>200||!['count','percent','krw','day','milestone'].includes(unit)||source===null||String(item.source).length>200)return fail('목표 항목을 확인해 주세요.');
   goalIds.add(goalId);
   const baseline=number(item.baseline),target=number(item.target),current=number(item.current);
   if([baseline,target,current].some(n=>Number.isNaN(n)))return fail('목표 수치를 확인해 주세요.');
   if(unit==='milestone'&&[baseline,target,current].some(n=>n!==null))return fail('마일스톤은 숫자 퍼센트로 기록하지 않습니다.');
   goals.push({id:goalId,period,title,unit,baseline,target,current,source});
  }
  return {ok:true,draft:{year:input.year,vision,organization:people,goals}};
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
  return {available:true,year:draft.year,vision:draft.vision,organization:draft.organization,goals:draft.goals.map(goal=>({
   ...goal,
   percent:goal.unit==='milestone'||!goal.source||goal.baseline===null||goal.target===null||goal.current===null||goal.target===goal.baseline?null:Math.max(0,Math.min(100,Math.round((goal.current-goal.baseline)/(goal.target-goal.baseline)*100))),
  }))};
 }
 return Object.freeze({validateDraft,validatePublication,projectStrategy});
});
