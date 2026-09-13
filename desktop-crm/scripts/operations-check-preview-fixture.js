(() => {
 const listeners={};let blockedWrites=0;
 const data=window.BringCore.blankStore();
 data.settings.onboardingComplete=true;
 data.customers=[{id:'u1',name:'테스트 건물주',type:'건물주',owner:'테스트 담당자'}];
 data.buildings=[{id:'b1',name:'가상 관리빌딩',ownerCustomerId:'u1',address:'테스트 주소 1',manager:'테스트 담당자'},{id:'b2',name:'가상 청소빌라',address:'테스트 주소 2'},{id:'b3',name:'가상 단건상가',address:'테스트 주소 3'}];
 data.contracts=[{id:'c1',name:'가상 정기관리 계약',customerId:'u1',buildingId:'b1',type:'건물관리',types:['건물관리'],billingCycle:'월 정기',status:'진행 중',startDate:'2026-01-01',owner:'테스트 담당자'},{id:'c2',name:'가상 청소계약',buildingId:'b2',type:'청소',types:['청소'],billingCycle:'월 정기',status:'진행 중',startDate:'2026-01-01'}];
 data.serviceContracts=[];
 data.serviceRecords=[{id:'s1',title:'가상 청소 작업',buildingId:'b2',serviceType:'cleaning',status:'completed',completedAt:'2026-09-01',scheduledDate:'2026-09-01',owner:'테스트 담당자',summary:'증빙 미연결 테스트'},{id:'s2',title:'가상 점검',buildingId:'b1',customerId:'u1',contractId:'c1',status:'completed',completedAt:'2026-09-01',evidenceUrl:'https://example.invalid/evidence',owner:'테스트 담당자'}];
 const withReceipt=value=>({...value,operationsCheckReceipt:{uid:user.uid,role:user.accessRole,receivedAt:new Date().toISOString(),source:window.BringOperationsCheck.projectOperationsSource(value),availability:Object.fromEntries(['buildings','customers','contracts','serviceContracts','serviceRecords'].map(key=>[key,Object.hasOwn(value,key)]))}});
 const clone=()=>withReceipt(JSON.parse(JSON.stringify(data)));
 let user={uid:'preview-only',email:'preview@example.invalid',name:'테스트 담당자',accessRole:'admin',role:'admin',officeAdmin:true};
 const methods={authState:async()=>({required:false,user}),load:async()=>{listeners.onSyncState?.({status:'connected',message:'가상 데이터 · 서버 연결 차단'});return clone();},dataPath:async()=>'가상 데이터 — 서버 접근 없음',loadCustomerPhotos:async()=>({}),loadCanonicalBuildingUnits:async()=>[],loadFieldSummaries:async()=>({}),loadFieldTeamProfiles:async()=>[],loadOperations:async()=>({cases:[],payments:{},caseSettings:{}}),loadWorkflowVendors:async()=>[],loadDriveImportCandidates:async()=>[],loadWorkReports:async()=>[],updateState:async()=>({status:'disabled',message:'미리보기'}),loadOffice:async()=>({}),loadContractSources:async()=>({})};
 window.bringCRM=new Proxy(methods,{get(target,key){if(key in target)return target[key];if(String(key).startsWith('on'))return callback=>{listeners[key]=callback;};if(/^(save|commit|delete|remove|create|send|login|logout|change|upload|import|restore|openExternal)/i.test(String(key)))return async()=>{blockedWrites++;throw new Error('테스트 실행: 쓰기/외부 작업 차단');};return async()=>({});}});
 if(new URLSearchParams(location.search).get('previewLoading')==='1') methods.load=async()=>{
   listeners.onSyncState?.({status:'syncing',message:'가상 초기 로딩'});
   const value=window.BringCore.blankStore();value.settings.onboardingComplete=true;return value;
 };
 // Visible controls exercise only fixture callbacks; no network or credential access.
 window.addEventListener('DOMContentLoaded',()=>{
   const bar=document.createElement('div');bar.style.cssText='position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#17384d;color:white;padding:8px;display:flex;gap:8px;align-items:center;font-size:12px';
   bar.innerHTML='<b>가상 데이터 · 회사 서버 접근 차단</b><button data-preview-state="connected">정상</button><button data-preview-state="offline">연결 실패</button><button data-preview-state="empty">0건</button><button data-preview-state="partial">부분 조회</button><button data-preview-state="viewer">조회 직원</button><span id="previewWrites">서버 쓰기 0회</span>';
   document.body.appendChild(bar);bar.addEventListener('click',event=>{const state=event.target.dataset.previewState;if(!state)return;
     if(state==='viewer'){user={...user,uid:'preview-viewer',role:'viewer',accessRole:'viewer',officeAdmin:false};listeners.onAuthState?.({required:false,enforceRoles:true,user});}
     listeners.onSyncState?.({status:state==='offline'?'offline':'connected',message:'가상 상태'});
     if(state!=='offline'){const value=state==='empty'?window.BringCore.blankStore():clone();value.settings.onboardingComplete=true;if(state==='partial')delete value.contracts;listeners.onRemoteData?.(withReceipt(value));}
     document.getElementById('previewWrites').textContent=`차단된 쓰기 시도 ${blockedWrites}회`;
   });
 });
})();
