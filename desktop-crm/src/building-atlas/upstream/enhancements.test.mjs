import test from 'node:test';
import assert from 'node:assert/strict';
import {demo,validate} from './model.mjs';
import {loadPortfolio,savePortfolio,portfolioKey} from './portfolio.mjs';
function memory(seed={}){const map=new Map(Object.entries(seed));return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};}
test('v1 migrates without deleting original',()=>{const d=demo();d.building.name='원본 건물';const s=memory({'bring-building-atlas-v1':JSON.stringify(d)});const p=loadPortfolio(s);assert.equal(p.items[0].data.building.name,'원본 건물');savePortfolio(s,p);assert(s.getItem('bring-building-atlas-v1'));assert.equal(loadPortfolio(s).version,2);});
test('multiple buildings retained',()=>{const s=memory(),p=loadPortfolio(s);p.items.push({id:'second',data:demo()});p.items[1].data.building.name='두 번째';p.activeId='second';savePortfolio(s,p);const next=loadPortfolio(s);assert.equal(next.items.length,2);assert.equal(next.activeId,'second');});
test('corrupted portfolio does not silently replace data',()=>{const s=memory({[portfolioKey]:'broken'});assert.throws(()=>loadPortfolio(s));assert.equal(s.getItem(portfolioKey),'broken');});
test('route bounds and duplicate target checks',()=>{const d=demo(),r=d.records.find(r=>r.id==='pump');r.routes=[{targetId:'tank',points:[{floor:0,x:-2,z:2}]}];validate(d);r.routes[0].points[0].x=999;assert.throws(()=>validate(d));r.routes[0].points[0].x=0;r.routes.push(structuredClone(r.routes[0]));assert.throws(()=>validate(d));});
