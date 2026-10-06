const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { digest } = require('../../release/snapshot-crm-rules.cjs');
test('규칙 백업 비교는 키 순서만 무시하고 권한 차이는 그대로 감지한다',()=>{
  assert.equal(digest({rules:{a:1,b:2}}),digest({rules:{b:2,a:1}}));
  assert.notEqual(digest({rules:{'.read':false}}),digest({rules:{'.read':true}}));
});
test('백업 전용 실행은 운영 규칙을 배포하지 않고 아티팩트로 남긴다',()=>{
  const workflow=fs.readFileSync(require('node:path').join(__dirname,'../../.github/workflows/crm-rules-deploy.yml'),'utf8');
  assert.match(workflow,/name: Deploy database rules\r?\n\s+if: inputs.snapshot_only != true/);
  assert.match(workflow,/name: Back up live rules without deploying\r?\n\s+if: inputs.snapshot_only == true/);
  assert.match(workflow,/crm-rules-before-/);
});
