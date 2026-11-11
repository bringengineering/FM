import {validate} from './model.mjs';
const supported=new Set(['water','electric','fire','hvac','sensor','building','lease']);
export function duplicable(r){return supported.has(r.category);}
export function duplicateRecords(data,ids,targetFloor,idFactory=()=>crypto.randomUUID()){
 if(!Number.isInteger(targetFloor)||targetFloor<0||targetFloor>data.building.floors)throw Error('대상 층을 확인해주세요.');
 const originals=data.records.filter(r=>ids.includes(r.id));if(!originals.length||originals.some(r=>!duplicable(r)))throw Error('복제할 설비·공간을 선택해주세요.');
 if(originals.some(r=>r.floor===targetFloor))throw Error('원본과 다른 층을 선택해주세요.');
 const next=structuredClone(data),map=new Map(),existing=new Set(data.records.map(r=>r.id));let skipped=0;
 for(const r of originals){const id=idFactory();if(typeof id!=='string'||existing.has(id))throw Error('새 설비 번호가 중복되었습니다.');existing.add(id);map.set(r.id,id);}
 for(const r of originals){
 const copy={id:map.get(r.id),name:`${targetFloor===0?'B1':targetFloor+'F'} · ${r.name} 복사`,category:r.category,floor:targetFloor,x:r.x,z:r.z,status:'확인 필요',confidence:'추정',source:`${r.floor===0?'B1':r.floor+'F'} ${r.name}에서 복제 · 위치와 연결 현장 확인 필요`,fields:Object.fromEntries(Object.keys(r.fields).map(k=>[k,''])),links:r.links.filter(id=>map.has(id)).map(id=>map.get(id)),notes:'복제한 배치입니다. 실제 장비의 명판·위치·배관 연결을 확인하고 정보를 입력하세요.'};
 skipped+=r.links.filter(id=>!map.has(id)).length;if(r.shape)copy.shape=r.shape;if(r.room)copy.room=structuredClone(r.room);
 copy.routes=(r.routes||[]).filter(route=>map.has(route.targetId)&&route.points.every(p=>p.floor===r.floor)).map(route=>({targetId:map.get(route.targetId),confirmed:false,points:route.points.map(p=>({...p,floor:targetFloor}))}));
 next.records.push(copy);
 }
 validate(next);return {data:next,count:originals.length,skippedLinks:skipped,newIds:[...map.values()]};
}
