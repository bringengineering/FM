const assert = require("node:assert/strict");
const test = require("node:test");

const Policy = require("../src/valuescope-view-policy");

const page = name => `https://bringengineering.github.io/valuescope/${name}.html`;
const selection = overrides => ({
  sourcePage: "wonju",
  externalId: "11800-1",
  name: "원주 건물",
  address: "강원특별자치도 원주시 북원로 1",
  lat: 37.345,
  lng: 127.925,
  category: "단독주택",
  summary: "실현수익률 3.5%",
  ...overrides,
});

test("allows only the exact four deployed ValueScope pages", () => {
  for (const name of ["wonju", "sales", "valueup", "system"]) {
    assert.equal(Policy.allowedPage(page(name)), true);
    assert.equal(Policy.mapUrlForTab(name), page(name));
  }
  assert.equal(Policy.allowedPage("https://bringengineering.github.io/valuescope/"), false);
  assert.equal(Policy.allowedPage("https://bringengineering.github.io/valuescope/wonju.html?token=x"), false);
  assert.equal(Policy.allowedPage("https://evil.example/valuescope/wonju.html"), false);
  assert.equal(Policy.allowedPage("javascript:alert(1)"), false);
  assert.equal(Policy.mapUrlForTab("unknown"), null);
});

test("accepts only bounded public map selections with exact keys", () => {
  assert.equal(Policy.validSelection(selection()), true);
  assert.equal(Policy.validSelection(selection({ sourcePage: "sales", externalId: "b1", category: "공인중개사" })), true);
  assert.equal(Policy.validSelection(selection({ sourcePage: "valueup", lat: null, lng: null })), true);
  assert.equal(Policy.validSelection(selection({ token: "secret" })), false);
  const inherited = Object.assign(Object.create({ polluted: true }), selection());
  assert.equal(Policy.validSelection(inherited), false);
  assert.equal(Policy.validSelection(selection({ name: "가".repeat(400) })), false);
  assert.equal(Policy.validSelection(selection({ lat: 36.9 })), false);
  assert.equal(Policy.validSelection(selection({ lng: 129.1 })), false);
  assert.equal(Policy.validSelection(selection({ externalId: "__proto__" })), false);
});

test("validates exact ready and selection envelopes", () => {
  assert.deepEqual(Policy.validMapEnvelope({ type: "BRING_VALUESCOPE_READY", version: 1, page: "wonju" }), {
    type: "ready", page: "wonju",
  });
  assert.deepEqual(Policy.validMapEnvelope({ type: "BRING_VALUESCOPE_SELECTION", version: 1, record: selection() }), {
    type: "selection", record: selection(),
  });
  assert.equal(Policy.validMapEnvelope({ type: "BRING_VALUESCOPE_READY", version: 2, page: "wonju" }), null);
  assert.equal(Policy.validMapEnvelope({ type: "BRING_VALUESCOPE_SELECTION", version: 1, record: selection({ password: "x" }) }), null);
  assert.equal(Policy.validMapEnvelope({ type: "BRING_VALUESCOPE_READY", version: 1, page: "wonju", extra: true }), null);
});

test("opens only approved public HTTPS links outside the embedded view", () => {
  assert.equal(Policy.allowedExternalUrl("https://bringengineering.github.io/valuescope/formulas.md"), true);
  assert.equal(Policy.allowedExternalUrl("https://map.naver.com/p/entry/place/1"), true);
  assert.equal(Policy.allowedExternalUrl("https://evil.example/path"), false);
  assert.equal(Policy.allowedExternalUrl("http://map.naver.com/path"), false);
  assert.equal(Policy.allowedExternalUrl("file:///C:/secret.txt"), false);
});
