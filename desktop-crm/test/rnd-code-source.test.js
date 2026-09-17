const test=require('node:test'),assert=require('node:assert/strict');
test('GitHub code references distinguish fixed commits from mutable branches and reject mismatched versions',async()=>{
 const {codeSource,codeSourceLabel}=await import('../src/rnd-control/code-source.mjs');const sha='a'.repeat(40);
 const fixed=codeSource('https://github.com/bringengineering/FM/blob/'+sha+'/desktop-crm/src/main.js',sha);
 assert.equal(fixed.commitSHA,sha);assert.equal(fixed.path,'desktop-crm/src/main.js');assert.equal(fixed.repository,'bringengineering/FM');assert.equal(fixed.pinned,true);
 assert.match(codeSourceLabel(codeSource('https://github.com/bringengineering/FM/blob/main/src/main.js')),/미고정/);
 assert.throws(()=>codeSource('https://github.com/bringengineering/FM/blob/'+sha+'/x','b'.repeat(40)),/다릅니다/);
 assert.throws(()=>codeSource('https://github.com/o/r/blob/main/x?token=secret'),/검색 인자/);assert.equal(codeSource('https://example.com/x'),null);
});
test('GitHub fixed source refuses missing file paths, traversal, invalid escapes and extra commit paths',async()=>{
 const {codeSource}=await import('../src/rnd-control/code-source.mjs'),sha='a'.repeat(40);
 for(const suffix of ['/blob/'+sha,'/blob/'+sha+'/%2e%2e/main.js','/blob/'+sha+'/src%2fmain.js','/blob/'+sha+'/src/%ZZ','/commit/'+sha+'/unexpected'])assert.throws(()=>codeSource('https://github.com/bringengineering/FM'+suffix),/경로/);
 assert.equal(codeSource('https://github.com/bringengineering/FM/commit/'+sha).pinned,true);
 assert.equal(codeSource('https://github.com/bringengineering/FM/blob/'+sha+'/src/main.js#L10-L20').path,'src/main.js');
});
