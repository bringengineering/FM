const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const source = file => readFile(path.join(__dirname, "..", "src", file), "utf8");

test("consultation navigation groups customer and vendor consultations", async () => {
  const [html, app] = await Promise.all([source("index.html"), source("app.js")]);
  const folder = html.match(/<div class="nav-folder" data-nav-folder="consultation">([\s\S]*?)<\/div>\s*<\/div>/);

  assert.ok(folder, "consultation folder must exist and start closed");
  assert.match(folder[1], /data-nav-folder-toggle aria-expanded="false"/);
  assert.match(folder[1], /<b>상담 기록<\/b>/);
  assert.match(folder[1], /class="nav-item nav-child" data-view="consultations"[\s\S]*?<b>고객 상담<\/b>/);
  assert.match(folder[1], /class="nav-item nav-child" data-view="partnerQuotes"[\s\S]*?<b>업체 상담<\/b>/);
  assert.ok(folder[1].indexOf('data-view="consultations"') < folder[1].indexOf('data-view="partnerQuotes"'));
  assert.equal((html.match(/data-view="consultations"/g) || []).length, 1);
  assert.equal((html.match(/data-view="partnerQuotes"/g) || []).length, 1);

  const customerFolderAt = html.indexOf('data-nav-folder="customer-management"');
  const consultationFolderAt = html.indexOf('data-nav-folder="consultation"');
  const calendarAt = html.indexOf('data-view="buildingCalendar"');
  assert.ok(customerFolderAt < consultationFolderAt && consultationFolderAt < calendarAt);

  assert.match(app, /consultations:\s*\["전화·방문·미팅 내용",\s*"고객 상담"\]/);
  assert.match(app, /const consultationView = \["consultations", "partnerQuotes"\]\.includes\(currentView\)/);
  assert.match(app, /document\.querySelector\('\[data-nav-folder="consultation"\]'\)/);
  assert.match(app, /consultationFolder\?\.classList\.toggle\("active", consultationView\)/);
  assert.match(app, /consultationFolder\?\.classList\.add\("open"\)/);
});
