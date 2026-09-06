const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const MutationPolicy = require("../src/mutation-policy");
const OfficeCore = require("../src/office-core");
const PayrollCore = require("../src/payroll-core");
const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const mainSource = read("main.js");
const preloadSource = read("preload.js");
const remoteSource = read("remote.js");
const officeSource = read("office.js");
const indexSource = read("index.html");
const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "../../database.rules.json"), "utf8"))
  .rules.crmCompany.officePayroll;
const slip = rules.$uid.$month;

test("급여 채널이 세 곳에 다 등록돼 있다", () => {
  assert.doesNotThrow(() => MutationPolicy.assertRegistered("crm:payroll-save"));
  assert.ok(mainSource.includes('secureCanonicalHandle("crm:payroll-save"'));
  assert.ok(preloadSource.includes('"crm:payroll-save"'));
  assert.equal(MutationPolicy.classification("crm:payroll-save"), "mutation");
});

test("마케팅 전용 계정은 급여를 만지지 못한다", () => {
  assert.throws(
    () => MutationPolicy.assertChannelAllowed("crm:payroll-save", { accessRole: "member", marketingRole: "marketing" }),
    error => error.code === "MARKETING_ONLY_FORBIDDEN",
  );
});

test("본인은 자기 명세서를 읽지만 쓰지는 못한다", () => {
  // 교부가 법정 의무라 본인이 볼 수 없으면 교부한 것이 아니다. 반대로 자기
  // 급여를 스스로 적을 수 있으면 그건 명세서가 아니다.
  assert.match(rules.$uid[".read"], /auth\.uid === \$uid \|\| /u);
  assert.ok(!/auth\.uid === \$uid/.test(slip[".write"]), "본인이 자기 명세서를 쓸 수 있으면 안 된다");
  assert.match(slip[".write"], /role'\)\.val\(\) === 'admin'/u);
  // 회사 전체 대장은 관리자만.
  assert.match(rules[".read"], /role'\)\.val\(\) === 'admin'/u);
  assert.equal(rules[".write"], false);
  // 지워지면 교부 기록이 사라진다.
  assert.match(slip[".write"], /newData\.exists\(\)/u);
});

test("규칙이 합계를 직접 검산한다", () => {
  // 앞뒤가 안 맞는 명세서는 그 자체로 분쟁거리다. 화면이 보낸 합계를
  // 서버가 그대로 믿으면 안 된다.
  const validate = slip[".validate"];
  for (const item of PayrollCore.EARNINGS) {
    assert.ok(validate.includes(`newData.child('${item.key}').val()`), item.key);
  }
  assert.match(validate, /newData\.child\('netPay'\)\.val\(\) === newData\.child\('grossPay'\)\.val\(\) - newData\.child\('totalDeduction'\)\.val\(\)/u);
  // 연장·야간·휴일에는 계산방법이 있어야 한다.
  assert.match(validate, /calcNote'\)\.val\(\) !== ''/u);
  // 교부한 뒤에는 내용이 고정된다.
  assert.match(validate, /data\.child\('status'\)\.val\(\) !== 'issued'/u);
  for (const field of PayrollCore.FROZEN) {
    assert.ok(
      validate.includes(`newData.child('${field}').val() === data.child('${field}').val()`),
      `${field} 가 규칙에서 고정되지 않았다`,
    );
  }
});

test("규칙이 모르는 칸을 막고, 쓰는 칸은 다 안다", () => {
  assert.equal(slip.$other[".validate"], false);
  // 계좌번호와 주민번호는 칸 자체가 없다.
  assert.ok(!Object.keys(slip).some(key => /account|bank|resident/i.test(key)));
  const produced = Object.keys(PayrollCore.normalizeRecord({ userId: "u", month: "2026-09" }));
  const missing = produced.filter(field => !slip[field]);
  assert.deepEqual(missing, [], `규칙에 없는 칸: ${missing.join(", ")}`);
});

test("관리자가 아니면 저장 자체를 막고, 교부한 것은 다시 안 쓴다", () => {
  const saver = remoteSource.slice(
    remoteSource.indexOf("async savePayrollSlip"),
    remoteSource.indexOf("async saveOfficeAttendance"),
  );
  assert.ok(saver.length > 0);
  assert.match(saver, /session\.role !== "admin"/u);
  assert.match(saver, /PAYROLL_FORBIDDEN/u);
  // 서버 자료를 다시 읽고 판단한다. 화면이 오래됐을 수 있다.
  assert.match(saver, /const existing = await this\.dbRequest\(location, \{ method: "GET" \}\)/u);
  assert.match(saver, /PayrollCore\.canEdit\(existing\)/u);
  assert.match(saver, /PAYROLL_ISSUED/u);
});

test("본인은 자기 급여만 읽는다", () => {
  const loader = remoteSource.slice(
    remoteSource.indexOf("async loadOfficeSnapshot"),
    remoteSource.indexOf("async loadOffice()"),
  );
  assert.match(loader, /payrollAdmin \? "officePayroll" : `officePayroll\/\$\{session\.uid\}`/u);
  assert.match(loader, /this\.dbRequest\(payrollLocation, \{ method: "GET" \}\)\.catch\(\(\) => null\)/u);
});

test("화면이 사이드바에서 열리고 payroll-core 가 먼저 실린다", () => {
  const nav = indexSource.slice(indexSource.indexOf("<nav"), indexSource.indexOf("</nav>"));
  assert.equal((nav.match(/data-view="officePayroll"/g) || []).length, 1);
  const coreAt = indexSource.indexOf('src="./payroll-core.js"');
  const officeAt = indexSource.indexOf('src="./office.js"');
  assert.ok(coreAt > 0 && coreAt < officeAt);
  assert.match(officeSource, /state\.context\.view === "officePayroll"[\s\S]*?payrollView\(\)/u);
  const view = officeSource.slice(officeSource.indexOf("function payrollView()"), officeSource.indexOf("function paySlip"));
  assert.match(view, /if \(!P\) return/u);
  // 회사 전체 인건비는 대표만 본다.
  assert.match(view, /state\.data\.payrollAdmin \? payrollAdminPanel/u);
});

test("합계는 payroll-core 한 곳에서만 낸다", () => {
  const section = officeSource.slice(
    officeSource.indexOf("function payrollView()"),
    officeSource.indexOf("async function savePayrollSlip"),
  );
  assert.ok(!/reduce\(/.test(section), "화면이 직접 합계를 내고 있다");
  assert.match(section, /P\.summarize\(/u);
  assert.match(section, /P\.lines\(/u);
});

test("서버가 주는 두 가지 모양을 다 편다", () => {
  const many = OfficeCore.flattenPayroll({ u1: { "2026-09": { userId: "u1" } } }, "me");
  assert.deepEqual(many.map(row => `${row.userId}/${row.month}`), ["u1/2026-09"]);
  const one = OfficeCore.flattenPayroll({ "2026-08": { basePay: 1 } }, "me");
  assert.deepEqual(one.map(row => `${row.userId}/${row.month}`), ["me/2026-08"]);
  assert.deepEqual(OfficeCore.flattenPayroll(null, "me"), []);
  const payload = OfficeCore.normalizeOfficePayload({ payroll: { u1: { "2026-09": { userId: "u1" } } }, payrollAdmin: true }, { uid: "me" });
  assert.equal(payload.payrollAdmin, true);
  assert.equal(payload.payroll.length, 1);
});
