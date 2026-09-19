// @vitest-environment node
import {test,expect} from 'vitest';import {JSDOM} from 'jsdom';import fs from 'node:fs';import path from 'node:path';
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
