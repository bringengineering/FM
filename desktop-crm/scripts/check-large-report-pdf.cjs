"use strict";
// Runs the actual main-process PDF export/artifact functions in an isolated
// Electron profile using only generated photos. No CRM login or Drive traffic.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const crypto = require("node:crypto");

async function worker() {
  const {app, BrowserWindow, nativeImage} = require("electron");
  const root = process.argv.find(value => value.startsWith("--qa-root="))?.slice(10);
  const output = process.argv.find(value => value.startsWith("--qa-output="))?.slice(12);
  assert.equal(path.dirname(root), os.tmpdir());
  assert.ok(path.basename(root).startsWith("bring-large-pdf-check-"));
  app.setPath("userData", path.join(root, "profile"));
  app.on("window-all-closed", () => {});
  try {
    await app.whenReady(); await fs.mkdir(output, {recursive: true});
    const tempRoot = path.join(root, "render"); await fs.mkdir(tempRoot);
    const Pdf = require("../src/report-pdf-renderer");
    const R = require("../src/work-report-core");
    const Layout = require("../src/work-report-pdf");
    const photos = new Map();
    for (let index = 0; index < 24; index++) {
      const bitmap = Buffer.alloc(720 * 480 * 4); let seed = 4321 + index;
      for (let pixel = 0; pixel < bitmap.length; pixel += 4) {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        bitmap[pixel] = seed & 255; bitmap[pixel + 1] = (seed >>> 8) & 255;
        bitmap[pixel + 2] = (seed >>> 16) & 255; bitmap[pixel + 3] = 255;
      }
      photos.set(`qa_photo_${index}`, nativeImage.createFromBitmap(bitmap, {width: 720, height: 480}).toJPEG(80));
    }
    const report = R.normalizeReport({id: "qa_large_report", kind: "common", buildingId: "qa_building", buildingName: "예시 건물", workDate: "2026-10-06", workerName: "예시 담당자", ownerName: "예시 건물주", area: "공용부", summary: "사진 24장의 PDF 저장 동작을 확인하기 위한 합성 보고서입니다.", followUp: "검증용 사진으로 실제 고객 자료가 아닙니다."});
    report.items[0].during = [...photos.keys()].map(id => ({id, driveFileId: id, caption: "합성 검증 사진"}));
    const company = {businessName: "브링케어", representative: "예시 대표"};
    const images = Object.fromEntries([...photos].map(([id, bytes]) => [id, `data:image/jpeg;base64,${bytes.toString("base64")}`]));
    const html = Layout.createWorkReportHtml(report, "owner", {company, images});
    const oldUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    assert.ok(oldUrl.length > 2 * 1024 * 1024);
    const oldWindow = new BrowserWindow({show: false, webPreferences: {sandbox: true, nodeIntegration: false, contextIsolation: true, partition: `old-pdf-qa-${crypto.randomUUID()}`}});
    let reproduced = false;
    try { await oldWindow.loadURL(oldUrl); }
    catch (error) { reproduced = error.code === "ERR_INVALID_URL" || error.errno === -300; }
    finally { oldWindow.destroy(); }
    assert.equal(reproduced, true, "The old transport must reproduce ERR_INVALID_URL");
    const printed = [];
    function ObservedWindow(options) {
      const window = new BrowserWindow(options), print = window.webContents.printToPDF.bind(window.webContents);
      window.webContents.printToPDF = async settings => {
        const loaded = await window.webContents.executeJavaScript("({count: document.images.length, ready: Array.from(document.images).every(i => i.complete && i.naturalWidth > 0), seals: document.querySelectorAll('footer img').length})");
        assert.deepEqual(loaded, {count: 24, ready: true, seals: 0});
        assert.ok(window.webContents.getURL().startsWith("file:"));
        printed.push(loaded);
        return print(settings);
      };
      return window;
    }
    const source = await fs.readFile(require.resolve("../src/main"), "utf8");
    const context = vm.createContext({Buffer, fs, path, crypto, nativeImage, BrowserWindow: ObservedWindow,
      app: {getPath: () => tempRoot}, ReportPdfRenderer: Pdf, WorkReportCore: R, ...Layout,
      savedDocumentSession: () => ({check() {}}), authState: () => ({user: {role: "admin"}}), isMarketingOnlySession: () => false,
      driveSessionView: () => ({connected: true}), driveApiDeps: () => ({}),
      BuildingDocsDrive: {downloadFile: async (_deps, input) => ({content: photos.get(input.fileId), mimeType: "image/jpeg", name: "synthetic.jpg"})},
      HeicJpegConverter: {looksLikeHeic: () => false},
      dialog: {showSaveDialog: async () => ({filePath: path.join(output, "owner.pdf")})}, mainWindow: null,
      readLocalQuoteSeal: () => {throw Error("Reports must never read seals");},
    });
    for (const name of ["createReportPdfBytes", "workReportPdfJpeg", "createWorkReportPdfArtifact", "exportWorkReport"]) {
      const start = source.indexOf(`${name === "workReportPdfJpeg" ? "" : "async "}function ${name}(`);
      const end = source.indexOf("\nasync function ", start + 1);
      assert.ok(start >= 0 && end > start); vm.runInContext(source.slice(start, end), context);
    }
    const exported = await context.exportWorkReport({report, company, copyType: "owner", strictPhotos: true});
    assert.equal(exported.ok, true); assert.equal(exported.photos, 24); assert.equal(exported.photoFailures, 0);
    const artifact = await context.createWorkReportPdfArtifact({report, company}, "program");
    assert.equal(artifact.ok, true); assert.equal(artifact.photos, 24); assert.equal(artifact.photoFailures, 0);
    await fs.writeFile(path.join(output, "program.pdf"), artifact.bytes);
    assert.equal(printed.length, 2); assert.deepEqual(await fs.readdir(tempRoot), []);
    await assert.rejects(Pdf.renderReportPdf('<html><head></head><body><img src="data:image/jpeg;base64,AAAA"></body></html>', {BrowserWindow, partitionName: "work-report", tempRoot}), error => error.code === "REPORT_PDF_FAILED" && !/data:|file:|report\.html/.test(error.message));
    assert.deepEqual(await fs.readdir(tempRoot), []);
    const result = {ok: true, electron: process.versions.electron, reproducedOldError: "ERR_INVALID_URL", oldUrlBytes: oldUrl.length, photosPerPdf: 24, export: exported.ok, archiveArtifact: artifact.ok, temporaryFilesRemoved: true, brokenImageFailsSafely: true};
    await fs.writeFile(path.join(root, "result.json"), JSON.stringify(result)); app.exit(0);
  } catch (error) {
    await fs.writeFile(path.join(root, "result.json"), JSON.stringify({ok: false, message: String(error.message).slice(0, 500)})); app.exit(1);
  }
}

async function driver() {
  const {spawn} = require("node:child_process");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bring-large-pdf-check-"));
  const output = path.resolve(process.argv[2] || "tmp/pdfs/large-report");
  const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
  try {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(require("electron"), [__filename, `--qa-root=${root}`, `--qa-output=${output}`], {env, windowsHide: true, stdio: "ignore"});
      const timer = setTimeout(() => {child.kill(); reject(Error("Electron PDF check timed out"));}, 180000);
      child.once("error", error => {clearTimeout(timer); reject(error);});
      child.once("exit", code => {clearTimeout(timer); resolve(code);});
    });
    const result = JSON.parse(await fs.readFile(path.join(root, "result.json"), "utf8"));
    console.log(JSON.stringify(result)); assert.equal(code, 0); assert.equal(result.ok, true);
  } finally {
    // The only recursive cleanup target is the exact freshly created QA profile.
    assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith("bring-large-pdf-check-"));
    await fs.rm(root, {recursive: true, force: true, maxRetries: 4, retryDelay: 200});
  }
}
if (process.versions.electron) worker().catch(() => require("electron").app.exit(1));
else driver().catch(error => {console.error(error.message); process.exitCode = 1;});
