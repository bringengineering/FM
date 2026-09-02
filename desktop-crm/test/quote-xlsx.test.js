const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const QuoteCore = require("../src/quote-core");
const { createQuoteWorkbook, quoteFileName, quoteSheetXml } = require("../src/quote-xlsx");

function sampleQuote() {
  return QuoteCore.createDraftFromPrompt("햇빛빌라 입주청소 12만원", null, { now: "2026-09-01", idSuffix: "T001", supplier: { businessName: "테스트엔지니어링", representative: "홍길동", registrationNumber: "000-00-00000" } });
}

test("quote workbook is a real XLSX package with formulas and Korean labels", () => {
  const quote = sampleQuote();
  const seal = fs.readFileSync(path.join(__dirname, "../src/assets/bring-company-seal.png"));
  const workbook = createQuoteWorkbook(quote, "2026-09-01T00:00:00Z", seal);
  assert.equal(workbook.readUInt32LE(0), 0x04034b50);
  assert.ok(workbook.length > 4000);
  assert.equal(workbook.includes(seal), true);
  const sheet = quoteSheetXml(quote, { includeSeal: true });
  assert.match(sheet, /견 적 서/);
  assert.match(sheet, /SUM\(G10:G12\)/);
  assert.match(sheet, /햇빛빌라 입주청소/);
  assert.match(sheet, /등록번호/);
  assert.match(sheet, /상호/);
  assert.match(sheet, /대표자/);
  assert.match(sheet, /서창환 \(인\)/);
  assert.match(sheet, /상지대길 83/);
  assert.match(sheet, /010-6566-3603/);
  assert.match(sheet, /033-746-8919/);
  assert.match(sheet, /공급가액/);
  assert.match(sheet, /세액 \(부가세 10%\)/);
  assert.match(sheet, /drawing r:id="rId1"/);
  assert.match(sheet, /000-00-00000/);
  assert.doesNotMatch(sheet, /견적번호/);
  assert.equal(quoteFileName(quote, "xlsx"), "햇빛빌라 입주청소_견적서.xlsx");
});
