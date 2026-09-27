// @vitest-environment node
import {test,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
test('background refresh retains project-progress pagination',async()=>{
 const dom=new JSDOM('<main></main>',{runScripts:'outside-only',url:'https://crm.test'});const w=dom.window as any;
 const timers=new Map<number,()=>void>();let counter=0;w.setInterval=(cb:()=>void)=>{timers.set(++counter,cb);return counter;};w.clearInterval=(id:number)=>timers.delete(id);
 w.eval(fs.readFileSync(path.resolve('../desktop-crm/src/company-wallboard.js'),'utf8'));
 const host=w.document.querySelector('main');let count=18;
 const stop=w.BringCompanyWallboard.mount(host,{load:async()=>({orders:[],projects:Array.from({length:count},(_,i)=>({id:String(i),name:'프로젝트 '+(i+1),owner:'담당 '+(i+1),progress:50}))})});
 await new Promise(r=>setTimeout(r,0));
 host.querySelector('[data-wb="next"]').click();expect(host.querySelector('h1').textContent).toBe('프로젝트별 진행률');host.querySelector('[data-wb="next"]').click();expect(host.querySelector('.wb-content').textContent).toContain('프로젝트 15');
 timers.get(2)!();await new Promise(r=>setTimeout(r,0));expect(host.querySelector('.wb-content').textContent).toContain('프로젝트 15');
 host.querySelector('[data-wb="next"]').click();expect(host.querySelectorAll('.wb-portfolio-bars>div').length).toBe(6);
 count=1;timers.get(2)!();await new Promise(r=>setTimeout(r,0));expect(host.querySelectorAll('.wb-portfolio-bars>div').length).toBe(1);
 stop();dom.window.close();
});
test('local playlist persists only controls and supports an empty playlist',async()=>{
 const dom=new JSDOM('<main></main>',{runScripts:'outside-only',url:'https://crm.test'});const w=dom.window as any;
 w.eval(fs.readFileSync(path.resolve('../desktop-crm/src/company-wallboard.js'),'utf8'));
 const host=w.document.querySelector('main');const options={load:async()=>({orders:[]})};
 let stop=w.BringCompanyWallboard.mount(host,options);
 await new Promise(r=>setTimeout(r,0));
 expect(host.querySelectorAll('[data-wb-enabled]').length).toBe(5);
 expect(host.querySelector('[data-wb-enabled="strategy"]')).not.toBeNull();
 expect(host.querySelector('[data-wb-enabled="companyRevenue"]')).not.toBeNull();
 expect(host.querySelector('.wb-content').textContent).not.toContain('게시된 회사 방향이 없습니다.');
 const seconds=host.querySelector('[data-wb-duration="portfolio"]');seconds.value='15';seconds.dispatchEvent(new w.Event('change',{bubbles:true}));
 const notice=host.querySelector('[data-wb-notice]');notice.value='PRIVATE_NOTICE';notice.dispatchEvent(new w.Event('change',{bubbles:true}));
 expect(w.localStorage.getItem('bring.wallboard.playlist.v1')).not.toContain('PRIVATE_NOTICE');
 stop();stop=w.BringCompanyWallboard.mount(host,options);await new Promise(r=>setTimeout(r,0));
 expect(host.querySelector('h1').textContent).toBe('회사 운영 요약');
 expect(host.querySelector('[data-wb-duration="portfolio"]').value).toBe('15');
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
 const stop=w.BringCompanyWallboard.mount(host,{load:async()=>{if(fail)throw Error('offline');return {orders:[{id:'a',status:'doing',assigneeName:'가상 직원',title:'DO_NOT_DISPLAY',projectId:'p'}],projects:[{id:'p',name:'프로젝트',owner:'가상 직원',progress:10}]};}});
 await new Promise(r=>setTimeout(r,0));expect(host.querySelector('h1').textContent).toBe('회사 운영 요약');host.querySelector('[data-wb="next"]').click();expect(host.querySelector('h1').textContent).toBe('프로젝트별 진행률');expect(host.textContent).toContain('가상 직원');expect(host.textContent).not.toContain('DO_NOT_DISPLAY');
 host.querySelector('[data-wb="next"]').click();expect(host.querySelector('h1').textContent).toBe('회사 공지');
 host.querySelector('[data-wb="pause"]').click();for(let i=0;i<35;i++)timers.get(1)!();expect(host.querySelector('h1').textContent).toBe('회사 공지');
 fail=true;host.querySelector('[data-wb="refresh"]').click();await new Promise(r=>setTimeout(r,0));expect(host.querySelector('footer').textContent).toContain('연결 확인 필요');expect(host.querySelector('footer').textContent).toContain('마지막 성공 갱신');
 stop();expect(timers.size).toBe(0);expect(host.querySelector('.wb-stage').textContent).toBe('');dom.window.close();
});
test('playlist skips disabled screens at their configured duration and clamps invalid values',async()=>{
 const dom=new JSDOM('<main></main>',{runScripts:'outside-only',url:'https://crm.test'});const w=dom.window as any;
 const timers=new Map<number,()=>void>();let counter=0;w.setInterval=(cb:()=>void)=>{timers.set(++counter,cb);return counter;};w.clearInterval=(id:number)=>timers.delete(id);
 w.localStorage.setItem('bring.wallboard.playlist.v1',JSON.stringify([{key:'unknown'},{key:'portfolio',seconds:1},{key:'portfolio',seconds:100},{key:'status',enabled:false},{key:'issues',seconds:999}]));
 w.eval(fs.readFileSync(path.resolve('../desktop-crm/src/company-wallboard.js'),'utf8'));
 const host=w.document.querySelector('main');const stop=w.BringCompanyWallboard.mount(host,{load:async()=>({orders:[]})});await new Promise(r=>setTimeout(r,0));
 expect(host.querySelectorAll('[data-wb-enabled]').length).toBe(5);
 expect(host.querySelector('[data-wb-enabled="companyRevenue"]')).not.toBeNull();
 expect(host.querySelector('[data-wb-duration="portfolio"]').value).toBe('10');
 expect(host.querySelector('[data-wb-enabled="issues"]')).toBeNull();
 expect(host.querySelector('h1').textContent).toBe('프로젝트별 진행률');
 for(let i=0;i<9;i++)timers.get(1)!();expect(host.querySelector('h1').textContent).toBe('프로젝트별 진행률');
 timers.get(1)!();expect(host.querySelector('h1').textContent).toBe('회사 운영 요약');
 for(let i=0;i<44;i++)timers.get(1)!();expect(host.querySelector('h1').textContent).toBe('회사 운영 요약');
 timers.get(1)!();expect(host.querySelector('h1').textContent).toBe('회사 공지');
 stop();expect(timers.size).toBe(0);dom.window.close();
});
