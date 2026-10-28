import { readFile } from 'node:fs/promises';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import sharp from 'sharp';
import { reportCore } from './report-core.js';
import { assert, type Recording, type RecordingPhoto } from './recording-model.js';

const blue=rgb(.12,.35,.65),ink=rgb(.12,.18,.25),muted=rgb(.36,.42,.49),line=rgb(.86,.9,.94);
const phases={before:'작업 전',during:'작업 중',after:'작업 후'};
const statuses:Record<string,string>={recorded:'작업 기록',done:'완료',partial:'일부 진행',skipped:'미실시'};
type PdfPhoto={photo:RecordingPhoto;bytes:Buffer};
export function reportItems(visit:Recording,photos:PdfPhoto[]){
  return reportCore.itemCatalogFor(visit.kind).filter(item=>visit.captureAreas?visit.captureAreas.includes(item.key):!item.optional||photos.some(p=>p.photo.itemKey===item.key));
}
export function photoRows(photos:PdfPhoto[]):{slots:(PdfPhoto|null)[];labels:string[]}[]{
  const ordered=(phase:RecordingPhoto['phase'])=>photos.filter(p=>p.photo.phase===phase).sort((a,b)=>Date.parse(a.photo.capturedAt)-Date.parse(b.photo.capturedAt)||a.photo.id.localeCompare(b.photo.id));
  const before=ordered('before'),after=ordered('after'),during=ordered('during'),rows:{slots:(PdfPhoto|null)[];labels:string[]}[]=[];
  for(let i=0;i<Math.max(before.length,after.length);i++)rows.push({slots:[before[i]||null,after[i]||null],labels:[phases.before,phases.after]});
  for(let i=0;i<during.length;i+=2)rows.push({slots:during.slice(i,i+2),labels:[phases.during,phases.during]});
  return rows;
}
export async function renderRecordingPdf(visit:Recording,photos:PdfPhoto[]):Promise<Buffer>{
  const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
  pdf.setTitle('BRING CARE 작업 결과보고서');pdf.setAuthor('BRING CARE');pdf.setCreator('BRING CARE 현장노트');
  pdf.setCreationDate(new Date(visit.updatedAt));pdf.setModificationDate(new Date(visit.updatedAt));
  // Static TrueType + full embedding preserves Korean composite glyphs. Pin each
  // glyph position to measured advances (the font's proportional shaping differs
  // between single-character measurement and a whole Korean text run).
  const fonts:PDFFont[]=[await pdf.embedFont(await readFile(new URL('../../assets/NotoSansKR.ttf',import.meta.url)),{subset:false})];
  const sets=fonts.map(f=>new Set(f.getCharacterSet()));
  const glyph=(c:string)=>sets[0].has(c.codePointAt(0)!)?c:'?';
  const widths=new Map<string,number>();
  // Keep the PDF under the CRM 12 MiB limit even with the embedded Korean font.
  // Only the PDF copy is resized; Drive retains the verified camera JPEG.
  const imageBudget=Math.floor(8*1024*1024/Math.max(photos.length,1));
  async function pdfImage(bytes:Buffer){
    let result=bytes;
    for(const [edge,quality] of [[1600,82],[1200,75],[800,65],[480,50],[320,40],[240,35]]){
      if(result.length<=imageBudget)break;
      result=await sharp(bytes).resize({width:edge,height:edge,fit:'inside',withoutEnlargement:true}).jpeg({quality}).toBuffer();
    }
    assert(result.length<=imageBudget,'REPORT_PHOTO_BYTES_LIMIT',422);return result;
  }
  const width=(c:string,size:number)=>{const g=glyph(c);if(!widths.has(g))widths.set(g,fonts[0].widthOfTextAtSize(g,1));return widths.get(g)!*size;};
  function draw(page:PDFPage,text:string,x:number,y:number,size=10,color=ink){for(const c of text){page.drawText(glyph(c),{x,y,size,font:fonts[0],color});x+=width(c,size);}}
  function wrap(text:string,maxWidth:number,size:number){const rows:string[]=[];for(const paragraph of text.split('\n')){let row='',used=0;for(const c of paragraph){const w=width(c,size);if(row&&used+w>maxWidth){rows.push(row);row='';used=0;}row+=c;used+=w;}rows.push(row);}return rows;}
  let page!:PDFPage;let y=0;
  function next(){page=pdf.addPage([595.28,841.89]);page.drawRectangle({x:42,y:751,width:511,height:65,color:rgb(.92,.97,.99)});page.drawRectangle({x:42,y:812,width:511,height:4,color:rgb(.5,.8,.92)});draw(page,'BRING CARE',53,798,9,blue);draw(page,'작업 결과보고서',53,772,19);draw(page,'건물주 제출용',442,792,9,muted);draw(page,visit.workDate,442,775,9,muted);y=731;}
  function room(height:number){if(y-height<65)next();}
  function paragraph(label:string,value:string){const rows=wrap(value||'미기재',510,10);room(38);draw(page,label,42,y,12,blue);y-=23;for(const row of rows){room(16);draw(page,row,42,y,10);y-=16;}y-=14;}
  const items=reportItems(visit,photos);
  const kind=visit.kind==='common'?'공용부청소':'입주청소';
  next();paragraph('이번 작업 요약',visit.draft.summary||'구역별 현장 사진을 확인해 주세요.');
  paragraph('작업 정보',`현장: ${visit.site.name}\n작업일: ${visit.workDate}    작업 종류: ${kind}\n현장 주소: ${visit.site.address}`);
  room(85);draw(page,'사진 기록 요약',42,y,12,blue);y-=15;
  const stats=[['작업 구역',`${items.length}곳`],...(['before','during','after'] as const).map(phase=>[phases[phase],`${photos.filter(p=>p.photo.phase===phase).length}장`])];
  stats.forEach(([label,value],index)=>{const x=42+index*130;page.drawRectangle({x,y:y-48,width:121,height:45,color:rgb(.95,.98,1),borderColor:line,borderWidth:.5});draw(page,label,x+10,y-17,9,muted);draw(page,value,x+10,y-36,12,blue);});y-=64;
  room(32);draw(page,'구역별 작업 기록',42,y,12,blue);y-=23;
  for(const item of items){
    const selected=photos.filter(p=>p.photo.itemKey===item.key);
    const detail=[item.label,statuses[visit.draft.statuses[item.key]||'recorded'],`${selected.length}장`,visit.draft.notes[item.key]||''].filter(Boolean).join(' · ');
    for(const row of wrap(detail,510,10)){room(16);draw(page,row,42,y,10);y-=16;}
  }
  y-=10;paragraph('추가 안내',visit.draft.followUp||'등록된 후속 조치 사항은 없습니다.');paragraph('안내',reportCore.NOTICES.join('\n'));
  for(const item of items){
    const selected=photos.filter(p=>p.photo.itemKey===item.key);
    if(!selected.length)continue;
    next();draw(page,`${item.label} · 구역별 현장 사진`,42,y,12,blue);y-=24;
    if(visit.draft.notes[item.key]){for(const row of wrap(visit.draft.notes[item.key],510,10)){room(16);draw(page,row,42,y,10);y-=16;}y-=6;}
    for(const row of photoRows(selected)){const captions=row.slots.map(p=>p?wrap(p.photo.caption||'',246,9):[]);
      const rowHeight=238+Math.max(1,...captions.map(c=>c.length))*12,previousPage=page;room(rowHeight+24);
      if(page!==previousPage){draw(page,`${item.label} · 계속`,42,y,12,blue);y-=24;}
      for(let j=0;j<row.slots.length;j++){
        const entry=row.slots[j],x=42+j*264;draw(page,row.labels[j],x,y,10,blue);
        if(!entry){page.drawRectangle({x,y:y-204,width:247,height:192,color:rgb(.96,.97,.98)});draw(page,'사진 없음',x+90,y-108,10,muted);continue;}
        const {bytes}=entry;
        const img=await pdf.embedJpg(await pdfImage(bytes)),factor=Math.min(246/img.width,190/img.height);
        page.drawRectangle({x,y:y-204,width:247,height:192,color:rgb(.96,.97,.98)});
        page.drawImage(img,{x:x+(247-img.width*factor)/2,y:y-204+(192-img.height*factor)/2,width:img.width*factor,height:img.height*factor});
        captions[j].forEach((caption,k)=>draw(page,caption,x,y-219-k*12,9,muted));
      }y-=rowHeight;
    }y-=5;
  }
  pdf.getPages().forEach((p,i)=>{p.drawLine({start:{x:42,y:47},end:{x:553,y:47},color:line,thickness:.6});draw(p,'문의 1551-3873',42,29,9,muted);draw(p,`${i+1} / ${pdf.getPageCount()}`,510,29,9,muted);});
  return Buffer.from(await pdf.save());
}
