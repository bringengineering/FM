const assert = require("node:assert/strict");
const test = require("node:test");

const { FirebaseRemoteClient, normalizeQuoteSupplierRecord } = require("../src/remote");

const supplier = {
  businessName: "테스트 상호",
  representative: "테스트 대표",
  registrationNumber: "123-45-67890",
};

function client(role = "admin") {
  const remote = new FirebaseRemoteClient({
    Core: {},
    fs: {},
    safeStorage: {},
    shell: {},
    sessionFile: "",
    pendingFile: "",
  });
  remote.session = { uid: `quote-${role}`, role, mustChangePassword: false };
  return remote;
}

test("normalizes only the closed fixed supplier schema", () => {
  assert.deepEqual(normalizeQuoteSupplierRecord({
    businessName: `  ${supplier.businessName}  `,
    representative: supplier.representative,
    registrationNumber: supplier.registrationNumber,
  }), supplier);
  assert.throws(() => normalizeQuoteSupplierRecord({ ...supplier, extra: true }), { code: "VALIDATION_ERROR" });
  assert.throws(() => normalizeQuoteSupplierRecord({ ...supplier, businessName: "줄\n바꿈" }), { code: "VALIDATION_ERROR" });
  assert.throws(() => normalizeQuoteSupplierRecord({ ...supplier, representative: "정상처럼\u202e보이는 이름" }), { code: "VALIDATION_ERROR" });
  assert.throws(() => normalizeQuoteSupplierRecord({ ...supplier, registrationNumber: "1234567890" }), { code: "VALIDATION_ERROR" });
  assert.throws(() => normalizeQuoteSupplierRecord({ ...supplier, version: 1 }, { stored: true }), { code: "PROTECTED_DATA_INVALID" });
});

test("loads the company supplier only inside a clean authenticated session", async () => {
  const remote = client("member");
  remote.dbRequest = async (location, options) => {
    assert.equal(location, "quoteSupplier");
    assert.equal(options.method, "GET");
    return { ...supplier, version: 2, updatedAtMs: 100, updatedByAuthUid: "quote-admin" };
  };
  assert.deepEqual(await remote.loadQuoteSupplier(), {
    ...supplier,
    version: 2,
    updatedAtMs: 100,
    updatedByAuthUid: "quote-admin",
  });
  remote.session.mustChangePassword = true;
  await assert.rejects(remote.loadQuoteSupplier(), { code: "ACCESS_DENIED" });
});

test("saves the fixed supplier with admin-only optimistic versioning", async () => {
  const remote = client("admin");
  let put;
  remote.dbReadWithEtag = async location => {
    assert.equal(location, "quoteSupplier");
    return { value: null, etag: '"empty"' };
  };
  remote.dbConditionalPut = async (location, value, etag) => {
    assert.equal(location, "quoteSupplier");
    assert.equal(etag, '"empty"');
    put = value;
    return true;
  };
  remote.dbRequest = async () => ({
    ...supplier,
    version: 1,
    updatedAtMs: 200,
    updatedByAuthUid: "quote-admin",
  });
  const saved = await remote.saveQuoteSupplier(supplier);
  assert.deepEqual(put, {
    ...supplier,
    version: 1,
    updatedAtMs: { ".sv": "timestamp" },
    updatedByAuthUid: "quote-admin",
  });
  assert.equal(saved.version, 1);

  const member = client("member");
  await assert.rejects(member.saveQuoteSupplier(supplier), { code: "ACCESS_DENIED" });
});
