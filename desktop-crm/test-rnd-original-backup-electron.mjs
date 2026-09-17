import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),app=await electron.launch({executablePath:process.env.BRING_RND_PACKAGED_EXE||require('electron'),args:process.env.BRING_RND_PACKAGED_EXE?[]:['.'],env:{...process.env,BRING_CRM_LOCAL_ONLY:'1',BRING_CRM_SCREENSHOT_ROLE:'admin'}});
try{
 const page=await app.firstWindow();page.setDefaultTimeout(15000);await page.locator('[data-action=finish-guide]').waitFor();await page.locator('[data-action=finish-guide]').click();await page.locator('[data-view=rndControl]').click();
 await page.locator('#rndOriginalBackup').waitFor();assert.equal(await page.locator('#rndOriginalBackup').textContent(),'공유 원본 자료 보관');await page.locator('#rndOriginalBackup').click();await page.getByText('원본 자료 보관 미완료 · 공유 프로젝트 선택과 연결이 필요합니다',{exact:true}).waitFor();console.log('PASS actual CRM original backup button denies missing shared project before IPC');
 assert.equal(await page.evaluate(()=>typeof window.bringCRM.rndExportOriginalBackup),'function');console.log('PASS actual Electron preload exposes original backup ID request API');
 const denied=await page.evaluate(async()=>{try{await window.bringCRM.rndExportOriginalBackup({projectId:'p'});return'accepted';}catch(error){return error.message;}});assert.match(denied,/로컬 시험/);console.log('PASS genuine Main denies company original backup before snapshot/download/save dialog in local test');
 await page.locator('#rndInspectOriginalBackup').click();await page.getByText(/보관본 검증 미완료.*로컬 시험에서는 회사 보관본을 열지 않습니다/).waitFor();console.log('PASS actual CRM inspection button and genuine Main local denial before file selection');
 const reviewDenied=await page.evaluate(async()=>{try{await window.bringCRM.rndReviewOriginalRestore();return 'accepted';}catch(error){return error.message;}});assert.match(reviewDenied,/로컬 시험/);console.log('PASS actual preload original restore review API and genuine Main denial before file selection');
 console.log('SCOPE: actual Main/preload local denial; company backup success and original restore are not tested');
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close();}
