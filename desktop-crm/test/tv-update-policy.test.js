const test=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');
const {parseTvChannelPointer,resolveTvChannel,TV_CHANNEL_POINTER_URL}=require('../src/tv-update-policy');
const sha512=Buffer.alloc(64,1).toString('base64');
function manifest(version='0.2.0',size=100){return `version: ${version}\nfiles:\n  - url: BRING.TV.Setup.${version}.exe\n    sha512: ${sha512}\n    size: ${size}\npath: BRING.TV.Setup.${version}.exe\nsha512: ${sha512}\nreleaseDate: '2026-09-20T00:00:00Z'\n`;}
function pointer(text=manifest()){
 return JSON.stringify({schemaVersion:1,tag:'tv-v0.2.0',version:'0.2.0',publishedAt:'2026-09-20T00:00:00Z',installer:{name:'BRING.TV.Setup.0.2.0.exe',size:100,sha512},manifest:{name:'latest-tv.yml',size:Buffer.byteLength(text),sha256:crypto.createHash('sha256').update(text).digest('hex')}});
}
test('accepts only the immutable TV channel namespace',()=>{
 const parsed=parseTvChannelPointer(pointer());assert.equal(parsed.tag,'tv-v0.2.0');
 const crm=JSON.parse(pointer());crm.tag='crm-v0.2.0';assert.throws(()=>parseTvChannelPointer(JSON.stringify(crm)),/TV_UPDATE_POINTER_INVALID/);
 const extra=JSON.parse(pointer());extra.crmChannel=true;assert.throws(()=>parseTvChannelPointer(JSON.stringify(extra)),/TV_UPDATE_POINTER_INVALID/);
});
test('resolves exact manifest bytes and pins the TV release feed',async()=>{
 const body=manifest(),requests=[];
 const selected=await resolveTvChannel({fetchImpl:async(url,options)=>{requests.push({url,options});return new Response(url===TV_CHANNEL_POINTER_URL?pointer(body):body);}});
 assert.equal(selected.version,'0.2.0');assert.equal(selected.feedUrl,'https://github.com/bringengineering/FM/releases/download/tv-v0.2.0/');
 assert.equal(requests.length,2);assert.equal(requests[0].options.redirect,'error');assert.equal(requests[1].options.redirect,'error');
});
test('rejects a changed manifest before exposing an updater feed',async()=>{
 await assert.rejects(resolveTvChannel({fetchImpl:async url=>new Response(url===TV_CHANNEL_POINTER_URL?pointer(manifest()):manifest().replace('size: 100','size: 101'))}),/TV_UPDATE_MANIFEST_MISMATCH/);
});
