const {isDeepStrictEqual}=require('node:util');
const key=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);
const list=value=>Array.isArray(value)?value:Object.values(value??{});
function eventMap(value){const records=list(value),seen=new Set();for(const event of records){if(!event||!key(event.id)||seen.has(event.id))throw Error('후속 업무 이력 ID 오류·중복');seen.add(event.id);}return Object.fromEntries(records.map(event=>[event.id,event]));}
function patchFollowUpHeads(previous,value,{actorUid}={}){
 const oldEvents=eventMap(previous?.research?.followUpEvents);
 const events=eventMap(value.research?.followUpEvents);
 const old=previous?.research?.followUpHeads??{},heads=value.research?.followUpHeads??{},patch={};
 if(!heads||typeof heads!=='object'||Array.isArray(heads))throw Error('후속 업무 최신 이력 형식 오류');
 for(const [id,head] of Object.entries(old))if(!Object.hasOwn(heads,id))throw Error('후속 업무 최신 이력은 삭제할 수 없습니다');
 for(const [id,head] of Object.entries(heads)){
  if(!key(id)||!head||Object.keys(head).length!==2||!key(head.eventId)||!Number.isInteger(head.sequence)||head.sequence<1)throw Error('후속 업무 최신 이력 형식 오류');
  if(isDeepStrictEqual(old[id],head))continue;
  const event=events[head.eventId];
  if(!event||oldEvents[head.eventId]||event.projectId!==value.id||event.taskId!==id||event.sequence!==head.sequence||(event.previousEventId??null)!==(old[id]?.eventId??null)||head.sequence!==(old[id]?.sequence??0)+1)throw Error('후속 업무 최신 이력에서 한 단계씩 변경하세요');
  if(actorUid!==undefined&&event.actorUid!==actorUid)throw Error('후속 업무 작성자 확인 실패');
  patch[`projects/${value.id}/research/followUpHeads/${id}`]=head;
 }
 for(const [id,event] of Object.entries(events))if(!oldEvents[id]&&heads[event.taskId]?.eventId!==id)throw Error('후속 업무 새 이력과 최신 이력 불일치');
 return patch;
}
module.exports={patchFollowUpHeads};
