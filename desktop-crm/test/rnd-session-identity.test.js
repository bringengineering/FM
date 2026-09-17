const test=require('node:test'),assert=require('node:assert/strict');
const {createRndRepository}=require('../src/rnd-control/repository');
test('same UID and role with changed email cannot continue a pending repository read',async()=>{
 let user={uid:'u',role:'member',email:'old@example.test'},reads=0;
 const repo=createRndRepository({auth:()=>({user}),token:async()=>{user={...user,email:'new@example.test'};return 'test';},databaseUrl:'https://test.invalid',fetch:async()=>{reads++;}});
 await assert.rejects(()=>repo.get('projects','p'),/세션/);assert.equal(reads,0);
});
test('in-place mutation of the auth user cannot mutate captured save identity',async()=>{
 const user={uid:'u',role:'member',email:'old@example.test'};let writes=0;
 const repo=createRndRepository({auth:()=>({user}),token:async()=> 'test',databaseUrl:'https://test.invalid',fetch:async(_url,options)=>{
  if(options.method==='GET'){user.email='new@example.test';return{ok:true,headers:{get:()=> 'etag'},json:async()=>null};}
  writes++;throw Error('unexpected write');
 }});
 await assert.rejects(()=>repo.save('projects',{id:'p',revision:0}),/세션/);assert.equal(writes,0);
});
