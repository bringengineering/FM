import { expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { randomBytes } from 'node:crypto';
import { photoRows,renderRecordingPdf,reportItems } from '../src/field-mobile/recording-pdf.js';
import { hash, type Recording, type RecordingPhoto } from '../src/field-mobile/recording-model.js';

it('renders a Korean report with before/after images and stable customer metadata',async()=>{
  const bytes=await sharp({create:{width:720,height:480,channels:3,background:'#dbeafe'}}).composite([{input:Buffer.from('<svg width="720" height="480"><rect x="180" y="100" width="360" height="280" fill="#2563eb"/><text x="220" y="250" font-size="42" fill="white">TEST ONLY</text></svg>')}]).jpeg().toBuffer();
  const photo:RecordingPhoto={id:'test-photo',itemKey:'entrance',phase:'before',caption:'합성 사진입니다. 실제 현장 작업, 청소 완료 또는 점검 결과를 의미하지 않습니다. '.repeat(2),included:true,capturedAt:'2026-10-27T01:00:00Z',mime:'image/jpeg',bytes:bytes.length,sha256:hash(bytes),width:720,height:480};
  const visit:Recording={id:'test-visit',ownerUid:'synthetic-user',customerId:'synthetic-customer',kind:'common',workDate:'2026-10-27',revision:3,draft:{summary:'[TEST] CRM 작업 결과보고서·PDF·카카오 알림톡 연동 확인용\n실제 현장 작업 아님. 현장에서 작성한 내용이 한글로 표시되는지 확인합니다.',followUp:'테스트 보고서이며 고객에게 발송하지 않습니다.',statuses:{},notes:{entrance:'사진과 설명의 줄바꿈을 확인합니다.'},confirmedRevision:3},photos:[photo],site:{id:'synthetic-customer',name:'[TEST] 가상 고객',address:'가상시 합성로 123, 테스트 건물 101호'},contentHash:'a'.repeat(64),createdAt:'2026-10-27T01:00:00Z',updatedAt:'2026-10-27T01:00:00Z'};
  const pdf=await renderRecordingPdf(visit,[{photo,bytes},{photo:{...photo,id:'test-after',phase:'after'},bytes}]);
  expect(reportItems({...visit,captureAreas:['entrance']},[{photo,bytes}]).map(i=>i.key)).toEqual(['entrance']);
  expect(reportItems(visit,[{photo,bytes}]).length).toBeGreaterThan(1); // Old callers keep their previous layout.
  const parsed=await PDFDocument.load(pdf);expect(parsed.getPageCount()).toBeGreaterThan(0);expect(parsed.getTitle()).toBe('BRING CARE 작업 결과보고서');expect(pdf.length).toBeLessThan(12*1024*1024);
  if(process.env.FIELD_PDF_QA==='1'){await mkdir('../.firebase/field-mobile-verification/pdf',{recursive:true});await writeFile('../.firebase/field-mobile-verification/pdf/recording-qa.pdf',pdf);}
},60_000);

it('pairs the same area before and after in capture order and shows missing counterparts',()=>{
  const p={id:'sample',itemKey:'entrance',phase:'before',caption:'',included:true,capturedAt:'2026-10-27T01:00:00Z',mime:'image/jpeg',bytes:4,sha256:'a'.repeat(64),width:1,height:1} as RecordingPhoto;
  const make=(id:string,phase:RecordingPhoto['phase'],time:string)=>({photo:{...p,id,phase,capturedAt:time},bytes:Buffer.from('test')});
  const a=make('before-1','before','2026-10-27T01:00:00Z'),b=make('before-2','before','2026-10-27T02:00:00Z'),c=make('after-1','after','2026-10-27T03:00:00Z'),d=make('during-1','during','2026-10-27T02:30:00Z');
  const rows=photoRows([c,b,d,a]);expect(rows.map(row=>row.slots.map(item=>item?.photo.id||null))).toEqual([['before-1','after-1'],['before-2',null],['during-1']]);
  expect(rows[1].labels).toEqual(['작업 전','작업 후']);
});

it('fits 100 synthetic before/after photos in a bounded customer PDF',async()=>{
  const bytes=await sharp(randomBytes(500*500*3),{raw:{width:500,height:500,channels:3}}).jpeg({quality:95}).toBuffer();
  const p:RecordingPhoto={id:'test-photo',itemKey:'entrance',phase:'before',caption:'합성 시험 사진',included:true,capturedAt:'2026-10-27T01:00:00Z',mime:'image/jpeg',bytes:bytes.length,sha256:hash(bytes),width:500,height:500};
  const visit:Recording={id:'test-visit',ownerUid:'synthetic-user',customerId:'synthetic-customer',kind:'common',workDate:'2026-10-27',revision:3,draft:{summary:'합성 보고서',followUp:'',statuses:{},notes:{},confirmedRevision:3},photos:[],site:{id:'synthetic-customer',customerId:'synthetic-customer',name:'[TEST] 가상 고객',address:'가상 주소'},contentHash:'a'.repeat(64),createdAt:'2026-10-27T01:00:00Z',updatedAt:'2026-10-27T01:00:00Z'};
  const photos=Array.from({length:100},(_,i)=>({photo:{...p,id:`test-${i}`,phase:(i%2?'after':'before') as 'after'|'before'},bytes}));
  const pdf=await renderRecordingPdf(visit,photos);expect(pdf.length).toBeLessThanOrEqual(12*1024*1024);expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(10);
},120_000);
