import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {dirname,join,resolve,sep} from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const app=await electron.launch({executablePath:process.env.BRING_RND_PACKAGED_EXE||require('electron'),args:process.env.BRING_RND_PACKAGED_EXE?[]:['.'],cwd:dirname(fileURLToPath(import.meta.url)),timeout:20000,env:{...process.env,BRING_CRM_LOCAL_ONLY:'1',BRING_CRM_SCREENSHOT_ROLE:'admin'}});
try{
 const page=await app.firstWindow();page.setDefaultTimeout(15000);await page.waitForSelector('[data-view=rndControl]');await page.locator('[data-action=finish-guide]').click();await page.locator('[data-view=rndControl]').click();await page.waitForFunction(()=>document.getElementById('login').hidden);
 await page.locator('#newProject').click();await page.locator('.rnd-text-dialog input').fill('Observation pilot');await page.locator('.rnd-text-dialog').getByRole('button',{name:'확인',exact:true}).click();await page.locator('#portfolioSave').click();await page.waitForFunction(()=>document.getElementById('portfolioStatus').textContent.includes('공유 저장 완료'));
 const observations=await page.evaluate(async()=>{let p=window.BringRndProject.current();const uid=p.updatedBy,plan={id:'observation-exp',hypothesis:'H2',question:'Temperature',comparison:'Prior reading',population:'building-1',period:'2026-09',metrics:'C',analysis:'Descriptive',success:'Valid reading',stop:'Unsafe access',reviewerUid:uid};const commands=[{type:'create',plan},{type:'approve',id:plan.id,selfReviewReason:'Single fixture account'},{type:'start',id:plan.id}];for(const status of ['OBSERVED','MISSING','NOT_INSPECTED','UNOBSERVABLE'])commands.push({type:'observation',observation:{id:'obs-'+status,experimentId:plan.id,unitId:'building-1',name:'Temperature',unit:'C',status,value:status==='OBSERVED'?0:null,reason:'Field inspection',observedAt:'2026-09-16T00:00:00.000Z',recordedBy:'forged'}});for(const command of commands)p=await window.bringCRM.rndWorkflow({projectId:p.id,expectedRevision:p.revision,command});const shared=await window.bringCRM.rndGet('projects',p.id);return{records:shared.research.observations,uid};});
 assert.equal(observations.records.length,4);for(const record of observations.records){assert.equal(record.value,record.status==='OBSERVED'?0:null);assert.equal(record.recordedBy,observations.uid);assert.equal(record.planRevision,1);}console.log('PASS actual Main observation records preserve zero/null/status and trusted actor (local fixture; UI not yet implemented)');
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
