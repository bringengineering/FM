const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const Docs = require("../src/saved-customer-documents");
const Pdf = require("../src/saved-customer-document-pdf");
const Core = require("../src/core");
const Policy = require("../src/mutation-policy");
globalThis.BringMessagePolicy = require("../src/message-policy");
const UI = require("../src/customer-alimtalk-ui");
const bytes = Buffer.from("%PDF-1.7\nfixture");
const customer = {id: "customer_a", name: "샘플 고객", phone: "010-0000-0000"};
const checked = Pdf.verifyPdf(bytes);
function record(extra = {}) {
  return {id: "saved_a", title: "샘플 견적서", driveFileId: "drive_pdf_a", updatedAt: "2026-10-02T00:00:00.000Z",
    savedCustomerDocument: {version: 1, kind: "quote", customerId: customer.id, recipientPhone: Docs.phone(customer.phone), sha256: checked.sha256, size: checked.size, month: ""}, ...extra};
}
function request(row = record()) {
  return {kind: row.savedCustomerDocument.kind, documentId: row.id, customerId: customer.id, updatedAt: row.updatedAt, sha256: row.savedCustomerDocument.sha256};
}
test("저장본 목록은 고객 ID·현재 연락처·종류를 확인하고 삭제·변경 기록을 차단한다", () => {
  const rows = [record(), record({id: "archived", archivedAt: "2026-10-02"}), record({id: "deleted", deleted: true})];
  assert.deepEqual(Docs.list(rows, customer, "quote").map(row => row.id), ["saved_a"]);
  assert.equal(Docs.list(rows, {...customer, phone: "01011111111"}, "quote").length, 0);
  assert.equal(Docs.list(rows, {...customer, id: "another"}, "quote").length, 0);
  assert.equal(Docs.list(rows, {...customer, deletedAt: "now"}, "quote").length, 0);
  assert.equal(Docs.list(rows, customer, "buildingMonthlyReport").length, 0);
  assert.equal(Docs.resolve(rows, [customer], request()).record.id, "saved_a");
  assert.throws(() => Docs.resolve(rows, [customer], {...request(), sha256: "f".repeat(64)}), /변경/);
  assert.throws(() => Docs.resolve(rows, [customer], {...request(), updatedAt: ""}), /변경/);
});
test("비정상 종류·경로·크기·보고월은 저장 메타데이터로 인정하지 않는다", () => {
  for (const kind of ["toString", "__proto__", "other"]) assert.equal(Docs.normalize(record({savedCustomerDocument: {...record().savedCustomerDocument, kind}})), null);
  for (const size of [0, Infinity, 1.5, Pdf.MAX_BYTES + 1]) assert.equal(Docs.normalize(record({savedCustomerDocument: {...record().savedCustomerDocument, size}})), null);
  assert.equal(Docs.normalize(record({driveFileId: "../../secret"})), null);
  assert.equal(Docs.normalize(record({updatedAt: "invalid"})), null);
  assert.equal(Docs.normalize(record({savedCustomerDocument: {...record().savedCustomerDocument, kind: "buildingMonthlyReport", month: "2026-99"}})), null);
  const data = Core.blankStore();
  data.buildingDocuments = [record()];
  assert.equal(Core.sanitizeSharedStore(data).buildingDocuments[0].savedCustomerDocument.sha256, checked.sha256);
});
test("PDF 다운로드는 고정 Google HTTPS 주소·리다이렉트 차단·해시·MIME·실제 크기를 검증한다", async () => {
  let options, url;
  const fetch = async (value, init) => {url = value; options = init; return new Response(bytes, {headers: {"content-type": "application/pdf"}});};
  assert.deepEqual(await Pdf.download(fetch, "drive_pdf_a", checked), bytes);
  assert.equal(new URL(url).hostname, "www.googleapis.com");
  assert.equal(options.redirect, "error");
  assert.ok(options.signal);
  await assert.rejects(Pdf.download(fetch, "https://localhost/private", checked));
  await assert.rejects(Pdf.download(async () => new Response("html", {headers: {"content-type": "text/html"}}), "drive_pdf_a", checked));
  await assert.rejects(Pdf.download(fetch, "drive_pdf_a", {...checked, sha256: "0".repeat(64)}), /변경/);
  await assert.rejects(Pdf.download(async () => new Response(bytes, {headers: {"content-type": "application/pdf", "content-length": String(Pdf.MAX_BYTES + 1)}}), "drive_pdf_a", checked), /크기/);
  await assert.rejects(Pdf.download(async () => new Response(Buffer.alloc(Pdf.MAX_BYTES + 1), {headers: {"content-type": "application/pdf"}}), "drive_pdf_a", checked), /크기/);
  assert.throws(() => Pdf.verifyPdf(Buffer.from("<html>")), /형식/);
});
test("견적·월간 UI는 현재 초안 대신 명시적으로 고른 저장본만 발송하며 제목을 이스케이프한다", () => {
  for (const kind of ["quote", "buildingMonthlyReport"]) {
    const row = record({title: "<script>안전</script>"});
    const props = {customers: [customer], selectedCustomerIds: [customer.id], category: kind, writable: true, adminCanSend: true, kakaoReady: true, kakaoMonthlyReady: true, quoteReady: true, monthlyReportReady: true};
    assert.match(UI.render(props), /data-alimtalk-send[^>]*disabled/);
    assert.match(UI.render({...props, savedDocuments: [row]}), /data-alimtalk-send[^>]*disabled/);
    const html = UI.render({...props, savedDocuments: [row], savedDocumentId: row.id});
    assert.match(html, /data-alimtalk-send[^>]*>알림톡 보내기/);
    assert.match(html, /data-alimtalk-preview/);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>/);
  }
});
const mainSource = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
const service = mainSource.slice(mainSource.indexOf("function savedDocumentSession("), mainSource.indexOf("async function sendQuoteToCustomerByKakao("));
function harness(options = {}) {
  const events = [];
  const data = {customers: [customer], company: {buildingDocsFolderId: "root_folder"}, buildingDocuments: [record()], buildings: [], partnerVendors: []};
  let active = true;
  const state = {user: {uid: "user_a", role: options.role || "admin"}};
  const context = {Buffer, crypto, Object, Date, String, Error, SavedCustomerDocuments: Docs, SavedCustomerDocumentPdf: Pdf,
    authState: () => state, isMarketingOnlySession: () => Boolean(options.marketing),
    assertMainMutationAllowed: () => {if (!["member","admin"].includes(state.user?.role)) throw Error("denied");},
    remoteClient: {captureSessionGuard: () => 1, assertSessionGuardActive: () => {if (!active) throw Error("session changed");},
      loadStore: async () => data, loadWorkReports: async () => ({reports: options.reports || []}),
      saveStoreNow: async value => {events.push(["persist", value]); return {ok: true};}},
    QuoteCore: {normalizeDraft: value => value, normalizeSupplier: () => {}, normalizeRecipient: () => {}},
    readLocalQuoteSeal: async () => "fixture", createQuotePdfBytes: async () => bytes,
    BuildingDocsDrive: {uploadDocument: async (_deps, input) => {events.push(["upload", input]); return {id: "uploaded_pdf"};}},
    driveApiDeps: () => ({}),
    authenticatedDriveFetch: async () => {if (options.changeSession) active = false; return new Response(bytes, {headers: {"content-type": "application/pdf"}});},
    runDocumentDelivery: async (action, input) => {
      events.push([action, input]);
      if (action === "capabilities") return {ok: true, capabilities: {kakao: true, monthlyReport: true}};
      if (action === "create") return {ok: true, documentId: "delivery_fixture"};
      if (action === "send") return {ok: !options.sendFailure};
      return {ok: true};
    },
    createWorkReportPdfArtifact: async ({report}) => ({ok: true, bytes, photos: options.photoFailure ? 0 : report.items.reduce((n, item) => n + item.before.length + item.after.length, 0)}),
  };
  vm.createContext(context); vm.runInContext(service, context);
  return {context, data, events, state};
}
test("메인 저장은 수신자 PDF만 비공개 회사 Drive에 보관하고 실제 성공 후 CRM 메타데이터를 기록한다", async () => {
  const h = harness({role: "member"});
  const result = await h.context.saveCustomerDocument({kind: "quote", quote: {projectName: "샘플", recipient: customer.name, recipientPhone: customer.phone, company: {}}});
  assert.equal(result.ok, true);
  assert.ok(Docs.normalize(result.record));
  assert.deepEqual(h.events.map(item => item[0]), ["upload", "persist"]);
  const upload = h.events[0][1];
  assert.equal(upload.mimeType, "application/pdf");
  assert.equal(upload.rootFolderId, "root_folder");
  assert.deepEqual(upload.content, bytes);
  assert.equal("bytes" in result.record, false);
  h.data.company.buildingDocsFolderId = "";
  await assert.rejects(h.context.saveCustomerDocument({kind: "quote"}), /회사 Drive/);
});
test("저장본 발송은 관리자·최신 수신자·해시를 검증하고 실패 시 보안 링크를 폐기한다", async () => {
  const h = harness();
  assert.equal((await h.context.sendSavedCustomerDocument(request())).ok, true);
  assert.equal(h.events.find(item => item[0] === "create")[1].bytes, bytes.toString("base64"));
  assert.equal(h.events.find(item => item[0] === "send")[1].phone, Docs.phone(customer.phone));
  for (const options of [{role: "member"}, {role: "viewer"}, {marketing: true}, {changeSession: true}]) {
    const blocked = harness(options);
    await assert.rejects(blocked.context.sendSavedCustomerDocument(request()));
    assert.equal(blocked.events.filter(item => item[0] === "send").length, 0);
  }
  const failed = harness({sendFailure: true});
  await assert.rejects(failed.context.sendSavedCustomerDocument(request()));
  assert.equal(failed.events.at(-1)[0], "revoke");
  const anonymous = harness(); anonymous.state.user = null;
  await assert.rejects(anonymous.context.sendSavedCustomerDocument(request()));
});
test("저장 결과보고서는 서버 원본을 다시 조회하고 변경된 기록·누락 사진은 보내지 않는다", async () => {
  const report = {id: "report_a", ownerContact: customer.phone, updatedAt: "revision_a", items: [{before: [{}], after: [{}]}]};
  const input = {kind: "workReport", documentId: report.id, customerId: customer.id, updatedAt: report.updatedAt, report: {buildingName: "forged"}};
  const h = harness({reports: [report]});
  assert.equal((await h.context.sendSavedCustomerDocument(input)).ok, true);
  assert.equal(h.events.find(item => item[0] === "create")[1].documentType, "completion_report");
  await assert.rejects(h.context.sendSavedCustomerDocument({...input, updatedAt: "old"}), /변경/);
  await assert.rejects(harness({reports: [report], photoFailure: true}).context.sendSavedCustomerDocument(input), /사진/);
});
test("저장·발송 IPC는 mutation이고 미리보기 또한 신뢰된 발신자·로그인 검증을 거친다", () => {
  for (const suffix of ["save", "send"]) assert.equal(Policy.classification("crm:customer-document-" + suffix), "mutation");
  assert.doesNotThrow(() => Policy.assertRegistered("crm:customer-document-preview"));
  for (const suffix of ["save","send","preview"]) assert.ok(mainSource.includes('secureCanonicalHandle("crm:customer-document-' + suffix + '"'));
  const app = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
  const send = app.slice(app.indexOf("  async function sendCustomerAlimTalk()"), app.indexOf("  async function refreshDocumentDeliveryCapabilities()"));
  assert.doesNotMatch(send, /aiAssistantState.quote|buildingMonthlyReportState|sendQuoteToCustomerByKakao|sendBuildingMonthlyReportToCustomerByKakao/);
  assert.match(send, /sendSavedCustomerDocument/);
  assert.match(app, /data-ai-quote-crm-save/);
  assert.match(app, /data-building-monthly-crm-save/);
});
