export function toWorld(u,v,building,floor){
 return {floor,x:Math.round((Math.max(0,Math.min(1,u))-.5)*building.width*100)/100,z:Math.round((Math.max(0,Math.min(1,v))-.5)*building.depth*100)/100};
}
export function toPlan(point,building){return {u:point.x/building.width+.5,v:point.z/building.depth+.5};}
export function validatePlans(building){
 if(building.floorPlans===undefined)return;
 if(!building.floorPlans||typeof building.floorPlans!=='object'||Array.isArray(building.floorPlans))throw Error('층별 평면도 형식을 확인해주세요.');
 for(const [key,plan] of Object.entries(building.floorPlans)){
 if(!/^\d+$/.test(key)||Number(key)>building.floors||!plan||typeof plan.image!=='string'||plan.image.length>1200000||!/^data:image\/(jpeg|png|webp);base64,/.test(plan.image)||typeof plan.name!=='string')throw Error('평면도는 유효한 층의 JPG·PNG·WebP 이미지여야 합니다.');
 }
}
