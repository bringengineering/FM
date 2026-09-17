import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {dirname,join,resolve,sep} from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const app=await electron.launch({executablePath:process.env.BRING_RND_PACKAGED_EXE||require('electron'),args:process.env.BRING_RND_PACKAGED_EXE?[]:['.'],cwd:dirname(fileURLToPath(import.meta.url)),timeout:15000,env:{...process.env,BRING_CRM_LOCAL_ONLY:'1',BRING_CRM_SCREENSHOT_ROLE:'admin',BRING_CRM_RND_CONTEXT_FIXTURE:'1'}});
const exportDirectory=await mkdtemp(join(tmpdir(),'bring-rnd-crm-export-'));
try{
 const page=await app.firstWindow({timeout:15000});page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(15000);console.log("STAGE native CRM launched");const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.waitForSelector('[data-view=rndControl]');await page.locator('[data-action=finish-guide]').click();await page.locator('[data-view=rndControl]').click();
 await page.waitForFunction(()=>document.getElementById('login').hidden);
 await page.locator('#newProject').click();await page.locator('.rnd-text-dialog input').fill('CRM context pilot');await page.locator('.rnd-text-dialog').getByRole('button',{name:'확인',exact:true}).click();
 await page.locator('#rndCrmContext summary').click();await page.locator('#crmContextRefresh').click();
 await page.locator('#crmContextCustomers option[value="rnd-test-customer"]').waitFor({state:'attached'});
 await page.locator('#crmContextCustomers').selectOption('rnd-test-customer');await page.locator('#crmContextBuildings').selectOption('rnd-test-building');await page.locator('#crmContextReason').fill('시험 대상 건물 연결');
 await page.locator('#crmContextFreeze').click();await page.waitForFunction(()=>document.getElementById('crmContextFreezeStatus').textContent.includes('공유 저장'));
 assert.equal(await page.evaluate(()=>Object.keys(window.BringRndProject.current().crmContexts??{}).length),0);
 await page.locator('#portfolioSave').click();await page.waitForFunction(()=>document.getElementById('portfolioStatus').textContent.includes('공유 저장 완료'));
 await page.locator('#crmContextFreeze').click();await page.waitForFunction(()=>document.getElementById('crmContextFreezeStatus').textContent.includes('고정 보관 완료'),null,{timeout:15000});
 const frozen=await page.evaluate(()=>window.BringRndProject.current());const records=Object.values(frozen.crmContexts);assert.equal(records.length,1);
 assert.equal(JSON.parse(records[0].snapshotJSON).testMode,true);assert.deepEqual(JSON.parse(records[0].buildingIdsJSON),['rnd-test-building']);
 assert.match(await page.locator('#crmContextHistory').textContent(),/시험 대상 건물 연결/);
 const error=await page.evaluate(async project=>{try{await window.bringCRM.rndSave({collection:'projects',data:{...project,crmContexts:{}}});return '';}catch(error){return error.message;}},frozen);assert.match(error,/삭제/);
 const fromShared=await page.evaluate(async project=>window.bringCRM.rndGet('projects',project.id),frozen);assert.equal(Object.keys(fromShared.crmContexts).length,1);
 for(const mode of ['internal','review']){await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},join(exportDirectory,mode+'.zip'));const result=await page.evaluate(async({project,mode})=>window.bringCRM.rndExport({projectId:project.id,revision:project.revision,mode}),{project:frozen,mode});assert.equal(result.saved,true);}
 const zipCheck=spawnSync('python',['-c',String.raw`import zipfile,json,hashlib,sys,posixpath,re
for mode,path in zip(['internal','review'],sys.argv[1:]):
 with zipfile.ZipFile(path) as z:
  assert z.testzip() is None
  m=json.loads(z.read('manifest.json'))
  assert len(m['includedCrmContexts']) == (1 if mode=='internal' else 0)
  if mode=='review':
   assert not any(n.startswith('crm-contexts/') for n in z.namelist())
   assert any(x['reason']=='CRM_DISCLOSURE_UNCONFIRMED' for x in m['excluded'])
   assert all(b'rnd-test-customer' not in z.read(n) for n in z.namelist())
  for item in m['files']:
   b=z.read(item['path']);assert len(b)==item['sizeBytes'] and hashlib.sha256(b).hexdigest()==item['sha256']
   text=b.decode('utf-8')
   for target in re.findall(r'\]\(([^)]+)\)',text):
    if not target.startswith(('http:','https:')):assert posixpath.normpath(posixpath.join(posixpath.dirname(item['path']),target)) in z.namelist()
print('PASS actual Main CRM context internal/review ZIP CRC, content exclusion, file hashes and relative links')`,join(exportDirectory,'internal.zip'),join(exportDirectory,'review.zip')],{encoding:'utf8'});assert.equal(zipCheck.status,0,zipCheck.stderr);console.log(zipCheck.stdout.trim());
 await app.evaluate(({ipcMain})=>{const original=ipcMain._invokeHandlers.get('crm:rnd-freeze-crm-context');ipcMain.removeHandler('crm:rnd-freeze-crm-context');ipcMain.handle('crm:rnd-freeze-crm-context',async(event,input)=>{const saved=await original(event,input);return new Promise(resolve=>{globalThis.rndCrmRelease=()=>{delete globalThis.rndCrmRelease;resolve(saved);};});});});
 await page.locator('#crmContextFreeze').click();assert.equal(await page.evaluate(()=>window.BringRndCrmContextPending()),true);
 await app.evaluate(async()=>{for(let i=0;i<50&&!globalThis.rndCrmRelease;i++)await new Promise(resolve=>setTimeout(resolve,100));if(!globalThis.rndCrmRelease)throw Error('trusted freeze did not reach delayed response');});
 await page.locator('#itemForm [name=goal]').fill('Unsubmitted goal while context save pending');await page.locator('#projectTitle').fill('Edited while context save pending');await app.evaluate(()=>globalThis.rndCrmRelease());
 await page.waitForFunction(()=>!window.BringRndCrmContextPending());assert.equal(await page.locator('#itemForm [name=goal]').inputValue(),'Unsubmitted goal while context save pending');assert.equal(await page.locator('#projectTitle').inputValue(),'Edited while context save pending');await page.locator('#projectTitle').blur();
 await page.waitForFunction(()=>document.getElementById('crmContextFreezeStatus').textContent.includes('대기 중 수정은 유지'));
 assert.equal(await page.evaluate(()=>window.BringRndProject.current().title),'Edited while context save pending');assert.equal(await page.evaluate(()=>window.BringRndProject.current().revision),frozen.revision);
 const latest=await page.evaluate(async project=>window.bringCRM.rndGet('projects',project.id),frozen);assert.equal(Object.keys(latest.crmContexts).length,2);
 await page.locator('#itemForm [name=actor]').fill('native test');await page.locator('#itemForm [name=changeReason]').fill('Preserve unsubmitted goal');await page.locator('#itemForm').evaluate(form=>form.requestSubmit());
 await page.locator('#compareProject').click();for(const checkbox of await page.locator('dialog.rnd-text-dialog input[type=checkbox]').all())await checkbox.check();await page.locator('dialog.rnd-text-dialog input[aria-label="재적용 이유"]').fill('Preserve pending title and goal with latest CRM context');await page.getByRole('button',{name:'선택 수정 재적용',exact:true}).click();
 await page.locator('#portfolioSave').click();await page.waitForFunction(revision=>window.BringRndProject.current().revision>revision,latest.revision);assert.equal(await page.evaluate(()=>Object.keys(window.BringRndProject.current().crmContexts).length),2);
 await page.locator('#crmContextFreeze').click();await app.evaluate(async()=>{for(let i=0;i<50&&!globalThis.rndCrmRelease;i++)await new Promise(resolve=>setTimeout(resolve,100));if(!globalThis.rndCrmRelease)throw Error('trusted freeze did not reach delayed response');});
 await page.evaluate(()=>window.dispatchEvent(new Event('rnd-session-reset')));await app.evaluate(()=>globalThis.rndCrmRelease());await page.waitForTimeout(100);
 assert.equal(await page.evaluate(()=>window.BringRndProject.current()),null);assert.equal(await page.locator('#crmContextHistory').textContent(),'선택 프로젝트의 고정 CRM 기록 없음');assert.equal(await page.locator('#crmContextReason').inputValue(),'');assert.equal(await page.evaluate(()=>window.BringRndCrmContextPending()),false);
 assert.deepEqual(errors,[]);console.log('PASS native CRM context selection, Main trusted freeze, immutable shared history and session cleanup (test fixture)');
}catch(error){const page=app.windows()[0];if(page)console.log('FAIL STATE',await page.evaluate(()=>({portfolio:document.getElementById('portfolioStatus')?.textContent,freeze:document.getElementById('crmContextFreezeStatus')?.textContent,connection:document.getElementById('connection')?.textContent,project:window.BringRndProject?.current()})));throw error;
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});if(!resolve(exportDirectory).startsWith(resolve(tmpdir())+sep))throw Error('Unsafe temporary export cleanup path');await rm(exportDirectory,{recursive:true,force:true});}
