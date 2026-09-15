const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const MutationPolicy = require("../src/mutation-policy");
const W = require("../src/work-report-core");
const P = require("../src/report-photo-plan");
const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const appSource = read("app.js");
const mainSource = read("main.js");
const preloadSource = read("preload.js");
const indexSource = read("index.html");
const pdfSource = read("work-report-pdf.js");
const driveSource = read("building-docs-drive.js");

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) return "";
  const end = source.indexOf("\n  function ", start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}

function topLevelBody(source, name) {
  const start = source.indexOf(`async function ${name}(`);
  if (start < 0) return "";
  const end = source.indexOf("\nasync function ", start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}

test("훑기 통로가 세 곳에 다 등록돼 있고 읽기로 분류된다", () => {
  const channel = "crm:work-report-photos-scan";
  assert.doesNotThrow(() => MutationPolicy.assertRegistered(channel));
  // 아무것도 안 바꾼다. 바꾸는 것으로 분류하면 필요 없는 권한을 쓴다.
  assert.equal(MutationPolicy.classification(channel), "control");
  assert.ok(mainSource.includes(`secureHandle("${channel}"`));
  assert.ok(preloadSource.includes(`"${channel}"`));
});

test("마케팅 전용 계정은 사진을 훑지 못한다", () => {
  // 폴더 이름과 사진 목록에 건물주 이름과 현장이 다 드러난다.
  const body = topLevelBody(mainSource, "scanWorkReportPhotos");
  assert.match(body, /MARKETING_ONLY_FORBIDDEN/u);
  assert.match(body, /DRIVE_AUTH_REQUIRED/u);
  assert.match(body, /FOLDER_REQUIRED/u);
});

test("훑을 때 사진을 받아 오지 않는다", () => {
  // 스무 장을 받아 오면 그동안 화면이 멈춘다. 초안에 필요한 것은 이름과
  // 시각뿐이다. 사진은 인쇄할 때 받는다.
  const body = topLevelBody(mainSource, "scanWorkReportPhotos");
  assert.doesNotMatch(body, /downloadFile/u);
  assert.match(body, /BuildingDocsDrive\.scanPhotoFolder/u);
});

test("Drive 를 두 층까지만 훑는다", () => {
  // 깊이 제한이 없으면 실수로 Drive 전체를 훑다가 멈춘다.
  assert.match(driveSource, /async function scanPhotoFolder\(/u);
  assert.match(driveSource, /maxFolders\) > 0 \? Number\(settings\.maxFolders\) : 30/u);
  assert.match(driveSource, /maxPages\) > 0 \? Number\(settings\.maxPages\) : 5/u);
  // 다 못 읽었으면 다 읽은 척하지 않는다.
  assert.match(driveSource, /truncated/u);
  const body = mainSource.slice(mainSource.indexOf("async function scanWorkReportPhotos("));
  assert.match(body.slice(0, 2000), /scanned\.truncated/u, "덜 읽었으면 화면에 말해야 한다");
});

test("화면이 링크를 붙여 넣어도 ID 를 떼어낸다", () => {
  // 사람은 주소창을 통째로 복사한다. ID 만 떼어내라고 시키면 안 쓴다.
  const source = functionBody(appSource, "reportDriveFolderId");
  assert.match(source, /folders/u);
  const pick = new Function(`${source} return reportDriveFolderId;`)();
  assert.equal(pick("https://drive.google.com/drive/folders/17EWMXA834daN5r9ZedRWrhJHWR8ppB7q"), "17EWMXA834daN5r9ZedRWrhJHWR8ppB7q");
  assert.equal(pick("17EWMXA834daN5r9ZedRWrhJHWR8ppB7q"), "17EWMXA834daN5r9ZedRWrhJHWR8ppB7q");
  assert.equal(pick("그냥 글자"), "");
});

