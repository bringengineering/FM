const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const MutationPolicy = require("../src/mutation-policy");
const OfficeCore = require("../src/office-core");
const ApprovalCore = require("../src/approval-core");
const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const mainSource = read("main.js");
const preloadSource = read("preload.js");
const remoteSource = read("remote.js");
const officeSource = read("office.js");
const indexSource = read("index.html");
const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "../../database.rules.json"), "utf8"))
  .rules.crmCompany.officeApprovals;
const item = rules.$uid.$requestId;

const CHANNELS = ["crm:approval-save", "crm:approval-decide"];

test("결재 채널이 세 곳에 다 등록돼 있다", () => {
  for (const channel of CHANNELS) {
    assert.doesNotThrow(() => MutationPolicy.assertRegistered(channel), channel);
    assert.ok(mainSource.includes(`secureCanonicalHandle("${channel}"`), channel);
    assert.ok(preloadSource.includes(`"${channel}"`), channel);
    assert.equal(MutationPolicy.classification(channel), "mutation", channel);
  }
});

test("마케팅 전용 계정은 결재를 만지지 못한다", () => {
  for (const channel of CHANNELS) {
    assert.throws(
      () => MutationPolicy.assertChannelAllowed(channel, { accessRole: "member", marketingRole: "marketing" }),
      error => error.code === "MARKETING_ONLY_FORBIDDEN",
      channel,
    );
  }
});

test("상신 길로는 승인할 수 없다", () => {
  // 이 길이 열리면 결재 절차가 없는 것과 같다.
  const saver = remoteSource.slice(
    remoteSource.indexOf("async saveApprovalRequest"),
    remoteSource.indexOf("async decideApprovalRequest"),
  );
  assert.ok(saver.length > 0);
  assert.match(saver, /record\.status !== "requested" && record\.status !== "cancelled"/u);
  assert.match(saver, /APPROVAL_DECISION_FORBIDDEN/u);
  // 언제나 본인 칸에만 쓴다.
  assert.match(saver, /officeApprovals\/\$\{session\.uid\}\/\$\{record\.id\}/u);
  // 이미 정해진 건은 못 고치고, 취소하면서 내용을 바꿀 수도 없다.
  assert.match(saver, /APPROVAL_ALREADY_DECIDED/u);
  assert.match(saver, /ApprovalCore\.sameContent/u);
});

