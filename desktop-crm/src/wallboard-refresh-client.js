'use strict';

async function requestWallboardRefresh({baseUrl,idToken,fetchImpl=globalThis.fetch}){
 if(!idToken)throw new Error('다시 로그인해 주세요.');
 let url;
 try{url=new URL(baseUrl);if(url.protocol!=='https:'||url.username||url.password)throw new Error();}
 catch{throw new Error('TV 서버 연결 주소를 확인해 주세요.');}
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 try{
  const response=await fetchImpl(new URL('/v1/wallboard/refresh',url).href,{method:'POST',redirect:'error',headers:{authorization:'Bearer '+idToken,'content-type':'application/json'},body:'{}',signal:controller.signal});
  const data=await response.json();
  if(!response.ok||data.ok!==true||!Number.isSafeInteger(data.version)||data.version<1||!Number.isFinite(data.publishedAt))throw new Error('TV 서버 연결을 확인해 주세요.');
  return {version:data.version,publishedAt:data.publishedAt};
 }finally{clearTimeout(timer);}
}
module.exports={requestWallboardRefresh};
