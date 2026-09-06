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
  assert.deepEqual(
    OfficeCore.flattenLeaveGrants({ days: 15, confirmedBy: "대표" }, "u9").map(row => row.userId),
    ["u9"],
  );
  assert.deepEqual(
    OfficeCore.flattenLeaveGrants({ u1: { days: 15 }, u2: { days: 11 } }).map(row => row.userId).sort(),
    ["u1", "u2"],
  );
  assert.deepEqual(OfficeCore.flattenLeaveGrants(null), []);
});
