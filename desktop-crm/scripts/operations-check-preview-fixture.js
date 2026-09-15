(() => {
 const listeners={};let blockedWrites=0;
 const data=window.BringCore.blankStore();
 data.settings.onboardingComplete=true;
 data.customers=[{id:'u1',name:'테스트 건물주',type:'건물주',owner:'테스트 담당자'}];
 data.buildings=[{id:'b1',name:'가상 관리빌딩',ownerCustomerId:'u1',address:'테스트 주소 1',manager:'테스트 담당자'},{id:'b2',name:'가상 청소빌라',address:'테스트 주소 2'},{id:'b3',name:'가상 단건상가',address:'테스트 주소 3'}];
 data.contracts=[{id:'c1',name:'가상 정기관리 계약',customerId:'u1',buildingId:'b1',type:'건물관리',types:['건물관리'],billingCycle:'월 정기',status:'진행 중',startDate:'2026-01-01',owner:'테스트 담당자'},{id:'c2',name:'가상 청소계약',buildingId:'b2',type:'청소',types:['청소'],billingCycle:'월 정기',status:'진행 중',startDate:'2026-01-01'}];
 data.serviceContracts=[];
 data.serviceRecords=[{id:'s1',title:'가상 청소 작업',buildingId:'b2',serviceType:'cleaning',status:'completed',completedAt:'2026-09-01',scheduledDate:'2026-09-01',owner:'테스트 담당자',summary:'증빙 미연결 테스트'},{id:'s2',title:'가상 점검',buildingId:'b1',customerId:'u1',contractId:'c1',status:'completed',completedAt:'2026-09-01',evidenceUrl:'https://example.invalid/evidence',owner:'테스트 담당자'}];
 // Opt-in synthetic unified workspace cases. Never read production customer data.
 if(new URLSearchParams(location.search).has('unifiedSeed')) {
   data.customers[0]={...data.customers[0],buildingIds:['b1','b2'],phone:'010-0000-0000',notes:'가상 메모: 방문 전 일정 확인',currentIssue:'가상 공용부 청소 문의'};
   data.customers.push({id:'u2',name:'가상 미연결 고객',type:'상가',phone:'010-0000-0001',notes:'건물 주소 확인 예정',owner:'테스트 담당자'});
   data.buildings[1].ownerCustomerId='u1';
   data.buildings[0].status='관리 중';
   data.activities=[{id:'a1',customerId:'u1',type:'전화',summary:'가상 상담: 공용부 청소 일정 확인',occurredAt:'2026-09-13T09:00:00+09:00',owner:'테스트 담당자'}];
 }
 const withReceipt=value=>({...value,operationsCheckReceipt:{uid:user.uid,role:user.accessRole,receivedAt:new Date().toISOString(),source:window.BringOperationsCheck.projectOperationsSource(value),availability:Object.fromEntries(['buildings','customers','contracts','serviceContracts','serviceRecords'].map(key=>[key,Object.hasOwn(value,key)]))}});
 const clone=()=>withReceipt(JSON.parse(JSON.stringify(data)));
 const atlasRecords=new Map();let atlasFailure=false;
 if(new URLSearchParams(location.search).has('atlasNoWebGL')) {
   const originalContext=HTMLCanvasElement.prototype.getContext;
   HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/i.test(type)?null:originalContext.call(this,type,...args);};
 }
 let user={uid:'preview-only',email:'preview@example.invalid',name:'테스트 담당자',accessRole:'admin',role:'admin',officeAdmin:true};
 const weeklyPreview=new URLSearchParams(location.search).get('weeklySeed')==='1';
 const performancePreview=new URLSearchParams(location.search).get('performanceSeed')==='1';
 if(weeklyPreview&&new URLSearchParams(location.search).get('weeklyRole')==='member')user={...user,role:'member',accessRole:'member',officeAdmin:false};
 const methods={authState:async()=>({required:false,user}),load:async()=>{listeners.onSyncState?.({status:'connected',message:'가상 데이터 · 서버 연결 차단'});return clone();},dataPath:async()=>'가상 데이터 — 서버 접근 없음',loadCustomerPhotos:async()=>({}),loadCanonicalBuildingUnits:async()=>[],loadFieldSummaries:async()=>({}),loadFieldTeamProfiles:async()=>[],loadOperations:async()=>({cases:[],payments:{},caseSettings:{}}),loadWorkflowVendors:async()=>[],loadDriveImportCandidates:async()=>[],loadWorkReports:async()=>[],updateState:async()=>({status:'disabled',message:'미리보기'}),loadOffice:async()=>({}),loadContractSources:async()=>({})};
 window.bringCRM=new Proxy(methods,{get(target,key){if(key in target)return target[key];if(String(key).startsWith('on'))return callback=>{listeners[key]=callback;};if(/^(save|commit|delete|remove|create|send|login|logout|change|upload|import|restore|openExternal)/i.test(String(key)))return async()=>{blockedWrites++;throw new Error('테스트 실행: 쓰기/외부 작업 차단');};return async()=>({});}});
 // Do not let the catch-all proxy advertise desktop-only recovery capability.
 // Only the explicit synthetic recovery scenario below implements these methods.
 Object.assign(methods,{loadWorkOutcomeDraft:undefined,saveWorkOutcomeDraft:undefined,clearWorkOutcomeDraft:undefined});
 if(new URLSearchParams(location.search).get('recoverySeed')==='1') {
   // Synthetic in-memory recovery only: no real file, customer or server access.
   const drafts=new Map([['performance-3',{baseReport:'',savedAt:new Date().toISOString(),draft:{summary:'가상 복구 초안: 공간 사진 8곳 확인',contribution:'',blockers:'',nextAction:'',decisionRequest:'',metrics:[],evidence:[{title:'가상 증빙',url:'https://example.com/proof'}]}}]]);
   methods.loadWorkOutcomeDraft=async({orderId})=>structuredClone(drafts.get(orderId)||null);
   methods.saveWorkOutcomeDraft=async({orderId,value})=>{const savedAt=new Date().toISOString();drafts.set(orderId,{...structuredClone(value),savedAt});return {savedAt};};
   methods.clearWorkOutcomeDraft=async({orderId})=>{drafts.delete(orderId);return {ok:true};};
 }
 // Explicit synthetic records for editor-only QA. The proxy still blocks work-order saves.
 if(weeklyPreview||performancePreview)methods.loadWorkOrders=async()=>({
   admin:user.accessRole==='admin',canWork:true,uid:user.uid,orders:performancePreview?['assigned','doing','submitted','returned','done'].map((status,index)=>({id:`performance-${index}`,title:`가상 성과 점검 ${index+1}`,projectId:'preview-project-0',assigneeUid:user.uid,status,startDate:'2026-09-14',dueDate:'2026-09-18',updatedAt:'2026-09-14T00:00:00Z',reviewNote:index===3?'가상 검수 의견: 보완 필요':'',results:index>=2?[{id:`result-${index}`,title:'가상 결과물',note:'가상 제출 메모 · 실제 성과 아님'}]:[]})):[],capacity:[],directives:[],
   members:[{uid:'preview-only',displayName:'가상 대표'},{uid:'preview-member',displayName:'가상 직원'}],
   projects:Array.from({length:6},(_,index)=>({id:`preview-project-${index}`,name:`가상 프로젝트 ${index+1}`,status:'active'}))
 });
 if(weeklyPreview||performancePreview) {
   const loadPreviewOrders=methods.loadWorkOrders;
   methods.loadWorkOrders=async()=>{const value=await loadPreviewOrders();
     if(value.orders[2])value.orders[2].outcomeReport=JSON.stringify({summary:'가상 결과: 공간 사진 확인 · 실제 회사 실적 아님',contribution:'가상 촬영 담당',blockers:'가상 미확인 공간 2곳',nextAction:'가상 재방문 일정 확인',decisionRequest:'가상 출입 승인 요청',metrics:[{label:'가상 촬영 공간',target:10,actual:8,unit:'곳'}],evidence:[{title:'가상 증빙',url:'https://example.com/proof'}]});
     return {...value,performanceOrders:JSON.parse(JSON.stringify(value.orders))};};
 }
 if(new URLSearchParams(location.search).has('unifiedSeed')) methods.loadCanonicalBuildingUnits=async()=>[
   {id:'unit-preview-101',crmBuildingId:'b1',label:'가상 101호',floorLabel:'1층',status:'vacant'},
   {id:'unit-preview-other',crmBuildingId:'b2',label:'다른 건물 201호',floorLabel:'2층',status:'occupied'}
 ];
 methods.loadBuildingAtlas=async({buildingId})=>{
   if(new URLSearchParams(location.search).has('atlasSeed')&&(!new URLSearchParams(location.search).has('unifiedSeed')||buildingId==='b1')&&!atlasRecords.has(buildingId)) {
     const {demo}=await import('../building-atlas/upstream/model.mjs');
     atlasRecords.set(buildingId,{buildingId,revision:1,model:demo()});
   }
   return {ok:true,record:structuredClone(atlasRecords.get(buildingId)||null),etag:String(atlasRecords.get(buildingId)?.revision||0),canWrite:user.accessRole!=='viewer'};
 };
 methods.saveBuildingAtlas=async({buildingId,model,expectedRevision,etag})=>{
   if(atlasFailure)return {ok:false,error:{code:'ATLAS_ERROR',message:'가상 저장 실패 · 편집 내용 유지'}};
   if(user.accessRole==='viewer')return {ok:false,error:{code:'PERMISSION_DENIED',message:'조회 전용'}};
   const revision=atlasRecords.get(buildingId)?.revision||0;
   if(revision!==expectedRevision||etag!==String(revision))return {ok:false,error:{code:'ATLAS_CONFLICT',message:'가상 저장 충돌'}};
   atlasRecords.set(buildingId,{buildingId,revision:revision+1,model:structuredClone(model)});
   return methods.loadBuildingAtlas({buildingId});
 };
 if(new URLSearchParams(location.search).get('previewLoading')==='1') methods.load=async()=>{
   listeners.onSyncState?.({status:'syncing',message:'가상 초기 로딩'});
   const value=window.BringCore.blankStore();value.settings.onboardingComplete=true;return value;
 };
 // Visible controls exercise only fixture callbacks; no network or credential access.
 window.addEventListener('DOMContentLoaded',()=>{
   const bar=document.createElement('div');bar.style.cssText='position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#17384d;color:white;padding:8px;display:flex;gap:8px;align-items:center;font-size:12px';
   bar.innerHTML='<b>가상 데이터 · 회사 서버 접근 차단</b><button data-preview-state="connected">정상</button><button data-preview-state="offline">연결 실패</button><button data-preview-state="empty">0건</button><button data-preview-state="partial">부분 조회</button><button data-preview-state="viewer">조회 직원</button><span id="previewWrites">서버 쓰기 0회</span>';
   const failButton=document.createElement('button');failButton.textContent='지도 저장 실패 켜기';failButton.onclick=()=>{atlasFailure=!atlasFailure;failButton.textContent=atlasFailure?'지도 저장 실패 끄기':'지도 저장 실패 켜기';};bar.append(failButton);
   document.body.appendChild(bar);bar.addEventListener('click',event=>{const state=event.target.dataset.previewState;if(!state)return;
     if(state==='viewer'){user={...user,uid:'preview-viewer',role:'viewer',accessRole:'viewer',officeAdmin:false};listeners.onAuthState?.({required:false,enforceRoles:true,user});}
     listeners.onSyncState?.({status:state==='offline'?'offline':'connected',message:'가상 상태'});
     if(state!=='offline'){const value=state==='empty'?window.BringCore.blankStore():clone();value.settings.onboardingComplete=true;if(state==='partial')delete value.contracts;listeners.onRemoteData?.(withReceipt(value));}
     document.getElementById('previewWrites').textContent=`차단된 쓰기 시도 ${blockedWrites}회`;
   });
 });
})();
