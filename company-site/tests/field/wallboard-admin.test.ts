// @vitest-environment node
import {test,expect} from 'vitest';import {JSDOM} from 'jsdom';import fs from 'node:fs';import path from 'node:path';
test('device list distinguishes last server access from actual screen verification',async()=>{
 const dom=new JSDOM('<main></main>',{runScripts:'outside-only'});const w=dom.window as any;
 w.eval(fs.readFileSync(path.resolve('../desktop-crm/src/wallboard-admin-ui.js'),'utf8'));
 const host=w.document.querySelector('main'),seen=Date.parse('2026-09-20T01:23:00Z');
 const stop=w.BringWallboardAdmin.mount(host,{request:async()=>({version:1,devices:[
  {id:'a',name:'회의실',lastSeenAt:seen,clientVersion:'0.1.2'},{id:'b',name:'미접속',lastSeenAt:null},
  {id:'c',name:'해제 TV',lastSeenAt:seen,revokedAt:seen+1}
 ]})});
 await new Promise(r=>setTimeout(r,0));
 const rows=host.querySelectorAll('.wb-playlist-row');
 expect(rows[0].textContent).toContain('마지막 서버 접속');
 expect(rows[0].textContent).toContain('TV 버전 0.1.2');
 expect(rows[1].textContent).toContain('TV 버전 미확인');
 expect(rows[0].querySelector('time')?.dateTime).toBe(new Date(seen).toISOString());
 expect(rows[1].textContent).toContain('서버 접속 기록 없음');
 expect(rows[2].textContent).toContain('해제됨');
 expect(rows[2].querySelector('button')).toBeNull();
 expect(host.textContent).toContain('실제 TV 화면 표시는 별도로 확인');
 stop();dom.window.close();
});
test('live publication status is visible and supports immediate recovery',async()=>{
 const dom=new JSDOM('<main></main>',{runScripts:'outside-only'});const w=dom.window as any;w.eval(fs.readFileSync(path.resolve('../desktop-crm/src/wallboard-admin-ui.js'),'utf8'));
 const calls:any[]=[];const host=w.document.querySelector('main');
 const dispose=w.BringWallboardAdmin.mount(host,{request:async(i:any)=>{calls.push(i);if(i.action==='list')return {version:2,devices:[]};if(i.action==='live-sync')return {active:true,busy:false,version:3,publishedAt:2000,error:''};return {active:true,busy:false,version:2,publishedAt:1000,error:''};}});
 await new Promise(r=>setTimeout(r,0));expect(host.textContent).toContain('실시간 반영 중');
 expect(host.querySelector('[data-live-sync]')).not.toBeNull();expect(host.querySelector('[data-auto-start]')).toBeNull();expect(host.querySelector('[data-auto-stop]')).toBeNull();
 host.querySelector('[data-live-sync]').click();await new Promise(r=>setTimeout(r,0));expect(calls).toContainEqual({action:'live-sync'});expect(host.textContent).toContain('게시 버전 3');
 dispose();dom.window.close();
});
test('publication requires confirmation and uses loaded server revision',async()=>{
 const dom=new JSDOM('<main></main>',{runScripts:'outside-only'});const w=dom.window as any;w.eval(fs.readFileSync(path.resolve('../desktop-crm/src/wallboard-admin-ui.js'),'utf8'));
 const calls:any[]=[];let allow=false;const host=w.document.querySelector('main');const snapshot={notice:'확인된 공지'};
 const stop=w.BringWallboardAdmin.mount(host,{confirm:()=>allow,getPublication:()=>snapshot,request:async(i:any)=>{calls.push(i);return i.action==='list'?{version:3,devices:[]}:{version:4,publishedAt:1000};}});
 await new Promise(r=>setTimeout(r,0));expect(host.querySelector('[data-device-publish]')).not.toBeNull();
 host.querySelector('[data-device-publish]').click();expect(calls.filter(i=>i.action==='publish')).toHaveLength(0);
 allow=true;host.querySelector('[data-device-publish]').click();await new Promise(r=>setTimeout(r,0));expect(calls).toContainEqual({action:'publish',snapshot,expectedVersion:3});expect(host.textContent).toContain('게시했습니다');
 stop();dom.window.close();
});
test('TV admin approves explicit code, refreshes and confirms before revoking',async()=>{
 const dom=new JSDOM('<main></main>',{runScripts:'outside-only'});const w=dom.window as any;
 w.eval(fs.readFileSync(path.resolve('../desktop-crm/src/wallboard-admin-ui.js'),'utf8'));
 const requests:any[]=[];let confirm=false;const host=w.document.querySelector('main');
 const stop=w.BringWallboardAdmin.mount(host,{confirm:()=>confirm,request:async(input:any)=>{requests.push(input);return input.action==='list'?{devices:[{id:'d',name:'<b>TV</b>',revokedAt:null}]}:{status:input.action==='approve'?'approved':'revoked'};}});
 await new Promise(r=>setTimeout(r,0));expect(host.querySelector('b')).toBeNull();
 host.querySelector('[name="code"]').value='abc12345';host.querySelector('[name="name"]').value='회의실';host.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 await new Promise(r=>setTimeout(r,0));expect(requests).toContainEqual({action:'approve',code:'ABC12345',name:'회의실'});
 host.querySelector('[data-device]').click();await new Promise(r=>setTimeout(r,0));expect(requests.filter(x=>x.action==='revoke')).toHaveLength(0);
 confirm=true;host.querySelector('[data-device]').click();await new Promise(r=>setTimeout(r,0));expect(requests).toContainEqual({action:'revoke',deviceId:'d'});
 stop();dom.window.close();
});
test('administrator schedules the verified latest version per device and can cancel it',async()=>{
 const dom=new JSDOM('<main></main>',{runScripts:'outside-only'});const w=dom.window as any;
 w.eval(fs.readFileSync(path.resolve('../desktop-crm/src/wallboard-admin-ui.js'),'utf8'));
 const deviceId='11111111-1111-4111-8111-111111111111',requests:any[]=[];let allow=false;const host=w.document.querySelector('main');let scheduled=false;
 const stop=w.BringWallboardAdmin.mount(host,{confirm:()=>allow,request:async(input:any)=>{requests.push(input);if(input.action==='list')return {version:1,latestVersion:'0.2.0',devices:[{id:deviceId,name:'회의실 TV',clientVersion:'0.1.2',targetVersion:scheduled?'0.2.0':null,updateStatus:scheduled?'downloading':'idle'}]};if(input.action==='schedule-update'){scheduled=true;return {status:'scheduled',targetVersion:'0.2.0'};}if(input.action==='cancel-update'){scheduled=false;return {status:'cancelled'};}return {status:'revoked'};}});
 await new Promise(r=>setTimeout(r,0));expect(host.textContent).toContain('현재 0.1.2');expect(host.textContent).toContain('최신 0.2.0');
 const update=host.querySelector('[data-device-update]') as HTMLButtonElement;expect(update).not.toBeNull();update.click();expect(requests.some(x=>x.action==='schedule-update')).toBe(false);
 allow=true;update.click();await new Promise(r=>setTimeout(r,0));expect(requests).toContainEqual({action:'schedule-update',deviceId,targetVersion:'0.2.0'});expect(host.textContent).toContain('다운로드 중');
 const cancel=host.querySelector('[data-device-update-cancel]') as HTMLButtonElement;expect(cancel).not.toBeNull();cancel.click();await new Promise(r=>setTimeout(r,0));expect(requests).toContainEqual({action:'cancel-update',deviceId});
 stop();dom.window.close();
});
