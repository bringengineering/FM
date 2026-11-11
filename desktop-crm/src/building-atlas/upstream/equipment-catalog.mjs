export const equipmentCatalog=[
 {id:'pump',name:'급수 펌프',category:'water',fields:['제조사','모델','정격 전력','유량','양정','설치일','보증기간','유지보수 업체']},
 {id:'tank',name:'물탱크·저수조',category:'water',fields:['재질','용량','설치일','청소일','다음 청소일','담당 업체']},
 {id:'valve',name:'급수 밸브',category:'water',fields:['밸브 종류','구경','배관 재질','공급 구역','차단 범위 확인 근거']},
 {id:'drain',name:'배수구·집수정',category:'water',fields:['배수 방식','배관 구경','연결 구역','최근 청소일']},
 {id:'cabinet',name:'분전반',category:'electric',fields:['분전반 번호','모델','회로표','담당 층·호실','전기 담당 업체']},
 {id:'extinguisher',name:'소화기',category:'fire',fields:['종류','용량','제조일','최근 점검일','소방 담당 업체']},
 {id:'ac',name:'냉난방 실외기',category:'hvac',fields:['제조사','모델','용량','설치일','냉매 종류','보증기간']}
];
export function addMissingFields(text,names){const lines=String(text||'').split('\n').filter(Boolean);const present=new Set(lines.map(l=>l.split(':')[0].trim()));for(const name of names)if(!present.has(name))lines.push(name+': ');return lines.join('\n');}
export function attachCatalog(form,record,guide){
 const label=document.createElement('label');label.className='wide';label.textContent='설비 종류 · 선택하면 3D 모양과 입력 항목이 설정됩니다';
 const select=document.createElement('select');select.name='shape';select.id='equipmentType';select.add(new Option('일반 기록 / 기본 표시',''));
 for(const item of equipmentCatalog)select.add(new Option(item.name,item.id));
 if(record?.shape&&!equipmentCatalog.some(c=>c.id===record.shape))select.add(new Option('기존 형상 유지',record.shape));select.value=record?.shape||'';label.append(select);document.getElementById('formFields').prepend(label);
 let previous=equipmentCatalog.find(c=>c.id===select.value)?.name;
 select.onchange=()=>{const item=equipmentCatalog.find(c=>c.id===select.value);if(!item)return;if(!form.elements.name.value.trim()||form.elements.name.value===previous)form.elements.name.value=item.name;previous=item.name;form.elements.category.value=item.category;form.elements.fields.value=addMissingFields(form.elements.fields.value,item.fields);guide();};
}
