const TOKEN_ENDPOINT='https://securetoken.googleapis.com/v1/token';
const MAX_RESPONSE_BYTES=8192;
const unavailable=()=>Object.assign(new Error('WALLBOARD_UNAVAILABLE'),{code:'WALLBOARD_UNAVAILABLE'});

async function boundedJson(response){
 const contentLength=Number(response.headers.get('content-length'));
 if(Number.isFinite(contentLength)&&contentLength>MAX_RESPONSE_BYTES)throw unavailable();
 const reader=response.body?.getReader();
 if(!reader)throw unavailable();
 let length=0;const chunks=[];
 try{
  while(true){
   const {done,value}=await reader.read();
   if(done)break;
   length+=value.byteLength;
   if(length>MAX_RESPONSE_BYTES){await reader.cancel();throw unavailable();}
   chunks.push(value);
  }
 }finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{return JSON.parse(new TextDecoder().decode(bytes));}
 catch{throw unavailable();}
}

export async function exchangeWallboardReaderToken({env,fetchImpl=fetch,timeoutMs=8000}){
 const apiKey=String(env?.FIREBASE_WEB_API_KEY||'');
 const refreshToken=String(env?.WALLBOARD_READER_REFRESH_TOKEN||'');
 const uid=String(env?.WALLBOARD_READER_UID||'');
 if(!apiKey||!refreshToken||!uid||!/^[A-Za-z0-9._-]{1,128}$/.test(uid))throw unavailable();
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),timeoutMs);
 try{
  const url=new URL(TOKEN_ENDPOINT);url.searchParams.set('key',apiKey);
  const response=await fetchImpl(url.toString(),{
   method:'POST',redirect:'error',cache:'no-store',signal:controller.signal,
   headers:{'content-type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({grant_type:'refresh_token',refresh_token:refreshToken}).toString(),
  });
  if(!response.ok)throw unavailable();
  const data=await boundedJson(response);
  if(data?.user_id!==uid||typeof data?.id_token!=='string'||!data.id_token||data.id_token.length>8192)throw unavailable();
  return data.id_token;
 }catch{throw unavailable();}
 finally{clearTimeout(timeout);}
}
