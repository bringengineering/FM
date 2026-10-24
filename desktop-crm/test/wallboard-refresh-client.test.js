const test=require('node:test');
const assert=require('node:assert/strict');
const {requestWallboardRefresh}=require('../src/wallboard-refresh-client');

test('staff refresh signal sends no CRM payload and validates the response',async()=>{
 let sent;
 const result=await requestWallboardRefresh({baseUrl:'https://gateway.example/v1/assist',idToken:'secret',fetchImpl:async(url,options)=>{sent={url,options};return Response.json({ok:true,version:2,publishedAt:1234});}});
 assert.deepEqual(result,{version:2,publishedAt:1234});
 assert.equal(sent.url,'https://gateway.example/v1/wallboard/refresh');
 assert.equal(sent.options.body,'{}');
 assert.equal(sent.options.headers.authorization,'Bearer secret');
 assert.equal(sent.options.redirect,'error');
});
test('refresh signal rejects missing credentials and invalid server response',async()=>{
 await assert.rejects(requestWallboardRefresh({baseUrl:'https://gateway.example',idToken:''}),/로그인/);
 await assert.rejects(requestWallboardRefresh({baseUrl:'http://gateway.example',idToken:'secret'}),/연결/);
 await assert.rejects(requestWallboardRefresh({baseUrl:'https://gateway.example',idToken:'secret',fetchImpl:async()=>Response.json({ok:true,version:'3',publishedAt:1})}),/연결/);
});
