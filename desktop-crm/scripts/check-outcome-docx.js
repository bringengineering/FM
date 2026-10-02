'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const E=require('../src/work-outcome-export-core'),D=require('../src/work-outcome-docx');
const bundle=E.prepare({assigneeUid:'sample',from:'2026-09-14',to:'2026-09-20',orders:[{id:'sample-one',title:'가상 건물 공용부 촬영',assigneeUid:'sample',assigneeName:'검토용 담당자',status:'submitted',startDate:'2026-09-14',dueDate:'2026-09-18',what:'공용부 공간별 사진과 관리 문제를 기록합니다.',doneWhen:'공간 10곳의 사진과 발견사항을 연결합니다.',outcomeReport:JSON.stringify({summary:'공용부 공간 8곳의 사진을 확인했습니다.\n출입하지 못한 2곳은 재방문이 필요합니다.',contribution:'현장 촬영과 공간별 파일명 정리를 맡았습니다.',blockers:'옥상과 관리실은 출입 승인 대기 중입니다.',nextAction:'담당자가 건물주와 재방문 일정을 협의합니다.',decisionRequest:'추가 출입 일정 승인이 필요합니다.',metrics:[{label:'촬영 공간',target:10,actual:8,unit:'곳'},{label:'확인된 긴급 문제',target:null,actual:0,unit:'건'}],evidence:[{title:'가상 증빙 링크',url:'https://example.com/proof'}]})}]});
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bring-outcome-docx-'));
const target=path.join(dir,'sample.docx');fs.writeFileSync(target,D.create(bundle));console.log(target);
