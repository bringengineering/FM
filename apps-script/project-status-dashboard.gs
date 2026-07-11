/**
 * 브링FM 프로젝트 현황표 자동화 (우선순위 정리 + To-Do + 대시보드)
 *
 * 설치 위치: 아래 SPREADSHEET_ID 시트의 확장 프로그램 > Apps Script
 * 최초 1회 실행: setupProjectStatus()
 *
 * 동작
 *  - "과업입력" 탭에 과업만 적으면 우선순위 점수/등급/D-Day가 자동 계산됩니다.
 *  - "우선순위ToDo" 탭에 미완료 과업이 점수 높은 순으로 자동 정렬됩니다.
 *  - "대시보드"(맨 앞 = 시트1) 탭에 정량/정성 지표가 실시간으로 자동 갱신됩니다.
 */

const PS_CONFIG = {
  SPREADSHEET_ID: "1u01R6dh7jBRYpCykNdu0jYCchvmTLzrxUfBXZ2pn3lc",
  WEEK_LABEL: "2026년 7월 2주차 (7/6 ~ 7/12)",
  MAX_ROWS: 200, // 과업 입력 최대 행
};

const PS_SHEETS = {
  DASH: "대시보드",
  INPUT: "과업입력",
  TODO: "우선순위ToDo",
  CONFIG: "설정",
};

const PS_COLOR = {
  NAVY: "#1F2A44",
  BLUE: "#2F5BEA",
  GREEN: "#1E7F4F",
  GREY: "#F2F4F8",
  DGREY: "#5B6472",
  WHITE: "#FFFFFF",
  YELLOW_L: "#FEF6E0",
  GREEN_L: "#E4F5EC",
  RED_L: "#FCE8E6",
  RED: "#C0392B",
  YELLOW: "#B8860B",
  BLUE_L: "#E8EEFF",
};

const PS_CATEGORIES = ["기획", "개발", "디자인", "마케팅", "리서치", "운영", "기타"];
const PS_STATUSES = ["대기", "진행중", "완료", "보류"];
const PS_OWNERS = ["김지훈", "박서연", "이도현", "최유진", "정하늘"];

const PS_HEAD = [
  "과업명", "담당자", "카테고리", "중요도(1-5)", "긴급도(1-5)", "마감일",
  "예상공수(h)", "진행상태", "진척률(%)", "우선순위점수", "등급", "D-Day", "비고/메모",
];

// ─────────────────────────────────────────────────────────────
// 메뉴 / 트리거
// ─────────────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("📊 프로젝트 현황")
    .addItem("① 현황표 만들기 / 다시 만들기", "setupProjectStatus")
    .addItem("② 예시 과업 채우기", "fillSampleTasks")
    .addSeparator()
    .addItem("지금 새로고침", "touchDashboard")
    .addToUi();
}

/** 과업입력을 수정할 때마다 대시보드 최종 업데이트 시각을 남깁니다(수식은 이미 자동 갱신됨). */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    if (e.range.getSheet().getName() !== PS_SHEETS.INPUT) return;
    const ss = e.source || SpreadsheetApp.getActiveSpreadsheet();
    const dash = ss.getSheetByName(PS_SHEETS.DASH);
    if (dash) dash.getRange("H2").setValue(new Date());
  } catch (err) {
    // onEdit 실패는 무시 (수식 자동 계산에는 영향 없음)
  }
}

function touchDashboard() {
  const ss = _ps_ss();
  const dash = ss.getSheetByName(PS_SHEETS.DASH);
  if (dash) dash.getRange("H2").setValue(new Date());
  SpreadsheetApp.flush();
}

