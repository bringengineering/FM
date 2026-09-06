// 업무 결과보고서. 사진만 넣으면 나오게 한다.
//
// 입주청소와 계단청소는 **매번 하는 일이 같다.** 바닥 닦고 창틀 닦고
// 욕실 하고 마감 본다. 그런데 보고서는 매번 처음부터 쓴다. 그래서 사람마다
// 다르게 쓰고, 바쁘면 안 쓰고, 안 쓰면 건물주는 무엇을 했는지 모른다.
//
// 그러니 **항목을 사람이 적게 두지 않는다.** 작업 종류를 고르면 그 종류의
// 표준 항목이 깔린다. 사람이 하는 일은 항목마다 전·후 사진을 붙이는 것과,
// 안 한 항목에 이유를 적는 것뿐이다.
//
// 왜 전·후 두 장인가
//
// 결과보고서가 하는 일은 "했다고 말하는 것"이 아니라 **"했다는 것을 보이는
// 것"**이다. 후 사진만 있으면 원래 깨끗했는지 우리가 닦은 것인지 알 수
// 없다. 그 둘을 가르지 못하면 그 사진은 아무것도 증명하지 않는다.
//
// 그래서 완료로 두려면 전·후가 다 있어야 한다. 한쪽만 있으면 '일부'다.
//
// 안 한 것을 숨기지 않는다
//
// 항목을 지울 수는 없고 '못 함'으로 두고 이유를 적는다. 목록에서 빼 버리면
// 보고서만 보고는 그 항목이 원래 없었는지 빠뜨린 것인지 알 수 없다.
// 못 한 이유가 적힌 보고서가 항목이 사라진 보고서보다 낫다.
//
// 두 벌로 낸다
//
//   건물주 제출용   무엇을 했는지. 사진이 주인공이다.
//   청창사 제출용   용역 보고 서식. 계약기간·사업비·수행업체·항목별 진척도와
//                   결과평가가 있어야 하고, 표지에 대표자 날인이 들어간다.
//
// 같은 자료로 두 벌이 나온다. 두 번 적을 일이 없다.
//
// 하지 않는 것
//
// 1. 사진을 여기 담지 않는다. Drive 에 올리고 링크만 들고 있다.
// 2. 금액을 여기서 계산하지 않는다. 계약 금액은 견적서가 안다.
// 3. 진척도를 사람이 적지 않는다. 항목 상태에서 센다 — 손으로 적으면
//    100% 라고 적힌 보고서에 사진이 두 장뿐인 일이 난다.
(function attachWorkReportCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringWorkReportCore = api;
})(typeof globalThis === "object" ? globalThis : this, function createWorkReportCore() {
  "use strict";

  const text = (value, limit = 500) => String(value == null ? "" : value).trim().slice(0, limit);
  const rows = value => (Array.isArray(value) ? value.filter(Boolean) : []);
  const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(text(value, 10));

  // 작업 종류마다 표준 항목이 있다. 이 목록이 이 모듈의 요지다 — 사람이
  // 항목을 적기 시작하면 사람마다 다른 보고서가 나온다.
  //
  // detail 은 '수행범위'다. 청창사 서식의 그 칸에 그대로 들어간다.
  const KINDS = Object.freeze([
    {
      key: "moveIn",
      label: "입주청소",
      items: Object.freeze([
        { key: "floor", label: "바닥", detail: "전실 바닥 쓸기·물걸레·얼룩 제거" },
        { key: "window", label: "창호·새시", detail: "창틀 홈·레일 먼지 제거, 유리 양면 닦기" },
        { key: "kitchen", label: "주방", detail: "싱크대 상하부장 내·외부, 후드·가스대 기름때 제거" },
        { key: "bath", label: "욕실", detail: "타일·줄눈·변기·세면대 물때 제거, 배수구 청소" },
        { key: "veranda", label: "베란다", detail: "바닥·배수구·세탁기 자리 청소" },
        { key: "storage", label: "붙박이장·수납", detail: "장 내부 먼지 제거, 선반 닦기" },
        { key: "finish", label: "마감 점검", detail: "스위치·문틀·걸레받이 닦기, 잔여물 반출" },
      ]),
    },
    {
      key: "stairs",
      label: "계단청소",
      items: Object.freeze([
        { key: "stairFloor", label: "계단실 바닥", detail: "층별 계단·참 쓸기 및 물청소" },
        { key: "handrail", label: "난간·손잡이", detail: "난간 먼지 제거 및 손닿는 면 소독" },
        { key: "stairWindow", label: "창틀·유리", detail: "계단실 창틀 홈 먼지 제거, 유리 닦기" },
        { key: "light", label: "조명·천장", detail: "등커버 먼지 제거, 거미줄 제거" },
        { key: "entrance", label: "현관·공용출입구", detail: "출입구 바닥·유리문·매트 정리" },
        { key: "recycle", label: "분리수거장", detail: "수거장 바닥 청소 및 정리, 악취 처리" },
      ]),
    },
    {
      key: "special",
      label: "특수청소",
      items: Object.freeze([
        { key: "before", label: "작업 전 상태", detail: "작업 전 현장 상태 확인" },
        { key: "work", label: "본 작업", detail: "합의한 범위의 특수 작업 수행" },
        { key: "waste", label: "폐기물 반출", detail: "발생 폐기물 분리 및 반출" },
        { key: "after", label: "마감 점검", detail: "작업 후 상태 확인 및 인계" },
      ]),
    },
  ]);

  const KIND_KEYS = Object.freeze(KINDS.map(item => item.key));

  // 한 항목이 가질 수 있는 상태. 진척도는 여기서 센다.
  const ITEM_STATUSES = Object.freeze([
    { key: "done", label: "완료", weight: 1 },
    { key: "partial", label: "일부", weight: 0.5 },
    { key: "skipped", label: "못 함", weight: 0 },
  ]);

  // 보고서 구분. 쓰던 양식(작업점검_결과보고서_양식)의 체크 줄을 그대로
  // 옮긴 것이다. 작업 종류(KINDS)와는 다른 축이다 — 같은 입주청소라도
  // 정기로 도는 것과 급히 부른 것은 건물주가 다르게 읽는다.
  const CATEGORIES = Object.freeze([
    { key: "routine", label: "정기점검" },
    { key: "single", label: "단발작업" },
    { key: "urgent", label: "긴급조치" },
    { key: "moveCheck", label: "입·퇴실 점검" },
    { key: "etc", label: "기타" },
  ]);

  const CATEGORY_KEYS = Object.freeze(CATEGORIES.map(item => item.key));

  // 어느 보고서에도 그대로 실린다. 사람이 지울 수 없다 — 이 세 줄은
  // 우리가 지키기로 한 것이고, 빠진 보고서가 한 장이라도 나가면
  // 지키기로 한 것이 아니게 된다.
  const NOTICES = Object.freeze([
    "열쇠·출입 비밀번호 등 보안 정보는 본 보고서를 포함한 어떠한 서류에도 기재하지 않습니다.",
    "법정 의무점검은 브링이 직접 수행하지 않으며, 만료일 관리·업체 예약·결과 보관·후속 추적만 담당합니다.",
    "비용 부담 비율·과실·법적 책임에 대한 단정적 판단은 본 보고서 범위가 아니며, 사실관계 기록에 한합니다.",
  ]);

  // 두 벌. 같은 자료로 모양만 달리 낸다.
  const COPIES = Object.freeze([
    { key: "owner", label: "건물주 제출용", title: "작업 결과 보고서" },
    { key: "program", label: "청창사 제출용", title: "용역 결과 보고서" },
  ]);

  function kindOf(key) {
    return KINDS.find(item => item.key === text(key, 20)) || null;
  }

  function kindLabel(key) {
    const found = kindOf(key);
    return found ? found.label : text(key, 20);
  }

  function statusOf(key) {
    return ITEM_STATUSES.find(item => item.key === text(key, 20)) || null;
  }

  function statusLabel(key) {
    const found = statusOf(key);
    return found ? found.label : text(key, 20);
  }

  function categoryOf(key) {
    return CATEGORIES.find(item => item.key === text(key, 20)) || null;
  }

  function categoryLabel(key) {
    const found = categoryOf(key);
    return found ? found.label : text(key, 20);
  }

  // 문서번호. 쓰던 양식의 그 칸이다. 사람이 매기면 겹치거나 빠진다.
  // 건물·날짜·종류가 정해지면 번호도 정해지게 둔다.
  function documentNo(report) {
    const row = report && typeof report === "object" ? report : {};
    const day = text(row.workDate, 10).replace(/-/gu, "") || "00000000";
    const kind = text(row.kind, 20).slice(0, 3).toUpperCase() || "GEN";
    const tail = text(row.id, 80).replace(/[^A-Za-z0-9]/gu, "").slice(-4).toUpperCase() || "0000";
    return `BR-${day}-${kind}-${tail}`;
  }

  function copyOf(key) {
    return COPIES.find(item => item.key === text(key, 20)) || null;
  }

  function normalizePhoto(source) {
    const value = source && typeof source === "object" && !Array.isArray(source) ? source : {};
    const link = text(value.webViewLink, 500);
    return {
      id: text(value.id, 80),
      driveFileId: text(value.driveFileId, 120),
      // https 가 아닌 링크는 다른 사람 화면에서 열리지 않는다.
      webViewLink: link.indexOf("https://") === 0 ? link : "",
      caption: text(value.caption, 120),
    };
  }

  function normalizeItem(source, standard) {
    const value = source && typeof source === "object" && !Array.isArray(source) ? source : {};
    const status = text(value.status, 20);
    return {
      key: text(value.key, 40) || (standard ? standard.key : ""),
      // 표준 항목의 이름·범위를 기록에 같이 박아 둔다. 나중에 표준이 바뀌어도
      // 그때 낸 보고서는 그때 기준으로 읽혀야 한다.
      label: text(value.label, 80) || (standard ? standard.label : ""),
      detail: text(value.detail, 300) || (standard ? standard.detail : ""),
      status: statusOf(status) ? status : "done",
      note: text(value.note, 500),
      before: rows(value.before).map(normalizePhoto).filter(photo => photo.id),
      after: rows(value.after).map(normalizePhoto).filter(photo => photo.id),
    };
  }

  // 작업 종류를 고르면 그 종류의 표준 항목이 깔린다. 이미 적어 둔 것이 있으면
  // 그 위에 얹는다 — 종류를 잘못 골랐다 고쳤을 때 쓴 것이 날아가면 안 된다.
  function itemsFor(kindKey, existing) {
    const kind = kindOf(kindKey);
    if (!kind) return [];
    const saved = rows(existing).map(item => normalizeItem(item));
    return kind.items.map(standard => {
      const found = saved.find(item => item.key === standard.key);
      return normalizeItem(found || { key: standard.key, status: "done" }, standard);
    });
  }

  function normalizeReport(source) {
    const value = source && typeof source === "object" && !Array.isArray(source) ? source : {};
    const kind = text(value.kind, 20);
    return {
      id: text(value.id, 80),
      flowId: text(value.flowId, 80),
      buildingId: text(value.buildingId, 80),
      buildingName: text(value.buildingName, 200),
      kind: kindOf(kind) ? kind : "moveIn",
      title: text(value.title, 200),
      siteAddress: text(value.siteAddress, 300),
      ownerName: text(value.ownerName, 80),
      workDate: isDate(value.workDate) ? text(value.workDate, 10) : "",
      workerName: text(value.workerName, 120),
      area: text(value.area, 60),
      summary: text(value.summary, 2000),
      // 쓰던 양식의 나머지 칸. 없으면 "미기재" 로 찍힌다 — 빈칸이 그냥
      // 사라지면 받은 사람은 안 적은 것인지 없는 것인지 모른다.
      category: categoryOf(text(value.category, 20)) ? text(value.category, 20) : "single",
      categoryEtc: text(value.categoryEtc, 60),
      ownerContact: text(value.ownerContact, 120),
      followUp: text(value.followUp, 2000),
      // 청창사 제출용에만 쓰는 칸. 건물주용에는 안 나온다.
      contractFrom: isDate(value.contractFrom) ? text(value.contractFrom, 10) : "",
      contractTo: isDate(value.contractTo) ? text(value.contractTo, 10) : "",
      items: itemsFor(kindOf(kind) ? kind : "moveIn", value.items),
      createdAt: text(value.createdAt, 40),
      updatedAt: text(value.updatedAt, 40),
      updatedBy: text(value.updatedBy, 80),
    };
  }

  // 한 항목이 완료로 설 수 있는지. 전·후가 다 있어야 한다.
  //
  // 후 사진만 있으면 원래 깨끗했는지 우리가 닦은 것인지 알 수 없다. 그
  // 둘을 가르지 못하면 그 사진은 아무것도 증명하지 않는다.
  function itemIssue(item) {
    const row = normalizeItem(item);
    if (row.status === "skipped") {
      return row.note ? null : "못 한 이유를 적어 주세요.";
    }
    if (row.status === "done") {
      if (!row.before.length && !row.after.length) return "전·후 사진이 없습니다.";
      if (!row.before.length) return "작업 전 사진이 없습니다.";
      if (!row.after.length) return "작업 후 사진이 없습니다.";
    }
    return null;
  }

  function validateReport(source) {
    const report = normalizeReport(source);
    if (!report.id) return { ok: false, error: "보고서 번호가 없습니다.", code: "VALIDATION_ERROR" };
    if (!report.buildingId) return { ok: false, error: "어느 건물인지 정해 주세요.", code: "BUILDING_REQUIRED" };
    if (!report.workDate) return { ok: false, error: "작업한 날짜를 골라 주세요.", code: "DATE_REQUIRED" };
    const closed = report.items.filter(item => item.status !== "skipped");
    if (!closed.length) {
      return { ok: false, error: "한 항목도 하지 않은 것은 결과보고서가 아닙니다.", code: "NOTHING_DONE" };
    }
    for (const item of report.items) {
      const issue = itemIssue(item);
      if (issue) return { ok: false, error: `${item.label}: ${issue}`, code: "ITEM_INCOMPLETE" };
    }
    return { ok: true, report };
  }

  // 진척도는 항목 상태에서 센다. 손으로 적으면 100% 라고 적힌 보고서에
  // 사진이 두 장뿐인 일이 난다.
  function progress(report) {
    const item = normalizeReport(report);
    if (!item.items.length) return 0;
    const sum = item.items.reduce((total, row) => total + (statusOf(row.status) || { weight: 0 }).weight, 0);
    return Math.round((sum / item.items.length) * 100);
  }

  function photoCount(report) {
    const item = normalizeReport(report);
    return item.items.reduce((total, row) => total + row.before.length + row.after.length, 0);
  }

  // 아직 못 낸 이유들. 화면에서 이걸 먼저 보여 줘야 사람이 무엇을 더 해야
  // 하는지 안다. 저장 단추를 눌러 보고서야 아는 것보다 낫다.
  function blockers(report) {
    const item = normalizeReport(report);
    const list = [];
    if (!item.workDate) list.push({ key: "workDate", text: "작업한 날짜를 골라 주세요." });
    item.items.forEach(row => {
      const issue = itemIssue(row);
      if (issue) list.push({ key: row.key, text: `${row.label}: ${issue}` });
    });
    return list;
  }

  function ready(report) {
    return blockers(report).length === 0 && validateReport(report).ok;
  }

  function summarizeItems(report) {
    const item = normalizeReport(report);
    const counts = { done: 0, partial: 0, skipped: 0 };
    item.items.forEach(row => { counts[row.status] = (counts[row.status] || 0) + 1; });
    return {
      total: item.items.length,
      done: counts.done,
      partial: counts.partial,
      skipped: counts.skipped,
      progress: progress(item),
      photos: photoCount(item),
    };
  }

  // 청창사 서식의 '결과평가' 칸에 들어갈 한 줄. 사람이 매번 쓰면 매번 다르게
  // 쓰는데, 그 칸에 필요한 것은 문장력이 아니라 무엇을 했는지다.
  function resultLine(item) {
    const row = normalizeItem(item);
    if (row.status === "skipped") return `미실시 — ${row.note || "사유 미기재"}`;
    const photos = row.before.length + row.after.length;
    const base = row.status === "done" ? `${row.label} 완료` : `${row.label} 일부 시행`;
    const evidence = photos ? ` (사진 ${photos}장)` : "";
    return `${base}${evidence}${row.note ? ` · ${row.note}` : ""}`;
  }

  // 이 문서는 밖으로 나간다. 건물주에게도, 청창사에도.
  //
  // 그래서 협력업체 이름과 업체 단가가 섞이면 안 된다. 우리가 얼마에 받아
  // 얼마에 넘겼는지가 드러나면 그건 다음 계약을 잃는 일이다. 민원 결과보고서가
  // 같은 이유로 같은 검사를 하고 있어서, 그 생각을 그대로 가져왔다.
  //
  // 사람이 실수로 메모에 적는 경우를 잡는 것이지, 악의를 막는 장치가 아니다.
  // 그래도 대부분의 사고는 실수다.
  function findLeakedFields(report, secrets) {
    const serialized = JSON.stringify(normalizeReport(report));
    const source = secrets && typeof secrets === "object" && !Array.isArray(secrets) ? secrets : {};
    const groups = [
      ["협력업체명", rows(source.vendorNames)],
      ["업체 단가", rows(source.vendorAmounts)],
      ["내부 메모", rows(source.privateMemos)],
    ];
    const leaks = [];
    groups.forEach(([label, values]) => {
      const hit = values
        .map(value => text(value, 200))
        // 두 글자짜리 업체명이나 한 자리 숫자는 아무 문장에나 들어 있다.
        // 그것까지 막으면 검사가 늘 걸려서 아무도 안 본다.
        .filter(value => value.length >= 3)
        .some(value => serialized.includes(value));
      if (hit) leaks.push(label);
    });
    return leaks;
  }

  function sortReports(reports) {
    return rows(reports).map(normalizeReport).filter(item => item.id).sort((a, b) => {
      if (a.workDate !== b.workDate) return a.workDate < b.workDate ? 1 : -1;
      return String(b.updatedAt).localeCompare(String(a.updatedAt));
    });
  }

  function findReport(reports, reportId) {
    const id = text(reportId, 80);
    if (!id) return null;
    return rows(reports).map(normalizeReport).find(item => item.id === id) || null;
  }

  return Object.freeze({
    KINDS,
    KIND_KEYS,
    CATEGORIES,
    CATEGORY_KEYS,
    NOTICES,
    categoryOf,
    categoryLabel,
    documentNo,
    ITEM_STATUSES,
    COPIES,
    kindOf,
    kindLabel,
    statusOf,
    statusLabel,
    copyOf,
    normalizePhoto,
    normalizeItem,
    normalizeReport,
    itemsFor,
    itemIssue,
    validateReport,
    progress,
    photoCount,
    blockers,
    ready,
    summarizeItems,
    resultLine,
    findLeakedFields,
    sortReports,
    findReport,
    text,
    rows,
  });
});
