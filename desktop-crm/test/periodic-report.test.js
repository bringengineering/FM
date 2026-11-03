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
  const body = main.slice(main.indexOf("async function buildPeriodicReportPdf"));
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

test("알림톡: 받는 사람은 건물의 건물주 고객(건물 없으면 그 고객)의 휴대전화이고, 승인 템플릿 칸을 채운다", () => {
  const store = {
    buildings: [{ id: "b1", ownerCustomerId: "c1" }, { id: "b2" }],
    customers: [{ id: "c1", name: "건물주", phone: "010-2077-3076" }, { id: "c2", name: "유선", phone: "033-748-8919" }, { id: "c3", phone: "01099998888", deleted: true }],
  };
  const base = { id: "pr_kakao1", period: "2026-10-2", siteAddress: "강원 원주시 테스트로 1" };
  assert.equal(P.recipientFor({ ...base, buildingId: "b1" }, store).phone, "01020773076");
  assert.match(P.recipientFor({ ...base, buildingId: "b2" }, store).reason, /건물주 고객이 연결/);
  assert.match(P.recipientFor({ ...base, customerId: "c2" }, store).reason, /휴대전화/);
  assert.match(P.recipientFor({ ...base, customerId: "c3" }, store).reason, /찾지 못했습니다/);
  assert.deepEqual(P.kakaoDetails({ ...base, buildingId: "b1" }), { buildingAddress: "강원 원주시 테스트로 1", workName: "2026년 10월 2차 정기 관리" });
  assert.equal(P.kakaoDetails({ ...base, buildingId: "b1", siteAddress: "" }), null);
  assert.equal(P.kakaoDetails({ ...base, siteAddress: "가".repeat(120), buildingId: "b1" }).buildingAddress.length, 80);
});

test("발송 기록은 상태·시각·끝 4자리·열람 정보만 남고 전화번호는 남지 않는다", () => {
  const r = P.normalizeReport({ id: "pr_kakao2", buildingId: "b1", period: "2026-10-2", delivery: { status: "requested", sentAt: "2026-11-03T01:00:00Z", phoneTail: "3076", phone: "01020773076" } });
  assert.deepEqual(Object.keys(r.delivery).sort(), ["checkedAt", "documentId", "firstViewedAt", "messageId", "phoneTail", "sentAt", "sentBy", "status", "viewCount"]);
  assert.doesNotMatch(JSON.stringify(r.delivery), /01020773076/);
  assert.equal(P.normalizeReport({ id: "pr_kakao3", buildingId: "b1", period: "2026-10-2", delivery: { status: "weird" } }).delivery, null);
});

test("알림톡 발송은 관리자 전용·한 번만·번호 확인을 거치고, 작업 결과보고서 승인 템플릿을 쓴다", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
  const body = main.slice(main.indexOf("async function sendPeriodicReportByKakao"), main.indexOf("async function sendWorkReportToCustomerByKakao"));
  assert.match(body, /role !== "admin"/);
  assert.match(body, /ALREADY_SENT/);
  assert.match(body, /RECIPIENT_MISMATCH/);
  assert.match(body, /documentType: "completion_report"/);
  assert.match(body, /12 \* 1024 \* 1024/);
  assert.match(body, /"revoke"/);
  assert.ok(main.includes('secureCanonicalHandle("crm:periodic-report-kakao-send"'));
  const MutationPolicy = require("../src/mutation-policy");
  assert.notEqual(MutationPolicy.classification("crm:periodic-report-kakao-send"), "control");
});

