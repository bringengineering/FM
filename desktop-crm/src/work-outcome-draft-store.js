'use strict';
const path=require('node:path'),crypto=require('node:crypto');

// Local recovery only. Identity comes from the authenticated main process,
// never from a renderer-provided owner or filesystem path.
function create({fs,directory,encode,decode}){
  let queue=Promise.resolve();
  const enqueue=fn=>{const task=queue.then(fn,fn);queue=task.catch(()=>{});return task;};
  const guard=active=>{if(typeof active!=='function'||active()!==true)throw Error('로그인이 변경되어 초안 처리를 중단했습니다.');};
  function identity(scope){
    const values=['company','uid','orderId'].map(key=>scope&&scope[key]);
    if(values.some(x=>typeof x!=='string'||!x.trim()||x.length>300))throw Error('초안 사용자와 업무를 확인해 주세요.');
    return JSON.stringify(values);
  }
  function payload(value){
    if(!value||typeof value.baseReport!=='string'||!value.draft||typeof value.draft!=='object'||Array.isArray(value.draft))throw Error('초안 형식이 올바르지 않습니다.');
    const raw=JSON.stringify({baseReport:value.baseReport,draft:value.draft});
    if(raw.length>120000||value.baseReport.length>60000||JSON.stringify(value.draft).length>60000)throw Error('초안이 너무 큽니다. 상세 자료는 링크로 연결해 주세요.');
    return JSON.parse(raw);
  }
  const target=id=>path.join(directory,crypto.createHash('sha256').update(id).digest('hex')+'.json');
  async function remove(file){try{await fs.unlink(file);}catch(e){if(e.code!=='ENOENT')throw e;}}
  return {
    async save(scope,value,active){
      const id=identity(scope),copy=payload(value);
      return enqueue(async()=>{
        guard(active);
        const record={version:1,identity:id,...copy,savedAt:new Date().toISOString()};
        const encrypted=encode(record); // Must fail closed; no plaintext fallback.
        const file=target(id),temp=file+'.tmp.'+crypto.randomUUID();
        await fs.mkdir(directory,{recursive:true});
        try{
          await fs.writeFile(temp,encrypted,{encoding:'utf8',flag:'wx',mode:0o600});
          guard(active);await fs.rename(temp,file);guard(active);
        }finally{await remove(temp);}
        return {savedAt:record.savedAt};
      });
    },
    async load(scope,active){
      const id=identity(scope);
      return enqueue(async()=>{
        guard(active);let raw;
        try{const file=target(id);if((await fs.stat(file)).size>2000000)throw Error('초안 파일 크기가 올바르지 않습니다.');raw=await fs.readFile(file,'utf8');}
        catch(e){if(e.code==='ENOENT'){guard(active);return null;}throw e;}
        guard(active);const decoded=decode(raw),record=decoded.value;
        if(!decoded.encrypted||!record||record.version!==1||record.identity!==id)throw Error('보호된 초안 형식을 확인할 수 없습니다.');
        const result={...payload(record),savedAt:record.savedAt};guard(active);return result;
      });
    },
    async clear(scope,active){
      const id=identity(scope);
      return enqueue(async()=>{guard(active);await remove(target(id));guard(active);return {ok:true};});
    },
  };
}
module.exports={create};
