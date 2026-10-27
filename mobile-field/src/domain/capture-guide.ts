import { FieldError, type Phase, type Photo, type Visit } from './model';
import { catalog } from './report';

// Keep the chosen order stable. Existing photos are always retained in the
// guide when a visit created by an older app version is first opened.
export function initialCaptureAreas(visit:Visit, photos:Photo[]):string[]{
  const items=catalog(visit.job.kind),valid=new Set(items.map(item=>item.key));
  const defaults=visit.captureAreas?.length?visit.captureAreas:items.filter(item=>!item.optional).map(item=>item.key);
  const wanted=new Set([...defaults,...photos.filter(p=>p.visitId===visit.id).map(p=>p.itemKey)].filter(key=>valid.has(key)));
  return items.filter(item=>wanted.has(item.key)).map(item=>item.key);
}
export function areaPhotoCount(photos:Photo[],area:string,phase:Phase):number{
  return photos.filter(p=>p.itemKey===area&&p.phase===phase).length;
}
export function captureProgress(areas:string[],photos:Photo[],phase:Phase){
  return {done:areas.filter(area=>areaPhotoCount(photos,area,phase)>0).length,total:areas.length};
}
export function firstUncapturedArea(areas:string[],photos:Photo[],phase:Phase):string{
  return areas.find(area=>areaPhotoCount(photos,area,phase)===0)??areas[0]??'';
}
export function nextUncapturedArea(areas:string[],photos:Photo[],phase:Phase,current:string):string{
  const index=areas.indexOf(current);return index<0?'':areas.slice(index+1).find(area=>areaPhotoCount(photos,area,phase)===0)??'';
}
export function changeCaptureAreas(visit:Visit,photos:Photo[],areas:string[],now:string):Visit{
  const valid=new Set(catalog(visit.job.kind).map(item=>item.key));
  if(!areas.length||new Set(areas).size!==areas.length||areas.some(area=>!valid.has(area))||photos.some(p=>p.visitId===visit.id&&!areas.includes(p.itemKey)))throw new FieldError('CAPTURE_AREAS_INVALID');
  return {...visit,captureAreas:[...areas],revision:visit.revision+1,updatedAt:now,draft:{...visit.draft,confirmedRevision:undefined}};
}
