const assert = require("node:assert/strict");
const test = require("node:test");

const QuoteCore = require("../src/quote-core");
const { createQuoteWorkbook, ocrDataSheetXml, quoteFileName, quoteSheetXml } = require("../src/quote-xlsx");

function sampleQuote() {
  const draft = QuoteCore.createDraftFromPrompt("햇빛빌라 입주청소 12만원", null, { now: "2026-09-01", idSuffix: "T001", supplier: { businessName: "테스트엔지니어링", representative: "홍길동", registrationNumber: "000-00-00000" } });
  return QuoteCore.normalizeDraft({ ...draft, recipient: "김고객", recipientPhone: "010-1234-5678", siteAddress: "강원특별자치도 원주시 이화3길 28-5" });
}

test("recipient and supplier copies are real XLSX packages with matching labels and formulas", () => {
  const quote = sampleQuote();
  const seal = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const recipientWorkbook = createQuoteWorkbook(quote, "recipient", "2026-09-01T00:00:00Z", seal);
  const supplierWorkbook = createQuoteWorkbook(quote, "supplier", "2026-09-01T00:00:00Z", seal);
  assert.equal(recipientWorkbook.readUInt32LE(0), 0x04034b50);
  assert.equal(supplierWorkbook.readUInt32LE(0), 0x04034b50);
  assert.ok(recipientWorkbook.length > 4000);
  assert.ok(supplierWorkbook.length > 4000);
  assert.match(recipientWorkbook.toString("utf8"), /OCR_DATA/);
  assert.match(recipientWorkbook.toString("utf8"), /quote-seal\.png/);
  assert.match(recipientWorkbook.toString("utf8"), /공급자 인감/);
  assert.equal((recipientWorkbook.toString("utf8").match(/<xdr:oneCellAnchor>/g) || []).length, 2);
  assert.match(recipientWorkbook.toString("utf8"), /공급자 확인 인감/);
  const sheet = quoteSheetXml(quote, "recipient", true);
  assert.match(sheet, />견적명</);
  assert.match(sheet, /BRING ENGINEERING/);
  assert.doesNotMatch(sheet, /OCR 표준형/);
  assert.doesNotMatch(sheet, /사본 구분/);
  assert.doesNotMatch(sheet, /공급받는자용 견적서/);
  assert.match(sheet, /ROUND\(G13\*I13\/1\.1,0\)/);
  assert.match(sheet, /SUM\(J13:J22\)/);
  assert.match(sheet, /SUM\(L13:L22\)/);
  assert.match(sheet, /햇빛빌라 입주청소/);
  assert.match(sheet, /성명/);
  assert.match(sheet, /전화번호/);
  assert.match(sheet, /010-1234-5678/);
  assert.match(sheet, /발행일/);
  assert.match(sheet, /유효일/);
  assert.match(sheet, /현장 주소/);
  assert.match(sheet, /강원특별자치도 원주시 이화3길 28-5/);
  assert.match(sheet, /사업자등록번호/);
  assert.match(sheet, /000-00-00000/);
  assert.match(sheet, /홍 길 동/);
  assert.match(sheet, /공급자 확인  홍 길 동/);
  assert.match(sheet, /소재지/);
  assert.match(sheet, /강원특별자치도 원주시 상지대길 83/);
  assert.match(sheet, /업태/);
  assert.match(sheet, /전문, 과학 및 기술서비스업 \/ 서비스업/);
  assert.match(sheet, /업종/);
  assert.match(sheet, /기타 공학 연구개발업 \/ 건축물 일반 청소업/);
  assert.match(sheet, /<drawing r:id="rId1"\/>/);
  assert.doesNotMatch(sheet, /㊞/);
  assert.equal(quoteSheetXml(quote, "supplier", true), sheet);
  const ocr = ocrDataSheetXml(quote, "recipient");
  for (const key of ["DOCUMENT_TYPE", "RECIPIENT_NAME", "RECIPIENT_PHONE", "SITE_ADDRESS", "SUPPLIER_NAME", "SUPPLIER_REPRESENTATIVE", "SUPPLIER_BUSINESS_NUMBER", "SUPPLIER_ADDRESS", "SUPPLIER_BUSINESS_TYPE", "SUPPLIER_BUSINESS_CATEGORY", "PROJECT_NAME", "ISSUE_DATE", "VALID_UNTIL", "SUPPLY_AMOUNT", "TAX_AMOUNT", "TOTAL_AMOUNT", "ITEM_NAME", "LINE_TOTAL"]) assert.match(ocr, new RegExp(key));
  assert.doesNotMatch(ocr, /COPY_TYPE/);
  assert.match(ocr, />홍길동</);
  assert.doesNotMatch(ocr, />홍 길 동</);
  assert.match(ocr, /&apos;공급받는자용 견적서&apos;!J23/);
  assert.match(recipientWorkbook.toString("utf8"), /FF1454D8/);
  assert.match(supplierWorkbook.toString("utf8"), /FFE25A67/);
  assert.match(supplierWorkbook.toString("utf8"), /FFFFF2F3/);
  assert.equal(quoteFileName(quote, "recipient"), "햇빛빌라 입주청소_공급받는자용 견적서.xlsx");
  assert.equal(quoteFileName(quote, "supplier"), "햇빛빌라 입주청소_공급자 보관용 견적서.xlsx");
});
