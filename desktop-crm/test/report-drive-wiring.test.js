const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const MutationPolicy = require("../src/mutation-policy");
const W = require("../src/work-report-core");
const P = require("../src/report-photo-plan");
const read = name => fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const appSource = read("app.js");
const mainSource = read("main.js");
const preloadSource = read("preload.js");
const indexSource = read("index.html");
const pdfSource = read("work-report-pdf.js");
const driveSource = read("building-docs-drive.js");
const stylesSource = read("styles.css");

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) return "";
  const end = source.indexOf("\n  function ", start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}

function topLevelBody(source, name) {
  const start = source.indexOf(`async function ${name}(`);
  if (start < 0) return "";
  const end = source.indexOf("\nasync function ", start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}

test("훑기 통로가 모두 등록돼 있고 읽기로 분류된다", () => {
  for (const channel of ["crm:work-report-photos-scan", "crm:work-report-drive-browse", "crm:work-report-drive-thumbnail", "crm:work-report-drive-plan"]) {
    assert.doesNotThrow(() => MutationPolicy.assertRegistered(channel));
    // 아무것도 안 바꾼다. 바꾸는 것으로 분류하면 필요 없는 권한을 쓴다.
    assert.equal(MutationPolicy.classification(channel), "control");
    assert.ok(mainSource.includes(`"${channel}"`));
    assert.ok(preloadSource.includes(`"${channel}"`));
  }
  // 새 선택기는 오직 메인 CRM 문서에서만 호출할 수 있다.
  assert.ok(mainSource.includes('secureCanonicalHandle("crm:work-report-drive-browse"'));
  assert.ok(mainSource.includes('secureCanonicalHandle("crm:work-report-drive-thumbnail"'));
  assert.ok(mainSource.includes('secureCanonicalHandle("crm:work-report-drive-plan"'));
});

test("마케팅 전용 계정은 사진을 훑지 못한다", () => {
  // 폴더 이름과 사진 목록에 건물주 이름과 현장이 다 드러난다.
  const body = topLevelBody(mainSource, "scanWorkReportPhotos");
  assert.match(body, /MARKETING_ONLY_FORBIDDEN/u);
  assert.match(body, /DRIVE_AUTH_REQUIRED/u);
  assert.match(body, /FOLDER_REQUIRED/u);
});

test("훑을 때 사진을 받아 오지 않는다", () => {
  // 스무 장을 받아 오면 그동안 화면이 멈춘다. 초안에 필요한 것은 이름과
  // 시각뿐이다. 사진은 인쇄할 때 받는다.
  const body = topLevelBody(mainSource, "scanWorkReportPhotos");
  assert.doesNotMatch(body, /downloadFile/u);
  assert.match(body, /BuildingDocsDrive\.scanPhotoFolder/u);
});

test("Drive 를 두 층까지만 훑는다", () => {
  // 깊이 제한이 없으면 실수로 Drive 전체를 훑다가 멈춘다.
  assert.match(driveSource, /async function scanPhotoFolder\(/u);
  assert.match(driveSource, /maxFolders\) > 0 \? Number\(settings\.maxFolders\) : 30/u);
  assert.match(driveSource, /maxPages\) > 0 \? Number\(settings\.maxPages\) : 5/u);
  // 다 못 읽었으면 다 읽은 척하지 않는다.
  assert.match(driveSource, /truncated/u);
  const body = mainSource.slice(mainSource.indexOf("async function scanWorkReportPhotos("));
  assert.match(body.slice(0, 2000), /scanned\.truncated/u, "덜 읽었으면 화면에 말해야 한다");
});

