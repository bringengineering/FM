import {followUpPolicy} from './follow-up-policy.mjs';
const key=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);
const text=value=>typeof value==='string'&&!!value.trim()&&value.length<=4000&&new RegExp('^'+followUpPolicy.text+'$').test(value);
const time=value=>typeof value==='string'&&new RegExp('^'+followUpPolicy.at+'$').test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const fields=['id','projectId','experimentId','planRevision','unitId','name','unit','status','value','reason','observedAt','recordedBy','at'];
export function validateObservation(project,record){
 if(!record||Object.keys(record).some(k=>!fields.includes(k))||!['OBSERVED','MISSING','NOT_INSPECTED','UNOBSERVABLE'].includes(record.status))throw Error('관측 기록 필드·상태 오류');
 if(!['id','experimentId','unitId','recordedBy'].every(k=>key(record[k]))||record.projectId!==project.id||!['name','unit','reason'].every(k=>text(record[k]))||!time(record.observedAt)||!time(record.at)||record.observedAt>record.at)throw Error('관측 기록 ID·설명·사유·시각 오류');
 const experiment=project.research?.experiments?.find(e=>e.id===record.experimentId);
 if(!experiment||!Number.isInteger(record.planRevision)||record.planRevision!==experiment.planVersion)throw Error('관측 기록 실험·계획 버전 오류');
 if(record.status==='OBSERVED'?(typeof record.value!=='number'||!Number.isFinite(record.value)):record.value!==null)throw Error('실제 관측은 수치가 필요하며 결측·미점검·관측 불가는 null이어야 합니다');
 return record;
}
export function createObservation(project,input,user,{at=new Date().toISOString()}={}){
 if(!user?.uid||!['admin','member'].includes(user.role))throw Error('관측 변경 권한이 없습니다');
 const experiment=project.research?.experiments?.find(e=>e.id===input?.experimentId);
 if(!experiment||experiment.status!=='running')throw Error('진행 중인 실험에 관측을 기록하세요');
 if(project.research?.observations?.some(e=>e.id===input.id))throw Error('중복 관측 ID');
 return validateObservation(project,{id:input.id,projectId:project.id,experimentId:input.experimentId,planRevision:experiment.planVersion,unitId:input.unitId,name:input.name?.trim(),unit:input.unit?.trim(),status:input.status,value:input.value,reason:input.reason?.trim(),observedAt:input.observedAt,recordedBy:user.uid,at});
}
export function validateObservations(project){const records=project.research?.observations??[];if(!Array.isArray(records)||new Set(records.map(r=>r?.id)).size!==records.length)throw Error('관측 목록 형식·중복 오류');records.forEach(r=>validateObservation(project,r));return project;}
