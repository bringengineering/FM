const test=require('node:test'),assert=require('node:assert/strict');
const {createRndRepository}=require('../src/rnd-control/repository');
function fixture({alter=false,sessionChange=false}={}){
 let reads=0,writes=0,stored=null,user={uid:'u',role:'member'};
 const repo=createRndRepository({auth:()=>({user}),token:async()=> 'test',databaseUrl:'https://test.invalid',fetch:async(_url,options)=>{
  if(options.method==='GET'){reads++;return{ok:true,headers:{get:()=> 'etag'},json:async()=>stored};}
  writes++;stored=JSON.parse(options.body)['visits/v'];
  if(alter)stored={...stored,totalMinutes:999};
  if(sessionChange)user={uid:'other',role:'member'};
  throw Error('response lost after commit');
 }});
 return{repo,counts:()=>({reads,writes})};
}
test('lost save response is recovered only by matching operation ID and complete stored data without second write',async()=>{
 const f=fixture();const result=await f.repo.save('visits',{id:'v',revision:0,projectId:'p',totalMinutes:0,operationId:'renderer-forged'});
 assert.equal(result.revision,1);assert.notEqual(result.operationId,'renderer-forged');
 assert.deepEqual(f.counts(),{reads:2,writes:1});
});
test('matching operation ID with different stored values is not treated as completed save',async()=>{
 const f=fixture({alter:true});await assert.rejects(()=>f.repo.save('visits',{id:'v',revision:0,totalMinutes:0}),/저장 결과 확인 불가.*작업/);
 assert.deepEqual(f.counts(),{reads:2,writes:1});
});
test('session change after response loss stops recovery reads',async()=>{
 const f=fixture({sessionChange:true});await assert.rejects(()=>f.repo.save('visits',{id:'v',revision:0}),/세션/);
 assert.deepEqual(f.counts(),{reads:1,writes:1});
});
test('project save recovery tolerates Firebase omitted empty arrays while verifying the complete project',async()=>{
 let stored=null,writes=0;
 const repo=createRndRepository({auth:()=>({user:{uid:'u',role:'member'}}),token:async()=> 'test',databaseUrl:'https://test.invalid',fetch:async(_url,options)=>{
  if(options.method==='GET')return{ok:true,headers:{get:()=> 'etag'},json:async()=>stored};
  writes++;stored=Object.fromEntries(Object.entries(JSON.parse(options.body)).map(([path,value])=>[path.split('/').at(-1),value]));throw Error('lost response');
 }});
 const saved=await repo.save('projects',{id:'p',title:'Research',revision:0,history:[],assessments:[],research:{experiments:[]}});
 assert.equal(saved.revision,1);assert.equal(writes,1);
});
