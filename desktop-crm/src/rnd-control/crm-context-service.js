const {randomUUID}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const {verifyCrmContextManifest}=require('./crm-context');
const safeKey=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);
function ids(value){if(!Array.isArray(value)||value.length>10000||value.some(id=>typeof id!=='string'||!id.length)||new Set(value).size!==value.length)throw Error('CRM 선택 ID 형식 오류');return [...value].sort();}
function selections(snapshot,customerIds,buildingIds){
 if(!customerIds.length&&!buildingIds.length)throw Error('고객 또는 건물을 선택하세요');
 const customers=new Set(snapshot.customers.map(row=>row.id)),buildings=new Map(snapshot.buildings.map(row=>[row.id,row]));
 if(customerIds.some(id=>!customers.has(id))||buildingIds.some(id=>!buildings.has(id)))throw Error('선택 ID가 현재 CRM 원장에 없습니다');
 for(const id of buildingIds){const owner=buildings.get(id).ownerCustomerId;if(owner&&!customerIds.includes(owner))throw Error('선택 건물의 고객 연결 ID도 선택하세요');}
}
function validateFrozenCrmContext(record,projectId){
 const fields=['id','version','projectId','sourceRevision','frozenBy','frozenAt','frozenAtEpochMs','sourceUpdatedAt','fetchedAt','testMode','reason','manifestHash','snapshotJSON','customerIdsJSON','buildingIdsJSON'];
 if(!record||Object.keys(record).some(key=>!fields.includes(key))||fields.some(key=>record[key]===undefined)||!safeKey(record.id)||record.projectId!==projectId||record.version!==1||!Number.isInteger(record.sourceRevision)||record.sourceRevision<0||!safeKey(record.frozenBy)||!Number.isFinite(Date.parse(record.frozenAt))||typeof record.reason!=='string'||!record.reason.trim()||record.reason.length>2000)throw Error('고정 CRM 기록 형식 오류');
 if(typeof record.snapshotJSON!=='string'||Buffer.byteLength(record.snapshotJSON)>2*1024*1024)throw Error('고정 CRM 자료 크기 오류');
 const snapshot=JSON.parse(record.snapshotJSON);
 if(!verifyCrmContextManifest(snapshot)||snapshot.manifestHash!==record.manifestHash||snapshot.status!=='CURRENT')throw Error('고정 CRM 자료 검증 실패');
 const age=Date.parse(snapshot.fetchedAt)-Date.parse(snapshot.sourceUpdatedAt),collectionAge=Date.parse(record.frozenAt)-Date.parse(snapshot.fetchedAt);
 if(record.frozenAtEpochMs!==Date.parse(record.frozenAt)||record.fetchedAt!==snapshot.fetchedAt||record.sourceUpdatedAt!==snapshot.sourceUpdatedAt||record.testMode!==snapshot.testMode||!Number.isFinite(age)||age<0||age>24*60*60*1000||!Number.isFinite(collectionAge)||collectionAge<0||collectionAge>5*60*1000)throw Error('고정 CRM 수집 시각·상태 검증 실패');
 const snapshotFields=['kind','sourcePath','fetchedAt','testMode','readOnly','status','sourceUpdatedAt','customers','buildings','counts','manifestVersion','manifestHash'];
 if(Object.keys(snapshot).some(key=>!snapshotFields.includes(key)))throw Error('CRM 자료 허용 필드 오류');
 for(const kind of ['customers','buildings'])for(const row of snapshot[kind])if(Object.keys(row).some(key=>!['id','sourceKey','name','updatedAt',...(kind==='buildings'?['ownerCustomerId']:[])].includes(key)))throw Error('CRM 원장 허용 필드 오류');
 const customerIds=ids(JSON.parse(record.customerIdsJSON)),buildingIds=ids(JSON.parse(record.buildingIdsJSON));selections(snapshot,customerIds,buildingIds);
 return record;
}
function contextMap(project){const value=project?.crmContexts;if(value===undefined||value===null)return {};if(typeof value!=='object'||Array.isArray(value))throw Error('고정 CRM 기록 목록 형식 오류');return value;}
function assertCrmContextChange(previous,next,{allowAppend=false,actorUid}={}){
 const old=contextMap(previous),current=contextMap(next);
 for(const [id,record] of Object.entries(old)){
  if(!Object.hasOwn(current,id))throw Error('고정 CRM 기록은 삭제할 수 없습니다');
  if(!isDeepStrictEqual(record,current[id]))throw Error('고정 CRM 기록은 수정할 수 없습니다');
 }
 for(const [id,record] of Object.entries(current)){
  if(!safeKey(id)||record?.id!==id)throw Error('고정 CRM 기록 ID 오류');validateFrozenCrmContext(record,next.id);
  if(!Object.hasOwn(old,id)&&!allowAppend)throw Error('CRM 고정 보관은 전용 작업으로 진행하세요');
  if(!Object.hasOwn(old,id)&&actorUid!==undefined&&record.frozenBy!==actorUid)throw Error('CRM 고정 자료 보관자 확인 실패');
 }
}
function createCrmContextService({access,getProject,getContext,saveProject,clock=()=>new Date().toISOString(),uuid=randomUUID}){
 async function actor(){const user={...await access(true)};if(!user.uid||user.mustChangePassword||!['admin','member'].includes(user.role))throw Error('CRM 고정 보관 권한이 없습니다');return user;}
 async function unchanged(initial){const current=await actor();if(['uid','role','email'].some(key=>current[key]!==initial[key]))throw Error('로그인 세션이 변경되었습니다');}
 return{async freeze(input){
  const initial=await actor();
  if(!safeKey(input?.projectId)||!Number.isInteger(input.expectedRevision)||input.expectedRevision<0||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>2000)throw Error('프로젝트·revision·보관 이유 확인 필요');
  const customerIds=ids(input.customerIds),buildingIds=ids(input.buildingIds);
  const project=await getProject(input.projectId);await unchanged(initial);
  if(project.id!==input.projectId||project.revision!==input.expectedRevision)throw Error('동시편집 충돌: 최신 프로젝트를 조회하세요');
  const snapshot=await getContext();await unchanged(initial);
  if(!verifyCrmContextManifest(snapshot)||snapshot.status!=='CURRENT')throw Error('CRM 원장 상태·갱신시각을 먼저 확인하세요');
  selections(snapshot,customerIds,buildingIds);
  const id=uuid(),frozenAt=clock(),record={id,version:1,projectId:project.id,sourceRevision:project.revision,frozenBy:initial.uid,frozenAt,frozenAtEpochMs:Date.parse(frozenAt),sourceUpdatedAt:snapshot.sourceUpdatedAt,fetchedAt:snapshot.fetchedAt,testMode:snapshot.testMode,reason:input.reason.trim(),manifestHash:snapshot.manifestHash,snapshotJSON:JSON.stringify(snapshot),customerIdsJSON:JSON.stringify(customerIds),buildingIdsJSON:JSON.stringify(buildingIds)};
  validateFrozenCrmContext(record,project.id);
  if(Object.hasOwn(contextMap(project),id))throw Error('CRM 고정 기록 ID 충돌');
  const next={...project,crmContexts:{...contextMap(project),[id]:record}};assertCrmContextChange(project,next,{allowAppend:true});await unchanged(initial);
  const saved=await saveProject(next,{allowCrmContextAppend:true});await unchanged(initial);return saved;
 }};
}
module.exports={createCrmContextService,assertCrmContextChange,validateFrozenCrmContext};
