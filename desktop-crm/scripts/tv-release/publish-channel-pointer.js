'use strict';
const fs=require('node:fs'),{parseTvChannelPointer}=require('../../src/tv-update-policy');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const compare=(a,b)=>{const left=a.split('.').map(Number),right=b.split('.').map(Number);for(let i=0;i<3;i++){if(left[i]!==right[i])return left[i]-right[i];}return 0;};
async function publishChannelPointer({owner='bringengineering',repo='FM',token,sourceSha,pointer,fetchImpl=globalThis.fetch}){
 const next=parseTvChannelPointer(JSON.stringify(pointer));if(!/^[a-f0-9]{40}$/i.test(String(sourceSha||''))||typeof token!=='string'||!token||typeof fetchImpl!=='function')fail('TV_CHANNEL_PUBLISH_INPUT_INVALID');
 const base=`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,headers={authorization:`Bearer ${token}`,accept:'application/vnd.github+json','content-type':'application/json','user-agent':'BRING-TV-Release'};
 const call=(url,options={})=>fetchImpl(base+url,{redirect:'error',headers,...options});
 let response=await call('/git/ref/heads/tv-update-channel');
 if(response.status===404){response=await call('/git/refs',{method:'POST',body:JSON.stringify({ref:'refs/heads/tv-update-channel',sha:sourceSha})});if(response.status!==201)fail('TV_CHANNEL_BRANCH_CREATE_FAILED');}
 else if(!response.ok)fail('TV_CHANNEL_BRANCH_READ_FAILED');
 response=await call('/contents/latest.json?ref=tv-update-channel');let existingSha='';
 if(response.ok){const current=await response.json();existingSha=String(current.sha||'');let previous;try{previous=parseTvChannelPointer(Buffer.from(String(current.content||'').replace(/\s/g,''),'base64').toString('utf8'));}catch{fail('TV_CHANNEL_EXISTING_POINTER_INVALID');}if(compare(previous.version,next.version)>=0)fail('TV_CHANNEL_VERSION_NOT_FORWARD');}
 else if(response.status!==404)fail('TV_CHANNEL_POINTER_READ_FAILED');
 const body={message:`chore: advance TV update channel to ${next.version}`,content:Buffer.from(JSON.stringify(next,null,2)+'\n').toString('base64'),branch:'tv-update-channel',...(existingSha?{sha:existingSha}:{})};
 response=await call('/contents/latest.json',{method:'PUT',body:JSON.stringify(body)});if(!response.ok)fail('TV_CHANNEL_POINTER_WRITE_FAILED');const written=await response.json();const commitSha=String(written?.commit?.sha||'');if(!/^[a-f0-9]{40}$/i.test(commitSha))fail('TV_CHANNEL_POINTER_WRITE_FAILED');return {version:next.version,tag:next.tag,commitSha};
}
function option(name){const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:'';}
if(require.main===module){let pointer;try{pointer=JSON.parse(fs.readFileSync(option('--pointer'),'utf8'));}catch{process.stderr.write('TV_CHANNEL_PUBLISH_INPUT_INVALID');process.exit(1);}publishChannelPointer({token:process.env.GITHUB_TOKEN||'',sourceSha:option('--source-sha'),pointer}).then(result=>process.stdout.write(JSON.stringify(result))).catch(error=>{process.stderr.write(String(error.code||error.message));process.exitCode=1;});}
module.exports={publishChannelPointer};
