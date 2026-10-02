(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BringWorkOutcomeDownloadUI=api;})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 const activeDialogs=new Set();
 function disposeAll(){for(const dispose of [...activeDialogs])dispose();}
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function validDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const n=Date.parse(value+'T00:00:00Z');return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===value;}
 function selection(value,options){
  const assigneeUid=options.admin===true?String(value.assigneeUid||''):String(options.uid||'');
  const allowed=new Set([String(options.uid||''),...(options.members||[]).map(m=>String(m.uid||''))]);
  if(!assigneeUid||!allowed.has(assigneeUid))throw Error('보고 대상 직원을 선택해 주세요.');
  if(!validDate(value.from)||!validDate(value.to)||value.from>value.to)throw Error('올바른 보고 시작일과 종료일을 지정해 주세요.');
  if(!['docx','pptx'].includes(value.format))throw Error('Word 또는 PowerPoint 형식을 선택해 주세요.');
  return {assigneeUid,from:value.from,to:value.to,format:value.format};
 }
 function render(options){
  const members=new Map((options.members||[]).filter(m=>m.uid).map(m=>[String(m.uid),m.displayName||m.name||m.email||m.uid]));
  if(options.uid&&!members.has(options.uid))members.set(options.uid,'내 보고서');
  return `<header><h2>주간 성과보고서 다운로드</h2><p>선택한 직원의 전체 프로젝트에서 보고 기간과 일정이 겹치는 업무를 가져옵니다. 현재 화면의 프로젝트 필터와는 별개입니다.</p></header><form><fieldset>
  ${options.admin?`<label>보고 담당자<select name="assigneeUid" required>${[...members].map(([uid,name])=>`<option value="${escape(uid)}"${uid===options.uid?' selected':''}>${escape(name)}</option>`).join('')}</select></label>`:'<p>본인에게 배정된 업무만 내보냅니다.</p>'}
  <label>보고 시작일<input type="date" name="from" required></label><label>보고 종료일<input type="date" name="to" required></label>
  <label>파일 형식<select name="format"><option value="docx">Word 보고서 (.docx)</option><option value="pptx">PowerPoint 발표자료 (.pptx)</option></select></label>
  <p>서버에 저장된 최신 보고를 읽습니다. 작성 중이거나 저장에 실패한 내용은 포함되지 않습니다. 미보고·검수 대기·완료 상태를 구분합니다. 검증된 보고서의 요약에서 생략한 내용은 Word 부록 또는 PPT 발표자 노트에 남깁니다. 제외·형식 오류 항목은 사유만 표시합니다.</p>
  </fieldset><p role="status" data-export-status tabindex="-1"></p><footer><button type="button" data-close>닫기</button><button type="submit" class="primary-button">파일 저장</button></footer></form>`;
 }
 async function download(save,input){const result=await save(input);if(result&&result.canceled===true)return null;if(!result||result.ok!==true||typeof result.filePath!=='string'||!result.filePath)throw Error('파일 저장을 확인하지 못했습니다. 다시 시도해 주세요.');return result;}
 function open(options){
  const dialog=document.createElement('dialog');dialog.className='work-outcome-dialog';dialog.setAttribute('aria-label','주간 성과보고서 다운로드');dialog.innerHTML=render(options);let busy=false,closed=false;
  const dispose=()=>{if(closed)return;closed=true;activeDialogs.delete(dispose);dialog.close();dialog.remove();};
  const close=()=>{if(!busy)dispose();};
  dialog.querySelector('[data-close]').addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.querySelector('form').addEventListener('submit',async event=>{
   event.preventDefault();if(busy||closed)return;
   const status=dialog.querySelector('[data-export-status]'),fieldset=dialog.querySelector('fieldset'),button=dialog.querySelector('[type="submit"]');
   try{
    const values=Object.fromEntries(new FormData(event.target));const input=selection(values,options);
    busy=true;fieldset.disabled=true;button.disabled=true;status.textContent='서버 기록을 확인하고 파일을 준비하고 있습니다…';
    const result=await download(options.save,input);
    if(closed)return;
    status.textContent=result?'파일을 저장했습니다. 저장한 문서의 내용과 줄바꿈을 확인해 주세요.':'파일 저장을 취소했습니다. 선택한 조건은 유지됩니다.';
   }catch(error){if(!closed)status.textContent=error.message||'파일을 저장하지 못했습니다.';}
   finally{busy=false;if(!closed){fieldset.disabled=false;button.disabled=false;status.focus();}}
  });
  document.body.append(dialog);dialog.showModal();activeDialogs.add(dispose);return dialog;
 }
 return {selection,render,download,open,disposeAll};
});
