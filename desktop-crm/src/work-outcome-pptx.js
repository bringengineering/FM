'use strict';
// Native, editable OOXML. No Office, network, or authoring-runtime dependency.
const Summary=require('./work-outcome-summary');
const {zipStore}=require('./quote-xlsx');
const H='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const A='http://schemas.openxmlformats.org/drawingml/2006/main';
const P='http://schemas.openxmlformats.org/presentationml/2006/main';
const R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS=`xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"`;
const xml=v=>String(v??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const rels=rows=>H+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+rows.map(([id,type,target])=>`<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"/>`).join('')+'</Relationships>';
const group='<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const colors='<p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/>';
function paragraph(text,size,color,bold=false){return `<a:p><a:pPr><a:lnSpc><a:spcPct val="112000"/></a:lnSpc></a:pPr><a:r><a:rPr lang="ko-KR" sz="${size}" b="${bold?1:0}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Malgun Gothic"/><a:ea typeface="Malgun Gothic"/><a:cs typeface="Malgun Gothic"/></a:rPr><a:t xml:space="preserve">${xml(text)}</a:t></a:r><a:endParaRPr lang="ko-KR" sz="${size}"/></a:p>`;}
function box(id,text,x,y,w,h,size=1700,color='25364A',bold=false,notes=false){
 return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr>${notes?'<p:ph type="body" idx="1"/>':''}</p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="${Math.round(x*914400)}" y="${Math.round(y*914400)}"/><a:ext cx="${Math.round(w*914400)}" cy="${Math.round(h*914400)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>${String(text).split('\n').map(t=>paragraph(t,size,color,bold)).join('')}</p:txBody></p:sp>`;
}
function itemBody(item,index){
 if(index===1){
  const status={assigned:'지시',doing:'진행',submitted:'제출',returned:'보완 요청',done:'승인 완료'}[item.status]||'상태 미확인';
  if(!item.metrics.length)return item.text==='정량 지표와 업무 상태'?status+' / 정량 지표 미기재':item.text;
  return status+(item.omittedMetrics?` / 추가 지표 ${item.omittedMetrics}개는 노트 참조`:'')+'\n'+item.metrics.map(m=>Summary.excerpt(`${Summary.excerpt(m.label,24).text}: 목표 ${m.target==null?'미확인':m.target+' '+Summary.excerpt(m.unit,12).text}, 실적 ${m.actual==null?'미확인':m.actual+' '+Summary.excerpt(m.unit,12).text}`,52).text).join('\n');
 }
 if(index===2)return Summary.excerpt(item.text,110).text+'\n기여: '+Summary.excerpt(item.contribution.text||'미기재',45).text+` / 증빙 ${item.evidenceCount}개`;
 return Summary.excerpt(item.text,145).text;
}
function entries(bundle){
 const summary=Summary.prepare(bundle),e={};
 const override=(name,type)=>`<Override PartName="/${name}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.${type}+xml"/>`;
 e['[Content_Types].xml']=H+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'+override('ppt/presentation.xml','presentation.main')+override('ppt/slideMasters/slideMaster1.xml','slideMaster')+override('ppt/slideLayouts/slideLayout1.xml','slideLayout')+override('ppt/notesMasters/notesMaster1.xml','notesMaster')+'<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'+summary.slides.map((_,i)=>override(`ppt/slides/slide${i+1}.xml`,'slide')+override(`ppt/notesSlides/notesSlide${i+1}.xml`,'notesSlide')).join('')+'</Types>';
 e['_rels/.rels']=rels([['rId1','officeDocument','ppt/presentation.xml']]);
 e['ppt/presentation.xml']=H+`<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId6"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId7"/></p:notesMasterIdLst><p:sldIdLst>${summary.slides.map((_,i)=>`<p:sldId id="${256+i}" r:id="rId${i+1}"/>`).join('')}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
 e['ppt/_rels/presentation.xml.rels']=rels([...summary.slides.map((_,i)=>['rId'+(i+1),'slide',`slides/slide${i+1}.xml`]),['rId6','slideMaster','slideMasters/slideMaster1.xml'],['rId7','notesMaster','notesMasters/notesMaster1.xml']]);
 e['ppt/slideMasters/slideMaster1.xml']=H+`<p:sldMaster ${NS}><p:cSld><p:spTree>${group}</p:spTree></p:cSld>${colors}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`;
 e['ppt/slideMasters/_rels/slideMaster1.xml.rels']=rels([['rId1','slideLayout','../slideLayouts/slideLayout1.xml'],['rId2','theme','../theme/theme1.xml']]);
 e['ppt/slideLayouts/slideLayout1.xml']=H+`<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${group}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
 e['ppt/slideLayouts/_rels/slideLayout1.xml.rels']=rels([['rId1','slideMaster','../slideMasters/slideMaster1.xml']]);
 e['ppt/notesMasters/notesMaster1.xml']=H+`<p:notesMaster ${NS}><p:cSld><p:spTree>${group}</p:spTree></p:cSld>${colors}<p:notesStyle/></p:notesMaster>`;
 e['ppt/notesMasters/_rels/notesMaster1.xml.rels']=rels([['rId1','theme','../theme/theme1.xml']]);
 const palette={dk1:'25364A',lt1:'FFFFFF',dk2:'334155',lt2:'F1F5F9',accent1:'2563EB',accent2:'0F766E',accent3:'64748B',accent4:'C2410C',accent5:'7C3AED',accent6:'0369A1',hlink:'2563EB',folHlink:'7C3AED'};
 e['ppt/theme/theme1.xml']=H+`<a:theme xmlns:a="${A}" name="BRING CRM"><a:themeElements><a:clrScheme name="BRING">${Object.entries(palette).map(([k,v])=>`<a:${k}><a:srgbClr val="${v}"/></a:${k}>`).join('')}</a:clrScheme><a:fontScheme name="Korean"><a:majorFont><a:latin typeface="Malgun Gothic"/><a:ea typeface="Malgun Gothic"/><a:cs typeface="Malgun Gothic"/></a:majorFont><a:minorFont><a:latin typeface="Malgun Gothic"/><a:ea typeface="Malgun Gothic"/><a:cs typeface="Malgun Gothic"/></a:minorFont></a:fontScheme><a:fmtScheme name="Default"><a:fillStyleLst>${'<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${'<a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>'.repeat(3)}</a:lnStyleLst><a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${'<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
 summary.slides.forEach((s,i)=>{
  let content=box(2,s.title,.6,.42,12.1,.6,3200,'2563EB',true);
  content+=box(3,`${bundle.from||'기간 미기재'} ~ ${bundle.to||'기간 미기재'}   /   ${Summary.excerpt(bundle.reports[0]?.assigneeName||bundle.unreported[0]?.assigneeName||bundle.assigneeUid||'담당자 미기재',45).text}`,.6,1.13,12.1,.35,1300,'64748B');
  s.items.forEach((item,j)=>{const y=1.8+j*1.42;content+=box(10+j*2,`${j+1}. ${Summary.excerpt(item.title||'제목 미기재',25).text} [${Summary.excerpt(item.sourceId,14).text}]`,.6,y,12.1,.35,1800,'25364A',true);content+=box(11+j*2,itemBody(item,i),.85,y+.4,11.85,1.02,1700);});
  if(!s.items.length)content+=box(10,'기재된 항목 없음',.6,2.1,12.1,.6,2200,'64748B');
  content+=box(30,`본문은 최대 3건 발췌, 생략 ${s.omittedCount}건. …는 문장 발췌 표시. 검증된 보고 원문·증빙: 발표자 노트`,.6,6.3,12.1,.35,1100,'64748B');
  content+=box(31,`보고 ${summary.reportCount}건 / 미제출·형식 확인 ${summary.unreportedCount}건 / 제외 ${summary.excludedCount}건 / 승인 ${summary.approvedCount}건     ${i+1} / 5`,.6,6.88,12.1,.3,1100,'64748B');
  e[`ppt/slides/slide${i+1}.xml`]=H+`<p:sld ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${group}${content}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  e[`ppt/slides/_rels/slide${i+1}.xml.rels`]=rels([['rId1','slideLayout','../slideLayouts/slideLayout1.xml'],['rId2','notesSlide',`../notesSlides/notesSlide${i+1}.xml`]]);
  // Retain the validated export bundle; excluded/malformed reports retain classification reasons only.
  const original=i===0?bundle:(bundle.slides?.[i]||{title:s.title,reports:bundle.reports});
  const notes=s.title+'\n검증된 보고 원문 및 분류 결과 (업무 sourceId 기준)\n'+JSON.stringify(original,null,2);
  e[`ppt/notesSlides/notesSlide${i+1}.xml`]=H+`<p:notes ${NS}><p:cSld><p:spTree>${group}${box(2,notes,.5,1,6.5,8,1100,'25364A',false,true)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
  e[`ppt/notesSlides/_rels/notesSlide${i+1}.xml.rels`]=rels([['rId1','notesMaster','../notesMasters/notesMaster1.xml'],['rId2','slide',`../slides/slide${i+1}.xml`]]);
 });
 return e;
}
function create(bundle){return zipStore(entries(bundle));}
module.exports={entries,create};
