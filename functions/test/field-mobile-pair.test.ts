import {expect,it} from 'vitest';
import {capturedPairIds,photoBinding,photoInput,type RecordingPhoto} from '../src/field-mobile/recording-model.js';

const photo=(id:string,phase:RecordingPhoto['phase'],capturedAt:string,extra:Partial<RecordingPhoto>={}):RecordingPhoto=>({id,itemKey:'entrance',phase,caption:'',included:true,capturedAt,mime:'image/jpeg',bytes:10,sha256:'a'.repeat(64),width:10,height:10,...extra});

it('accepts an optional pair only on after photos and keeps it out of the upload binding',()=>{
  expect(photoInput(photo('a1','after','2026-10-26T01:00:00Z',{pairWith:'b1'}),'common').pairWith).toBe('b1');
  expect(photoInput(photo('a1','after','2026-10-26T01:00:00Z'),'common')).not.toHaveProperty('pairWith');
  for(const bad of [photo('b1','before','2026-10-26T00:00:00Z',{pairWith:'b2'}),photo('a1','after','2026-10-26T01:00:00Z',{pairWith:'a1'}),photo('a1','after','2026-10-26T01:00:00Z',{pairWith:'../x'})])
    expect(()=>photoInput(bad,'common')).toThrow('REQUEST_INVALID');
  const a=photo('a1','after','2026-10-26T01:00:00Z');
  expect(photoBinding({...a,pairWith:'b1'})).toBe(photoBinding(a));
});

it('pairs each before photo once with the earliest included after photo of the same area',()=>{
  const ids=capturedPairIds([
    photo('b1','before','2026-10-26T00:00:00Z'),photo('b2','before','2026-10-26T00:01:00Z'),photo('b3','before','2026-10-26T00:02:00Z',{included:false}),
    photo('b4','before','2026-10-26T00:03:00Z',{itemKey:'corridor'}),
    photo('a2','after','2026-10-26T01:01:00Z',{pairWith:'b1'}),photo('a1','after','2026-10-26T01:00:00Z',{pairWith:'b1'}),
    photo('a3','after','2026-10-26T01:02:00Z',{pairWith:'b3'}),photo('a4','after','2026-10-26T01:03:00Z',{pairWith:'b4'}),
    photo('a5','after','2026-10-26T01:04:00Z',{pairWith:'b2',included:false}),photo('a6','after','2026-10-26T01:05:00Z',{pairWith:'missing'}),
  ]);
  expect(Object.fromEntries(ids)).toEqual({b1:'field:b1|a1',a1:'field:b1|a1'});
  expect(ids.get('b1')).toMatch(/^[A-Za-z0-9_:|.-]{1,250}$/);
});