test("격주 차례: 막 끝난 기간에 청소 기록이 있는 곳마다 상태를 보이고, 자동 초안은 점검 확인 전엔 못 보낸다", () => {
  const works2 = [
    { id: "a1", buildingId: "b1", buildingName: "예초집", kind: "common", workDate: "2026-10-19", items: [{ key: "stairs", status: "recorded", after: [{ id: "x" }] }] },
    { id: "a2", buildingId: "b1", kind: "common", workDate: "2026-10-26", items: [{ key: "stairs", status: "recorded", after: [{ id: "y" }] }] },
    { id: "a3", buildingId: "", customerId: "c1", kind: "stairs", workDate: "2026-10-28", items: [{ key: "stairFloor", status: "done", before: [{ id: "z1" }], after: [{ id: "z2" }] }] },
    { id: "a4", buildingId: "b2", kind: "moveIn", workDate: "2026-10-20", items: [] },
    { id: "a5", buildingId: "b3", kind: "common", workDate: "2026-11-02", items: [] },
  ];
  const sent = { id: "pr_sent01", buildingId: "b1", period: "2026-10-2", inspection: { date: "2026-10-26" }, delivery: { status: "requested", sentAt: "x", phoneTail: "3076" } };
  const due = P.dueReports(works2, [sent], "2026-11-03");
  assert.equal(due.period.key, "2026-10-2");
  assert.deepEqual(due.items.map(item => [item.key, item.state]), [["c:c1", "missing"], ["b:b1", "sent"]]);
  assert.equal(P.dueReports(works2, [], "2026-11-16").period.key, "2026-11-1");
  const draft = P.draftFor({ ...due.items[0], period: due.period.key }, "pr_auto01");
  assert.equal(draft.customerId, "c1");
  assert.equal(draft.inspection.date, "2026-10-28");
  assert.equal(draft.inspection.confirmed, false);
  assert.match(P.validateReport(draft, works2).error, /자동으로 만든 초안/);
  assert.equal(P.validateReport({ ...draft, inspection: { ...draft.inspection, confirmed: true } }, works2).ok, true);
  assert.equal(P.normalizeReport({ id: "pr_old01", buildingId: "b1", period: "2026-10-2", inspection: {} }).inspection.confirmed, true);
});

test("AI 점검: 청소 사진 후보는 점검과 겹치는 구역부터 고르고, 제안은 알려진 항목·확신 높은 것만 남긴다", () => {
  const cleanings = [{ id: "w", items: [
    { key: "stairs", label: "계단", after: [{ id: "s1" }, { id: "s2" }] },
    { key: "fixtures", label: "공용 설비", after: [{ id: "f1" }], before: [{ id: "f0" }] },
    { key: "recycle", label: "분리수거장", during: [{ id: "r1" }] },
  ] }];
  const report = { id: "pr_ai001", buildingId: "b1", period: "2026-10-2", inspection: { items: [{ key: "extinguisher", photos: [{ id: "f0" }] }] } };
  const picked = P.cleaningPhotoCandidates(cleanings, report).map(photo => photo.id);
  assert.deepEqual(picked.slice(0, 3), ["f1", "r1", "s1"]);
  assert.ok(!picked.includes("f0"));
  const byId = new Map([["f1", { id: "f1", area: "공용 설비" }], ["r1", { id: "r1" }], ["s1", { id: "s1" }]]);
  const out = P.normalizeSuggestions([
    { id: "f1", itemKey: "extinguisher", status: "good", note: "압력계 정상 범위", confidence: 0.9 },
    { id: "r1", itemKey: "recycle", status: "fix", note: "혼합 배출", confidence: 0.4 },
    { id: "s1", itemKey: "kitchen", status: "good", note: "", confidence: 0.9 },
    { id: "nope", itemKey: "panel", status: "good", note: "", confidence: 0.9 },
  ], byId, "cleaning");
  assert.deepEqual(out.map(row => [row.photo.id, row.itemKey, row.label, row.area]), [["f1", "extinguisher", "소화기", "공용 설비"]]);
  const insp = P.normalizeSuggestions([{ id: "f1", itemKey: "panel", status: "unknown", note: "", confidence: 0.9 }], byId, "inspection");
  assert.equal(insp.length, 0);
});

