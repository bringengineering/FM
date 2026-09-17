const test=require('node:test'),assert=require('node:assert/strict'),{zipBinaryFiles}=require('../src/rnd-control/zip');
test('stored backup ZIP reader preserves binary bytes and rejects CRC, directory and trailing tampering',()=>{
 const {readStoredZip}=require('../src/rnd-control/zip-reader');const bytes=Buffer.from([0,255,128]),zip=zipBinaryFiles({'originals/f.bin':bytes,'metadata.json':Buffer.from('{}')});
 assert.deepEqual(readStoredZip(zip).get('originals/f.bin'),bytes);
 const corrupt=Buffer.from(zip);corrupt[30+'originals/f.bin'.length]^=1;assert.throws(()=>readStoredZip(corrupt));
 const end=Buffer.from(zip);end.writeUInt32LE(0,zip.length-22+16);assert.throws(()=>readStoredZip(end));assert.throws(()=>readStoredZip(Buffer.concat([zip,Buffer.from('tail')])));
});
test('stored backup ZIP reader refuses duplicate entries, unsafe names, unsupported methods and bounded size',()=>{
 const {readStoredZip}=require('../src/rnd-control/zip-reader');const zip=zipBinaryFiles({'one':Buffer.from('1'),'two':Buffer.from('2')});
 const duplicate=Buffer.from(zip);for(let i=0;i<duplicate.length-3;i++)if(duplicate.subarray(i,i+3).equals(Buffer.from('two')))Buffer.from('one').copy(duplicate,i);assert.throws(()=>readStoredZip(duplicate));
 const unsafe=Buffer.from(zip);Buffer.from('../').copy(unsafe,30);assert.throws(()=>readStoredZip(unsafe));
 const compressed=Buffer.from(zip);compressed.writeUInt16LE(8,8);assert.throws(()=>readStoredZip(compressed));assert.throws(()=>readStoredZip(zip,{maxBytes:1}));
});
