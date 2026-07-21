"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "complaint-intake-to-firebase.gs"), "utf8");

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Function not found: ${name}`);
  const braceStart = source.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = braceStart; index < source.length; index += 1) {
    const current = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === quote) quote = "";
      continue;
    }
    if (current === "\"" || current === "'" || current === "`") { quote = current; continue; }
    if (current === "{") depth += 1;
    if (current === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unclosed function: ${name}`);
}

const context = { String, RegExp };
vm.createContext(context);
vm.runInContext([
  extractFunction("extractOnboardingField_"),
  extractFunction("extractOnboardingOwnerName_")
].join("\n"), context);

const labels = ["건물명", "건물"];
assert.equal(
  context.extractOnboardingField_("건물명과 주소를 응답 시트의 계약 건물 인덱스에 동일하게 입력하면 자동 매칭됩니다.", labels),
  "",
  "안내 문장의 '건물명'은 실제 항목값으로 인식하지 않는다"
);
assert.equal(context.extractOnboardingField_("건물명: 햇빛빌라\n주소: 원주시 중앙동", labels), "햇빛빌라");
assert.equal(context.extractOnboardingField_("건물명 햇빛빌라\n주소 원주시 중앙동", labels), "햇빛빌라");

const flattened = "건물명 + 주소로 계약 건물을 확인하기 위한 간단 기록용 건물명 상지대 창업보육센터 주소 강원 원주시 상지대길 83 상지대학교 건물주명 김현진 연락처 010-1234-5678";
assert.equal(context.extractOnboardingField_(flattened, labels), "상지대 창업보육센터", "안내문 다음의 실제 건물명을 선택한다");
assert.equal(context.extractOnboardingField_(flattened, ["건물 주소", "주소", "소재지"]), "강원 원주시 상지대길 83 상지대학교", "주소 뒤의 건물주명은 포함하지 않는다");
assert.equal(context.extractOnboardingOwnerName_(flattened), "김현진", "온보딩 문서의 건물주명을 추출한다");

console.log("onboarding field tests passed");
