const assert = require("node:assert/strict");
const test = require("node:test");

const Anomaly = require("../src/attendance-anomaly-core");

const KST = "+09:00";
const at = (date, time) => `${date}T${time}:00.000${KST}`;

// u1: 평범한 주에 하루만 길게 일했다.
// u2: 한 주 내내 길게 일해 주 합계가 상한을 넘는다.
// u3: 퇴근을 안 찍은 날과 자정을 넘긴 날이 있다.
const rows = [
  { userId: "u1", workDate: "2026-09-01", checkInAt: at("2026-09-01", "09:00"), checkOutAt: at("2026-09-01", "18:00") },
  { userId: "u1", workDate: "2026-09-02", checkInAt: at("2026-09-02", "08:00"), checkOutAt: at("2026-09-02", "21:00") },
  { userId: "u1", workDate: "2026-09-03", checkInAt: at("2026-09-03", "09:00"), checkOutAt: at("2026-09-03", "18:00") },

  { userId: "u2", workDate: "2026-09-01", checkInAt: at("2026-09-01", "08:00"), checkOutAt: at("2026-09-01", "19:00") },
  { userId: "u2", workDate: "2026-09-02", checkInAt: at("2026-09-02", "08:00"), checkOutAt: at("2026-09-02", "19:00") },
  { userId: "u2", workDate: "2026-09-03", checkInAt: at("2026-09-03", "08:00"), checkOutAt: at("2026-09-03", "19:00") },
  { userId: "u2", workDate: "2026-09-04", checkInAt: at("2026-09-04", "08:00"), checkOutAt: at("2026-09-04", "19:00") },
  { userId: "u2", workDate: "2026-09-05", checkInAt: at("2026-09-05", "08:00"), checkOutAt: at("2026-09-05", "19:00") },

  { userId: "u3", workDate: "2026-09-01", checkInAt: at("2026-09-01", "09:00"), checkOutAt: "" },
  { userId: "u3", workDate: "2026-09-02", checkInAt: at("2026-09-02", "20:00"), checkOutAt: at("2026-09-03", "02:00") }
];

const today = "2026-09-10";

test("하루 12시간을 넘긴 날을 골라낸다", () => {
  const result = Anomaly.detect(rows, { userId: "u1", month: "2026-09", today });
  const long = result.findings.filter(item => item.type === "long_day");
  assert.equal(long.length, 1);
  assert.equal(long[0].workDate, "2026-09-02");
  assert.equal(long[0].severity, "high");
  // 9시간짜리 평범한 날은 걸리지 않는다.
  assert.equal(result.findings.filter(item => item.workDate === "2026-09-01").length, 0);
});

test("주 합계가 52시간을 넘으면 상한 초과로, 가까우면 근접으로 알린다", () => {
  const over = Anomaly.detect(rows, { userId: "u2", month: "2026-09", today });
  const week = over.findings.filter(item => item.type === "week_over_limit");
  assert.equal(week.length, 1);
  assert.equal(week[0].workDate, "2026-08-31", "9월 1일이 속한 주의 월요일은 8월 31일이다");
  assert.equal(week[0].severity, "high");

  // 하루를 빼면 44시간이라 근접 경고에도 못 미친다.
  const fewer = rows.filter(row => !(row.userId === "u2" && row.workDate === "2026-09-05"));
  const under = Anomaly.detect(fewer, { userId: "u2", month: "2026-09", today });
  assert.equal(under.findings.filter(item => item.type.startsWith("week_")).length, 0);
});

test("퇴근 기록이 없는 지난 날을 짚고, 오늘 근무 중인 날은 짚지 않는다", () => {
  const result = Anomaly.detect(rows, { userId: "u3", month: "2026-09", today });
  const missing = result.findings.filter(item => item.type === "missing_checkout");
  assert.equal(missing.length, 1);
  assert.equal(missing[0].workDate, "2026-09-01");

  // 같은 기록을 "그날이 오늘" 인 상태로 보면 아직 근무 중일 수 있으므로 조용하다.
  const sameDay = Anomaly.detect(rows, { userId: "u3", month: "2026-09", today: "2026-09-01" });
  assert.equal(sameDay.findings.filter(item => item.type === "missing_checkout").length, 0);
});

test("자정을 넘겨 퇴근한 날을 표시한다", () => {
  const result = Anomaly.detect(rows, { userId: "u3", month: "2026-09", today });
  const overnight = result.findings.filter(item => item.type === "overnight");
  assert.equal(overnight.length, 1);
  assert.equal(overnight[0].workDate, "2026-09-02");
});

