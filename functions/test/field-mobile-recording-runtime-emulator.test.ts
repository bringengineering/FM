import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { createRecordingStore } from '../src/field-mobile/recording-runtime.js';

const host=process.env.FIREBASE_DATABASE_EMULATOR_HOST||'';
const project='demo-field-transaction';
describe.runIf(Boolean(host))('field recording store with RTDB emulator',()=>{
  const apps:App[]=[];
  function client(name:string){
    const url=new URL(`http://${host}`);
    if(!['127.0.0.1','localhost'].includes(url.hostname)||!url.port)throw Error('Loopback emulator required');
    const app=initializeApp({projectId:project,databaseURL:`http://${host}?ns=${project}`},name);
    apps.push(app);return getDatabase(app);
  }
  let seed:ReturnType<typeof getDatabase>;
  beforeAll(()=>{seed=client('seed');});
  afterAll(async()=>{await Promise.all(apps.map(deleteApp));});
  it('updates an existing record from a fresh connection and preserves atomic concurrent changes',async()=>{
    const path='test/record';await seed.ref(path).set({json:JSON.stringify({count:0})});
    const a=createRecordingStore(client('a')),b=createRecordingStore(client('b'));
    const increment=(old:{count:number}|null)=>{if(!old)throw Error('missing');return{count:old.count+1};};
    await Promise.all([a.change(path,increment),b.change(path,increment)]);
    expect(await a.get(path)).toEqual({count:2});
  },15000);
  it('does not overwrite an existing CRM report from a fresh connection',async()=>{
    const path='crmCompany/workReports/example';await seed.ref(path).set({id:'example',summary:'original'});
    const store=createRecordingStore(client('c'));
    await expect(store.commit({id:'example',summary:'changed'},{id:'doc'})).rejects.toThrow('CRM_RECORD_CHANGED');
    expect((await seed.ref(path).get()).val()).toEqual({id:'example',summary:'original'});
    expect((await seed.ref('crmCompany/data/buildingDocuments/doc').get()).exists()).toBe(false);
  },15000);
});
