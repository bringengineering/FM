"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../src/periodic-report-core");
const { createPeriodicReportHtml, periodicReportPdfPhotos } = require("../src/periodic-report-owner-pdf");

const PIXEL = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2w==";
const cleaning = (id, date, extra = {}) => ({
  id, buildingId: "b1", kind: "common", workDate: date, workerName: "현장팀",
  items: [{ key: "stairs", label: "계단·계단참", status: "recorded", before: [{ id: `${id}_b` }], during: [], after: [{ id: `${id}_a` }] }],
  ...extra,
});
const works = [
  cleaning("wr1", "2026-10-19"),
  cleaning("wr2", "2026-10-26"),
  cleaning("wr_prev", "2026-10-12"),
  cleaning("wr_other", "2026-10-20", { buildingId: "b2" }),
  cleaning("wr_movein", "2026-10-21", { kind: "moveIn" }),
];
const base = {
  id: "pr_test01", buildingId: "b1", siteAddress: "강원 원주시 테스트로 1", period: "2026-10-2",
  inspection: { date: "2026-10-26", items: [{ key: "lightSensor", status: "fix", note: "3층 센서등 미점등", photos: [{ id: "i1" }] }] },
};

test("기간은 1~15일, 16일~말일로 나뉜다", () => {
  assert.deepEqual(P.parsePeriod("2026-02-2"), { key: "2026-02-2", year: 2026, month: 2, half: 2, from: "2026-02-16", to: "2026-02-28" });
  assert.equal(P.periodOf("2026-10-15").key, "2026-10-1");
  assert.equal(P.periodOf("2026-10-16").key, "2026-10-2");
  assert.equal(P.previousPeriod("2026-01-1").key, "2025-12-2");
  assert.equal(P.nextPeriod("2026-12-2").key, "2027-01-1");
  assert.equal(P.parsePeriod("2026-13-1"), null);
  assert.equal(P.dateLabel("2026-10-19"), "2026. 10. 19.(월)");
  assert.equal(P.weekOfMonth("2026-10-19"), "10월 4주차");
});

test("그 기간·그 건물의 공용부 청소만 날짜순으로 모은다", () => {
  assert.deepEqual(P.cleaningsFor(works, base).map(row => row.id), ["wr1", "wr2"]);
  assert.deepEqual(P.cleaningsFor(works, { ...base, cleaningReportIds: ["wr2"] }).map(row => row.id), ["wr2"]);
});

test("표준 점검 항목이 모두 깔리고 저장된 상태가 얹힌다", () => {
  const report = P.normalizeReport(base);
  assert.equal(report.inspection.items.length, P.INSPECTION_ITEMS.length);
  const sensor = report.inspection.items.find(item => item.key === "lightSensor");
  assert.equal(sensor.status, "fix");
  assert.equal(sensor.category, "조명");
  assert.ok(report.inspection.items.filter(item => item.key !== "lightSensor").every(item => item.status === "good"));
});

test("양호가 아닌 항목은 사진과 메모가 있어야 낼 수 있다", () => {
  assert.equal(P.validateReport(base, works).ok, true);
  const noPhoto = { ...base, inspection: { ...base.inspection, items: [{ key: "lightSensor", status: "fix", note: "x" }] } };
  assert.match(P.validateReport(noPhoto, works).error, /사진/);
  const noNote = { ...base, inspection: { ...base.inspection, items: [{ key: "lightSensor", status: "watch", photos: [{ id: "p" }] }] } };
  assert.match(P.validateReport(noNote, works).error, /한 줄/);
  assert.match(P.validateReport({ ...base, inspection: { ...base.inspection, date: "2026-10-03" } }, works).error, /기간 밖/);
  assert.match(P.validateReport(base, []).error, /청소 결과보고서가 없습니다/);
});

test("숫자는 기록에서 센다", () => {
  const view = P.buildView(base, works);
  assert.equal(view.cleanings.length, 2);
  assert.equal(view.counts.fix, 1);
  assert.equal(view.counts.good, P.INSPECTION_ITEMS.length - 1);
  assert.match(view.summary, /공용부 청소 2회\(10\. 19\. · 10\. 26\.\)/);
  assert.match(view.summary, /조치 필요 1건/);
  assert.equal(view.documentNo, "BR-202610-2-REG-ST01");
});

test("지난 보고서의 미해결 항목이 넘어오고, 이번에 정상이면 조치 완료가 된다", () => {
  const previous = { id: "pr_prev", buildingId: "b1", period: "2026-10-1", inspection: { date: "2026-10-12", items: [
    { key: "mailbox", status: "fix", note: "잠금 파손", photos: [{ id: "m" }] },
    { key: "wallCrack", status: "watch", note: "미세 균열", photos: [{ id: "w" }] },
  ] } };
  const current = { ...base, inspection: { ...base.inspection, items: [...base.inspection.items, { key: "wallCrack", status: "watch", note: "변화 없음", photos: [{ id: "w2" }] }] } };
  const view = P.buildView(current, works, { previousReport: previous });
  const mailbox = view.actions.find(item => item.key === "insp_mailbox");
  assert.equal(mailbox.status, "done");
  assert.match(mailbox.plan, /정상 확인/);
  const crack = view.actions.filter(item => item.key === "insp_wallCrack");
  assert.equal(crack.length, 1);
  assert.equal(crack[0].finding, "변화 없음");
});

