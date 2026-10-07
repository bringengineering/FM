import {readTransfer,addTransferredBuilding} from './crm-transfer.mjs';
export function setupCRMTransfer(api){
 const button=document.createElement('button');button.id='importFMBasics';button.textContent='FM 건물정보 가져오기';document.querySelector('.building-picker').append(button);
 const dialog=document.createElement('dialog');dialog.id='fmImportDialog';dialog.innerHTML='<div class="modalhead"><h2>FM 건물정보 가져오기</h2><button id="fmImportClose">닫기</button></div><p>FM의 “건물정보 내보내기”에서 받은 파일을 선택하세요. 건물명·주소만 추가하며 기존 건물을 덮어쓰지 않습니다.</p><input id="fmBasicsFile" type="file" accept=".json,application/json"><p id="fmImportPreview"></p><p class="muted">층수·치수·설비 위치는 가져오지 않습니다. 최초 1층·16×12m·지하 1층은 화면 표시용 임시 모형이며 실제 건물 정보가 아닙니다. 건물 설정과 현장 확인이 필요합니다.</p><p id="fmImportError" role="alert"></p><button id="fmImportConfirm" class="primary" disabled>확인한 건물 추가 / 열기</button>';document.body.append(dialog);
 const $=id=>document.getElementById(id);let pending;
 button.onclick=()=>{pending=null;$('fmBasicsFile').value='';$('fmImportPreview').textContent='';$('fmImportError').textContent='';$('fmImportConfirm').disabled=true;dialog.showModal();};
 $('fmImportClose').onclick=()=>dialog.close();
 $('fmBasicsFile').onchange=async e=>{pending=null;$('fmImportConfirm').disabled=true;$('fmImportPreview').textContent='';$('fmImportError').textContent='';try{const file=e.target.files[0];if(!file)return;if(file.size>10000)throw Error('10KB 이하의 건물정보 전용 파일을 선택해주세요.');const value=JSON.parse(await file.text()),b=readTransfer(value);pending=value;$('fmImportPreview').textContent=`건물: ${b.name} · 주소: ${b.address||'미입력'} · 동일한 FM 건물은 기존 지도로 열립니다.`;$('fmImportConfirm').disabled=false;}catch(err){$('fmImportError').textContent=err.message;}};
 $('fmImportConfirm').onclick=()=>{if(!pending)return;try{api.setPortfolio(addTransferredBuilding(api.getPortfolio(),pending));pending=null;dialog.close();api.toast('FM 건물을 열었습니다. 층수·치수·설비는 별도 확인해주세요.');}catch(err){$('fmImportError').textContent=err.message;}};
 const warning=document.createElement('p');warning.className='muted';warning.id='fmGeometryWarning';warning.textContent='FM에서 건물명·주소만 가져왔습니다. 현재 3D 크기와 층수는 미확인 값입니다. 건물 설정에서 실제 자료를 입력해주세요.';document.querySelector('.building-picker').append(warning);
 const update=()=>{warning.hidden=api.getData().building.origin!=='fm-basics';};document.addEventListener('atlas-render',update);update();
}
