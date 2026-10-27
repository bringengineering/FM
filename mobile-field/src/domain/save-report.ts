import { confirmVisit, editVisit, FieldError, type Photo, type Vault, type Visit } from './model';
import { reviewIssues } from './report';

// The employee's explicit save action records the current text and review,
// then uploads the same revision before creating its PDF. Retry uses the same
// confirmed revision and server idempotency keys.
export async function saveGroupedReport<T>(options:{
  vault:Vault; visit:Visit; photos:Photo[]; summary:string; followUp:string; notes:Record<string,string>;
  onLocalSave:()=>Promise<unknown>; sync:(visit:Visit,photos:Photo[])=>Promise<void>; archive:(visit:Visit)=>Promise<T>;
}):Promise<{ok:true;visit:Visit;receipt:T}|{ok:false;issues:string[]}>{
  const {vault,photos}=options;let current=options.visit;
  if(options.summary!==current.draft.summary||options.followUp!==current.draft.followUp||JSON.stringify(options.notes)!==JSON.stringify(current.draft.notes)){
    const next=editVisit(current,{summary:options.summary,followUp:options.followUp,notes:options.notes},new Date().toISOString());
    await vault.saveVisit(next,current.revision);current=next;await options.onLocalSave();
  }
  const issues=reviewIssues(current,photos);if(issues.length)return{ok:false,issues};
  if(!current.job.address)throw new FieldError('SITE_ADDRESS_REQUIRED');
  const included=photos.filter(p=>p.included);
  if(included.length>100)throw new FieldError('REPORT_PHOTO_LIMIT');
  if(included.reduce((sum,p)=>sum+p.bytes,0)>64*1024*1024)throw new FieldError('REPORT_PHOTO_BYTES_LIMIT');
  if(current.draft.confirmedRevision!==current.revision){const next=confirmVisit(current);await vault.saveVisit(next,current.revision);current=next;await options.onLocalSave();}
  await options.sync(current,photos);const receipt=await options.archive(current);return{ok:true,visit:current,receipt};
}
