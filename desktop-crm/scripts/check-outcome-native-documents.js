'use strict';
// Synthetic native-file QA fixture only. No credentials or CRM server access.
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const E=require('../src/work-outcome-export-core');const D=require('../src/work-outcome-docx');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'bring-outcome-native-'));
const orders=Array.from({length:3},(_,i)=>({id:'QA-'+(i+1),assigneeUid:'qa-user',assigneeName:'검수용 가상 직원',title:['공용부 점검','작업 결과 정리','협력업체 비교'][i],status:['done','submitted','doing'][i],startDate:'2026-09-14',dueDate:'2026-09-18',what:'공간별 상태를 확인하고 사진과 관찰 기록을 업무에 연결합니다.',doneWhen:'위치별 사진과 확인 결과를 대조한 뒤 검수 의견을 기록합니다.',outcomeReport:JSON.stringify({summary:'출입구와 계단을 확인하고 관찰 기록을 남겼습니다. 접근하지 못한 구역은 별도 표시했으며 확인되지 않은 원인은 확정하지 않았습니다.',contribution:'사진 촬영과 공간별 기록 연결을 담당했습니다.',blockers:'일부 공간의 출입 승인을 기다리고 있습니다.',decisionRequest:'추가 방문 일정 확인이 필요합니다.',nextAction:'출입 승인을 확인하고 담당자와 재방문 시간을 정합니다.',metrics:[{label:'확인 공간',target:10,actual:i===0?10:0,unit:'곳'},{label:'확인 사진',target:null,actual:3,unit:'장'}],evidence:[{title:'가상 검수 증빙',url:'https://example.invalid/evidence/'+i}]})}));
for(const [name,records] of [['sample',orders],['empty',[]]]){
 const bundle=E.prepare({orders:records,assigneeUid:'qa-user',from:'2026-09-14',to:'2026-09-20'});
 fs.writeFileSync(path.join(output,name+'.docx'),D.create(bundle));
 fs.writeFileSync(path.join(output,name+'.json'),JSON.stringify(bundle,null,2));
}
console.log(output);
