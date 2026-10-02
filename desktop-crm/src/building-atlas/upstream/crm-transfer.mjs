import {validate} from './model.mjs';
const text=v=>typeof v==='string'?v.trim():'';
function basics(value){
 const name=text(value?.name),address=text(value?.address);
 if(!name||name.length>150||address.length>500)throw Error('건물명은 1~150자, 주소는 500자 이내여야 합니다.');
 return {name,address};
}
export function collectBuildingBasics(settings={},cases={}){
 const rows=[],seen=new Set();
 const add=value=>{try{const b=basics(value),key=JSON.stringify([b.name,b.address]);if(!seen.has(key)){seen.add(key);rows.push(b);}}catch{/* Incomplete CRM rows are not selectable. */}};
 for(const b of Object.values(settings?.paymentBuildings||{})){
  if(!b||b.deleted||b.archived)continue;
  add({name:b.building||b.name||b.matchedBuilding,address:b.address||b.matchedAddress});
 }
 for(const c of Object.values(cases||{})){
  if(!c||c.deleted||c.archived)continue;
  const m=c.contractMatch?.status==='matched'?c.contractMatch:{};
  add({name:m.matchedBuilding||c.building,address:m.matchedAddress||c.address});
 }
 return rows.sort((a,b)=>a.name.localeCompare(b.name,'ko')||a.address.localeCompare(b.address,'ko'));
}
export function transferPayload(building){return {kind:'bring-building-basics',version:1,building:basics(building)};}
export function readTransfer(payload){
 if(!payload||payload.kind!=='bring-building-basics'||payload.version!==1||!payload.building||Object.keys(payload).some(k=>!['kind','version','building'].includes(k))||Object.keys(payload.building).some(k=>!['name','address'].includes(k)))throw Error('FM에서 내보낸 건물명·주소 전용 파일을 선택해주세요.');
 return basics(payload.building);
}
export function addTransferredBuilding(portfolio,payload,newId=()=>crypto.randomUUID()){
 const b=readTransfer(payload),p=structuredClone(portfolio);
 const existing=p.items.find(i=>i.data.building.origin==='fm-basics'&&i.data.building.name===b.name&&i.data.building.address===b.address);
 if(existing){p.activeId=existing.id;return p;}
 if(p.items.length>=100)throw Error('건물은 최대 100개까지 추가할 수 있습니다.');
 const id=newId();if(p.items.some(i=>i.id===id))throw Error('건물 번호가 중복됩니다. 다시 시도해주세요.');
 const data={version:1,building:{...b,floors:1,width:16,depth:12,origin:'fm-basics',geometryStatus:'미확인'},records:[]};
 validate(data);p.items.push({id,data});p.activeId=id;return p;
}
