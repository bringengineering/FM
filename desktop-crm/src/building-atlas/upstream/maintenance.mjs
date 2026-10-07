const physical=new Set(['water','electric','fire','hvac','sensor']);
export function validDate(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;}
export function maintenanceSummary(data,today=new Date().toLocaleDateString('sv-SE')){
 const assets=data.records.filter(r=>physical.has(r.category));const scheduled=data.records.filter(r=>validDate(r.nextInspection));
 const history=data.records.flatMap(r=>(r.history||[]).map(h=>({...h,assetId:r.id})));
 return {assets,unverified:assets.filter(r=>r.confidence!=='현장 확인'),attention:assets.filter(r=>['긴급','점검 필요','확인 필요','작업 중'].includes(r.status)),overdue:scheduled.filter(r=>r.nextInspection<today),dueToday:scheduled.filter(r=>r.nextInspection===today),scheduled:scheduled.sort((a,b)=>a.nextInspection.localeCompare(b.nextInspection)),recordedCost:history.reduce((sum,h)=>sum+(typeof h.cost==='number'&&Number.isFinite(h.cost)&&h.cost>=0?h.cost:0),0),historyCount:history.length,missingCost:history.filter(h=>h.cost===null||h.cost===undefined).length};
}