function _ps_ss() {
  return PS_CONFIG.SPREADSHEET_ID
    ? SpreadsheetApp.openById(PS_CONFIG.SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

// ─────────────────────────────────────────────────────────────
// 메인 빌더
// ─────────────────────────────────────────────────────────────
function setupProjectStatus() {
  const ss = _ps_ss();

  const cfg = _ps_resetSheet(ss, PS_SHEETS.CONFIG);
  const inp = _ps_resetSheet(ss, PS_SHEETS.INPUT);
  const todo = _ps_resetSheet(ss, PS_SHEETS.TODO);
  const dash = _ps_resetSheet(ss, PS_SHEETS.DASH);

  _ps_buildConfig(cfg);
  _ps_buildInput(inp);
  _ps_buildTodo(todo);
  _ps_buildDashboard(dash);

  // 대시보드를 맨 앞(시트1 위치)으로
  ss.setActiveSheet(dash);
  ss.moveActiveSheet(1);

  // 기본으로 예시 과업이 없으면 하나 채워서 대시보드가 비지 않도록
  if (inp.getRange("A2").getValue() === "") fillSampleTasks();

  SpreadsheetApp.flush();
  try {
    SpreadsheetApp.getUi().alert("완료!  '대시보드' / '과업입력' / '우선순위ToDo' 탭이 생성되었습니다.");
  } catch (err) {}
}

function _ps_resetSheet(ss, name) {
  let sh = ss.getSheetByName(name);
  if (sh) {
    sh.clear();
    sh.clearConditionalFormatRules();
    const dvs = sh.getDataRange();
    if (dvs) dvs.clearDataValidations();
  } else {
    sh = ss.insertSheet(name);
  }
  return sh;
}

// ─────────────────────────────────────────────────────────────
// 설정 시트
// ─────────────────────────────────────────────────────────────
function _ps_buildConfig(sh) {
  sh.getRange("A1").setValue("카테고리");
  sh.getRange("C1").setValue("진행상태");
  sh.getRange("E1").setValue("담당자");
  ["A1", "C1", "E1"].forEach((a) =>
    sh.getRange(a).setFontWeight("bold").setFontColor(PS_COLOR.WHITE).setBackground(PS_COLOR.NAVY)
  );
  PS_CATEGORIES.forEach((v, i) => sh.getRange(i + 2, 1).setValue(v));
  PS_STATUSES.forEach((v, i) => sh.getRange(i + 2, 3).setValue(v));
  PS_OWNERS.forEach((v, i) => sh.getRange(i + 2, 5).setValue(v));

  sh.getRange("A11").setValue("우선순위 산정식").setFontWeight("bold").setFontColor(PS_COLOR.NAVY);
  sh.getRange("A12").setValue("점수 = 중요도×3 + 긴급도×3 + 마감가중(최대15) − 진척감점(최대5)");
  sh.getRange("A13").setValue("등급: 🔴P1 ≥30 · 🟡P2 ≥18 · 🟢P3 <18 · ✅완료");
  sh.getRange("A12:A13").setFontColor(PS_COLOR.DGREY).setFontSize(9);
  sh.setColumnWidth(1, 130);
  sh.setColumnWidth(3, 110);
  sh.setColumnWidth(5, 110);
}

// ─────────────────────────────────────────────────────────────
// 과업입력 시트
// ─────────────────────────────────────────────────────────────
function _ps_buildInput(sh) {
  const last = PS_CONFIG.MAX_ROWS + 1; // 데이터 마지막 행
  const cfg = PS_SHEETS.CONFIG;

  // 헤더
  sh.getRange(1, 1, 1, PS_HEAD.length).setValues([PS_HEAD]);
  sh.getRange(1, 1, 1, PS_HEAD.length)
    .setFontWeight("bold").setFontColor(PS_COLOR.WHITE)
    .setBackground(PS_COLOR.NAVY).setHorizontalAlignment("center")
    .setVerticalAlignment("middle").setWrap(true);
  sh.setRowHeight(1, 34);
  sh.setFrozenRows(1);
  sh.setFrozenColumns(1);

  // 자동 계산 수식 (열려있는 범위 → 새 행 자동 확장)
  sh.getRange("L2").setFormula('=ARRAYFORMULA(IF(F2:F="","",F2:F-TODAY()))');
  sh.getRange("J2").setFormula(
    '=ARRAYFORMULA(IF(A2:A="","",IF(H2:H="완료",0,' +
    'D2:D*3+E2:E*3+IF(F2:F="",0,IF(L2:L<0,15,IF(L2:L>15,0,15-L2:L)))-(IF(I2:I="",0,I2:I)/100)*5)))'
  );
  sh.getRange("K2").setFormula(
    '=ARRAYFORMULA(IF(A2:A="","",IF(H2:H="완료","✅완료",' +
    'IF(J2:J>=30,"🔴 P1",IF(J2:J>=18,"🟡 P2","🟢 P3")))))'
  );

  // 서식
  sh.getRange(2, 6, PS_CONFIG.MAX_ROWS, 1).setNumberFormat("yyyy-mm-dd");
  sh.getRange(2, 10, PS_CONFIG.MAX_ROWS, 1).setNumberFormat("0.0");
  sh.getRange(2, 12, PS_CONFIG.MAX_ROWS, 1).setNumberFormat("+0;-0;0");
  sh.getRange(2, 10, PS_CONFIG.MAX_ROWS, 3).setBackground(PS_COLOR.YELLOW_L); // J,K,L 자동칸
  sh.getRange(2, 10, PS_CONFIG.MAX_ROWS, 3).setHorizontalAlignment("center");
  sh.getRange(2, 4, PS_CONFIG.MAX_ROWS, 6).setHorizontalAlignment("center"); // D~I 가운데

  // 열 너비
  const widths = [190, 80, 80, 70, 70, 100, 80, 80, 70, 80, 78, 70, 220];
  widths.forEach((w, i) => sh.setColumnWidth(i + 1, w));

  // 데이터 유효성(드롭다운 / 숫자범위)
  const cfgSheet = sh.getParent().getSheetByName(cfg);
  const rng = (c) => sh.getRange(2, c, PS_CONFIG.MAX_ROWS, 1);
  const listFromRange = (a1) =>
    SpreadsheetApp.newDataValidation()
      .requireValueInRange(cfgSheet.getRange(a1), true)
      .setAllowInvalid(false).build();
  rng(2).setDataValidation(listFromRange("E2:E6")); // 담당자
  rng(3).setDataValidation(listFromRange("A2:A8")); // 카테고리
  rng(8).setDataValidation(listFromRange("C2:C5")); // 진행상태
  const num = (min, max) =>
    SpreadsheetApp.newDataValidation().requireNumberBetween(min, max).setAllowInvalid(false).build();
  rng(4).setDataValidation(num(1, 5));
  rng(5).setDataValidation(num(1, 5));
  rng(9).setDataValidation(num(0, 100));

  // 조건부 서식
  const area = sh.getRange(2, 1, PS_CONFIG.MAX_ROWS, PS_HEAD.length);
  const kcol = sh.getRange(2, 11, PS_CONFIG.MAX_ROWS, 1);
  const lcol = sh.getRange(2, 12, PS_CONFIG.MAX_ROWS, 1);
  const rules = [
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$H2="완료"').setBackground(PS_COLOR.GREEN_L).setRanges([area]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$K2="🔴 P1"').setBackground(PS_COLOR.RED_L)
      .setFontColor(PS_COLOR.RED).setBold(true).setRanges([kcol]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$K2="🟡 P2"').setBackground(PS_COLOR.YELLOW_L)
      .setFontColor(PS_COLOR.YELLOW).setBold(true).setRanges([kcol]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($L2<>"",$L2<0,$H2<>"완료")').setBackground(PS_COLOR.RED_L)
      .setFontColor(PS_COLOR.RED).setBold(true).setRanges([lcol]).build(),
  ];
  sh.setConditionalFormatRules(rules);
}

// ─────────────────────────────────────────────────────────────
// 우선순위 To-Do 시트 (자동 정렬)
// ─────────────────────────────────────────────────────────────
function _ps_buildTodo(sh) {
  const inp = PS_SHEETS.INPUT;
  const head = ["순위"].concat(PS_HEAD);
  sh.getRange(1, 1, 1, head.length).setValues([head]);
  sh.getRange(1, 1, 1, head.length)
    .setFontWeight("bold").setFontColor(PS_COLOR.WHITE)
    .setBackground(PS_COLOR.GREEN).setHorizontalAlignment("center")
    .setVerticalAlignment("middle").setWrap(true);
  sh.setRowHeight(1, 34);
  sh.setFrozenRows(1);

  sh.getRange("A2").setFormula('=ARRAYFORMULA(IF(B2:B="","",ROW(B2:B)-1))');
  sh.getRange("B2").setFormula(
    '=IFERROR(SORT(FILTER(' + inp + '!A2:M,(' + inp + '!A2:A<>"")*(' + inp + '!H2:H<>"완료")),10,FALSE),' +
    '"미완료 과업이 없습니다")'
  );

  const widths = [50, 190, 80, 80, 70, 70, 100, 80, 80, 70, 80, 78, 70, 220];
  widths.forEach((w, i) => sh.setColumnWidth(i + 1, w));
  sh.getRange(2, 5, 300, 9).setHorizontalAlignment("center");
}

// ─────────────────────────────────────────────────────────────
// 대시보드 시트 (정량 + 정성)
// ─────────────────────────────────────────────────────────────
function _ps_buildDashboard(sh) {
  const I = PS_SHEETS.INPUT;
  const A = I + "!A2:A", H = I + "!H2:H", G = I + "!G2:G",
        P = I + "!I2:I", K = I + "!K2:K", L = I + "!L2:L", C = I + "!C2:C", B = I + "!B2:B";

  // 제목
  sh.getRange("A1:H1").merge().setValue("📊  브링FM 프로젝트 현황 대시보드")
    .setFontWeight("bold").setFontColor(PS_COLOR.WHITE).setFontSize(15)
    .setBackground(PS_COLOR.NAVY).setVerticalAlignment("middle");
  sh.setRowHeight(1, 40);
  sh.getRange("A2").setValue("대상 주차: " + PS_CONFIG.WEEK_LABEL).setFontColor(PS_COLOR.DGREY);
  sh.getRange("E2").setValue("기준일:").setFontColor(PS_COLOR.DGREY).setFontWeight("bold");
  sh.getRange("F2").setFormula("=TODAY()").setNumberFormat("yyyy-mm-dd");
  sh.getRange("G2").setValue("최종수정:").setFontColor(PS_COLOR.DGREY).setFontWeight("bold");
  sh.getRange("H2").setNumberFormat("mm-dd hh:mm");

  const section = (a1, txt) =>
    sh.getRange(a1).setValue(txt).setFontWeight("bold").setFontColor(PS_COLOR.NAVY).setFontSize(12);

  // ① 정량 지표
  section("A4", "①  정량 지표 (Quantitative)");
  const kpiL = [
    ["총 과업", '=COUNTA(' + A + ')'],
    ["완료", '=COUNTIF(' + H + ',"완료")'],
    ["진행중", '=COUNTIF(' + H + ',"진행중")'],
    ["대기", '=COUNTIF(' + H + ',"대기")'],
    ["보류", '=COUNTIF(' + H + ',"보류")'],
    ["완료율", '=IFERROR(B6/B5,0)'],
    ["평균 진척률(%)", '=IFERROR(AVERAGEIF(' + A + ',"<>",' + P + '),0)'],
    ["지연(마감초과·미완료)", '=COUNTIFS(' + L + ',"<0",' + H + ',"<>완료")'],
  ];
  const kpiR = [
    ["총 예상공수(h)", '=SUM(' + G + ')'],
    ["완료 공수(h)", '=SUMIF(' + H + ',"완료",' + G + ')'],
    ["잔여 공수(h)", '=E5-E6'],
    ["🔴 P1 과업", '=COUNTIF(' + K + ',"🔴 P1")'],
    ["🟡 P2 과업", '=COUNTIF(' + K + ',"🟡 P2")'],
    ["🟢 P3 과업", '=COUNTIF(' + K + ',"🟢 P3")'],
    ["미완료 과업", '=B5-B6'],
    ["오늘 마감(미완료)", '=COUNTIFS(' + L + ',0,' + H + ',"<>완료")'],
  ];
  for (let i = 0; i < kpiL.length; i++) {
    const r = 5 + i;
    sh.getRange(r, 1).setValue(kpiL[i][0]).setFontColor(PS_COLOR.DGREY).setBackground(PS_COLOR.GREY);
    sh.getRange(r, 2).setFormula(kpiL[i][1]).setFontWeight("bold").setFontColor(PS_COLOR.NAVY)
      .setBackground(PS_COLOR.GREY).setHorizontalAlignment("center");
    sh.getRange(r, 4).setValue(kpiR[i][0]).setFontColor(PS_COLOR.DGREY).setBackground(PS_COLOR.GREY);
    sh.getRange(r, 5).setFormula(kpiR[i][1]).setFontWeight("bold").setFontColor(PS_COLOR.NAVY)
      .setBackground(PS_COLOR.GREY).setHorizontalAlignment("center");
  }
  sh.getRange("B10").setNumberFormat("0%");
  sh.getRange("B11").setNumberFormat("0");

  // ② 카테고리별
  section("A14", "②  카테고리별 현황");
  sh.getRange(15, 1, 1, 5).setValues([["카테고리", "과업수", "완료", "완료율", "예상공수(h)"]])
    .setFontWeight("bold").setFontColor(PS_COLOR.WHITE).setBackground(PS_COLOR.BLUE)
    .setHorizontalAlignment("center");
  PS_CATEGORIES.forEach((cat, i) => {
    const r = 16 + i;
    sh.getRange(r, 1).setValue(cat);
    sh.getRange(r, 2).setFormula('=COUNTIF(' + C + ',A' + r + ')');
    sh.getRange(r, 3).setFormula('=COUNTIFS(' + C + ',A' + r + ',' + H + ',"완료")');
    sh.getRange(r, 4).setFormula('=IFERROR(C' + r + '/B' + r + ',0)').setNumberFormat("0%");
    sh.getRange(r, 5).setFormula('=SUMIF(' + C + ',A' + r + ',' + G + ')');
    sh.getRange(r, 2, 1, 4).setHorizontalAlignment("center");
  });

  // ③ 담당자별
  section("G14", "③  담당자별 부하");
  sh.getRange(15, 7, 1, 3).setValues([["담당자", "미완료", "잔여공수(h)"]])
    .setFontWeight("bold").setFontColor(PS_COLOR.WHITE).setBackground(PS_COLOR.BLUE)
    .setHorizontalAlignment("center");
  PS_OWNERS.forEach((own, i) => {
    const r = 16 + i;
    sh.getRange(r, 7).setValue(own);
    sh.getRange(r, 8).setFormula('=COUNTIFS(' + B + ',G' + r + ',' + H + ',"<>완료")');
    sh.getRange(r, 9).setFormula('=SUMIFS(' + G + ',' + B + ',G' + r + ',' + H + ',"<>완료")');
    sh.getRange(r, 8, 1, 2).setHorizontalAlignment("center");
  });

  // ④ 정성 요약
  section("A25", "④  정성 요약 (Qualitative)");
  const T = PS_SHEETS.TODO;
  const qual = [
    ["한 줄 브리핑",
      '="총 "&B5&"건 · 완료 "&B6&"건("&TEXT(B10,"0%")&") · 진행중 "&B7&"건 · 대기 "&B8&"건 · 🔴지연 "&B12&"건"'],
    ["이번 주 최우선(Top3)",
      '=IFERROR(' + T + '!B2&" ["&' + T + '!L2&"] / "&' + T + '!B3&" ["&' + T + '!L3&"] / "&' + T + '!B4&" ["&' + T + '!L4&"],"—")'],
    ["⚠️ 지연 리스크",
      '=IFERROR(TEXTJOIN(" · ",TRUE,FILTER(' + A + ',(' + L + '<0)*(' + H + '<>"완료"))),"없음 👍")'],
    ["오늘/내일 마감",
      '=IFERROR(TEXTJOIN(" · ",TRUE,FILTER(' + A + ',(' + L + '>=0)*(' + L + '<=1)*(' + H + '<>"완료"))),"없음")'],
    ["메모 모아보기",
      '=IFERROR(TEXTJOIN("  |  ",TRUE,FILTER(' + A + '&" — "&' + I + '!M2:M,(' + A + '<>"")*(' + I + '!M2:M<>""))),"—")'],
  ];
  qual.forEach((q, i) => {
    const r = 26 + i;
    sh.getRange(r, 1).setValue(q[0]).setFontWeight("bold").setFontColor(PS_COLOR.WHITE)
      .setBackground(PS_COLOR.DGREY).setHorizontalAlignment("center").setVerticalAlignment("middle");
    sh.getRange(r, 2, 1, 7).merge();
    sh.getRange(r, 2).setFormula(q[1]).setFontColor(PS_COLOR.NAVY).setWrap(true)
      .setVerticalAlignment("middle");
    sh.setRowHeight(r, 30);
  });

  // 열 너비 / 안내
  const widths = [150, 95, 90, 130, 95, 95, 95, 110];
  widths.forEach((w, i) => sh.setColumnWidth(i + 1, w));
  sh.getRange("A32").setValue("입력은 '과업입력' 탭에서 하세요. 이 대시보드와 'To-Do'는 자동으로 갱신됩니다.")
    .setFontColor(PS_COLOR.DGREY).setFontSize(9);
  sh.setHiddenGridlines(true);
}

// ─────────────────────────────────────────────────────────────
// 예시 과업 채우기
// ─────────────────────────────────────────────────────────────
function fillSampleTasks() {
  const ss = _ps_ss();
  const sh = ss.getSheetByName(PS_SHEETS.INPUT);
  if (!sh) {
    setupProjectStatus();
    return;
  }
  const d = (m, day) => new Date(2026, m - 1, day);
  const rows = [
    ["앱 온보딩 플로우 개선", "김지훈", "개발", 5, 4, d(7, 12), 16, "진행중", 60, "이탈 지점 A/B 테스트 병행"],
    ["투자 IR 자료 v2 작성", "박서연", "기획", 5, 5, d(7, 10), 8, "진행중", 40, "⚠️ 마감 초과, 대표 리뷰 대기"],
    ["결제 모듈 QA", "박서연", "개발", 5, 5, d(7, 9), 8, "진행중", 50, "⚠️ 결제 실패 케이스 2건 남음"],
    ["7월 콘텐츠 캘린더 확정", "정하늘", "마케팅", 3, 4, d(7, 11), 4, "진행중", 80, "오늘 마감, 채널 배분만 확정"],
    ["사용자 인터뷰 5명 진행", "이도현", "리서치", 4, 3, d(7, 15), 10, "대기", 0, "리크루팅 3명 완료"],
    ["브랜드 키비주얼 시안", "최유진", "디자인", 3, 3, d(7, 14), 12, "진행중", 30, "1차 시안 내부 공유"],
    ["서버 비용 최적화", "김지훈", "운영", 4, 2, d(7, 20), 6, "대기", 0, "트래픽 로그 분석 선행"],
    ["랜딩페이지 카피 수정", "정하늘", "마케팅", 2, 2, d(7, 8), 3, "완료", 100, "배포 완료"],
  ];
  // A~I(9열) + 비고는 M열(13)
  const startRow = 2;
  rows.forEach((row, i) => {
    const r = startRow + i;
    sh.getRange(r, 1, 1, 9).setValues([row.slice(0, 9)]);
    sh.getRange(r, 13).setValue(row[9]);
  });
  sh.getRange(startRow, 6, rows.length, 1).setNumberFormat("yyyy-mm-dd");
  SpreadsheetApp.flush();
}
