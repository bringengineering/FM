import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),app=await electron.launch({executablePath:process.env.BRING_RND_PACKAGED_EXE||require('electron'),args:process.env.BRING_RND_PACKAGED_EXE?[]:['.'],env:{...process.env,BRING_CRM_LOCAL_ONLY:'1',BRING_CRM_SCREENSHOT_ROLE:'admin'}});
try{
 const page=await app.firstWindow();page.setDefaultTimeout(15000);await page.locator('[data-action=finish-guide]').waitFor();await page.locator('[data-action=finish-guide]').click();await page.locator('[data-view=rndControl]').click();
 assert.equal(await page.evaluate(()=>typeof window.bringCRM.rndExportOriginalBackup),'function');console.log('PASS actual Electron preload exposes original backup ID request API');
 const denied=await page.evaluate(async()=>{try{await window.bringCRM.rndExportOriginalBackup({projectId:'p'});return'accepted';}catch(error){return error.message;}});assert.match(denied,/로컬 시험/);console.log('PASS genuine Main denies company original backup before snapshot/download/save dialog in local test');
 console.log('SCOPE: actual Main/preload local denial; company backup success and original restore are not tested');
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close();}
