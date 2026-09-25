// @vitest-environment node
import {test,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
test('background refresh retains pagination so every employee can be displayed',async()=>{
 const dom=new JSDOM('<main></main>',{runScripts:'outside-only',url:'https://crm.test'});const w=dom.window as any;
 const timers=new Map<number,()=>void>();let counter=0;w.setInterval=(cb:()=>void)=>{timers.set(++counter,cb);return counter;};w.clearInterval=(id:number)=>timers.delete(id);
 w.eval(fs.readFileSync(path.resolve('../desktop-crm/src/company-wallboard.js'),'utf8'));
 const host=w.document.querySelector('main');let count=18;
 const stop=w.BringCompanyWallboard.mount(host,{load:async()=>({orders:Array.from({length:count},(_,i)=>({id:String(i),status:'doing',assigneeName:'직원 '+(i+1)}))})});
 await new Promise(r=>setTimeout(r,0));
 for(let i=0;i<7;i++)host.querySelector('[data-wb="next"]').click();
 host.querySelector('[data-wb="next"]').click();expect(host.querySelector('.wb-content').textContent).toContain('2/3페이지');
 timers.get(2)!();await new Promise(r=>setTimeout(r,0));expect(host.querySelector('.wb-content').textContent).toContain('2/3페이지');
 host.querySelector('[data-wb="next"]').click();expect(host.querySelector('.wb-content').textContent).toContain('직원 18');
 count=1;timers.get(2)!();await new Promise(r=>setTimeout(r,0));expect(host.querySelector('.wb-content').textContent).toContain('1/1페이지');
 stop();dom.window.close();
});
test('local playlist persists only controls and supports an empty playlist',async()=>{
 const dom=new JSDOM('<main></main>',{runScripts:'outside-only',url:'https://crm.test'});const w=dom.window as any;
 w.eval(fs.readFileSync(path.resolve('../desktop-crm/src/company-wallboard.js'),'utf8'));
 const host=w.document.querySelector('main');const options={load:async()=>({orders:[]})};
 let stop=w.BringCompanyWallboard.mount(host,options);
 await new Promise(r=>setTimeout(r,0));
 expect(host.querySelectorAll('[data-wb-enabled]').length).toBe(12);
 expect(host.querySelector('[data-wb-enabled="strategy"]')).not.toBeNull();
 expect(host.querySelector('[data-wb-enabled="companyRevenue"]')).not.toBeNull();
 expect(host.querySelector('.wb-content').textContent).not.toContain('게시된 회사 방향이 없습니다.');
 const seconds=host.querySelector('[data-wb-duration="people"]');seconds.value='15';seconds.dispatchEvent(new w.Event('change',{bubbles:true}));
 const notice=host.querySelector('[data-wb-notice]');notice.value='PRIVATE_NOTICE';notice.dispatchEvent(new w.Event('change',{bubbles:true}));
 expect(w.localStorage.getItem('bring.wallboard.playlist.v1')).not.toContain('PRIVATE_NOTICE');
 stop();stop=w.BringCompanyWallboard.mount(host,options);await new Promise(r=>setTimeout(r,0));
 expect(host.querySelector('h1').textContent).toBe('프로젝트 로드맵 · 8주 요약');
 expect(host.querySelector('[data-wb-duration="people"]').value).toBe('15');
 for(const box of host.querySelectorAll('[data-wb-enabled]')){box.checked=false;box.dispatchEvent(new w.Event('change',{bubbles:true}));}
 expect(host.querySelector('.wb-content').textContent).toContain('표시할 화면을 선택');
 host.querySelector('[data-wb="next"]').click();expect(host.querySelector('.wb-content').textContent).toContain('표시할 화면을 선택');
 stop();dom.window.close();
});
test('wallboard mounts, rotates, freezes, handles failure and disposes without writes',async()=>{
 const dom=new JSDOM('<main></main>',{runScripts:'outside-only'});const w=dom.window as any;
 const timers=new Map<number,()=>void>();let counter=0;w.setInterval=(cb:()=>void)=>{timers.set(++counter,cb);return counter;};w.clearInterval=(id:number)=>timers.delete(id);
 w.eval(fs.readFileSync(path.resolve('../desktop-crm/src/company-wallboard.js'),'utf8'));
 let fail=false;const host=w.document.querySelector('main');
 const stop=w.BringCompanyWallboard.mount(host,{load:async()=>{if(fail)throw Error('offline');return {orders:[{id:'a',status:'doing',assigneeName:'가상 직원',title:'DO_NOT_DISPLAY'}]};}});
 await new Promise(r=>setTimeout(r,0));for(let i=0;i<7;i++)host.querySelector('[data-wb="next"]').click();expect(host.textContent).toContain('가상 직원');expect(host.textContent).not.toContain('DO_NOT_DISPLAY');
 host.querySelector('[data-wb="next"]').click();expect(host.querySelector('h1').textContent).toBe('확인할 이슈');
 host.querySelector('[data-wb="pause"]').click();for(let i=0;i<35;i++)timers.get(1)!();expect(host.querySelector('h1').textContent).toBe('확인할 이슈');
 fail=true;host.querySelector('[data-wb="refresh"]').click();await new Promise(r=>setTimeout(r,0));expect(host.querySelector('footer').textContent).toContain('연결 확인 필요');expect(host.querySelector('footer').textContent).toContain('마지막 성공 갱신');
 stop();expect(timers.size).toBe(0);expect(host.querySelector('.wb-stage').textContent).toBe('');dom.window.close();
});
test('playlist skips disabled screens at their configured duration and clamps invalid values',async()=>{
 const dom=new JSDOM('<main></main>',{runScripts:'outside-only',url:'https://crm.test'});const w=dom.window as any;
 const timers=new Map<number,()=>void>();let counter=0;w.setInterval=(cb:()=>void)=>{timers.set(++counter,cb);return counter;};w.clearInterval=(id:number)=>timers.delete(id);
 w.localStorage.setItem('bring.wallboard.playlist.v1',JSON.stringify([{key:'unknown'},{key:'people',seconds:1},{key:'people',seconds:100},{key:'status',enabled:false},{key:'issues',seconds:999}]));
 w.eval(fs.readFileSync(path.resolve('../desktop-crm/src/company-wallboard.js'),'utf8'));
 const host=w.document.querySelector('main');const stop=w.BringCompanyWallboard.mount(host,{load:async()=>({orders:[]})});await new Promise(r=>setTimeout(r,0));
 expect(host.querySelectorAll('[data-wb-enabled]').length).toBe(12);
 expect(host.querySelector('[data-wb-enabled="companyRevenue"]')).not.toBeNull();
 expect(host.querySelector('[data-wb-duration="people"]').value).toBe('10');
 expect(host.querySelector('[data-wb-duration="issues"]').value).toBe('120');
 for(let i=0;i<9;i++)timers.get(1)!();expect(host.querySelector('h1').textContent).toBe('사람별 업무');
 timers.get(1)!();expect(host.querySelector('h1').textContent).toBe('확인할 이슈');
 stop();expect(timers.size).toBe(0);dom.window.close();
});
