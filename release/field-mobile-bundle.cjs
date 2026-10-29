"use strict";
// A separate, additive codebase: never load or publish the legacy field exports.
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const APP_ID = "1:864976295990:android:644a2b7d5242a0b5eb6097";
const MODULES = Object.freeze(["access.js", "endpoint.js", "firebase-reads.js", "http.js", "workspace.js", "sites.js", "report-core.js", "recording-model.js", "recording-service.js", "recording-drive.js", "recording-pdf.js", "recording-runtime.js", "recording-http.js", "delivery.js"]);
const DEPENDENCIES = Object.freeze(["firebase-admin", "firebase-functions", "sharp", "pdf-lib", "puppeteer-core", "@sparticuz/chromium"]);
const PHOTOS_ROOT="19V2huIiKMWERu0dznsQ8GDVo5b7jGJZE", REPORTS_ROOT="1HGT6nr9gbTNIqeFBPuE6vdNH3Jc3Bfiu";
const ENTRY = `import { initializeApp } from 'firebase-admin/app';\ninitializeApp();\nexport { fieldMobileApi } from './field-mobile/endpoint.js';\n`;

function createBundle(root = ROOT) {
  const destination = path.join(root, ".firebase", "field-mobile-deploy");
  const source = path.join(destination, "functions");
  const modules = path.join(source, "field-mobile");
  fs.mkdirSync(modules, { recursive: true });
  const lock = fs.readFileSync(path.join(root, "functions", "pnpm-lock.yaml"), "utf8");
  const dependencies = Object.fromEntries(DEPENDENCIES.map(name => {
    const version = lock.match(new RegExp(`^      '?${name}'?:\\r?\\n        specifier: [^\\r\\n]+\\r?\\n        version: (\\d+\\.\\d+\\.\\d+)(?:\\([^\\r\\n]*\\))?\\r?$`, "m"))?.[1];
    if (!/^\d+\.\d+\.\d+$/.test(version || "")) throw Error("FIELD_BUNDLE_DEPENDENCY_INVALID");
    return [name, version];
  }));
  // Reject stale or foreign source in the dedicated output; do not delete it.
  const allowed = new Set(["index.js", "package.json", "package-lock.json", ".env.bring-fm", "field-mobile", "node_modules", "shared", "assets"]);
  if (fs.readdirSync(source).some(name => !allowed.has(name)) || fs.readdirSync(modules).some(name => !MODULES.includes(name))) throw Error("FIELD_BUNDLE_UNEXPECTED_FILE");
  for (const name of MODULES) {
    const code = fs.readFileSync(path.join(root, "functions", "lib", "field-mobile", name), "utf8");
    const imports = [...code.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)].map(match => match[1]);
    if (imports.some(specifier => !(["node:crypto","node:module","node:fs/promises","node:path","sharp","pdf-lib","puppeteer-core","@sparticuz/chromium"].includes(specifier) || specifier.startsWith("firebase-admin/") || specifier.startsWith("firebase-functions/") || MODULES.some(file => specifier === `./${file}`)))) throw Error("FIELD_BUNDLE_IMPORT_OUTSIDE_SCOPE");
    fs.writeFileSync(path.join(modules, name), code.replace("../../../desktop-crm/src/work-report-core.js","../shared/work-report-core.cjs").replace("../../../desktop-crm/src/work-report-owner-pdf.js","../shared/work-report-owner-pdf.cjs").replace("../../../desktop-crm/src/work-report-message.js","../shared/work-report-message.cjs").replace("../../assets/NotoSansKR.ttf","../assets/NotoSansKR.ttf").replace(/^\/\/# sourceMappingURL=.*$/gm, ""));
  }
  const shared=path.join(source,"shared");fs.mkdirSync(shared,{recursive:true});
  if(fs.readdirSync(shared).some(name=>!["work-report-core.cjs","work-report-owner-pdf.cjs","work-report-message.cjs","core.cjs"].includes(name)))throw Error("FIELD_BUNDLE_UNEXPECTED_FILE");
  fs.copyFileSync(path.join(root,"desktop-crm/src/work-report-core.js"),path.join(shared,"work-report-core.cjs"));
  fs.copyFileSync(path.join(root,"desktop-crm/src/core.js"),path.join(shared,"core.cjs"));
  const owner=fs.readFileSync(path.join(root,"desktop-crm/src/work-report-owner-pdf.js"),"utf8").replace('require("./core")','require("./core.cjs")').replace('require("./work-report-core")','require("./work-report-core.cjs")');
  fs.writeFileSync(path.join(shared,"work-report-owner-pdf.cjs"),owner);
  fs.writeFileSync(path.join(shared,"work-report-message.cjs"),fs.readFileSync(path.join(root,"desktop-crm/src/work-report-message.js"),"utf8").replace('require("./work-report-core")','require("./work-report-core.cjs")'));
  const assets=path.join(source,'assets');fs.mkdirSync(assets,{recursive:true});
  const fontFiles=['NotoSansKR.ttf','NotoSansKR-OFL.txt'];
  if(fs.readdirSync(assets).some(name=>!fontFiles.includes(name)))throw Error('FIELD_BUNDLE_UNEXPECTED_FILE');
  for(const name of fontFiles)fs.copyFileSync(path.join(root,'functions/assets',name),path.join(assets,name));
  fs.writeFileSync(path.join(source, "index.js"), ENTRY);
  fs.writeFileSync(path.join(source, "package.json"), JSON.stringify({name: "bring-field-mobile-read-api", private: true, version: "0.1.0", type: "module", main: "index.js", engines: {node: "22"}, dependencies}, null, 2) + "\n");
  fs.writeFileSync(path.join(source, ".env.bring-fm"), `FIELD_MOBILE_NATIVE_APP_IDS=${APP_ID}\nFIELD_MOBILE_PHOTOS_ROOT=${PHOTOS_ROOT}\nFIELD_MOBILE_REPORTS_ROOT=${REPORTS_ROOT}\n`);
  const config = { functions: [{source: "functions", codebase: "field-mobile", runtime: "nodejs22", ignore: ["node_modules", "*-debug.log"]}] };
  fs.writeFileSync(path.join(destination, "firebase.json"), JSON.stringify(config, null, 2) + "\n");
  return {project: "bring-fm", selector: "functions:field-mobile:fieldMobileApi", config: path.join(destination, "firebase.json"), source, modules: [...MODULES], nativeAppId: APP_ID};
}
if (require.main === module) console.log(JSON.stringify(createBundle()));
module.exports = {createBundle, MODULES, APP_ID, DEPENDENCIES, PHOTOS_ROOT, REPORTS_ROOT};
