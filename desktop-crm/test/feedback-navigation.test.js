const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const sourceRoot = path.join(__dirname, "..", "src");
const indexSource = fs.readFileSync(path.join(sourceRoot, "index.html"), "utf8");
const appSource = fs.readFileSync(path.join(sourceRoot, "app.js"), "utf8");
const workspaceShellSource = fs.readFileSync(path.join(sourceRoot, "workspace-shell.js"), "utf8");
const navSource = indexSource.match(/<nav\b[^>]*\bid="nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1] || "";

test("sidebar folders start closed and expose collapsed accessibility state", () => {
  for (const folder of ["office", "customer-management", "calendar"]) {
    const markup = navSource.match(new RegExp(`<div class="nav-folder" data-nav-folder="${folder}">([\\s\\S]*?)<div class="nav-folder-children">`));
    assert.ok(markup, `${folder} should start without the open class`);
    assert.match(markup[1], /data-nav-folder-toggle aria-expanded="false"/);
  }
  assert.equal((navSource.match(/class="nav-folder open"/g) || []).length, 0);
});

test("sidebar removes the standalone consultation folder only", () => {
  assert.doesNotMatch(navSource, /data-nav-folder="consultation"/);
  assert.doesNotMatch(navSource, /data-view="consultations"|data-view="partnerQuotes"/);
  assert.doesNotMatch(navSource, /id="navConsultationCount"|id="navPartnerQuoteCount"/);
  assert.doesNotMatch(appSource, /const consultationView = \["consultations", "partnerQuotes"\]/);
  assert.doesNotMatch(appSource, /getElementById\("navConsultationCount"\)|getElementById\("navPartnerQuoteCount"\)/);
});

test("marketing workspace navigation remains available", () => {
  assert.match(indexSource, /<script src="\.\/workspace-shell\.js"><\/script>/);
  assert.match(indexSource, /<script src="\.\/marketing-core\.js"><\/script>/);
  assert.match(indexSource, /<script src="\.\/marketing-ui\.js"><\/script>/);
  assert.match(workspaceShellSource, /\["marketing", "마케팅 폴더", "마케팅 업무와 콘텐츠 관리"\]/);
  assert.match(workspaceShellSource, /data-workspace-enter="\$\{escapeHtml\(key\)\}"/);
  assert.match(appSource, /WorkspaceShell\.createWorkspaceCoordinator\(/);
  assert.match(appSource, /currentWorkspace === "marketing"/);
});

test("sidebar removes the sales pipeline tab and labels cases as complaint management", () => {
  assert.ok(navSource, "the primary sidebar navigation should exist");
  assert.equal((navSource.match(/data-view="pipeline"/g) || []).length, 0);
  assert.equal((navSource.match(/data-view="cases"/g) || []).length, 1);
  assert.match(
    navSource,
    /<button[^>]*data-view="cases"[^>]*>[\s\S]*?<b>민원 관리<\/b>[\s\S]*?id="navCaseCount"/,
  );
  assert.match(appSource, /cases:\s*\["접수부터 사후관리까지",\s*"민원 관리"\]/);
});

test("sidebar removes the standalone contract and work management tabs", () => {
  for (const view of ["contracts", "workManagement"]) {
    assert.equal(
      (navSource.match(new RegExp(`data-view="${view}"`, "g")) || []).length,
      0,
      `${view} should not remain in the primary sidebar`,
    );
  }
  assert.doesNotMatch(navSource, /id="navContractCount"/);
  assert.doesNotMatch(appSource, /getElementById\("navContractCount"\)/);
  // 운영 분석은 화면·코어가 모두 살아 있는데 열 방법만 없었다. 지우는 대신
  // BI 폴더 안으로 올려서 다시 열리게 뒀다.
  //
  // 할 일도 같은 이유로 되살렸다. 다만 사정이 조금 다르다 — 고아는 아니었다.
  // 고객 상세에서 만들고 볼 수 있었다. 문제는 고객에 안 붙인 "공통 업무" 다.
  // customerTasks 는 customerId 로만 거르기 때문에, 공통 업무는 목록 화면
  // 말고는 나오는 곳이 아예 없었다. 만들 수는 있는데 다시 찾을 수가 없었다.
  // 담당자별로 모아 보는 길도 여기밖에 없다.
  assert.equal((navSource.match(/data-view="tasks"/g) || []).length, 1);
  assert.match(navSource, /data-nav-folder="project"[\s\S]*?data-view="tasks"/u);
  assert.equal((navSource.match(/data-view="operationsIntelligence"/g) || []).length, 1);
  assert.match(navSource, /data-nav-folder="bi"[\s\S]*?data-view="operationsIntelligence"/u);
});

test("case and sales routes remain available behind the simplified navigation", () => {
  assert.match(appSource, /else if \(currentView === "cases"\) renderCases\(\)/);
  assert.match(appSource, /else if \(currentView === "pipeline"\) renderPipeline\(\)/);
  assert.match(appSource, /function renderPipeline\(\)[\s\S]*?SalesUI\.renderPipeline\(/);
  assert.match(
    appSource,
    /\[[^\]]*"cases"[^\]]*"pipeline"[^\]]*\]\.includes\(query\.get\("view"\)\)/,
  );
});

test("relocated and removed tabs keep their internal workflows and data routes", () => {
  assert.match(appSource, /else if \(currentView === "operationsIntelligence"\) renderOperationsIntelligence\(\)/);
  assert.match(appSource, /else if \(currentView === "tasks"\) renderTasks\(\)/);
  assert.match(appSource, /else if \(currentView === "contracts"\) renderContracts\(\)/);
  assert.match(appSource, /else if \(currentView === "workManagement"\) renderWorkManagement\(\)/);
  assert.match(indexSource, /data-nav-folder="calendar"[\s\S]*?data-unified-calendar-tab="contract"/);
  assert.match(
    appSource,
    /\[[^\]]*"operationsIntelligence"[^\]]*"contracts"[^\]]*"tasks"[^\]]*\]\.includes\(query\.get\("view"\)\)/,
  );
});

test("removing the tab does not remove the sales modules or shared sales records", () => {
  assert.match(indexSource, /<link[^>]+href="\.\/sales\.css"/);
  assert.ok(indexSource.indexOf("./sales-core.js") < indexSource.indexOf("./sales-ui.js"));
  assert.ok(indexSource.indexOf("./sales-standards.js") < indexSource.indexOf("./sales-ui.js"));
  assert.ok(indexSource.indexOf("./sales-ui.js") < indexSource.indexOf("./app.js"));

  for (const collection of [
    "salesProspects",
    "salesContacts",
    "salesUnits",
    "salesActivities",
    "salesEvents",
    "salesOpportunities",
  ]) {
    assert.match(appSource, new RegExp(`\\b${collection}\\b`));
  }
});
