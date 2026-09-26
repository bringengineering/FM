const test=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const {createTvUpdateController}=require('../src/tv-update-controller');
function updater(){const value=new EventEmitter();return Object.assign(value,{feeds:[],checks:0,downloads:0,installs:0,setFeedURL(feed){this.feeds.push(feed);},async checkForUpdates(){this.checks++;},async downloadUpdate(){this.downloads++;},quitAndInstall(){this.installs++;}});}
test('downloads and restarts only the administrator-approved exact TV version',async()=>{
 const api=updater(),timers=[];const controller=createTvUpdateController({updater:api,currentVersion:'0.1.2',resolveChannel:async()=>({version:'0.2.0',feedUrl:'https://github.com/bringengineering/FM/releases/download/tv-v0.2.0/'}),schedule:fn=>{timers.push(fn);return 1;}});
 assert.deepEqual(await controller.accept({targetVersion:'0.2.0'}),{status:'downloading',error:''});
 assert.deepEqual(api.feeds,[{provider:'generic',url:'https://github.com/bringengineering/FM/releases/download/tv-v0.2.0/'}]);assert.equal(api.checks,1);assert.equal(api.downloads,1);
 api.emit('update-downloaded',{version:'0.2.0'});assert.deepEqual(controller.report(),{status:'ready',error:''});assert.equal(api.installs,0);
 timers[0]();assert.deepEqual(controller.report(),{status:'installing',error:''});assert.equal(api.installs,1);controller.dispose();
});
test('channel mismatch fails closed and never reaches the updater',async()=>{
 const api=updater(),controller=createTvUpdateController({updater:api,currentVersion:'0.1.2',resolveChannel:async()=>({version:'0.3.0',feedUrl:'https://example.invalid/'})});
 assert.deepEqual(await controller.accept({targetVersion:'0.2.0'}),{status:'failed',error:'TARGET_MISMATCH'});assert.equal(api.checks,0);assert.equal(api.downloads,0);controller.dispose();
});
test('a duplicate command cannot start an overlapping download',async()=>{
 let release;const api=updater();api.downloadUpdate=()=>new Promise(resolve=>{release=resolve;api.downloads++;});const controller=createTvUpdateController({updater:api,currentVersion:'0.1.2',resolveChannel:async()=>({version:'0.2.0',feedUrl:'https://github.com/bringengineering/FM/releases/download/tv-v0.2.0/'})});
 const first=controller.accept({targetVersion:'0.2.0'});await new Promise(setImmediate);assert.deepEqual(await controller.accept({targetVersion:'0.2.0'}),{status:'downloading',error:''});assert.equal(api.downloads,1);release();await first;controller.dispose();
});
