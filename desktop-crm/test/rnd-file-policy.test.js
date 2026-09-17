const test=require('node:test'),assert=require('node:assert/strict');const {MAX_FILE_BYTES,assertUploadFile}=require('../src/rnd-control/file-policy');
test('upload policy accepts 100MiB boundary, rejects larger files and disguised executables',()=>{
 assert.equal(MAX_FILE_BYTES,104857600);assertUploadFile({fileName:'field.CSV',sizeBytes:MAX_FILE_BYTES});assert.throws(()=>assertUploadFile({fileName:'field.csv',sizeBytes:MAX_FILE_BYTES+1}),/100MiB/);
 assert.throws(()=>assertUploadFile({fileName:'installer.exe',sizeBytes:1}),/실행파일/);assert.throws(()=>assertUploadFile({fileName:'fake.pdf',sizeBytes:4,bytes:Buffer.from('MZ00')}),/실행파일/);assert.throws(()=>assertUploadFile({fileName:'fake.txt',sizeBytes:4,bytes:Buffer.from([127,69,76,70])}),/실행파일/);assertUploadFile({fileName:'report.pdf',sizeBytes:4,bytes:Buffer.from('%PDF')});
});
test('file content validation checks exact byte length for Buffer and typed byte sources',()=>{
 assertUploadFile({fileName:'sample.txt',sizeBytes:4,bytes:new Uint8Array([65,66,67,68])});assert.throws(()=>assertUploadFile({fileName:'sample.txt',sizeBytes:5,bytes:Buffer.from('ABCD')}),/크기/);
});
test('file names require real extension and reject unsafe paths, controls and executable suffix',()=>{
 for(const fileName of ['csv','.pdf','../field.pdf','field.pdf:stream','field\u202e.pdf'])assert.throws(()=>assertUploadFile({fileName,sizeBytes:1}),/파일명/);
 assert.throws(()=>assertUploadFile({fileName:'photo.pdf.exe',sizeBytes:1}),/실행파일/);assertUploadFile({fileName:'현장.최종.PDF',sizeBytes:4,bytes:Buffer.from('%PDF')});assert.throws(()=>assertUploadFile({fileName:'sample.txt',sizeBytes:4,bytes:'text'}),/바이트/);
});
