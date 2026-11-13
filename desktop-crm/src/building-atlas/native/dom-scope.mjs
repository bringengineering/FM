import {validate} from '../upstream/model.mjs';
function checked(value) {
 const p=structuredClone(value);
 if(!p || p.version!==2 || !Array.isArray(p.items) || !p.items.length || !p.items.some(i=>i.id===p.activeId)) throw Error('건물 자료 형식이 올바르지 않습니다.');
 const ids=new Set();for(const item of p.items){if(typeof item.id!=='string'||!item.id||ids.has(item.id))throw Error('건물 ID를 확인해주세요.');ids.add(item.id);validate(item.data);}
 return p;
}
/** Persistence is the only state commit point. Selection is intentionally memory-only. */
export function createMutationGate({initialPortfolio,savePortfolio,canWrite=false,mode='practice'}) {
 let portfolio=checked(initialPortfolio),busy=false,disposed=false;
 const companyId=portfolio.activeId;
 if(mode==='company' && (portfolio.items.length!==1||portfolio.items[0].id!==companyId))throw Error('회사 모드에는 선택한 CRM 건물 하나만 필요합니다.');
 const assertActive=()=>{if(disposed)throw Error('설비지도 작업이 종료되었습니다.');};
 const checkCompany=p=>{if(mode==='company'&&(p.activeId!==companyId||p.items.length!==1||p.items[0].id!==companyId))throw Error('선택한 CRM 건물만 변경할 수 있습니다.');};
 return {
  getPortfolio:()=>structuredClone(portfolio),assertActive,isBusy:()=>busy,
  select(id){assertActive();if(busy)throw Error('저장이 진행 중입니다.');if(!portfolio.items.some(i=>i.id===id))throw Error('건물을 찾을 수 없습니다.');const p={...portfolio,activeId:id};checkCompany(p);portfolio=p;},
  async commit(next,expectedId=portfolio.activeId){
   assertActive();if(!canWrite)throw Error('읽기 전용입니다.');if(busy)throw Error('저장이 진행 중입니다.');
   if(expectedId!==portfolio.activeId)throw Error('건물이 변경되었습니다. 다시 선택해주세요.');
   const candidate=checked(next);checkCompany(candidate);if(typeof savePortfolio!=='function')throw Error('저장 연결이 없습니다.');
   busy=true;
   try{const committed=checked(await savePortfolio(structuredClone(candidate)));assertActive();checkCompany(committed);portfolio=committed;return structuredClone(portfolio);}finally{busy=false;}
  },
  dispose(){disposed=true;}
 };
}
/** A local facade, never a patch to the browser document. */
export function createDOMScope(root,owner) {
 const abort=new AbortController(),cleanups=new Set();let disposed=false;
 const assertActive=()=>{if(disposed)throw Error('설비지도 작업이 종료되었습니다.');};
 const scope={
  body:root,root,signal:abort.signal,assertActive,
  createElement:tag=>owner.createElement(tag),
  getElementById:id=>root.querySelector('#'+id),
  querySelector:selector=>root.querySelector(selector),
  querySelectorAll:selector=>root.querySelectorAll(selector),
  addEventListener:(type,fn,options={})=>root.addEventListener(type,fn,{...(typeof options==='boolean'?{capture:options}:options),signal:abort.signal}),
  reportError:(id,error)=>{if(!disposed){const node=root.querySelector('#'+id);if(node)node.textContent=String(error?.message||error);}},
  emit:type=>{if(!disposed)root.dispatchEvent(new Event(type));},
  onDispose(fn){if(disposed)fn();else cleanups.add(fn);},
  dispose(){if(disposed)return;disposed=true;abort.abort();for(const fn of cleanups){try{fn();}catch{}}cleanups.clear();for(const node of root.querySelectorAll('*'))for(const key of ['onclick','onchange','oninput','onsubmit','onload','onerror'])if(key in node)node[key]=null;for(const dialog of root.querySelectorAll('dialog')){dialog.close?.();dialog.remove?.();}}
 };
 return scope;
}

/** GPU/display errors never change the outcome of an already committed write. */
export function createSafeViewer(resource,onFailure=()=>{}) {
 let disposed=false;
 function dispose(){if(disposed)return;disposed=true;try{resource?.dispose?.();}catch{/* Best effort after context loss. */}}
 const call=(method,args)=>{if(disposed)return;try{return resource?.[method]?.(...args);}catch(error){dispose();try{onFailure(error);}catch{/* Detached host. */}}};
 return {update:(...args)=>call('update',args),reset:(...args)=>call('reset',args),focus:(...args)=>call('focus',args),dispose};
}
