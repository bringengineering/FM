import test from 'node:test';
import assert from 'node:assert/strict';
import {exchangeWallboardReaderToken} from '../src/wallboard-service-auth.js';

const env={
 FIREBASE_WEB_API_KEY:'firebase-test-key',
 WALLBOARD_READER_UID:'wallboard-reader',
 WALLBOARD_READER_REFRESH_TOKEN:'refresh-test-secret',
};

test('scheduled reader exchanges only its Worker-held refresh token for the configured UID',async()=>{
 let calls=0;
 const fetchImpl=async (url,options)=>{
  calls++;
  assert.equal(url,'https://securetoken.googleapis.com/v1/token?key=firebase-test-key');
  assert.equal(options.method,'POST');
  assert.equal(options.redirect,'error');
  assert.equal(options.headers['content-type'],'application/x-www-form-urlencoded');
  assert.equal(new URLSearchParams(options.body).get('grant_type'),'refresh_token');
  assert.equal(new URLSearchParams(options.body).get('refresh_token'),'refresh-test-secret');
  return Response.json({user_id:'wallboard-reader',id_token:'firebase-id-token',refresh_token:'refresh-test-secret'});
 };
 const result=await exchangeWallboardReaderToken({env,fetchImpl});
 assert.equal(result,'firebase-id-token');
 assert.equal(calls,1);
});

test('missing service credentials fail closed before any network call',async()=>{
 let calls=0;
 await assert.rejects(exchangeWallboardReaderToken({env:{...env,WALLBOARD_READER_REFRESH_TOKEN:''},fetchImpl:()=>{calls++;}}),error=>error.code==='WALLBOARD_UNAVAILABLE');
 assert.equal(calls,0);
});

test('a refreshed token for another Firebase UID cannot read the TV source',async()=>{
 await assert.rejects(exchangeWallboardReaderToken({env,fetchImpl:async()=>Response.json({user_id:'other-user',id_token:'other-id-token'})}),error=>error.code==='WALLBOARD_UNAVAILABLE');
});

test('a failed token exchange does not reveal a credential in its error',async()=>{
 await assert.rejects(exchangeWallboardReaderToken({env,fetchImpl:async()=>new Response('refresh-test-secret',{status:401})}),error=>error.code==='WALLBOARD_UNAVAILABLE'&&!String(error).includes('refresh-test-secret'));
});