test("AI 점검 제안은 서버 보고서 기준·축소본만 보내고 Drive 연결을 먼저 본다", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
  const body = main.slice(main.indexOf("async function reviewPeriodicInspectionPhotos"), main.indexOf("async function exportPeriodicReport"));
  assert.ok(body.indexOf("DRIVE_REQUIRED") < body.indexOf("loadPeriodicReports"));
  assert.match(body, /safeClassificationJpeg/);
  assert.match(body, /CRM_AI_INSPECTION_REVIEW_URL/);
  assert.match(main, /new URL\("\/v1\/inspection-review", CRM_AI_GATEWAY_URL\)/);
  const MutationPolicy = require("../src/mutation-policy");
  assert.equal(MutationPolicy.classification("crm:periodic-inspection-review"), "control");
});

test("관찰·조치 항목은 지난 점검의 같은 항목 사진과 나란히 싣는다", () => {
  const works3 = [{ id: "w1", buildingId: "b1", kind: "common", workDate: "2026-10-28", items: [{ key: "stairs", label: "계단", status: "recorded", after: [{ id: "c1" }] }] }];
  const previous = { id: "pr_prev9", buildingId: "b1", period: "2026-10-1", inspection: { date: "2026-10-12", items: [
    { key: "wallCrack", status: "watch", note: "처음 확인", photos: [{ id: "old1" }] },
    { key: "mailbox", status: "good", photos: [{ id: "old2" }] },
  ] } };
  const report = { id: "pr_cmp01", buildingId: "b1", period: "2026-10-2", inspection: { date: "2026-10-28", items: [
    { key: "wallCrack", status: "watch", note: "변화 없음", photos: [{ id: "new1" }] },
    { key: "mailbox", status: "good", photos: [{ id: "new2" }] },
  ] } };
  const view = P.buildView(report, works3, { previousReport: previous });
  const crack = view.inspection.items.find(item => item.key === "wallCrack");
  assert.equal(crack.previous.photos[0].id, "old1");
  assert.equal(crack.previous.dateLabel, "10. 12.(월)");
  assert.equal(view.inspection.items.find(item => item.key === "mailbox").previous, undefined);
  assert.deepEqual(periodicReportPdfPhotos(view).map(photo => photo.id).sort(), ["c1", "new1", "new2", "old1"]);
  const images = Object.fromEntries(["c1", "new1", "new2", "old1"].map(id => [id, PIXEL]));
  const html = createPeriodicReportHtml(view, { images });
  assert.match(html, /지난 점검과 비교/);
  assert.match(html, /지난번: 처음 확인 · 이번: 변화 없음/);
});

test("조치 항목 ↔ 작업 건: 공사 진행이 끝나면 '수리 완료', 진행 중이면 단계 표시, 연결은 다음 보고서로 이어진다", () => {
  const works4 = [{ id: "w", buildingId: "b1", kind: "common", workDate: "2026-10-28", items: [{ key: "stairs", status: "recorded", after: [{ id: "c" }] }] }];
  const prev = { id: "pr_lnk01", buildingId: "b1", period: "2026-10-1", links: { lightSensor: "case_1", bogus: "x" }, inspection: { date: "2026-10-12", items: [{ key: "lightSensor", status: "fix", note: "미점등", photos: [{ id: "x" }] }] } };
  assert.deepEqual(P.normalizeReport(prev).links, { lightSensor: "case_1" });
  const cur = { id: "pr_lnk02", buildingId: "b1", period: "2026-10-2", inspection: { date: "2026-10-28" } };
  const doing = P.buildView(cur, works4, { previousReport: prev, cases: [{ id: "case_1", status: { c11: "done", c12: "doing" } }] }).actions[0];
  assert.deepEqual([doing.status, doing.plan], ["fix", "작업 진행 중 (공사 진행)"]);
  const done = P.buildView(cur, works4, { previousReport: prev, cases: [{ id: "case_1", status: { c12: "done" }, workCompletedAt: "2026-10-30" }] }).actions[0];
  assert.deepEqual([done.status, done.plan], ["done", "10. 30.(금) 수리 완료"]);
  const trashed = P.buildView(cur, works4, { previousReport: prev, cases: [{ id: "case_1", deleted: true, status: { c12: "doing" } }] }).actions[0];
  assert.equal(trashed.plan, "10. 28.(수) 점검에서 정상 확인");
});

