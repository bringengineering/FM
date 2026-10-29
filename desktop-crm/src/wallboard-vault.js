'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
function createWindowsVault({credential,safeStorage,platform=process.platform}){
 const protect=()=>{if(platform!=='win32'||!safeStorage.isEncryptionAvailable())throw new Error('Windows 보호 저장소를 사용할 수 없습니다.');};
 return {
  async read(){protect();try{return safeStorage.decryptString(await fs.readFile(credential));}catch(error){if(error.code==='ENOENT')return null;throw new Error('기기 인증 정보를 읽을 수 없습니다.');}},
  async write(token){protect();await fs.mkdir(path.dirname(credential),{recursive:true});await fs.writeFile(credential+'.tmp',safeStorage.encryptString(token),{mode:0o600});await fs.rename(credential+'.tmp',credential);},
  async clear(){await fs.rm(credential,{force:true});}
 };
}
module.exports={createWindowsVault};
