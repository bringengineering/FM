const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const appSource = read("app.js");
const indexSource = read("index.html");
const cssSource = read("styles.css");
const buildingReportSource = read("building-report-core.js");
const buildingReportPdfSource = read("building-report-pdf.js");
const serviceReportSource = read("service-report-core.js");

test("건물 문서함이 문서관리 폴더에서 열린다", () => {
  // 코어만 있고 아무도 못 여는 상태가 되지 않게 진입 경로를 검사한다.
  assert.match(indexSource, /data-nav-folder="documents"[\s\S]*?data-view="buildingDocuments"/u);
  assert.equal((indexSource.match(/data-view="buildingDocuments"/g) || []).length, 1);
  assert.match(appSource, /buildingDocuments: \["건물마다 어떤 서류가 있는지", "건물 문서함"\]/u);
  assert.match(appSource, /else if \(currentView === "buildingDocuments"\) renderBuildingDocuments\(\)/u);
  assert.ok(
    indexSource.indexOf("./building-docs-core.js") < indexSource.indexOf("./app.js"),
    "코어가 app.js 보다 먼저 로드돼야 한다",
  );
  assert.match(cssSource, /\.building-docs-layout/u);
});

test("건물주에게 나가는 보고서는 문서함을 쓰지 않는다", () => {
  // 사내 전용이다. 회사 Drive 링크가 건물주 손에 들어가면 안 된다.
  // 작업 사진 링크(webViewLink)는 이전부터 쓰던 별개 자료다. 여기서 막는 것은
  // 문서함 자료를 읽어 오는 것뿐이다.
  for (const [name, source] of [
    ["building-report-core.js", buildingReportSource],
    ["building-report-pdf.js", buildingReportPdfSource],
    ["service-report-core.js", serviceReportSource],
  ]) {
    assert.doesNotMatch(source, /buildingDocuments|BuildingDocs|BringBuildingDocsCore/u,
      `${name} 이 문서함 자료를 참조하면 안 된다`);
  }
});

test("문서 발송 기능과 섞이지 않는다", () => {
  // document-delivery 는 고객에게 링크를 보내는 경로다. 문서함이 거기 붙으면
  // 사내 전용이라는 전제가 조용히 깨진다.
  const view = appSource.slice(
    appSource.indexOf("function renderBuildingDocuments"),
    appSource.indexOf("function buildingDocumentEditor"),
  );
  assert.ok(view.length > 0);
  assert.doesNotMatch(view, /documentDelivery|createDocumentDelivery|sendDocument/u);
  // 화면에도 사내 전용이라고 적어 둔다.
  assert.match(view, /건물주에게는 나가지 않습니다/u);
});

test("등록 화면이 출입 비밀번호를 적지 말라고 먼저 말한다", () => {
  const editor = appSource.slice(
    appSource.indexOf("function buildingDocumentEditor"),
    appSource.indexOf("function renderSecurity"),
  );
  assert.ok(editor.length > 0);
  assert.match(editor, /열쇠 번호·출입 비밀번호는 적지 마세요/u);
  assert.match(editor, /정보·열쇠 관리/u, "어디서 다루는지 알려 준다");
});

test("저장 전에 출입 비밀번호 검사를 통과해야 한다", () => {
  const handler = appSource.slice(
    appSource.indexOf('form.id === "buildingDocumentForm"'),
    appSource.indexOf('form.id === "buildingDocumentForm"') + 2200,
  );
  assert.ok(handler.length > 0);
  assert.match(handler, /BuildingDocs\.validateRegisterRequest\(/u);
  // 검사를 건너뛰고 바로 밀어 넣는 경로가 없어야 한다.
  const pushIndex = handler.indexOf("push(saved)");
  const validateIndex = handler.indexOf("validateRegisterRequest");
  assert.ok(validateIndex >= 0 && validateIndex < pushIndex, "검사가 저장보다 앞에 있어야 한다");
});

test("보관은 지우는 것이 아니다", () => {
  const handler = appSource.slice(
    appSource.indexOf("data-building-document-archive]"),
    appSource.indexOf("data-building-document-archive]") + 1400,
  );
  assert.ok(handler.length > 0);
  // 어떤 서류가 언제 연결돼 있었는지가 남아야 한다.
  assert.match(handler, /doc\.archivedAt = new Date\(\)\.toISOString\(\)/u);
  assert.doesNotMatch(handler, /splice\(|filter\(item =>/u);
  assert.match(handler, /logAudit\(/u);
});

test("Drive 확인은 읽기 전용 경로를 쓴다", () => {
  const handler = appSource.slice(
    appSource.indexOf("data-building-document-check]"),
    appSource.indexOf("data-building-document-archive]"),
  );
  assert.ok(handler.length > 0);
  // 회사 Drive 권한이 읽기 전용이라 업로드 경로는 없다. 기존 계약 기준
  // 확인 게이트웨이를 그대로 쓴다.
  assert.match(handler, /api\.checkContractSource\(/u);
  assert.doesNotMatch(handler, /upload|files\/create/iu);
});
