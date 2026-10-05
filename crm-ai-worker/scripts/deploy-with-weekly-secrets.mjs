import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

const names=['WEEKLY_REPORT_TELEGRAM_BOT_TOKEN','WEEKLY_REPORT_TELEGRAM_CHAT_ID'];
const values=Object.fromEntries(names.map(name=>[name,process.env[name]||'']));
if(!/^\d{6,12}:[A-Za-z0-9_-]{30,50}$/.test(values[names[0]])||!/^-[0-9]{5,20}$/.test(values[names[1]]))throw new Error('WEEKLY_TELEGRAM_SECRETS_REQUIRED');
// Secrets enter the same Worker deployment as code. No separate early secret
// deployment; all existing unrelated Worker secrets are inherited by Wrangler.
const directory=await mkdtemp(path.join(tmpdir(),'bring-weekly-secrets-'));
try{
  const file=path.join(directory,'secrets.json');
  await writeFile(file,JSON.stringify(values),{mode:0o600,flag:'wx'});
  const status=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[path.resolve('node_modules/wrangler/bin/wrangler.js'),'deploy','--keep-vars','--var','WALLBOARD_SCHEDULED_REFRESH_ENABLED:true','--secrets-file',file],{shell:false,windowsHide:true,stdio:'inherit',timeout:180000});
    child.on('error',reject);child.on('exit',code=>resolve(code));
  });
  if(status!==0)throw new Error('WORKER_DEPLOY_FAILED');
}finally{await rm(directory,{recursive:true,force:true});}
