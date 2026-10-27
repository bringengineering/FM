import { readFile } from 'node:fs/promises';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import sharp from 'sharp';
import { reportCore } from './report-core.js';
import { assert, type Recording, type RecordingPhoto } from './recording-model.js';

const blue=rgb(.12,.35,.65),ink=rgb(.12,.18,.25),muted=rgb(.36,.42,.49),line=rgb(.86,.9,.94);
const phases={before:'작업 전',during:'작업 중',after:'작업 후'};
const statuses:Record<string,string>={recorded:'작업 기록',done:'완료',partial:'일부 진행',skipped:'미실시'};
export async function renderRecordingPdf(visit:Recording,photos:{photo:RecordingPhoto;bytes:Buffer}[]):Promise<Buffer>{
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
  function next(){page=pdf.addPage([595.28,841.89]);draw(page,'BRING CARE',42,801,12,blue);draw(page,'작업 결과보고서',42,765,23);page.drawLine({start:{x:42,y:747},end:{x:553,y:747},color:line,thickness:1});y=724;}
  function room(height:number){if(y-height<65)next();}
  function paragraph(label:string,value:string){const rows=wrap(value||'미기재',510,10);room(38);draw(page,label,42,y,12,blue);y-=23;for(const row of rows){room(16);draw(page,row,42,y,10);y-=16;}y-=14;}
  next();paragraph('고객 / 현장',visit.site.name);paragraph('건물주소',visit.site.address);paragraph('작업일 / 작업 종류',`${visit.workDate} / ${visit.kind==='common'?'공용부청소':'입주청소'}`);paragraph('작업 내용',visit.draft.summary);paragraph('후속 조치',visit.draft.followUp);
  for(const item of reportCore.itemCatalogFor(visit.kind).filter(item=>!item.optional||photos.some(p=>p.photo.itemKey===item.key))){
    const selected=photos.filter(p=>p.photo.itemKey===item.key);
    room(selected.length?280:65);draw(page,`${item.label} · ${statuses[visit.draft.statuses[item.key]||'recorded']}`,42,y,12,blue);y-=24;
    if(visit.draft.notes[item.key]){for(const row of wrap(visit.draft.notes[item.key],510,10)){room(16);draw(page,row,42,y,10);y-=16;}y-=6;}
    if(!selected.length){draw(page,'첨부 사진 없음',42,y,10,muted);y-=27;continue;}
    for(let i=0;i<selected.length;i+=2){const row=selected.slice(i,i+2),captions=row.map(p=>wrap(p.photo.caption||'',246,9));
      const rowHeight=238+Math.max(...captions.map(c=>c.length))*12;room(rowHeight);
      for(let j=0;j<row.length;j++){
        const {photo,bytes}=row[j],x=42+j*264;draw(page,phases[photo.phase],x,y,10,blue);
        const img=await pdf.embedJpg(await pdfImage(bytes)),factor=Math.min(246/img.width,190/img.height);
        page.drawRectangle({x,y:y-204,width:247,height:192,color:rgb(.96,.97,.98)});
        page.drawImage(img,{x:x+(247-img.width*factor)/2,y:y-204+(192-img.height*factor)/2,width:img.width*factor,height:img.height*factor});
        captions[j].forEach((caption,k)=>draw(page,caption,x,y-219-k*12,9,muted));
      }y-=rowHeight;
    }y-=5;
  }
  paragraph('안내',reportCore.NOTICES.join('\n'));
  pdf.getPages().forEach((p,i)=>{p.drawLine({start:{x:42,y:47},end:{x:553,y:47},color:line,thickness:.6});draw(p,'문의 1551-3873',42,29,9,muted);draw(p,`${i+1} / ${pdf.getPageCount()}`,510,29,9,muted);});
  return Buffer.from(await pdf.save());
}
