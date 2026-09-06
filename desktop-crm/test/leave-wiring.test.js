const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const MutationPolicy = require("../src/mutation-policy");
const OfficeCore = require("../src/office-core");
const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const mainSource = read("main.js");
const preloadSource = read("preload.js");
const remoteSource = read("remote.js");

const CHANNELS = ["crm:leave-request-save", "crm:leave-decide", "crm:leave-grant-save"];

test("휴가 채널이 세 곳에 다 등록돼 있다", () => {
  for (const channel of CHANNELS) {
    assert.doesNotThrow(() => MutationPolicy.assertRegistered(channel), `${channel} 미등록`);
    assert.ok(mainSource.includes(`secureCanonicalHandle("${channel}"`), `main.js 에 ${channel} 없음`);
    assert.ok(preloadSource.includes(`"${channel}"`), `preload.js 에 ${channel} 없음`);
    // 밖으로 나가는 행위라 mutation 이어야 한다.
    assert.equal(MutationPolicy.classification(channel), "mutation", channel);
  }
});

test("마케팅 전용 계정은 휴가를 만지지 못한다", () => {
  const marketingOnly = { accessRole: "member", marketingRole: "marketing" };
  for (const channel of CHANNELS) {
    assert.throws(
      () => MutationPolicy.assertChannelAllowed(channel, marketingOnly),
      error => error.code === "MARKETING_ONLY_FORBIDDEN",
      `${channel} 이 막히지 않는다`,
    );
  }
});

