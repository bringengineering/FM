function records(value){
 if(value===undefined||value===null)return null;
 if(Array.isArray(value))return value.filter(item=>item!==null&&item!==undefined).map(item=>({item,key:null}));
 if(typeof value==='object')return Object.entries(value).map(([key,item])=>({key,item}));
 throw Error('CRM 원장 목록 형식 오류');
}
function projectRecords(value,kind){
 const list=records(value);if(list===null)return null;
 const seen=new Set();return list.map(({key,item})=>{
  if(!item||typeof item!=='object'||Array.isArray(item))throw Error('CRM 원장 항목 형식 오류');
  const id=item.id??key;if(typeof id!=='string'||!id.length||seen.has(id))throw Error('CRM 원장 ID 누락·중복');seen.add(id);
  const result={id};if(key!==null)result.sourceKey=key;
  if(typeof item.name==='string')result.name=item.name;
  if(typeof item.updatedAt==='string')result.updatedAt=item.updatedAt;
  if(kind==='buildings'&&typeof item.ownerCustomerId==='string')result.ownerCustomerId=item.ownerCustomerId;
  return result;
 });
}
function createCrmContextSnapshot(raw,{fetchedAt=new Date().toISOString(),testMode=false,staleAfterMs=24*60*60*1000}={}){
 if(!Number.isFinite(Date.parse(fetchedAt))||!Number.isFinite(staleAfterMs)||staleAfterMs<0)throw Error('CRM 스냅샷 시각 설정 오류');
 const base={kind:'BRING_RND_CRM_CONTEXT',sourcePath:'crmShared/data',fetchedAt,testMode,readOnly:true};
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return{...base,status:'UNAVAILABLE',sourceUpdatedAt:null,customers:null,buildings:null,counts:{customers:null,buildings:null}};
 const customers=projectRecords(raw.customers,'customers'),buildings=projectRecords(raw.buildings,'buildings');
 const sourceUpdatedAt=typeof raw.updatedAt==='string'&&Number.isFinite(Date.parse(raw.updatedAt))?raw.updatedAt:null;
 const age=sourceUpdatedAt===null?null:Date.parse(fetchedAt)-Date.parse(sourceUpdatedAt);
 const status=customers===null||buildings===null?'PARTIAL':age===null||age<0?'UPDATED_TIME_UNKNOWN':age>staleAfterMs?'STALE':'CURRENT';
 return{...base,status,sourceUpdatedAt,customers,buildings,counts:{customers:customers?.length??null,buildings:buildings?.length??null}};
}
module.exports={createCrmContextSnapshot};
