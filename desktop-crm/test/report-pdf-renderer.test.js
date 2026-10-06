"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const {pathToFileURL} = require("node:url");
const Pdf = require("../src/report-pdf-renderer");
const smallHtml = '<!doctype html><html><head><title>예시</title></head><body>보고서</body></html>';

async function fixture(t, phase = "") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bring-pdf-renderer-test-"));
  t.after(async () => { assert.deepEqual(await fs.readdir(root), []); await fs.rmdir(root); });
  const state = {windows: []};
  class Window {
    constructor(options) {
      if (phase === "constructor") throw new Error("private report constructor failure");
      this.options = options; this.events = {}; this.destroyed = false;
      this.webContents = {
        session: {
          setPermissionRequestHandler: handler => {this.permission = handler;},
          setPermissionCheckHandler: handler => {this.permissionCheck = handler;},
          webRequest: {onBeforeRequest: handler => {this.request = handler;}},
        },
        setWindowOpenHandler: handler => {this.popup = handler;},
        on: (name, handler) => {this.events[name] = handler;},
        executeJavaScript: async script => {
          this.readyScript = script;
          if (phase === "images") throw Error("private report photo could not decode");
          if (phase === "timeout") return new Promise(() => {});
        },
        printToPDF: async options => {
          this.printOptions = options;
          if (phase === "print") throw Error("private report print failure");
          return Buffer.from(phase === "invalidPdf" ? "invalid" : "%PDF-1.7\nsynthetic");
        },
      };
      state.windows.push(this);
    }
    async loadFile(file) {
      this.file = file; this.html = await fs.readFile(file, "utf8");
      if (phase === "load") throw Error("ERR_INVALID_URL data:text/html,private report");
    }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; if (phase === "destroy") throw Error("private report destruction error"); }
  }
  return {...state, root, options: {BrowserWindow: Window, tempRoot: root, partitionName: "work-report", timeoutMs: phase === "timeout" ? 20 : 5000}};
}

test("multi-MB reports use a short private file path, retain content, and clean up", async t => {
  const h = await fixture(t);
  const html = smallHtml.replace("보고서", "PHOTO".repeat(700000));
  const bytes = await Pdf.renderReportPdf(html, h.options);
  assert.match(bytes.toString(), /^%PDF-/);
  const w = h.windows[0];
  assert.ok(w.html.length > 3 * 1024 * 1024);
  assert.ok(w.file.length < 1000); assert.equal(path.basename(w.file), "report.html");
  assert.match(w.html, /default-src 'none'; script-src 'none'/);
  assert.match(w.readyScript, /document\.fonts\.ready/);
  assert.match(w.readyScript, /document\.images/);
  assert.equal(w.printOptions.preferCSSPageSize, true);
  assert.equal(w.destroyed, true); assert.deepEqual(await fs.readdir(h.root), []);
});

test("sandbox, deny-all navigation, permissions and external/local resource isolation stay enforced", async t => {
  const h = await fixture(t); await Pdf.renderReportPdf(smallHtml, h.options);
  const w = h.windows[0], prefs = w.options.webPreferences;
  assert.equal(w.options.show, false);
  assert.deepEqual([prefs.nodeIntegration, prefs.contextIsolation, prefs.sandbox, prefs.webSecurity, prefs.webviewTag], [false, true, true, true, false]);
  assert.ok(!prefs.partition.startsWith("persist:"));
  assert.deepEqual(w.popup(), {action: "deny"});
  assert.equal(w.permissionCheck(), false);
  w.permission(null, "camera", granted => assert.equal(granted, false));
  for (const name of ["will-navigate", "will-redirect", "will-attach-webview"]) {
    let prevented = false; w.events[name]({preventDefault: () => {prevented = true;}}); assert.equal(prevented, true);
  }
  const url = pathToFileURL(w.file).href;
  for (const [request, permitted] of [
    [{url, resourceType: "mainFrame"}, true], [{url, resourceType: "subFrame"}, false],
    [{url: `${url}?other`, resourceType: "mainFrame"}, false],
    [{url: "file:///private/local-file.png", resourceType: "image"}, false],
    [{url: "https://example.com/image.png", resourceType: "image"}, false],
    [{url: "http://127.0.0.1/private", resourceType: "xhr"}, false],
    [{url: "data:image/jpeg;base64,AA==", resourceType: "image"}, true],
    [{url: "data:image/svg+xml;base64,AA==", resourceType: "image"}, false],
    [{url: "data:text/javascript,alert(1)", resourceType: "script"}, false],
  ]) w.request(request, result => assert.equal(result.cancel, !permitted));
});

