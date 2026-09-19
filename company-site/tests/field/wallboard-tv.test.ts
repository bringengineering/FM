// @vitest-environment node
import {test,expect} from 'vitest';import {JSDOM} from 'jsdom';import fs from 'node:fs';import path from 'node:path';
test('read-only TV enrolls then displays publication and removes it when revoked',async()=>{
 const source=(name:string)=>fs.readFileSync(path.resolve('../desktop-crm/src',name),'utf8');
 const dom=new JSDOM(source('wallboard-tv.html'),{runScripts:'outside-only'});const w=dom.window as any;
 const timers=new Map<number,()=>void>();let number=0;w.setInterval=(fn:()=>void)=>{timers.set(++number,fn);return number;};w.clearInterval=(id:number)=>timers.delete(id);
 let paired=false,revoked=false;w.bringTV={start:async()=>({code:'ABC12345',expiresAt:Date.now()+600000}),poll:async()=>{paired=true;return {paired:true};},fullscreen:async()=>{},display:async()=>!paired||revoked?{paired:false,revoked}:{paired:true,board:{version:1,publishedAt:Date.now(),dataDate:'2026-09-20',notice:'공용 공지',playlist:[{key:'notice',enabled:true,seconds:30}],model:{}}}};
 w.eval(source('company-wallboard.js'));w.eval(source('wallboard-tv-renderer.js'));await new Promise(r=>setTimeout(r,0));
 w.document.querySelector('#connect').click();await new Promise(r=>setTimeout(r,0));expect(w.document.querySelector('#pair-code').textContent).toBe('ABC12345');
 timers.get(1)!();await new Promise(r=>setTimeout(r,0));expect(w.document.querySelector('.wb-content').textContent).toContain('공용 공지');expect(w.document.querySelector('#connect').hidden).toBe(true);
 revoked=true;w.document.querySelector('#refresh').click();await new Promise(r=>setTimeout(r,0));expect(w.document.querySelector('.wb-stage').hidden).toBe(true);expect(w.document.querySelector('#connect').hidden).toBe(false);
 w.dispatchEvent(new w.Event('beforeunload'));expect(timers.size).toBe(0);dom.window.close();
});
