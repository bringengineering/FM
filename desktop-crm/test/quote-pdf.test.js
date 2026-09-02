const assert = require("node:assert/strict");
const test = require("node:test");

const QuoteCore = require("../src/quote-core");
const { createQuotePdf, pngBufferDataUrl, quotePrintHtml } = require("../src/quote-pdf");

const seal = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";

function sampleQuote() {
  return QuoteCore.createDraftFromPrompt("햇빛빌라 입주청소 12만원", null, {
    now: "2026-09-02",
    supplier: { businessName: "저장 상호", representative: "저장 대표", registrationNumber: "111-22-33333" }
  });
}

test("PDF document contains the fixed supplier, seal, and separate supply and tax amounts", () => {
  const document = quotePrintHtml(sampleQuote(), seal);
  assert.match(document, /브링엔지니어링/);
  assert.match(document, /서창환/);
  assert.match(document, /111-22-33333/);
  assert.match(document, /상지대길 83/);
  assert.match(document, /010-6566-3603/);
  assert.match(document, /033-746-8919/);
  assert.match(document, /class="seal"/);
  assert.match(document, /공급가액/);
  assert.match(document, /세액 \(부가세 10%\)/);
  assert.match(document, /109,091원/);
  assert.match(document, /10,909원/);
  assert.doesNotMatch(document, /748-28-01935/);
});

test("PDF document escapes quotation text and rejects non-PNG seal URLs", () => {
  const quote = sampleQuote();
  quote.projectName = "<script>alert(1)</script>";
  const document = quotePrintHtml(quote, seal);
  assert.doesNotMatch(document, /<script>alert/);
  assert.match(document, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.throws(() => quotePrintHtml(quote, "https://example.com/seal.png"), /인감/);
});

test("PDF generation uses a sandboxed hidden Electron window", async () => {
  let options;
  let destroyed = false;
  let openedPolicy;
  class FakeBrowserWindow {
    constructor(input) {
      options = input;
      this.webContents = {
        setWindowOpenHandler: handler => { openedPolicy = handler(); },
        printToPDF: async () => Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(1200)])
      };
    }
    async loadURL(value) { this.url = value; }
    isDestroyed() { return destroyed; }
    destroy() { destroyed = true; }
  }
  const pdf = await createQuotePdf(FakeBrowserWindow, sampleQuote(), seal);
  assert.equal(Buffer.from(pdf.base64, "base64").subarray(0, 5).toString("ascii"), "%PDF-");
  assert.equal(pdf.byteLength, 1209);
  assert.equal(options.show, false);
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.sandbox, true);
  assert.equal(options.webPreferences.javascript, false);
  assert.deepEqual(openedPolicy, { action: "deny" });
  assert.equal(destroyed, true);
});

test("seal buffer conversion validates PNG signature and bounds", () => {
  const bytes = Buffer.from("89504e470d0a1a0a01020304", "hex");
  assert.match(pngBufferDataUrl(bytes), /^data:image\/png;base64,/);
  assert.throws(() => pngBufferDataUrl(Buffer.from("not png")), /PNG/);
});
