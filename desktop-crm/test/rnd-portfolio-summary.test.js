const test=require('node:test'),assert=require('node:assert/strict');
test('portfolio summary weights required items and preserves unknown TRL and pending work',async()=>{
 const {createProject}=await import('../src/rnd-control/portfolio.mjs'),{summarizePortfolio}=await import('../src/rnd-control/portfolio-summary.mjs');const a=createProject('a','A'),b=createProject('b','B');
 a.items[0].status='approved';a.items[1].status='blocked';b.items.forEach(item=>item.required=false);b.research={experiments:[{status:'running'},{status:'closed'}],evidence:[{status:'review'},{status:'approved'}]};
 const s=summarizePortfolio([a,b],new Set(['b']));assert.equal(s.required,23);assert.equal(s.percent,100/23);assert.equal(s.activeExperiments,1);assert.equal(s.evidenceAwaitingReview,1);assert.equal(s.unsaved,1);assert.equal(s.rows[1].percent,null);assert.equal(s.rows[0].currentTRL,null);assert.equal(s.blocked,1);
});
test('portfolio overdue counts exclude approved, today, missing and invalid dates',async()=>{
 const {createProject}=await import('../src/rnd-control/portfolio.mjs'),{summarizePortfolio}=await import('../src/rnd-control/portfolio-summary.mjs');const p=createProject('p','dates');
 p.items[0].due='2026-09-16';p.items[1].due='2026-09-15';p.items[1].required=false;p.items[2].due='2026-09-17';p.items[3].due='2026-02-30';p.items[4].due='2026-09-01';p.items[4].status='approved';
 const s=summarizePortfolio([p],new Set(),'2026-09-17');assert.equal(s.overdue,2);assert.equal(s.overdueRequired,1);assert.equal(s.today,'2026-09-17');assert.throws(()=>summarizePortfolio([],new Set(),'invalid'),/기준일/);
});
