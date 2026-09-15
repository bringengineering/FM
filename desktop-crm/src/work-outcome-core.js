// Explicit outcome drafts only. No approval, persistence or inferred performance.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BringWorkOutcomeCore=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const text=value=>typeof value==='string'?value.trim():'';
  const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const rows=value=>Array.isArray(value)?value:[];
  function amount(value){
    if(typeof value!=='number'&&typeof value!=='string')return null;
    if(typeof value==='string'&&!/^\d+(?:\.\d+)?$/.test(value.trim()))return null;
    const n=Number(value);return Number.isFinite(n)&&n>=0?n:null;
  }
  function normalize(value){
    const s=object(value);
    return {summary:text(s.summary),contribution:text(s.contribution),blockers:text(s.blockers),nextAction:text(s.nextAction),decisionRequest:text(s.decisionRequest),
      metrics:rows(s.metrics).map(value=>{const m=object(value);return {label:text(m.label),target:amount(m.target),actual:amount(m.actual),unit:text(m.unit)};}),
      evidence:rows(s.evidence).map(value=>{const e=object(value);return {title:text(e.title),url:text(e.url)};})};
  }
  function validate(value){
    const d=normalize(value),errors=[];
    const error=(field,message)=>errors.push({field,message});
    if(!d.summary)error('summary','실제 수행 결과를 입력하세요.');
    for(const field of ['summary','contribution','blockers','nextAction','decisionRequest'])if(d[field].length>6000)error(field,'6,000자 이내로 작성하세요.');
    if(d.metrics.length>30)error('metrics','지표는 최대 30개입니다.');
    d.metrics.forEach((m,i)=>{
      if(!m.label||m.label.length>120)error(`metrics.${i}.label`,'지표명을 120자 이내로 입력하세요.');
      if(m.actual===null)error(`metrics.${i}.actual`,'실제 확인한 수치를 입력하세요. 미확인 값은 제출할 수 없습니다.');
      if(!m.unit||m.unit.length>30)error(`metrics.${i}.unit`,'단위를 30자 이내로 입력하세요.');
    });
    if(!d.evidence.length||d.evidence.length>30)error('evidence','증빙 링크를 1~30개 입력하세요.');
    d.evidence.forEach((e,i)=>{
      if(!e.title||e.title.length>200)error(`evidence.${i}.title`,'증빙 이름을 200자 이내로 입력하세요.');
      try{const u=new URL(e.url);if(u.protocol!=='https:'||u.username||u.password||e.url.length>2000)throw new Error();}
      catch{error(`evidence.${i}.url`,'인증정보가 없는 HTTPS 증빙 링크를 입력하세요.');}
    });
    return {ok:errors.length===0,errors,value:d};
  }
  return {normalize,validate};
});
