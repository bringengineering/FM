export function tourSteps(data){
 const find=(category,word)=>data.records.find(r=>r.category===category&&(!word||r.name.includes(word)));
 return [
 {title:'건물 전체 파악',record:null,text:'지상·지하 층수와 출입구, 공용 공간을 확인합니다. 예시 모델과 실제 건물의 차이는 건물 설정과 평면도에서 수정하세요.'},
 {title:'펌프실과 급수 설비',record:find('water','펌프'),text:'설비가 실제로 있는지와 위치, 명판의 모델명을 확인하세요. 현장 사진을 첨부하고 담당 업체와 최근 점검 내역을 기록합니다.'},
 {title:'급수 배관과 밸브',record:find('water','밸브'),system:true,text:'선택 설비와 등록된 연결 계통을 보여줍니다. 배관 방향과 공급 구역을 확인해 경로를 수정하세요. 등록 연결만으로 실제 차단 범위를 단정할 수는 없습니다.'},
 {title:'분전반 위치',record:find('electric'),text:'분전반의 위치와 외부 회로표를 기록하세요. 담당 층·호실과 업체 연락처를 정보 수정에 입력합니다. 실제 설비 조작은 담당 전문인력에게 맡기세요.'},
 {title:'소방 설비와 공용부',record:find('fire'),text:'설비 위치와 최근 점검표, 담당 업체를 확인합니다. 출입구와 공용부의 장애물 여부는 사진과 점검 기록으로 남기세요.'},
 {title:'호실별 관리',record:find('lease'),text:'호실 번호와 용도, 공실 여부, 관련 민원을 등록하세요. 설비·문서·작업 기록을 연결하면 해당 공간의 이력을 함께 볼 수 있습니다.'},
 {title:'첫 현장 기록 남기기',record:find('work')||find('water'),text:'위치와 설비 유무를 확인한 뒤 사진·점검 기록을 추가하세요. 확인하지 않은 항목은 추정으로 유지하고, 마지막에 백업 저장으로 자료를 보관하세요.'}
 ].filter((s,i)=>i===0||s.record);
}
export function setupTour(api){
 const $=id=>document.getElementById(id),button=document.createElement('button');button.id='startTour';button.textContent='처음이라면 · 건물 둘러보기';document.querySelector('.atlas-toolbar').prepend(button);
 const card=document.createElement('section');card.id='tourCard';card.hidden=true;card.innerHTML='<div><span id="tourProgress"></span><h2 id="tourTitle"></h2><p id="tourText"></p></div><div class="tour-actions"><button id="tourPrevious">이전</button><button id="tourNext" class="primary">다음</button><button id="tourRecord">점검 기록 남기기</button><button id="tourClose">둘러보기 닫기</button></div>';document.querySelector('.viewbar').after(card);
 let steps=[],index=0,buildingId,previous;
 const setView=()=>{const s=api.getState();$('isolateSystem').checked=!!s.isolate;$('shell').checked=!!s.transparent;$('explode').checked=!!s.explode;};
 function show(){const step=steps[index],s=api.getState();$('tourProgress').textContent=`${index+1} / ${steps.length}`;$('tourTitle').textContent=step.title;$('tourText').textContent=step.text;$('tourPrevious').disabled=index===0;$('tourNext').textContent=index===steps.length-1?'둘러보기 완료':'다음';$('tourRecord').hidden=!step.record;
 s.transparent=true;s.explode=false;s.isolate=!!step.system;s.floor='all';if(step.record){s.layers.add(step.record.category);api.choose(step.record.id);}else api.render();setView();if(step.record&&!step.system)api.getViewer()?.focus(step.record.id);else api.getViewer()?.reset();}
 function close(restore=true){card.hidden=true;if(restore&&previous){Object.assign(api.getState(),previous,{layers:new Set(previous.layers)});setView();api.choose(previous.selected);api.getViewer()?.reset();}previous=null;}
 button.onclick=()=>{if(!card.hidden){show();return;}const s=api.getState();previous={floor:s.floor,transparent:s.transparent,explode:s.explode,isolate:s.isolate,selected:s.selected,layers:new Set(s.layers)};buildingId=api.getPortfolio().activeId;steps=tourSteps(api.getData());index=0;card.hidden=false;show();};
 $('tourPrevious').onclick=()=>{if(index>0){index--;show();}};$('tourNext').onclick=()=>{if(index<steps.length-1){index++;show();}else close();};$('tourClose').onclick=()=>close();$('tourRecord').onclick=()=>{const id=steps[index].record?.id;if(id){api.choose(id);$('addHistory')?.click();}};
 document.addEventListener('atlas-render',()=>{if(!card.hidden&&buildingId!==api.getPortfolio().activeId)close(false);});
}
