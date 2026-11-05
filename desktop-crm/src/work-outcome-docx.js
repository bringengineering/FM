'use strict';
// Native editable Word output, using the existing audited ZIP container writer.
const {zipStore}=require('./quote-xlsx');
const Summary=require('./work-outcome-summary');
const X='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const xml=v=>String(v??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function p(text,style='Normal',keepNext=false){
 return `<w:p><w:pPr><w:pStyle w:val="${style}"/>${keepNext?'<w:keepNext/>':''}</w:pPr>${String(text??'').split('\n').map((s,i)=>`${i?'<w:r><w:br/></w:r>':''}<w:r><w:t xml:space="preserve">${xml(s)}</w:t></w:r>`).join('')}</w:p>`;
}
function table(headers,rows,widths){
 return `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblBorders>${['top','left','bottom','right','insideH','insideV'].map(side=>`<w:${side} w:val="single" w:sz="4" w:color="D9D9D9"/>`).join('')}</w:tblBorders><w:tblCellMar>${['top','left','bottom','right'].map(side=>`<w:${side} w:w="100" w:type="dxa"/>`).join('')}</w:tblCellMar></w:tblPr><w:tblGrid>${widths.map(w=>`<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${[headers,...rows].map((row,i)=>`<w:tr>${i===0?'<w:trPr><w:tblHeader/></w:trPr>':''}${row.map((cell,j)=>`<w:tc><w:tcPr><w:tcW w:w="${widths[j]}" w:type="dxa"/><w:vAlign w:val="center"/>${i===0?'<w:shd w:fill="E8F1FC"/>':''}</w:tcPr>${p(cell)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>${p('')}`;
}
function entries(bundle){
 const summary=Summary.prepare(bundle);
 const name=bundle.reports[0]?.assigneeName||bundle.unreported[0]?.assigneeName||bundle.assigneeUid;
 const labels={assigned:'배정',doing:'진행 중',submitted:'제출 및 검수 대기',returned:'보완 요청',done:'관리자 완료 처리'};
 const compact=text=>p(text,'SummaryBody');
 const body=[p('BRING 주간 업무 결과보고서','Title'),compact(`보고 담당자 ${name}   보고 기간 ${bundle.from} ~ ${bundle.to}`),compact(`결과보고 ${summary.reportCount}건, 미제출 또는 확인 필요 ${summary.unreportedCount}건, 일정 및 상태 확인 필요 ${summary.excludedCount}건입니다. 관리자 완료 처리된 보고는 ${summary.approvedCount}건입니다.`),compact(summary.notice)];
 const pageBreak='<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
 summary.pages.forEach((page,pageIndex)=>{
   if(pageIndex)body.push(pageBreak);
   body.push(p(page.title,'Heading1'));
   for(const section of page.sections){
     body.push(p(section.title,'SummaryHeading'));
     if(!section.items.length)body.push(compact('해당 내용이 등록되지 않았습니다.'));
     for(const item of section.items){
       body.push(p(`${item.title} · 상세 원문 업무 ID ${item.sourceId}`,'SummaryHeading'));
       if(item.text!=='정량 지표와 업무 상태')body.push(compact(item.text||'미기재'));
       if(item.status)body.push(p(`업무 상태 ${labels[item.status]||'확인 필요'}`,'SummaryBody',Boolean(item.metrics?.length)));
       if(item.metrics?.length)body.push(table(['지표','목표','실제','단위'],item.metrics.map(m=>[m.label,m.target===null?'미설정':m.target,m.actual,m.unit]),[3960,1800,1800,1800]).replaceAll('w:val="Normal"','w:val="SummaryBody"'));
       if(item.omittedMetrics)body.push(compact(`정량 지표 ${item.omittedMetrics}개 추가 기록은 부록에서 확인하세요.`));
       if(item.contribution?.text)body.push(compact(`본인 기여 ${item.contribution.text}`));
       if(Number.isInteger(item.evidenceCount))body.push(compact(`증빙 ${item.evidenceCount}개는 부록에서 확인하세요.`));
     }
     if(section.omittedCount)body.push(compact(`나머지 ${section.omittedCount}개 업무는 부록에서 확인하세요.`));
   }
 });
 body.push(pageBreak,p('부록 전체 업무 기록','Heading1'),p('아래는 요약에서 생략한 내용까지 포함한 업무별 전체 기록입니다. 정량 지표는 서로 다른 업무나 단위를 합산하지 않습니다.'));
 for(const o of bundle.reports){
   body.push(p(o.title,'Heading2'),p(`업무 ID ${o.sourceId}   상태 ${labels[o.status]||'확인 필요'}`),p(`시작일 ${o.startDate||'미정'}   마감일 ${o.dueDate||'미정'}`),p('담당업무와 목표','Heading2'),p(o.what||'미기재'),p(`완료 기준 ${o.doneWhen||'미기재'}`));
   if(o.report.metrics.length)body.push(table(['지표','목표','실제','단위'],o.report.metrics.map(m=>[m.label,m.target===null?'미설정':m.target,m.actual,m.unit]),[3960,1800,1800,1800]));
   else body.push(p('정량 지표 미등록'));
   for(const [key,title] of [['summary','실제 수행 결과'],['contribution','공동업무에서 본인이 수행한 부분'],['blockers','미완료 사항과 보완 계획'],['decisionRequest','결정 및 지원 요청'],['nextAction','다음 행동과 예정일']])body.push(p(title,'Heading2'),p(o.report[key]||'미기재'));
   body.push(p('증빙 자료','Heading2'));
   o.report.evidence.forEach((e,i)=>body.push(p(`${i+1}. ${e.title}`),p(e.url)));
   body.push(p('검수 의견','Heading2'),p(o.reviewNote||'기록 없음'));
 }
 if(bundle.unreported.length){body.push(p('미제출 및 확인할 보고','Heading1'),table(['업무','확인 사항'],bundle.unreported.map(o=>[o.title,o.reason]),[4680,4680]));}
 if(bundle.excluded.length){body.push(p('집계에서 제외한 업무','Heading1'),table(['업무','확인 사항'],bundle.excluded.map(o=>[o.title,o.reason]),[4680,4680]));}
 const styles=X+'<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Malgun Gothic" w:hAnsi="Malgun Gothic" w:eastAsia="맑은 고딕"/><w:sz w:val="22"/><w:color w:val="000000"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'+[['Normal','Normal',22],['Title','Title',36],['Heading1','heading 1',28],['Heading2','heading 2',24]].map(([id,name,size])=>`<w:style w:type="paragraph" w:styleId="${id}"${id==='Normal'?' w:default="1"':''}><w:name w:val="${name}"/>${id==='Normal'?'':'<w:basedOn w:val="Normal"/>'}<w:pPr>${id==='Normal'?'':'<w:keepNext/><w:spacing w:before="240" w:after="120"/>'}</w:pPr><w:rPr><w:color w:val="000000"/><w:sz w:val="${size}"/>${id==='Normal'?'':'<w:b/>'}</w:rPr></w:style>`).join('')+'</w:styles>';
 return {
 '[Content_Types].xml':X+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
 '_rels/.rels':X+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
 'word/_rels/document.xml.rels':X+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
 'word/styles.xml':styles.replace('</w:styles>', ['SummaryBody','SummaryHeading'].map((id,i)=>`<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${id}"/><w:basedOn w:val="Normal"/><w:pPr>${i?'<w:keepNext/>':''}<w:spacing w:before="${i?120:0}" w:after="60" w:line="260" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Malgun Gothic" w:hAnsi="Malgun Gothic" w:eastAsia="맑은 고딕"/>${i?'<w:b/>':''}<w:color w:val="000000"/><w:sz w:val="22"/></w:rPr></w:style>`).join('')+'</w:styles>'),
 'word/document.xml':X+'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+body.join('')+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1200" w:right="1273" w:bottom="1200" w:left="1273" w:header="600" w:footer="600"/></w:sectPr></w:body></w:document>'
 };
}
module.exports={entries,create:bundle=>zipStore(entries(bundle))};
