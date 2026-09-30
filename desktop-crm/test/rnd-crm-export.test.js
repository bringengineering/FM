const test=require('node:test'),assert=require('node:assert/strict');
const {createCrmContextSnapshot}=require('../src/rnd-control/crm-context');
const {createCrmContextService}=require('../src/rnd-control/crm-context-service');
async function project(){
 const {createProject}=await import('../src/rnd-control/portfolio.mjs'),p={...createProject('p','Pilot'),revision:1};
 const now='2026-09-17T00:00:00Z';
 return createCrmContextService({access:async()=>({uid:'u',role:'member'}),getProject:async()=>p,getContext:async()=>createCrmContextSnapshot({customers:[{id:'c',name:'Internal Customer'}],buildings:[],updatedAt:now},{fetchedAt:now}),saveProject:async value=>({...value,revision:2}),uuid:()=> 'ctx',clock:()=>now}).freeze({projectId:'p',expectedRevision:1,customerIds:['c'],buildingIds:[],reason:'Internal pilot group'});
}
test('internal Markdown export carries fixed CRM context provenance and relationships',async()=>{
 const {buildRndExport}=await import('../src/rnd-control/export.mjs'),p=await project(),result=buildRndExport(p);
 assert.match(result.files['crm-contexts/ctx.md'],/Internal pilot group/);assert.match(result.files['crm-contexts/ctx.md'],/Internal Customer/);
 assert.equal(result.manifest.includedCrmContexts[0],'ctx');assert.match(result.files['projects/p.md'],/\.\.\/crm-contexts\/ctx.md/);
});
test('review exports exclude all CRM context until a dedicated disclosure workflow exists',async()=>{
 const {buildRndExport}=await import('../src/rnd-control/export.mjs'),result=buildRndExport(await project(),{mode:'review'});
 assert.deepEqual(result.manifest.includedCrmContexts,[]);assert.equal(Object.keys(result.files).some(path=>path.startsWith('crm-contexts/')),false);
 assert.equal(JSON.stringify(result.files).includes('Internal Customer'),false);assert.ok(result.manifest.excluded.some(record=>record.id==='ctx'&&record.reason==='CRM_DISCLOSURE_UNCONFIRMED'));
});
test('internal export refuses altered frozen CRM content instead of presenting it as a retained source',async()=>{
 const {buildRndExport}=await import('../src/rnd-control/export.mjs'),p=await project();p.crmContexts.ctx.snapshotJSON=p.crmContexts.ctx.snapshotJSON.replace('Internal Customer','Changed');assert.throws(()=>buildRndExport(p),/검증/);
});
