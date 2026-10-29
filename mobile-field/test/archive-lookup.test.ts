import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {archiveDocumentId,archiveIdentity} from '../src/domain/archive-lookup';
import {visit} from './helpers';
const digest=async(value:string)=>createHash('sha256').update(value).digest('hex');
it('derives the same immutable archive id and includes recorded extra areas in server order',async()=>{
  const v=visit();v.revision=3;v.draft.confirmedRevision=3;v.captureAreas=['entrance'];v.draft.statuses={corridor:'done'};
  const identity=archiveIdentity(v,'staff-a');expect(JSON.parse(identity)).toEqual(['staff-a','visit-a',3,['entrance','corridor']]);
  expect(await archiveDocumentId(v,'staff-a',digest)).toBe('saved_wr_'+createHash('sha256').update(identity).digest('hex').slice(0,40));
});
it('uses the legacy identity when no capture plan exists and rejects stale or foreign visits',async()=>{
  const v=visit();v.draft.confirmedRevision=1;expect(JSON.parse(archiveIdentity(v,'staff-a'))).toEqual(['staff-a','visit-a',1]);
  await expect(archiveDocumentId(v,'staff-b',digest)).rejects.toThrow('OWNER_MISMATCH');v.revision=2;
  await expect(archiveDocumentId(v,'staff-a',digest)).rejects.toThrow('REPORT_REVIEW_REQUIRED');
});
