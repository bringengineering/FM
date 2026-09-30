const test=require('node:test'),assert=require('node:assert/strict');
test('metadata search covers 10000 rows, AND terms, type filters and stable pagination',async()=>{
 const {indexProjects,searchPage}=await import('../src/rnd-control/search.mjs');
 const index=indexProjects(Array.from({length:100},(_,n)=>({id:'p'+n,title:'연구 '+n,revision:3,items:Array.from({length:99},(_,i)=>({id:'item'+i,title:'자료 '+i,owner:i%2?'김담당':'박담당'}))})));
 assert.equal(index.length,10000);const first=searchPage(index,{query:'김담당 자료',type:'산출물'});assert.equal(first.total,4900);assert.equal(first.rows.length,50);
 const second=searchPage(index,{query:'김담당 자료',type:'산출물',page:2});assert.notDeepEqual(second.rows,first.rows);
 assert.equal(searchPage(index,{query:'없는자료'}).total,0);assert.equal(searchPage(index,{page:9999}).page,200);
 assert.equal(searchPage(index,{query:'연구 ９９',type:'프로젝트'}).total,1);
});
test('search indexes real dataset and hypothesis schema and nested experiment metadata',async()=>{
 const {indexProjects,searchPage}=await import('../src/rnd-control/search.mjs');const index=indexProjects([{id:'p',title:'P',items:[],research:{datasetSnapshots:[{id:'ds',population:'현장 건물'}],hypotheses:[{id:'h',statement:'고유 가설 문장'}],hypothesisAssessments:[{id:'ha',reason:'표본 부족'}],disclosureApprovals:[{id:'grant',reason:'권리 확인'}],experiments:[{id:'exp',plan:{hypothesis:'H3',owner:'계획담당'}}]}}]);
 assert.equal(searchPage(index,{query:'현장 건물',type:'데이터셋'}).rows[0].id,'ds');assert.equal(searchPage(index,{query:'고유 가설',type:'가설'}).rows[0].id,'h');assert.equal(searchPage(index,{query:'계획담당 H3',type:'실험'}).rows[0].id,'exp');assert.equal(searchPage(index,{type:'가설 판정'}).total,1);assert.equal(searchPage(index,{type:'공개 범위 검토'}).total,1);
});
test('experiment search includes the full required plan text but excludes unrelated secret properties',async()=>{
 const {indexProjects,searchPage}=await import('../src/rnd-control/search.mjs');const plan={question:'방문 감소 연구질문',comparison:'비교 대조군',population:'지역 건물',period:'4주',metrics:'관리원가',analysis:'쌍별 분석',success:'20퍼센트 개선',stop:'안전 중단',token:'DO_NOT_INDEX_SECRET'};
 const rows=indexProjects([{id:'p',title:'P',items:[],research:{experiments:[{id:'e',plan}]}}]);
 for(const text of Object.values(plan).slice(0,-1))assert.equal(searchPage(rows,{query:text,type:'실험'}).total,1);
 assert.equal(searchPage(rows,{query:plan.token}).total,0);
});
