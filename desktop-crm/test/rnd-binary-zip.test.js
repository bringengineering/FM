const test=require('node:test'),assert=require('node:assert/strict');
const {zipBinaryFiles,zipTextFiles,crc32}=require('../src/rnd-control/zip');
test('binary ZIP preserves arbitrary original bytes and CRC alongside metadata',()=>{
 const original=Buffer.from([0,255,128,10,13,0]),metadata=Buffer.from('{"scope":"binary"}');
 const archive=zipBinaryFiles({'originals/v.bin':original,'metadata.json':metadata});
 let offset=0;for(const [name,data] of [['originals/v.bin',original],['metadata.json',metadata]]){
  assert.equal(archive.readUInt32LE(offset),0x04034b50);const length=archive.readUInt16LE(offset+26),size=archive.readUInt32LE(offset+18);
  assert.equal(archive.subarray(offset+30,offset+30+length).toString(),name);assert.equal(size,data.length);assert.equal(archive.readUInt32LE(offset+14),crc32(data));assert.deepEqual(archive.subarray(offset+30+length,offset+30+length+size),data);offset+=30+length+size;
 }
 assert.equal(archive.readUInt32LE(offset),0x02014b50);assert.equal(archive.readUInt16LE(archive.length-12),2);assert.equal(archive.readUInt32LE(archive.length-6),offset);
});
test('binary ZIP accepts byte arrays and empty originals, rejects unsafe names/types/limits',()=>{
 assert.ok(zipBinaryFiles({'empty.bin':new Uint8Array()}));
 for(const path of ['../outside','/absolute','a//b','a/./b','a\\b','x'.repeat(65536)])assert.throws(()=>zipBinaryFiles({[path]:Buffer.from('x')}));
 assert.throws(()=>zipBinaryFiles({'file.bin':'string'}));assert.throws(()=>zipBinaryFiles({'large.bin':Buffer.alloc(100*1024*1024+1)}),/100MiB/);
 assert.throws(()=>zipTextFiles({'large.txt':'x'.repeat(20*1024*1024+1)}),/20MiB/);
});
