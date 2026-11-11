// 정기 관리보고서. 격주(1~15일, 16일~말일)로 건물주에게 드린다.
//
// 공용부 청소는 주 1회라 한 보고서에 두 번 들어간다. 청소는 이미 작업 결과보고서
// (work-report-core, kind "common"/"stairs")로 기록하고 있으므로 여기서 다시 적지
// 않는다. 이 모듈은 그 기간의 청소 기록을 **모으고**, 새로 적는 것은 건물 정기점검
// 하나뿐이다. 두 번 적게 두면 두 기록이 어긋난다.
//
// 숫자는 사람이 적지 않는다. 회차·청소일·사진 수·상태별 건수는 기록에서 센다.
// 손으로 적으면 "양호 13건" 이라고 쓴 보고서의 표에 양호가 10줄뿐인 일이 난다.
//
// 양호가 아닌 점검 항목은 사진과 메모가 있어야 낸다. 건물주에게 "조치 필요" 라고
// 말하려면 무엇을 봤는지 보여야 한다. 지난 보고서의 '조치 필요'·'관찰' 항목은
// 다음 보고서로 넘어와, 해결될 때까지 보고서마다 따라간다.
(function attachPeriodicReportCore(root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./work-report-core") : root.BringWorkReportCore);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringPeriodicReportCore = api;
})(typeof globalThis === "object" ? globalThis : this, function createPeriodicReportCore(WorkReport) {
  "use strict";

  const text = (value, limit = 500) => String(value == null ? "" : value).trim().slice(0, limit);
  const rows = value => (Array.isArray(value) ? value.filter(Boolean) : []);
  const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(text(value, 10));
  const CLEANING_KINDS = Object.freeze(["common", "stairs"]);

  // 통합 건물 체크리스트(B. 건물관리 정기점검)에서 건물주가 읽을 항목만 추렸다.
  // 표준 항목을 사람이 적게 두지 않는 이유는 작업 결과보고서와 같다.
  const INSPECTION_ITEMS = Object.freeze([
    { key: "wallCrack", category: "외관", label: "외벽 균열" },
    { key: "wallStain", category: "외관", label: "외벽 오염·낙서" },
    { key: "entranceDoor", category: "외관", label: "공동현관 출입문" },
    { key: "drainYard", category: "배수", label: "배수로·집수정" },
    { key: "drainRoof", category: "배수", label: "옥상 배수구" },
    { key: "sewer", category: "배수", label: "하수구 악취·역류" },
    { key: "lightStairs", category: "조명", label: "계단·복도 형광등" },
    { key: "lightSensor", category: "조명", label: "현관·계단 센서등" },
    { key: "mailbox", category: "우편함", label: "우편함 상태" },
    { key: "mailPile", category: "우편함", label: "장기 적치 우편물·전단" },
    { key: "extinguisher", category: "안전", label: "소화기" },
    { key: "panel", category: "안전", label: "분전함·계량기함" },
    { key: "railing", category: "안전", label: "난간·계단" },
    { key: "windows", category: "공용부", label: "공용 창호" },
    { key: "recycle", category: "공용부", label: "분리수거장" },
  ]);

  const STATUSES = Object.freeze([
    { key: "good", label: "양호" },
    { key: "watch", label: "관찰" },
    { key: "fix", label: "조치 필요" },
    { key: "done", label: "조치 완료" },
    { key: "na", label: "해당 없음" },
  ]);
  const STATUS_KEYS = Object.freeze(STATUSES.map(item => item.key));
  const OPEN_STATUSES = Object.freeze(["watch", "fix"]);
  const statusLabel = key => (STATUSES.find(item => item.key === key) || { label: text(key, 20) }).label;

  // ---- 기간 ----------------------------------------------------------------

  function lastDay(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  // "2026-10-2" → 2026년 10월 16일~31일. 문자열 하나로 두면 저장·정렬·비교가 쉽다.
  function parsePeriod(value) {
    const match = /^(\d{4})-(\d{2})-([12])$/.exec(text(value, 10));
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12) return null;
    const half = Number(match[3]);
    const pad = n => String(n).padStart(2, "0");
    const from = `${year}-${pad(month)}-${half === 1 ? "01" : "16"}`;
    const to = `${year}-${pad(month)}-${half === 1 ? "15" : pad(lastDay(year, month))}`;
    return { key: `${year}-${pad(month)}-${half}`, year, month, half, from, to };
  }

  function periodOf(date) {
    if (!isDate(date)) return null;
    const [year, month, day] = date.split("-").map(Number);
    return parsePeriod(`${year}-${String(month).padStart(2, "0")}-${day <= 15 ? 1 : 2}`);
  }

  function previousPeriod(value) {
    const period = parsePeriod(value);
    if (!period) return null;
    if (period.half === 2) return parsePeriod(`${period.year}-${String(period.month).padStart(2, "0")}-1`);
    const year = period.month === 1 ? period.year - 1 : period.year;
    const month = period.month === 1 ? 12 : period.month - 1;
    return parsePeriod(`${year}-${String(month).padStart(2, "0")}-2`);
  }

  function nextPeriod(value) {
    const period = parsePeriod(value);
    if (!period) return null;
    if (period.half === 1) return parsePeriod(`${period.year}-${String(period.month).padStart(2, "0")}-2`);
    const year = period.month === 12 ? period.year + 1 : period.year;
    const month = period.month === 12 ? 1 : period.month + 1;
    return parsePeriod(`${year}-${String(month).padStart(2, "0")}-1`);
  }

  function periodLabel(value) {
    const period = parsePeriod(value);
    return period ? `${period.year}년 ${period.month}월 ${period.half}차` : "";
  }

  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
  function dateLabel(date, withYear = true) {
    if (!isDate(date)) return "";
    const [year, month, day] = date.split("-").map(Number);
    const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
    return `${withYear ? `${year}. ` : ""}${month}. ${day}.(${weekday})`;
  }

  // 그 달의 몇째 주인지. 달력 기준(일요일 시작)으로 센다.
  function weekOfMonth(date) {
    if (!isDate(date)) return "";
    const [year, month, day] = date.split("-").map(Number);
    const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    return `${month}월 ${Math.floor((day + firstWeekday - 1) / 7) + 1}주차`;
  }

  // ---- 기록 ----------------------------------------------------------------

  function normalizeInspectionItem(source, standard) {
    const value = source && typeof source === "object" && !Array.isArray(source) ? source : {};
    const status = text(value.status, 10);
    return {
      key: text(value.key, 40) || (standard ? standard.key : ""),
      // 그때의 이름을 기록에 박아 둔다. 표준이 바뀌어도 지난 보고서는 그때대로 읽힌다.
      category: (standard ? standard.category : "") || text(value.category, 20) || "기타",
      label: (standard ? standard.label : "") || text(value.label, 80),
      status: STATUS_KEYS.includes(status) ? status : "good",
      note: text(value.note, 300),
      photos: rows(value.photos).map(WorkReport.normalizePhoto).filter(photo => photo.id).slice(0, 6),
    };
  }

  // 표준 항목이 먼저, 사람이 더한 항목(custom_*)이 뒤에 온다.
  function inspectionItems(existing) {
    const saved = rows(existing).map(item => normalizeInspectionItem(item));
    const standard = INSPECTION_ITEMS.map(item => normalizeInspectionItem(saved.find(row => row.key === item.key) || { key: item.key }, item));
    const extra = saved.filter(row => /^custom_[A-Za-z0-9_-]{1,40}$/.test(row.key) && row.label);
    return [...standard, ...extra.slice(0, 20)];
  }

  function normalizeAction(source) {
    const value = source && typeof source === "object" && !Array.isArray(source) ? source : {};
    const status = text(value.status, 10);
    return {
      key: text(value.key, 60),
      label: text(value.label, 120),
      finding: text(value.finding, 300),
      plan: text(value.plan, 300),
      status: ["watch", "fix", "done"].includes(status) ? status : "fix",
      since: isDate(value.since) ? value.since : "",
    };
  }

  function normalizeLinks(source) {
    const value = source && typeof source === "object" && !Array.isArray(source) ? source : {};
    const keys = new Set(INSPECTION_ITEMS.map(item => item.key));
    return Object.fromEntries(Object.entries(value).filter(([key, caseKey]) => (keys.has(key) || /^custom_[A-Za-z0-9_-]{1,40}$/.test(key)) && /^[A-Za-z0-9_-]{1,120}$/.test(String(caseKey || ""))).slice(0, 30));
  }

  // 연결된 작업 건의 진행. '공사 진행'(c12) 이 끝나면 조치 완료로 본다. 삭제된 건은 연결이 없는 것으로 본다.
  const CASE_STEPS = ["문의 접수", "접수확인", "상담", "분류", "견적 요청", "견적 비교", "추천", "건물주 추천", "승인·입금", "입금 확인", "업체·일정", "공사 진행", "작업 사진", "B/A 보고서", "정산", "월간 리포트", "사후관리"];
  function caseProgress(caseRecord) {
    if (!caseRecord || caseRecord.deleted === true) return null;
    const status = caseRecord.status && typeof caseRecord.status === "object" ? caseRecord.status : {};
    const done = status.c12 === "done" || status.c13 === "done" || status.c14 === "done";
    let current = "";
    for (let i = 1; i <= CASE_STEPS.length; i += 1) if (status[`c${i}`] === "doing") { current = CASE_STEPS[i - 1]; break; }
    const completedAt = text(caseRecord.workCompletedAt, 10) || text(caseRecord.updatedAt, 10);
    return { done, step: current, completedAt: isDate(completedAt) ? completedAt : "", ticketNo: text(caseRecord.ticketNo, 40) };
  }

  // 건물주에게 보낸 기록. 번호는 끝 4자리만 둔다 — 보고서 기록에 전화번호를 통째로 쌓지 않는다.
  function normalizeDelivery(source) {
    const value = source && typeof source === "object" && !Array.isArray(source) ? source : null;
    if (!value || !["requested", "sent", "failed"].includes(value.status)) return null;
    return {
      status: value.status,
      sentAt: text(value.sentAt, 40),
      messageId: text(value.messageId, 120),
      phoneTail: /^\d{4}$/.test(text(value.phoneTail, 4)) ? text(value.phoneTail, 4) : "",
      sentBy: text(value.sentBy, 80),
      // 열람 확인용. 문서 id 는 발송 서버의 보안 링크 문서이고 내용·번호를 담지 않는다.
      documentId: /^[A-Za-z0-9_-]{1,120}$/.test(text(value.documentId, 120)) ? text(value.documentId, 120) : "",
      firstViewedAt: text(value.firstViewedAt, 40),
      viewCount: Math.max(0, Math.min(9999, Math.round(Number(value.viewCount) || 0))),
      checkedAt: text(value.checkedAt, 40),
    };
  }

  // ---- 표지 · 법정점검 -------------------------------------------------------
  // 건물에 딸린 정보라 보고서마다 새로 적지 않는다. 한 번 적으면 다음 보고서로 그대로 넘어가고,
  // 바뀐 것(새 점검을 받았다 등)만 그 보고서에서 고친다.
  const LEGAL_CYCLES = Object.freeze([
    { key: "month", label: "월 1회", months: 1 },
    { key: "quarter", label: "분기 1회", months: 3 },
    { key: "half", label: "반기 1회", months: 6 },
    { key: "year", label: "연 1회", months: 12 },
    { key: "biennial", label: "2년 1회", months: 24 },
    { key: "other", label: "별도 주기", months: 0 },
  ]);
  const LEGAL_RESULTS = Object.freeze([
    { key: "good", label: "적합" },
    { key: "fix", label: "부적합" },
    { key: "done", label: "부적합 → 조치 완료" },
  ]);
  // 자주 쓰는 법정점검. 고르면 이름·주기를 채운다. 건물마다 주기가 다를 수 있어 바꿀 수 있게 둔다.
  const LEGAL_PRESETS = Object.freeze([
    { name: "소방시설 작동점검", cycle: "year" },
    { name: "소방시설 종합점검", cycle: "year" },
    { name: "승강기 정기검사", cycle: "year" },
    { name: "정보통신설비 성능점검", cycle: "year" },
    { name: "정보통신설비 유지보수·관리점검", cycle: "half" },
    { name: "저수조 청소·수질검사", cycle: "half" },
    { name: "전기설비 정기검사", cycle: "other" },
    { name: "건축물 정기점검", cycle: "other" },
  ]);
  const isMonth = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(text(value, 7));
  const plain = source => (source && typeof source === "object" && !Array.isArray(source) ? source : {});

  function normalizeCover(source) {
    const value = plain(source);
    const photo = value.photo ? WorkReport.normalizePhoto(value.photo) : null;
    // 규모는 건물주가 아는 말로 짧게: "지상 5층 · 지하 1층 · 근린생활시설"
    return { photo: photo && photo.id ? photo : null, scale: text(value.scale, 80) };
  }

  function normalizeLegal(source, index = 0) {
    const value = plain(source);
    const cycle = text(value.cycle, 12);
    const result = text(value.result, 8);
    const key = text(value.key, 43);
    return {
      key: /^lg_[A-Za-z0-9_-]{1,40}$/.test(key) ? key : `lg_${index + 1}`,
      name: text(value.name, 60),
      cycle: LEGAL_CYCLES.some(item => item.key === cycle) ? cycle : "year",
      lastDate: isDate(value.lastDate) ? value.lastDate : "",
      result: LEGAL_RESULTS.some(item => item.key === result) ? result : "",
      // 결과를 업체 보고서 말 그대로 적고 싶을 때(합격·적합 11종 등). 비우면 위 결과 이름을 쓴다.
      resultText: text(value.resultText, 40),
      // 다음 점검 달. 비우면 마지막 점검일과 주기로 센다.
      nextMonth: isMonth(value.nextMonth) ? value.nextMonth : "",
      note: text(value.note, 60),
    };
  }

  function normalizeLegalList(source) {
    const seen = new Set();
    return rows(source).map(normalizeLegal).filter(item => item.name).slice(0, 12).map((item, index) => {
      const key = seen.has(item.key) ? `lg_${index + 1}_${seen.size}` : item.key;
      seen.add(key);
      return { ...item, key };
    });
  }

  const monthIndex = month => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
  const monthOf = index => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
  const monthLabel = month => `${Number(month.slice(0, 4))}. ${Number(month.slice(5, 7))}.`;
  const shortDate = date => dateLabel(date, false).replace(/\(.\)$/u, "").trim();

  // 다음 점검 달: 적어 둔 달이 먼저, 없으면 마지막 점검일 + 주기.
  function legalNextMonth(item) {
    if (item.nextMonth) return item.nextMonth;
    const cycle = LEGAL_CYCLES.find(row => row.key === item.cycle);
    return item.lastDate && cycle && cycle.months ? monthOf(monthIndex(item.lastDate.slice(0, 7)) + cycle.months) : "";
  }

  // 건물주가 볼 법정점검 표. 다음 점검이 가까운 순. 날짜가 하나도 없는 줄은 싣지 않는다.
  // 기준일은 보고서를 내는 날(없으면 보고 기간 끝날)이다 — "다음 달" 은 받는 날 기준이어야 맞다.
  function legalView(list, reference) {
    const refMonth = isDate(reference) ? reference.slice(0, 7) : "";
    return normalizeLegalList(list).filter(item => item.lastDate || legalNextMonth(item)).map(item => {
      const next = legalNextMonth(item);
      const diff = next && refMonth ? monthIndex(next) - monthIndex(refMonth) : null;
      const base = diff === null ? "" : diff < 0 ? "예정 시기 지남 · 일정 확인 중" : diff === 0 ? "이번 달" : diff === 1 ? "다음 달" : `약 ${diff}개월 뒤`;
      const tone = diff === null ? "calm" : diff < 0 ? "late" : diff <= 2 ? "soon" : "calm";
      const result = LEGAL_RESULTS.find(row => row.key === item.result);
      return {
        key: item.key,
        name: item.name,
        cycleLabel: (LEGAL_CYCLES.find(row => row.key === item.cycle) || LEGAL_CYCLES[3]).label,
        lastLabel: item.lastDate ? dateLabel(item.lastDate).replace(/\(.\)$/u, "").trim() : "첫 점검 예정",
        result: item.result || (item.lastDate ? "good" : "watch"),
        resultLabel: item.resultText || (result ? result.label : item.lastDate ? "완료" : "예정"),
        nextMonth: next,
        nextLabel: next ? monthLabel(next) : "일정 확인 중",
        due: [base, item.note].filter(Boolean).join(" · "),
        tone,
      };
    }).sort((a, b) => (a.nextMonth || "9999-99").localeCompare(b.nextMonth || "9999-99"));
  }

  // 저장 시각(UTC ISO)을 한국 날짜·시각으로. 새벽에 보낸 것이 전날로 보이지 않게 한다.
  function kstDay(iso) {
    const time = Date.parse(String(iso || ""));
    return Number.isFinite(time) ? new Date(time + 9 * 3600000).toISOString().slice(0, 10) : "";
  }
  function kstTime(iso) {
    const time = Date.parse(String(iso || ""));
    return Number.isFinite(time) ? new Date(time + 9 * 3600000).toISOString().slice(0, 16).replace("T", " ") : "";
  }

  // 열람 상태 한 줄. 7일 링크라 그 뒤에는 열 수 없다.
  function viewState(delivery, today) {
    const value = normalizeDelivery(delivery);
    if (!value) return null;
    if (value.firstViewedAt) return { viewed: true, label: `열람함 ${dateLabel(kstDay(value.firstViewedAt), false)}${value.viewCount > 1 ? ` · ${value.viewCount}회` : ""}` };
    const sentDay = kstDay(value.sentAt);
    const days = isDate(sentDay) && isDate(today) ? Math.round((Date.UTC(...today.split("-").map((n, i) => i === 1 ? n - 1 : +n)) - Date.UTC(...sentDay.split("-").map((n, i) => i === 1 ? n - 1 : +n))) / 86400000) : 0;
    return { viewed: false, days, label: days >= 7 ? "미열람 · 링크 만료" : days <= 0 ? "미열람 · 오늘 발송" : `미열람 · 발송 후 ${days}일`, followUp: days >= 2 };
  }

  const live = row => row && !row.archivedAt && !row.deletedAt && row.deleted !== true;
  const mobile = value => { const digits = String(value || "").replace(/\D/gu, ""); return /^01\d{8,9}$/u.test(digits) ? digits : ""; };

  // 받을 사람. 건물이면 그 건물의 건물주 고객, 건물이 없으면 그 고객. 휴대전화가 아니면 못 보낸다.
  function recipientFor(report, store) {
    const value = normalizeReport(report);
    const data = store && typeof store === "object" ? store : {};
    const customers = rows(data.customers).filter(live);
    let customer = null;
    if (value.buildingId) {
      const building = rows(data.buildings).filter(live).find(row => row.id === value.buildingId);
      if (!building) return { phone: "", name: "", reason: "건물을 찾지 못했습니다." };
      customer = customers.find(row => row.id === text(building.ownerCustomerId, 120)) || null;
      if (!customer) return { phone: "", name: "", reason: "건물에 건물주 고객이 연결되어 있지 않습니다. 건물 정보에서 건물주를 먼저 연결해 주세요." };
    } else {
      customer = customers.find(row => row.id === value.customerId) || null;
      if (!customer) return { phone: "", name: "", reason: "고객을 찾지 못했습니다." };
    }
    const phone = mobile(customer.phone);
    return phone ? { phone, name: text(customer.name, 80), customerId: customer.id, reason: "" }
      : { phone: "", name: text(customer.name, 80), reason: "건물주 고객의 휴대전화 번호를 확인해 주세요." };
  }

  // 작업 결과보고서 알림톡 템플릿(V3)의 두 칸. 주소가 없으면 보낼 수 없다.
  function kakaoDetails(report) {
    const value = normalizeReport(report);
    const address = text(value.siteAddress, 300).replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 80);
    if (!address || !value.period) return null;
    return { buildingAddress: address, workName: `${periodLabel(value.period)} 정기 관리` };
  }

  function normalizeReport(source) {
    const value = source && typeof source === "object" && !Array.isArray(source) ? source : {};
    const period = parsePeriod(value.period);
    const inspection = value.inspection && typeof value.inspection === "object" ? value.inspection : {};
    return {
      id: text(value.id, 80),
      buildingId: text(value.buildingId, 80),
      ...(/^[A-Za-z0-9_-]{1,120}$/.test(value.customerId || "") ? { customerId: value.customerId } : {}),
      buildingName: text(value.buildingName, 200),
      siteAddress: text(value.siteAddress, 300),
      period: period ? period.key : "",
      // 이 보고서에 싣는 청소 기록. 비어 있으면 그 기간의 청소를 모두 싣는다.
      cleaningReportIds: [...new Set(rows(value.cleaningReportIds).map(id => text(id, 80)).filter(Boolean))].slice(0, 8),
      inspection: {
        date: isDate(inspection.date) ? inspection.date : "",
        inspectorName: text(inspection.inspectorName, 120),
        // 자동 초안은 false 로 만든다. 담당자가 열어 점검 결과를 저장해야 true 가 된다.
        // 예전 기록(값 없음)은 사람이 쓴 것이므로 확인된 것으로 본다.
        confirmed: inspection.confirmed !== false,
        items: inspectionItems(inspection.items),
      },
      actions: rows(value.actions).map(normalizeAction).filter(item => item.label).slice(0, 30),
      summary: text(value.summary, 2000),
      followUp: text(value.followUp, 2000),
      delivery: normalizeDelivery(value.delivery),
      // 점검 항목 → CRM 민원·작업 건. 수리가 끝나면 다음 보고서가 스스로 '조치 완료' 로 안다.
      links: normalizeLinks(value.links),
      nextSchedule: rows(value.nextSchedule).map(item => ({ label: text(item && item.label, 60), date: isDate(item && item.date) ? item.date : "" })).filter(item => item.label && item.date).slice(0, 6),
      // 표지(건물 사진·규모)와 법정점검 현황. 건물 정보라 다음 보고서로 이어진다.
      cover: normalizeCover(value.cover),
      legal: normalizeLegalList(value.legal),
      createdAt: text(value.createdAt, 40),
      updatedAt: text(value.updatedAt, 40),
      updatedBy: text(value.updatedBy, 80),
    };
  }

  // 같은 건물이면 건물로, 건물이 없는 고객 단위 기록이면 고객으로 맞춘다.
  // CRM 은 건물주 고객 하나가 곧 현장인 경우 건물 id 를 고객 id 와 같게 만든다. 그래서 같은
  // 현장의 청소 기록이 어떤 것은 buildingId, 어떤 것은 customerId 로만 남는다(현장 앱·고객 단위
  // 작업 결과보고서). 둘을 다른 대상으로 보면 한 현장 보고서가 둘로 갈라진다 — 같은 id 면 같은 대상이다.
  const targetKey = row => text(row && row.buildingId, 120) || text(row && row.customerId, 120);
  function sameTarget(row, target) {
    const key = targetKey(target);
    return !!key && targetKey(row) === key;
  }

  // 그 기간·그 건물의 청소 기록. 날짜순.
  function cleaningsFor(workReports, report) {
    const target = normalizeReport(report);
    const period = parsePeriod(target.period);
    if (!period || (!target.buildingId && !target.customerId)) return [];
    const picked = new Set(target.cleaningReportIds);
    return WorkReport.sortReports(workReports)
      .filter(row => CLEANING_KINDS.includes(row.kind) && sameTarget(row, target))
      .filter(row => row.workDate >= period.from && row.workDate <= period.to)
      .filter(row => !picked.size || picked.has(row.id))
      .sort((a, b) => a.workDate.localeCompare(b.workDate));
  }

  // 지난 보고서에서 끝나지 않은 항목을 이번 보고서로 가져온다. 이미 이번에 같은
  // 항목을 적었으면 이번 것이 이긴다.
  function carryOverActions(previousReport, currentReport) {
    const previous = previousReport ? normalizeReport(previousReport) : null;
    const current = normalizeReport(currentReport);
    const result = [...current.actions];
    const known = new Set(result.map(item => item.key || item.label));
    const fromPrevious = previous ? [
      ...previous.actions.filter(item => OPEN_STATUSES.includes(item.status)),
      ...previous.inspection.items.filter(item => OPEN_STATUSES.includes(item.status)).map(item => ({
        key: `insp_${item.key}`, label: item.label, finding: item.note, plan: "", status: item.status, since: previous.inspection.date,
      })),
    ] : [];
    fromPrevious.map(normalizeAction).forEach(item => {
      const key = item.key || item.label;
      if (known.has(key)) return;
      known.add(key);
      result.push(item);
    });
    return result;
  }

  // 이번 점검에서 양호가 아닌 항목은 조치 표에도 자동으로 올린다.
  function actionsFromInspection(report) {
    const value = normalizeReport(report);
    const result = [...value.actions];
    const known = new Set(result.map(item => item.key || item.label));
    value.inspection.items.filter(item => ["watch", "fix", "done"].includes(item.status)).forEach(item => {
      const key = `insp_${item.key}`;
      if (known.has(key)) return;
      known.add(key);
      result.push(normalizeAction({ key, label: item.label, finding: item.note, status: item.status, since: value.inspection.date }));
    });
    return result;
  }

  function counts(report) {
    const value = normalizeReport(report);
    const result = { good: 0, watch: 0, fix: 0, done: 0, na: 0 };
    value.inspection.items.forEach(item => { result[item.status] += 1; });
    return result;
  }

  function blockersFor(report, workReports) { return blockers(report, workReports); }

  function blockers(report, workReports) {
    const value = normalizeReport(report);
    const list = [];
    if (!value.buildingId && !value.customerId) list.push({ key: "target", text: "보고할 건물 또는 고객을 정해 주세요." });
    if (!value.period) list.push({ key: "period", text: "보고 기간을 골라 주세요." });
    const period = parsePeriod(value.period);
    if (!value.inspection.date) list.push({ key: "inspectionDate", text: "정기점검한 날짜를 골라 주세요." });
    else if (period && (value.inspection.date < period.from || value.inspection.date > period.to)) list.push({ key: "inspectionDate", text: "정기점검 날짜가 보고 기간 밖에 있습니다." });
    if (!value.inspection.confirmed) list.push({ key: "confirm", text: "자동으로 만든 초안입니다. 점검 결과를 확인하고 저장해 주세요." });
    if (period && !cleaningsFor(workReports, value).length) list.push({ key: "cleanings", text: "이 기간의 공용부 청소 결과보고서가 없습니다. 청소 보고서를 먼저 저장해 주세요." });
    value.inspection.items.forEach(item => {
      if (!["watch", "fix", "done"].includes(item.status)) return;
      if (!item.note) list.push({ key: item.key, text: `${item.label}: 무엇을 확인했는지 한 줄 적어 주세요.` });
      if (!item.photos.length) list.push({ key: item.key, text: `${item.label}: ${statusLabel(item.status)} 항목은 사진이 있어야 합니다.` });
    });
    return list;
  }

  function validateReport(report, workReports) {
    const value = normalizeReport(report);
    if (!value.id) return { ok: false, error: "보고서 번호가 없습니다.", code: "VALIDATION_ERROR" };
    const list = blockers(value, workReports);
    if (list.length) return { ok: false, error: list[0].text, code: "NOT_READY", blockers: list };
    return { ok: true, report: value };
  }

  // 작성 중 저장에 필요한 최소한. 건물주에게 낼 수 있는지는 validateReport 가 본다.
  function validateDraft(source) {
    const value = normalizeReport(source);
    if (!/^pr_[A-Za-z0-9_-]{4,76}$/.test(value.id)) return { ok: false, error: "보고서 번호가 없습니다.", code: "VALIDATION_ERROR" };
    if (!value.buildingId && !value.customerId) return { ok: false, error: "보고할 건물 또는 고객을 정해 주세요.", code: "BUILDING_REQUIRED" };
    if (!value.period) return { ok: false, error: "보고 기간을 골라 주세요.", code: "PERIOD_REQUIRED" };
    return { ok: true, report: value };
  }

  function documentNo(report) {
    const value = normalizeReport(report);
    const period = parsePeriod(value.period);
    const tail = value.id.replace(/[^A-Za-z0-9]/gu, "").slice(-4).toUpperCase() || "0000";
    return `BR-${period ? `${period.year}${String(period.month).padStart(2, "0")}-${period.half}` : "000000-0"}-REG-${tail}`;
  }

  // 사람이 요약을 비워 두면 기록에서 문장을 만든다. 숫자는 여기서만 센다.
  function autoSummary(report, cleanings) {
    const value = normalizeReport(report);
    const total = counts(value);
    const dates = rows(cleanings).map(row => dateLabel(row.workDate, false).replace(/\(.\)$/u, "")).join(" · ");
    const parts = [["good", "양호"], ["done", "조치 완료"], ["watch", "관찰"], ["fix", "조치 필요"]].filter(([key]) => total[key]).map(([key, label]) => `${label} ${total[key]}건`);
    const checked = value.inspection.items.filter(item => item.status !== "na").length;
    return `보고 기간 중 공용부 청소 ${rows(cleanings).length}회${dates ? `(${dates})` : ""}와 건물 정기점검을 마쳤습니다. 점검 ${checked}개 항목 중 ${parts.join(", ")}${total.fix ? "이며, 조치가 필요한 항목은 아래에 정리했습니다." : "입니다."}`;
  }

  // PDF 가 읽는 모양. 출력할 때만 만든다 — 저장된 기록은 바꾸지 않는다.
  // 조치 사항의 진행 경과. 기록에 있는 날짜만 쓴다: 처음 확인한 날 → 작업 건 접수 →
  // 지금 단계 또는 수리 완료 → 다음 점검에서 정상 확인. 건물주가 "말한 게 어디까지 갔나" 를 본다.
  function actionTrack(item, caseRecord, report) {
    const steps = [];
    if (isDate(item.since)) steps.push({ date: shortDate(item.since), text: (item.startStatus || item.status) === "watch" && !caseRecord ? "관찰 시작" : "확인" });
    if (caseRecord) {
      const created = text(caseRecord.createdAt || caseRecord.receivedAt, 10);
      steps.push({ date: isDate(created) ? shortDate(created) : "", text: "작업 건 접수" });
      const progress = caseProgress(caseRecord);
      if (progress && progress.done) steps.push({ date: progress.completedAt ? shortDate(progress.completedAt) : "", text: "수리 완료" });
      else if (progress && progress.step && progress.step !== "문의 접수") steps.push({ date: "", text: `${progress.step} 단계` });
    }
    if (item.recheck) steps.push({ date: isDate(report.inspection.date) ? shortDate(report.inspection.date) : "", text: "점검에서 정상 확인" });
    else if (!caseRecord) steps.push({ date: "", text: item.status === "done" ? (item.plan || "조치 완료") : item.status === "watch" ? "다음 점검 때 다시 확인" : (item.plan || "건물주 확인 후 진행") });
    const sincePeriod = isDate(item.since) ? periodOf(item.since) : null;
    const sinceLabel = !isDate(item.since) ? "" : sincePeriod && sincePeriod.key === report.period ? `${shortDate(item.since)} 이번 점검`
      : `${shortDate(item.since)}${sincePeriod ? ` (${periodLabel(sincePeriod.key).replace(/^\d{4}년 /u, "")})` : ""}`;
    const stateLabel = item.status === "done" ? "조치 완료" : item.status === "watch" ? "관찰" : caseRecord ? "진행 중" : "조치 필요";
    return { steps, sinceLabel, stateLabel };
  }

  function buildView(report, workReports, options = {}) {
    const value = normalizeReport(report);
    const period = parsePeriod(value.period);
    const cleanings = cleaningsFor(workReports, value).map((row, index) => {
      const items = row.items.filter(item => item.before.length + item.during.length + item.after.length || item.note);
      return {
        no: index + 1,
        id: row.id,
        workDate: row.workDate,
        dateLabel: dateLabel(row.workDate),
        shortDate: dateLabel(row.workDate, false),
        week: weekOfMonth(row.workDate),
        workerName: row.workerName,
        areas: items.map(item => item.label).join(", "),
        // 청소 보고서의 요약은 건물주에게 보내는 안내문(인사·맺음말)인 경우가 많아 표 칸에
        // 맞지 않는다. 구역별 수행 범위를 쓰고, 그것이 없을 때만 요약의 첫 줄을 짧게 쓴다.
        work: items.map(item => item.detail).filter(Boolean).slice(0, 3).join(" / ")
          || String(row.summary || "").split(/\n/u).map(line => line.trim()).find(line => line && !/^(안녕하|브링케어 드림)/u.test(line))?.slice(0, 80) || "",
        photoCount: WorkReport.photoCount(row),
        items,
      };
    });
    const previous = options.previousReport || null;
    // 지난번에 넘어온 점검 항목을 이번 점검에서 다시 봤으면 이번 결과를 따른다.
    // 정상으로 확인됐으면 '조치 완료' 로 한 번 보여 주고 다음 보고서부터는 빠진다.
    const current = new Map(value.inspection.items.map(item => [`insp_${item.key}`, item]));
    // 지난 보고서에서 이어진 작업 건 연결도 이어받는다(이번에 따로 정하지 않았으면).
    const links = { ...(previous ? normalizeReport(previous).links : {}), ...value.links };
    const cases = rows(options.cases);
    const withCarry = carryOverActions(previous, value).map(item => {
      const now = current.get(item.key);
      if (!now || now.status === "na" || value.actions.some(own => own.key === item.key)) return item;
      if (now.status === "good") return { ...item, status: "done", plan: item.plan || `${dateLabel(value.inspection.date, false)} 점검에서 정상 확인` };
      return { ...item, status: now.status, finding: now.note || item.finding };
    });
    // 진행 경과용: 지난 보고서에서 넘어온 항목의 처음 상태와, 이번 점검에서 정상으로 확인됐는지.
    const origin = new Map(carryOverActions(previous, value).map(item => [item.key, item.status]));
    const rechecked = new Set(withCarry.filter(item => item.status === "done" && origin.get(item.key) !== "done" && current.has(item.key) && current.get(item.key).status === "good").map(item => item.key));
    const actions = actionsFromInspection({ ...value, actions: withCarry }).map(item => {
      const caseKey = links[String(item.key || "").replace(/^insp_/u, "")];
      const caseRecord = caseKey ? cases.find(row => row && (row.id === caseKey || row.firebaseKey === caseKey)) : null;
      const progress = caseRecord ? caseProgress(caseRecord) : null;
      let next = item;
      if (progress && progress.done) next = { ...item, status: "done", plan: `${progress.completedAt ? `${dateLabel(progress.completedAt, false)} ` : ""}수리 완료` };
      // 작업 건이 아직 안 끝났으면 점검 기본값 '양호' 보다 작업 건이 맞다.
      else if (progress) next = { ...item, status: item.status === "done" ? "fix" : item.status, plan: `작업 진행 중${progress.step ? ` (${progress.step})` : ""}`, caseKey };
      return { ...next, ...actionTrack({ ...next, recheck: rechecked.has(item.key) && next.status === "done" && !(progress && !progress.done), startStatus: origin.get(item.key) || item.status }, progress ? caseRecord : null, value) };
    });
    const nextPeriodValue = nextPeriod(value.period);
    const reference = isDate(options.today) ? options.today : period ? period.to : "";
    const legal = legalView(value.legal, reference);
    // 관리 시작: 이 현장의 첫 공용부·계단청소 기록. 기록에서만 센다.
    const firstCleaning = rows(workReports).filter(row => CLEANING_KINDS.includes(row.kind) && sameTarget(row, value) && isDate(row.workDate)).map(row => row.workDate).sort()[0] || "";
    const managedMonths = firstCleaning && period ? monthIndex(period.to.slice(0, 7)) - monthIndex(firstCleaning.slice(0, 7)) + 1 : 0;
    const cover = {
      photo: value.cover.photo,
      scale: value.cover.scale,
      scope: ["공용부 청소 주 1회", "건물 정기점검 격주", legal.length ? "법정점검 일정 관리" : ""].filter(Boolean).join(" · "),
      since: firstCleaning ? `${Number(firstCleaning.slice(0, 4))}년 ${Number(firstCleaning.slice(5, 7))}월부터${managedMonths > 1 ? ` (${managedMonths}개월째)` : ""}` : "",
    };
    // 두 달 안에 다가온 법정점검은 다음 일정에도 적는다.
    const legalSoon = legal.filter(item => item.tone === "soon" && item.nextMonth).slice(0, 3)
      .map(item => ({ label: item.name, date: `${Number(item.nextMonth.slice(0, 4))}년 ${Number(item.nextMonth.slice(5, 7))}월${item.due.includes(" · ") ? ` (${item.due.split(" · ").slice(1).join(" · ")})` : ""}` }));
    return {
      id: value.id,
      documentNo: documentNo(value),
      buildingId: value.buildingId,
      buildingName: value.buildingName,
      siteAddress: value.siteAddress,
      period: period ? { ...period, label: periodLabel(value.period), range: `${dateLabel(period.from, true).replace(/\(.\)$/u, "")} ~ ${dateLabel(period.to, false).replace(/\(.\)$/u, "")}` } : null,
      cleanings,
      inspection: {
        date: value.inspection.date,
        dateLabel: dateLabel(value.inspection.date),
        inspectorName: value.inspection.inspectorName,
        // 관찰·조치 항목은 지난 점검의 같은 항목 사진을 같이 싣는다. 건물주가 변화(커졌는지,
        // 고쳐졌는지)를 나란히 보게 하려는 것이다. 지난 보고서에 사진이 있을 때만.
        items: value.inspection.items.filter(item => item.status !== "na").map(item => {
          const before = previous && ["watch", "fix", "done"].includes(item.status)
            ? normalizeReport(previous).inspection.items.find(row => row.key === item.key && row.photos.length && row.status !== "na") : null;
          return before ? { ...item, previous: { date: normalizeReport(previous).inspection.date, dateLabel: dateLabel(normalizeReport(previous).inspection.date, false), status: before.status, note: before.note, photos: before.photos.slice(0, 1) } } : item;
        }),
      },
      counts: counts(value),
      actions,
      summary: value.summary || autoSummary(value, cleanings),
      followUp: value.followUp,
      nextSchedule: [...(value.nextSchedule.length ? value.nextSchedule.map(item => ({ label: item.label, date: dateLabel(item.date) }))
        // 보낼 날짜는 적지 않는다. 늦게 만들면 "10. 31. 이후 발송" 처럼 이미 지난 날이 찍힌다.
        : nextPeriodValue ? [{ label: "다음 정기 관리보고서", date: `${periodLabel(nextPeriodValue.key)} (${[nextPeriodValue.from, nextPeriodValue.to].map(day => dateLabel(day, false).replace(/\(.\)$/u, "").trim()).join(" ~ ")} 관리분)` }] : []), ...legalSoon],
      cover,
      legal,
    };
  }

  // 건물·기간 하나에 보고서 하나. 같은 기간 것을 두 번 만들지 않게 찾는다.
  function findForPeriod(reports, target, periodKey) {
    return rows(reports).map(normalizeReport).find(row => row.period === periodKey && sameTarget(row, target)) || null;
  }

  // 청소 사진 중 점검 근거가 될 만한 후보. 점검 항목과 겹치는 구역(설비·분리수거장·배수·조명·
  // 현관·창)을 먼저, 그다음 작업 후 사진을 고른다. 이미 점검에 붙은 사진은 빼고, 구역마다 한 장씩
  // 돌려 가며 고른다 — 한 구역 사진만 몰리면 다른 항목 근거를 못 찾는다.
  const EVIDENCE_AREAS = ["fixtures", "recycle", "drain", "lighting", "light", "entrance", "windows", "stairWindow", "glass", "walls", "rooftop", "parking", "handrail"];
  function cleaningPhotoCandidates(cleanings, report) {
    const used = new Set(normalizeReport(report).inspection.items.flatMap(item => item.photos.map(photo => photo.id)));
    const groups = new Map();
    rows(cleanings).forEach(row => rows(row.items).forEach(item => {
      const photos = [...rows(item.after), ...rows(item.during), ...rows(item.before)].filter(photo => photo && photo.id && !used.has(photo.id));
      if (!photos.length) return;
      const rank = EVIDENCE_AREAS.indexOf(item.key);
      const key = `${rank < 0 ? 99 : rank}:${item.key}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(...photos.map(photo => ({ id: photo.id, driveFileId: photo.driveFileId || photo.id, webViewLink: photo.webViewLink || "", caption: "", area: item.label || item.key })));
    }));
    const ordered = [...groups.entries()].sort((a, b) => Number(a[0].split(":")[0]) - Number(b[0].split(":")[0])).map(([, list]) => list);
    const picked = [];
    for (let round = 0; picked.length < 24 && ordered.some(list => list[round]); round += 1) {
      ordered.forEach(list => { if (list[round] && picked.length < 24) picked.push(list[round]); });
    }
    const seen = new Set();
    return picked.filter(photo => !seen.has(photo.id) && seen.add(photo.id));
  }

  // AI 제안을 화면이 쓸 모양으로. 모르는 항목·모르는 상태는 버리고, 청소 사진 제안은 확신이
  // 낮으면 버린다(근거 사진 추천이 틀리면 엉뚱한 사진이 건물주 보고서에 실린다).
  function normalizeSuggestions(reviews, photosById, mode) {
    const keys = new Set(INSPECTION_ITEMS.map(item => item.key));
    return rows(reviews).map(review => {
      const photo = photosById.get(review && review.id);
      if (!photo || !keys.has(review.itemKey)) return null;
      const status = ["good", "watch", "fix"].includes(review.status) ? review.status : "";
      const confidence = Number(review.confidence) || 0;
      if (mode === "cleaning" && confidence < 0.6) return null;
      if (mode === "inspection" && !status) return null;
      return {
        photo: { id: photo.id, driveFileId: photo.driveFileId || photo.id, webViewLink: photo.webViewLink || "", caption: "" },
        itemKey: review.itemKey,
        label: (INSPECTION_ITEMS.find(item => item.key === review.itemKey) || {}).label || "",
        status, note: text(review.note, 60), confidence, area: text(photo.area, 60),
      };
    }).filter(Boolean);
  }

  // 이번에 낼 차례인 보고서들. 오늘 기준으로 막 끝난 기간(어제까지 끝난 기간)에 공용부
  // 청소 기록이 있는 건물·고객마다 하나. 보고서가 없으면 '초안 없음', 있으면 작성 상태를 본다.
  // 사람이 대상 건물을 기억해 챙기지 않아도 빠진 곳이 보이게 하려는 것이다.
  function dueReports(workReports, reports, today, buildingIds) {
    const known = new Set(rows(buildingIds).map(id => text(id, 120)).filter(Boolean));
    const now = periodOf(today);
    const period = now ? previousPeriod(now.key) : null;
    if (!period) return { period: null, items: [] };
    const targets = new Map();
    WorkReport.sortReports(workReports)
      .filter(row => CLEANING_KINDS.includes(row.kind) && row.workDate >= period.from && row.workDate <= period.to)
      .forEach(row => {
        const id = targetKey(row);
        if (!id) return;
        if (!targets.has(id)) targets.set(id, { id, building: false, buildingName: "", siteAddress: "", cleanings: [] });
        const entry = targets.get(id);
        // 건물 기록과 고객 단위 기록이 섞이면 하나로 묶고 건물로 본다.
        if (text(row.buildingId, 120) || known.has(id)) entry.building = true;
        entry.buildingName = entry.buildingName || row.buildingName;
        entry.siteAddress = entry.siteAddress || row.siteAddress;
        entry.cleanings.push(row);
      });
    const items = [...targets.values()].map(({ id, building, ...rest }) => ({
      ...rest, key: building ? `b:${id}` : `c:${id}`, target: building ? { buildingId: id } : { buildingId: "", customerId: id },
    })).map(entry => {
      const report = findForPeriod(reports, entry.target, period.key);
      const blockers = report ? blockersFor(report, workReports) : [];
      const state = !report ? "missing" : report.delivery ? "sent" : blockers.length ? "draft" : "ready";
      return { ...entry, cleanings: entry.cleanings.sort((a, b) => a.workDate.localeCompare(b.workDate)), report, state, blockers };
    }).sort((a, b) => ({ missing: 0, draft: 1, ready: 2, sent: 3 })[a.state] - ({ missing: 0, draft: 1, ready: 2, sent: 3 })[b.state]
      || String(a.buildingName).localeCompare(String(b.buildingName), "ko"));
    return { period, items };
  }

  // 대상 하나의 초안. 점검일은 마지막 청소일로 둔다 — 보통 마지막 청소 날 점검을 같이 한다.
  // 표지·법정점검은 건물 정보라 다음 보고서로 그대로 넘긴다. 바뀌면 그 보고서에서 고친다.
  function carriedBuilding(previousReport) {
    if (!previousReport) return {};
    const previous = normalizeReport(previousReport);
    return { cover: previous.cover, legal: previous.legal };
  }

  // 이 기간보다 앞선 같은 건물 보고서 중 가장 최근 것. 한 기간을 걸렀어도 이어받게 한다.
  function latestBefore(reports, target, periodKey) {
    return sortReports(rows(reports)).find(row => sameTarget(row, target) && row.period && row.period < String(periodKey || "")) || null;
  }

  function draftFor(entry, id, previousReport) {
    const last = rows(entry.cleanings).map(row => row.workDate).sort().pop() || "";
    const previous = previousReport ? normalizeReport(previousReport) : null;
    return normalizeReport({
      id, ...entry.target, buildingName: entry.buildingName, siteAddress: entry.siteAddress,
      ...carriedBuilding(previous),
      period: entry.period || "",
      inspection: { date: last, inspectorName: previous ? previous.inspection.inspectorName : "", confirmed: false, items: [] },
    });
  }

  // 건물별 이력. 정기 관리보고서가 쌓이면 보이는 것들:
  //  반복 문제   같은 항목이 연속 두 번 이상 관찰·조치 필요
  //  조치 일수   처음 확인한 날부터 작업 건 '공사 진행' 이 끝난 날까지(연결된 것만)
  //  청소 공백   최근 8주(일요일 시작 주) 중 공용부·계단청소 기록이 없는 주
  // 숫자는 기록에서만 센다. 기록이 없으면 셀 수 없다고 둔다.
  function addDays(date, days) {
    const [y, m, d] = date.split("-").map(Number);
    const value = new Date(Date.UTC(y, m - 1, d + days));
    return value.toISOString().slice(0, 10);
  }
  function daysBetween(from, to) {
    const parse = date => { const [y, m, d] = date.split("-").map(Number); return Date.UTC(y, m - 1, d); };
    return Math.round((parse(to) - parse(from)) / 86400000);
  }
  function weekStart(date) {
    const [y, m, d] = date.split("-").map(Number);
    return addDays(date, -new Date(Date.UTC(y, m - 1, d)).getUTCDay());
  }
  function buildingHistory(reports, workReports, cases, today) {
    const all = rows(reports).map(normalizeReport).filter(row => row.id && row.period);
    const targets = new Map();
    const keyOf = targetKey;
    all.forEach(row => { const key = keyOf(row); if (!key) return; if (!targets.has(key)) targets.set(key, []); targets.get(key).push(row); });
    const caseList = rows(cases);
    const thisWeek = isDate(today) ? weekStart(today) : "";
    return [...targets.entries()].map(([key, list]) => {
      const ordered = list.sort((a, b) => a.period.localeCompare(b.period));
      const target = ordered[ordered.length - 1].buildingId ? { buildingId: ordered[ordered.length - 1].buildingId } : { buildingId: "", customerId: ordered[ordered.length - 1].customerId };
      // 반복 문제
      const streaks = new Map();
      const repeated = [];
      ordered.forEach(row => {
        const open = new Set(row.inspection.items.filter(item => ["watch", "fix"].includes(item.status)).map(item => item.key));
        INSPECTION_ITEMS.forEach(item => {
          const next = open.has(item.key) ? (streaks.get(item.key) || 0) + 1 : 0;
          streaks.set(item.key, next);
        });
      });
      streaks.forEach((count, itemKey) => { if (count >= 2) repeated.push({ key: itemKey, label: (INSPECTION_ITEMS.find(item => item.key === itemKey) || {}).label || itemKey, count }); });
      // 조치 일수: 처음 확인(그 항목이 처음 관찰·조치로 적힌 점검일) → 연결된 작업 건 완료일
      const fixDays = [];
      const links = Object.assign({}, ...ordered.map(row => row.links));
      Object.entries(links).forEach(([itemKey, caseKey]) => {
        const first = ordered.find(row => row.inspection.items.some(item => item.key === itemKey && ["watch", "fix"].includes(item.status)));
        const progress = caseProgress(caseList.find(row => row && (row.id === caseKey || row.firebaseKey === caseKey)));
        if (first && first.inspection.date && progress && progress.done && progress.completedAt && progress.completedAt >= first.inspection.date) fixDays.push(daysBetween(first.inspection.date, progress.completedAt));
      });
      // 청소 공백
      const cleaningWeeks = new Set(WorkReport.sortReports(workReports)
        .filter(row => CLEANING_KINDS.includes(row.kind) && sameTarget(row, target)).map(row => weekStart(row.workDate)));
      const weeks = thisWeek ? Array.from({ length: 8 }, (_, i) => addDays(thisWeek, -7 * (i + 1))).reverse() : [];
      const firstCleaning = [...cleaningWeeks].sort()[0] || "";
      const missedWeeks = weeks.filter(week => firstCleaning && week >= firstCleaning && !cleaningWeeks.has(week));
      const sent = ordered.filter(row => row.delivery);
      return {
        key, target,
        buildingName: ordered.map(row => row.buildingName).filter(Boolean).pop() || "",
        reports: ordered.length,
        sent: sent.length,
        lastSentAt: sent.length ? kstDay(sent[sent.length - 1].delivery.sentAt) : "",
        openNow: ordered[ordered.length - 1].inspection.items.filter(item => ["watch", "fix"].includes(item.status)).length,
        repeated: repeated.sort((a, b) => b.count - a.count),
        avgFixDays: fixDays.length ? Math.round(fixDays.reduce((sum, value) => sum + value, 0) / fixDays.length) : null,
        fixedCount: fixDays.length,
        missedWeeks,
        weeksChecked: weeks.filter(week => firstCleaning && week >= firstCleaning).length,
      };
    }).sort((a, b) => (b.repeated.length + b.missedWeeks.length) - (a.repeated.length + a.missedWeeks.length) || String(a.buildingName).localeCompare(String(b.buildingName), "ko"));
  }

  // 건물 월간보고서에 싣는 한 달 요약. 그 달 1차·2차 정기 관리보고서마다 청소일·점검 건수·남은 조치.
  function monthSummary(reports, workReports, buildingId, month) {
    if (!/^\d{4}-\d{2}$/.test(String(month || "")) || !text(buildingId, 120)) return [];
    return [1, 2].map(half => {
      const key = `${month}-${half}`;
      const report = findForPeriod(reports, { buildingId: text(buildingId, 120) }, key);
      if (!report) return null;
      const view = buildView(report, workReports, {});
      return {
        period: key,
        label: periodLabel(key),
        cleaningDates: view.cleanings.map(row => dateLabel(row.workDate, false)),
        inspectionDate: view.inspection.dateLabel,
        counts: view.counts,
        openActions: view.actions.filter(item => ["watch", "fix"].includes(item.status)).map(item => ({ label: item.label, status: item.status, finding: item.finding })),
        sent: Boolean(report.delivery),
      };
    }).filter(Boolean);
  }

  function sortReports(reports) {
    return rows(reports).map(normalizeReport).filter(row => row.id)
      .sort((a, b) => b.period.localeCompare(a.period) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  // 보고서 사진 id 목록. 메인 프로세스가 Drive 에서 받아 data: 로 박을 때 쓴다.
  function photoIds(view) {
    const ids = [];
    rows(view && view.cleanings).forEach(row => rows(row.items).forEach(item => ["before", "during", "after"].forEach(phase => rows(item[phase]).forEach(photo => ids.push(photo.id)))));
    rows(view && view.inspection && view.inspection.items).forEach(item => rows(item.photos).forEach(photo => ids.push(photo.id)));
    if (view && view.cover && view.cover.photo) ids.push(view.cover.photo.id);
    return [...new Set(ids.filter(Boolean))];
  }

  return Object.freeze({
    INSPECTION_ITEMS,
    STATUSES,
    STATUS_KEYS,
    CLEANING_KINDS,
    statusLabel,
    parsePeriod,
    periodOf,
    previousPeriod,
    nextPeriod,
    periodLabel,
    dateLabel,
    weekOfMonth,
    normalizeInspectionItem,
    inspectionItems,
    normalizeReport,
    cleaningsFor,
    carryOverActions,
    actionsFromInspection,
    counts,
    blockers,
    validateReport,
    validateDraft,
    normalizeDelivery,
    recipientFor,
    viewState,
    kstDay,
    kstTime,
    normalizeLinks,
    caseProgress,
    kakaoDetails,
    documentNo,
    autoSummary,
    buildView,
    findForPeriod,
    dueReports,
    monthSummary,
    buildingHistory,
    cleaningPhotoCandidates,
    normalizeSuggestions,
    draftFor,
    sortReports,
    photoIds,
    LEGAL_CYCLES,
    LEGAL_RESULTS,
    LEGAL_PRESETS,
    normalizeCover,
    normalizeLegal,
    normalizeLegalList,
    legalNextMonth,
    legalView,
    carriedBuilding,
    latestBefore,
  });
});
