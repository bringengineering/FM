import {followUpPolicy} from './follow-up-policy.mjs';
const matches=(field,value)=>typeof value==='string'&&new RegExp('^'+followUpPolicy[field]+'$').test(value);
const key=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);
const text=value=>typeof value==='string'&&value.length<=4000&&!!value.trim()&&matches('text',value);
const fields=new Set(['id','taskId','projectId','decisionId','title','ownerUid','reviewerUid','due','criteria','status','sequence','previousEventId','actorUid','actorRole','reason','at','result','resultUrl','completedBy','completedAt','selfReview','selfReviewReason']);
const states=['todo','active','review','done','blocked','cancelled'];
const transitions={todo:['active','blocked','cancelled'],active:['review','blocked','cancelled'],blocked:['active','cancelled'],review:['done','active','blocked','cancelled'],done:[],cancelled:[]};
function date(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value??''))return false;const parsed=new Date(value+'T00:00:00Z');return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;}
function resultURL(value){if(!matches('url',value)||!matches('host',value))return false;try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password&&![...url.searchParams.keys()].some(key=>/token|secret|password|authorization|credential|signature|auth|key/i.test(key));}catch{return false;}}
export function followUpTasks(events){
 if(!Array.isArray(events))throw Error('후속 업무 이력 형식 오류');const latest=new Map(),seen=new Set();
 for(const event of [...events].sort((a,b)=>(a?.sequence??0)-(b?.sequence??0)||String(a?.id).localeCompare(String(b?.id)))){
  if(event&&Object.keys(event).some(field=>!fields.has(field)))throw Error('후속 업무 이력에 허용되지 않은 필드');
  if(!event||!key(event.id)||!key(event.taskId)||seen.has(event.id)||!states.includes(event.status))throw Error('후속 업무 이력 ID·상태 오류');
  if(!key(event.projectId)||!key(event.decisionId)||!key(event.ownerUid)||!key(event.reviewerUid)||!key(event.actorUid)||!['admin','member'].includes(event.actorRole)||!text(event.title)||!text(event.criteria)||!text(event.reason)||!date(event.due)||!matches('at',event.at)||!Number.isFinite(Date.parse(event.at))||!Number.isInteger(event.sequence)||event.sequence<1)throw Error('후속 업무 이력 명세 오류');
  const previous=latest.get(event.taskId);
  if(event.sequence!==(previous?.sequence??0)+1||(event.previousEventId??null)!==(previous?.id??null))throw Error('후속 업무 이력 연결 오류');
  if(previous&&['projectId','decisionId','title','ownerUid','reviewerUid','due','criteria'].some(field=>event[field]!==previous[field]))throw Error('후속 업무 원래 명세는 변경할 수 없습니다');
  if(!previous&&(event.status!=='todo'||event.actorRole!=='admin'||['result','resultUrl','completedBy','completedAt','selfReview','selfReviewReason'].some(field=>event[field]!==undefined)))throw Error('후속 업무 최초 이력 오류');
  if(previous){
   if(!transitions[previous.status].includes(event.status)||Date.parse(event.at)<Date.parse(previous.at))throw Error('후속 업무 이력 전환·시각 오류');
   if(event.status==='done'){
    if(event.actorRole!=='admin'&&event.actorUid!==event.reviewerUid||event.completedBy!==event.actorUid||event.completedAt!==event.at||event.selfReview!==(event.actorUid===event.ownerUid)||event.selfReview&&!text(event.selfReviewReason)||!event.selfReview&&event.selfReviewReason!==undefined)throw Error('후속 업무 완료 검토 이력 오류');
   }else if(event.actorRole!=='admin'&&event.actorUid!==event.ownerUid||event.status==='cancelled'&&event.actorRole!=='admin')throw Error('후속 업무 담당자 이력 오류');
   if(event.status!=='review'&&(event.result!==previous.result||event.resultUrl!==previous.resultUrl))throw Error('후속 업무 결과 이력 불일치');
   if(event.status!=='done'&&['completedBy','completedAt','selfReview','selfReviewReason'].some(field=>event[field]!==undefined))throw Error('후속 업무 미완료 이력 오류');
  }
  if(event.status==='review'||event.status==='done'||event.resultUrl!==undefined)if(!text(event.result)||!resultURL(event.resultUrl))throw Error('후속 업무 결과 자료 이력 오류');
  seen.add(event.id);latest.set(event.taskId,event);
 }
 return [...latest.values()].map(event=>structuredClone(event));
}
export function applyFollowUp(project,events,command,user,{at=new Date().toISOString()}={}){
 if(!user?.uid||!['admin','member'].includes(user.role))throw Error('후속 업무 변경 권한이 없습니다');
 const latest=followUpTasks(events),previous=latest.find(task=>task.taskId===command.taskId);
 if(!key(command.eventId)||events.some(event=>event.id===command.eventId))throw Error('후속 업무 이벤트 ID 오류·중복');
 if(!key(command.taskId)||!text(command.reason)||!matches('at',at)||!Number.isFinite(Date.parse(at)))throw Error('후속 업무 ID·이유·시각 확인 필요');
 let event;
 if(command.type==='create'){
  if(user.role!=='admin')throw Error('관리자만 결정의 후속 업무를 생성할 수 있습니다');
  if(previous)throw Error('이미 생성한 후속 업무입니다');
  if(!project.research?.decisions?.some(decision=>decision.id===command.decisionId))throw Error('현재 프로젝트의 사업 결정을 선택하세요');
  if(!date(command.due))throw Error('유효한 업무 기한이 필요합니다');
  if(!text(command.title)||!key(command.ownerUid)||!key(command.reviewerUid)||!text(command.criteria))throw Error('업무 제목·담당자·검토자·완료 기준이 필요합니다');
  event={taskId:command.taskId,projectId:project.id,decisionId:command.decisionId,title:command.title.trim(),ownerUid:command.ownerUid,reviewerUid:command.reviewerUid,due:command.due,criteria:command.criteria.trim(),status:'todo',sequence:1,previousEventId:null};
 }else if(command.type==='transition'){
  if(!previous||previous.projectId!==project.id||previous.id!==command.previousEventId)throw Error('최신 후속 업무 이력을 다시 조회하세요');
  if(!transitions[previous.status].includes(command.status))throw Error('허용되지 않은 후속 업무 상태 전환');
  if(command.status==='done'){
   if(user.uid!==previous.reviewerUid&&user.role!=='admin')throw Error('지정 검토자만 완료를 확정할 수 있습니다');
   if(user.uid===previous.ownerUid&&!text(command.selfReviewReason))throw Error('자기검토 이유가 필요합니다');
  }else if(user.uid!==previous.ownerUid&&user.role!=='admin')throw Error('담당자 또는 관리자만 업무를 진행할 수 있습니다');
  if(command.status==='cancelled'&&user.role!=='admin')throw Error('관리자만 후속 업무를 취소할 수 있습니다');
  if(command.status==='review'&&(!text(command.result)||!resultURL(command.resultUrl)))throw Error('검토 요청에는 결과·안전한 결과 자료 링크가 필요합니다');
  event={...previous,status:command.status,sequence:previous.sequence+1,previousEventId:previous.id};
  if(command.status==='review'){event.result=command.result.trim();event.resultUrl=command.resultUrl;}
  if(command.status==='done'){event.completedBy=user.uid;event.completedAt=at;event.selfReview=user.uid===previous.ownerUid;if(event.selfReview)event.selfReviewReason=command.selfReviewReason.trim();}
 }else throw Error('지원하지 않는 후속 업무 작업');
 event={...event,id:command.eventId,actorUid:user.uid,actorRole:user.role,reason:command.reason.trim(),at};const next=[...structuredClone(events),event];followUpTasks(next);return next;
}
export function followUpHeads(events){return Object.fromEntries(followUpTasks(events).map(task=>[task.taskId,{eventId:task.id,sequence:task.sequence}]));}
export function validateFollowUpProject(project){
 const events=project.research?.followUpEvents??[],tasks=followUpTasks(events),heads=project.research?.followUpHeads??{};
 if(!heads||typeof heads!=='object'||Array.isArray(heads)||Object.keys(heads).length!==tasks.length)throw Error('후속 업무 최신 이력 목록 불일치');
 for(const task of tasks){
  if(task.projectId!==project.id||!project.research?.decisions?.some(decision=>decision.id===task.decisionId))throw Error('후속 업무 프로젝트·결정 참조 오류');
  const head=heads[task.taskId];if(!head||Object.keys(head).length!==2||head.eventId!==task.id||head.sequence!==task.sequence)throw Error('후속 업무 최신 이력 불일치');
 }
 return project;
}