test("결과보고서 화면은 주소 입력 대신 Drive 파일 선택기를 쓴다", () => {
  const source = functionBody(appSource, "reportDriveBox");
  assert.match(source, /data-report-drive-open/u);
  assert.match(source, /Drive에서 사진 선택/u);
  assert.doesNotMatch(source, /data-report-drive-id|data-report-drive-name/u);
  assert.match(appSource, /function reportDrivePicker\(/u);
  assert.match(appSource, /data-report-drive-file/u);
  assert.match(appSource, /data-report-drive-folder/u);
  assert.match(appSource, /선택한 사진 가져오기/u);
});

test("현재 화면의 사진을 모두 선택하고 같은 버튼으로 모두 해제한다", () => {
  const picker = functionBody(appSource, "reportDrivePicker");
  assert.match(picker, /data-report-drive-select-all/u);
  assert.match(picker, /allCurrentFilesSelected \? "모두 해제" : "모두 선택"/u);
  assert.match(picker, /aria-pressed/u);

  const visible = functionBody(appSource, "visibleReportDriveFileControls");
  assert.match(visible, /\[data-report-drive-file\]/u);
  assert.match(visible, /!control\.hidden/u, "검색으로 숨긴 사진은 모두 선택 범위에 넣지 않는다");

  const toggleAll = functionBody(appSource, "toggleAllVisibleReportDriveFiles");
  assert.match(toggleAll, /visibleReportDriveFileControls\(\)/u);
  assert.match(toggleAll, /entry\.kind === "file"/u);
  assert.match(toggleAll, /allSelected/u);
  assert.match(toggleAll, /driveSelected\.delete\(id\)/u);
  assert.match(toggleAll, /driveSelected\.set\(id, entries\.get\(id\)\)/u);
  assert.match(toggleAll, /driveSelected\.size >= 100/u, "전체 선택도 기존 100장 제한을 지킨다");
  assert.match(toggleAll, /syncReportDriveSelectionControls\(\)/u);

  assert.match(appSource, /closest\("\[data-report-drive-select-all\]"\)[^\n]*toggleAllVisibleReportDriveFiles\(\)/u);
  const searchHandler = appSource.slice(appSource.indexOf('event.target.matches("[data-report-drive-search]")'));
  assert.match(searchHandler.slice(0, 1000), /syncReportDriveSelectionControls\(\)/u, "검색 결과가 달라지면 버튼 상태도 다시 계산한다");
});

test("사진 선택기는 내 드라이브와 공유 문서함, 공유 드라이브를 오갈 수 있다", () => {
  const picker = functionBody(appSource, "reportDrivePicker");
  assert.match(picker, /data-report-drive-space="my"/u);
  assert.match(picker, /data-report-drive-space="shared-with-me"/u);
  assert.match(picker, /data-report-drive-space="shared"/u);
  assert.match(picker, /공유 문서함/u);
  assert.match(picker, /공유 드라이브 열기/u);
  assert.match(appSource, /async function loadReportSharedWithMe\(/u);
  assert.match(appSource, /async function loadReportSharedDrives\(/u);
  assert.match(appSource, /async function switchReportDriveSpace\(/u);
  assert.match(appSource, /location: "shared-with-me"/u);
  assert.match(appSource, /location: "shared-drives"/u);
});

test("공유 문서함도 서버가 실제로 나열한 폴더와 사진만 허용한다", () => {
  const browse = topLevelBody(mainSource, "browseWorkReportDrive");
  assert.match(browse, /BuildingDocsDrive\.listSharedWithMe/u);
  assert.match(browse, /parentId: "shared-with-me"/u);
  assert.match(browse, /folders\.forEach\(item => picker\.folders\.set\(item\.id, item\)\)/u);
  assert.match(browse, /picker\.files\.set\(item\.id, publicFile\)/u);
  assert.match(browse, /picker\.folders\.has\(folderId\)/u);
});

test("공유 드라이브는 서버가 실제로 나열한 ID만 폴더로 허용한다", () => {
  const browse = topLevelBody(mainSource, "browseWorkReportDrive");
  assert.match(browse, /BuildingDocsDrive\.listSharedDrives/u);
  assert.match(browse, /picker\.drives\.set\(item\.id, item\)/u);
  assert.match(browse, /picker\.folders\.set\(item\.id, item\)/u);
  assert.match(browse, /picker\.folders\.has\(folderId\)/u);
  assert.match(browse, /driveId: String\(current && current\.driveId/u);
});

test("Drive 탐색기는 토큰과 사진 원본을 렌더러로 보내지 않는다", () => {
  const browse = topLevelBody(mainSource, "browseWorkReportDrive");
  assert.match(browse, /reportDrivePickerReady\(\)/u);
  assert.match(browse, /picker\.folders\.has\(folderId\)/u);
  assert.match(browse, /REPORT_DRIVE_IMAGE_MIME/u);
  assert.doesNotMatch(browse.slice(browse.lastIndexOf("return {")), /accessToken/u, "반환 객체에 토큰을 싣지 않아야 한다");
  assert.doesNotMatch(browse, /downloadFile|alt=media|arrayBuffer/u, "선택 단계에서 사진 원본을 받지 않아야 한다");
  assert.match(browse, /files\.map\(reportDrivePublicFile\)/u, "비공개 썸네일 주소를 목록 응답에서 제거해야 한다");
  const publicFile = mainSource.slice(mainSource.indexOf("function reportDrivePublicFile("), mainSource.indexOf("function reportDrivePickerReady("));
  assert.doesNotMatch(publicFile, /thumbnailLink|accessToken/u);
});

test("사진 미리보기는 표시된 파일만 작게, 보이는 순서대로 불러온다", () => {
  const thumbnail = topLevelBody(mainSource, "loadWorkReportDriveThumbnail");
  assert.match(thumbnail, /picker\.files\.has\(fileId\)/u);
  assert.match(thumbnail, /DRIVE_FILE_NOT_LISTED/u);
  assert.match(mainSource, /REPORT_DRIVE_THUMBNAIL_MAX_BYTES = 512 \* 1024/u);
  assert.match(mainSource, /redirect: "manual"/u);
  assert.match(mainSource, /reportDriveThumbnailLink\(new URL\(location, current\)\.toString\(\)\)/u);
  assert.match(mainSource, /REPORT_DRIVE_THUMBNAIL_MIME\.has\(mimeType\)/u);
  assert.match(appSource, /data-report-drive-thumbnail/u);
  assert.match(appSource, /new IntersectionObserver/u);
  assert.match(appSource, /api\.loadWorkReportDriveThumbnail\(\{ fileId \}\)/u);
});

test("Drive 선택창은 화면 안에 고정되고 사진 목록만 스크롤된다", () => {
  assert.match(stylesSource, /\.wr-drive-picker \{[^}]*grid-template-rows: auto minmax\(0,1fr\) auto/u);
  assert.match(stylesSource, /\.wr-drive-picker-body \{[^}]*min-height: 0;[^}]*overflow: hidden/u);
  assert.match(stylesSource, /\.wr-drive-browser \{[^}]*flex-direction: column;[^}]*min-height: 0;[^}]*overflow: hidden/u);
  assert.match(stylesSource, /\.wr-drive-entry-grid \{[^}]*overflow-y: auto/u);
  assert.match(stylesSource, /\.wr-drive-entry-preview img \{[^}]*object-fit: cover/u);
  assert.match(stylesSource, /\.wr-drive-picker>footer>div \{[^}]*flex-wrap: wrap/u, "버튼 셋이 좁은 화면에서 겹치지 않아야 한다");
});

test("선택한 사진 계획은 화면에 실제로 표시한 파일만 허용한다", () => {
  const plan = topLevelBody(mainSource, "planSelectedWorkReportPhotos");
  assert.match(plan, /REPORT_DRIVE_MAX_FILES/u);
  assert.match(plan, /picker\.files\.get\(id\)/u);
  assert.match(plan, /DRIVE_FILE_NOT_LISTED/u);
  assert.match(plan, /ReportPhotoPlan\.planFromTree/u);
  assert.match(plan, /buildingName: String\(options\.buildingName/u);
  assert.doesNotMatch(plan, /downloadFile|alt=media|arrayBuffer/u);
});

test("Drive 사진 선택 전에 CRM 건물을 먼저 고르게 한다", () => {
  const open = functionBody(appSource, "openReportDrivePicker");
  assert.match(open, /preserveReportDraft\(\)/u);
  assert.match(open, /!reportState\.draft\.buildingId/u);
  assert.match(open, /건물을 먼저 골라 주세요/u);
  const plan = functionBody(appSource, "planSelectedReportDrivePhotos");
  assert.match(plan, /buildingName: reportState\.draft/u);
  assert.match(appSource, /HEIC · PDF에서 자동 변환/u);
});

test("끌어온 것이 사람이 적은 것을 덮지 않는다", () => {
  // 사람이 이미 적어 둔 비고와 상태가 사라지면, 다시 적을 사람은 없다.
  const body = functionBody(appSource, "applyReportDrivePlan");
  assert.match(body, /before: item\.before\.concat\(found\.before\)/u);
  assert.match(body, /after: item\.after\.concat\(found\.after\)/u);
  assert.match(body, /note: item\.note \|\| found\.note/u);
  // 저장은 사람이 누를 때만. 여기서 서버로 보내지 않는다.
  assert.doesNotMatch(body, /api\.saveWorkReport/u);
});

test("화면과 규칙이 같은 모듈을 쓴다", () => {
  // 화면이 항목 잇는 표를 따로 들면 서버와 어긋난다.
  const body = functionBody(appSource, "applyReportDrivePlan");
  assert.match(body, /P\.toReportDraft\(plan, \{ core: R, kind: draft\.kind \}\)/u);
  assert.ok(indexSource.includes('<script src="./report-photo-plan.js"></script>'));
  // main.js 도 같은 모듈을 쓴다.
  assert.match(mainSource, /const ReportPhotoPlan = require\("\.\/report-photo-plan"\)/u);
  assert.match(mainSource, /ReportPhotoPlan\.planFromTree/u);
});

test("쓰던 양식의 칸이 화면·자료·인쇄에 다 있다", () => {
  // 종이 양식에 있는데 화면에 없으면 사람은 다시 손으로 적는다.
  const report = W.normalizeReport({});
  ["category", "ownerName", "ownerContact", "followUp"].forEach(key => {
    assert.ok(Object.prototype.hasOwnProperty.call(report, key), `${key} 가 자료에 없다`);
    assert.ok(appSource.includes(`name="${key}"`), `${key} 가 화면에 없다`);
    assert.ok(appSource.includes(`raw.${key}`), `${key} 를 화면이 안 읽는다`);
  });
  ["문서번호", "요청자(건물주)", "연락 방식", "후속 필요 사항", "확인자(건물주)"].forEach(label => {
    assert.ok(pdfSource.includes(label), `${label} 이 인쇄물에 없다`);
  });
});

test("안내 세 줄은 어느 보고서에도 빠지지 않는다", () => {
  // 이 세 줄은 우리가 지키기로 한 것이다. 빠진 보고서가 한 장이라도
  // 나가면 지키기로 한 것이 아니게 된다.
  assert.equal(W.NOTICES.length, 3);
  assert.match(W.NOTICES[0], /열쇠·출입 비밀번호/u);
  assert.match(W.NOTICES[1], /법정 의무점검/u);
  assert.match(W.NOTICES[2], /비용 부담 비율/u);
  assert.match(pdfSource, /WorkReportCore\.NOTICES\.map/u);
  // 사람이 끌 수 있는 자리가 없어야 한다.
  assert.doesNotMatch(pdfSource, /NOTICES[\s\S]{0,80}\?/u);
});

test("문서번호는 같은 보고서면 늘 같다", () => {
  // 사람이 매기면 겹치거나 빠진다. 볼 때마다 달라져도 안 된다.
  const report = { id: "wr_abc1234", kind: "stairs", workDate: "2026-09-06" };
  assert.equal(W.documentNo(report), W.documentNo(report));
  assert.equal(W.documentNo(report), "BR-20260906-STA-1234");
  assert.notEqual(W.documentNo(report), W.documentNo({ ...report, workDate: "2026-09-07" }));
});

test("폴더 잇는 표가 진짜 항목만 가리킨다", () => {
  Object.entries(P.FOLDER_HINTS).forEach(([kind, table]) => {
    const keys = W.itemsFor(kind, []).map(item => item.key);
    Object.values(table).forEach(itemKey => assert.ok(keys.includes(itemKey), `${kind}/${itemKey}`));
  });
});

test("새 화면이 없는 클래스에 기대지 않는다", () => {
  const body = functionBody(appSource, "reportDriveBox");
  const used = [...body.matchAll(/class="([^"$]*)"/gu)]
    .flatMap(match => match[1].split(/\s+/u))
    .filter(name => name.startsWith("wr-drive"));
  const css = read("styles.css");
  assert.ok(used.length > 0);
  new Set(used).forEach(name => assert.ok(css.includes(`.${name}`), `${name} 에 CSS 규칙이 없다`));
});
