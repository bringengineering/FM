const invalid=()=>{throw Object.assign(new Error('INVALID_INPUT'),{code:'INVALID_INPUT'});};
const shape=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))invalid();};
const count=n=>{if(!Number.isSafeInteger(n)||n<0||n>1000000)invalid();};
const text=(s,max)=>{if(typeof s!=='string'||s.length>max||/[\u0000-\u0008\u000b-\u001f]/.test(s))invalid();};
export function validatePublication(input){
 shape(input,['model','playlist','notice','dataDate']);text(input.notice,160);
 if(typeof input.dataDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input.dataDate)||!Number.isFinite(Date.parse(input.dataDate))||new Date(input.dataDate).toISOString().slice(0,10)!==input.dataDate)invalid();
 const m=input.model;shape(m,['counts','total','overdue','unknown','people','schedule']);
 const states=['assigned','doing','submitted','returned','done'];shape(m.counts,states);states.forEach(s=>count(m.counts[s]));['total','overdue','unknown'].forEach(k=>count(m[k]));
 if(states.reduce((sum,k)=>sum+m.counts[k],0)!==m.total||m.overdue>m.total-m.counts.done)invalid();
 if(!Array.isArray(m.people)||m.people.length>100)invalid();
 for(const p of m.people){shape(p,['name','total','done','overdue']);text(p.name,40);['total','done','overdue'].forEach(k=>count(p[k]));if(p.done+p.overdue>p.total)invalid();}
 if(m.people.reduce((n,p)=>n+p.total,0)!==m.total||m.people.reduce((n,p)=>n+p.done,0)!==m.counts.done||m.people.reduce((n,p)=>n+p.overdue,0)!==m.overdue)invalid();
 shape(m.schedule,['available','entries']);if(typeof m.schedule.available!=='boolean'||!Array.isArray(m.schedule.entries)||m.schedule.entries.length>200||(!m.schedule.available&&m.schedule.entries.length))invalid();
 for(const e of m.schedule.entries){shape(e,['time','status']);if(!['예정','진행 중','완료','상태 확인 필요'].includes(e.status)||!(e.time==='시간 미정'||typeof e.time==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(e.time)))invalid();}
 if(!Array.isArray(input.playlist)||input.playlist.length>5)invalid();const seen=new Set();
 for(const p of input.playlist){shape(p,['key','enabled','seconds']);if(!['people','status','issues','notice','schedule'].includes(p.key)||seen.has(p.key)||typeof p.enabled!=='boolean'||!Number.isInteger(p.seconds)||p.seconds<10||p.seconds>120)invalid();seen.add(p.key);}
 return structuredClone(input);
}
