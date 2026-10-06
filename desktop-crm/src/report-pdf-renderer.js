"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const {pathToFileURL} = require("node:url");

// Photos stay embedded, but the document itself must not become a multi-MB URL.
// Keep this renderer isolated from CRM sessions and all other local files.
const MAX_HTML_BYTES = 160 * 1024 * 1024;
const PDF_TIMEOUT_MS = 120000;
const POLICY = "default-src 'none'; script-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; connect-src 'none'";
const READY_SCRIPT = `Promise.all([
  document.fonts.ready,
  ...Array.from(document.images, image => new Promise((resolve, reject) => {
    const loaded = () => image.naturalWidth > 0 ? resolve() : reject(new Error('IMAGE_FAILED'));
    if (image.complete) return loaded();
    image.addEventListener('load', loaded, {once: true});
    image.addEventListener('error', () => reject(new Error('IMAGE_FAILED')), {once: true});
  }))
]).then(() => true)`;

function failure(code = "REPORT_PDF_FAILED") {
  const message = code === "REPORT_PDF_CLEANUP_FAILED"
    ? "PDF 임시 자료를 정리하지 못했습니다. CRM을 다시 시작한 뒤 재시도해 주세요."
    : "보고서 PDF를 만들지 못했습니다. 사진과 내용을 확인한 뒤 다시 시도해 주세요.";
  return Object.assign(new Error(message), {code});
}

function allowedRequest(details, documentUrl) {
  return (details.resourceType === "mainFrame" && details.url === documentUrl)
    || (details.resourceType === "image" && /^data:image\/(?:jpeg|png|webp|gif);base64,/i.test(details.url));
}

async function removeTemporaryDocument(io, directory, filePath) {
  // Delete only the exact file and its empty mkdtemp directory, never recursively.
  for (const target of [filePath, directory]) {
    for (let attempt = 0; ; attempt++) {
      try {
        if (target === filePath) await io.unlink(target);
        else await io.rmdir(target);
        break;
      } catch (error) {
        if (error.code === "ENOENT") break;
        if (!["EBUSY", "EPERM", "EACCES"].includes(error.code) || attempt >= 3) throw failure("REPORT_PDF_CLEANUP_FAILED");
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }
}

async function renderReportPdf(documentHtml, options) {
  const {BrowserWindow, partitionName, tempRoot = os.tmpdir(), io = fs, timeoutMs = PDF_TIMEOUT_MS} = options;
  if (typeof documentHtml !== "string" || !documentHtml.trim()
    || Buffer.byteLength(documentHtml, "utf8") > MAX_HTML_BYTES
    || !/<head(?:\s[^>]*)?>/i.test(documentHtml)
    || !/^[a-z][a-z0-9-]{0,40}$/.test(partitionName)) throw failure();
  const protectedHtml = documentHtml.replace(/<head(?:\s[^>]*)?>/i,
    head => `${head}<meta http-equiv="Content-Security-Policy" content="${POLICY}">`);
  let directory, filePath, pdfWindow, timer;
  try {
    directory = await io.mkdtemp(path.join(tempRoot, "bring-report-pdf-"));
    await io.chmod(directory, 0o700);
    filePath = path.join(directory, "report.html");
    await io.writeFile(filePath, protectedHtml, {encoding: "utf8", mode: 0o600, flag: "wx"});
    const documentUrl = pathToFileURL(filePath).href;
    pdfWindow = new BrowserWindow({
      show: false, width: 1000, height: 1400, autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true, nodeIntegration: false, sandbox: true,
        webSecurity: true, webviewTag: false,
        partition: `${partitionName}-${crypto.randomUUID()}`,
      },
    });
    const contents = pdfWindow.webContents;
    contents.setWindowOpenHandler(() => ({action: "deny"}));
    for (const event of ["will-attach-webview", "will-navigate", "will-redirect"]) {
      contents.on(event, event => event.preventDefault());
    }
    contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    contents.session.setPermissionCheckHandler(() => false);
    contents.session.webRequest.onBeforeRequest((details, callback) => callback({cancel: !allowedRequest(details, documentUrl)}));
    const render = async () => {
      await pdfWindow.loadFile(filePath);
      await contents.executeJavaScript(READY_SCRIPT, true);
      const bytes = await contents.printToPDF({
        landscape: false, pageSize: "A4", printBackground: true, preferCSSPageSize: true,
        margins: {top: 0, bottom: 0, left: 0, right: 0},
      });
      if (!Buffer.isBuffer(bytes) || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw failure();
      return bytes;
    };
    return await Promise.race([
      render(),
      new Promise((_resolve, reject) => { timer = setTimeout(() => reject(failure()), timeoutMs); }),
    ]);
  } catch (_error) {
    // Electron load errors can contain the entire report, photo bytes or a path.
    // Never forward the original exception through IPC or put it in logs.
    throw failure();
  } finally {
    clearTimeout(timer);
    let destroyFailed = false;
    try {
      if (pdfWindow && !pdfWindow.isDestroyed()) pdfWindow.destroy();
    } catch (_error) {
      destroyFailed = true;
    } finally {
      if (directory) await removeTemporaryDocument(io, directory, filePath || path.join(directory, "report.html"));
    }
    if (destroyFailed) throw failure();
  }
}

module.exports = {renderReportPdf, allowedRequest, MAX_HTML_BYTES, PDF_TIMEOUT_MS};
