'use strict';
const {validatePublication}=require('./wallboard-publication-schema');
const validToken=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function createTvClient({vault,request,clientVersion}){
 const versionInfo=typeof clientVersion==='string'&&/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(clientVersion)?{clientVersion}:{};
 let pending=null;let queue=Promise.resolve();
 const serial=fn=>{const task=queue.then(fn);queue=task.catch(()=>{});return task;};
 return {
  start:()=>serial(async()=>{const result=await request('start','');if(!/^[A-F0-9]{8}$/.test(result.code)||!validToken(result.pendingToken)||!Number.isFinite(result.expiresAt))throw new Error('등록 응답을 확인할 수 없습니다.');pending=result;return {code:result.code,expiresAt:result.expiresAt};}),
  poll:()=>serial(async()=>{if(!pending||Date.now()>=pending.expiresAt){pending=null;return {paired:false,expired:true};}const result=await request('poll',pending.pendingToken);if(result.status==='pending')return {paired:false};if(result.status!=='approved'||!validToken(result.deviceToken))throw new Error('승인 응답을 확인할 수 없습니다.');await vault.write(result.deviceToken);pending=null;return {paired:true};}),
  display:()=>serial(async()=>{const token=await vault.read();if(!validToken(token))return {paired:false};try{const result=await request('display',token,versionInfo);if(result.board===null)return {paired:true,board:null};const {version,publishedAt,...snapshot}=result.board||{};if(!Number.isSafeInteger(version)||version<1||!Number.isFinite(publishedAt))throw new Error('게시 자료를 확인할 수 없습니다.');return {paired:true,board:{...validatePublication(snapshot),version,publishedAt}};}catch(error){if(['INVALID_TOKEN','AUTH_REQUIRED'].includes(error.code)){await vault.clear();return {paired:false,revoked:true};}throw error;}})
 };
}
module.exports={createTvClient};
