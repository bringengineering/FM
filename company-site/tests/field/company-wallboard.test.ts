// @vitest-environment node
import {test,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
test('wallboard mounts, rotates, freezes, handles failure and disposes without writes',async()=>{
 const dom=new JSDOM('<main></main>',{runScripts:'outside-only'});const w=dom.window as any;
 const timers=new Map<number,()=>void>();let counter=0;w.setInterval=(cb:()=>void)=>{timers.set(++counter,cb);return counter;};w.clearInterval=(id:number)=>timers.delete(id);
 w.eval(fs.readFileSync(path.resolve('../desktop-crm/src/company-wallboard.js'),'utf8'));
 let fail=false;const host=w.document.querySelector('main');
 const stop=w.BringCompanyWallboard.mount(host,{load:async()=>{if(fail)throw Error('offline');return {orders:[{id:'a',status:'doing',assigneeName:'가상 직원',title:'DO_NOT_DISPLAY'}]};}});
 await new Promise(r=>setTimeout(r,0));expect(host.textContent).toContain('가상 직원');expect(host.textContent).not.toContain('DO_NOT_DISPLAY');
 host.querySelector('[data-wb="next"]').click();expect(host.querySelector('h1').textContent).toBe('업무 진행 현황');
 host.querySelector('[data-wb="pause"]').click();for(let i=0;i<35;i++)timers.get(1)!();expect(host.querySelector('h1').textContent).toBe('업무 진행 현황');
 fail=true;host.querySelector('[data-wb="refresh"]').click();await new Promise(r=>setTimeout(r,0));expect(host.querySelector('footer').textContent).toContain('연결 확인 필요');expect(host.querySelector('footer').textContent).toContain('마지막 성공 갱신');
 stop();expect(timers.size).toBe(0);expect(host.querySelector('.wb-stage').textContent).toBe('');dom.window.close();
});
