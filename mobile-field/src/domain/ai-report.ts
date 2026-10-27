import { catalog } from './report';
import { FieldError, type Photo, type Visit } from './model';

// Only fixed catalog labels and counts leave the device. No image bytes, captions,
// customer/address, timestamps, or employee-provided text are sent to the AI.
export function reportFacts(visit: Visit, photos: Photo[]): {kind:'common'|'moveIn';areas:{key:string;before:number;during:number;after:number}[]} {
  const selected=photos.filter(p=>p.visitId===visit.id&&p.ownerUid===visit.ownerUid&&p.included);
  if(!selected.length)throw new FieldError('AI_PHOTOS_REQUIRED');
  const lines=catalog(visit.job.kind).flatMap(item=>{
    const counts=(['before','during','after'] as const).map(phase=>selected.filter(p=>p.itemKey===item.key&&p.phase===phase).length);
    return counts.some(Boolean)?[{key:item.key,before:counts[0]!,during:counts[1]!,after:counts[2]!}]:[];
  });
  if(!lines.length)throw new FieldError('AI_PHOTOS_REQUIRED');
  return {kind:visit.job.kind,areas:lines};
}
export function aiDraftState(visit:Visit,photos:Photo[]):'missing'|'current'|'stale'|'edited'|'edited_stale'{
  if(!visit.aiDraft)return 'missing';
  let sameFacts=false;try{sameFacts=JSON.stringify(reportFacts(visit,photos))===visit.aiDraft.facts;}catch{/* no included photos */}
  if(visit.draft.summary!==visit.aiDraft.summary)return sameFacts?'edited':'edited_stale';
  return sameFacts?'current':'stale';
}