test("승인·반려는 서버 자료를 다시 읽고 판단한다", () => {
  // 화면이 오래됐을 수 있고, 두 사람이 동시에 눌렀을 수도 있다.
  const decider = remoteSource.slice(
    remoteSource.indexOf("async decideApprovalRequest"),
    remoteSource.indexOf("async saveOfficeAttendance"),
  );
  assert.ok(decider.length > 0);
  assert.match(decider, /session\.role !== "admin"/u);
  assert.match(decider, /const existing = await this\.dbRequest\(location, \{ method: "GET" \}\)/u);
  assert.match(decider, /ApprovalCore\.decide\(\{\s*request: existing/u);
});

test("본인은 자기 결재만 읽는다", () => {
  const loader = remoteSource.slice(
    remoteSource.indexOf("async loadOfficeSnapshot"),
    remoteSource.indexOf("async loadOffice()"),
  );
  assert.match(loader, /approvalAdmin \? "officeApprovals" : `officeApprovals\/\$\{session\.uid\}`/u);
  assert.match(loader, /this\.dbRequest\(approvalLocation, \{ method: "GET" \}\)\.catch\(\(\) => null\)/u);
});

test("규칙이 남의 결재를 막고 삭제도 막는다", () => {
  assert.match(rules[".read"], /role'\)\.val\(\) === 'admin'/u);
  assert.equal(rules[".write"], false);
  assert.match(rules.$uid[".read"], /auth\.uid === \$uid \|\| /u);
  // 지워지면 결재 기록이 아무 의미가 없다.
  assert.match(item[".write"], /newData\.exists\(\)/u);
});

test("규칙이 정해진 결재를 못 고치게 한다", () => {
  // 승인받은 지출의 금액이 나중에 바뀔 수 있으면 결재 기록이 무의미하다.
  assert.match(item[".validate"], /!data\.exists\(\) \|\| data\.child\('status'\)\.val\(\) === 'requested'/u);
  // 상신은 언제나 대기로만, 결정 자리는 비어 있어야 한다.
  assert.match(item[".validate"], /!data\.exists\(\) && newData\.child\('status'\)\.val\(\) === 'requested'/u);
  // 반려에는 사유가 있어야 한다 — 칸이 아예 없는 경우도 막는다.
  assert.match(item[".validate"], /newData\.hasChild\('decisionNote'\) && newData\.child\('decisionNote'\)\.val\(\) !== ''/u);
  // 취소하면서 내용을 바꾸는 길을 막는다.
  for (const field of ApprovalCore.FROZEN) {
    assert.ok(
      item[".validate"].includes(`newData.child('${field}').val() === data.child('${field}').val()`),
      `${field} 가 규칙에서 고정되지 않았다`,
    );
  }
});

test("규칙이 모르는 칸을 막는다", () => {
  assert.equal(item.$other[".validate"], false);
  // approval-core 가 내는 칸은 규칙에 다 있어야 한다. 없으면 저장이 조용히 막힌다.
  const produced = Object.keys(ApprovalCore.normalizeRequest({ id: "a", userId: "u" }));
  const missing = produced.filter(field => !item[field]);
  assert.deepEqual(missing, [], `규칙에 없는 칸: ${missing.join(", ")}`);
});

test("화면이 사이드바에서 열리고 approval-core 가 먼저 실린다", () => {
  const nav = indexSource.slice(indexSource.indexOf("<nav"), indexSource.indexOf("</nav>"));
  assert.equal((nav.match(/data-view="officeApprovals"/g) || []).length, 1);
  const coreAt = indexSource.indexOf('src="./approval-core.js"');
  const officeAt = indexSource.indexOf('src="./office.js"');
  assert.ok(coreAt > 0 && coreAt < officeAt);
  assert.match(officeSource, /state\.context\.view === "officeApprovals"[\s\S]*?approvalsView\(\)/u);
  const view = officeSource.slice(officeSource.indexOf("function approvalsView()"), officeSource.indexOf("function approvalRow"));
  assert.match(view, /if \(!A\) return/u);
  // 관리자가 아니면 승인 칸이 아예 안 그려진다.
  assert.match(view, /state\.data\.approvalAdmin \? approvalAdminPanel/u);
});

test("회사 전체 합계를 내지 않는다", () => {
  // 본인 것과 관리자만 보는 화면이라, 합계를 내는 순간 재무 화면이 된다.
  const section = officeSource.slice(
    officeSource.indexOf("function approvalsView()"),
    officeSource.indexOf("async function runApproval"),
  );
  assert.ok(!/reduce\(/.test(section), "합계를 내고 있다");
});

test("사이드바 숫자를 실제로 갱신한다", () => {
  // 갱신하지 않으면 늘 0 으로 보이는데, 그건 "대기 없음" 이라고 거짓말하는 것과 같다.
  assert.match(indexSource, /id="navApprovalCount"/u);
  assert.match(officeSource, /function updateApprovalBadge/u);
  // 화면을 다시 그릴 때마다 같이 불린다.
  const updater = officeSource.slice(
    officeSource.indexOf("function updateUnreadBadge"),
    officeSource.indexOf("function updateApprovalBadge"),
  );
  assert.match(updater, /updateApprovalBadge\(userId\)/u);
  const badge = officeSource.slice(
    officeSource.indexOf("function updateApprovalBadge"),
    officeSource.indexOf("function mergeConfirmedReadReceipts"),
  );
  // 관리자와 본인이 세는 것이 다르다.
  assert.match(badge, /state\.data\.approvalAdmin \? A\.pending/u);
});

test("서버가 주는 두 가지 모양을 다 편다", () => {
  const many = OfficeCore.flattenApprovals({ u1: { a1: { id: "a1", status: "requested", title: "x" } } }, "me");
  assert.deepEqual(many.map(row => `${row.userId}/${row.id}`), ["u1/a1"]);
  const one = OfficeCore.flattenApprovals({ a9: { id: "a9", status: "approved", title: "y" } }, "me");
  assert.deepEqual(one.map(row => `${row.userId}/${row.id}`), ["me/a9"]);
  assert.deepEqual(OfficeCore.flattenApprovals(null, "me"), []);
  const payload = OfficeCore.normalizeOfficePayload({ approvals: { u1: { a1: { id: "a1", status: "requested" } } }, approvalAdmin: true }, { uid: "me" });
  assert.equal(payload.approvalAdmin, true);
  assert.equal(payload.approvals.length, 1);
});
