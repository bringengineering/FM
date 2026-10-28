import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { reportCore } from './report-core.js';
import { assert, hash, reportFor, type Recording, type RecordingPhoto } from './recording-model.js';

type PdfPhoto={photo:RecordingPhoto;bytes:Buffer};
const localRequire=createRequire(import.meta.url);
const ownerPdf=localRequire('../../../desktop-crm/src/work-report-owner-pdf.js') as {createOwnerReportHtml(report:unknown,options:unknown):string};
const phaseLabel={before:'작업 전',during:'작업 중',after:'작업 후'};
export function reportItems(visit:Recording,photos:PdfPhoto[]){
  return reportCore.itemCatalogFor(visit.kind).filter(item=>visit.captureAreas?visit.captureAreas.includes(item.key):!item.optional||photos.some(p=>p.photo.itemKey===item.key));
}
export function photoRows(photos:PdfPhoto[]):{slots:(PdfPhoto|null)[];labels:string[]}[]{
  const ordered=(phase:RecordingPhoto['phase'])=>photos.filter(p=>p.photo.phase===phase).sort((a,b)=>Date.parse(a.photo.capturedAt)-Date.parse(b.photo.capturedAt)||a.photo.id.localeCompare(b.photo.id));
  const before=ordered('before'),after=ordered('after'),during=ordered('during'),rows:{slots:(PdfPhoto|null)[];labels:string[]}[]=[];
  for(let i=0;i<Math.max(before.length,after.length);i++)rows.push({slots:[before[i]||null,after[i]||null],labels:[phaseLabel.before,phaseLabel.after]});
  for(let i=0;i<during.length;i+=2)rows.push({slots:during.slice(i,i+2),labels:[phaseLabel.during,phaseLabel.during]});
  return rows;
}

export async function renderRecordingPdf(visit:Recording,photos:PdfPhoto[]):Promise<Buffer>{
  const imageBudget=Math.floor(8*1024*1024/Math.max(photos.length,1));
  const images:Record<string,string>={};
  for(const {photo,bytes} of photos){
    let image=bytes;
    for(const [edge,quality] of [[1600,82],[1200,75],[800,65],[480,50],[320,40],[240,35]]){
      if(image.length<=imageBudget)break;
      image=await sharp(bytes).resize({width:edge,height:edge,fit:'inside',withoutEnlargement:true}).jpeg({quality}).toBuffer();
    }
    assert(image.length<=imageBudget,'REPORT_PHOTO_BYTES_LIMIT',422);
    images[photo.id]=`data:image/jpeg;base64,${image.toString('base64')}`;
  }
  const identity=visit.captureAreas?[visit.ownerUid,visit.id,visit.revision,visit.captureAreas]:[visit.ownerUid,visit.id,visit.revision];
  const reportId='fm_'+hash(JSON.stringify(identity)).slice(0,40);
  const ordered=photos.map(entry=>entry.photo).sort((a,b)=>Date.parse(a.capturedAt)-Date.parse(b.capturedAt)||a.id.localeCompare(b.id));
  const report=reportFor({...visit,photos:ordered},[],reportId);
  const font=(await readFile(new URL('../../assets/NotoSansKR.ttf',import.meta.url))).toString('base64');
  const policy="default-src 'none'; script-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  const html=ownerPdf.createOwnerReportHtml(report,{images,compactPhotos:true,omitUnspecifiedCategory:true,includeEmptyAreas:Boolean(visit.captureAreas)})
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/,`<meta http-equiv="Content-Security-Policy" content="${policy}">`)
    .replace('</style>',`@font-face{font-family:BringKorean;src:url(data:font/ttf;base64,${font}) format('truetype')}html,body{font-family:BringKorean,sans-serif}</style>`);
  // HTML and image bytes never leave this process. A fresh isolated browser is
  // closed after each render and all non-data network requests are blocked.
  const windows=process.platform==='win32';
  let browserEnv:NodeJS.ProcessEnv|undefined;
  if(!windows){
    // The pinned Chromium package includes its NSS libraries. Unpack them on
    // Linux as well as Lambda; minimal Cloud Run images may not provide NSS.
    const packageDir=dirname(localRequire.resolve('@sparticuz/chromium'));
    const {inflate}=localRequire(join(packageDir,'lambdafs.cjs')) as {inflate(path:string):Promise<string>};
    const libraries=join(await inflate(join(packageDir,'../../bin/al2023.tar.br')),'lib');
    browserEnv={...process.env,LD_LIBRARY_PATH:[libraries,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')};
  }
  const browser=await puppeteer.launch({executablePath:windows?'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe':await chromium.executablePath(),args:windows?[]:chromium.args,env:browserEnv,headless:windows?true:'shell',timeout:30000,protocolTimeout:150000});
  try{
    const context=await browser.createBrowserContext();
    try{
      const page=await context.newPage();
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on('request',request=>{void (/^data:(?:image\/(?:jpeg|png|webp)|font\/ttf);base64,/i.test(request.url())?request.continue():request.abort());});
      await page.setContent(html,{waitUntil:'load',timeout:60000});
      const ready=await page.evaluate(async()=>{await document.fonts.ready;return document.fonts.check('12px BringKorean')&&Array.from(document.images).every(image=>image.complete&&image.naturalWidth>0);});
      assert(ready,'REPORT_PDF_INVALID',422);
      const bytes=await page.pdf({format:'A4',printBackground:true,preferCSSPageSize:true,timeout:120000});
      const pdf=await PDFDocument.load(bytes);pdf.setTitle('BRING CARE 작업 결과보고서');pdf.setAuthor('BRING CARE');pdf.setCreator('BRING CARE 현장노트');
      pdf.setCreationDate(new Date(visit.updatedAt));pdf.setModificationDate(new Date(visit.updatedAt));
      const output=Buffer.from(await pdf.save());assert(output.length<=12*1024*1024,'REPORT_PHOTO_BYTES_LIMIT',422);return output;
    }finally{await context.close();}
  }finally{await browser.close();}
}
