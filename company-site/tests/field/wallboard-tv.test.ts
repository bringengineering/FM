// @vitest-environment node
import {test,expect} from 'vitest';import {JSDOM} from 'jsdom';import fs from 'node:fs';import path from 'node:path';
test('new data does not restart an unchanged playlist before later scenes are shown',async()=>{
 const source=(name:string)=>fs.readFileSync(path.resolve('../desktop-crm/src',name),'utf8');const dom=new JSDOM(source('wallboard-tv.html'),{runScripts:'outside-only'});const w=dom.window as any;
 const timers:any[]=[];w.setInterval=(fn:any)=>{timers.push(fn);return timers.length;};w.clearInterval=()=>{};let version=1;
 w.bringTV={display:async()=>({paired:true,board:{version,publishedAt:1,dataDate:'2026-09-20',notice:'공지',playlist:[{key:'notice',enabled:true,seconds:10},{key:'status',enabled:true,seconds:10}],model:{counts:{assigned:0,doing:0,submitted:0,returned:0,done:0},total:0,unknown:0}}})};
 w.eval(source('company-wallboard.js'));w.eval(source('wallboard-tv-renderer.js'));await new Promise(r=>setTimeout(r,0));for(let n=0;n<10;n++)timers[1]();expect(w.document.querySelector('#scene-title').textContent).toBe('업무 진행 현황');
 version++;w.document.querySelector('#refresh').click();await new Promise(r=>setTimeout(r,0));expect(w.document.querySelector('#scene-title').textContent).toBe('업무 진행 현황');w.dispatchEvent(new w.Event('beforeunload'));dom.window.close();
});
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
