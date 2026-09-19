// @vitest-environment node
import {test,expect} from 'vitest';import {JSDOM} from 'jsdom';import fs from 'node:fs';import path from 'node:path';
test('automatic publication requires consent, freezes approved layout, and exposes stop',async()=>{
 const dom=new JSDOM('<main></main>',{runScripts:'outside-only'});const w=dom.window as any;w.eval(fs.readFileSync(path.resolve('../desktop-crm/src/wallboard-admin-ui.js'),'utf8'));
 const calls:any[]=[];const host=w.document.querySelector('main');let allow=false;
 const snapshot={notice:'공지',playlist:[{key:'people',enabled:true,seconds:30}]};
 const dispose=w.BringWallboardAdmin.mount(host,{confirm:()=>allow,getPublication:()=>snapshot,request:async(i:any)=>{calls.push(i);return i.action==='list'?{version:2,devices:[]}:{active:i.action==='auto-start',version:3,publishedAt:123};}});
 await new Promise(r=>setTimeout(r,0));expect(host.querySelector('[data-auto-start]')).not.toBeNull();
 host.querySelector('[data-auto-start]').click();expect(calls.some(i=>i.action==='auto-start')).toBe(false);
 allow=true;host.querySelector('[data-auto-start]').click();await new Promise(r=>setTimeout(r,0));expect(calls).toContainEqual({action:'auto-start',...snapshot,expectedVersion:2});
 host.querySelector('[data-auto-stop]').click();await new Promise(r=>setTimeout(r,0));expect(calls).toContainEqual({action:'auto-stop'});
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
