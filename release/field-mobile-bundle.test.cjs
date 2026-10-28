"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {createBundle, MODULES, APP_ID, DEPENDENCIES, PHOTOS_ROOT, REPORTS_ROOT} = require("./field-mobile-bundle.cjs");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "field-bundle-test-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("field-bundle-test-"));
    fs.rmSync(root, {recursive: true});
  });
  fs.mkdirSync(path.join(root, "functions/lib/field-mobile"), {recursive: true});
  for (const name of MODULES) fs.writeFileSync(path.join(root, "functions/lib/field-mobile", name), "export {};\n");
  fs.writeFileSync(path.join(root, "functions/lib/index.js"), "throw Error('legacy exports must not be deployed');");
  fs.writeFileSync(path.join(root, "functions/pnpm-lock.yaml"), "importers:\n  .:\n    dependencies:\n      firebase-admin:\n        specifier: ^13.5.0\n        version: 13.5.0\n      firebase-functions:\n        specifier: ^6.4.0\n        version: 6.4.0(firebase-admin@13.5.0)\n");
  for(const name of DEPENDENCIES.filter(n=>!n.startsWith('firebase-')))fs.appendFileSync(path.join(root,'functions/pnpm-lock.yaml'),`      '${name}':\n        specifier: 1.0.0\n        version: 1.0.0\n`);
  fs.mkdirSync(path.join(root,'desktop-crm/src'),{recursive:true});fs.writeFileSync(path.join(root,'desktop-crm/src/work-report-core.js'),'module.exports = {};');fs.writeFileSync(path.join(root,'desktop-crm/src/core.js'),'module.exports = {};');fs.writeFileSync(path.join(root,'desktop-crm/src/work-report-owner-pdf.js'),'module.exports = {};');
  fs.mkdirSync(path.join(root,'functions/assets'),{recursive:true});for(const name of ['NotoSansKR.ttf','NotoSansKR-OFL.txt'])fs.writeFileSync(path.join(root,'functions/assets',name),'synthetic font fixture');
  return root;
}
test("deployment contains only the mobile API and no database/hosting targets", t => {
  const root = fixture(t), bundle = createBundle(root);
  const config = JSON.parse(fs.readFileSync(bundle.config, "utf8"));
  assert.deepEqual(Object.keys(config), ["functions"]);
  assert.equal(config.functions[0].codebase, "field-mobile");
  const entry = fs.readFileSync(path.join(bundle.source, "index.js"), "utf8");
  assert.match(entry, /initializeApp\(\)/);
  assert.match(entry, /export \{ fieldMobileApi \}/);
  assert.doesNotMatch(entry, /legacy/);
  assert.equal(fs.readFileSync(path.join(bundle.source, ".env.bring-fm"), "utf8"), `FIELD_MOBILE_NATIVE_APP_IDS=${APP_ID}\nFIELD_MOBILE_PHOTOS_ROOT=${PHOTOS_ROOT}\nFIELD_MOBILE_REPORTS_ROOT=${REPORTS_ROOT}\n`);
  assert.equal(fs.readFileSync(path.join(bundle.source,'shared/work-report-core.cjs'),'utf8'),'module.exports = {};');
  assert.deepEqual(fs.readdirSync(path.join(bundle.source, "field-mobile")).sort(), [...MODULES].sort());
});
test("refuses an import outside the audited mobile modules", t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "functions/lib/field-mobile/endpoint.js"), "import '../index.js';");
  assert.throws(() => createBundle(root), /IMPORT_OUTSIDE_SCOPE/);
});
test("refuses unexpected files left in an existing bundle", t => {
  const root = fixture(t), bundle = createBundle(root);
  fs.writeFileSync(path.join(bundle.source, "unrelated.js"), "export {};");
  assert.throws(() => createBundle(root), /UNEXPECTED_FILE/);
});
