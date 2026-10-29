import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash,createHmac} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url), wranglerRequire=createRequire(require.resolve('wrangler'));
const {Miniflare,convertV4MiniflareOptions}=wranglerRequire('miniflare'),{buildSync}=wranglerRequire('esbuild');
test('signed field bridge runs inside workerd without making external calls',{timeout:60000},async()=>{
  const source=fileURLToPath(new URL('../src/field-report-delivery.js',import.meta.url)).replaceAll('\\','/');
  const script=buildSync({stdin:{resolveDir:fileURLToPath(new URL('../src/',import.meta.url)),contents:`import {fieldReportDelivery} from ${JSON.stringify(source)}; export default {fetch(request,env){return fieldReportDelivery(request,env,async(req,identity,env,trusted)=>Response.json({trusted,path:new URL(req.url).pathname}));}};`},bundle:true,format:'esm',platform:'browser',write:false}).outputFiles[0].text;
  const secret='synthetic-runtime-key-only-1234567890',mf=new Miniflare(convertV4MiniflareOptions({modules:true,script,compatibilityDate:'2026-08-30',bindings:{FIELD_DELIVERY_BRIDGE_SECRET:secret},outboundService:async()=>{throw Error('external request forbidden');}}));
  try{
    const path='/v1/field-report-delivery/send',body=JSON.stringify({documentType:'completion_report',completionReport:{buildingAddress:'가상',workName:'시험'},delivery:{channel:'kakao'}}),time=String(Date.now()),digest=createHash('sha256').update(body).digest('hex'),signature=createHmac('sha256',secret).update(`POST\n${path}\n${time}\n${digest}`).digest('hex');
    const response=await mf.dispatchFetch(`https://test${path}`,{method:'POST',headers:{'x-field-time':time,'x-field-signature':signature,'x-field-body-sha256':digest},body});
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{trusted:true,path:'/v1/document-delivery/documents-and-messages'});
  }finally{await mf.dispose();}
});