test("건물주용 PDF: 청소일·점검 상태가 실리고 내부 값과 외부 이미지는 막힌다", () => {
  const view = P.buildView({ ...base, summary: "<script>alert(1)</script>" }, works);
  const images = Object.fromEntries(periodicReportPdfPhotos(view).map(photo => [photo.id, PIXEL]));
  images.i1 = "https://evil.example/x.png";
  const html = createPeriodicReportHtml(view, { company: { businessName: "브링케어" }, images, issuedAt: "2026-11-02" });
  assert.match(html, /정기 관리보고서/);
  assert.match(html, /강원 원주시 테스트로 1 건물주<\/b> 귀하/);
  assert.match(html, /10\. 19\.\(월\)/);
  assert.match(html, /10\. 26\.\(월\)/);
  assert.match(html, /조치 필요/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /evil\.example/);
  assert.match(html, /사진 없음/);
  assert.equal(periodicReportPdfPhotos(view).length, 5);
});

test("화면·IPC·권한 정책·DB 규칙에 연결돼 있다", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const MutationPolicy = require("../src/mutation-policy");
  const main = read("src/main.js");
  const preload = read("src/preload.js");
  const index = read("src/index.html");
  assert.ok(main.includes('secureHandle("crm:periodic-reports-load"'));
  for (const channel of ["crm:periodic-report-save", "crm:periodic-report-export"]) {
    assert.ok(main.includes(`secureCanonicalHandle("${channel}"`), channel);
    assert.ok(preload.includes(`"${channel}"`), channel);
    assert.notEqual(MutationPolicy.classification(channel), "control", channel);
  }
  assert.equal(MutationPolicy.classification("crm:periodic-reports-load"), "control");
  assert.ok(index.indexOf("./work-report-core.js") < index.indexOf("./periodic-report-core.js"));
  assert.ok(index.indexOf("./periodic-report-core.js") < index.indexOf("./periodic-report-ui.js"));
  assert.ok(index.includes('data-view="periodicReports"'));
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "database.rules.json"), "utf8"));
  const node = rules.rules.crmCompany.periodicReports;
  assert.equal(node[".write"], false);
  assert.match(node.$reportId[".validate"], /updatedBy'\)\.val\(\) === auth\.uid/);
});

test("Drive 가 없으면 서버 자료를 받기 전에 알리고, 건물 없는 고객도 대상으로 고를 수 있다", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
  const body = main.slice(main.indexOf("async function exportPeriodicReport"));
  assert.ok(body.indexOf("DRIVE_REQUIRED") < body.indexOf("loadPeriodicReports"));
  assert.match(body, /Promise\.all\(\[remoteClient\.loadPeriodicReports\(\)/);
  const ui = fs.readFileSync(path.join(__dirname, "..", "src", "periodic-report-ui.js"), "utf8");
  assert.match(ui, /건물 없는 고객/);
  const customerReport = { id: "pr_cust01", customerId: "cus_a", period: "2026-10-2", inspection: { date: "2026-10-28" } };
  const works = [
    { id: "w1", buildingId: "", customerId: "cus_a", kind: "common", workDate: "2026-10-28", items: [{ key: "stairs", status: "recorded", after: [{ id: "x" }] }] },
    { id: "w2", buildingId: "b9", customerId: "cus_a", kind: "common", workDate: "2026-10-28", items: [{ key: "stairs", status: "recorded", after: [{ id: "y" }] }] },
  ];
  assert.deepEqual(P.cleaningsFor(works, customerReport).map(row => row.id), ["w1"]);
  assert.equal(P.validateDraft(customerReport).ok, true);
});

test("청소 내역의 수행 내용에는 안내문이 아니라 구역별 수행 범위가 들어간다", () => {
  const letter = "안녕하십니까, 브링케어입니다.\n\n구역별 현장 사진을 정리하여 전달드립니다.\n\n브링케어 드림";
  const works = [{ id: "w1", buildingId: "b1", kind: "common", workDate: "2026-10-28", summary: letter,
    items: [{ key: "stairs", label: "계단·계단참", detail: "층별 계단·참의 오염 확인 및 청소", status: "recorded", after: [{ id: "p" }] }] }];
  const view = P.buildView({ id: "pr_x0001", buildingId: "b1", period: "2026-10-2", inspection: { date: "2026-10-28" } }, works);
  assert.equal(view.cleanings[0].work, "층별 계단·참의 오염 확인 및 청소");
  assert.doesNotMatch(view.cleanings[0].work, /안녕하십니까/);
});

test("정기점검 결과 표에 사진 칸이 있고, 점검 사진은 청소 사진보다 먼저 나온다", () => {
  const works = [{ id: "w1", buildingId: "b1", kind: "common", workDate: "2026-10-28", items: [{ key: "stairs", label: "계단", status: "recorded", after: [{ id: "c1" }] }] }];
  const report = { id: "pr_thumb1", buildingId: "b1", period: "2026-10-2", inspection: { date: "2026-10-28", items: [
    { key: "lightSensor", status: "fix", note: "미점등", photos: [{ id: "i1" }] },
  ] } };
  const view = P.buildView(report, works);
  const html = createPeriodicReportHtml(view, { images: { i1: PIXEL, c1: PIXEL } });
  assert.match(html, /<th>사진<\/th>/);
  assert.match(html, /class="thumbs"><img src="data:image\/jpeg/);
  assert.match(html, /육안 확인/);
  assert.ok(html.indexOf("정기점검 사진</h2>") < html.indexOf("공용부 청소 사진</h2>"));
});
