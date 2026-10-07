const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const source = file => readFile(path.join(__dirname, "..", "src", file), "utf8");

test("standalone consultation navigation is removed", async () => {
  const [html, app] = await Promise.all([source("index.html"), source("app.js")]);
  const nav = html.match(/<nav\b[^>]*\bid="nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1] || "";

  assert.ok(nav, "the primary sidebar navigation should exist");
  assert.doesNotMatch(nav, /data-nav-folder="consultation"/);
  assert.doesNotMatch(nav, /data-view="consultations"|data-view="partnerQuotes"/);
  assert.doesNotMatch(nav, /id="navConsultationCount"|id="navPartnerQuoteCount"/);
  assert.doesNotMatch(app, /const consultationView = \["consultations", "partnerQuotes"\]/);
  assert.doesNotMatch(app, /document\.querySelector\('\[data-nav-folder="consultation"\]'\)/);
  assert.doesNotMatch(app, /getElementById\("navConsultationCount"\)|getElementById\("navPartnerQuoteCount"\)/);

  const partnerVendorView = app.match(/function renderPartnerVendors\(\) \{([\s\S]*?)\n  function renderPartnerQuotes\(\)/)?.[1] || "";
  assert.ok(partnerVendorView, "the partner vendor list renderer should remain available");
  assert.doesNotMatch(partnerVendorView, /data-view="partnerQuotes"|업체 상담 보기/);
});

test("customer and partner consultation workflows remain in their detail views", async () => {
  const app = await source("app.js");

  assert.match(app, /data-action="new-consultation" data-customer-id=/);
  assert.match(app, /data-customer-consultations=/);
  assert.match(app, /data-action="new-partner-quote" data-partner-vendor-id=/);
  assert.match(app, /data-partner-vendor-consultations=/);
});

test("removing consultation tabs preserves their internal data and hidden routes", async () => {
  const app = await source("app.js");

  assert.match(app, /consultations:\s*\["전화·방문·미팅 내용",\s*"고객 상담"\]/);
  assert.match(app, /partnerQuotes:\s*\["가격과 상담 내용을 한곳에서",\s*"업체 상담"\]/);
  assert.match(app, /else if \(currentView === "consultations"\) renderConsultations\(\)/);
  assert.match(app, /else if \(currentView === "partnerQuotes"\) renderPartnerQuotes\(\)/);
  assert.match(app, /function renderConsultations\(\)/);
  assert.match(app, /function renderPartnerQuotes\(\)/);
  assert.match(app, /store\.partnerQuotes/);
  assert.match(
    app,
    /\[[^\]]*"consultations"[^\]]*"partnerQuotes"[^\]]*\]\.includes\(query\.get\("view"\)\)/,
  );
});
