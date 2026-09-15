import {createAtlasController} from './controller.mjs';
import {validate, demo} from './upstream/model.mjs';
import {mountBuildingAtlas} from './native/mount.mjs';

const copy = value => structuredClone(value);
const failure = (message, code='ATLAS_ERROR') => Object.assign(new Error(message), {code});
const portfolio = (id, model) => ({version:2,activeId:id,items:[{id,data:copy(model)}]});

// CRM-only identity export: never forward contacts, leases, or archived entries.
export function buildingBasics(buildings=[]) {
  return buildings.filter(b=>b && !b.archivedAt && typeof b.id==='string' && b.id)
    .map(b=>({id:b.id,name:String(b.name||b.id),address:String(b.address||'')}));
}

export function parseImport(text, bytes=new TextEncoder().encode(text).length) {
  if(bytes>30e6) throw failure('30MB 이하 JSON 파일을 선택해주세요.');
  const value=JSON.parse(text);
  if(value?.version===1) {
    if(bytes>8e6) throw failure('단일 모형은 8MB 이하로 선택해주세요.');
    return [{id:'single',data:copy(validate(value))}];
  }
  validatePortfolio(value);
  return value.items.map(({id,data})=>({id,data:copy(data)}));
}

function validatePortfolio(value) {
  if(value?.version!==2 || !Array.isArray(value.items) || !value.items.length || value.items.length>1000)
    throw failure('지원하는 모형 또는 건물 묶음 형식이 아닙니다.');
  const ids=new Set();
  for(const item of value.items) {
    if(!item || typeof item.id!=='string' || !item.id || ids.has(item.id)) throw failure('가져올 건물 번호가 잘못되었거나 중복됩니다.');
    ids.add(item.id); validate(item.data);
  }
  if(!ids.has(value.activeId)) throw failure('건물 묶음의 선택 건물이 없습니다.');
}

function unwrap(response) {
  if(response?.ok!==true) throw failure((typeof response?.error==='string'?response.error:response?.error?.message) || response?.message || '회사 설비지도 요청에 실패했습니다.',response?.error?.code || response?.code);
  return {record:response.record,etag:response.etag,canWrite:response.canWrite};
}