for (const phase of ["constructor", "load", "images", "print", "invalidPdf", "timeout", "destroy"]) {
  test(`failure at ${phase} removes temporary content and never exposes raw errors`, async t => {
    const h = await fixture(t, phase);
    await assert.rejects(Pdf.renderReportPdf(smallHtml, h.options), error => {
      assert.equal(error.code, "REPORT_PDF_FAILED");
      assert.doesNotMatch(error.message, /private|data:|report\.html|ERR_INVALID_URL/); return true;
    });
    assert.ok(h.windows.every(w => w.destroyed)); assert.deepEqual(await fs.readdir(h.root), []);
  });
}

test("temporary write failures clean up and redact paths", async t => {
  const h = await fixture(t);
  await assert.rejects(Pdf.renderReportPdf(smallHtml, {...h.options, io: {...fs, writeFile: async () => {throw Error("private disk path");}}}), {code: "REPORT_PDF_FAILED"});
  assert.equal(h.windows.length, 0); assert.deepEqual(await fs.readdir(h.root), []);
});

test("private file permissions are used and transient Windows cleanup locks are retried", async t => {
  const h = await fixture(t); let attempts = 0;
  const io = {...fs,
    chmod: async (directory, mode) => { assert.equal(mode, 0o700); return fs.chmod(directory, mode); },
    writeFile: async (file, html, options) => {
      assert.equal(options.mode, 0o600); assert.equal(options.flag, "wx"); return fs.writeFile(file, html, options);
    },
    unlink: async file => {
      if (++attempts === 1) throw Object.assign(Error("private path is locked"), {code: "EPERM"});
      return fs.unlink(file);
    },
  };
  await Pdf.renderReportPdf(smallHtml, {...h.options, io}); assert.equal(attempts, 2);
});

test("persistent cleanup failure is reported without revealing the document or path", async t => {
  const h = await fixture(t); let file;
  const io = {...fs, unlink: async value => {file = value; throw Object.assign(Error("private path"), {code: "EIO"});}};
  try {
    await assert.rejects(Pdf.renderReportPdf(smallHtml, {...h.options, io}), error => {
      assert.equal(error.code, "REPORT_PDF_CLEANUP_FAILED"); assert.doesNotMatch(error.message, /private|report\.html|file:/); return true;
    });
  } finally { if (file) { await fs.unlink(file); await fs.rmdir(path.dirname(file)); } }
});

test("concurrent exports have separate documents and nonpersistent sessions", async t => {
  const h = await fixture(t); await Promise.all([Pdf.renderReportPdf(smallHtml, h.options), Pdf.renderReportPdf(smallHtml, h.options)]);
  assert.notEqual(h.windows[0].file, h.windows[1].file);
  assert.notEqual(h.windows[0].options.webPreferences.partition, h.windows[1].options.webPreferences.partition);
});

test("invalid input is rejected before a file or window is created", async t => {
  const h = await fixture(t);
  for (const html of [null, "", "<body>no head</body>"]) await assert.rejects(Pdf.renderReportPdf(html, h.options), {code: "REPORT_PDF_FAILED"});
  await assert.rejects(Pdf.renderReportPdf(smallHtml, {...h.options, partitionName: "persist:crm"}), {code: "REPORT_PDF_FAILED"});
  assert.equal(h.windows.length, 0);
});

test("main-process report exports are wired to the file renderer; quotation path is unchanged", async () => {
  const main = await fs.readFile(require.resolve("../src/main"), "utf8");
  const start = main.indexOf("async function createReportPdfBytes(");
  const body = main.slice(start, main.indexOf("\nasync function ", start + 1));
  assert.doesNotMatch(body, /loadURL|data:text\/html|encodeURIComponent/);
  const context = vm.createContext({ReportPdfRenderer: {renderReportPdf: async (html, options) => ({html, partition: options.partitionName, root: options.tempRoot})}, BrowserWindow: {}, app: {getPath: () => "temporary-root"}});
  vm.runInContext(body, context);
  const actual = await context.createReportPdfBytes("document", "work-report");
  assert.deepEqual({...actual}, {html: "document", partition: "work-report", root: "temporary-root"});
  assert.match(main, /createReportPdfBytes\(documentHtml, "work-report"\)/);
  assert.match(main, /createQuotePdfHtml\(quote, copyType, seal\)/);
});
