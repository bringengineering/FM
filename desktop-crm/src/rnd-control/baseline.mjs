export const timeKeys=['travel','check','work','report','contact','other'];
export const costKeys=['labor','transport','materials','outsourcing'];
function amount(value,key){if(value===null||value===undefined||String(value).trim()===''||!Number.isFinite(Number(value))||Number(value)<0)throw Error(`${key}: 0 이상의 실제 값을 입력하세요`);return Number(value);}
export function validateVisit(input){
 const v=structuredClone(input);
 if(v.restorationSourceRevision!==undefined&&(!Number.isInteger(v.restorationSourceRevision)||v.restorationSourceRevision<0))throw Error('복원 원본 revision 형식 오류');
 for(const key of ['id','buildingId','operator','reason','serviceScope','costBasis','evidenceUrl'])if(!String(v[key]??'').trim())throw Error(`${key}: 필수 항목입니다`);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(v.date??'')||!Number.isFinite(Date.parse(v.date))||new Date(v.date).toISOString().slice(0,10)!==v.date)throw Error('날짜를 확인하세요');
 for(const key of timeKeys)v.minutes[key]=amount(v.minutes?.[key],key);
 for(const key of costKeys)v.costs[key]=amount(v.costs?.[key],key);
 v.totalMinutes=amount(v.totalMinutes,'총시간');
 if(Math.abs(timeKeys.reduce((s,k)=>s+v.minutes[k],0)-v.totalMinutes)>0.01)throw Error('총시간과 활동 시간 합계가 다릅니다. 중복·누락을 확인하세요');
 if(v.revisit&&(!v.originalVisitId?.trim()||!v.revisitReason?.trim()||v.originalVisitId===v.id))throw Error('재방문 원기록 ID와 사유를 확인하세요');
 const url=new URL(v.evidenceUrl);if(!['https:','http:'].includes(url.protocol))throw Error('원본 링크는 http/https만 가능합니다');
 return v;
}
export function validateVisitLinks(visits){
 const records=new Map(visits.map(v=>[v.id,v]));
 if(records.size!==visits.length)throw Error('중복 방문 ID');
 const complete=new Set();
 for(const visit of visits){
  let current=visit;const path=new Set();
  while(current&&!complete.has(current.id)){
   if(path.has(current.id))throw Error('재방문 원기록 순환 연결');
   path.add(current.id);
   if(!current.revisit)break;
   const parent=records.get(current.originalVisitId);
   if(!parent)throw Error('재방문 원기록 연결 오류');
   if(parent.buildingId!==current.buildingId||parent.projectId!==current.projectId)throw Error('재방문 원기록의 건물·프로젝트 불일치');
   current=parent;
  }
  for(const id of path)complete.add(id);
 }
 return visits;
}
export function summarizeVisits(visits){const ids=new Set();const buildings=new Set();let totalMinutes=0,totalCost=0;for(const input of visits){const v=validateVisit(input);if(ids.has(v.id))throw Error('중복 방문 ID');ids.add(v.id);buildings.add(v.buildingId);totalMinutes+=v.totalMinutes;totalCost+=costKeys.reduce((s,k)=>s+v.costs[k],0);}return{visits:ids.size,buildings:buildings.size,totalMinutes,totalCost};}
