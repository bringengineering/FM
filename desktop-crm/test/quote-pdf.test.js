"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const QuoteCore = require("../src/quote-core");
const { createQuotePdfHtml, quotePdfFileName } = require("../src/quote-pdf");

function sampleQuote() {
  const draft = QuoteCore.createDraftFromPrompt("햇빛빌라 입주청소 12만원", null, {
    now: "2026-09-03",
    idSuffix: "PDF1",
    supplier: { businessName: "브링엔지니어링", representative: "서창환", registrationNumber: "748-28-01935" }
  });
  return QuoteCore.normalizeDraft({ ...draft, recipient: "홍길동", recipientPhone: "010-1234-5678" });
}

const seal = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

test("quote PDF HTML keeps both copies identical except for their requested colors", () => {
  const quote = sampleQuote();
  const recipient = createQuotePdfHtml(quote, "recipient", seal);
  const supplier = createQuotePdfHtml(quote, "supplier", seal);
  assert.match(recipient, /#1454D8/);
  assert.match(recipient, /#EFF4FF/);
  assert.match(supplier, /#E25A67/);
  assert.match(supplier, /#FFF2F3/);
  assert.equal(recipient.slice(recipient.indexOf("<body>")), supplier.slice(supplier.indexOf("<body>")));
  assert.match(recipient, /견 적 서/);
  assert.match(recipient, /서 창 환/);
  assert.match(recipient, /공급자 확인/);
  assert.equal((recipient.match(/data:image\/png;base64/g) || []).length, 2);
  assert.match(recipient, /Content-Security-Policy/);
  assert.doesNotMatch(recipient, /https?:\/\//);
  assert.equal(quotePdfFileName(quote, "recipient"), "햇빛빌라 입주청소_공급받는자용 견적서.pdf");
  assert.equal(quotePdfFileName(quote, "supplier"), "햇빛빌라 입주청소_공급자 보관용 견적서.pdf");
});

test("quote PDF HTML escapes untrusted recipient text", () => {
  const quote = QuoteCore.normalizeDraft({ ...sampleQuote(), recipient: "<img src=x onerror=alert(1)>" });
  const document = createQuotePdfHtml(quote, "recipient", seal);
  assert.doesNotMatch(document, /<img src=x onerror/);
  assert.match(document, /&lt;img src=x onerror=alert\(1\)&gt;/);
});
