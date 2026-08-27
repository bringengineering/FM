const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const sourceRoot = path.join(__dirname, "..", "src");
const indexSource = fs.readFileSync(path.join(sourceRoot, "index.html"), "utf8");
const appSource = fs.readFileSync(path.join(sourceRoot, "app.js"), "utf8");
const navSource = indexSource.match(/<nav\b[^>]*\bid="nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1] || "";

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

test("case and sales routes remain available behind the simplified navigation", () => {
  assert.match(appSource, /else if \(currentView === "cases"\) renderCases\(\)/);
  assert.match(appSource, /else if \(currentView === "pipeline"\) renderPipeline\(\)/);
  assert.match(appSource, /function renderPipeline\(\)[\s\S]*?SalesUI\.renderPipeline\(/);
  assert.match(
    appSource,
    /\[[^\]]*"cases"[^\]]*"pipeline"[^\]]*\]\.includes\(query\.get\("view"\)\)/,
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
