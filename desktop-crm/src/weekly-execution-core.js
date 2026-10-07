// Generic draft handling only. Company assignments are explicit private input.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.BringWeeklyExecutionCore=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const MAX_FILE_BYTES=300000;
  const fields={key:100,owner:120,title:120,why:1000,what:2000,doneWhen:1000,deliverable:1000,prerequisite:1000,targets:1000};
  function createWeeklyPack(){
    return {containsInternalAssignments:false,saved:false,label:'업무지시 파일을 불러오세요',guidance:[
      '파일 불러오기는 서버 저장이 아닙니다. 초안을 검토하고 기존 편집기에서 담당자·프로젝트·날짜를 선택해 저장하세요.',
      '개인별 Word 2~4페이지와 PPT 5장 / 5분 발표, 증빙을 준비합니다. 목표와 실제 결과를 구분하세요.',
      '공동 실적은 중복 집계하지 않습니다. 보고서에는 본인의 역할과 공동 결과물 링크를 남기세요.'
    ],projects:[]};
  }
  function invalid(){throw Object.assign(new Error('업무지시 JSON 형식·필수 항목·길이·중복 키를 확인해 주세요. 기존 초안은 유지됩니다.'),{code:'INVALID_WEEKLY_PACK'});}
  function shape(value,keys){
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key))||keys.some(key=>!Object.hasOwn(value,key))) invalid();
  }
  function text(value,max){if(typeof value!=='string'||!value.trim()||value.length>max)invalid();return value;}
  function parsePrivatePack(source){
    if(typeof source!=='string'||source.length>MAX_FILE_BYTES)invalid();
    let pack;try{pack=JSON.parse(source);}catch{invalid();}
    shape(pack,['containsInternalAssignments','saved','label','guidance','projects']);
    if(pack.containsInternalAssignments!==true||pack.saved!==false)invalid();
    text(pack.label,200);
    if(!Array.isArray(pack.guidance)||pack.guidance.length>20)invalid();
    pack.guidance.forEach(line=>text(line,2000));
    if(!Array.isArray(pack.projects)||!pack.projects.length||pack.projects.length>30)invalid();
    const keys=new Set();let count=0;
    for(const project of pack.projects){
      shape(project,['name','tasks']);text(project.name,120);
      if(!Array.isArray(project.tasks)||!project.tasks.length)invalid();
      for(const task of project.tasks){
        if(++count>200)invalid();shape(task,Object.keys(fields));
        for(const [field,max] of Object.entries(fields))text(task[field],max);
        if(!/^[a-zA-Z0-9_-]+$/.test(task.key)||keys.has(task.key))invalid();keys.add(task.key);
        if((task.what+'\n권장 역할: '+task.owner+'\n선행조건: '+task.prerequisite).length>2000||(task.doneWhen+'\n목표(실적 아님): '+task.targets).length>1000)invalid();
      }
    }
    return pack;
  }
  function editorDraft(key,admin,pack=createWeeklyPack()){
    if(admin!==true||!pack)return null;
    const item=pack.projects.flatMap(project=>project.tasks).find(row=>row.key===key);
    if(!item)return null;
    return {title:item.title,why:item.why,what:item.what+'\n권장 역할: '+item.owner+'\n선행조건: '+item.prerequisite,doneWhen:item.doneWhen+'\n목표(실적 아님): '+item.targets,deliverable:item.deliverable};
  }
  return {createWeeklyPack,parsePrivatePack,editorDraft,MAX_FILE_BYTES};
});
