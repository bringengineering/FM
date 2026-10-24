import test from 'node:test';
import assert from 'node:assert/strict';
import {demo,validate,connected,categories} from './model.mjs';
test('building name must contain text and fit the supported length',()=>{
 for(const name of ['', '   ', 'a'.repeat(151), null]){const d=demo();d.building.name=name;assert.throws(()=>validate(d),/건물명/);}
 const d=demo();d.building.name='등록 건물';assert.equal(validate(d),d);
});
test('verification dates may be absent but cannot be malformed',()=>{
 for(const date of ['2026-02-30','yesterday',123,false]){const d=demo();d.records[0].verifiedAt=date;assert.throws(()=>validate(d),/확인일/);}
 for(const date of [undefined,'','2024-02-29']){const d=demo();d.records[0].verifiedAt=date;assert.equal(validate(d),d);}
});
test('all ten areas and demo are valid',()=>{assert.equal(categories.length,10);assert.equal(validate(demo()).records.length,10);});
test('water connectivity does not include electrical equipment',()=>{const links=connected(demo(),'pump');assert(links.includes('riser4'));assert(!links.includes('panel'));});
test('rejects duplicate records and invalid connections',()=>{const d=demo();d.records.push(structuredClone(d.records[0]));assert.throws(()=>validate(d));const e=demo();e.records[0].links=['missing'];assert.throws(()=>validate(e));});
test('rejects positions outside building and invalid dimensions',()=>{const d=demo();d.records[0].x=999;assert.throws(()=>validate(d));const e=demo();e.building.floors=NaN;assert.throws(()=>validate(e));});
