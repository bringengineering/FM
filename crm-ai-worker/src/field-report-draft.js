import Core from '../../desktop-crm/src/work-report-core.js';
import { boundedJson } from './weekly-report-delivery.js';

const reject=()=>{throw Object.assign(new Error('AUTH_REQUIRED'),{code:'AUTH_REQUIRED'});};
const decode=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
export async function verifyFieldAppCheck(token,fetchImpl,now=Date.now()){
  try{
    if(typeof token!=='string'||token.length>12000)reject();
    const parts=token.split('.');if(parts.length!==3)reject();
    const header=JSON.parse(new TextDecoder().decode(decode(parts[0]))),claims=JSON.parse(new TextDecoder().decode(decode(parts[1])));
    if(header.alg!=='RS256'||header.typ!=='JWT'||typeof header.kid!=='string'||header.kid.length>128)reject();
    if(claims.iss!=='https://firebaseappcheck.googleapis.com/864976295990'||!Array.isArray(claims.aud)||!claims.aud.includes('projects/864976295990')||claims.sub!=='1:864976295990:android:644a2b7d5242a0b5eb6097'||!Number.isFinite(claims.exp)||claims.exp<=Math.floor(now/1000))reject();
    const response=await fetchImpl('https://firebaseappcheck.googleapis.com/v1/jwks',{redirect:'manual',signal:AbortSignal.timeout(10000)});
    if(!response.ok||Number(response.headers.get('content-length')||0)>65536)reject();
    const jwks=await boundedJson(response,65536),jwk=Array.isArray(jwks.keys)?jwks.keys.find(k=>k.kid===header.kid&&k.kty==='RSA'&&k.alg==='RS256'):null;
    if(!jwk)reject();
    const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),new TextEncoder().encode(`${parts[0]}.${parts[1]}`)))reject();
  }catch{reject();}
}
export function fieldPasswordToken(token){
  try{return typeof token==='string'&&token.length<=12000&&token.split('.').length===3&&JSON.parse(new TextDecoder().decode(decode(token.split('.')[1]))).firebase?.sign_in_provider==='password';}catch{return false;}
}

export function fieldReportFacts(input){
  const fail=()=>{throw Object.assign(new Error('INVALID_INPUT'),{code:'INVALID_INPUT'});};
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['kind','areas'].includes(k))||!['common','moveIn'].includes(input.kind)||!Array.isArray(input.areas)||!input.areas.length||input.areas.length>32)fail();
  const catalog=Core.itemCatalogFor(input.kind),seen=new Set();let total=0;
  const lines=input.areas.map(area=>{
    if(!area||typeof area!=='object'||Array.isArray(area)||Object.keys(area).some(k=>!['key','before','during','after'].includes(k))||typeof area.key!=='string'||seen.has(area.key))fail();
    const item=catalog.find(x=>x.key===area.key);if(!item)fail();seen.add(area.key);
    for(const phase of ['before','during','after']){if(!Number.isSafeInteger(area[phase])||area[phase]<0||area[phase]>100)fail();total+=area[phase];}
    if(!area.before&&!area.during&&!area.after)fail();
    return `${item.label}: 작업 전 ${area.before}장, 작업 중 ${area.during}장, 작업 후 ${area.after}장`;
  });
  if(total>100)fail();
  return ['사진은 분석하지 않았으며 촬영 구역과 사진 수만 제공됩니다. 사진으로 확인되지 않은 작업 내용이나 성과를 추정하지 마세요.',...lines].join('\n');
}
