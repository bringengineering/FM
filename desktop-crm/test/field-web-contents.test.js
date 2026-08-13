const assert = require("node:assert/strict");
const test = require("node:test");

const {
  fieldBounds,
  isAllowedFieldAuthPopup,
  isAllowedFieldNavigation,
} = require("../src/field-view-policy");

test("allows only the deployed FIELD route", () => {
  assert.equal(isAllowedFieldNavigation("https://bring-fm.web.app/field?embedded=crm"), true);
  assert.equal(isAllowedFieldNavigation("https://bring-fm.web.app/field/capture"), true);
  assert.equal(isAllowedFieldNavigation("https://bring-fm.web.app/other"), false);
  assert.equal(isAllowedFieldNavigation("https://evil.example/field"), false);
  assert.equal(isAllowedFieldNavigation("javascript:alert(1)"), false);
});

test("allows only the company Firebase and Google account pages in the login popup", () => {
  assert.equal(isAllowedFieldAuthPopup("https://bring-fm.firebaseapp.com/__/auth/handler?apiKey=x"), true);
  assert.equal(isAllowedFieldAuthPopup("https://accounts.google.com/v3/signin/accountchooser"), true);
  assert.equal(isAllowedFieldAuthPopup("https://bring-fm-hj.firebaseapp.com/__/auth/handler"), false);
  assert.equal(isAllowedFieldAuthPopup("https://evil.example/__/auth/handler"), false);
  assert.equal(isAllowedFieldAuthPopup("javascript:alert(1)"), false);
});

test("keeps FIELD inside the CRM right workspace", () => {
  assert.deepEqual(fieldBounds({ width: 1518, height: 900 }), {
    x: 232,
    y: 115,
    width: 1286,
    height: 785,
  });
  assert.deepEqual(fieldBounds({ width: 100, height: 50 }), {
    x: 232,
    y: 115,
    width: 0,
    height: 0,
  });
});