// mountNative is an optional renderer adapter; IO always remains in this host.
export async function mountCrmAtlas({host,buildings=[],api,initialBuildingId,embedded=false,getBuildingContext=()=>[],onSelectRecord=()=>{},validateReference=()=>false,confirm:ask=async()=>false,download:sendDownload,mountNative=mountBuildingAtlas,signal}={}) {
  if(!host?.ownerDocument || !api) throw new TypeError('설비지도 호스트와 회사 API가 필요합니다.');
  const doc=host.ownerDocument, urls=new Set();
  let basics=buildingBasics(buildings), buildingId=initialBuildingId===null?null:basics.find(b=>b.id===initialBuildingId)?.id || basics[0]?.id || null;
  let mode='company', disposed=false, epoch=0, importNonce=0, native=null, nativeAbort=null, nativeHost=null;
  let review=null, provisional=false, practiceDirty=false;
  const el=(tag,id,text)=>{const node=doc.createElement(tag);if(id)node.id=id;if(text)node.textContent=text;return node;};
  const shell=el('section');shell.className='crm-atlas';
  const css=el('link');css.rel='stylesheet';css.href=new URL('./crm-host.css',import.meta.url).href;
  const toolbar=el('div');toolbar.className='crm-atlas-toolbar';
  const select=el('select','atlas-building'), modeSelect=el('select','atlas-mode');
  const labelled=(label,node)=>{const wrap=el('label',null,label);wrap.append(node);return wrap;};
  for(const [value,label] of [['company','회사 건물'],['practice','연습 · 회사 저장 안 함']]) {const opt=el('option',null,label);opt.value=value;modeSelect.append(opt);}
  modeSelect.value=mode;
  const refresh=el('button','atlas-refresh','새로 조회'), create=el('button','atlas-create','모형 만들기'), importButton=el('button','atlas-import','JSON 가져오기 검토');
  const file=el('input','atlas-file');file.type='file';file.accept='.json,application/json';file.hidden=true;
  const status=el('p','atlas-status');status.setAttribute('aria-live','polite');status.setAttribute('role','status');
  const notice=el('p','atlas-notice','추정 모형의 치수·설비 위치·예시 배관은 실제 도면과 현장 확인 전까지 검증되지 않은 정보입니다. 이를 시공·차단·소방 대응·구조 안전 판단에 사용하면 안 됩니다. 실제 작업과 안전 판단에는 검증된 도면 및 담당 전문가의 현장 확인이 필요합니다.');
  const panel=el('section','atlas-review');panel.hidden=true;panel.setAttribute('aria-label','가져오기 검토');
  const source=el('select','atlas-source'), target=el('p','atlas-target'), preview=el('p','atlas-preview');
  const backup=el('button','atlas-backup','현재 모형 백업 다운로드'), importConfirm=el('button','atlas-import-confirm','원본·대상 확인 후 가져오기'), cancel=el('button','atlas-import-cancel','가져오기 취소');
  panel.append(el('h3',null,'가져오기 검토'),labelled('가져올 원본 건물',source),target,preview,backup,importConfirm,cancel);
  const stage=el('div','atlas-stage');
  const contextPanel=el('section','atlas-crm-context');contextPanel.setAttribute('aria-label','연결된 CRM 건물 자료');
  function renderContext(){
    contextPanel.replaceChildren();contextPanel.hidden=embedded||mode!=='company'||!current();
    if(contextPanel.hidden)return;
    contextPanel.append(el('h3',null,'고객·건물 관리 연동 자료'),el('p',null,'현재 CRM에서 받은 자료 · 조회 전용 · 수정은 고객·건물 관리에서 진행합니다. 모형·백업에는 복사하지 않습니다.'));
    try{
      for(const section of getBuildingContext(buildingId)||[]){
        const details=el('details'),summary=el('summary',null,String(section.title||''));
        details.append(summary);
        for(const line of section.lines?.length?section.lines:section.resources?.length?[]:['등록된 자료 없음'])details.append(el('p',null,String(line)));
        for(const resource of section.resources||[]){
          const row=el('p',null,String(resource.name||'사진'));
          if(/^https:\/\//i.test(String(resource.url||''))){
            const button=el('button',null,'사진 원본 열기');button.type='button';button.setAttribute('data-case-resource-link',resource.url);row.append(button);
          }
          details.append(row);
        }
        contextPanel.append(details);
      }
    }catch(_error){contextPanel.append(el('p',null,'CRM 연동 자료를 표시하지 못했습니다. 고객·건물 관리에서 확인해주세요.'));}
  }
  toolbar.append(labelled('CRM 건물',select),labelled('작업 모드',modeSelect),refresh,create,importButton,file);
  if(embedded){toolbar.children[0].hidden=true;toolbar.children[1].hidden=true;}
  shell.append(toolbar,status,contextPanel,notice,panel,stage);host.replaceChildren(css,shell);create.hidden=true;
  if(embedded){shell.replaceChildren(toolbar,status,contextPanel,panel,stage,notice);}
  const active=token=>!disposed && token===epoch;
  const current=()=>basics.find(b=>b.id===buildingId);
  const controller=createAtlasController({
    read:async id=>unwrap(await api.loadBuildingAtlas({buildingId:id})),
    write:async payload=>unwrap(await api.saveBuildingAtlas(payload)),
    validate,
    onChange:state=>{if(!disposed && mode==='company'){renderControls(state);status.textContent=state.error?.message || ({loading:'회사 설비지도를 조회하고 있습니다.',empty:'저장된 모형이 없습니다. 모형 만들기 또는 JSON 가져오기를 선택하세요.',ready:state.canWrite?'회사 설비지도 · 저장된 자료':'회사 설비지도 · 읽기 전용',saving:'회사 자료 저장 중 · 화면을 이동하지 마세요.',saved:'회사 자료 저장이 확인되었습니다.'}[state.status]||'');}}
  });
  function renderControls(state=controller.snapshot()) {
    const busy=state.status==='saving';
    select.disabled=busy||mode==='practice';modeSelect.disabled=busy;refresh.disabled=busy||mode!=='company'||!current();
    create.hidden=mode!=='company'||state.record!==null||state.status!=='empty'||!state.canWrite||provisional;
    create.disabled=busy||!current();importButton.disabled=busy||mode!=='company'||!state.canWrite||!state.etag||!current();
    file.disabled=importButton.disabled;source.disabled=busy;backup.disabled=busy||!state.record;
    importConfirm.disabled=busy||!review||!state.canWrite||!current();cancel.disabled=busy;
  }
  function labels() {
    const options=basics.map(b=>{const opt=el('option',null,`${b.name} · ${b.address}`);opt.value=b.id;return opt;});
    if(buildingId&&!current()){const opt=el('option',null,'선택한 건물은 목록에서 제외되었습니다.');opt.value=buildingId;options.push(opt);}
    select.replaceChildren(...options);select.value=buildingId||'';renderControls();renderReview();renderContext();
  }
  function clearReview(){importNonce++;review=null;panel.hidden=true;file.value='';renderControls();}
  function stopNative(){nativeAbort?.abort();nativeAbort=null;native?.dispose?.();native=null;stage.replaceChildren();nativeHost=null;onSelectRecord({buildingId,record:null,canWrite:false});}
  function hasDraft(){return provisional||practiceDirty||controller.snapshot().draft!==null||Boolean(nativeHost?.shadowRoot?.querySelector('dialog[open]'));}
  async function requestLeave(){
    if(disposed)return true;
    if(controller.snapshot().status==='saving'){status.textContent='저장 중에는 이동할 수 없습니다. 저장 결과를 기다려주세요.';return false;}
    const token=epoch;
    if(hasDraft() && !await ask('저장하지 않은 편집 내용 또는 연습 자료가 있습니다. 내용을 버리고 이동할까요?'))return false;
    return active(token)&&controller.snapshot().status!=='saving';
  }
  async function download(content,type,name){
    if(disposed)throw failure('화면이 닫혔습니다.');
    if(sendDownload)return await sendDownload(content,type,name);
    const url=URL.createObjectURL(new Blob([content],{type}));urls.add(url);
    const a=el('a');a.href=url;a.download=name;host.append(a);a.click();a.remove();
    // Kept until disposal: do not revoke before the browser consumes the download.
  }
  async function mountModel(model,token,practice=false){
    if(!active(token))return;
    stopNative();const targetId=practice?'practice':buildingId;
    nativeHost=el('div','atlas-native');stage.append(nativeHost);
    const abort=new AbortController();nativeAbort=abort;
    const candidate=await mountNative({host:nativeHost,embedded,initialPortfolio:portfolio(targetId,model),mode:practice?'practice':'company',canWrite:practice||controller.snapshot().canWrite,confirm:ask,download,signal:abort.signal,
      onSelectRecord:selection=>{if(active(token)&&!abort.signal.aborted&&!practice&&mode==='company'&&current()&&selection.buildingId===targetId)onSelectRecord(selection);},
      validateReference:reference=>active(token)&&!abort.signal.aborted&&!practice&&mode==='company'&&Boolean(current())&&controller.snapshot().canWrite&&reference.buildingId===targetId&&validateReference(reference)===true,
      savePortfolio:async next=>{
        if(!active(token)||abort.signal.aborted)throw failure('건물 화면이 변경되었습니다.');
        // Practice owns a full in-memory portfolio, including sample replacements,
        // new buildings and merged backups. Only company mode is CRM-ID bounded.
        if(practice){validatePortfolio(next);practiceDirty=true;return copy(next);}
        if(next?.version!==2||next.activeId!==targetId||next.items?.length!==1||next.items[0].id!==targetId)throw failure('선택한 CRM 건물만 저장할 수 있습니다.');
        validate(next.items[0].data);
        if(!current())throw failure('현재 건물이 목록에 없습니다. 다시 조회해주세요.');
        await controller.save(next.items[0].data);
        if(!active(token))throw failure('건물 화면이 변경되었습니다.');
        provisional=false;renderControls();return portfolio(targetId,controller.snapshot().record.model);
      }});
    if(!active(token)||abort.signal.aborted){candidate?.dispose?.();return;}
    native=candidate;
  }
  async function openCurrent(){
    renderContext();
    const token=++epoch;stopNative();clearReview();provisional=false;practiceDirty=false;create.hidden=true;
    if(mode==='practice'){
      controller.reset();status.textContent='연습 모드 · 예시 자료 · 메모리에만 반영되며 회사에는 저장하지 않습니다.';renderControls();
      try{await mountModel(demo(),token,true);}catch(error){if(active(token))status.textContent=error.message;}return;
    }
    if(!current()){controller.reset();status.textContent='설비지도를 조회할 CRM 건물을 선택해주세요.';renderControls();return;}
    try{await controller.open(buildingId,{discardChanges:true});if(active(token)&&controller.snapshot().record)await mountModel(controller.snapshot().record.model,token);}
    catch(error){if(active(token))status.textContent=error.message;}
  }
  async function switchTo(nextMode,nextId){
    if(!await requestLeave()){modeSelect.value=mode;select.value=buildingId||'';return false;}
    mode=nextMode;buildingId=nextId;modeSelect.value=mode;select.value=buildingId||'';await openCurrent();
    return !disposed;
  }
  modeSelect.onchange=()=>switchTo(modeSelect.value,buildingId);
  select.onchange=()=>switchTo(mode,select.value);
  refresh.onclick=()=>switchTo(mode,buildingId);
  create.onclick=async()=>{
    const token=epoch,id=buildingId;
    if(create.hidden||create.disabled)return;
    if(!await ask('이 건물의 추정 모형을 만들까요? 지하 1층 + 지상 1층·가로 16m·세로 12m는 임시 기본값이며 실제 건물 층수나 치수가 아닙니다. 편집 후 저장해야 회사 자료에 반영됩니다.'))return;
    if(!active(token)||id!==buildingId||!current()||controller.snapshot().status==='saving')return;
    const b=current();provisional=true;renderControls();status.textContent='추정 모형 · 미저장 · 지하 1층 + 지상 1층과 기본 치수는 실제 건물 정보가 아닙니다.';
    try{await mountModel({version:1,building:{name:b.name,address:b.address,floors:1,width:16,depth:12},records:[]},token);}catch(error){if(active(token))status.textContent=error.message;}
  };
  function renderReview(){
    if(!review)return;const b=current();target.textContent=`저장 대상 CRM 건물: ${b?.name||'없음'} / ID: ${buildingId} / 주소: ${b?.address||''}`;
    const item=review.items.find(i=>i.id===source.value);preview.textContent=item?`원본: ${item.data.building.name} / ${item.data.building.address||''} · 기록 ${item.data.records.length}개 · 대상 하나만 교체합니다.`:'원본 건물을 선택해주세요.';
  }
  importButton.onclick=()=>{if(!importButton.disabled)file.click();};
  file.onchange=async()=>{
    const chosen=file.files?.[0], token=epoch,nonce=++importNonce,id=buildingId;
    if(!chosen||file.disabled)return;
    try{
      if(chosen.size>30e6)throw failure('30MB 이하 JSON 파일을 선택해주세요.');
      const text=await chosen.text();if(!active(token)||nonce!==importNonce||id!==buildingId)return;
      const items=parseImport(text,chosen.size);review={items,nonce,token,id,backupEtag:null};
      const opts=items.map(i=>{const opt=el('option',null,`${i.data.building.name} · ${i.data.building.address||''} (${i.id})`);opt.value=i.id;return opt;});source.replaceChildren(...opts);source.value=items[0].id;
      panel.hidden=false;renderReview();renderControls();status.textContent='가져올 원본과 CRM 저장 대상을 검토해주세요. 아직 저장하지 않았습니다.';
    }catch(error){if(active(token)&&nonce===importNonce)status.textContent=error.message;}finally{file.value='';}
  };
  source.onchange=()=>{importNonce++;if(review)review.nonce=importNonce;renderReview();};
  cancel.onclick=()=>{if(controller.snapshot().status!=='saving')clearReview();};
  const validReview=(r,nonce)=>active(r.token)&&review===r&&importNonce===nonce&&r.id===buildingId&&mode==='company'&&Boolean(current());
  backup.onclick=async()=>{
    const r=review,nonce=importNonce,state=controller.snapshot();if(!r||!state.record||state.status==='saving')return;
    try{await download(JSON.stringify(state.record.model,null,2),'application/json',`building-atlas-backup-${buildingId}-r${state.record.revision}.json`);
      if(validReview(r,nonce)){r.backupEtag=state.etag;status.textContent='백업 다운로드를 요청했습니다. 실제 파일이 열리는지 확인한 뒤 가져오기를 진행하세요.';}
    }catch(error){if(validReview(r,nonce))status.textContent=error.message;}
  };
  importConfirm.onclick=async()=>{
    const r=review,nonce=importNonce;if(!r||importConfirm.disabled)return;
    const item=r.items.find(i=>i.id===source.value),b=current(),state=controller.snapshot();if(!item||!b)return;
    try{
      if(state.record&&r.backupEtag!==state.etag)throw failure('현재 모형을 먼저 백업 다운로드해주세요.');
      if(state.record&&!await ask('현재 모형의 백업 파일이 실제로 다운로드되었고 열리는 것을 확인했나요? 확인한 경우에만 기존 모형을 교체합니다.'))return;
      if(!validReview(r,nonce))return;
      if(!await ask(`원본 “${item.data.building.name}” (${item.id}) / ${item.data.building.address||''} → 저장 대상 “${b.name}” (CRM ID: ${b.id}) / ${b.address}\n이 원본으로 선택한 대상의 모형을 교체할까요?`))return;
      if(!validReview(r,nonce))return;
      if(hasDraft()&&!await ask('열려 있는 편집 내용 또는 저장되지 않은 초안을 버리고 가져온 모형으로 교체할까요?'))return;
      if(!validReview(r,nonce)||controller.snapshot().status==='saving')return;
      if(controller.snapshot().etag!==state.etag)throw failure('확인 중 모형이 변경되었습니다. 최신 모형을 다시 백업하고 검토해주세요.');
      await controller.save(copy(item.data));
      if(!validReview(r,nonce))return;
      provisional=false;clearReview();await mountModel(controller.snapshot().record.model,epoch);
    }catch(error){if(validReview(r,nonce))status.textContent=error.message;}
  };
  function dispose(){if(disposed)return;disposed=true;epoch++;importNonce++;stopNative();controller.dispose();signal?.removeEventListener('abort',dispose);for(const url of urls)URL.revokeObjectURL(url);urls.clear();for(const node of [modeSelect,select,refresh,create,importButton,file,source,cancel,backup,importConfirm]){node.onclick=null;node.onchange=null;}host.replaceChildren();}
  signal?.addEventListener('abort',dispose,{once:true});
  if(signal?.aborted)dispose();
  if(!disposed){labels();await openCurrent();}
  return Object.freeze({async bindReference(reference){if(disposed||mode!=='company'||!current()||!controller.snapshot().canWrite||!native?.bindReference)throw failure('현재 건물에 연결을 저장할 수 없습니다.');return native.bindReference(reference);},async selectBuilding(id){if(id===buildingId)return true;if(id!==null&&!basics.some(b=>b.id===id))return false;return switchTo('company',id);},updateBuildings(next){if(disposed)return;basics=buildingBasics(next);labels();},requestLeave,dispose});
}