test("건물별 이력: 반복 문제·조치 평균 일수·최근 8주 청소 공백을 기록에서 센다", () => {
  const w = ["2026-10-05", "2026-10-12", "2026-10-26", "2026-11-02"].map((date, i) => ({ id: `h${i}`, buildingId: "b1", kind: "common", workDate: date, items: [] }));
  const r = [
    { id: "pr_his01", buildingId: "b1", buildingName: "예초집", period: "2026-10-1", links: { recycle: "k1" }, inspection: { date: "2026-10-12", items: [{ key: "recycle", status: "fix" }, { key: "wallCrack", status: "watch" }] } },
    { id: "pr_his02", buildingId: "b1", period: "2026-10-2", inspection: { date: "2026-10-26", items: [{ key: "recycle", status: "fix" }] }, delivery: { status: "sent", sentAt: "2026-11-01T00:00:00Z", phoneTail: "1234" } },
  ];
  const [row] = P.buildingHistory(r, w, [{ id: "k1", status: { c12: "done" }, workCompletedAt: "2026-10-30" }], "2026-11-03");
  assert.equal(row.buildingName, "예초집");
  assert.deepEqual(row.repeated.map(item => [item.key, item.count]), [["recycle", 2]]);
  assert.equal(row.avgFixDays, 18);
  assert.deepEqual(row.missedWeeks, ["2026-10-18"]);
  assert.equal(row.weeksChecked, 4);
  assert.equal(row.sent, 1);
  assert.equal(row.openNow, 1);
});

test("열람 확인: 발송 서버의 문서 상태를 묻고, 목록에 열람함/미열람·경과일을 보인다", async () => {
  assert.deepEqual(P.viewState({ status: "requested", sentAt: "2026-11-01T01:00:00Z", phoneTail: "1234", documentId: "doc_a" }, "2026-11-03"), { viewed: false, days: 2, label: "미열람 · 발송 후 2일", followUp: true });
  assert.equal(P.viewState({ status: "requested", sentAt: "2026-10-20T01:00:00Z", phoneTail: "1234" }, "2026-11-03").label, "미열람 · 링크 만료");
  assert.equal(P.viewState({ status: "requested", sentAt: "2026-11-01T01:00:00Z", phoneTail: "1234", firstViewedAt: "2026-11-02T03:00:00Z", viewCount: 3 }, "2026-11-03").label, "열람함 11. 2.(월) · 3회");
  assert.equal(P.viewState(null, "2026-11-03"), null);
  const { requestDocumentDelivery } = require("../src/document-delivery-client");
  let called = "";
  const value = await requestDocumentDelivery({ endpoint: "https://bring-crm-ai-gateway.bringengineering1008.workers.dev/v1/document-delivery", idToken: "t", action: "documentStatus", input: { documentId: "doc_abc" },
    fetchImpl: async url => { called = url; return new Response(JSON.stringify({ ok: true, firstViewedAt: "x", viewCount: 1 })); } });
  assert.match(called, /\/v1\/document-delivery\/documents\/doc_abc$/);
  assert.equal(value.viewCount, 1);
  const fs = require("node:fs");
  const path = require("node:path");
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
  assert.match(main, /documentId: String\(created\.documentId\)/);
  assert.ok(main.includes('secureCanonicalHandle("crm:periodic-report-views"'));
});

