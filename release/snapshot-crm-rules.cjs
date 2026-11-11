"use strict";
// Read-only production snapshot. Never print credentials, rule bodies or data.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const ENDPOINT = "https://bring-fm-default-rtdb.asia-southeast1.firebasedatabase.app/.settings/rules.json";
const stable = value => JSON.stringify(value && typeof value === "object" ? Array.isArray(value) ? value.map(v => JSON.parse(stable(v))) : Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(stable(value[key]))])) : value);
const digest = value => crypto.createHash("sha256").update(stable(value)).digest("hex");
async function json(response) {
  if (!response.ok) { await response.body?.cancel(); throw Error("Snapshot request rejected"); }
  const reader = response.body.getReader(); let size = 0; const chunks=[];
  try { while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024)throw Error("Snapshot size exceeded");chunks.push(value);}return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  finally { await reader.cancel().catch(()=>{}); }
}
async function main() {
  const ref=process.env.RULES_BASE_REF;
  if(!/^[a-f0-9]{40}$/.test(ref||""))throw Error("Expected immutable baseline SHA");
  const key=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT||"{}");
  if(key.type!=="service_account"||key.project_id!=="bring-fm"||!key.client_email||!key.private_key)throw Error("Wrong service identity");
  const encode=value=>Buffer.from(JSON.stringify(value)).toString("base64url");
  const now=Math.floor(Date.now()/1000);
  const unsigned=encode({alg:"RS256",typ:"JWT"})+"."+encode({iss:key.client_email,scope:"https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email",aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+300});
  const assertion=unsigned+"."+crypto.sign("RSA-SHA256",Buffer.from(unsigned),key.private_key).toString("base64url");
  const token=await json(await fetch("https://oauth2.googleapis.com/token",{method:"POST",body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion}),redirect:"error",signal:AbortSignal.timeout(20000)}));
  if(typeof token.access_token!=="string")throw Error("Token unavailable");
  const live=await json(await fetch(ENDPOINT,{headers:{authorization:"Bearer "+token.access_token},redirect:"error",signal:AbortSignal.timeout(20000)}));
  const expected=JSON.parse(execFileSync("git",["show",ref+":database.rules.json"],{encoding:"utf8",timeout:10000,maxBuffer:2*1024*1024}));
  if(!live.rules?.crmCompany?.workReports)throw Error("Wrong database rules");
  const directory=path.join(process.env.RUNNER_TEMP||process.cwd(),"crm-rules-snapshot");
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  fs.writeFileSync(path.join(directory,"database.rules.json"),JSON.stringify(live,null,2),{mode:0o600});
  const metadata={project:"bring-fm",baseline:ref,sha256:digest(live),expectedSha256:digest(expected),matchesBaseline:digest(live)===digest(expected),createdAt:new Date().toISOString()};
  fs.writeFileSync(path.join(directory,"verification.json"),JSON.stringify(metadata,null,2),{mode:0o600});
  console.log(JSON.stringify(metadata));
  if(!metadata.matchesBaseline)throw Error("Live rules differ from the approved baseline; do not deploy");
}
if(require.main===module)main().catch(()=>{console.error("Rules snapshot could not be verified. No production changes made; sensitive details omitted.");process.exit(1);});
module.exports={stable,digest};
