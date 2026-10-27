const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../src/app.js'),'utf8');
function extract(name){const start=source.indexOf(`  async function ${name}(`),tail=source.slice(start+2),m=/\n  (?:async )?function /u.exec(tail);assert(start>=0&&m);return source.slice(start,start+2+m.index);}
function fixture() {
  const state={driveSelected:new Map([['p1',{id:'p1'}],['p2',{id:'p2'}]]),photoSelectedIds:new Set(['old']),driveRequestGeneration:0,drivePlan:{kind:'general',buckets:[]},driveClassifications:[],photoReviewCollapsed:new Set(),draft:{id:'wr1',kind:'general',buildingName:'fixture'}};
  const context=vm.createContext({Map,Set,reportState:state,currentView:'workReports',window:{BringPhotoPairReview:{flatten:()=>[]}},preserveReportDraft(){},renderWorkReports(){},showToast(){},
    api:{planWorkReportDrivePhotos:async()=>({ok:true,plan:{kind:'general',buckets:[]}})}});
  vm.runInContext(extract('planSelectedReportDrivePhotos'),context);
  return {context,state};
}
test('only a successful photo planning operation changes the selected snapshot',async()=>{
  const {context,state}=fixture();
  await context.planSelectedReportDrivePhotos();
  assert.deepEqual([...state.photoSelectedIds].sort(),['p1','p2']);
  state.driveSelected.set('cancelled',{id:'cancelled'});
  assert.deepEqual([...state.photoSelectedIds].sort(),['p1','p2']);
  context.api.planWorkReportDrivePhotos=async()=>{throw Error('fixture failure')};
  await context.planSelectedReportDrivePhotos();
  assert.deepEqual([...state.photoSelectedIds].sort(),['p1','p2']);
});
