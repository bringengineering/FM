const test = require("node:test");
const assert = require("node:assert/strict");

const Core = require("../src/core");

test("allows bare 13-digit place IDs in intended http(s) vendor URLs", () => {
  const examples = [
    "https://pcmap.place.naver.com/place/9001011234567/home",
    "https://maps.example.com/vendor/0002293234567/details",
    "http://example.test/search?placeId=0501014123456&view=map",
    "HTTPS://EXAMPLE.TEST/map/９００１０１１２３４５６７",
  ];

  examples.forEach(value => assert.equal(Core.prohibitedSecretType(value), "", value));
  const vendor = {
    vendor: "테스트 업체",
    quoteUrl: examples[0],
    phone: "010-1234-5678",
  };
  assert.deepEqual(Core.findProhibitedSecrets(vendor), []);
  assert.doesNotThrow(() => Core.assertNoProhibitedSecrets(vendor));
});

test("still blocks plausible Korean resident registration numbers outside URL ID context", () => {
  const examples = [
    "9001011234567",
    "900101-1234567",
    "900101 1234567",
    "900101 - 1234567",
    "900101/1234567",
    "900101-1 234567",
    "900101 1 234567",
    "000229-3234567",
    "900101-5234567",
    "９００１０１－１２３４５６７",
    "https://example.test/profile/900101-1234567",
    "https://9001011234567@example.test/profile",
    "https://9001011234567.example.test/profile",
    "https://example.test/profile#9001011234567",
  ];

  examples.forEach(value => assert.equal(Core.prohibitedSecretType(value), "resident-registration-number", value));
});

test("explicit resident-registration context defeats the URL-ID exception", () => {
  const examples = [
    "주민등록번호: 9001011234567",
    "주민 등록 번호 900101 1234567",
    "RRN=9001011234567",
    "resident registration number is 900101-1234567",
    "https://example.test/check?rrn=9001011234567",
    "주민등록번호: 991332-1234567",
    "주민\u200b등록번호: 9001011234567",
  ];

  examples.forEach(value => assert.equal(Core.prohibitedSecretType(value), "resident-registration-number", value));
});

test("date validation rejects impossible birth dates without treating arbitrary IDs as RRNs", () => {
  const examples = [
    "9913321234567",
    "991332-1234567",
    "0002303234567",
    "https://example.test/place/9913321234567",
    "123-45-67890",
    "unit_1234567123456",
  ];

  examples.forEach(value => assert.equal(Core.prohibitedSecretType(value), "", value));

  "1256".split("").forEach(classifier => {
    const value = `000229${classifier}234567`;
    assert.equal(Core.prohibitedSecretType(value), "", `${value} maps to the non-leap year 1900`);
  });
  "3478".split("").forEach(classifier => {
    const value = `000229${classifier}234567`;
    assert.equal(Core.prohibitedSecretType(value), "resident-registration-number", `${value} maps to the leap year 2000`);
  });
});

test("credential detection and assertion metadata remain enforced", () => {
  assert.equal(Core.prohibitedSecretType("비밀번호: aB12!"), "credential");
  assert.equal(Core.prohibitedSecretType("비밀\u200b번호: aB12!"), "credential");
  assert.equal(Core.prohibitedSecretType("https://example.test/?password=aB12!"), "credential");
  assert.deepEqual(Core.findProhibitedSecrets({ password: "aB12!" }), [{ path: "password", type: "credential" }]);

  assert.throws(
    () => Core.assertNoProhibitedSecrets({ quoteUrl: "https://example.test/place/9001011234567", memo: "비밀번호: aB12!" }),
    error => error.code === "PROHIBITED_SENSITIVE_VALUE" && error.path === "memo" && error.secretType === "credential",
  );
});
