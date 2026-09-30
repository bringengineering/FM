import {validateVisit,validateVisitLinks} from './baseline.mjs';
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value))))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
export async function previewCSVRollback(localDrafts,sharedVisits,job){
 localDrafts=structuredClone(localDrafts);sharedVisits=structuredClone(sharedVisits);job=structuredClone(job);
 if(!Array.isArray(localDrafts)||!Array.isArray(sharedVisits)||!Array.isArray(job?.drafts)||!job.drafts.length||new Set(localDrafts.map(v=>v?.id)).size!==localDrafts.length||new Set(sharedVisits.map(v=>v?.id)).size!==sharedVisits.length||new Set(job.drafts.map(d=>d?.data?.id)).size!==job.drafts.length)throw Error('CSV 되돌리기 목록 오류');
 for(const visit of [...localDrafts,...sharedVisits])validateVisit(visit);const current=new Map(localDrafts.map(v=>[v.id,v])),sharedIds=new Set(sharedVisits.map(v=>v.id)),removeIds=[];
 for(const draft of job.drafts){const visit=current.get(draft.data.id);if(!visit||sharedIds.has(draft.data.id)||await hash(draft.data)!==draft.sha256||await hash(visit)!==draft.sha256)throw Error('가져온 초안이 변경·공유되었거나 현재 없습니다. 자동 되돌리기를 중단합니다.');removeIds.push(draft.data.id);}
 const remove=new Set(removeIds),remaining=localDrafts.filter(v=>!remove.has(v.id));validateVisitLinks([...sharedVisits,...remaining]);return{scope:'local-visit-drafts',cloudWrites:false,sourceFilesDeleted:false,removeIds,remaining};
}
