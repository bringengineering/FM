import {validate,demo} from './model.mjs';
export const portfolioKey='bring-building-atlas-portfolio-v2';
export function loadPortfolio(storage){
 const raw=storage.getItem(portfolioKey);
 if(raw){const p=JSON.parse(raw);if(p.version!==2||!Array.isArray(p.items)||!p.items.length||!p.items.some(i=>i.id===p.activeId))throw Error('건물 목록을 읽지 못했습니다.');const ids=new Set();for(const i of p.items){if(typeof i.id!=='string'||ids.has(i.id))throw Error('건물 번호 중복');ids.add(i.id);validate(i.data);}return p;}
 const old=storage.getItem('bring-building-atlas-v1');return {version:2,activeId:'first',items:[{id:'first',data:old?validate(JSON.parse(old)):demo()}]};
}
export function savePortfolio(storage,p){for(const i of p.items)validate(i.data);storage.setItem(portfolioKey,JSON.stringify(p));return p;}
export function routePoints(record,targetId){return (record.routes||[]).find(r=>r.targetId===targetId)?.points||[];}
export function validateRoutes(r,b,ids){
 if(r.routes!==undefined){if(!Array.isArray(r.routes)||r.routes.length>100)throw Error('배관 경로 형식을 확인해주세요.');const targets=new Set();for(const route of r.routes){if(!ids.has(route.targetId)||!r.links.includes(route.targetId)||targets.has(route.targetId))throw Error('경로는 연결 설비마다 하나씩 등록해주세요.');targets.add(route.targetId);if(!Array.isArray(route.points)||route.points.length>100)throw Error('경로의 경유점은 최대 100개입니다.');for(const p of route.points)if(!p||!Number.isFinite(p.x)||Math.abs(p.x)>b.width/2||!Number.isFinite(p.z)||Math.abs(p.z)>b.depth/2||!Number.isInteger(p.floor)||p.floor<0||p.floor>b.floors)throw Error('배관 경유점이 건물 범위를 벗어났습니다.');}}
}
