const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const MutationPolicy = require("../src/mutation-policy");
const WorkReportCore = require("../src/work-report-core");
const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const mainSource = read("main.js");
const preloadSource = read("preload.js");
const remoteSource = read("remote.js");
const appSource = read("app.js");
const indexSource = read("index.html");
const driveSource = read("building-docs-drive.js");
const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "../../database.rules.json"), "utf8")).rules.crmCompany;

function methodBody(source, name) {
  const start = source.indexOf(`async ${name}(`);
  if (start < 0) return "";
  const end = source.indexOf("\n  async ", start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}

function functionBody(source, name) {
  const start = source.indexOf(`async function ${name}(`);
  if (start < 0) return "";
  const end = source.indexOf("\nasync function ", start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}

test("결과보고서 채널이 세 곳에 다 등록돼 있다", () => {
  for (const channel of ["crm:work-report-save", "crm:work-report-photo-upload", "crm:work-report-export"]) {
    assert.doesNotThrow(() => MutationPolicy.assertRegistered(channel), channel);
    assert.ok(mainSource.includes(`secureCanonicalHandle("${channel}"`), channel);
    assert.ok(preloadSource.includes(`"${channel}"`), channel);
    assert.equal(MutationPolicy.classification(channel), "mutation", channel);
  }
  assert.ok(mainSource.includes('secureHandle("crm:work-reports-load"'));
  assert.equal(MutationPolicy.classification("crm:work-reports-load"), "control");
});

test("마케팅 전용 계정은 결과보고서를 못 만진다", () => {
  // 이 문서에는 건물주 이름·주소와 현장 사진이 담긴다.
  for (const channel of ["crm:work-report-save", "crm:work-report-photo-upload", "crm:work-report-export"]) {
    assert.throws(
      () => MutationPolicy.assertChannelAllowed(channel, { accessRole: "member", marketingRole: "marketing" }),
      error => error.code === "MARKETING_ONLY_FORBIDDEN",
      channel,
    );
  }
  assert.match(functionBody(mainSource, "exportWorkReport"), /MARKETING_ONLY_FORBIDDEN/u);
  assert.match(functionBody(mainSource, "uploadWorkReportPhoto"), /MARKETING_ONLY_FORBIDDEN/u);
});

test("업체 정보가 섞인 보고서는 아예 만들지 않는다", () => {
  // 만들고 나서 지우는 것보다 안 만드는 편이 낫다. 한 번 나간 PDF 는
  // 되돌릴 수 없다.
  const body = functionBody(mainSource, "exportWorkReport");
  assert.match(body, /WorkReportCore\.findLeakedFields\(report, options\.secrets\)/u);
  assert.match(body, /REPORT_LEAK/u);
  assert.ok(body.indexOf("findLeakedFields") < body.indexOf("showSaveDialog"), "저장 창을 열기 전에 걸러야 한다");
  // 화면도 협력업체 이름을 실어 보낸다. 안 보내면 검사가 아무것도 못 잡는다.
  assert.match(appSource, /function reportSecrets\(\)/u);
  assert.match(appSource, /secrets: reportSecrets\(\)/u);
});

test("인감 없이는 보고서를 못 만든다", () => {
  // 청창사 서식이 표지에 대표자 날인을 요구한다. 없으면 반려된다.
  const body = functionBody(mainSource, "exportWorkReport");
  assert.match(body, /readLocalQuoteSeal\(\)/u);
  assert.match(body, /QUOTE_SEAL_REQUIRED/u);
});

test("사진은 인쇄 직전에 받아 문서 안에 박는다", () => {
  // 링크로 두면 받은 사람의 PDF 에서는 아예 안 열린다. 그 사람은 우리
  // Drive 에 로그인할 수 없다.
  const body = functionBody(mainSource, "exportWorkReport");
  assert.match(body, /BuildingDocsDrive\.downloadFile/u);
  assert.match(body, /data:\$\{fetched\.mimeType \|\| "image\/jpeg"\};base64,/u);
  // 한 장을 못 받았다고 보고서 전체를 못 내면 안 된다.
  assert.match(body, /catch \(_error\) \{/u);
  // 너무 큰 파일은 받지 않는다. 사진 스무 장이 각각 20MB 면 인쇄가 멈춘다.
  assert.match(driveSource, /DRIVE_FILE_TOO_LARGE/u);
  assert.match(driveSource, /maxBytes\) > 0 \? Number\(input\.maxBytes\) : 12 \* 1024 \* 1024/u);
});

test("사진은 건물별·작업일별로 Drive 에 쌓는다", () => {
  const body = functionBody(mainSource, "uploadWorkReportPhoto");
  assert.match(body, /folderPath: \["결과보고서", String\(options\.buildingName \|\| "건물 없음"\), `\$\{day\}_\$\{String\(options\.kindLabel \|\| "작업"\)\}`\]/u);
  assert.match(body, /pickedDocumentPaths\.has\(filePath\)/u);
  assert.match(body, /DRIVE_AUTH_REQUIRED/u);
});

test("조회 전용 계정은 보고서를 못 쓴다", () => {
  const save = methodBody(remoteSource, "saveWorkReport");
  assert.match(save, /session\.role !== "admin" && session\.role !== "member"/u);
  assert.match(save, /WORK_REPORT_FORBIDDEN/u);
  assert.match(save, /WorkReportCore\.validateReport/u);
});

test("규칙이 항목·상태·사진 모양을 코드와 같이 본다", () => {
  const report = rules.workReports.$reportId;
  assert.ok(report, "workReports 규칙이 있어야 한다");
  assert.match(rules.workReports[".read"], /'viewer'/u);
  assert.match(report[".write"], /'member'/u);
  assert.doesNotMatch(report[".write"], /'viewer'/u);
  assert.match(report[".write"], /newData\.exists\(\)/u, "지우는 길은 없다");
  assert.equal(report.$other[".validate"], false);

  WorkReportCore.KIND_KEYS.forEach(key => assert.ok(report.kind[".validate"].includes(`'${key}'`), key));
  assert.equal((report.kind[".validate"].match(/=== '/gu) || []).length, WorkReportCore.KIND_KEYS.length);

  const item = report.items.$itemIndex;
  WorkReportCore.ITEM_STATUSES.forEach(entry => assert.ok(item.status[".validate"].includes(`'${entry.key}'`), entry.key));
  assert.equal((item.status[".validate"].match(/=== '/gu) || []).length, WorkReportCore.ITEM_STATUSES.length);
  // 사진은 Drive 것만. 사내 경로가 들어오면 다른 사람 화면에서 안 열린다.
  ["before", "after"].forEach(phase => {
    assert.match(item[phase].$photoIndex.webViewLink[".validate"], /beginsWith\('https:\/\/'\)/u, phase);
    assert.equal(item[phase].$photoIndex.$other[".validate"], false, phase);
  });
  assert.equal(item.$other[".validate"], false);
});

test("화면이 사이드바와 라우팅에 다 걸려 있다", () => {
  assert.match(appSource, /workReports: \["작업 종류를 고르면 항목이 깔립니다", "작업 결과보고서"\]/u);
  assert.match(appSource, /currentView === "workReports"\) renderWorkReports\(\)/u);
  assert.ok(indexSource.includes('data-view="workReports"'));
  assert.ok(indexSource.includes('<script src="./work-report-core.js"></script>'));
  // 문서관리 폴더 안, 서식 옆이다.
  const folder = indexSource.slice(indexSource.indexOf('data-nav-folder="documents"'), indexSource.indexOf('data-nav-folder="workflow"'));
  assert.ok(folder.includes('data-view="workReports"'), "문서관리 폴더 안에 있어야 한다");
});

test("항목은 코드가 깔고 사람은 사진만 붙인다", () => {
  const start = appSource.indexOf("function reportEditor(");
  const body = appSource.slice(start, appSource.indexOf("\n  function readReportForm(", start));
  // 표준 항목을 화면에서 다시 만들지 않는다. 만들면 코어와 어긋난다.
  assert.match(body, /draft\.items\.map\(item =>/u);
  assert.match(body, /R\.ITEM_STATUSES\.map/u);
  assert.match(body, /R\.KINDS\.map/u);
  // 못 낼 이유를 저장 단추 누르기 전에 다 보여 준다.
  assert.match(body, /R\.blockers\(draft\)/u);
  assert.match(body, /blockers\.length \? " disabled" : ""/u);
  assert.match(body, /R\.itemIssue\(item\)/u);
});

test("사진 한 장 붙일 때마다 서버에 쓰지 않는다", () => {
  // 그러면 반쯤 쓴 보고서가 서버에 남는다. 저장은 사람이 누를 때만 한다.
  const start = appSource.indexOf("async function addWorkReportPhoto(");
  const body = appSource.slice(start, appSource.indexOf("\n  function dropWorkReportPhoto(", start));
  assert.match(body, /api\.uploadWorkReportPhoto/u);
  assert.doesNotMatch(body, /api\.saveWorkReport/u);
  // 건물을 모르면 사진이 어느 현장 것인지 알 수 없다.
  assert.match(body, /건물을 먼저 골라 주세요/u);
});

test("사진을 빼도 Drive 에서는 지우지 않는다", () => {
  // 잘못 눌렀을 때 되돌릴 길이 있어야 한다.
  const start = appSource.indexOf("function dropWorkReportPhoto(");
  const body = appSource.slice(start, appSource.indexOf("\n  async function exportWorkReportPdf(", start));
  assert.match(body, /filter\(photo => photo\.id !== photoId\)/u);
  assert.doesNotMatch(body, /delete|삭제/u);
});

test("두 벌을 각각 낼 수 있다", () => {
  assert.ok(appSource.includes('data-report-copy="owner"'));
  assert.ok(appSource.includes('data-report-copy="program"'));
  const start = appSource.indexOf("async function exportWorkReportPdf(");
  const body = appSource.slice(start, start + 1200);
  assert.match(body, /copyType,/u);
});

test("새 화면이 없는 클래스에 기대지 않는다", () => {
  const start = appSource.indexOf("// --- 작업 결과보고서 ---");
  const end = appSource.indexOf("// --- 수주 진행 ---");
  const section = appSource.slice(start, end);
  const used = new Set([...section.matchAll(/class="([^"$]*)"/gu)]
    .flatMap(match => match[1].split(/\s+/u))
    .filter(name => name.startsWith("wr-") || name.startsWith("office-")));
  const allCss = fs.readdirSync(path.join(__dirname, "../src"))
    .filter(file => file.endsWith(".css"))
    .map(read).join("\n");
  const styled = new Set([...allCss.matchAll(/\.((?:wr|office)-[a-z0-9-]+)/gu)].map(match => match[1]));
  assert.ok(used.size > 0);
  used.forEach(name => assert.ok(styled.has(name), `${name} 에 CSS 규칙이 없다`));
});
