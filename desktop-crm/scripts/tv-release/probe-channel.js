'use strict';
const {resolveTvChannel}=require('../../src/tv-update-policy');
async function probeChannel({version,attempts=6,fetchImpl=globalThis.fetch,sleepImpl=delay=>new Promise(resolve=>setTimeout(resolve,delay))}){
 if(!/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(String(version||''))||!Number.isSafeInteger(attempts)||attempts<1||attempts>12)throw Object.assign(new Error('TV_CHANNEL_PROBE_INPUT_INVALID'),{code:'TV_CHANNEL_PROBE_INPUT_INVALID'});let last;
 for(let attempt=1;attempt<=attempts;attempt++){try{const selected=await resolveTvChannel({fetchImpl});if(selected.version!==version)throw Object.assign(new Error('TV_CHANNEL_VERSION_MISMATCH'),{code:'TV_CHANNEL_VERSION_MISMATCH'});return {version,tag:selected.tag,attempt};}catch(error){last=error;if(attempt<attempts)await sleepImpl(5000);}}
 throw Object.assign(new Error(`TV_CHANNEL_PROBE_FAILED:${last?.code||'UNKNOWN'}`),{code:'TV_CHANNEL_PROBE_FAILED'});
}
function option(name){const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:'';}
if(require.main===module){probeChannel({version:option('--version')}).then(result=>process.stdout.write(JSON.stringify(result))).catch(error=>{process.stderr.write(String(error.code||error.message));process.exitCode=1;});}
module.exports={probeChannel};
