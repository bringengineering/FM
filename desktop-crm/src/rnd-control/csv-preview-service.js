const Core=require('../core');
const allowed=['bytes','mapping','projectId','source','units','delimiter'];
function actor(user){Core.assertMutationAllowed(user);if(!user.email)throw Error('승인된 CRM 계정이 필요합니다');return {...user};}
function createCSVPreviewService({access,list,captureSession,isCurrent}){return async input=>{
 if(!input||typeof input!=='object'||Object.keys(input).some(key=>!allowed.includes(key)))throw Error('CSV 검토 입력 항목 오류');
 if(!(input.bytes instanceof Uint8Array)&&!(input.bytes instanceof ArrayBuffer))throw Error('CSV 원본 바이트가 필요합니다');if(!input.bytes.byteLength||input.bytes.byteLength>8*1024*1024)throw Error('CSV 파일은 8MiB 이하로 선택하세요');
 const owned=structuredClone({...input,bytes:undefined});owned.bytes=input.bytes instanceof ArrayBuffer?new Uint8Array(input.bytes.slice(0)):new Uint8Array(input.bytes);const binding=captureSession();const initial=actor(await access());
 const unchanged=async()=>{if(!isCurrent(binding))throw Error('로그인 세션이 변경되었습니다');const current=actor(await access());if(!isCurrent(binding)||current.uid!==initial.uid||current.email!==initial.email||current.role!==initial.role)throw Error('로그인 세션이 변경되었습니다');};
 await unchanged();const {readCSV,previewBaselineCSV}=await import('./csv-import.mjs');
 const {bytes,...options}=owned;Core.assertNoProhibitedSecrets(options);const parsed=await readCSV(bytes,{delimiter:owned.delimiter??','});
 // Inspect every column, including columns excluded by the user's mapping.
 for(const row of parsed.rows)Core.assertNoProhibitedSecrets(Object.fromEntries(parsed.headers.map((key,index)=>[key,row.fields[index]])));
 await unchanged();const [projects,visits]=await Promise.all([list('projects'),list('visits')]);await unchanged();
 if(!Array.isArray(projects)||!Array.isArray(visits)||projects.some(project=>!project?.id)||new Set(projects.map(project=>project.id)).size!==projects.length||new Set(visits.map(visit=>visit?.id)).size!==visits.length)throw Error('CSV 공유 목록 오류');
 const result=await previewBaselineCSV({...owned,current:visits,projectIds:projects.map(project=>project.id)});await unchanged();
 return {...result,actorUid:initial.uid,sharedReadScope:'Separate read-only shared collection snapshots; recheck before local application'};
};}
module.exports={createCSVPreviewService};
