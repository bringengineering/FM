(function attachProjectStrategyCore(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.BringProjectStrategyCore=api;
})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 const items=value=>Array.isArray(value)?value.filter(Boolean):value&&typeof value==='object'?Object.values(value).filter(Boolean):[];
 const text=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
 const measure=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
 function currentQuarter(today){
  if(typeof today!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(today)||!Number.isFinite(Date.parse(today+'T00:00:00Z'))||new Date(today+'T00:00:00Z').toISOString().slice(0,10)!==today)throw new Error('invalid date');
  return `${today.slice(0,4)}-Q${Math.ceil(Number(today.slice(5,7))/3)}`;
 }
 function summarize({objectives,projects,today}){
  if(!Array.isArray(objectives))throw new Error('objectives unavailable');
  const quarter=currentQuarter(today);
  const known=new Set((Array.isArray(projects)?projects:[]).map(project=>text(project?.id,80)).filter(Boolean));
  const seen=new Set();
  const goals=objectives.flatMap(record=>{
   const id=text(record?.id,80),title=text(record?.title,200);
   if(!id||!title||seen.has(id)||record?.status!=='active'||record?.quarter!==quarter)return [];
   seen.add(id);
   const projectIds=[...new Set(items(record.projectIds).map(id=>text(id,80)).filter(id=>known.has(id)))];
   const keyResults=items(record.keyResults).slice(0,20).flatMap(item=>{
    const id=text(item?.id,80),title=text(item?.title,200),unit=text(item?.unit,12);
    if(!id||!title||!['count','percent','krw','day'].includes(unit))return [];
    const baseline=measure(item.baseline),target=measure(item.target),current=measure(item.current);
    const progress=baseline===null||target===null||current===null||target===baseline?null:Math.max(0,Math.min(100,Math.round((current-baseline)/(target-baseline)*100)));
    return [{id,title,unit,target,current,progress}];
   });
   return [{id,title,quarter,projectIds,keyResults}];
  }).slice(0,20);
  return {quarter,goals};
 }
 const forProject=(summary,projectId)=>Array.isArray(summary?.goals)?summary.goals.filter(goal=>goal.projectIds.includes(projectId)):[];
 return Object.freeze({currentQuarter,summarize,forProject});
});
