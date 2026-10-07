import test from 'node:test';
import assert from 'node:assert/strict';
import {collectBuildingBasics,transferPayload,readTransfer,addTransferredBuilding} from './crm-transfer.mjs';
import {demo} from './model.mjs';
test('collection allowlists names/addresses, removes duplicates and archived cases',()=>{
 const list=collectBuildingBasics({paymentBuildings:{a:{name:' A ',address:'주소',ownerName:'PRIVATE'}}},{b:{building:'A',address:'주소',phone:'SECRET'},c:{building:'B',archived:true},d:{building:'C',deleted:true},e:{building:'D',address:'주소2',memo:'PRIVATE'}});
 assert.deepEqual(list,[{name:'A',address:'주소'},{name:'D',address:'주소2'}]);
 const payload=transferPayload({...list[0],phone:'SECRET',amount:50000});
 assert.deepEqual(payload,{kind:'bring-building-basics',version:1,building:{name:'A',address:'주소'}});
 assert(!JSON.stringify(payload).includes('SECRET'));
});
test('transfer rejects invalid schema, excess fields and blank names',()=>{
 for(const input of [{},{kind:'other',version:1,building:{name:'A',address:''}},{kind:'bring-building-basics',version:1,building:{name:' ',address:''}},{kind:'bring-building-basics',version:1,building:{name:'A',address:'',phone:'SECRET'}}])assert.throws(()=>readTransfer(input));
 assert.deepEqual(collectBuildingBasics({},{}),[]);
 assert.equal(readTransfer(transferPayload({name:'A',address:''})).name,'A');
});
test('import adds an empty unmeasured building; repeat selects it without overwriting',()=>{
 const original={version:2,activeId:'old',items:[{id:'old',data:demo()}]};
 const before=structuredClone(original),payload=transferPayload({name:'새 건물',address:'주소'});
 const p=addTransferredBuilding(original,payload,()=> 'new');
 assert.deepEqual(original,before);assert.equal(p.items.length,2);assert.equal(p.activeId,'new');
 assert.deepEqual(p.items[1].data.records,[]);assert.equal(p.items[1].data.building.geometryStatus,'미확인');
 p.items[1].data.building.floors=3;
 const again=addTransferredBuilding(p,payload,()=> 'not-used');
 assert.equal(again.items.length,2);assert.equal(again.items[1].data.building.floors,3);
});
