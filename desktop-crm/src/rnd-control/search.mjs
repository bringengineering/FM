import {followUpTasks} from './follow-up.mjs';
const collections={observations:'관측',items:'산출물',experiments:'실험',datasetSnapshots:'데이터셋',evidence:'근거',metricResults:'측정 결과',decisions:'의사결정',hypotheses:'가설',hypothesisAssessments:'가설 판정',disclosureApprovals:'공개 범위 검토'};
const fields=['unitId','unit','value','observedAt','recordedBy','ownerUid','criteria','due','decisionId','taskId','id','title','name','goal','owner','reviewer','status','hypothesis','hypothesisId','result','reason','sourceDescription','artifactId','claim','limitations','statement','code','frameworkVersion','population','selectionRule','exclusions','unitType','version','reviewerUid','assessedBy','question','comparison','period','metrics','analysis','success','stop'];
const normalize=value=>String(value??'').normalize('NFKC').toLocaleLowerCase();
export function indexProjects(projects){const rows=[];for(const project of projects){
 const add=(record,type)=>{const text=[record,record.plan??{}].flatMap(source=>fields.map(key=>typeof source[key]==='string'?source[key]:typeof source[key]==='number'&&Number.isFinite(source[key])?String(source[key]):'' )).join(' ');rows.push({projectId:project.id,projectTitle:project.title,revision:project.revision??0,id:record.id??project.id,type,label:type==='관측'?`${record.name} · ${record.status==='OBSERVED'?record.value+' '+record.unit:'값 없음'}`:record.title||record.name||record.plan?.question||record.statement||record.id||project.title,status:record.status??'',text:normalize(project.title+' '+project.id+' '+text)});};
 add(project,'프로젝트');for(const task of followUpTasks(project.research?.followUpEvents??[]))add({...task,id:task.taskId},'후속 업무');for(const [key,type]of Object.entries(collections))for(const record of (key==='items'?project.items:project.research?.[key])??[])add(record,type);
 }return rows;}
export function searchPage(index,{query='',type='',page=1,pageSize=50}={}){
 const words=normalize(query).trim().split(/\s+/).filter(Boolean);const matches=index.filter(row=>(!type||row.type===type)&&words.every(word=>row.text.includes(word)));
 const size=Math.max(1,Math.min(100,Math.trunc(Number(pageSize)||50))),pages=Math.max(1,Math.ceil(matches.length/size)),current=Math.max(1,Math.min(pages,Math.trunc(Number(page)||1)));
 return{total:matches.length,page:current,pages,rows:matches.slice((current-1)*size,current*size)};
}
