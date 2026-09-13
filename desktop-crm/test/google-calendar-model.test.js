const test=require('node:test');const assert=require('node:assert/strict');
const Work=require('../src/work-calendar');
const event={id:'g1',calendarId:'cal1',title:'Google 청소',start:'2026-09-10',end:'2026-09-12',allDay:true,status:'confirmed'};
test('Google all-day end is exclusive and original CRM record remains untouched',()=>{
 const store={buildings:[],serviceRecords:[{id:'crm1',scheduledDate:'2026-09-10',title:'기존 일정'}]};const before=structuredClone(store);
 const model=Work.buildModel(store,{month:'2026-09',selectedDate:'2026-09-10',externalEvents:[event,event]});
 assert.equal(model.events.filter(e=>e.source==='google').length,2);
 assert.deepEqual(model.events.filter(e=>e.source==='google').map(e=>e.scheduledDate),['2026-09-10','2026-09-11']);assert.deepEqual(store,before);
 const html=Work.render(model,{canWrite:true});assert.match(html,/Google · 읽기 전용/);assert.match(html,/data-work-calendar-edit="crm1"/);assert.doesNotMatch(html,/data-work-calendar-(?:edit|complete)="google:/);
});
test('Google timed events use Korea dates and cancelled/malformed events are excluded',()=>{
 const model=Work.buildModel({buildings:[],serviceRecords:[]},{month:'2026-09',externalEvents:[{...event,allDay:false,start:'2026-09-10T23:30:00Z',end:'2026-09-11T00:00:00Z'},{...event,id:'cancelled',status:'cancelled'},{...event,id:'bad',start:'2026-02-30'}]});
 assert.equal(model.events.length,1);assert.equal(model.events[0].scheduledDate,'2026-09-11');assert.equal(model.events[0].startTime,'08:30');
});
test('Google data is escaped and not assigned to a building by name',()=>{
 const model=Work.buildModel({buildings:[{id:'b1',name:'Google 청소'}],serviceRecords:[]},{month:'2026-09',selectedDate:'2026-09-10',externalEvents:[{...event,title:'<img src=x onerror=alert(1)>'}]});
 assert.equal(model.events[0]?.buildingId,'');assert.doesNotMatch(Work.render(model,{canWrite:true}),/<img src=x/);
 assert.equal(Work.buildModel({buildings:[{id:'b1'}],serviceRecords:[]},{month:'2026-09',buildingId:'b1',externalEvents:[event]}).events.length,0);
});
