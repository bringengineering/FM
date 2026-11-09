"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../src/work-report-core");
const {createWorkReportHtml, workReportPdfPhotos} = require("../src/work-report-pdf");
const {photoPages} = require("../src/work-report-owner-pdf");
const photo = id => ({id, caption: `설명 ${id}`});
const seed = () => Core.normalizeReport({id: "qa_report", kind: "moveIn", buildingName: "예시 건물", workDate: "2026-10-06"});

test("건물주용은 월간보고서 계열 디자인이고 견적서 격자·인감·진척도를 넣지 않는다", () => {
  const report = seed(); report.items[0].during = [photo("sample")];
  const html = createWorkReportHtml(report);
  for (const label of ["BRING CARE", "이번 작업 요약", "작업 정보", "사진 기록 요약", "구역별 작업 기록", "추가 안내", "#eaf6fd", "#80cdec", "작업일 2026-10-06"]) assert.ok(html.includes(label));
  assert.doesNotMatch(html, /진척도|완료 미확정|#1454D8|대표자 날인|양식 미리보기|class="stamp"/);
  for (const line of Core.NOTICES) assert.ok(html.includes(line));
  assert.doesNotMatch(html, /청소 완료|오염 제거 완료/);
});

test("승인 시안의 3구역 14사진은 요약과 구역별 3개 사진 묶음으로 나온다", () => {
  const report = seed();
  for (const [i, during] of [2, 2, 4].entries()) {
    const item = report.items[i];
    item.before = [photo(`before${i}`)]; item.after = [photo(`after${i}`)];
    item.during = Array.from({length: during}, (_, n) => photo(`during${i}_${n}`));
  }
  const html = createWorkReportHtml(report);
  assert.equal(workReportPdfPhotos(report).length, 14);
  // 구역마다 새 쪽을 강제하지 않고 이어 싣는다. 전·후는 같은 번호끼리 한 줄에 짝짓는다.
  assert.equal((html.match(/class="area-photos"/g) || []).length, 3);
  assert.equal((html.match(/<figure class="shot (?:before|during|after)">/g) || []).length, 14);
  assert.equal((html.match(/class="pair"/g) || []).length, 3);
  assert.doesNotMatch(html, /break-before:page/);
});

test("100장의 불균형한 전중후 사진을 중복·누락 없이 최대6장 단위로 나눈다", () => {
  const report = seed(), item = report.items[0];
  item.before = Array.from({length: 31}, (_, n) => photo(`before${n}`));
  item.after = Array.from({length: 8}, (_, n) => photo(`after${n}`));
  item.during = Array.from({length: 61}, (_, n) => photo(`during${n}`));
  const pages = photoPages(item);
  assert.equal(pages.length, 17); assert.ok(pages.every(page => page.length <= 6));
  assert.deepEqual(pages[0].slice(0, 4).map(p => p.photo.id), ["before0", "after0", "before1", "after1"]);
  const photos = workReportPdfPhotos(report);
  const images = Object.fromEntries(photos.map(p => [p.id, `data:image/jpeg;base64,${Buffer.from(p.id).toString("base64")}`]));
  const html = createWorkReportHtml(report, "owner", {images});
  for (const source of Object.values(images)) assert.equal(html.split(`src="${source}"`).length - 1, 1);
  assert.equal((html.match(/<figure class="shot (?:before|during|after)">/g) || []).length, 100);
});

test("기록·미실시·일부·완료와 긴 문구를 보존하며 사진에서 완료를 추측하지 않는다", () => {
  const report = seed();
  report.summary = "긴 작업 요약 ".repeat(150) + "요약끝";
  report.followUp = "긴 후속 안내 ".repeat(150) + "후속끝";
  report.items[0].note = "기록 메모 <script> ".repeat(20) + "메모끝";
  report.items[1].status = "skipped"; report.items[1].note = "기상 조건으로 미실시";
  report.items[2].status = "partial"; report.items[2].note = "상층은 후속 방문";
  report.items[3].status = "done";
  const html = createWorkReportHtml(report);
  for (const value of ["요약끝", "후속끝", "메모끝", "기상 조건으로 미실시", "상층은 후속 방문", "&lt;script&gt;", "완료"]) assert.ok(html.includes(value));
  assert.doesNotMatch(html, /<script>|text-overflow:ellipsis|overflow:hidden|max-height:/);
});

test("사진이 없어도 항목은 남고 외부·로컬·SVG 이미지는 출력하지 않는다", () => {
  const report = seed(); report.items[0].during = [photo("a")];
  for (const source of ["https://example.com/photo.jpg", "file:///private.jpg", "data:image/svg+xml;base64,AAAA", 'data:image/jpeg;base64,AAAA" onerror="bad']) {
    const html = createWorkReportHtml(report, "owner", {images: {a: source}});
    // 로고 외에는 이미지가 없어야 한다. 위험한 원본은 '사진 없음' 으로 대신한다.
    assert.doesNotMatch(html.replace(/<img class="brand-logo"[^>]*>|<div class="from"><img [^>]*>/g, ""), /<img/); assert.match(html, /사진 없음/);
    assert.ok(!html.includes(source));
    assert.ok(html.includes(report.items[0].label));
  }
});

test("긴 캡션과 구역명은 한 장의 사진 수를 줄여 제목과 설명 공간을 확보한다", () => {
  const item = seed().items[0];
  item.during = Array.from({length: 18}, (_, i) => ({id: `p${i}`, caption: "긴 설명 ".repeat(20)}));
  assert.deepEqual(photoPages(item).map(page => page.length), [4, 4, 4, 4, 2]);
  item.label = "긴 구역 이름 ".repeat(5);
  assert.ok(photoPages(item).every(page => page.length <= 2));
});

test("공식 문서 형식: 로고·수신·발신·제목이 있고 빈 정보 칸을 만들지 않는다", () => {
  const report = seed(); report.items[1].before = [photo("b")]; report.items[1].after = [photo("a")];
  const html = createWorkReportHtml(report, "owner", {company: {businessName: "브링케어", representative: "대표자"}});
  assert.match(html, /<img class="brand-logo" src="data:image\/jpeg;base64,/);
  for (const label of ["<th>문서번호</th>", "<th>수신(건물주)</th>", "<th>발신</th>", "<th>제목</th>", "브링케어 · 대표 대표자", "브링케어 드림"]) assert.ok(html.includes(label), label);
  // 주소·담당자·작업 범위가 없으면 그 칸은 아예 없다.
  for (const label of ["<th>현장 주소</th>", "<th>담당자</th>", "<th>작업 범위</th>"]) assert.ok(!html.includes(label), label);
  // 작업 중 사진이 없으면 0장 칸을 만들지 않는다.
  assert.doesNotMatch(html, /<span>작업 중<\/span><b>0장<\/b>/);
  // 구역별 기록은 반복 문구가 아니라 표준 수행범위를 쓴다.
  assert.ok(html.includes(report.items[1].detail));
  assert.doesNotMatch(html, /등록된 현장 사진을 안내드립니다/);
});

test("전·후는 색과 번호로 구분하고, 한쪽만 있는 구역은 그 사실을 적는다", () => {
  const report = seed();
  report.items[0].after = [photo("only-after")];
  report.items[1].before = [photo("b1"), photo("b2")]; report.items[1].after = [photo("a1")];
  const html = createWorkReportHtml(report);
  assert.ok(html.includes("이 구역은 작업 후 사진으로 기록했습니다."));
  // 전+중만 있으면 "작업 전" 하나만 적지 않고 실제 있는 단계를 다 적는다.
  const mixed = seed();
  mixed.items[0].before = [photo("mb")]; mixed.items[0].during = [photo("md")]; mixed.items[0].after = [];
  assert.ok(createWorkReportHtml(mixed).includes("이 구역은 작업 전·작업 중 사진으로 기록했습니다."));
  // 장수가 다르면 다른 장소끼리 짝짓지 않고 단계별로 나눠 싣는다.
  assert.ok(html.includes("작업 전 2장과 작업 후 1장은 같은 장소끼리 짝이 맞지 않아 단계별로 나누어 실었습니다."));
  assert.match(html, /<p class="group-head before">작업 전 사진<small>2장<\/small><\/p>/);
  assert.match(html, /<p class="group-head after">작업 후 사진<small>1장<\/small><\/p>/);
  assert.match(html, /<figure class="shot before"><div class="frame">[\s\S]*?<\/div><figcaption><b class="tag">작업 전 2<\/b>/);
  // 색 띠·영문 표기·구역명 반복 없이 단계 꼬리표만 단다.
  assert.doesNotMatch(html, /BEFORE|AFTER|class="legend"|class="photo-bar"/);
  // 장수가 같으면 같은 번호끼리 나란히 짝짓는다.
  report.items[2].before = [photo("c1"), photo("c2")]; report.items[2].after = [photo("d1"), photo("d2")];
  const pairedHtml = createWorkReportHtml(report);
  assert.equal((pairedHtml.match(/class="pair"/g) || []).length, 2);
});

test("수신인은 실명이 아니라 '(주소) 건물주 귀하' 로 쓰고 높임을 겹치지 않는다", () => {
  const report = seed(); report.items[0].after = [photo("a")];
  report.siteAddress = "예시시 예시로 12"; report.ownerName = "홍길동";
  const html = createWorkReportHtml(report);
  assert.ok(html.includes("<td>예시시 예시로 12 건물주 귀하</td>"));
  assert.ok(html.includes("<b>예시시 예시로 12 건물주</b> 귀하"));
  assert.ok(!html.includes("홍길동"));
  assert.doesNotMatch(html, /님 귀하|님<\/b> 귀하/);
  report.siteAddress = "";
  assert.ok(createWorkReportHtml(report).includes("<td>건물주 귀하</td>"));
});

test("고객 단위 보고서는 고객 이름(buildingName) 대신 현장 주소를 현장·제목으로 쓴다", () => {
  const report = Core.normalizeReport({ id: "qa_customer", kind: "moveIn", customerId: "c1", buildingName: "홍길동_별명집", siteAddress: "예시시 예시로 7", workDate: "2026-10-06" });
  report.items[0].after = [photo("a")];
  const html = createWorkReportHtml(report);
  assert.ok(!html.includes("홍길동"), "고객 실명·별명이 문서에 나가면 안 된다");
  assert.ok(html.includes("<th>현장 주소</th><td>예시시 예시로 7</td>"));
  assert.ok(!html.includes("<th>현장</th>"), "주소와 같은 값을 현장 칸에 두 번 싣지 않는다");
  assert.match(html, /<th>제목<\/th><td>예시시 예시로 7 입주청소 작업 결과 보고/);
  // 주소도 없으면 '현장' 으로 쓴다.
  const bare = Core.normalizeReport({ id: "qa_bare", kind: "moveIn", customerId: "c1", buildingName: "홍길동", workDate: "2026-10-06" });
  bare.items[0].after = [photo("b")];
  const bareHtml = createWorkReportHtml(bare);
  assert.ok(!bareHtml.includes("홍길동"));
  assert.ok(bareHtml.includes("<th>제목</th><td>입주청소 작업 결과 보고"), "주소가 없으면 제목에 '현장' 을 붙이지 않는다");
  assert.ok(!bareHtml.includes("<th>현장</th>"));
  // 연결된 건물이 있으면 건물명을 그대로 쓴다.
  const linked = Core.normalizeReport({ id: "qa_building", kind: "moveIn", buildingId: "b1", buildingName: "예시 빌딩", workDate: "2026-10-06" });
  linked.items[0].after = [photo("c")];
  assert.ok(createWorkReportHtml(linked).includes("<th>현장</th><td>예시 빌딩</td>"));
});

test("본문 글꼴은 문서에 박은 Pretendard 이고 없으면 시스템 글꼴로 대신한다", () => {
  const report = seed(); report.items[0].after = [photo("a")];
  const html = createWorkReportHtml(report);
  assert.match(html, /@font-face\{font-family:"Pretendard";src:url\(data:font\/woff2;base64,/);
  assert.match(html, /font-family:"Pretendard","Malgun Gothic"/);
  assert.match(html, /font-src data:/);
});


test("pairId 로 묶인 사진만 나란히 짝짓고 나머지는 단계별로 싣는다", () => {
  const report = seed();
  const item = report.items[1];
  item.before = [{ id: "b1", driveFileId: "b1", pairId: "a2|b1" }, { id: "b2", driveFileId: "b2" }, { id: "b3", driveFileId: "b3" }];
  item.after = [{ id: "a1", driveFileId: "a1" }, { id: "a2", driveFileId: "a2", pairId: "a2|b1" }];
  const normalized = Core.normalizeReport(report);
  assert.equal(normalized.items[1].before[0].pairId, "a2|b1", "pairId 는 정규화 뒤에도 남는다");
  assert.equal(normalized.items[1].before[1].pairId, undefined);
  const html = createWorkReportHtml(normalized);
  assert.equal((html.match(/class="pair"/g) || []).length, 1);
  assert.match(html, /<div class="pair"><p class="pair-label">같은 위치 1<\/p><div class="pair-body"><figure class="shot before">[\s\S]*?<b class="tag">작업 전<\/b>[\s\S]*?<span class="arrow">→<\/span><figure class="shot after">[\s\S]*?<b class="tag">작업 후<\/b>/);
  assert.ok(html.includes("같은 장소로 확인된 1쌍을 나란히 비교하고, 나머지 작업 전 2장·작업 후 1장은 아래에 단계별로 실었습니다."));
  // 잘못된 pairId 는 저장 모양에서 빠진다.
  assert.equal(Core.normalizePhoto({ id: "x", driveFileId: "x", pairId: "bad id<" }).pairId, undefined);
});