test("본인은 자기 신청을 승인하지 못한다", () => {
  // 이 길이 열리면 승인 절차가 없는 것과 같다.
  const saver = remoteSource.slice(
    remoteSource.indexOf("async saveLeaveRequest"),
    remoteSource.indexOf("async decideLeaveRequest"),
  );
  assert.ok(saver.length > 0);
  assert.match(saver, /record\.status !== "requested" && record\.status !== "cancelled"/u);
  assert.match(saver, /LEAVE_DECISION_FORBIDDEN/u);
  // 신청은 언제나 본인 칸에만 쓴다.
  assert.match(saver, /userId: session\.uid/u);
  assert.match(saver, /officeLeave\/\$\{session\.uid\}\//u);
});

test("승인과 발생일수 확정은 관리자만 한다", () => {
  for (const [fn, code] of [["async decideLeaveRequest", "LEAVE_DECISION_FORBIDDEN"], ["async saveLeaveGrant", "LEAVE_GRANT_FORBIDDEN"]]) {
    const body = remoteSource.slice(remoteSource.indexOf(fn), remoteSource.indexOf(fn) + 900);
    assert.match(body, /session\.role !== "admin"/u, `${fn} 에 관리자 검사 없음`);
    assert.match(body, new RegExp(code, "u"));
    // 검사가 저장보다 앞이어야 한다.
    const guard = body.indexOf('session.role !== "admin"');
    const write = body.indexOf("dbRequest");
    assert.ok(guard >= 0 && write >= 0 && guard < write, `${fn} 검사가 저장보다 뒤에 있다`);
  }
});

test("휴가를 못 읽어도 근태·메신저는 살아 있다", () => {
  // 규칙이 막혔다고 오피스 전체가 죽으면 안 된다.
  const loader = remoteSource.slice(
    remoteSource.indexOf("async loadOfficeSnapshot"),
    remoteSource.indexOf("async loadOfficeSnapshot") + 2000,
  );
  assert.match(loader, /this\.dbRequest\(leaveLocation, \{ method: "GET" \}\)\.catch\(\(\) => null\)/u);
  assert.match(loader, /this\.dbRequest\(grantLocation, \{ method: "GET" \}\)\.catch\(\(\) => null\)/u);
});

test("관리자가 아니면 자기 것만 불러온다", () => {
  const loader = remoteSource.slice(
    remoteSource.indexOf("async loadOfficeSnapshot"),
    remoteSource.indexOf("async loadOfficeSnapshot") + 1400,
  );
  assert.match(loader, /const leaveAdmin = session\.role === "admin"/u);
  assert.match(loader, /leaveAdmin \? "officeLeave" : `officeLeave\/\$\{session\.uid\}`/u);
  assert.match(loader, /leaveAdmin \? "officeLeaveGrants" : `officeLeaveGrants\/\$\{session\.uid\}`/u);
});

test("서버가 주는 두 가지 모양을 다 편다", () => {
  // 관리자는 uid 묶음으로, 본인은 신청 묶음으로 받는다.
  const asAdmin = OfficeCore.flattenLeave({ u1: { r1: { startDate: "2026-10-05", endDate: "2026-10-07" } } });
  assert.deepEqual(asAdmin.map(row => [row.userId, row.id]), [["u1", "r1"]]);

  const asSelf = OfficeCore.flattenLeave({ r1: { startDate: "2026-10-05", endDate: "2026-10-07" } }, "u9");
  assert.deepEqual(asSelf.map(row => [row.userId, row.id]), [["u9", "r1"]]);

  assert.deepEqual(OfficeCore.flattenLeave(null), []);
  assert.deepEqual(OfficeCore.flattenLeave({ r1: "문자열" }, "u9"), []);
});

test("확정도 두 모양을 다 편다", () => {
  // 확정은 uid 아래 연도별로 쌓인다. 본인은 연도 칸부터, 관리자는 uid 부터 받는다.
  assert.deepEqual(
    OfficeCore.flattenLeaveGrants({ "2026": { days: 15, confirmedBy: "대표" } }, "u9").map(row => [row.userId, row.year]),
    [["u9", "2026"]],
  );
  assert.deepEqual(
    OfficeCore.flattenLeaveGrants({ u1: { "2026": { days: 15 } }, u2: { "2026": { days: 11 } } }).map(row => row.userId).sort(),
    ["u1", "u2"],
  );
  assert.deepEqual(OfficeCore.flattenLeaveGrants(null), []);
});

test("보내기 직전에 서버 자료로 다시 본다", () => {
  // 화면이 들고 있던 자료로만 검사하면, 다른 기기에서 먼저 넣은 신청과
  // 겹치거나 잔여를 함께 넘길 수 있다. 겹침은 여러 건을 걸쳐 봐야 해서
  // 규칙만으로는 막을 수 없다.
  const saver = remoteSource.slice(
    remoteSource.indexOf("async saveLeaveRequest"),
    remoteSource.indexOf("async decideLeaveRequest"),
  );
  assert.match(saver, /LeaveCore\.validateRequest\(/u);
  assert.match(saver, /this\.dbRequest\(`officeLeave\/\$\{session\.uid\}`, \{ method: "GET" \}\)/u);
  const checkAt = saver.indexOf("LeaveCore.validateRequest(");
  const writeAt = saver.indexOf('method: "PUT"');
  assert.ok(checkAt >= 0 && writeAt >= 0 && checkAt < writeAt, "검사가 저장보다 앞이어야 한다");
});

test("확정은 연도별로 저장한다", () => {
  // uid 하나에 두면 내년 확정이 올해 것을 지운다.
  const saver = remoteSource.slice(
    remoteSource.indexOf("async saveLeaveGrant"),
    remoteSource.indexOf("async saveLeaveGrant") + 1400,
  );
  assert.match(saver, /officeLeaveGrants\/\$\{record\.userId\}\/\$\{record\.year\}/u);
});

test("확정도 uid·연도 두 층을 편다", () => {
  const asAdmin = OfficeCore.flattenLeaveGrants({ u1: { "2026": { days: 15 }, "2027": { days: 16 } } });
  assert.deepEqual(asAdmin.map(row => [row.userId, row.year, row.days]).sort(), [["u1", "2026", 15], ["u1", "2027", 16]]);
  const asSelf = OfficeCore.flattenLeaveGrants({ "2026": { days: 15 } }, "u9");
  assert.deepEqual(asSelf.map(row => [row.userId, row.year]), [["u9", "2026"]]);
  assert.deepEqual(OfficeCore.flattenLeaveGrants(null), []);
});

test("규칙이 본인의 상태 바꾸기를 막는다", () => {
  // 앱을 우회해 토큰으로 직접 써도 승인을 만들 수 없어야 한다.
  const rules = JSON.parse(require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../../database.rules.json"), "utf8"));
  const validate = rules.rules.crmCompany.officeLeave.$uid.$requestId[".validate"];
  // 새로 만들 때는 requested 만
  assert.match(validate, /!data\.exists\(\)[\s\S]*?newData\.child\('status'\)\.val\(\) === 'requested'/u);
  // 결정 항목을 본인이 못 넣는다
  assert.match(validate, /!newData\.hasChild\('decidedBy'\)/u);
  // 취소만 되고, 기간·일수는 못 바꾼다
  assert.match(validate, /newData\.child\('status'\)\.val\(\) === 'cancelled'/u);
  for (const field of ["type", "startDate", "endDate", "days"]) {
    assert.match(validate, new RegExp(`newData\\.child\\('${field}'\\)\\.val\\(\\) === data\\.child\\('${field}'\\)\\.val\\(\\)`, "u"), field);
  }
});

test("규칙이 이미 처리된 신청의 재처리를 막는다", () => {
  // 관리자 둘이 동시에 눌러도 나중 것이 앞선 결정을 덮지 않는다.
  // 경합을 코드가 아니라 권한 규칙에서 없앤다.
  const rules = JSON.parse(require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../../database.rules.json"), "utf8"));
  const validate = rules.rules.crmCompany.officeLeave.$uid.$requestId[".validate"];
  assert.match(validate, /data\.child\('status'\)\.val\(\) === 'requested' && newData\.hasChild\('decidedBy'\)/u);
  assert.match(validate, /newData\.child\('decidedBy'\)\.val\(\) !== ''/u);
});

test("확정 규칙이 연도 칸을 요구한다", () => {
  const rules = JSON.parse(require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../../database.rules.json"), "utf8"));
  const year = rules.rules.crmCompany.officeLeaveGrants.$uid.$year;
  assert.ok(year, "연도 칸이 없다");
  assert.match(year[".validate"], /\$year\.matches\(\/\^\[0-9\]\{4\}\$\/\)/u);
  assert.match(year[".validate"], /newData\.child\('year'\)\.val\(\) === \$year/u);
});
