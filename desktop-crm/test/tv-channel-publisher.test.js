const test=require('node:test'),assert=require('node:assert/strict');
const {publishChannelPointer}=require('../scripts/tv-release/publish-channel-pointer');
function pointer(version='0.2.0'){return {schemaVersion:1,tag:`tv-v${version}`,version,publishedAt:'2026-09-20T00:00:00Z',installer:{name:`BRING.TV.Setup.${version}.exe`,size:100,sha512:Buffer.alloc(64,1).toString('base64')},manifest:{name:'latest-tv.yml',size:50,sha256:'b'.repeat(64)}};}
test('publisher creates a dedicated branch once and advances only latest.json',async()=>{
 const calls=[],responses=[new Response('',{status:404}),Response.json({}, {status:201}),new Response('',{status:404}),Response.json({commit:{sha:'a'.repeat(40)}},{status:201})];
 const result=await publishChannelPointer({token:'secret',sourceSha:'c'.repeat(40),pointer:pointer(),fetchImpl:async(url,options)=>{calls.push({url,options});return responses.shift();}});
 assert.equal(result.commitSha,'a'.repeat(40));assert.deepEqual(calls.map(x=>x.options.method||'GET'),['GET','POST','GET','PUT']);assert.match(calls[3].url,/contents\/latest\.json$/);assert.equal(JSON.stringify(result).includes('secret'),false);
});
test('publisher refuses to overwrite the same or newer TV channel',async()=>{
 const previous=pointer(),encoded=Buffer.from(JSON.stringify(previous)).toString('base64');
 await assert.rejects(publishChannelPointer({token:'secret',sourceSha:'c'.repeat(40),pointer:pointer(),fetchImpl:async(url)=>url.includes('/git/ref/')?Response.json({ref:'ok'}):Response.json({sha:'d'.repeat(40),content:encoded})}),/TV_CHANNEL_VERSION_NOT_FORWARD/);
});
