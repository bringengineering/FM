"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const R = require("../src/work-report-core");
const Pdf = require("../src/work-report-pdf");
const Archive = require("../src/work-report-archive");
const source = fs.readFileSync(require.resolve("../src/main.js"), "utf8");

function report(kind = "stairs") {
  const value = R.normalizeReport({id: "wr_no_seal", kind, buildingId: "building_fixture", buildingName: "예시 건물", workDate: "2026-10-06", updatedAt: "2026-10-06T01:00:00Z", summary: "검증용 현장 기록"});
  for (const item of value.items) { item.status = "skipped"; item.note = "작업 대상 제외"; }
  Object.assign(value.items[0], kind === "common"
    ? {status: "recorded", during: [{id: "during", driveFileId: "photo_during"}]}
    : {status: "done", before: [{id: "before", driveFileId: "photo_before"}], after: [{id: "after", driveFileId: "photo_after"}]});
  return value;
}
function harness(options = {}) {
  const pages = [], writes = [], downloads = [];
  const session = {user: {uid: "user_fixture", role: "admin"}, check() { if (options.expired) throw Error("session changed"); }};
  const context = vm.createContext({Buffer, WorkReportCore: R, ...Pdf,
    readLocalQuoteSeal: async () => { throw Error("Report must never access the quote seal store"); },
    savedDocumentSession: () => session, authState: () => ({user: session.user}), isMarketingOnlySession: () => false,
    driveSessionView: () => ({connected: !options.noDrive}), driveApiDeps: () => ({}),
    BuildingDocsDrive: {downloadFile: async (_deps, input) => {downloads.push(input.fileId); return {content: Buffer.from("synthetic jpeg"), mimeType: "image/jpeg", name: "fixture.jpg"};}},
    workReportPdfJpeg: value => value, HeicJpegConverter: {looksLikeHeic: () => false},
    createReportPdfBytes: async html => {pages.push(html); return Buffer.from("%PDF-1.7\nsynthetic PDF");},
    dialog: {showSaveDialog: async () => ({filePath: "synthetic-report.pdf", canceled: options.canceled})}, mainWindow: null,
    fs: {writeFile: async (...args) => {writes.push(args);}},
  });
  for (const name of ["createWorkReportPdfArtifact", "exportWorkReport"]) {
    const start = source.indexOf(`async function ${name}(`);
    const end = source.indexOf("\nasync function ", start + 1);
    vm.runInContext(source.slice(start, end), context);
  }
  return {context, session, pages, writes, downloads};
}

test("인감 저장소가 없거나 읽기 실패여도 두 서식의 PDF 다운로드·발송용 생성이 동작한다", async () => {
  for (const kind of ["moveIn", "stairs", "common"]) for (const copyType of ["owner", "program"]) {
    const h = harness(), input = {report: report(kind), copyType, strictPhotos: true, company: {businessName: "예시 회사"}};
    const artifact = await h.context.createWorkReportPdfArtifact(input, copyType);
    assert.equal(artifact.ok, true); assert.equal(artifact.photos, R.photoCount(input.report));
    assert.equal((await h.context.exportWorkReport(input)).ok, true);
    assert.equal(h.pages.length, 2); assert.equal(h.writes.length, 1);
    for (const html of h.pages) {
      assert.doesNotMatch(html, /대표자 날인|서명 또는 인|class="stamp"|data:image\/png;base64/);
      assert.match(html, /data:image\/jpeg;base64/);
      assert.match(html, /예시 회사/);
      assert.match(html, /검증용 현장 기록/);
    }
  }
});

test("인감 제거는 사진 확인·보고서 검증·민감정보·세션 검사를 우회하지 않는다", async () => {
  const missing = harness({noDrive: true});
  assert.equal((await missing.context.exportWorkReport({report: report(), strictPhotos: true})).ok, false);
  assert.equal(missing.writes.length, 0);
  const invalid = harness();
  await assert.rejects(invalid.context.createWorkReportPdfArtifact({report: {...report(), buildingId: ""}}, "owner"), /건물/);
  const leaking = harness();
  const blocked = await leaking.context.createWorkReportPdfArtifact({report: {...report(), summary: "검증업체 비공개자료"}, secrets: {vendorNames: ["검증업체"]}}, "owner");
  assert.equal(blocked.code, "REPORT_LEAK"); assert.equal(leaking.pages.length, 0);
  const expired = harness({expired: true});
  await assert.rejects(expired.context.exportWorkReport({report: report()}), /session changed/);
  assert.equal(expired.writes.length, 0);
  const canceled = harness({canceled: true});
  assert.equal((await canceled.context.exportWorkReport({report: report()})).canceled, true);
  assert.equal(canceled.writes.length, 0);
});

test("실제 보고서 생성 함수를 거친 인감 없는 PDF가 CRM에 보관되고 같은 저장본으로 발송된다", async () => {
  const h = harness(); const value = report("common");
  const data = {company: {buildingDocsFolderId: "root_fixture"}, settings: {quoteCompany: {businessName: "예시 회사"}}, buildings: [{id: value.buildingId, name: "예시 건물", ownerCustomerId: "owner_fixture"}], customers: [{id: "owner_fixture", name: "예시 건물주", phone: "01000000000"}], buildingDocuments: []};
  let savedBytes, sentBytes, sends = 0;
  const service = Archive.createService({
    reports: async () => ({reports: [value]}), store: async () => structuredClone(data),
    pdf: input => h.context.createWorkReportPdfArtifact(input, "owner"),
    upload: async input => {savedBytes = input.content; return {id: "drive_fixture"};}, download: async () => savedBytes,
    mutate: async (id, change) => {const index = data.buildingDocuments.findIndex(row => row.id === id); const next = change(index < 0 ? null : data.buildingDocuments[index]); if (index < 0) data.buildingDocuments.push(next); else data.buildingDocuments[index] = next; return next;},
    delivery: async (action, input) => {
      if (action === "capabilities") return {ok: true, capabilities: {kakao: true}};
      if (action === "create") {sentBytes = Buffer.from(input.bytes, "base64"); return {ok: true, documentId: "delivery_fixture"};}
      if (action === "send") {sends++; assert.equal(input.phone, "01000000000"); return {ok: true, messageId: "message_fixture"};}
    },
  });
  const {record} = await service.save({reportId: value.id, updatedAt: value.updatedAt}, h.session);
  assert.equal(sends, 0); assert.equal(data.buildingDocuments.length, 1);
  const result = await service.send({kind: "workReport", documentId: record.id, customerId: "owner_fixture", updatedAt: record.updatedAt, sha256: record.savedCustomerDocument.sha256}, h.session);
  assert.equal(result.ok, true); assert.equal(sends, 1); assert.deepEqual(sentBytes, savedBytes);
  assert.equal(h.pages.length, 1); assert.doesNotMatch(h.pages[0], /대표자 날인|서명 또는 인/);
});
