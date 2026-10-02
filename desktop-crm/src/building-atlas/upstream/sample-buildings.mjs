export function sampleBuilding(kind='house'){
 const shop=kind==='shop',floors=shop?3:4;
 const data={version:1,building:{name:shop?'예시 · 3층 근린상가':'예시 · 4층 계단형 다가구',address:'가상 배치 · 실제 현장 도면과 설비를 확인한 모델이 아닙니다.',floors,width:18,depth:14,example:true,template:kind},records:[]};
 function add(id,name,category,floor,x,z,links=[],extra={}){const r={id,name,category,floor,x,z,links,status:'확인 필요',confidence:'예시',source:'BRING 가상 배치 · 도면·현장 확인 전',notes:'학습·배치 연습용 예시입니다. 실제 건물의 설비 유무와 위치는 다를 수 있습니다.',fields:{},...extra};data.records.push(r);return r;}
 add('tank','지하 저수조','water',0,-5,3,[],{shape:'tank',fields:{용량:'실측 필요',설치연도:'확인 필요'}});
 add('pump','급수 펌프','water',0,-1,3,['tank'],{shape:'pump'});
 add('valve','급수 주밸브','water',0,3,3,['pump'],{shape:'valve'});
 add('drain-base','지하 배수 집수정','water',0,6,-4,[],{shape:'drain'});
 add('main-panel','주 분전반','electric',0,-6,-3,[],{shape:'cabinet'});
 add('fire-panel','화재 수신반','fire',1,0,5,[],{shape:'cabinet'});
 for(let floor=1;floor<=floors;floor++){
 add('supply-'+floor,`${floor}층 급수 입상관`,'water',floor,3,3,[floor===1?'valve':'supply-'+(floor-1)],{shape:'valve'});
 add('drain-'+floor,`${floor}층 배수 입상관`,'water',floor,6,-4,[floor===1?'drain-base':'drain-'+(floor-1)],{shape:'drain'});
 add('panel-'+floor,`${floor}층 분전반`,'electric',floor,1,4,[floor===1?'main-panel':'panel-'+(floor-1)],{shape:'cabinet'});
 add('fire-'+floor,`${floor}층 소화기`,'fire',floor,-1,4,['fire-panel'],{shape:'extinguisher'});
 add('stairs-'+floor,`${floor}층 계단·공용복도`,'building',floor,0,0,[],{fields:{관리:'계단 청소·조명·적치물 확인'}});
 for(const [side,x] of [['L',-5.3],['R',5.3]]){
 for(const [row,z] of [['N',-3.5],['S',3.5]]){
 const n=(side==='L'?0:2)+(row==='N'?1:2),roomId=`room-${floor}-${n}`,name=shop?`${floor}0${n} 상가`:`${floor}0${n}호`;
 add(roomId,name,'lease',floor,x,z,[],{shape:'room',room:{width:6.5,depth:5.5},fields:{'임대 상태':'확인 필요','면적':'예시 형상 · 실측 필요'}});
 add('tap-'+floor+side+row,`${name} 급수 분기`,'water',floor,x,z-1,['supply-'+floor],{shape:'valve'});
 }
 }
 }
 add('ac','최상층 냉난방 실외기','hvac',floors,-6,5,[],{shape:'ac'});
 add('sensor','펌프실 누수센서 설치 후보','sensor',0,-1,4.5,['pump'],{fields:{'연결 상태':'미설치 · 배치 예시'}});
 add('inspection','첫 현장 확인 체크리스트','work',0,0,-4,['pump'],{fields:{'1':'실제 지하 유무와 층 구성','2':'급수 방식과 저수조·펌프 유무','3':'밸브 및 분전반 식별','4':'도면·사진·명판 확보'}});
 add('manual','설비 설명서 등록 자리','document',0,-4,-4,['pump'],{fields:{'등록 자료':'펌프 명판 사진·설명서·점검표'}});
 add('review','점검 우선순위 검토 기록','insight',0,-2,-4,['inspection'],{fields:{'분석 상태':'수동 기록 · AI 자동 분석 미연결'}});
 return data;
}
