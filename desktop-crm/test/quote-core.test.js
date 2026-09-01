const assert = require("node:assert/strict");
const test = require("node:test");

const QuoteCore = require("../src/quote-core");

test("one-line Korean request becomes a balanced BRING quote draft", () => {
  const quote = QuoteCore.createDraftFromPrompt("햇빛빌라 입주청소 12만원", null, { now: "2026-09-01T00:00:00+09:00", idSuffix: "A102" });
  assert.equal(quote.recipient, "햇빛빌라");
  assert.equal(quote.service, "입주청소");
  assert.equal(quote.totalAmount, 120000);
  assert.equal(quote.items.reduce((sum, item) => sum + QuoteCore.itemTotal(item), 0), 120000);
  assert.equal(Object.hasOwn(quote, "quoteNumber"), false);
  assert.equal(quote.validUntil, "2026-09-15");
});

test("explicit prompt amount overrides and rebalances an AI amount", () => {
  const quote = QuoteCore.createDraftFromPrompt("햇빛빌라 입주청소 12만원", {
    recipient: "햇빛빌라", service: "입주청소", projectName: "햇빛빌라 입주청소", totalAmount: 990000,
    items: [{ name: "기본청소", detail: "전체", quantity: 1, unit: "식", unitPrice: 700000 }, { name: "마감", detail: "마감", quantity: 1, unit: "식", unitPrice: 290000 }]
  }, { now: "2026-09-01", idSuffix: "1" });
  assert.equal(quote.totalAmount, 120000);
  assert.equal(quote.items.reduce((sum, item) => sum + QuoteCore.itemTotal(item), 0), 120000);
});

test("quote parser rejects missing prices and bounds unsafe filenames", () => {
  assert.equal(QuoteCore.parseAmount("공용부청소 35만원"), 350000);
  assert.throws(() => QuoteCore.createDraftFromPrompt("햇빛빌라 입주청소", null), /금액/);
  assert.doesNotMatch(QuoteCore.fileBase({ projectName: "../햇빛:견적*" }), /[\\/:*?"<>|]/);
});

test("supplier fields stay separate and require a formatted registration number", () => {
  const supplier = { businessName: "테스트엔지니어링", representative: "홍길동", registrationNumber: "000-00-00000" };
  const quote = QuoteCore.createDraftFromPrompt("햇빛빌라 입주청소 12만원", null, { supplier });
  assert.deepEqual({
    businessName: quote.company.businessName,
    representative: quote.company.representative,
    registrationNumber: quote.company.registrationNumber
  }, supplier);
  assert.equal(QuoteCore.supplierComplete(quote.company), true);
  assert.throws(() => QuoteCore.normalizeSupplier({ ...supplier, registrationNumber: "0000000000" }), /000-00-00000/);
  assert.equal(QuoteCore.supplierComplete({ businessName: "테스트", representative: "", registrationNumber: "000-00-00000" }), false);
});

test("quote detail items can be added and removed while totals are recalculated", () => {
  const original = QuoteCore.createDraftFromPrompt("햇빛빌라 입주청소 12만원", null, { now: "2026-09-01" });
  const added = QuoteCore.addDraftItem(original);
  assert.equal(added.items.length, original.items.length + 1);
  assert.equal(added.items.at(-1).name, "추가 품목");
  assert.equal(added.totalAmount, original.totalAmount + 1000);

  const removed = QuoteCore.removeDraftItem(added, added.items.length - 1);
  assert.equal(removed.items.length, original.items.length);
  assert.equal(removed.totalAmount, original.totalAmount);
  assert.throws(() => QuoteCore.removeDraftItem({ ...original, items: [original.items[0]] }, 0), /한 개 이상/);
  assert.throws(() => QuoteCore.removeDraftItem(original, 99), /찾지 못했습니다/);
});

test("quote item additions stop at the visible editor limit", () => {
  let quote = QuoteCore.createDraftFromPrompt("햇빛빌라 입주청소 12만원", null, { now: "2026-09-01" });
  while (quote.items.length < QuoteCore.MAX_ITEMS) quote = QuoteCore.addDraftItem(quote);
  assert.equal(quote.items.length, 8);
  assert.throws(() => QuoteCore.addDraftItem(quote), /최대 8개/);
});
