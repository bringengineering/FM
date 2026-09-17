const crypto=require('node:crypto');
const key=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(x);
function state(value){if(value==null)return null;return Object.fromEntries(['enabled','email','role','approvedBy','approvedAt','reason','auditId'].filter(k=>value[k]!==undefined).map(k=>[k,value[k]]));}
function createAccessAudit({id,uid,before,after,expectedETag,actor}){if(!key(id)||!key(uid)||actor?.role!=='admin'||!actor.uid||after?.approvedBy!==actor.uid||typeof after.enabled!=='boolean'||!after.reason?.trim()||typeof expectedETag!=='string'||!expectedETag)throw Error('Trusted administrator, target, reason and source version required');const payload={id,targetUid:uid,kind:'approval-attempt',committed:false,before:state(before),after:state(after),expectedETag,actorUid:actor.uid,at:new Date().toISOString()};return{...payload,eventHash:crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')};}
module.exports={createAccessAudit};