test("건물 월간보고서에 그 달 격주 정기 관리 요약이 들어간다", () => {
  const B = require("../src/building-report-core");
  const { createBuildingReportHtml } = require("../src/building-report-pdf");
  const works5 = ["2026-10-19", "2026-10-26"].map((date, i) => ({ id: `m${i}`, buildingId: "b1", kind: "common", workDate: date, items: [{ key: "stairs", status: "recorded", after: [{ id: `x${i}` }] }] }));
  const report = B.buildBuildingMonthlyReport({ building: { id: "b1", name: "예초집" }, month: "2026-10", store: {},
    periodicReports: [{ id: "pr_mon01", buildingId: "b1", period: "2026-10-2", inspection: { date: "2026-10-26", items: [{ key: "recycle", status: "fix", note: "혼합 배출", photos: [{ id: "p" }] }] } },
      { id: "pr_mon02", buildingId: "b2", period: "2026-10-1", inspection: { date: "2026-10-05" } }],
    workReports: works5 });
  assert.equal(report.periodic.length, 1);
  assert.deepEqual(report.periodic[0].cleaningDates, ["10. 19.(월)", "10. 26.(월)"]);
  assert.deepEqual(report.periodic[0].openActions.map(item => item.label), ["분리수거장"]);
  assert.equal(B.buildBuildingMonthlyReport({ building: { id: "b1" }, month: "2026-10", store: {} }).periodic.length, 0);
  const html = createBuildingReportHtml(report);
  assert.match(html, /격주 정기 관리/);
  assert.match(html, /2026년 10월 2차/);
});

test("발송·열람 시각은 한국 날짜로 센다 — 새벽에 보낸 것이 전날로 보이지 않는다", () => {
  assert.equal(P.kstDay("2026-11-02T17:30:00Z"), "2026-11-03");
  assert.equal(P.kstTime("2026-11-02T17:30:00Z"), "2026-11-03 02:30");
  assert.equal(P.viewState({ status: "requested", sentAt: "2026-11-02T17:30:00Z", phoneTail: "3076" }, "2026-11-03").label, "미열람 · 오늘 발송");
  assert.equal(P.viewState({ status: "requested", sentAt: "2026-11-02T17:30:00Z", phoneTail: "3076", firstViewedAt: "2026-11-02T18:00:00Z", viewCount: 1 }, "2026-11-03").label, "열람함 11. 3.(화)");
});

test("고객 id 와 같은 id 의 건물은 고객 단위 청소 기록과 같은 현장이다 — 차례·청소 취합·기존 보고서가 하나로 묶인다", () => {
  const rows = [
    { ...cleaning("old1", "2026-10-19"), buildingId: "cus_x" },
    { ...cleaning("new1", "2026-10-28"), buildingId: "", customerId: "cus_x" },
    { ...cleaning("new2", "2026-10-29"), buildingId: "", customerId: "cus_x" },
    { ...cleaning("solo", "2026-10-20"), buildingId: "", customerId: "cus_solo" },
  ];
  const due = P.dueReports(rows, [], "2026-11-03", ["cus_x", "b1"]);
  assert.deepEqual(due.items.map(item => [item.key, item.cleanings.length]).sort(), [["b:cus_x", 3], ["c:cus_solo", 1]]);
  // 건물 목록을 모르면(옛 호출) 건물 기록이 하나라도 있으면 건물로 묶는다.
  assert.deepEqual(P.dueReports(rows.slice(1, 3).concat(rows[0]), [], "2026-11-03").items.find(item => item.key.endsWith("cus_x")).key, "b:cus_x");
  assert.equal(P.cleaningsFor(rows, { buildingId: "cus_x", period: "2026-10-2" }).length, 3);
  assert.equal(P.cleaningsFor(rows, { buildingId: "", customerId: "cus_x", period: "2026-10-2" }).length, 3);
  // 고객 대상으로 이미 보낸 보고서는 건물 대상 차례에서 '발송 완료' 로 보인다.
  const sent = P.normalizeReport({ id: "pr_sent_cus_x", buildingId: "", customerId: "cus_x", period: "2026-10-2", delivery: { status: "sent", sentAt: "2026-11-02T03:00:00Z", phoneTail: "3076" } });
  assert.equal(P.dueReports(rows, [sent], "2026-11-03", ["cus_x"]).items.find(item => item.key === "b:cus_x").state, "sent");
});

