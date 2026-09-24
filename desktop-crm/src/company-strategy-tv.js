'use strict';
const Strategy=require('./company-strategy-core');

const privateText=/(?:0\d{1,2}[- .]?\d{3,4}[- .]?\d{4}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|[가-힣A-Za-z0-9]+(?:대로|로|길)\s*\d{1,4}(?:-\d{1,4})?)/iu;
const unsafe=value=>typeof value!=='string'||/[\u0000-\u001f]/u.test(value)||privateText.test(value);
const invalid=()=>{throw new Error('INVALID_APPROVED_STRATEGY');};

function projectApprovedStrategy(publication,members,year){
 if(publication===null||publication===undefined||publication.year!==year)return null;
 if(!/^20\d{2}$/u.test(year)||typeof publication.content!=='string'||!Array.isArray(members))invalid();
 let raw;
 try{raw=JSON.parse(publication.content);}catch{invalid();}
 const checked=Strategy.validatePublication(raw);
 if(!checked.ok||checked.draft.year!==year)invalid();
 const projected=Strategy.projectStrategy(checked.draft);
 if(unsafe(projected.vision)||projected.organization.some(person=>unsafe(person.role))||projected.goals.some(goal=>[goal.title,goal.source].some(unsafe)))invalid();
 const names=new Map(members.filter(person=>typeof person?.uid==='string').map(person=>[person.uid,person.displayName]));
 const positions=new Map(projected.organization.map((person,index)=>[person.uid,index]));
 return {
  year,
  vision:projected.vision,
  organization:projected.organization.map(person=>({
   displayName:/^[\p{L} .·-]{2,40}$/u.test(names.get(person.uid)||'')?names.get(person.uid):'담당자',
   role:person.role,
   reportsToIndex:person.reportsToUid?positions.get(person.reportsToUid):null,
  })),
  goals:projected.goals.map(goal=>({period:goal.period,title:goal.title,unit:goal.unit,target:goal.target,current:goal.current,percent:goal.percent,source:goal.source})),
 };
}

module.exports={projectApprovedStrategy};
