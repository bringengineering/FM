import test from 'node:test';import assert from 'node:assert/strict';import {equipmentCatalog,addMissingFields} from './equipment-catalog.mjs';
test('seven presets and unique shapes',()=>{assert.equal(equipmentCatalog.length,7);assert.equal(new Set(equipmentCatalog.map(c=>c.id)).size,7);});
test('preset change preserves entered field values',()=>{const text=addMissingFields('모델: 내 장비\n기존 항목: 보존',['모델','용량']);assert.equal(text,'모델: 내 장비\n기존 항목: 보존\n용량: ');});
