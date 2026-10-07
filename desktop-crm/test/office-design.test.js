const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const officeSource = read("office.js");
const officeCss = read("office.css");
const appSource = read("app.js");
const indexSource = read("index.html");

const viewBody = (from, to) => officeSource.slice(officeSource.indexOf(from), officeSource.indexOf(to));

test("인사·결재·급여가 근태관리와 같은 뼈대를 쓴다", () => {
  // 화면마다 제 나름의 껍데기를 쓰면 같은 프로그램으로 안 보인다.
  const views = [
    ["function membersView()", "function myRecordView("],
    ["function approvalsView()", "function approvalRow("],
    ["function payrollView()", "function paySlip("],
  ];
  for (const [from, to] of views) {
    const body = viewBody(from, to);
    assert.ok(body.length > 0, `${from} 를 찾지 못했다`);
    assert.match(body, /officeHero\(/u, from);
    assert.match(body, /class="office-admin-kpis"/u, from);
    assert.match(body, /class="office-panel/u, from);
  }
});

test("세 화면이 제 나름의 껍데기를 만들지 않는다", () => {
  // 옛 클래스가 남아 있으면 스타일시트에서 지워진 뒤에도 화면이 조용히 깨진다.
  for (const dead of ["office-pay-head", "office-hr-head", "office-approval-head", "office-hr-body", "office-pay-admin", "office-approval-admin"]) {
    assert.ok(!officeSource.includes(dead), `office.js 에 옛 클래스 ${dead} 가 남아 있다`);
    assert.ok(!officeCss.includes(`.${dead}`), `office.css 에 옛 클래스 ${dead} 가 남아 있다`);
  }
});

test("새로 쓴 클래스가 스타일시트에 다 있다", () => {
  // 없는 클래스에 기대면 화면이 맨몸으로 나온다.
  const used = new Set([...officeSource.matchAll(/class="((?:office|mini)[a-z0-9 -]*)"/g)]
    .flatMap(match => match[1].split(/\s+/))
    .filter(name => name.startsWith("office-")));
  // 스타일시트 전체를 본다. office.css 만 보면 다른 파일에 있는 것을
  // 없다고 잡는다.
  const allCss = fs.readdirSync(path.join(__dirname, "../src"))
    .filter(file => file.endsWith(".css")).map(read).join("\n");
  const styled = new Set([...allCss.matchAll(/\.(office-[a-z0-9-]+)/g)].map(match => match[1]));
  const missing = [...used].filter(name => !styled.has(name));
  assert.deepEqual(missing, [], `스타일이 없는 클래스: ${missing.join(", ")}`);
});

test("날짜 칸은 그 해 둘레로 열린다", () => {
  // 빈 칸으로 열리면 사람은 연도부터 네 자리를 친다.
  assert.match(officeSource, /function dateBounds\(centerYear\)/u);
  const helper = officeSource.slice(officeSource.indexOf("function dateBounds(centerYear)"), officeSource.indexOf("function officeHero"));
  assert.match(helper, /min="\$\{year - 1\}-01-01" max="\$\{year \+ 1\}-12-31"/u);
  // 계약 종료일과 입사 예정일이 해를 넘나든다. 그 해만 열면 못 적는다.
  assert.ok(helper.includes("year - 1") && helper.includes("year + 1"));
  // 실제로 날짜 칸에 붙여 쓴다.
  assert.ok((officeSource.match(/dateBounds\(/g) || []).length >= 4, "날짜 칸에 안 붙였다");
});

test("매입·지급은 CRM 에서 빠졌다", () => {
  // 대표 전용 재무는 개인 OS 쪽에서 다룬다.
  for (const source of [appSource, indexSource, read("remote.js"), read("main.js"), read("preload.js")]) {
    assert.ok(!/purchases|officePurchases|purchase-core/.test(source), "매입 흔적이 남아 있다");
  }
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "../../database.rules.json"), "utf8")).rules.crmCompany;
  assert.ok(!rules.officePurchases, "규칙에 매입 노드가 남아 있다");
  // 결재의 "구매·발주" 종류는 매입과 다른 것이라 그대로 둔다.
  assert.match(rules.officeApprovals.$uid.$requestId.kind[".validate"], /'purchase'/u);
});
