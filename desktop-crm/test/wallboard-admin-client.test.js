const test=require('node:test');const assert=require('node:assert/strict');
const {requestWallboardAdmin}=require('../src/wallboard-admin-client');
test('client restricts commands and fixed endpoint without returning credentials',async()=>{
 let sent;const result=await requestWallboardAdmin({baseUrl:'https://gateway.example/v1/assist',idToken:'secret',input:{action:'approve',code:'ABC12345',name:'TV'},fetchImpl:async(url,options)=>{sent={url,options};return Response.json({ok:true,status:'approved'});}});
 assert.equal(sent.url,'https://gateway.example/v1/wallboard/approve');assert.equal(sent.options.headers.authorization,'Bearer secret');assert.equal(sent.options.redirect,'error');assert.deepEqual(result,{ok:true,status:'approved'});
 await assert.rejects(requestWallboardAdmin({baseUrl:'https://gateway.example',idToken:'secret',input:{action:'start'}}),/입력/);
});
test('client maps disabled server to clear unavailable message',async()=>{
 await assert.rejects(requestWallboardAdmin({baseUrl:'https://gateway.example',idToken:'secret',input:{action:'list'},fetchImpl:async()=>Response.json({ok:false,code:'WALLBOARD_UNAVAILABLE'},{status:503})}),/아직 준비/);
});
