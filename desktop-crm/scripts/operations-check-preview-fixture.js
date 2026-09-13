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
 const methods={authState:async()=>({required:false,user}),load:async()=>{listeners.onSyncState?.({status:'connected',message:'가상 데이터 · 서버 연결 차단'});return clone();},dataPath:async()=>'가상 데이터 — 서버 접근 없음',loadCustomerPhotos:async()=>({}),loadCanonicalBuildingUnits:async()=>[],loadFieldSummaries:async()=>({}),loadFieldTeamProfiles:async()=>[],loadOperations:async()=>({cases:[],payments:{},caseSettings:{}}),loadWorkflowVendors:async()=>[],loadDriveImportCandidates:async()=>[],loadWorkReports:async()=>[],updateState:async()=>({status:'disabled',message:'미리보기'}),loadOffice:async()=>({}),loadContractSources:async()=>({})};
 window.bringCRM=new Proxy(methods,{get(target,key){if(key in target)return target[key];if(String(key).startsWith('on'))return callback=>{listeners[key]=callback;};if(/^(save|commit|delete|remove|create|send|login|logout|change|upload|import|restore|openExternal)/i.test(String(key)))return async()=>{blockedWrites++;throw new Error('테스트 실행: 쓰기/외부 작업 차단');};return async()=>({});}});
 let calendarConnected=new URLSearchParams(location.search).has('calendarSeed');
 methods.googleCalendar=async input=>{
   if(!new URLSearchParams(location.search).has('calendarSeed'))return {ok:true,status:'unconfigured',selectedCalendars:[],events:[]};
   if(input.action==='connect')return {ok:false,code:'CALENDAR_UNCONFIGURED'};
   if(input.action==='disconnect')calendarConnected=false;
   if(input.action==='select')calendarConnected=true;
   const base={ok:true,status:calendarConnected?'connected':'disconnected',accountEmail:'calendar-preview@example.invalid',selectedCalendars:calendarConnected?[{id:'preview-calendar',name:'가상 회사 업무 일정'}]:[],lastSyncedAt:new Date().toISOString()};
   if(input.action==='calendars')return {...base,calendars:[{id:'preview-calendar',name:'가상 회사 업무 일정'}]};
   if(input.action==='events')return {...base,events:calendarConnected?[{id:'google-preview-cleaning',calendarId:'preview-calendar',title:'가상 Google 입주청소',description:'읽기 전용 연동 시험',location:'가상 현장',start:'2026-09-13T10:00:00+09:00',end:'2026-09-13T12:00:00+09:00',allDay:false,status:'confirmed'},{id:'google-preview-all-day',calendarId:'preview-calendar',title:'가상 Google 현장 점검',start:'2026-09-14',end:'2026-09-16',allDay:true,status:'confirmed'}]:[]};
   return base;
 };
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