test("지각·조퇴·결근은 판정하지 않는다", () => {
  // 기록이 아예 없는 날(9월 4일 u3)에 대해 아무 말도 하지 않아야 한다.
  // 휴무인지 결근인지 알 수 있는 데이터가 CRM 에 없기 때문이다.
  const result = Anomaly.detect(rows, { userId: "u3", month: "2026-09", today });
  assert.equal(result.findings.some(item => item.workDate === "2026-09-04"), false);
  const types = new Set(result.findings.map(item => item.type));
  for (const forbidden of ["late", "absent", "early_leave"]) {
    assert.equal(types.has(forbidden), false, `${forbidden} 는 판정하지 않는다`);
  }
  // 문구에도 위반·지각·결근 같은 단정이 없어야 한다.
  const wording = result.findings.map(item => `${item.message} ${item.detail}`).join(" ");
  assert.doesNotMatch(wording, /위반|지각|결근|조퇴/u);
});

test("표본 수를 함께 내서 기록 없음과 이상 없음을 구분할 수 있게 한다", () => {
  const empty = Anomaly.detect([], { month: "2026-09", today });
  assert.equal(empty.sampleSize, 0);
  assert.equal(empty.findings.length, 0);

  const quiet = Anomaly.detect(rows, { userId: "u1", month: "2026-09", today });
  assert.equal(quiet.sampleSize, 3);
  assert.ok(quiet.findings.length > 0);
});

test("userId 를 비우면 전원을 보고 심각도 순으로 정렬한다", () => {
  const all = Anomaly.detect(rows, { month: "2026-09", today });
  assert.ok(all.findings.length >= 4);
  assert.equal(all.counts.high + all.counts.medium + all.counts.low, all.findings.length);
  const severities = all.findings.map(item => item.severity);
  const rank = { high: 0, medium: 1, low: 2 };
  for (let index = 1; index < severities.length; index += 1) {
    assert.ok(rank[severities[index - 1]] <= rank[severities[index]], "심각한 것이 먼저 온다");
  }
});

test("주의 시작은 월요일이고 결과는 얼려서 돌려준다", () => {
  assert.equal(Anomaly.weekStartOf("2026-09-06"), "2026-08-31", "일요일은 그 주 월요일에 붙는다");
  assert.equal(Anomaly.weekStartOf("2026-09-07"), "2026-09-07", "월요일은 자기 자신이다");
  assert.equal(Anomaly.weekStartOf("망가진 값"), "");

  const result = Anomaly.detect(rows, { month: "2026-09", today });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.findings));
  assert.ok(result.findings.every(item => Object.isFrozen(item)));
});

test("시간 표기는 분이 0이면 시간만 쓴다", () => {
  assert.equal(Anomaly.formatHours(0), "0시간");
  assert.equal(Anomaly.formatHours(60), "1시간");
  assert.equal(Anomaly.formatHours(95), "1시간 35분");
  assert.equal(Anomaly.formatHours(-5), "0시간");
});

// --- 화면 연결 ---
// 코어만 있고 아무도 못 여는 상태가 되지 않도록, 전체 근태관리 화면에
// 실제로 붙어 있는지를 소스에서 확인한다.
const fs = require("node:fs");
const path = require("node:path");

const officeSource = fs.readFileSync(path.join(__dirname, "../src/office.js"), "utf8");
const indexSource = fs.readFileSync(path.join(__dirname, "../src/index.html"), "utf8");
const officeCss = fs.readFileSync(path.join(__dirname, "../src/office.css"), "utf8");

test("근태 이상 코어는 화면에서 실제로 열린다", () => {
  // 코어보다 office.js 가 먼저 실행되면 window 에 없다.
  assert.ok(indexSource.includes('<script src="./attendance-anomaly-core.js"></script>'));
  assert.ok(
    indexSource.indexOf("./attendance-anomaly-core.js") < indexSource.indexOf("./office.js"),
    "코어가 office.js 보다 먼저 로드돼야 한다",
  );
  assert.match(officeSource, /window\.BringAttendanceAnomalyCore/u);
  // 전체 근태관리의 두 탭(직원 목록·개인 상세) 모두에 붙어 있어야 한다.
  assert.match(officeSource, /\$\{attendanceAnomalyPanel\(selectedUser\.uid\)\}/u);
  assert.match(officeSource, /\$\{attendanceAnomalyPanel\(""\)\}/u);
  assert.match(officeCss, /\.attendance-anomaly-item\.high/u);
});

test("코어가 없어도 화면은 그냥 비어 나온다", () => {
  // 스크립트 하나가 안 붙었다고 근태관리 전체가 죽으면 안 된다.
  assert.match(officeSource, /if \(!Anomaly\) return "";/u);
});

test("화면 문구도 판정이 아니라 확인 요청으로 쓴다", () => {
  const panel = officeSource.slice(
    officeSource.indexOf("function attendanceAnomalyPanel"),
    officeSource.indexOf("function clearAdminAttendanceCorrection"),
  );
  assert.ok(panel.length > 0);
  assert.match(panel, /사람이 판단합니다/u);
  assert.doesNotMatch(panel, /위반입니다|지각|결근/u);
  // 기록 0건과 이상 0건을 다른 문구로 구분한다.
  assert.match(panel, /근태 기록이 아직 없습니다/u);
  assert.match(panel, /확인이 필요한 날이 없습니다/u);
});
