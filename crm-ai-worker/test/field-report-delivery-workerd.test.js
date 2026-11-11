import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url), wranglerRequire=createRequire(require.resolve('wrangler'));
const {Miniflare,convertV4MiniflareOptions}=wranglerRequire('miniflare'),{buildSync}=wranglerRequire('esbuild');
test('signed field bridge runs inside workerd without making external calls',{timeout:60000},async()=>{
  const source=fileURLToPath(new URL('../src/field-report-delivery.js',import.meta.url)).replaceAll('\\','/');
  const script=buildSync({stdin:{resolveDir:fileURLToPath(new URL('../src/',import.meta.url)),contents:`import {fieldReportDelivery} from ${JSON.stringify(source)}; export default {fetch(request,env){return fieldReportDelivery(request,env,async(req,identity,env,trusted)=>Response.json({trusted,path:new URL(req.url).pathname}));}};`},bundle:true,format:'esm',platform:'browser',write:false}).outputFiles[0].text;
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048}),jwk={...publicKey.export({format:'jwk'}),kid:'synthetic-key',alg:'RS256'};
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-08-30',outboundService:async request=>{assert.equal(request.url,'https://www.googleapis.com/oauth2/v3/certs');return Response.json({keys:[jwk]});}}));
  try{
    const path='/v1/field-report-delivery/send',body=JSON.stringify({documentType:'completion_report',completionReport:{buildingAddress:'가상',workName:'시험'},delivery:{channel:'kakao'}}),seconds=Math.floor(Date.now()/1000),digest=createHash('sha256').update(body).digest('hex'),b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url'),head=b64({alg:'RS256',kid:'synthetic-key'}),payload=b64({iss:'https://accounts.google.com',aud:`https://bring-crm-ai-gateway.bringengineering1008.workers.dev${path}?method=POST&sha256=${digest}`,email:'864976295990-compute@developer.gserviceaccount.com',email_verified:true,iat:seconds,exp:seconds+3600}),signed=`${head}.${payload}`,signature=sign('RSA-SHA256',Buffer.from(signed),privateKey).toString('base64url');
    const response=await mf.dispatchFetch(`https://test${path}`,{method:'POST',headers:{authorization:`Bearer ${signed}.${signature}`,'x-field-body-sha256':digest},body});
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{trusted:true,path:'/v1/document-delivery/documents-and-messages'});
  }finally{await mf.dispose();}
});
