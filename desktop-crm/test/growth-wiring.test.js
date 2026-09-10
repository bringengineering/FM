const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const MutationPolicy = require("../src/mutation-policy");
const G = require("../src/growth-core");
const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const appSource = read("app.js");
const mainSource = read("main.js");
const preloadSource = read("preload.js");
const remoteSource = read("remote.js");
const indexSource = read("index.html");
const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "../../database.rules.json"), "utf8")).rules.crmCompany;
// 기록은 사람별 가지 아래에 담긴다. 한 자루에 몰아 담으면 자기 것만 골라
// 읽을 길이 없어서, 목록을 통째로 열어 주거나 아무것도 못 읽거나 둘 중
// 하나가 된다 — 예전에는 뒤쪽이었고, 그래서 화면이 늘 비어 있었다.
const checkin = rules.growthCheckins.$uid.$checkinId;
const review = rules.growthReviews.$uid.$reviewId;

function methodBody(source, name) {
  const start = source.indexOf(`async ${name}(`);
  if (start < 0) return "";
  const end = source.indexOf("\n  async ", start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}

test("통로 세 개가 세 곳에 다 등록돼 있다", () => {
  ["crm:growth-checkin-save", "crm:growth-review-save"].forEach(channel => {
    assert.doesNotThrow(() => MutationPolicy.assertRegistered(channel), channel);
    assert.equal(MutationPolicy.classification(channel), "mutation", channel);
    assert.ok(mainSource.includes(`secureCanonicalHandle("${channel}"`), channel);
    assert.ok(preloadSource.includes(`"${channel}"`), channel);
  });
  assert.equal(MutationPolicy.classification("crm:growth-load"), "control");
});

test("1on1 은 자기 것만 적고, 남의 것은 관리자만 본다", () => {
  // "무엇에 막혀 있나" 가 옆자리에 다 보이면 아무도 솔직하게 안 적는다.
  const save = methodBody(remoteSource, "saveGrowthCheckin");
  assert.match(save, /uid: session\.uid/u, "누가 적든 자기 이름으로만 저장된다");
  assert.match(save, /GrowthCore\.text\(existing\.uid, 80\) !== session\.uid/u, "남의 기록은 못 고친다");
  const load = methodBody(remoteSource, "loadGrowth");
  assert.match(load, /const mine = row => admin \|\| row\.uid === session\.uid/u);
  // 읽는 경로 자체가 다르다. 다 읽어 와서 화면에서 걸러 주면 화면을 안 거치는
  // 길로 남의 1on1 을 그대로 가져갈 수 있다.
  assert.match(load, /admin \? "growthCheckins" : `growthCheckins\/\$\{session\.uid\}`/u);
  // 못 읽은 것을 빈 목록으로 바꾸면 화면이 "아직 아무것도 없습니다" 라고
  // 거짓말을 하고, 아무도 이상한 줄 모른다. 실제로 그랬다.
  assert.ok(!/growth(Checkins|Reviews)[^\n]*\.catch\(\(\) => null\)/u.test(load), "실패를 삼키면 안 된다");

  // 규칙도 같은 것을 본다. 목록째로 훑는 것은 대표뿐이다.
  assert.match(rules.growthCheckins[".read"], /'admin'/u);
  assert.ok(!rules.growthCheckins[".read"].includes("'member'"), "팀원이 목록을 훑으면 다 보인다");
  assert.equal(rules.growthCheckins[".write"], false);
  assert.match(rules.growthCheckins.$uid[".read"], /auth\.uid === \$uid/u);
  assert.match(checkin[".write"], /\$uid === auth\.uid/u);
  assert.match(checkin[".validate"], /newData\.child\('uid'\)\.val\(\) === \$uid/u);
  assert.equal(checkin.$other[".validate"], false);
});

test("레벨은 회사가 정한다", () => {
  // 본인이 올릴 수 있으면 그건 약속이 아니다.
  assert.match(methodBody(remoteSource, "saveGrowthReview"), /session\.role !== "admin"/u);
  assert.match(review[".write"], /'admin'/u);
  assert.doesNotMatch(review[".write"], /'member'/u);
  // 그런데 본인은 자기 평가를 읽어야 한다 — 안 보이면 다음에 무엇을 할지 모른다.
  assert.match(rules.growthReviews.$uid[".read"], /auth\.uid === \$uid/u);
});

test("다음에 무엇을 배울지 없으면 저장이 막힌다", () => {
  // 그건 평가가 아니라 성적표다. 화면·코어·규칙 세 곳에서 다 막는다.
  assert.equal(G.validateReview({ id: "r", uid: "u", quarter: "2026-Q3", nextStep: "" }).code, "NEXT_STEP_REQUIRED");
  assert.match(review[".validate"], /'nextStep'/u);
  assert.match(review.nextStep[".validate"], /length > 0/u);
  assert.match(appSource, /이게 없으면 평가가 아니라 성적표입니다/u);
});

test("규칙이 코어와 같은 레벨을 안다", () => {
  const level = review.level[".validate"];
  G.LEVEL_KEYS.forEach(key => assert.ok(level.includes(`'${key}'`), key));
  assert.equal((level.match(/=== '/gu) || []).length, G.LEVEL_KEYS.length);
  // 질문 네 칸과 역량 여섯 칸도 같아야 한다.
  G.QUESTION_KEYS.forEach(key => assert.ok(checkin.answers[key], key));
  assert.equal(checkin.answers.$other[".validate"], false);
  G.SKILL_KEYS.forEach(key => assert.ok(review.skills[key], key));
});

test("급여는 어디에도 없다", () => {
  // 회사 재무는 브링 CRM 에 올리지 않는다.
  assert.doesNotMatch(read("growth-core.js"), /salary|연봉/u);
  assert.equal(review.$other[".validate"], false);
});

test("화면이 사이드바와 라우팅에 다 걸려 있다", () => {
  assert.match(appSource, /growth: \["다음 단계가 무엇인지 적어 둡니다", "성장·1on1"\]/u);
  assert.match(appSource, /currentView === "growth"\) renderGrowth\(\)/u);
  assert.ok(indexSource.includes('data-view="growth"'));
  assert.ok(indexSource.includes('<script src="./growth-core.js"></script>'));
  // HRIS·그룹웨어 폴더 안이다.
  const folder = indexSource.slice(indexSource.indexOf('data-nav-folder="office"'), indexSource.indexOf('data-nav-folder="bi"'));
  assert.ok(folder.includes('data-view="growth"'), "HRIS 폴더 안에 있어야 한다");
});

test("사이드바 숫자는 이번 주에 아직 못 만난 사람을 센다", () => {
  // 1on1 은 바쁘면 제일 먼저 빠진다. 빠진 것이 보여야 안 빠진다.
  const start = appSource.indexOf("function updateGrowthBadge(");
  const body = appSource.slice(start, appSource.indexOf("\n  function ", start));
  assert.match(body, /G\.missingCheckins\(workOrderState\.members \|\| \[\], growthState\.checkins, todayKey\(\)\)/u);
  assert.ok(indexSource.includes('id="navGrowthCount"'));
});

test("레벨 기준을 화면이 따로 적지 않는다", () => {
  // 두 벌이 되면 코어와 화면이 다른 말을 하게 된다.
  assert.match(appSource, /G\.LEVELS\.map/u);
  assert.match(appSource, /level\.signs\.map/u);
  assert.doesNotMatch(appSource, /"배우는 사람"/u);
});

test("매주 같은 것을 묻는 것이 화면에도 그대로다", () => {
  assert.match(appSource, /G\.CHECKIN_QUESTIONS\.map/u);
  assert.match(appSource, /G\.QUESTION_KEYS\.forEach/u);
});

test("새 화면이 없는 클래스에 기대지 않는다", () => {
  const css = read("styles.css");
  const start = appSource.indexOf("function renderGrowth(");
  const end = appSource.indexOf("  // --- 분기 목표 (OKR · RACI) ---");
  const used = [...appSource.slice(start, end).matchAll(/class="([^"$]*)"/gu)]
    .flatMap(match => match[1].split(/\s+/u))
    .filter(name => name.startsWith("gr-"));
  assert.ok(used.length > 0);
  new Set(used).forEach(name => assert.ok(css.includes(`.${name}`), `${name} 에 CSS 규칙이 없다`));
});
