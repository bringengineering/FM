const test=require('node:test'),assert=require('node:assert/strict');
const {createRndRepository,assertVisitProjectBinding}=require('../src/rnd-control/repository');
test('existing visit project binding cannot be reassigned or cleared through normal save',()=>{
 assert.doesNotThrow(()=>assertVisitProjectBinding(null,{projectId:'p'}));
 assert.doesNotThrow(()=>assertVisitProjectBinding({projectId:'p'},{projectId:'p'}));
 assert.throws(()=>assertVisitProjectBinding({projectId:'p'},{projectId:'q'}),/연결 프로젝트/);
 assert.throws(()=>assertVisitProjectBinding({projectId:'p'},{}),/연결 프로젝트/);
 assert.doesNotThrow(()=>assertVisitProjectBinding({}, {projectId:null}));
});
test('repository refuses visit reassignment before issuing a remote write',async()=>{
 let writes=0;
 const repo=createRndRepository({auth:()=>({user:{uid:'u',role:'member'}}),token:async()=> 'test',databaseUrl:'https://test.invalid',fetch:async(_url,options)=>{
  if(options.method==='GET')return {ok:true,headers:{get:()=> 'etag'},json:async()=>({id:'v',revision:1,projectId:'p'})};
  writes++;throw Error('unexpected write');
 }});
 await assert.rejects(()=>repo.save('visits',{id:'v',revision:1,projectId:'other'}),/연결 프로젝트/);
 assert.equal(writes,0);
});
