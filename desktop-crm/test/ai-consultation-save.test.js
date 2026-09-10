const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");

test("review save blocks ambiguous customer creation and uses confirmed shared save", () => {
  assert.match(source, /function saveAiConsultationReview/);
  assert.match(source, /AiConsultationCore\.findCustomerCandidates/);
  assert.match(source, /기존 고객 후보를 선택/);
  assert.match(source, /const beforeStore = cloneStore\(store\)/);
  assert.match(source, /await commitSharedFormMutation/);
  assert.match(source, /AI 상담 내용을 서버에 저장했습니다/);
});

test("review save creates linked customer building consultation and follow-up records", () => {
  assert.match(source, /Core\.createCustomer/);
  assert.match(source, /Core\.createBuilding/);
  assert.match(source, /Core\.createActivity/);
  assert.match(source, /Core\.createTask/);
  assert.match(source, /buildingIdLinks/);
  assert.match(source, /privateMemo/);
});
