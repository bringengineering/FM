// Read-only CRM projection. Model IO remains exclusively in the existing host.
export async function mountCustomerWorkspace({host,getCustomers,getBuildings,getVisibleCustomerIds=()=>getCustomers().map(c=>c.id),getVisibleBuildings=getBuildings,getProfile,getSections,getReferenceTargets=()=>[],mountAtlas,initialCustomerId,initialBuildingId,signal}={}) {
 const doc=host.ownerDocument;
 const el=(tag,text,id)=>{const n=doc.createElement(tag);if(text)n.textContent=text;if(id)n.id=id;return n;};
 const css=el('link');css.rel='stylesheet';css.href=new URL('./customer-workspace.css',import.meta.url).href;
 const shell=el('section');shell.className='customer-atlas-workspace';
 const list=el('aside',null,'customer-atlas-list'),content=el('section'),heading=el('header'),top=el('div'),stage=el('div'),profile=el('aside'),history=el('section'),tabs=el('div'),body=el('div'),modelColumn=el('div');
 content.className='customer-atlas-content';top.className='customer-atlas-top';profile.className='customer-atlas-profile';history.className='customer-atlas-history';tabs.className='customer-atlas-tabs';tabs.setAttribute('role','tablist');
 heading.className='customer-atlas-heading';
 stage.className='customer-atlas-stage';
 modelColumn.className='customer-atlas-model-column';
 list.setAttribute('aria-label','고객·건물 선택');
 profile.setAttribute('aria-label','고객 정보와 모형 연결');
 tabs.setAttribute('aria-label','관련 업무 기록');
 body.id='customer-atlas-record-panel';
 body.setAttribute('role','tabpanel');
 body.tabIndex=0;
 history.append(el('h3','관련 업무 기록'),tabs,body);
 modelColumn.append(heading,stage,history);
 top.append(modelColumn,profile);
 content.append(top);shell.append(list,content);host.replaceChildren(css,shell);
 let atlas,disposed=false,busy=false,tab=0,selectedRecord=null,referenceWritable=false,referenceError='',referenceBusy=false,pendingBuildingId;
 const referencePanel=el('section',null,'atlas-reference-panel');
 const requestedBuilding=getBuildings().find(b=>b.id===initialBuildingId);
 const first=getCustomers().find(c=>c.id===initialCustomerId)||getCustomers().find(c=>c.buildings.some(b=>b.id===initialBuildingId))||(requestedBuilding?null:getCustomers()[0]);
 let customerId=first?.id||null,buildingId=first?.buildings.find(b=>b.id===initialBuildingId)?.id||first?.buildings[0]?.id||(!first?initialBuildingId:null)||null;
 let chooserExpanded=!buildingId;
 const button=(label,attr,value)=>{const b=el('button',label);b.type='button';if(attr)b.setAttribute(attr,value);return b;};
 function referenceTargets(id){return (getReferenceTargets(id)||[]).filter(t=>t.buildingId===id&&['unit','case','service'].includes(t.type)&&typeof t.id==='string'&&t.id.trim()&&t.id.length<=300);}
 function renderReference(){
  referencePanel.replaceChildren(el('h3','선택 모형 · CRM 연결'));
  if(!selectedRecord){referencePanel.append(el('p','3D 또는 모형 기록 목록에서 항목을 선택하세요.'));return;}
  referencePanel.append(el('p',selectedRecord.name));
  const targets=getBuildings().some(b=>b.id===buildingId)?referenceTargets(buildingId):[],fields=selectedRecord.fields||{},linked=targets.find(t=>t.type===fields.crmReferenceType&&t.id===fields.crmReferenceId);
  if(linked){referencePanel.append(el('h4',linked.label));for(const line of linked.lines||[])referencePanel.append(el('p',String(line)));}
  else referencePanel.append(el('p',fields.crmReferenceId||fields.crmReferenceType?'연결 해결되지 않음 · 대상이 삭제되었거나 현재 건물에 없습니다.':'미연결 · 실제 CRM 자료를 직접 선택해 연결할 수 있습니다. 위치는 자동 추정하지 않습니다.'));
  const label=el('label','현재 건물의 연결 대상'),select=el('select',null,'atlas-reference-target'),placeholder=el('option','연결 대상을 선택하세요');placeholder.value='';select.append(placeholder);targets.forEach((t,i)=>{const option=el('option',`${{unit:'호실',case:'민원·작업',service:'서비스'}[t.type]} · ${t.label}`);option.value=String(i);select.append(option);});select.value='';label.append(select);
  const bind=button(referenceBusy?'연결 저장 중':'선택 자료 연결');bind.id='atlas-reference-bind';bind.disabled=true;select.disabled=!referenceWritable||referenceBusy||busy;
  select.onchange=()=>{bind.disabled=!referenceWritable||referenceBusy||busy||select.value==='';};
  bind.onclick=async()=>{if(bind.disabled||disposed||!atlas)return;const target=targets[Number(select.value)],recordId=selectedRecord?.id,id=buildingId;if(!target)return;referenceBusy=true;referenceError='';renderReference();try{await atlas.bindReference({recordId,type:target.type,id:target.id});}catch(error){if(!disposed&&buildingId===id&&selectedRecord?.id===recordId)referenceError=error.message;}finally{referenceBusy=false;if(!disposed)renderReference();}};
  referencePanel.append(label,bind,el('p','CRM 원본은 유지하며 모형에는 대상 종류와 ID만 저장합니다.'));
  if(!referenceWritable)referencePanel.append(el('p','읽기 전용 · 연결을 저장할 수 없습니다.'));
  if(referenceError){const error=el('p',referenceError);error.setAttribute('role','alert');referencePanel.append(error);}
 }
 function renderRows(target,sections){target.replaceChildren();for(const section of sections||[]){target.append(el('h3',section.title));for(const line of section.lines?.length?section.lines:section.resources?.length?[]:['등록된 자료 없음'])target.append(el('p',String(line)));for(const r of section.resources||[]){const row=el('p',r.name||'사진');if(/^https:\/\//i.test(r.url||''))row.append(button('원본 열기','data-case-resource-link',r.url));target.append(row);}}}
 // Presentation only: keep the projection and its original values untouched.
 function renderProfile(sections,building,customer){
  profile.replaceChildren();
  for(const section of sections||[]){
   const lines=section.lines||[];
   if(building&&section.title===building.name&&lines.length===1&&lines[0]===building.address)continue;
   const card=el('section');card.className='customer-atlas-profile-section';
   card.append(el('h3',section.title));
   if(customer&&section.title===customer.name&&lines.length>=5){
    const details=el('dl');details.className='customer-atlas-metadata';
    lines.forEach((line,index)=>{
     const value=String(line),match=index>=2?value.match(/^([^:]+):\s*(.*)$/s):null;
     const row=el('div');row.append(el('dt',match?match[1]:['연락처','이메일'][index]||'정보'),el('dd',match?match[2]:value));details.append(row);
    });
    card.append(details);
   }else for(const line of lines.length?lines:['등록된 자료 없음'])card.append(el('p',String(line)));
   profile.append(card);
  }
 }
 function render(){
  if(disposed)return;
  const building=getBuildings().find(b=>b.id===buildingId);heading.replaceChildren(el('h3',building?.name||'건물 미연결'),el('p',building?.address||'주소 미등록'));
  const customer=getCustomers().find(c=>c.id===customerId);
  const staleSelection=Boolean((customerId&&!customer)||(buildingId&&!building)||(customerId&&buildingId&&!customer?.buildings.some(b=>b.id===buildingId)));
  const chooser=button(`${building?.name||customer?.name||'고객·건물 선택'} · 변경`);chooser.id='customer-atlas-chooser-toggle';
  const choices=el('div',null,'customer-atlas-choices');choices.append(el('h3','고객·건물'));
  const updateChooser=()=>{list.className=chooserExpanded?'customer-atlas-chooser expanded':'customer-atlas-chooser';chooser.setAttribute('aria-expanded',String(chooserExpanded));};
  chooser.setAttribute('aria-controls',choices.id);chooser.onclick=()=>{chooserExpanded=!chooserExpanded;updateChooser();};updateChooser();
  list.replaceChildren(chooser,choices);
  const linked=new Set(getCustomers().flatMap(c=>c.buildings.map(b=>b.id))),visible=new Set(getVisibleCustomerIds());
  for(const c of getCustomers()){
   if(!visible.has(c.id))continue;
   choices.append(el('h4',c.name));
   for(const b of c.buildings.length?c.buildings:[null]){if(b)linked.add(b.id);const choice=button(b?.name||'건물 미연결');choice.setAttribute('aria-pressed',String(customerId===c.id&&buildingId===(b?.id||null)));choice.onclick=()=>select(c.id,b?.id||null);choices.append(choice);}
  }
  for(const b of getVisibleBuildings().filter(b=>!linked.has(b.id))){const choice=button(`${b.name} · 고객 미연결`);choice.setAttribute('aria-pressed',String(customerId===null&&buildingId===b.id));choice.onclick=()=>select(null,b.id);choices.append(choice);}
  renderProfile(staleSelection?[{title:'고객·건물 연결이 변경되었습니다',lines:['기존 모형과 미저장 초안은 유지했습니다. 현재 목록에서 고객·건물을 다시 선택해주세요. 이전 고객 프로필과 공통 업무는 표시하지 않습니다.']}]:getProfile(customerId,buildingId),building,staleSelection?null:customer);
  if(customerId&&!staleSelection){const consultation=button('＋ 상담 기록','data-action','new-consultation');consultation.setAttribute('data-customer-id',customerId);profile.append(button('고객 정보·메모 수정','data-customer-hub-edit',customerId),button('전체 상세','data-customer-open',customerId),consultation);}
  if(buildingId)profile.append(button('건물 정보 수정','data-building-edit',buildingId));
  renderReference();profile.append(referencePanel);
  const sections=getSections(staleSelection?null:customerId,building?.id||null)||[];tab=Math.min(tab,Math.max(0,sections.length-1));tabs.replaceChildren();
  sections.forEach((section,i)=>{
   const b=button(section.title);b.id=`customer-atlas-tab-${i}`;
   b.setAttribute('role','tab');b.setAttribute('aria-selected',String(i===tab));
   b.setAttribute('aria-controls',body.id);b.tabIndex=i===tab?0:-1;
   const activate=index=>{tab=index;render();doc.getElementById?.(`customer-atlas-tab-${index}`)?.focus();};
   b.onclick=()=>activate(i);
   b.onkeydown=event=>{
    const next={ArrowRight:(i+1)%sections.length,ArrowLeft:(i+sections.length-1)%sections.length,Home:0,End:sections.length-1}[event.key];
    if(next!==undefined){event.preventDefault();activate(next);}
   };
   tabs.append(b);
  });
  body.setAttribute('aria-labelledby',sections.length?`customer-atlas-tab-${tab}`:'');
  renderRows(body,sections[tab]?[sections[tab]]:[]);
 }
 async function select(cid,bid){
  if(disposed||busy||!atlas)return false;
  if(customerId===cid&&buildingId===bid){chooserExpanded=false;render();return true;}
  busy=true;pendingBuildingId=bid;
  profile.hidden=true;history.hidden=true;heading.hidden=true;
  try{const allowed=buildingId===bid?await atlas.requestLeave():await atlas.selectBuilding(bid);if(!allowed||disposed)return false;customerId=cid;buildingId=bid;chooserExpanded=false;render();return true;}finally{busy=false;pendingBuildingId=undefined;profile.hidden=false;history.hidden=false;heading.hidden=false;if(!disposed)renderReference();}
 }
 const dispose=()=>{if(disposed)return;disposed=true;atlas?.dispose();signal?.removeEventListener('abort',dispose);host.replaceChildren();};
 signal?.addEventListener('abort',dispose,{once:true});
 render();atlas=await mountAtlas({host:stage,initialBuildingId:buildingId,embedded:true,
  onSelectRecord:selection=>{if(disposed||selection.buildingId!==(pendingBuildingId!==undefined?pendingBuildingId:buildingId))return;if(selectedRecord?.id!==selection.record?.id){referenceError='';}selectedRecord=selection.record;referenceWritable=selection.canWrite===true;if(!busy)renderReference();},
  validateReference:reference=>!disposed&&!busy&&reference.buildingId===buildingId&&getBuildings().some(b=>b.id===buildingId)&&referenceTargets(buildingId).some(t=>t.type===reference.type&&t.id===reference.id)
 });
 if(disposed)atlas.dispose();else if(signal?.aborted)dispose();
 return {select,selectCustomer(id){const customer=getCustomers().find(c=>c.id===id);return customer?select(id,customer.buildings.find(b=>b.id===buildingId)?.id||customer.buildings[0]?.id||null):false;},selection:()=>({customerId,buildingId}),requestLeave:()=>atlas.requestLeave(),updateBuildings(){if(disposed)return;atlas.updateBuildings(getBuildings());render();},dispose};
}
