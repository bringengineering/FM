import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {boundedJson} from '../src/weekly-report-delivery.js';

const names=['WEEKLY_REPORT_TELEGRAM_BOT_TOKEN','WEEKLY_REPORT_TELEGRAM_CHAT_ID','WALLBOARD_READER_UID'];
const values=Object.fromEntries(names.map(name=>[name,process.env[name]||'']));
if(!/^\d{6,12}:[A-Za-z0-9_-]{30,50}$/.test(values[names[0]])||!/^-[0-9]{5,20}$/.test(values[names[1]]))throw new Error('WEEKLY_TELEGRAM_SECRETS_REQUIRED');
if(!/^[A-Za-z0-9._-]{1,128}$/.test(values.WALLBOARD_READER_UID))throw new Error('SERVER_READER_UID_REQUIRED');
// Morning delivery must not activate or disable the unrelated TV recovery job.
const token=process.env.CLOUDFLARE_API_TOKEN;
if(!token)throw new Error('CLOUDFLARE_AUTH_REQUIRED');
const settingsResponse=await fetch('https://api.cloudflare.com/client/v4/accounts/3c3bcd08bb6ed3a7a8f98c292386c327/workers/scripts/bring-crm-ai-gateway/settings',{
  headers:{authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(15000),
});
if(!settingsResponse.ok)throw new Error('WORKER_SETTINGS_UNAVAILABLE');
const settings=await boundedJson(settingsResponse,1024*1024);
if(settings.success!==true||!Array.isArray(settings.result?.bindings))throw new Error('WORKER_SETTINGS_UNAVAILABLE');
const tvValue=settings.result.bindings.find(item=>item.name==='WALLBOARD_SCHEDULED_REFRESH_ENABLED'&&item.type==='plain_text')?.text;
if(tvValue!==undefined&&!['true','false'].includes(tvValue))throw new Error('WORKER_SETTINGS_UNAVAILABLE');
const tvRefreshEnabled=tvValue==='true'?'true':'false';
// Secrets enter the same Worker deployment as code. No separate early secret
// deployment; all existing unrelated Worker secrets are inherited by Wrangler.
const directory=await mkdtemp(path.join(tmpdir(),'bring-weekly-secrets-'));
try{
  const file=path.join(directory,'secrets.json');
  await writeFile(file,JSON.stringify(values),{mode:0o600,flag:'wx'});
  const status=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[path.resolve('node_modules/wrangler/bin/wrangler.js'),'deploy','--keep-vars','--var',`WALLBOARD_SCHEDULED_REFRESH_ENABLED:${tvRefreshEnabled}`,'--secrets-file',file],{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:180000});
    // Wrangler also lists ordinary bindings, which can contain staff addresses.
    // Drain bounded output without forwarding any values into CI logs.
    let outputBytes=0;const drain=chunk=>{outputBytes+=chunk.length;if(outputBytes>2*1024*1024)child.kill();};
    child.stdout.on('data',drain);child.stderr.on('data',drain);
    child.on('error',reject);child.on('exit',code=>resolve(code));
  });
  if(status!==0)throw new Error('WORKER_DEPLOY_FAILED');
  console.log('Worker deployment completed. Secret values and binding contents were omitted.');
}finally{await rm(directory,{recursive:true,force:true});}