test("AI 제안·작업 건 연결로 저장될 때는 자동 초안이 '점검 확인됨' 으로 바뀌지 않는다", () => {
  const ui = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/periodic-report-ui.js"), "utf8");
  assert.match(ui, /function readForm\(\{ confirm = false \} = \{\}\)/);
  assert.match(ui, /if \(confirm\) draft\.inspection\.confirmed = true;/);
  assert.doesNotMatch(ui, /^\s*draft\.inspection\.confirmed = true;/m);
  assert.equal((ui.match(/save\(\{ quiet: true, confirm: false \}\)/g) || []).length, 2);
  // 작업 건 연결 저장은 busy 를 푼 뒤에 해야 실제로 저장된다(save 는 busy 면 그냥 돌아간다).
  assert.match(ui, /state\.busy = "";\s*const saved = await save\(\{ quiet: true, confirm: false \}\);\s*if \(saved\) showToast\("작업 건을 만들어/);
  assert.equal((ui.match(/P\(\)\.blockers\(readForm\(\{ confirm: true \}\), state\.works\)/g) || []).length, 2);
});

test("점검 사진 올리기는 선택 창이 돌려준 filePath 를 넘기고 사진만 올린다 (작업 결과보고서도 같은 키)", () => {
  const fs = require("node:fs"), path = require("node:path");
  const ui = fs.readFileSync(path.join(__dirname, "../src/periodic-report-ui.js"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
  const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
  assert.match(main, /files\.push\(\{\s*filePath,/);
  assert.match(ui, /filePath: file\.filePath, mimeType: file\.mimeType/);
  assert.match(ui, /images\.slice\(0, 4\)/);
  assert.doesNotMatch(app, /uploadWorkReportPhoto\(\{[^}]*filePath: file\.path,/s);
  // 올릴 Drive 폴더를 넘기지 않으면 main 이 '문서함 폴더를 먼저 설정' 으로 막는다.
  assert.match(ui, /rootFolderId, reportId: draft\.id/);
  assert.match(app, /uploadWorkReportPhoto\(\{\s*rootFolderId,/);
});

test("청소 사진: 작업 중 사진만 있는 구역에 '작업 전 0장과 작업 후 0장' 문장이 나오지 않고, 스타일 없는 범례를 싣지 않는다", () => {
  const Owner = require("../src/work-report-owner-pdf");
  const item = { key: "entrance", label: "출입구·현관", before: [], after: [], during: [{ id: "d1" }] };
  const html = Owner.areaPhotos(item, 1, { d1: PIXEL });
  assert.doesNotMatch(html, /0장과 작업 후 0장/);
  assert.match(html, /작업 중 사진으로 기록했습니다/);
  const view = P.buildView({ ...base, cleaningReportIds: [] }, works);
  assert.doesNotMatch(createPeriodicReportHtml(view, { images: {} }), /class="legend"/);
});

test("다음 정기 관리보고서는 보낼 날짜 대신 관리 기간을 적는다(늦게 만들어도 지난 날짜가 찍히지 않게)", () => {
  const view = P.buildView({ id: "r1", buildingId: "b1", period: "2026-10-1", inspection: { date: "2026-10-13", items: [] } }, [], {});
  assert.deepEqual(view.nextSchedule, [{ label: "다음 정기 관리보고서", date: "2026년 10월 2차 (10. 16. ~ 10. 31. 관리분)" }]);
  assert.doesNotMatch(JSON.stringify(view.nextSchedule), /이후 발송/);
});

test("표지·법정점검은 보고서에 저장되고, 같은 건물의 가장 최근 보고서에서 다음 보고서로 이어진다", () => {
  const cover = { photo: { id: "cov1", driveFileId: "cov1" }, scale: "지상 5층 · 지하 1층" };
  const legal = [{ name: "승강기 정기검사", cycle: "year", lastDate: "2026-08-20", resultText: "합격" }, { name: "", cycle: "year" }];
  const saved = P.normalizeReport({ ...base, cover, legal });
  assert.equal(saved.cover.photo.id, "cov1");
  assert.equal(saved.cover.scale, "지상 5층 · 지하 1층");
  assert.deepEqual(saved.legal.map(item => item.name), ["승강기 정기검사"]);
  // 한 기간을 걸러도 가장 최근 것을 잇는다. 다른 건물·이후 기간 것은 잇지 않는다.
  const reports = [
    { ...saved, id: "pr_old01", period: "2026-09-1" },
    { ...base, id: "pr_other1", buildingId: "b2", period: "2026-10-1", cover: { scale: "남의 건물" } },
    { ...base, id: "pr_later1", period: "2026-11-1", cover: { scale: "나중 것" } },
  ];
  const previous = P.latestBefore(reports, { buildingId: "b1" }, "2026-10-2");
  assert.equal(previous.id, "pr_old01");
  const draft = P.draftFor({ target: { buildingId: "b1" }, buildingName: "", siteAddress: "", period: "2026-10-2", cleanings: [] }, "pr_new001", previous);
  assert.equal(draft.cover.photo.id, "cov1");
  assert.equal(draft.legal[0].name, "승강기 정기검사");
});

test("법정점검 현황: 다음 점검이 가까운 순, 다음 달은 주기로 계산, 두 달 안이면 다음 일정에도 적는다", () => {
  const legal = [
    { name: "승강기 정기검사", cycle: "year", lastDate: "2026-08-20", result: "good", resultText: "합격" },
    { name: "정보통신설비 유지보수·관리점검", cycle: "half", lastDate: "2026-06-08", result: "good", note: "업체 예약 진행 중" },
    { name: "소방시설 작동점검", cycle: "year", nextMonth: "2026-09" },
    { name: "건축물 정기점검", cycle: "other" },
  ];
  const rows = P.legalView(legal, "2026-11-03");
  assert.deepEqual(rows.map(row => row.name), ["소방시설 작동점검", "정보통신설비 유지보수·관리점검", "승강기 정기검사"]);
  assert.deepEqual(rows.map(row => [row.nextLabel, row.tone]), [["2026. 9.", "late"], ["2026. 12.", "soon"], ["2027. 8.", "calm"]]);
  assert.equal(rows[0].due, "예정 시기 지남 · 일정 확인 중");
  assert.equal(rows[0].lastLabel, "첫 점검 예정");
  assert.equal(rows[1].due, "다음 달 · 업체 예약 진행 중");
  assert.equal(rows[2].resultLabel, "합격");
  const view = P.buildView({ ...base, legal }, works, { today: "2026-11-03" });
  assert.deepEqual(view.nextSchedule.at(-1), { label: "정보통신설비 유지보수·관리점검", date: "2026년 12월 (업체 예약 진행 중)" });
  assert.equal(view.cover.scope, "공용부 청소 주 1회 · 건물 정기점검 격주 · 법정점검 일정 관리");
  assert.equal(P.buildView(base, works).cover.scope, "공용부 청소 주 1회 · 건물 정기점검 격주");
  assert.equal(view.cover.since, "2026년 10월부터");
});

test("조치 사항 진행: 처음 확인 → 작업 건 접수 → 단계·수리 완료, 지난 항목은 정상 확인으로 끝난다", () => {
  const previous = { ...base, id: "pr_prev01", period: "2026-10-1", inspection: { date: "2026-10-12", items: [
    { key: "lightSensor", status: "fix", note: "센서등 점멸", photos: [{ id: "p1" }] },
    { key: "drainRoof", status: "watch", note: "낙엽 쌓임", photos: [{ id: "p2" }] },
  ] }, links: { lightSensor: "case1" } };
  const report = { ...base, inspection: { date: "2026-10-26", items: [{ key: "drainRoof", status: "good" }] } };
  const cases = [{ id: "case1", createdAt: "2026-10-13T01:00:00Z", status: { c12: "done" }, workCompletedAt: "2026-10-20" }];
  const view = P.buildView(report, works, { previousReport: previous, cases });
  const sensor = view.actions.find(item => item.key === "insp_lightSensor");
  // 수리 뒤 이번 점검(10. 26.)에서 양호로 봤으니 그것까지 적는다.
  assert.deepEqual(sensor.steps, [{ date: "10. 12.", text: "확인" }, { date: "10. 13.", text: "작업 건 접수" }, { date: "10. 20.", text: "수리 완료" }, { date: "10. 26.", text: "점검에서 정상 확인" }]);
  assert.equal(sensor.stateLabel, "조치 완료");
  assert.equal(sensor.sinceLabel, "10. 12. (10월 1차)");
  const drain = view.actions.find(item => item.key === "insp_drainRoof");
  assert.deepEqual(drain.steps, [{ date: "10. 12.", text: "관찰 시작" }, { date: "10. 26.", text: "점검에서 정상 확인" }]);
  const open = P.buildView(report, works, { previousReport: previous, cases: [{ id: "case1", createdAt: "2026-10-13T01:00:00Z", status: { c6: "doing" } }] })
    .actions.find(item => item.key === "insp_lightSensor");
  assert.equal(open.stateLabel, "진행 중");
  assert.equal(open.steps.at(-1).text, "견적 비교 단계");
  const own = P.buildView(base, works).actions[0];
  assert.equal(own.sinceLabel, "10. 26. 이번 점검");
  assert.deepEqual(own.steps.map(step => step.text), ["확인", "건물주 확인 후 진행"]);
});

test("건물주용 PDF: 건물 사진이 있으면 표지 한 쪽, 조치 진행·법정점검 표가 실리고 강제 쪽나눔이 없다", () => {
  const legal = [{ name: "승강기 정기검사", cycle: "year", lastDate: "2026-08-20", resultText: "합격" }];
  const report = { ...base, cover: { photo: { id: "cov1", driveFileId: "cov1" }, scale: "지상 5층" }, legal };
  const view = P.buildView(report, works, { today: "2026-11-03" });
  assert.ok(periodicReportPdfPhotos(view).some(photo => photo.id === "cov1"));
  const images = { cov1: PIXEL, i1: PIXEL, wr1_b: PIXEL, wr1_a: PIXEL, wr2_b: PIXEL, wr2_a: PIXEL };
  const html = createPeriodicReportHtml(view, { images, issuedAt: "2026-11-03" });
  assert.match(html, /<section class="cover">/);
  assert.match(html, /<th>규모<\/th><td>지상 5층<\/td>/);
  assert.match(html, /제출일 2026\. 11\. 3\./);
  assert.doesNotMatch(html, /<header class="doc-head">/);
  assert.match(html, /<h2>3\. 조치 사항 진행<\/h2>/);
  assert.match(html, /<h2>4\. 법정점검 현황<\/h2>/);
  assert.match(html, /<td>승강기 정기검사<\/td><td>연 1회<\/td><td>2026\. 8\. 20\.<\/td>/);
  assert.doesNotMatch(html, /break-before:page/);
  // 사진이 없으면 표지 없이 지금 첫 쪽으로, 법정점검이 없으면 그 장이 빠진다.
  const plain = createPeriodicReportHtml(P.buildView(base, works), { images });
  assert.doesNotMatch(plain, /<section class="cover">/);
  assert.match(plain, /<header class="doc-head">/);
  assert.doesNotMatch(plain, /법정점검 현황/);
  assert.doesNotMatch(plain, /<th>규모<\/th>/);
});

test("편집 화면: 표지 사진·규모·법정점검을 적고 저장하며, 새 보고서는 지난 보고서의 것을 이어받는다", () => {
  const ui = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/periodic-report-ui.js"), "utf8");
  assert.match(ui, /data-pr-cover-add/);
  assert.match(ui, /name="coverScale"/);
  assert.match(ui, /data-pr-legal-add/);
  assert.match(ui, /core\.carriedBuilding\(core\.latestBefore\(state\.reports, target, period\)\)/);
  assert.match(ui, /core\.latestBefore\(state\.reports, entry\.target, due\.period\.key\)/);
  assert.match(ui, /itemKey: "cover"/);
  const main = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/main.js"), "utf8");
  assert.match(main, /today: PeriodicReportCore\.kstDay\(new Date\(\)\.toISOString\(\)\)/);
});
