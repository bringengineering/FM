const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Core = require("../src/core.js");
const appSource = fs.readFileSync(path.join(__dirname, "..", "src", "app.js"), "utf8");

test("new customers start in the first customer sales stage", () => {
  const customer = Core.createCustomer({ name: "신규 고객 QA" });
  assert.equal(customer.stage, Core.PIPELINE_STAGES[0]);
  assert.deepEqual(Core.PIPELINE_STAGES, ["신규 고객", "상담 준비", "상담 중", "상담 완료", "계약 중", "계약 확정"]);
});

test("customer drag board is rendered separately from the evidence-backed building pipeline", () => {
  assert.match(appSource, /SalesUI\.renderPipeline\(\{[\s\S]*?stages:\s*Sales\.SALES_STAGES[\s\S]*?writable:\s*canWriteCRM\(\)[\s\S]*?\}\)\s*\+\s*renderArchivedSalesProspects\(\)\s*\+\s*renderCustomerSalesBoard\(\)/);
  assert.match(appSource, /data-customer-board/);
  assert.match(appSource, /data-customer-board-stage=/);
  assert.match(appSource, /data-customer-board-card=/);
  assert.match(appSource, /Core\.PIPELINE_STAGES/);
  assert.match(appSource, /이 보드는 위의 대표자 영업판과 13단계 건물 프로세스에 영향을 주지 않습니다/);
});

test("customer stage drop updates only the customer workflow and records an audit", () => {
  assert.match(appSource, /function moveCustomerSalesStage\(customerId, nextStage\)/);
  assert.match(appSource, /customer\.stage\s*=\s*nextStage/);
  assert.match(appSource, /if \(nextStage === "계약 확정"\) beginRelationship\(customer\)/);
  assert.match(appSource, /고객 영업 단계 변경 · \$\{previousStage\} → \$\{nextStage\}/);
  assert.match(appSource, /reason:\s*"영업 관리 고객 보드 드래그 이동"/);
  assert.doesNotMatch(appSource.match(/function moveCustomerSalesStage[\s\S]*?\n  \}/)?.[0] || "", /salesProspects|salesEvents|salesActivities|salesContacts|salesUnits|salesOpportunities/);
});

test("read-only users never receive customer drag listeners", () => {
  assert.match(appSource, /function bindCustomerSalesBoard\(\)\s*\{\s*if \(!canWriteCRM\(\)\) return;/);
  assert.match(appSource, /const writable = canWriteCRM\(\)/);
  assert.match(appSource, /writable \? `draggable="true"` : `draggable="false"`/);
});

test("Korean IME search waits until text composition is complete", () => {
  assert.match(appSource, /event\.target\.matches\("\[data-customer-board-query\]"\)[\s\S]*?if \(event\.isComposing\) return;[\s\S]*?updateCustomerBoardSearch\(event\.target\)/);
  assert.match(appSource, /addEventListener\("compositionend",[\s\S]*?data-customer-board-query[\s\S]*?updateCustomerBoardSearch/);
});
