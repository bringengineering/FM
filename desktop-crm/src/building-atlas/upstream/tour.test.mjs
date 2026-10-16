import test from 'node:test';import assert from 'node:assert/strict';import {tourSteps} from './guided-tour.mjs';import {sampleBuilding} from './sample-buildings.mjs';
test('full example generates seven relevant steps',()=>{const data=sampleBuilding(),steps=tourSteps(data);assert.equal(steps.length,7);assert.equal(steps[1].record.id,'pump');assert.equal(steps[2].system,true);assert.equal(steps[5].record.category,'lease');});
test('empty building skips unavailable equipment',()=>{assert.equal(tourSteps({records:[]}).length,1);});