test("끌어온 것이 사람이 적은 것을 덮지 않는다", () => {
  // 사람이 이미 적어 둔 비고와 상태가 사라지면, 다시 적을 사람은 없다.
  const body = functionBody(appSource, "applyReportDrivePlan");
  assert.match(body, /before: item\.before\.concat\(found\.before\)/u);
  assert.match(body, /after: item\.after\.concat\(found\.after\)/u);
  assert.match(body, /note: item\.note \|\| found\.note/u);
  // 저장은 사람이 누를 때만. 여기서 서버로 보내지 않는다.
  assert.doesNotMatch(body, /api\.saveWorkReport/u);
});

test("화면과 규칙이 같은 모듈을 쓴다", () => {
  // 화면이 항목 잇는 표를 따로 들면 서버와 어긋난다.
  const body = functionBody(appSource, "applyReportDrivePlan");
  assert.match(body, /P\.toReportDraft\(plan, \{ core: R, kind: draft\.kind \}\)/u);
  assert.ok(indexSource.includes('<script src="./report-photo-plan.js"></script>'));
  // main.js 도 같은 모듈을 쓴다.
  assert.match(mainSource, /const ReportPhotoPlan = require\("\.\/report-photo-plan"\)/u);
  assert.match(mainSource, /ReportPhotoPlan\.planFromTree/u);
});

test("쓰던 양식의 칸이 화면·자료·인쇄에 다 있다", () => {
  // 종이 양식에 있는데 화면에 없으면 사람은 다시 손으로 적는다.
  const report = W.normalizeReport({});
  ["category", "ownerName", "ownerContact", "followUp"].forEach(key => {
    assert.ok(Object.prototype.hasOwnProperty.call(report, key), `${key} 가 자료에 없다`);
    assert.ok(appSource.includes(`name="${key}"`), `${key} 가 화면에 없다`);
    assert.ok(appSource.includes(`raw.${key}`), `${key} 를 화면이 안 읽는다`);
  });
  ["문서번호", "요청자(건물주)", "연락 방식", "후속 필요 사항", "확인자(건물주)"].forEach(label => {
    assert.ok(pdfSource.includes(label), `${label} 이 인쇄물에 없다`);
  });
});

test("안내 세 줄은 어느 보고서에도 빠지지 않는다", () => {
  // 이 세 줄은 우리가 지키기로 한 것이다. 빠진 보고서가 한 장이라도
  // 나가면 지키기로 한 것이 아니게 된다.
  assert.equal(W.NOTICES.length, 3);
  assert.match(W.NOTICES[0], /열쇠·출입 비밀번호/u);
  assert.match(W.NOTICES[1], /법정 의무점검/u);
  assert.match(W.NOTICES[2], /비용 부담 비율/u);
  assert.match(pdfSource, /WorkReportCore\.NOTICES\.map/u);
  // 사람이 끌 수 있는 자리가 없어야 한다.
  assert.doesNotMatch(pdfSource, /NOTICES[\s\S]{0,80}\?/u);
});

test("문서번호는 같은 보고서면 늘 같다", () => {
  // 사람이 매기면 겹치거나 빠진다. 볼 때마다 달라져도 안 된다.
  const report = { id: "wr_abc1234", kind: "stairs", workDate: "2026-09-06" };
  assert.equal(W.documentNo(report), W.documentNo(report));
  assert.equal(W.documentNo(report), "BR-20260906-STA-1234");
  assert.notEqual(W.documentNo(report), W.documentNo({ ...report, workDate: "2026-09-07" }));
});

test("폴더 잇는 표가 진짜 항목만 가리킨다", () => {
  Object.entries(P.FOLDER_HINTS).forEach(([kind, table]) => {
    const keys = W.itemsFor(kind, []).map(item => item.key);
    Object.values(table).forEach(itemKey => assert.ok(keys.includes(itemKey), `${kind}/${itemKey}`));
  });
});

test("새 화면이 없는 클래스에 기대지 않는다", () => {
  const body = functionBody(appSource, "reportDriveBox");
  const used = [...body.matchAll(/class="([^"$]*)"/gu)]
    .flatMap(match => match[1].split(/\s+/u))
    .filter(name => name.startsWith("wr-drive"));
  const css = read("styles.css");
  assert.ok(used.length > 0);
  new Set(used).forEach(name => assert.ok(css.includes(`.${name}`), `${name} 에 CSS 규칙이 없다`));
});
