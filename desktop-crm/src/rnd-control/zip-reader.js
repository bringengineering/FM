const {crc32}=require('./zip');
/** Reads only this application's classic stored ZIP format; never extracts to disk. */
function readStoredZip(input,{maxBytes=104*1024*1024,maxEntries=1002}={}){
 const fail=()=>{throw Error('원본 보관 ZIP 형식·무결성 검증 실패');};
 if(!(input instanceof Uint8Array)||!Number.isSafeInteger(maxBytes)||maxBytes<22||maxBytes>104*1024*1024||!Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>65535||input.byteLength>maxBytes||input.byteLength<22)fail();
 const zip=Buffer.from(input),end=zip.length-22;
 if(zip.readUInt32LE(end)!==0x06054b50||zip.readUInt16LE(end+4)||zip.readUInt16LE(end+6)||zip.readUInt16LE(end+20))fail();
 const count=zip.readUInt16LE(end+10),size=zip.readUInt32LE(end+12),start=zip.readUInt32LE(end+16);
 if(count!==zip.readUInt16LE(end+8)||count>maxEntries||start+size!==end)fail();
 let central=start,local=0,total=0;const files=new Map();
 for(let i=0;i<count;i++){
  if(central+46>end||zip.readUInt32LE(central)!==0x02014b50)fail();
  const nameSize=zip.readUInt16LE(central+28),dataSize=zip.readUInt32LE(central+24),crc=zip.readUInt32LE(central+16);
  if(zip.readUInt16LE(central+8)!==0x800||zip.readUInt16LE(central+10)||zip.readUInt32LE(central+20)!==dataSize||zip.readUInt16LE(central+30)||zip.readUInt16LE(central+32)||zip.readUInt16LE(central+34)||zip.readUInt32LE(central+42)!==local||central+46+nameSize>end)fail();
  const nameBytes=zip.subarray(central+46,central+46+nameSize),name=nameBytes.toString('ascii');
  if(!nameSize||!Buffer.from(name,'ascii').equals(nameBytes)||!/^[a-zA-Z0-9_./-]+$/.test(name)||name.startsWith('/')||name.split('/').some(x=>!x||x==='.'||x==='..')||files.has(name))fail();
  if(local+30>start||zip.readUInt32LE(local)!==0x04034b50||zip.readUInt16LE(local+6)!==0x800||zip.readUInt16LE(local+8)||zip.readUInt32LE(local+14)!==crc||zip.readUInt32LE(local+18)!==dataSize||zip.readUInt32LE(local+22)!==dataSize||zip.readUInt16LE(local+26)!==nameSize||zip.readUInt16LE(local+28))fail();
  const dataStart=local+30+nameSize,dataEnd=dataStart+dataSize;
  if(dataEnd>start||!zip.subarray(local+30,dataStart).equals(nameBytes))fail();
  total+=dataSize;if(total>100*1024*1024)fail();const data=zip.subarray(dataStart,dataEnd);if(crc32(data)!==crc)fail();files.set(name,Buffer.from(data));local=dataEnd;central+=46+nameSize;
 }
 if(local!==start||central!==end)fail();return files;
}
module.exports={readStoredZip};
