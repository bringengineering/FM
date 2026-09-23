'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createWallboardRefreshStatus}=require('../src/wallboard-refresh-status');
const fs=require('node:fs');
const path=require('node:path');

test('remote refresh status records success time and a bounded failure code',()=>{
 let time=1000;
 const tracker=createWallboardRefreshStatus({now:()=>time});
 assert.deepEqual(tracker.status(),{remoteRefreshAt:null,remotePublishedAt:null,remoteVersion:null,remoteRefreshError:''});
 tracker.succeeded({version:3,publishedAt:900});
 assert.deepEqual(tracker.status(),{remoteRefreshAt:1000,remotePublishedAt:900,remoteVersion:3,remoteRefreshError:''});
 time=2000;
 tracker.failed(Object.assign(new Error('customer 010-1234-5678'),{code:'RATE_LIMITED'}));
 assert.deepEqual(tracker.status(),{remoteRefreshAt:2000,remotePublishedAt:900,remoteVersion:3,remoteRefreshError:'RATE_LIMITED'});
 time=3000;
 tracker.failed(new Error('raw source body'));
 assert.equal(tracker.status().remoteRefreshError,'REMOTE_REFRESH_FAILED');
 assert.ok(!JSON.stringify(tracker.status()).includes('010-1234-5678'));
 assert.ok(!JSON.stringify(tracker.status()).includes('raw source body'));
 tracker.reset();
 assert.deepEqual(tracker.status(),{remoteRefreshAt:null,remotePublishedAt:null,remoteVersion:null,remoteRefreshError:''});
});

test('admin live status includes remote refresh outcome and labels it separately from local sync',()=>{
 const main=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8');
 const ui=fs.readFileSync(path.join(__dirname,'../src/wallboard-admin-ui.js'),'utf8');
 assert.match(main,/if \(input\?\.action === "live-status"\) return \{\.\.\.ensureWallboardLiveSync\(\)\.status\(\), \.\.\.wallboardRefreshStatus\.status\(\)\}/);
 assert.match(main,/wallboardRefreshStatus\.succeeded\(result\)/);
 assert.match(main,/wallboardRefreshStatus\.failed\(error\)/);
 assert.match(main,/if \(client !== remoteClient \|\| client\.authState\(\)\.user\?\.uid !== uid\) return;\s*wallboardRefreshStatus\.succeeded\(result\)/);
 assert.match(main,/if \(wallboardUid !== wallboardPublisherUid\) \{ wallboardPublisher\?\.stop\(\); wallboardRefreshStatus\.reset\(\); \}/);
 assert.match(ui,/remoteRefreshError/);
 assert.match(ui,/TV 서버 게시 요청/);
});
