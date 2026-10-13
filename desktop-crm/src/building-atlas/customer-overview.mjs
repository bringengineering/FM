import {filterCustomerOverview,customerOverviewDate} from './customer-overview-core.mjs';
import {mountCustomerWorkspace} from './customer-workspace.mjs';

// Independently implemented UI patterns; no third-party CRM code is embedded.
export async function mountCustomerOverview(options={}) {
    const {host, metricsHost=host, getOverview, getCustomers, getBuildings, getVisibleCustomerIds,
    getProfile, getSections, getSummary=()=>[], canWrite=()=>false, onAddWork=()=>{},
    initialCustomerId, initialBuildingId, signal} = options;
  const doc=host.ownerDocument;
  const el=(tag, text='', className='')=>{const node=doc.createElement(tag);node.textContent=String(text??'');if(className)node.className=className;return node;};
  const button=(text, handler, className='secondary-button')=>{const node=el('button',text,className);node.type='button';if(handler)node.onclick=handler;return node;};
  const action=(text, attribute, value)=>{const node=button(text);node.setAttribute(attribute,String(value));return node;};
  const css=el('link');css.rel='stylesheet';css.href=new URL('./customer-overview.css',import.meta.url).href;
  const shell=el('section','','customer-overview');
  const metrics=el('section','','customer-overview-metrics');metrics.setAttribute('aria-label','고객 업무 현황');
  const list=el('section','','customer-overview-list'), toolbar=el('div','','customer-overview-tools'), tabs=el('div','','customer-overview-filters');
  tabs.setAttribute('aria-label','고객 목록 보기');
  const sort=el('select');sort.setAttribute('aria-label','고객 정렬');
  for(const [id,label] of [['recent','최근 상담순'],['name','고객 이름순'],['status','관리 상태순']]){const option=el('option',label);option.value=id;sort.append(option);}
  const tableWrap=el('div','','customer-overview-table-wrap'), table=el('table','','customer-overview-table');
  const head=el('thead'), header=el('tr'), body=el('tbody');
  for(const label of ['고객·건물','관리 상태','요청·진행 업무','최근 상담','담당자']){const cell=el('th',label);cell.scope='col';header.append(cell);}
  head.append(header);table.append(head,body);tableWrap.append(table);
  const empty=el('p','','customer-overview-empty'), footer=el('footer','','customer-overview-footer');footer.setAttribute('aria-live','polite');
  toolbar.append(tabs,sort);list.append(toolbar,tableWrap,empty,footer);
  const drawer=el('aside','','customer-overview-drawer');drawer.hidden=true;drawer.setAttribute('role','dialog');drawer.setAttribute('aria-label','고객 빠른 상세');
  const drawerHead=el('header','','customer-overview-drawer-head'), identity=el('div'), title=el('h2'), subtitle=el('p');identity.append(el('small','고객 빠른 상세'),title,subtitle);
  const close=button('×',()=>closeDetail(),'close-button');close.setAttribute('aria-label','고객 상세 닫기');drawerHead.append(identity,close);
  const actions=el('div','','customer-overview-actions'), current=el('section','','customer-overview-current'), profile=el('section','','customer-overview-profile');
  const recordTabs=el('div','','customer-overview-record-tabs'), recordBody=el('div','','customer-overview-record-body');
  recordTabs.setAttribute('role','tablist');recordTabs.setAttribute('aria-label','고객 상세 기록');recordBody.id='customer-overview-record-panel';recordBody.setAttribute('role','tabpanel');
  const extra=el('details','','customer-overview-extra'), extraSummary=el('summary','추가 정보 · 주문·결제·CS·3D 자료'), extraRows=el('div'), extraMetrics=el('div','','customer-overview-extra-metrics');
  const modelControls=el('div','','customer-overview-actions'), modelHost=el('div','','customer-overview-model');
  const modelOpen=button('3D 설비지도 열기',()=>openModel());modelControls.append(modelOpen);
  extra.append(extraSummary,extraMetrics,extraRows,modelControls,modelHost);
  drawer.append(drawerHead,actions,current,profile,recordTabs,recordBody,extra);
  shell.append(list,drawer);host.replaceChildren(css,shell);if(metricsHost===host)shell.prepend(metrics);else metricsHost.replaceChildren(metrics);
  let disposed=false,busy=false,selectedCustomerId=null,selectedBuildingId=null,activeTab='summary',filter='all',model=null,modelAbort=null,modelLoading=null;
  const data=()=>getOverview()||{rows:[],totals:{contracts:0,work:0,prospects:0,customers:0}};
  const row=()=>data().rows.find(item=>item.id===selectedCustomerId);
  const statusTag=text=>el('span',text,`customer-overview-status ${text==='관리 중'?'active':text==='관리 종료'?'closed':'preparing'}`);
  const date=customerOverviewDate;
  function appendSections(target, sections){
    target.replaceChildren();
    for(const section of sections||[]){
      const group=el('section','','customer-overview-record-group');group.append(el('h3',section.title));
      const lines=section.lines||[];
      for(const line of lines)group.append(el('p',line));
      for(const entry of section.actions||[]){
        if(!/^data-[a-z0-9-]+$/.test(entry.attribute||''))continue;
        const control=action(entry.label,entry.attribute,entry.value);
        for(const [key,value] of Object.entries(entry.attributes||{}))if(/^data-[a-z0-9-]+$/.test(key)&&value!=null)control.setAttribute(key,String(value));
        group.append(control);
      }
      for(const resource of section.resources||[]){const line=el('p',resource.name||'사진');if(/^https:\/\//i.test(resource.url||''))line.append(action('원본 열기','data-case-resource-link',resource.url));group.append(line);}
      if(!lines.length&&!section.actions?.length&&!section.resources?.length)group.append(el('p','등록된 자료 없음'));
      target.append(group);
    }
  }
  function renderList(){
    const all=data(), rows=filterCustomerOverview(all.rows,{filter,sort:sort.value||'recent',visibleIds:getVisibleCustomerIds?.()});
    metrics.replaceChildren();tabs.replaceChildren();
    const definitions=[['contracts','진행 계약','진행 중·종료 예정 계약','건'],['work','진행 업무','완료·취소·보관 제외','건'],['prospects','상담·견적 고객','계약 전 · 상담·견적·관리 예정','명']];
    for(const [key,label,note,unit] of definitions){
      const metric=button('',()=>{filter=filter===key?'all':key;renderList();},'customer-overview-metric');metric.setAttribute('aria-pressed',String(filter===key));
      metric.append(el('span',label),el('strong',`${all.totals[key]}${unit}`),el('small',note));metrics.append(metric);
    }
    for(const [key,label] of [['all','전체'],['contracts','진행 계약'],['work','진행 업무'],['prospects','상담·견적']]){const control=button(label,()=>{filter=key;renderList();},'customer-overview-filter');control.setAttribute('aria-pressed',String(filter===key));tabs.append(control);}
    body.replaceChildren();
    for(const item of rows){
      const tr=el('tr');if(item.id===selectedCustomerId&&!drawer.hidden)tr.className='selected';
      const customer=el('td'), link=button(item.name,()=>selectCustomer(item.id),'customer-overview-customer');link.setAttribute('aria-label',`${item.name} 빠른 상세`);
      customer.append(link,el('small',item.buildings.map(building=>building.name).join(' · ')||'건물 정보 없음'));
      if(item.phone)customer.append(el('small',item.phone));
      const status=el('td');status.append(statusTag(item.status));if(item.prospect)status.append(el('small','상담·견적 · 계약 전'));
      const work=el('td');work.append(el('b',item.nextAction||item.works[0]?.title||item.request),el('small',item.request),el('small',`계약 ${item.contractCount}건 · 진행 업무 ${item.workCount}건`));
      const last=el('td',date(item.lastConsultation));last.append(el('small',`상담 ${item.consultationCount}건`));
      tr.append(customer,status,work,last,el('td',item.owner));body.append(tr);
    }
    empty.hidden=rows.length>0;empty.textContent=all.rows.length?'조건에 맞는 고객이 없습니다. 검색어나 관리 상태를 바꿔 주세요.':'등록된 고객이 없습니다. 고객 등록부터 시작해 주세요.';
    footer.textContent=`${rows.length}명 표시 · 전체 ${all.totals.customers}명 · 현재 CRM에 불러온 기록 기준 · 고객 이름을 누르면 빠른 상세가 열립니다.`;
  }
  function renderDetail(){
    if(drawer.hidden||disposed)return;
    const customer=row(), building=getBuildings().find(item=>item.id===selectedBuildingId);
    const stale=Boolean((selectedCustomerId&&!customer)||(selectedBuildingId&&!building)||(customer&&selectedBuildingId&&!customer.buildings.some(item=>item.id===selectedBuildingId)));
    title.textContent=customer?.name||building?.name||'선택 정보를 확인해 주세요';
    subtitle.textContent=stale?'고객·건물 연결이 변경되었습니다. 목록에서 다시 선택해 주세요.':[building?.name,customer?.owner,customer?.status].filter(Boolean).join(' · ');
    actions.replaceChildren();current.replaceChildren();profile.replaceChildren();recordTabs.replaceChildren();recordBody.replaceChildren();extraRows.replaceChildren();extraMetrics.replaceChildren();
    extra.hidden=stale;modelOpen.disabled=busy||!building;
    if(stale)return;
    if(customer){
      const consult=action('＋ 상담 기록','data-action','new-consultation');consult.setAttribute('data-customer-id',customer.id);consult.className='primary-button';consult.disabled=!canWrite();
      const addWork=button('＋ 할 일',()=>onAddWork(customer.id,selectedBuildingId));addWork.disabled=!canWrite()||!building;
      const edit=action('고객 정보 수정','data-customer-hub-edit',customer.id);edit.disabled=!canWrite();actions.append(consult,addWork,edit);
      const buildings=el('select');buildings.setAttribute('aria-label','상세 건물 선택');
      for(const b of customer.buildings){const option=el('option',b.name);option.value=b.id;buildings.append(option);}
      if(customer.buildings.length>1){buildings.value=selectedBuildingId;buildings.onchange=async()=>{const selected=await select(customer.id,buildings.value);if(!selected)buildings.value=selectedBuildingId;};actions.append(buildings);}
      current.append(el('h3','진행 업무'),el('p',customer.nextAction||customer.works[0]?.title||'등록된 진행 업무 없음'),el('small',`계약 ${customer.contractCount}건 · 진행 업무 ${customer.workCount}건`));
    }
    const sections=getSections(selectedCustomerId,selectedBuildingId)||[];
    const consultation=sections.filter(section=>/상담/.test(section.title));
    const documents=sections.filter(section=>/계약|사진|문서/.test(section.title));
    const basics=(getProfile(selectedCustomerId,selectedBuildingId)||[]).filter(section=>section.title!==building?.name).map(section=>({...section,lines:(section.lines||[]).filter(line=>!String(line).startsWith('다음 연락:'))}));
    const panels={summary:[{title:'현재 요청',lines:[customer?.request||'등록된 요청 없음']},...basics],consults:consultation,docs:documents};
    const detailTabs=[['summary','요약'],['consults','상담 기록'],['docs','계약·자료']];
    for(const [index,[id,label]] of detailTabs.entries()){
      const control=button(label,()=>{activeTab=id;renderDetail();},'customer-overview-record-tab');control.id=`customer-overview-${id}-tab`;control.setAttribute('role','tab');control.setAttribute('aria-controls',recordBody.id);control.setAttribute('aria-selected',String(activeTab===id));recordTabs.append(control);
      control.tabIndex=activeTab===id?0:-1;control.onkeydown=event=>{const next={ArrowRight:(index+1)%detailTabs.length,ArrowLeft:(index+detailTabs.length-1)%detailTabs.length,Home:0,End:detailTabs.length-1}[event.key];if(next!==undefined){event.preventDefault();activeTab=detailTabs[next][0];renderDetail();doc.getElementById?.(`customer-overview-${activeTab}-tab`)?.focus();}};
    }
    recordBody.setAttribute('aria-labelledby',`customer-overview-${activeTab}-tab`);appendSections(recordBody,panels[activeTab]);
    const extras=sections.filter(section=>!consultation.includes(section)&&!documents.includes(section));appendSections(extraRows,extras);
    const detailActions=el('div','','customer-overview-actions');
    if(customer)detailActions.append(action('전체 상세','data-customer-open',customer.id));
    if(building){const editBuilding=action('건물 정보 수정','data-building-edit',building.id);editBuilding.disabled=!canWrite();detailActions.append(editBuilding);}
    extraRows.prepend(detailActions);
    for(const item of getSummary(selectedCustomerId,selectedBuildingId)||[]){const metric=el('div');metric.append(el('small',item.label),el('b',item.value),el('small',item.note));extraMetrics.append(metric);}
  }
  async function select(customerId,buildingId){
    if(disposed||busy)return false;
    const customer=data().rows.find(item=>item.id===customerId);
    if(customerId&&!customer)return false;
    if(buildingId&&!getBuildings().some(item=>item.id===buildingId))return false;
    if(customer&&buildingId&&!customer.buildings.some(item=>item.id===buildingId))return false;
    busy=true;
    try{
      if(model&&!(await model.select(customerId,buildingId)))return false;
      if(modelLoading&&!model){modelAbort?.abort();modelHost.replaceChildren();modelOpen.hidden=false;}
      if(disposed)return false;
      selectedCustomerId=customerId||null;selectedBuildingId=buildingId||null;drawer.hidden=false;activeTab='summary';renderList();renderDetail();return true;
    }finally{busy=false;if(!disposed)modelOpen.disabled=Boolean(modelLoading)||!getBuildings().some(item=>item.id===selectedBuildingId);}
  }
  function selectCustomer(id){const customer=data().rows.find(item=>item.id===id);return customer?select(id,customer.buildings.find(item=>item.id===selectedBuildingId)?.id||customer.buildings[0]?.id||null):Promise.resolve(false);}
  async function closeDetail(){
    if(disposed||busy)return false;
    if(model&&!(await model.requestLeave()))return false;
    modelAbort?.abort();model?.dispose();model=null;modelAbort=null;modelHost.replaceChildren();modelOpen.hidden=false;drawer.hidden=true;renderList();return true;
  }
  async function openModel(){
    if(disposed||model||modelLoading||!selectedBuildingId)return;
    modelAbort=new AbortController();const controller=modelAbort;modelOpen.disabled=true;modelOpen.textContent='3D 자료를 여는 중입니다';
    const customerId=selectedCustomerId,buildingId=selectedBuildingId;
    modelLoading=mountCustomerWorkspace({...options,host:modelHost,metricsHost:undefined,initialCustomerId:customerId,initialBuildingId:buildingId,signal:modelAbort.signal});
    try{const handle=await modelLoading;if(disposed||selectedCustomerId!==customerId||selectedBuildingId!==buildingId||controller.signal.aborted){handle.dispose();return;}model=handle;modelOpen.hidden=true;}
    catch{if(!disposed){modelHost.replaceChildren(el('p','3D 자료를 열지 못했습니다. 다시 시도해 주세요.'));}}
    finally{modelLoading=null;if(!disposed){modelOpen.disabled=false;modelOpen.textContent='3D 설비지도 열기';}}
  }
  function dispose(){if(disposed)return;disposed=true;modelAbort?.abort();model?.dispose();signal?.removeEventListener('abort',dispose);host.replaceChildren();if(metricsHost!==host)metricsHost.replaceChildren();}
  signal?.addEventListener('abort',dispose,{once:true});
  sort.onchange=renderList;renderList();
  if(initialCustomerId)await selectCustomer(initialCustomerId);
  else if(initialBuildingId){const customer=data().rows.find(item=>item.buildings.some(building=>building.id===initialBuildingId));await select(customer?.id||null,initialBuildingId);}
  if(signal?.aborted)dispose();
  return {select,selectCustomer,selection:()=>({customerId:selectedCustomerId,buildingId:selectedBuildingId}),requestLeave:()=>model?.requestLeave()??Promise.resolve(true),updateBuildings(){if(disposed)return;model?.updateBuildings(getBuildings());renderList();renderDetail();},dispose};
}
