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
const officeSource = read("office.js");
const indexSource = read("index.html");
const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "../../database.rules.json"), "utf8"))
  .rules.crmCompany.officeMembers;

const CHANNEL = "crm:hr-record-save";

test("인사기록 채널이 세 곳에 다 등록돼 있다", () => {
  assert.doesNotThrow(() => MutationPolicy.assertRegistered(CHANNEL));
  assert.ok(mainSource.includes(`secureCanonicalHandle("${CHANNEL}"`));
  assert.ok(preloadSource.includes(`"${CHANNEL}"`));
  assert.equal(MutationPolicy.classification(CHANNEL), "mutation");
});

test("마케팅 전용 계정은 인사기록을 만지지 못한다", () => {
  assert.throws(
    () => MutationPolicy.assertChannelAllowed(CHANNEL, { accessRole: "member", marketingRole: "marketing" }),
    error => error.code === "MARKETING_ONLY_FORBIDDEN",
  );
});

test("관리자가 아니면 저장 자체를 막는다", () => {
  const saver = remoteSource.slice(
    remoteSource.indexOf("async saveMemberRecord"),
    remoteSource.indexOf("async saveOfficeAttendance"),
  );
  assert.ok(saver.length > 0);
  assert.match(saver, /session\.role !== "admin"/u);
  assert.match(saver, /HR_RECORD_FORBIDDEN/u);
  // 화면 검사만으로는 IPC 를 직접 부르면 뚫린다. 서버로 가기 전에 한 번 더 본다.
  assert.match(saver, /HrCore\.validateRecord/u);
  // 항상 그 사람 칸에만 쓴다.
  assert.match(saver, /officeMembers\/\$\{record\.userId\}/u);
});

test("본인은 자기 인사기록만 읽는다", () => {
  const loader = remoteSource.slice(
    remoteSource.indexOf("async loadOfficeSnapshot"),
    remoteSource.indexOf("async loadOffice()"),
  );
  assert.match(loader, /memberAdmin \? "officeMembers" : `officeMembers\/\$\{session\.uid\}`/u);
  assert.match(loader, /const memberAdmin = session\.role === "admin"/u);
  // 인사기록을 못 읽는다고 근태·메신저까지 죽으면 안 된다.
  assert.match(loader, /this\.dbRequest\(memberLocation, \{ method: "GET" \}\)\.catch\(\(\) => null\)/u);
});

test("규칙이 남의 인사기록을 막는다", () => {
  // 화면을 우회해도 서버가 판단한다. 이게 진짜 경계다.
  assert.match(rules[".read"], /role'\)\.val\(\) === 'admin'/u);
  assert.equal(rules[".write"], false);
  assert.match(rules.$uid[".read"], /auth\.uid === \$uid \|\| /u);
  assert.match(rules.$uid[".write"], /role'\)\.val\(\) === 'admin'/u);
  assert.ok(!/auth\.uid === \$uid/.test(rules.$uid[".write"]), "본인이 자기 인사기록을 고칠 수 있으면 안 된다");
});

test("규칙이 주민등록번호와 모르는 칸을 막는다", () => {
  for (const field of ["note", "phone", "emergencyContact", "department", "position"]) {
    assert.match(rules.$uid[field][".validate"], /\[0-9\]\{6\}\[-\. \]\?\[1-4\]\[0-9\]\{6\}/u, field);
  }
  // 칸을 새로 지어내서 주민번호를 넣는 길도 막는다.
  assert.equal(rules.$uid.$other[".validate"], false);
  assert.ok(!Object.keys(rules.$uid).includes("residentNumber"));
  assert.ok(!Object.keys(rules.$uid).some(key => /salary|account|bank/i.test(key)));
});

test("규칙이 삭제를 막는다", () => {
  // 근로계약서는 3년 보관 의무가 있다. 퇴사는 삭제가 아니라 퇴사일이다.
  assert.match(rules.$uid[".write"], /newData\.exists\(\)/u);
});

test("화면이 사이드바에서 열리고 hr-core 가 먼저 실린다", () => {
  const nav = indexSource.slice(indexSource.indexOf("<nav"), indexSource.indexOf("</nav>"));
  assert.equal((nav.match(/data-view="officeMembers"/g) || []).length, 1);
  const hrAt = indexSource.indexOf('src="./hr-core.js"');
  const officeAt = indexSource.indexOf('src="./office.js"');
  assert.ok(hrAt > 0 && hrAt < officeAt, "hr-core 가 office 뒤에 있다");
  assert.match(officeSource, /state\.context\.view === "officeMembers"[\s\S]*?membersView\(\)/u);
  // 모듈 하나 못 실었다고 그룹웨어가 빈 화면이 되면 안 된다.
  const view = officeSource.slice(officeSource.indexOf("function membersView()"), officeSource.indexOf("function myRecordView"));
  assert.match(view, /if \(!H\) return/u);
});

test("관리자가 아니면 편집 폼 대신 본인 기록만 본다", () => {
  const view = officeSource.slice(officeSource.indexOf("function membersView()"), officeSource.indexOf("function myRecordView"));
  assert.match(view, /if \(!state\.data\.memberAdmin\) return myRecordView/u);
});

test("연차 발생일수 제안이 인사기록의 입사일을 쓴다", () => {
  // 그동안 user.hireDate 를 봤는데 normalizeUser 가 그 값을 들고 오지 않아
  // 제안 칸이 언제나 비어 있었다.
  const panel = officeSource.slice(officeSource.indexOf("function leaveAdminPanel"), officeSource.indexOf("async function submitLeaveRequest"));
  assert.match(panel, /memberRecordOf\(user\.uid\)/u);
  assert.ok(!/const hireDate = String\(user\.hireDate \|\| ""\);/.test(panel));
  assert.ok(!("hireDate" in OfficeCore.normalizeUser("u1", { hireDate: "2024-01-01" })),
    "normalizeUser 가 hireDate 를 들고 오게 됐다면 이 우회가 필요 없다");
});

test("서버가 주는 두 가지 모양을 다 편다", () => {
  // 관리자는 uid 묶음을, 본인은 자기 기록 하나를 받는다.
  const many = OfficeCore.flattenMembers({ u1: { userId: "u1" }, u2: { hireDate: "2023-01-01" } }, "me");
  assert.deepEqual(many.map(row => row.userId).sort(), ["u1", "u2"]);
  const one = OfficeCore.flattenMembers({ userId: "me", hireDate: "2022-01-01" }, "me");
  assert.deepEqual(one.map(row => row.userId), ["me"]);
  assert.deepEqual(OfficeCore.flattenMembers(null, "me"), []);
  const payload = OfficeCore.normalizeOfficePayload({ members: { u1: { userId: "u1" } }, memberAdmin: true }, { uid: "me" });
  assert.equal(payload.memberAdmin, true);
  assert.equal(payload.members.length, 1);
});
