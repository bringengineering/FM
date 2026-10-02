import {collectBuildingBasics,transferPayload} from './crm-transfer.mjs';
const trigger=document.getElementById('exportAtlasBasics');
if(trigger){
 const dialog=document.createElement('dialog');dialog.style.cssText='max-width:95vw;width:560px;border:1px solid #cbd5e1;border-radius:14px;padding:24px;background:white;color:#18304b';
 dialog.innerHTML='<h2>3D 지도용 건물정보 내보내기</h2><p>로그인한 FM에 이미 표시된 건물에서 하나를 선택하세요. 파일에는 건물명과 주소만 담깁니다. 연락처·계약·금액·고객 메모는 포함하지 않습니다.</p><select id="fmExportBuilding" style="width:100%;padding:12px" aria-label="내보낼 건물"></select><p id="fmExportPreview"></p><p id="fmExportError" role="alert"></p><button id="fmExportDownload" class="btn" disabled>선택 건물정보 저장</button> <button id="fmExportClose" class="btn">닫기</button><p><a href="./building-operations/" target="_blank" rel="noopener">3D 설비지도 열기 ↗</a> → FM 건물정보 가져오기</p>';document.body.append(dialog);
 const $=id=>document.getElementById(id);let buildings=[];
 const isLoggedIn=()=>typeof auth!=='undefined'&&Boolean(auth?.currentUser);
 const preview=()=>{const b=buildings[Number($('fmExportBuilding').value)];$('fmExportPreview').textContent=b?`건물명: ${b.name} / 주소: ${b.address||'미입력'}`:'불러올 건물이 없습니다. FM 고객·건물 정보에 건물명과 주소를 먼저 등록해주세요.';$('fmExportDownload').disabled=!b;};
 trigger.onclick=()=>{
  buildings=[];$('fmExportError').textContent='';$('fmExportBuilding').replaceChildren();
  if(!isLoggedIn()){$('fmExportError').textContent='FM 로그인이 필요합니다. 로그인 후 다시 열어주세요.';}
  else{
   const visible=Object.fromEntries(Object.entries(typeof cases==='undefined'?{}:cases).filter(([,c])=>typeof isCaseVisible!=='function'||isCaseVisible(c)));
   buildings=collectBuildingBasics(typeof settings==='undefined'?{}:settings,visible);
   buildings.forEach((b,i)=>$('fmExportBuilding').add(new Option(`${b.name} · ${b.address||'주소 미입력'}`,String(i))));
  }
  preview();dialog.showModal();
 };
 $('fmExportBuilding').onchange=preview;$('fmExportClose').onclick=()=>dialog.close();
 $('fmExportDownload').onclick=()=>{try{
  if(!isLoggedIn())throw Error('로그인이 만료됐습니다. 다시 로그인해주세요.');
  const b=buildings[Number($('fmExportBuilding').value)];if(!b)throw Error('건물을 먼저 선택해주세요.');
  const url=URL.createObjectURL(new Blob([JSON.stringify(transferPayload(b),null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='BRING-FM-건물정보.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }catch(err){$('fmExportError').textContent=err.message;}};
}
