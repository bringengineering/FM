(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BringWorkOutcomeUI=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fields=[['summary','실제 수행 결과'],['contribution','본인 기여 · 공동업무 역할'],['blockers','미완료 사유 · 보완 계획'],['nextAction','다음 행동 · 담당자 · 예정일'],['decisionRequest','결정·지원 요청']];
  function render(d,readonly){
    const input=(name,label,value,type='text',limit=200)=>`<label><span>${label}</span><input name="${name}" type="${type}" value="${escape(value)}" ${type==='number'?'min="0" step="any"':`maxlength="${limit}"`}></label>`;
    const narrative=([key,label])=>`<label class="outcome-wide"><span>${label}${key==='summary'?' *':''}</span><textarea name="${key}" rows="3" maxlength="6000">${escape(d[key])}</textarea></label>`;
    return `<form novalidate><fieldset ${readonly?'disabled':''}>
      ${narrative(fields[0])}
      <h3>목표 대비 실제 실적</h3><p>확인한 수치만 입력하세요. 목표가 없으면 비워두고, 실제 0건은 0으로 입력합니다. 공동 실적은 중복 합산하지 않습니다.</p>
      ${(d.metrics||[]).map((m,i)=>`<section class="outcome-row">${input(`metrics.${i}.label`,'지표명',m.label,'text',120)}${input(`metrics.${i}.target`,'목표',m.target,'number')}${input(`metrics.${i}.actual`,'실제 *',m.actual,'number')}${input(`metrics.${i}.unit`,'단위 *',m.unit,'text',30)}${readonly?'':`<button type="button" data-remove="metrics" data-index="${i}">지표 삭제</button>`}</section>`).join('')}
      ${readonly?'':'<button type="button" data-add="metrics">＋ 지표 추가</button>'}
      <h3>증빙 링크 *</h3><p>회사 Drive 문서·사진 등 접근 가능한 HTTPS 링크를 넣어주세요.</p>
      ${(d.evidence||[]).map((e,i)=>`<section class="outcome-row">${input(`evidence.${i}.title`,'증빙 이름',e.title)}${input(`evidence.${i}.url`,'증빙 링크',e.url,'url',2000)}${readonly?'':`<button type="button" data-remove="evidence" data-index="${i}">증빙 삭제</button>`}</section>`).join('')}
      ${readonly?'':'<button type="button" data-add="evidence">＋ 증빙 추가</button>'}
      <details data-outcome-details${readonly||fields.slice(1).some(([key])=>String(d[key]||'').trim())?' open':''}><summary>기여·보완 계획·다음 행동·지원 요청</summary><p>공동업무 역할이나 미완료 사항이 있으면 함께 기록하세요.</p>${fields.slice(1).map(narrative).join('')}</details>
      </fieldset><p data-outcome-error role="alert" tabindex="-1"></p><footer><button type="button" data-close>닫기</button>${readonly?'':'<button class="primary-button" type="submit">결과보고 저장</button>'}</footer></form>`;
  }
  function performance(rows){
    const states={assigned:'배정',doing:'진행 중',submitted:'제출 · 검수 대기',returned:'보완 요청',done:'관리자 완료 처리'};
    return `<section class="outcome-performance"><h3>업무별 목표·실적과 정성 보고</h3><p>담당자가 기록한 실적입니다. 서로 다른 업무·단위는 합산하지 않으며 공동 실적은 원본 업무에서 확인하세요.</p>${rows.map(row=>{
      const outcome=row.outcome||{state:'missing',report:null},d=outcome.report;
      return `<article><h4>${escape(row.title||'제목 없음')} · ${escape(states[row.status]||'상태 확인 필요')}</h4>${!d?`<p>${outcome.state==='invalid'?'보고서 형식 확인 필요 · 실적 미집계':'결과보고 미작성 · 실적 확인 필요'}</p>`:`
      ${d.metrics.length?`<div class="performance-table-wrap"><table><thead><tr><th scope="col">지표</th><th scope="col">목표</th><th scope="col">실제</th><th scope="col">단위</th></tr></thead><tbody>${d.metrics.map(m=>`<tr><th scope="row">${escape(m.label)}</th><td>${m.target===null?'미설정':escape(m.target)}</td><td>${escape(m.actual)}</td><td>${escape(m.unit)}</td></tr>`).join('')}</tbody></table></div>`:'<p>정량 지표 미등록 · 정성 보고만 작성</p>'}
      <dl>${fields.map(([key,label])=>`<dt>${label}</dt><dd>${escape(d[key]||'미기재')}</dd>`).join('')}</dl><p>증빙 ${d.evidence.length}건 · 링크는 결과보고에서 확인</p><button type="button" class="mini-button" data-wo-outcome="${escape(row.id)}">결과보고 · 증빙 보기</button>`}<p><button type="button" class="mini-button" data-wo-open-card="${escape(row.id)}">원본 업무 확인</button></p></article>`;
    }).join('')||'<p>이 범위에 표시할 업무가 없습니다.</p>'}</section>`;
  }
  async function persist(save,payload){
    const saved=await save(payload);
    if(!saved||saved.id!==payload.id||saved.outcomeReport!==payload.outcomeReport)throw new Error('서버의 보고서 저장 확인을 받지 못했습니다. 작성 내용은 남아 있습니다. 최신 기록을 확인한 뒤 다시 시도하세요.');
    return saved;
  }
  function recoveryQueue(api,orderId,baseReport){
    let queue=Promise.resolve();
    const enqueue=fn=>{const result=queue.then(fn,fn);queue=result.catch(()=>{});return result;};
    return {
      save(draft){const value=JSON.parse(JSON.stringify({draft,baseReport}));return enqueue(async()=>{const r=await api.save({orderId,value});if(!r||!r.savedAt)throw Error('이 PC의 초안 저장 확인을 받지 못했습니다.');return r;});},
      clear(){return enqueue(async()=>{const r=await api.clear({orderId});if(!r||r.ok!==true)throw Error('저장한 보고서의 PC 초안을 정리하지 못했습니다.');return r;});},
    };
  }
  function open(options){
    const {order,canEdit,core,save,onSaved}=options;
    let parsed={};
    try {parsed=order.outcomeReport?JSON.parse(order.outcomeReport):{};} catch {throw new Error('저장된 보고서 형식을 읽을 수 없습니다. 원본을 확인해 주세요.');}
    let draft=core.normalize(parsed),dirty=false,busy=false;
    let baseReport=order.outcomeReport||'',timer=null,closed=false,recoverable=null,recoveryPending=false,localQueue=null;
    let recoveryMessage='',recoveryEnabled=false,editRevision=0;
    if(!order.outcomeReport)draft.evidence=[{title:'',url:''}];
    const readonly=!canEdit||['submitted','done'].includes(order.status);
    const recovery=readonly?null:options.recovery;
    recoveryPending=Boolean(recovery);
    recoveryMessage=recovery?'이 PC의 복구용 초안을 확인하고 있습니다.':readonly?'':'이 환경에서는 PC 초안 복구를 사용할 수 없습니다. 서버에 직접 저장해 주세요.';
    const dialog=document.createElement('dialog'); dialog.className='work-outcome-dialog';
    dialog.setAttribute('aria-label','업무 결과보고');
    const header=`<header><h2>업무 결과보고</h2><p>${escape(order.title)}</p><p>${readonly?'조회 전용 · 검수 중인 보고는 보완 요청 후 수정할 수 있습니다.':'실제 수행 내용과 증빙을 저장하세요. 저장 후 업무 카드에서 별도로 제출하면 대표 검수를 받습니다.'}</p></header>`;
    const paint=()=>{
      const previous=dialog.querySelector('[data-outcome-details]');
      const expanded=previous?previous.open:null;
      dialog.innerHTML=header+render(draft,readonly);
      const status=document.createElement('section');status.dataset.recoveryStatus='';status.setAttribute('aria-live','polite');
      status.innerHTML=`<p>${escape(recoveryMessage)}</p>${recoverable?'<button type="button" data-recover>PC 초안 복구</button> <button type="button" data-discard-draft>PC 초안 버리고 서버 기록 사용</button>':''}`;
      dialog.querySelector('header').append(status);
      dialog.querySelector('fieldset').disabled=readonly||recoveryPending;
      const submit=dialog.querySelector('[type=submit]');if(submit)submit.disabled=recoveryPending;
      if(expanded!==null)dialog.querySelector('[data-outcome-details]').open=expanded;
    };
    const recoveryStatus=message=>{recoveryMessage=message;const el=dialog.querySelector('[data-recovery-status] p');if(el&&!closed)el.textContent=message;};
    const error=message=>{const el=dialog.querySelector('[data-outcome-error]');el.textContent=message;el.focus();};
    function collect(){
      const values=new FormData(dialog.querySelector('form'));
      const next={metrics:draft.metrics.map(()=>({})),evidence:draft.evidence.map(()=>({}))};
      for(const [name,value] of values){const parts=name.split('.');if(parts.length===1)next[name]=value;else next[parts[0]][Number(parts[1])][parts[2]]=value;}
      return next;
    }
    const unload=event=>{if(dirty||busy){event.preventDefault();event.returnValue='';}};
    async function backup(snapshot){
      clearTimeout(timer);timer=null;if(!recoveryEnabled||closed)return;
      snapshot=snapshot||collect();const revision=editRevision;recoveryStatus('이 PC에 초안 보관 중 · 회사 서버에는 아직 저장되지 않았습니다.');
      try{await localQueue.save(snapshot);if(revision===editRevision)recoveryStatus('이 PC에 초안 보관됨 · 회사 서버에는 아직 저장되지 않았습니다.');}
      catch(e){recoveryStatus(`PC 초안 보관 실패: ${e.message}`);throw e;}
    }
    const scheduleBackup=()=>{editRevision++;if(!recoveryEnabled)return;recoveryStatus('변경사항 PC 보관 대기 · 회사 서버에는 아직 저장되지 않았습니다.');clearTimeout(timer);timer=setTimeout(()=>{backup().catch(()=>{});},600);};
    async function close(){
      if(busy)return;
      if(dirty&&recoveryEnabled){busy=true;try{await backup();}catch(e){busy=false;error('초안을 보관하지 못했습니다. 내용을 복사하거나 서버에 저장한 뒤 닫아 주세요.');return;}busy=false;}
      if(dirty&&!window.confirm(recoveryEnabled?'회사 서버에는 아직 저장되지 않았습니다. 이 PC에 초안을 남기고 닫을까요?':'저장하지 않은 보고 내용이 있습니다. 닫으면 작성 내용이 사라집니다. 닫을까요?'))return;
      clearTimeout(timer);closed=true;
      window.removeEventListener('beforeunload',unload);dialog.close();dialog.remove();
    }
    dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    dialog.addEventListener('input',()=>{if(!readonly&&!recoveryPending){dirty=true;scheduleBackup();}});
    dialog.addEventListener('click',async event=>{
      if(event.target.closest('[data-close]')){close();return;}
      if(readonly||busy)return;
      if(event.target.closest('[data-recover]')&&recoverable){
        if(recoverable.baseReport!==baseReport){error('초안 작성 이후 서버 보고서가 변경되었습니다. 자동 복구할 수 없습니다. 초안 내용은 아래에서 확인·복사한 뒤 서버 기록과 비교해 주세요.');const box=document.createElement('textarea');box.readOnly=true;box.value=JSON.stringify(recoverable.draft,null,2);box.setAttribute('aria-label','이전 PC 초안 원문');dialog.querySelector('[data-recovery-status]').append(box);return;}
        draft=recoverable.draft;recoverable=null;recoveryPending=false;recoveryEnabled=true;dirty=true;localQueue=recoveryQueue(recovery,order.id,baseReport);recoveryMessage='PC 초안을 복구했습니다. 확인 후 회사 서버에 저장해 주세요.';paint();return;
      }
      if(event.target.closest('[data-discard-draft]')&&recoverable){
        if(!window.confirm('이 PC에 남은 초안을 버리고 현재 서버 기록으로 작성할까요?'))return;
        busy=true;try{await recoveryQueue(recovery,order.id,baseReport).clear();recoverable=null;recoveryPending=false;recoveryEnabled=true;localQueue=recoveryQueue(recovery,order.id,baseReport);recoveryMessage='현재 서버 기록으로 작성합니다. 입력 내용은 이 PC에 자동 보관됩니다.';paint();}catch(e){error(e.message);}finally{busy=false;}return;
      }
      if(recoveryPending)return;
      const add=event.target.closest('[data-add]'),remove=event.target.closest('[data-remove]');
      if(!add&&!remove)return;
      draft=collect();
      if(add){const key=add.dataset.add;if(draft[key].length>=30){error('항목은 최대 30개입니다.');return;}draft[key].push(key==='metrics'?{label:'',target:'',actual:'',unit:''}:{title:'',url:''});}
      if(remove)draft[remove.dataset.remove].splice(Number(remove.dataset.index),1);
      dirty=true;paint();scheduleBackup();
    });
    dialog.addEventListener('submit',async event=>{
      event.preventDefault();if(readonly||busy||recoveryPending)return;
      draft=collect();const checked=core.validate(draft);
      if(!checked.ok){error(checked.errors.map(e=>e.message).join(' '));return;}
      const outcomeReport=JSON.stringify(checked.value);
      if(outcomeReport.length>60000){error('보고서가 너무 큽니다. 상세 내용은 증빙 링크로 연결하세요.');return;}
      busy=true;dialog.querySelector('fieldset').disabled=true;dialog.querySelector('[type=submit]').disabled=true;
      clearTimeout(timer);timer=null;
      if(recoveryEnabled)await backup(draft).catch(()=>{});
      try{
        await persist(save,{id:order.id,outcomeReport,expectedOutcomeReport:baseReport});
      }catch(e){busy=false;dialog.querySelector('fieldset').disabled=false;dialog.querySelector('[type=submit]').disabled=false;error((e&&e.message)||'저장하지 못했습니다. 작성 내용은 남아 있습니다.');return;}
      let cleanupWarning='';if(localQueue){try{await localQueue.clear();}catch(e){cleanupWarning=e.message;}}
      dirty=false;busy=false;await close();await onSaved();if(cleanupWarning&&options.onWarning)options.onWarning(cleanupWarning);
    });
    paint();document.body.append(dialog);window.addEventListener('beforeunload',unload);dialog.showModal();
    if(recovery)recovery.load({orderId:order.id}).then(saved=>{
      if(closed)return;
      if(saved){if(typeof saved.baseReport!=='string'||!saved.draft||!Array.isArray(saved.draft.metrics)||!Array.isArray(saved.draft.evidence))throw Error('복구용 초안 형식을 확인할 수 없습니다.');recoverable=saved;recoveryMessage='이 PC에 서버 미저장 초안이 있습니다. 복구하거나 버릴 내용을 먼저 선택하세요.';}
      else{recoveryPending=false;recoveryEnabled=true;localQueue=recoveryQueue(recovery,order.id,baseReport);recoveryMessage='작성 내용은 이 PC에 자동 보관됩니다. 회사 서버 저장은 별도입니다.';}
      paint();
    }).catch(e=>{if(closed)return;recoveryPending=false;recoveryMessage=`PC 초안 확인 실패: ${e.message} 기존 초안은 덮어쓰지 않습니다. 서버에 직접 저장할 수 있습니다.`;paint();});
    return dialog;
  }
  return {render,open,persist,performance,recoveryQueue};
});
