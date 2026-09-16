async function readBoundedJSON(response,maximumBytes,check=()=>{}){
 if(!Number.isSafeInteger(maximumBytes)||maximumBytes<1)throw Error('JSON 용량 제한 오류');
 const length=response?.headers?.get?.('content-length');if(length!==null&&length!==undefined&&/^\d+$/.test(length)&&Number(length)>maximumBytes){try{await response.body?.cancel?.();}catch{}throw Error('CSV 감사 조회 용량 한도');}
 if(!response?.body?.getReader)throw Error('CSV 감사 스트리밍 응답이 필요합니다');
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true}),parts=[];let total=0;
 try{for(;;){check();const next=await reader.read();check();if(next.done)break;total+=next.value.byteLength;if(total>maximumBytes)throw Error('CSV 감사 조회 용량 한도');parts.push(decoder.decode(next.value,{stream:true}));}parts.push(decoder.decode());check();return JSON.parse(parts.join(''));}
 finally{try{await reader.cancel();}catch{}reader.releaseLock?.();}
}
module.exports={readBoundedJSON};
