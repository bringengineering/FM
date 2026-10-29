// 생활서비스 화면 3개(오늘 할 일 · 문의·상담 · 가입 진행).
//
// 화면은 이 파일이 그리고, 이벤트도 이 파일이 받는다. app.js 는 render(context)
// 한 번만 부르고, 바꾸는 일은 context.commit 으로 돌려받아 기존 공용 저장 경로
// (권한 확인 → 감사 기록 → 서버 저장 → 실패 시 되돌림)로 처리한다.
// 그래서 app.js 의 큰 클릭 처리기에는 손대지 않는다. data-life-* 속성만 쓴다.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringLifeServiceUI = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const VIEWS = Object.freeze(["lifeToday", "lifeInbox", "lifeBoard"]);
  const state = {
    selectedLeadId: "", selectedAppId: "", leadFilter: "open", leadQuery: "", boardFilter: "open",
    newLeadOpen: false, appFormOpen: false, closeFormOpen: false,
  };
  let ctx = null;

  const isLifeView = view => VIEWS.includes(view);

  // ---------------------------------------------------------------- formatting
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }
  const attr = esc;
  const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

  function koreaParts(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const k = new Date(date.getTime() + 9 * 3600000);
    return { y: k.getUTCFullYear(), m: k.getUTCMonth() + 1, d: k.getUTCDate(), w: WEEK[k.getUTCDay()], hh: String(k.getUTCHours()).padStart(2, "0"), mm: String(k.getUTCMinutes()).padStart(2, "0") };
  }
  function fmtDateTime(value) {
    const p = koreaParts(value);
    return p ? `${p.m}/${p.d} (${p.w}) ${p.hh}:${p.mm}` : "";
  }
  function fmtDay(value) {
    const p = koreaParts(value);
    return p ? `${p.m}/${p.d} (${p.w})` : "";
  }
  function fmtTime(value) {
    const p = koreaParts(value);
    return p ? `${p.hh}:${p.mm}` : "";
  }
  function fmtMoney(value) {
    const number = Number(value) || 0;
    return number ? `${number.toLocaleString("ko-KR")}원` : "—";
  }
  function localInput(value) {
    const p = koreaParts(value);
    return p ? `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}T${p.hh}:${p.mm}` : "";
  }
  function fromLocalInput(value) {
    const raw = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return "";
    const date = new Date(`${raw}:00+09:00`);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }
  function todayLabel(now) {
    const p = koreaParts(now);
    return p ? `${p.m}월 ${p.d}일 (${p.w})` : "";
  }

  function chip(textValue, tone) {
    return `<span class="life-chip is-${attr(tone || "idle")}">${esc(textValue)}</span>`;
  }
  function trackChip(field, status) {
    const C = ctx.Core;
    return chip(C.label(field, status), C.tone(field, status));
  }
  function options(map, selected, includeBlank) {
    const blank = includeBlank ? `<option value="">${esc(includeBlank)}</option>` : "";
    return blank + Object.entries(map).map(([value, label]) => `<option value="${attr(value)}"${value === selected ? " selected" : ""}>${esc(label)}</option>`).join("");
  }
  function field(label, control, wide) {
    return `<label class="life-field${wide ? " is-wide" : ""}"><span>${esc(label)}</span>${control}</label>`;
  }
  function input(name, value, extra) {
    return `<input name="${attr(name)}" value="${attr(value || "")}"${extra || ""}>`;
  }
  function textarea(name, value, rows) {
    return `<textarea name="${attr(name)}" rows="${rows || 2}">${esc(value || "")}</textarea>`;
  }
  function empty(title, body) {
    return `<div class="life-empty"><b>${esc(title)}</b>${body ? `<span>${esc(body)}</span>` : ""}</div>`;
  }
  function readOnlyNote() {
    return ctx.canWrite ? "" : `<p class="life-readonly">조회 전용 계정입니다. 내용을 바꿀 수 없습니다.</p>`;
  }

  // ---------------------------------------------------------------- shared head
  function head(title, subtitle, actions) {
    return `<header class="life-head"><div><span class="life-eyebrow">생활서비스 · 인터넷·TV·렌탈</span><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div><div class="life-head-actions">${actions || ""}</div></header>`;
  }
  function newLeadButton() {
    return ctx.canWrite ? `<button type="button" class="primary-button" data-life-new-lead>＋ 문의 등록</button>` : "";
  }

  // ---------------------------------------------------------------- 오늘 할 일
  function leadLine(lead) {
    const C = ctx.Core;
    return `${esc(lead.name || lead.phone || "이름 미입력")} <small>${esc(C.CUSTOMER_TYPES[lead.customerType] || "")} · ${esc(C.PRODUCT_LINES[lead.productLine] || "")}</small>`;
  }
  function appLine(app, lead) {
    return `${esc(lead ? (lead.name || lead.phone) : "고객 미확인")} <small>${esc(app.carrier)} ${esc(app.product)} · 접수 ${esc(app.oneqNo)}</small>`;
  }

  function renderToday() {
    const C = ctx.Core;
    const q = C.todayQueue(ctx.store, ctx.now(), { isAdmin: ctx.isAdmin });
    const kindLabel = { first: "첫 연락", callback: "재연락 예약", no_answer: "부재 재시도" };
    const callRows = q.callNow.map(item => `<li class="life-row"><span class="life-row-time${item.overdue ? " is-late" : ""}">${esc(fmtTime(item.at) || "-")}</span><div class="life-row-main"><b>${leadLine(item.lead)}</b><span>${esc(fmtDay(item.at))} · ${esc(kindLabel[item.kind] || "")}${item.lead.noAnswerCount ? ` · 부재 ${item.lead.noAnswerCount}회` : ""}${item.lead.nextContactNote ? ` · ${esc(item.lead.nextContactNote)}` : ""}</span></div>${item.overdue ? chip("기한 지남", "bad") : chip(kindLabel[item.kind] || "", "info")}<button type="button" class="secondary-button" data-life-open-lead="${attr(item.lead.id)}">열기</button></li>`).join("");
    const appRow = (item, extra, action) => `<li class="life-row"><div class="life-row-main"><b>${appLine(item.app, item.lead)}</b><span>${extra}</span></div>${action}</li>`;
    const noReport = q.installNoReport.map(item => appRow(item, `설치 ${esc(fmtDateTime(item.app.installConfirmedAt))} · 고객 완료 연락 없음`, `<button type="button" class="secondary-button" data-life-open-app="${attr(item.app.id)}">확인 전화</button>`)).join("");
    const blockedReason = app => [
      ["happycall_wait", "needs_fix"].includes(app.intakeStatus) ? `접수: ${C.label("intakeStatus", app.intakeStatus)}` : "",
      ["delayed", "impossible"].includes(app.installStatus) ? `설치: ${C.label("installStatus", app.installStatus)}` : "",
      app.giftStatus === "held" ? `사은품 보류${app.giftHoldReason ? ` · ${app.giftHoldReason}` : ""}` : "",
    ].filter(Boolean).join(" · ");
    const blocked = q.blocked.map(item => appRow(item, esc(blockedReason(item.app)), `<button type="button" class="secondary-button" data-life-open-app="${attr(item.app.id)}">열기</button>`)).join("");
    const reengage = q.reengage.map(lead => `<li class="life-row"><div class="life-row-main"><b>${leadLine(lead)}</b><span>약정 만료 ${esc(lead.consult.contractEndMonth)} · ${esc(lead.consult.currentCarrier || "통신사 미기록")}</span></div><button type="button" class="secondary-button" data-life-open-lead="${attr(lead.id)}">재영업 시작</button></li>`).join("");
    const adminBlock = ctx.isAdmin ? `<section class="life-card is-admin"><div class="life-card-head"><h3>사은품 지급 대기</h3><span>대표님만 보입니다</span></div><ul class="life-rows">${q.giftRequests.map(item => appRow(item, `약속 ${fmtMoney(item.app.promisedGift)} · 요청 ${esc(fmtDateTime(item.app.giftRequestedAt))}`, `<button type="button" class="secondary-button" data-life-open-app="${attr(item.app.id)}">이체 처리</button>`)).join("") || `<li>${empty("지금 지급할 건이 없습니다")}</li>`}</ul>${q.oneqWarnings.length ? `<div class="life-card-head"><h3>지급 후 원큐 개통 확인 없음</h3><span>${C.POLICY.oneqConfirmWarnDays}일 지남</span></div><ul class="life-rows">${q.oneqWarnings.map(item => appRow(item, `지급 ${esc(fmtDay(item.app.giftPaidAt))} · 원큐 확인 없음`, `${chip("확인 필요", "bad")}<button type="button" class="secondary-button" data-life-open-app="${attr(item.app.id)}">열기</button>`)).join("")}</ul>` : ""}</section>` : "";
    const kpi = (labelText, value, tone) => `<div class="life-kpi${tone ? ` is-${tone}` : ""}"><span>${esc(labelText)}</span><b>${esc(value)}</b></div>`;
    return `<section class="life-page" data-life-root>
      ${head(`오늘 할 일 · ${todayLabel(ctx.now())}`, "오늘 연락할 고객과 막힌 가입 건을 순서대로 보여줍니다.", `<button type="button" class="secondary-button" data-life-go="lifeBoard">가입 진행</button>${newLeadButton()}`)}
      <div class="life-kpis">${kpi("오늘 새 문의", q.counts.newToday)}${kpi("지금 연락할 고객", q.counts.callNow, q.callNow.some(item => item.overdue) ? "warn" : "")}${kpi("설치 후 연락 없음", q.counts.installNoReport, q.counts.installNoReport ? "warn" : "")}${kpi("막힌 가입 건", q.counts.blocked, q.counts.blocked ? "warn" : "")}${ctx.isAdmin ? kpi("사은품 지급 대기", q.counts.giftRequests, q.counts.giftRequests ? "warn" : "") : ""}</div>
      <div class="life-today-grid">
        <section class="life-card is-wide"><div class="life-card-head"><h3>지금 연락할 고객</h3><span>시간 순서 · 첫 연락 기한 ${ctx.Core.POLICY.firstContactHours}시간</span></div><ul class="life-rows">${callRows || `<li>${empty("지금 연락할 고객이 없습니다", "새 문의가 들어오면 여기에 먼저 뜹니다.")}</li>`}</ul></section>
        ${adminBlock}
        <section class="life-card"><div class="life-card-head"><h3>설치 후 연락 없음</h3><span>설치일 다음 날부터</span></div><ul class="life-rows">${noReport || `<li>${empty("확인 전화할 건이 없습니다")}</li>`}</ul></section>
        <section class="life-card"><div class="life-card-head"><h3>막힌 가입 건</h3><span>해피콜 부재·보완·지연·보류</span></div><ul class="life-rows">${blocked || `<li>${empty("막힌 건이 없습니다")}</li>`}</ul></section>
        <section class="life-card"><div class="life-card-head"><h3>약정 만료 다가오는 고객</h3><span>만료 ${ctx.Core.POLICY.reengageMonthsBefore}개월 전</span></div><ul class="life-rows">${reengage || `<li>${empty("재영업할 고객이 없습니다")}</li>`}</ul></section>
      </div>
      <p class="life-policy">운영 기준(대표님 확정 전 기본안): 첫 연락 ${ctx.Core.POLICY.firstContactHours}시간 안 · 부재 ${ctx.Core.POLICY.noAnswerMaxAttempts}회 후 문자 1회 뒤 종료 · 설치일 다음 날 확인 전화 · 지급 후 ${ctx.Core.POLICY.oneqConfirmWarnDays}일 안 원큐 개통 확인</p>
    </section>`;
  }

  // ---------------------------------------------------------------- 문의·상담
  function renderNewLeadForm() {
    const C = ctx.Core;
    return `<form class="life-card life-new-lead" data-life-form="newLead" autocomplete="off">
      <div class="life-card-head"><h3>문의 등록</h3><button type="button" class="mini-button" data-life-toggle="newLeadOpen">닫기</button></div>
      <div class="life-fields">
        ${field("이름", input("name", "", ' placeholder="고객 이름 또는 상호"'))}
        ${field("연락처", input("phone", "", ' type="tel" placeholder="010-0000-0000"'))}
        ${field("고객 유형", `<select name="customerType">${options(C.CUSTOMER_TYPES, "personal")}</select>`)}
        ${field("상품", `<select name="productLine">${options(C.PRODUCT_LINES, "internet_tv")}</select>`)}
        ${field("출처 (어디서 왔나)", `<select name="source">${options(C.SOURCES, "homepage")}</select>`)}
        ${field("연락 방식 (누가 먼저)", `<select name="contactMethod">${options(C.CONTACT_METHODS, "customer_inquiry")}</select>`)}
        ${field("문의 내용", textarea("inquiryText", "", 2), true)}
      </div>
      <div class="life-form-foot"><span>같은 번호가 이미 있으면 새로 만들지 않고 기존 기록을 엽니다.</span><button type="submit" class="primary-button">등록</button></div>
    </form>`;
  }

  function renderLeadList(leads) {
    const C = ctx.Core;
    if (!leads.length) return empty(state.leadQuery ? "검색 결과가 없습니다" : "문의가 없습니다", state.leadQuery ? "" : "‘＋ 문의 등록’으로 첫 문의를 넣어 주세요.");
    return leads.map(lead => {
      const due = lead.status === "closed" ? (lead.reengageAt ? `재영업 ${lead.reengageAt}` : C.CLOSE_REASONS[lead.closeReason] || "") : lead.nextContactAt ? `재연락 ${fmtDateTime(lead.nextContactAt)}` : lead.status === "new" ? `첫 연락 기한 ${fmtTime(lead.firstContactDueAt)}` : "";
      return `<button type="button" class="life-lead${lead.id === state.selectedLeadId ? " is-selected" : ""}" data-life-select-lead="${attr(lead.id)}"><span class="life-lead-top"><b>${esc(lead.name || lead.phone || "이름 미입력")}</b>${chip(C.label("lead", lead.status), C.tone("lead", lead.status))}</span><span class="life-lead-sub">${esc(C.SOURCES[lead.source] || "")} · ${esc(C.PRODUCT_LINES[lead.productLine] || "")}</span>${due ? `<span class="life-lead-due">${esc(due)}</span>` : ""}</button>`;
    }).join("");
  }

  function renderContactForm(lead) {
    const C = ctx.Core;
    if (!ctx.canWrite) return "";
    if (lead.doNotContact) return `<section class="life-card"><div class="life-card-head"><h3>통화 결과 기록</h3></div><p class="life-warn">연락 거절 고객입니다. 전화·문자를 하지 않습니다.</p></section>`;
    const hint = lead.noAnswerCount >= C.POLICY.noAnswerMaxAttempts
      ? `<p class="life-warn">부재 ${lead.noAnswerCount}회입니다. 기준대로 문자 1회 보낸 뒤 '종료 · 연락 안 됨'으로 정리해 주세요.</p>`
      : lead.noAnswerCount ? `<p class="life-hint">지금까지 부재 ${lead.noAnswerCount}회</p>` : "";
    return `<form class="life-card" data-life-form="contact" data-lead-id="${attr(lead.id)}">
      <div class="life-card-head"><h3>통화 결과 기록</h3><span>결과는 하나만 고릅니다</span></div>
      <div class="life-radios" role="radiogroup" aria-label="통화 결과">${Object.entries(C.CONTACT_RESULTS).map(([value, label]) => `<label class="life-radio"><input type="radio" name="result" value="${attr(value)}"><span>${esc(label)}</span></label>`).join("")}</div>
      <div class="life-fields">
        ${field("연락 수단", `<select name="channel">${options(C.CONTACT_CHANNELS, "phone")}</select>`)}
        ${field("재연락 일시", `<input type="datetime-local" name="nextContactAt" value="">`)}
        ${field("메모", input("memo", "", ' placeholder="예: 점심 장사 끝나고 통화 원함"'), true)}
      </div>
      ${hint}
      <div class="life-form-foot"><span>‘연락 거절’을 고르면 이후 전화·문자가 막힙니다.</span><button type="submit" class="primary-button">기록</button></div>
    </form>`;
  }

  function renderConsultSummary(lead) {
    const C = ctx.Core;
    const c = lead.consult;
    const rowsValue = [
      ["상품", C.PRODUCT_LINES[lead.productLine]], ["신청 유형", C.REQUEST_TYPES[c.requestType]], ["설치 주소", c.installAddress],
      ["희망 설치일", c.desiredInstall], ["통화 가능 시간", c.callableTime], ["지금 통신사", c.currentCarrier], ["지금 상품", c.currentProduct],
      ["지금 월 요금", c.currentMonthlyFee], ["약정 만료 월", c.contractEndMonth], ["가족 결합", c.familyBundle], ["상가 장비", c.storeEquipment], ["상담 메모", c.memo],
    ].filter(([, value]) => value);
    return `<section class="life-card"><div class="life-card-head"><h3>상담 내용</h3></div>${rowsValue.length ? `<dl class="life-summary">${rowsValue.map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>` : empty("아직 기록된 상담 내용이 없습니다")}</section>`;
  }

  function renderConsultForm(lead) {
    const C = ctx.Core;
    const c = lead.consult;
    if (!ctx.canWrite) return renderConsultSummary(lead);
    return `<form class="life-card" data-life-form="consult" data-lead-id="${attr(lead.id)}">
      <div class="life-card-head"><h3>상담 내용</h3><span>모르는 건 ‘모름’으로 두고 아래 ‘확인할 것’에 남깁니다</span></div>
      <div class="life-fields">
        ${field("이름", input("name", lead.name))}
        ${field("연락처", input("phone", lead.phone, ' type="tel"'))}
        ${field("고객 유형", `<select name="customerType">${options(C.CUSTOMER_TYPES, lead.customerType)}</select>`)}
        ${field("상품", `<select name="productLine">${options(C.PRODUCT_LINES, lead.productLine)}</select>`)}
        ${field("신청 유형", `<select name="requestType">${options(C.REQUEST_TYPES, c.requestType)}</select>`)}
        ${field("설치 주소", input("installAddress", c.installAddress), true)}
        ${field("희망 설치일", input("desiredInstall", c.desiredInstall, ' placeholder="예: 11월 초 평일 오전"'))}
        ${field("통화 가능 시간", input("callableTime", c.callableTime, ' placeholder="예: 평일 18시 이후"'))}
        ${field("지금 쓰는 통신사(업체)", input("currentCarrier", c.currentCarrier, ' placeholder="예: KT"'))}
        ${field("지금 상품", input("currentProduct", c.currentProduct, ' placeholder="예: 인터넷 500M + TV"'))}
        ${field("지금 월 요금", input("currentMonthlyFee", c.currentMonthlyFee, ' placeholder="모름"'))}
        ${field("약정 만료 월", `<input type="month" name="contractEndMonth" value="${attr(c.contractEndMonth)}">`)}
        ${field("가족 휴대폰 결합", textarea("familyBundle", c.familyBundle, 2), true)}
        ${lead.customerType !== "personal" ? field("상가 장비 (POS·카드단말기·CCTV·고정 IP)", textarea("storeEquipment", c.storeEquipment, 2), true) : ""}
        ${field("상담 메모", textarea("memo", c.memo, 3), true)}
      </div>
      <div class="life-form-foot"><span>약정 만료 월은 꼭 받아 두세요. 지금 못 바꿔도 만료 전에 다시 연락합니다.</span><button type="submit" class="primary-button">상담 저장</button></div>
    </form>`;
  }

  function renderChecks(lead) {
    const C = ctx.Core;
    const list = lead.checks.map(check => `<li class="life-check"><span class="life-check-owner">${esc(C.CHECK_OWNERS[check.owner])}</span><span class="life-check-text">${esc(check.text)}${check.result ? `<small>${esc(check.result)}</small>` : ""}</span>${chip(C.CHECK_STATUSES[check.status], check.status === "done" ? "good" : check.status === "requested" ? "info" : "warn")}${ctx.canWrite ? `<span class="life-check-actions">${check.status !== "requested" ? `<button type="button" class="mini-button" data-life-check="${attr(check.id)}" data-life-check-status="requested" data-lead-id="${attr(lead.id)}">요청함</button>` : ""}${check.status !== "done" ? `<button type="button" class="mini-button" data-life-check="${attr(check.id)}" data-life-check-status="done" data-lead-id="${attr(lead.id)}">완료</button>` : ""}</span>` : ""}</li>`).join("");
    return `<section class="life-card"><div class="life-card-head"><h3>확인할 것</h3><span>누가 확인하는지 함께 남깁니다</span></div><ul class="life-checks">${list || `<li>${empty("확인할 것이 없습니다")}</li>`}</ul>
      ${ctx.canWrite ? `<form class="life-inline-form" data-life-form="addCheck" data-lead-id="${attr(lead.id)}"><select name="owner" aria-label="확인할 사람">${options(C.CHECK_OWNERS, "oneq")}</select><input name="text" placeholder="예: 배우자 SKT 휴대폰 결합 할인 가능한지" aria-label="확인할 내용"><button type="submit" class="secondary-button">추가</button></form>` : ""}</section>`;
  }

  function renderApplicationForm(lead) {
    const C = ctx.Core;
    return `<form class="life-subform" data-life-form="application" data-lead-id="${attr(lead.id)}">
      <div class="life-fields">
        ${field("고객 동의 일시", `<input type="datetime-local" name="agreedAt" value="${attr(localInput(ctx.now().toISOString()))}">`)}
        ${field("동의 받은 방법", `<select name="agreedChannel">${options(C.CONTACT_CHANNELS, "phone")}</select>`)}
        ${field("통신사(제조사)", input("carrier", "", ' placeholder="예: LG U+"'))}
        ${field("상품", input("product", "", ' placeholder="예: 인터넷 500M + TV 기본"'))}
        ${field("원큐 접수번호", input("oneqNo", "", ' placeholder="원큐에서 받은 번호"'))}
        ${field("고객에게 약속한 사은품(원)", input("promisedGift", "", ' inputmode="numeric" placeholder="예: 400000"'))}
        ${field("견적 요약 (월 요금·할인·설치비·약정·반환 조건)", textarea("quoteSummary", "", 2), true)}
      </div>
      <fieldset class="life-musts"><legend>필수 안내 체크 (4개 모두 있어야 만들어집니다)</legend>
        <label><input type="checkbox" name="notice"> 원큐 필수 안내 내용 설명</label>
        <label><input type="checkbox" name="recording"> 통화 녹취 완료</label>
        <label><input type="checkbox" name="refundTerms"> 사은품 반환 조건 안내</label>
        <label><input type="checkbox" name="happycallNotice"> 통신사 해피콜 전화가 간다고 안내</label>
      </fieldset>
      <p class="life-hint">주민번호·계좌·카드 번호와 신분증 같은 서류는 원큐 사이트에만 입력합니다. CRM 에는 접수번호만 남깁니다.</p>
      <div class="life-form-foot"><span></span><button type="submit" class="primary-button">가입 건 만들기</button></div>
    </form>`;
  }

  function renderLeadApplications(lead) {
    const apps = ctx.Core.applicationsForLead(ctx.store, lead.id);
    const list = apps.map(app => `<li class="life-row"><div class="life-row-main"><b>${esc(app.carrier)} ${esc(app.product)}</b><span>접수 ${esc(app.oneqNo)} · 사은품 ${esc(fmtMoney(app.promisedGift))}</span></div><span class="life-track-chips">${trackChip("intakeStatus", app.intakeStatus)}${trackChip("installStatus", app.installStatus)}${trackChip("giftStatus", app.giftStatus)}</span><button type="button" class="secondary-button" data-life-open-app="${attr(app.id)}">진행판</button></li>`).join("");
    const canCreate = ctx.canWrite && !lead.doNotContact;
    return `<section class="life-card"><div class="life-card-head"><h3>가입 건</h3>${canCreate ? `<button type="button" class="secondary-button" data-life-toggle="appFormOpen">${state.appFormOpen ? "닫기" : "＋ 원큐 접수 등록"}</button>` : ""}</div>
      ${list ? `<ul class="life-rows">${list}</ul>` : `<p class="life-hint">고객이 진행에 동의하면 원큐에 접수하고, 받은 접수번호로 가입 건을 만듭니다.</p>`}
      ${canCreate && state.appFormOpen ? renderApplicationForm(lead) : ""}</section>`;
  }

  function renderLinkCustomer(lead) {
    const linked = lead.crmCustomerId ? (ctx.customers || []).find(customer => customer && customer.id === lead.crmCustomerId) : null;
    if (linked) return `<div class="life-link">기존 고객 카드: <b>${esc(linked.name || linked.company || linked.id)}</b>${ctx.canWrite ? ` <button type="button" class="mini-button" data-life-link="" data-lead-id="${attr(lead.id)}">연결 해제</button>` : ""}</div>`;
    if (!ctx.canWrite) return "";
    const suggestions = ctx.Core.suggestCustomers(ctx.customers, lead, 3);
    if (!suggestions.length) return "";
    return `<div class="life-link">같은 번호·이름의 기존 고객이 있습니다: ${suggestions.map(customer => `<button type="button" class="mini-button" data-life-link="${attr(customer.id)}" data-lead-id="${attr(lead.id)}">${esc(customer.name || customer.company)} 연결</button>`).join(" ")}</div>`;
  }

  function renderCloseCard(lead) {
    const C = ctx.Core;
    if (lead.status === "closed") {
      return `<section class="life-card"><div class="life-card-head"><h3>종료됨</h3>${ctx.canWrite && !lead.doNotContact ? `<button type="button" class="secondary-button" data-life-reopen="${attr(lead.id)}">다시 상담</button>` : ""}</div><p class="life-hint">${esc(C.CLOSE_REASONS[lead.closeReason] || "")}${lead.reengageAt ? ` · ${esc(lead.reengageAt)}에 재영업 알림` : ""}${lead.closeNote ? ` · ${esc(lead.closeNote)}` : ""}</p></section>`;
    }
    if (!ctx.canWrite) return "";
    return `<section class="life-card"><div class="life-card-head"><h3>상담 종료</h3><button type="button" class="mini-button" data-life-toggle="closeFormOpen">${state.closeFormOpen ? "닫기" : "종료하기"}</button></div>
      ${state.closeFormOpen ? `<form class="life-subform" data-life-form="close" data-lead-id="${attr(lead.id)}"><div class="life-fields">${field("종료 사유", `<select name="reason">${options(C.CLOSE_REASONS, "", "골라 주세요")}</select>`)}${field("약정 만료 월 (약정 남음일 때)", `<input type="month" name="contractEndMonth" value="${attr(lead.consult.contractEndMonth)}">`)}${field("메모", input("note", ""), true)}</div><div class="life-form-foot"><span>약정이 남아 종료하면 만료 ${C.POLICY.reengageMonthsBefore}개월 전에 ‘오늘 할 일’로 다시 올라옵니다.</span><button type="submit" class="secondary-button">종료</button></div></form>` : ""}</section>`;
  }

  function renderHistory(lead) {
    const C = ctx.Core;
    const contacts = C.contactsForLead(ctx.store, lead.id);
    if (!contacts.length) return "";
    return `<section class="life-card"><div class="life-card-head"><h3>연락 기록</h3><span>${contacts.length}건</span></div><ol class="life-timeline">${contacts.map(item => `<li><span>${esc(fmtDateTime(item.occurredAt))}</span><div><b>${esc(C.CONTACT_RESULTS[item.result])}</b> <small>${esc(C.CONTACT_CHANNELS[item.channel])} · ${esc(item.owner)}</small>${item.memo ? `<p>${esc(item.memo)}</p>` : ""}${item.nextContactAt ? `<p>재연락 ${esc(fmtDateTime(item.nextContactAt))}</p>` : ""}</div></li>`).join("")}</ol></section>`;
  }

  function renderLeadDetail(lead) {
    const C = ctx.Core;
    if (!lead) return empty("왼쪽에서 고객을 골라 주세요", "문의를 고르면 통화 결과·상담 내용·가입 건을 한 화면에서 기록합니다.");
    return `<div class="life-detail-head"><div><h3>${esc(lead.name || "이름 미입력")}</h3><p>${esc(C.CUSTOMER_TYPES[lead.customerType])} · ${esc(lead.phone || "연락처 없음")} · 출처 ${esc(C.SOURCES[lead.source])} · ${esc(C.CONTACT_METHODS[lead.contactMethod])}</p>${lead.inquiryText ? `<p class="life-inquiry">“${esc(lead.inquiryText)}”</p>` : ""}</div><div class="life-chips">${chip(C.label("lead", lead.status), C.tone("lead", lead.status))}${lead.doNotContact ? chip("연락 거절", "bad") : ""}</div></div>
      ${renderLinkCustomer(lead)}
      ${renderContactForm(lead)}
      ${renderConsultForm(lead)}
      ${renderChecks(lead)}
      ${renderLeadApplications(lead)}
      ${renderCloseCard(lead)}
      ${renderHistory(lead)}`;
  }

  function renderInbox() {
    const C = ctx.Core;
    const leads = C.leadRows(ctx.store, state.leadFilter, state.leadQuery);
    const all = C.activeLeads(ctx.store);
    if (!all.some(lead => lead.id === state.selectedLeadId)) state.selectedLeadId = leads[0] ? leads[0].id : "";
    const selected = all.find(lead => lead.id === state.selectedLeadId) || null;
    const counts = C.filterCounts(ctx.store).leads;
    const tabs = Object.entries(C.LEAD_FILTERS).map(([key, label]) => `<button type="button" class="life-tab${state.leadFilter === key ? " is-active" : ""}" data-life-lead-filter="${attr(key)}" aria-pressed="${state.leadFilter === key}">${esc(label)} <em>${counts[key] || 0}</em></button>`).join("");
    return `<section class="life-page" data-life-root>
      ${head("문의·상담", "모든 경로의 문의가 한곳에 모입니다. 통화 결과를 버튼으로 남기고 상담 내용을 채웁니다.", `<button type="button" class="secondary-button" data-life-go="lifeToday">오늘 할 일</button>${newLeadButton()}`)}
      ${readOnlyNote()}
      ${state.newLeadOpen && ctx.canWrite ? renderNewLeadForm() : ""}
      <div class="life-split">
        <aside class="life-list" aria-label="문의 목록">
          <div class="life-tabs">${tabs}</div>
          <input class="life-search" type="search" value="${attr(state.leadQuery)}" placeholder="이름·번호·주소 검색" aria-label="문의 검색" data-life-query>
          <div class="life-lead-list" data-life-lead-list>${renderLeadList(leads)}</div>
        </aside>
        <section class="life-detail" aria-label="선택한 고객">${renderLeadDetail(selected)}</section>
      </div>
    </section>`;
  }

  // ---------------------------------------------------------------- 가입 진행
  function renderBoardTable(rowsValue) {
    if (!rowsValue.length) return empty("가입 건이 없습니다", "문의·상담 화면에서 원큐 접수를 등록하면 여기에 뜹니다.");
    return `<div class="life-table-wrap"><table class="life-table"><thead><tr><th>고객</th><th>상품 · 접수번호</th><th>접수</th><th>설치</th><th>사은품</th><th>정산</th></tr></thead><tbody>${rowsValue.map(({ app, lead }) => `<tr class="${app.id === state.selectedAppId ? "is-selected" : ""}"><td><button type="button" class="life-row-link" data-life-select-app="${attr(app.id)}">${esc(lead ? (lead.name || lead.phone) : "고객 미확인")}</button><small>${esc(lead ? ctx.Core.CUSTOMER_TYPES[lead.customerType] : "")}${lead && lead.crmCustomerId ? " · 기존 고객" : ""}</small></td><td>${esc(app.carrier)} ${esc(app.product)}<small>${esc(app.oneqNo)}</small></td><td>${trackChip("intakeStatus", app.intakeStatus)}</td><td>${trackChip("installStatus", app.installStatus)}${app.installConfirmedAt ? `<small>${esc(fmtDay(app.installConfirmedAt))}</small>` : ""}</td><td>${trackChip("giftStatus", app.giftStatus)}</td><td>${trackChip("settleStatus", app.settleStatus)}</td></tr>`).join("")}</tbody></table></div>`;
  }

  function trackForm(app, fieldName, allowed, note) {
    const C = ctx.Core;
    const map = Object.fromEntries(Object.entries(C.TRACKS[fieldName]).filter(([key]) => allowed.includes(key)));
    return `<form class="life-inline-form" data-life-form="track" data-app-id="${attr(app.id)}" data-track="${attr(fieldName)}"><select name="to" aria-label="${attr(C.TRACK_LABELS[fieldName])} 상태">${options(map, app[fieldName])}</select>${note ? `<input name="note" placeholder="${attr(note)}" aria-label="메모">` : ""}<button type="submit" class="secondary-button">변경</button></form>`;
  }

  function renderAppDetail(app, lead) {
    const C = ctx.Core;
    if (!app) return "";
    const write = ctx.canWrite;
    const intake = `<section class="life-track"><h4>접수 ${trackChip("intakeStatus", app.intakeStatus)}</h4><p class="life-hint">통신사 해피콜이 부재면 ‘해피콜 대기’로 두고 통화 가능 시간을 원큐에 전달합니다.</p>${write ? trackForm(app, "intakeStatus", Object.keys(C.INTAKE_STATUSES), "메모 (예: 통화 가능 18시 이후 전달)") : ""}</section>`;
    const install = `<section class="life-track"><h4>설치 ${trackChip("installStatus", app.installStatus)}</h4>
      ${write ? `<form class="life-subform" data-life-form="installPlan" data-app-id="${attr(app.id)}"><div class="life-fields">${field("희망 설치일", input("installDesired", app.installDesired))}${field("확정 설치 일시", `<input type="datetime-local" name="installConfirmedAt" value="${attr(localInput(app.installConfirmedAt))}">`)}</div><div class="life-form-foot"><span>확정일을 넣으면 ‘일정 확정’이 됩니다.</span><button type="submit" class="secondary-button">일정 저장</button></div></form>${trackForm(app, "installStatus", ["scheduling", "scheduled", "delayed", "impossible", "cancelled"], "사유")}` : `<p class="life-hint">희망 ${esc(app.installDesired || "-")} · 확정 ${esc(fmtDateTime(app.installConfirmedAt) || "-")}</p>`}
      ${app.installStatus === "customer_reported" && write ? `<button type="button" class="secondary-button" data-life-track-to="oneq_confirmed" data-track="installStatus" data-app-id="${attr(app.id)}">원큐 개통 확인됨</button>` : ""}
      ${app.oneqConfirmedAt ? `<p class="life-hint">원큐 확인 ${esc(fmtDateTime(app.oneqConfirmedAt))}</p>` : ""}</section>`;
    const reportDone = app.customerReportedAt ? `<p class="life-hint">고객 연락 ${esc(fmtDateTime(app.customerReportedAt))} · ${esc(C.CONTACT_CHANNELS[app.customerReportChannel] || "")} · 설치 ${app.verifyInstalled ? "확인" : "미확인"} · 사용 ${app.verifyWorking ? "확인" : "미확인"}</p>` : "";
    const canReport = write && !["cancelled", "impossible"].includes(app.installStatus) && ["waiting", "held"].includes(app.giftStatus);
    const report = `<section class="life-track is-key"><h4>설치 완료 연락 받기</h4><p class="life-hint">사은품 지급 시점은 고객이 “설치 끝났어요”라고 연락한 때입니다. 확인 질문 2개를 체크해야 대표님께 지급 요청이 갑니다.</p>${reportDone}
      ${canReport ? `<form class="life-subform" data-life-form="installReport" data-app-id="${attr(app.id)}"><div class="life-fields">${field("연락 받은 시각", `<input type="datetime-local" name="reportedAt" value="${attr(localInput(ctx.now().toISOString()))}">`)}${field("연락 방법", `<select name="channel">${options(C.CONTACT_CHANNELS, "phone")}</select>`)}</div>
        <fieldset class="life-musts"><legend>확인 질문 2개</legend><label><input type="checkbox" name="verifyInstalled"> 기사님이 방문해서 설치했나요?</label><label><input type="checkbox" name="verifyWorking"> 인터넷·TV(제품)가 실제로 되나요?</label></fieldset>
        ${field("보류 사유 (아직 안 됐을 때)", input("holdReason", "", ' placeholder="예: TV 셋톱 미설치"'), true)}
        <div class="life-form-foot"><button type="submit" class="secondary-button" name="requestGift" value="0">아직 안 됐어요 · 지급 보류</button><button type="submit" class="primary-button" name="requestGift" value="1">사은품 지급 요청 보내기</button></div></form>` : ""}</section>`;
    const giftAdmin = ctx.isAdmin && write ? `<div class="life-actions">${["requested", "held"].includes(app.giftStatus) ? `<button type="button" class="primary-button" data-life-track-to="paid" data-track="giftStatus" data-app-id="${attr(app.id)}">이체 완료</button>` : ""}${trackForm(app, "giftStatus", Object.keys(C.GIFT_STATUSES), "사유 (보류·반환)")}</div><p class="life-hint">계좌번호는 CRM 에 남기지 않습니다. 원큐 접수 때 입력한 사은품 수령 정보에서 확인합니다.</p>` : `<p class="life-hint">${app.giftStatus === "requested" ? "대표님 이체를 기다립니다." : "이체는 대표님이 처리합니다."}</p>`;
    const gift = `<section class="life-track"><h4>사은품 ${trackChip("giftStatus", app.giftStatus)}</h4><p class="life-money">약속 금액 <b>${esc(fmtMoney(app.promisedGift))}</b>${app.giftRequestedAt ? ` · 요청 ${esc(fmtDateTime(app.giftRequestedAt))}` : ""}${app.giftPaidAt ? ` · 지급 ${esc(fmtDateTime(app.giftPaidAt))} (${esc(app.giftPaidBy)})` : ""}</p>${app.giftHoldReason && app.giftStatus === "held" ? `<p class="life-warn">보류: ${esc(app.giftHoldReason)}</p>` : ""}${giftAdmin}</section>`;
    const settle = `<section class="life-track"><h4>정산 ${trackChip("settleStatus", app.settleStatus)}</h4>${ctx.isAdmin && write ? trackForm(app, "settleStatus", Object.keys(C.SETTLE_STATUSES), "메모") : `<p class="life-hint">수수료 금액과 정산은 대표님 화면에서 관리합니다.</p>`}</section>`;
    const history = app.history.slice().reverse().map(entry => `<li><span>${esc(fmtDateTime(entry.at))}</span><div><b>${esc(C.TRACK_LABELS[entry.field] || (entry.field === "installConfirmedAt" ? "설치 일정" : entry.field))}</b> ${esc(entry.from ? `${C.label(entry.field, entry.from) || entry.from} → ` : "")}${esc(C.label(entry.field, entry.to) || entry.to)} <small>${esc(entry.by)}</small>${entry.note ? `<p>${esc(entry.note)}</p>` : ""}</div></li>`).join("");
    return `<section class="life-app-detail" aria-label="가입 건 상세"><div class="life-detail-head"><div><h3>${esc(lead ? (lead.name || lead.phone) : "고객 미확인")} · ${esc(app.carrier)} ${esc(app.product)}</h3><p>원큐 접수 ${esc(app.oneqNo)} · ${esc(C.PRODUCT_LINES[app.productLine])} · 동의 ${esc(fmtDateTime(app.agreedAt))}${app.quoteSummary ? ` · ${esc(app.quoteSummary)}` : ""}</p></div>${lead ? `<button type="button" class="secondary-button" data-life-open-lead="${attr(lead.id)}">상담 기록 보기</button>` : ""}</div>
      <div class="life-tracks">${intake}${install}${report}${gift}${settle}</div>
      ${history ? `<section class="life-card"><div class="life-card-head"><h3>진행 기록</h3><span>누가·언제·무엇을 바꿨는지</span></div><ol class="life-timeline">${history}</ol></section>` : ""}</section>`;
  }

  function renderBoard() {
    const C = ctx.Core;
    const rowsValue = C.boardRows(ctx.store, state.boardFilter);
    const allApps = C.activeApplications(ctx.store);
    if (!allApps.some(app => app.id === state.selectedAppId)) state.selectedAppId = rowsValue[0] ? rowsValue[0].app.id : "";
    const selected = allApps.find(app => app.id === state.selectedAppId) || null;
    const lead = selected ? C.activeLeads(ctx.store).find(item => item.id === selected.leadId) || null : null;
    const counts = C.filterCounts(ctx.store).board;
    const tabs = Object.entries(C.BOARD_FILTERS).map(([key, label]) => `<button type="button" class="life-tab${state.boardFilter === key ? " is-active" : ""}" data-life-board-filter="${attr(key)}" aria-pressed="${state.boardFilter === key}">${esc(label)} <em>${counts[key] || 0}</em></button>`).join("");
    return `<section class="life-page" data-life-root>
      ${head("가입 진행", "가입 1건마다 접수·설치·사은품·정산 칸 4개를 따로 봅니다.", `<button type="button" class="secondary-button" data-life-go="lifeInbox">문의·상담</button>`)}
      ${readOnlyNote()}
      <div class="life-tabs">${tabs}</div>
      ${renderBoardTable(rowsValue)}
      ${renderAppDetail(selected, lead)}
    </section>`;
  }

  // ---------------------------------------------------------------- render + events
  function render(context) {
    ctx = context;
    bind(context.container);
    const view = context.view;
    context.container.innerHTML = view === "lifeInbox" ? renderInbox() : view === "lifeBoard" ? renderBoard() : renderToday();
  }

  function rerender() {
    if (ctx && typeof ctx.rerender === "function") ctx.rerender();
  }

  function formValues(form, submitter) {
    const values = {};
    new FormData(form).forEach((value, key) => { values[key] = typeof value === "string" ? value : ""; });
    if (submitter && submitter.name) values[submitter.name] = submitter.value;
    return values;
  }

  function commit(change) {
    if (!ctx) return Promise.resolve(false);
    if (!ctx.canWrite) {
      ctx.toast("조회 전용 계정은 내용을 바꿀 수 없습니다.", "error");
      return Promise.resolve(false);
    }
    return Promise.resolve(ctx.commit(change));
  }

  function leadName(leadId) {
    const lead = ctx.Core.activeLeads(ctx.store).find(item => item.id === leadId);
    return lead ? (lead.name || lead.phone || leadId) : leadId;
  }

  function appLabel(appId) {
    const app = ctx.Core.activeApplications(ctx.store).find(item => item.id === appId);
    return app ? `${leadName(app.leadId)} · ${app.oneqNo}` : appId;
  }

  async function onSubmit(event) {
    const form = event.target.closest && event.target.closest("form[data-life-form]");
    if (!form || !ctx) return;
    event.preventDefault();
    event.stopPropagation();
    if (form.dataset.lifeBusy === "1") return;
    const C = ctx.Core;
    const raw = formValues(form, event.submitter);
    const kind = form.dataset.lifeForm;
    const actor = ctx.actor;
    const leadId = form.dataset.leadId || "";
    const appId = form.dataset.appId || "";
    let change = null;
    if (kind === "newLead") {
      const duplicate = C.findLeadByPhone(ctx.store.lifeLeads, raw.phone);
      if (duplicate) {
        state.selectedLeadId = duplicate.id;
        state.newLeadOpen = false;
        state.leadFilter = "all";
        ctx.toast(`같은 번호의 고객(${duplicate.name || duplicate.phone})이 이미 있어 기존 기록을 열었습니다.`, "info");
        rerender();
        return;
      }
      change = { label: "문의 등록", category: "등록", targetType: "생활서비스 고객", targetLabel: raw.name || raw.phone, raw, success: "문의를 등록했습니다.",
        mutate: store => { const lead = C.createLead(store, raw, actor, new Date()); state.selectedLeadId = lead.id; state.newLeadOpen = false; state.leadFilter = "open"; return lead; } };
    } else if (kind === "contact") {
      const values = Object.assign({}, raw, { nextContactAt: fromLocalInput(raw.nextContactAt) });
      change = { label: `통화 결과 · ${C.CONTACT_RESULTS[raw.result] || "미선택"}`, targetType: "생활서비스 고객", targetId: leadId, targetLabel: leadName(leadId), raw, success: "통화 결과를 기록했습니다.",
        mutate: store => C.recordContact(store, leadId, values, actor, new Date()) };
    } else if (kind === "consult") {
      change = { label: "상담 내용 저장", targetType: "생활서비스 고객", targetId: leadId, targetLabel: leadName(leadId), raw, success: "상담 내용을 저장했습니다.",
        mutate: store => C.updateConsult(store, leadId, raw, actor, new Date()) };
    } else if (kind === "addCheck") {
      change = { label: "확인할 것 추가", targetType: "생활서비스 고객", targetId: leadId, targetLabel: leadName(leadId), raw, success: "확인할 것을 추가했습니다.",
        mutate: store => C.addCheck(store, leadId, raw, actor, new Date()) };
    } else if (kind === "close") {
      change = { label: `상담 종료 · ${C.CLOSE_REASONS[raw.reason] || ""}`, targetType: "생활서비스 고객", targetId: leadId, targetLabel: leadName(leadId), raw, success: "상담을 종료했습니다.",
        mutate: store => { const lead = C.closeLead(store, leadId, raw, actor, new Date()); state.closeFormOpen = false; return lead; } };
    } else if (kind === "application") {
      const values = Object.assign({}, raw, { agreedAt: fromLocalInput(raw.agreedAt) });
      change = { label: `원큐 접수 등록 · ${raw.oneqNo || ""}`, category: "등록", targetType: "생활서비스 가입 건", targetLabel: `${leadName(leadId)} · ${raw.oneqNo || ""}`, raw, success: "가입 건을 만들었습니다. 가입 진행에서 이어서 관리합니다.",
        mutate: store => { const app = C.createApplication(store, leadId, values, actor, new Date()); state.appFormOpen = false; state.selectedAppId = app.id; return app; } };
    } else if (kind === "installPlan") {
      const values = Object.assign({}, raw, { installConfirmedAt: fromLocalInput(raw.installConfirmedAt) });
      change = { label: "설치 일정 저장", targetType: "생활서비스 가입 건", targetId: appId, targetLabel: appLabel(appId), raw, success: "설치 일정을 저장했습니다.",
        mutate: store => C.updateInstallPlan(store, appId, values, actor, new Date()) };
    } else if (kind === "installReport") {
      const values = Object.assign({}, raw, { reportedAt: fromLocalInput(raw.reportedAt) });
      const wantsGift = raw.requestGift === "1";
      change = { label: wantsGift ? "설치 완료 연락 · 사은품 지급 요청" : "설치 완료 연락 · 지급 보류", targetType: "생활서비스 가입 건", targetId: appId, targetLabel: appLabel(appId), raw,
        success: wantsGift ? "대표님께 사은품 지급 요청을 보냈습니다." : "지급을 보류하고 사유를 남겼습니다.",
        mutate: store => C.recordInstallReport(store, appId, values, actor, new Date()) };
    } else if (kind === "track") {
      const fieldName = form.dataset.track;
      change = { label: `${C.TRACK_LABELS[fieldName] || ""} → ${C.label(fieldName, raw.to)}`, category: "단계변경", targetType: "생활서비스 가입 건", targetId: appId, targetLabel: appLabel(appId), raw, success: "상태를 바꿨습니다.",
        mutate: store => C.setTrack(store, appId, fieldName, raw.to, raw, actor, new Date()) };
    }
    if (!change) return;
    form.dataset.lifeBusy = "1";
    try { await commit(change); } finally { delete form.dataset.lifeBusy; }
  }

  async function onClick(event) {
    if (!ctx) return;
    const target = event.target.closest && event.target.closest("[data-life-go],[data-life-new-lead],[data-life-open-lead],[data-life-open-app],[data-life-select-lead],[data-life-select-app],[data-life-lead-filter],[data-life-board-filter],[data-life-toggle],[data-life-check],[data-life-link],[data-life-reopen],[data-life-track-to]");
    if (!target || !ctx.container.contains(target)) return;
    const C = ctx.Core;
    const d = target.dataset;
    if (d.lifeGo !== undefined) return ctx.go(d.lifeGo);
    if (d.lifeNewLead !== undefined) { state.newLeadOpen = true; return ctx.view === "lifeInbox" ? rerender() : ctx.go("lifeInbox"); }
    if (d.lifeOpenLead !== undefined) { state.selectedLeadId = d.lifeOpenLead; state.leadFilter = "all"; state.leadQuery = ""; state.appFormOpen = false; state.closeFormOpen = false; return ctx.view === "lifeInbox" ? rerender() : ctx.go("lifeInbox"); }
    if (d.lifeOpenApp !== undefined) { state.selectedAppId = d.lifeOpenApp; state.boardFilter = "all"; return ctx.view === "lifeBoard" ? rerender() : ctx.go("lifeBoard"); }
    if (d.lifeSelectLead !== undefined) { state.selectedLeadId = d.lifeSelectLead; state.appFormOpen = false; state.closeFormOpen = false; return rerender(); }
    if (d.lifeSelectApp !== undefined) { state.selectedAppId = d.lifeSelectApp; return rerender(); }
    if (d.lifeLeadFilter !== undefined) { state.leadFilter = d.lifeLeadFilter; return rerender(); }
    if (d.lifeBoardFilter !== undefined) { state.boardFilter = d.lifeBoardFilter; return rerender(); }
    if (d.lifeToggle !== undefined) { const key = d.lifeToggle; if (Object.prototype.hasOwnProperty.call(state, key)) state[key] = !state[key]; return rerender(); }
    const actor = ctx.actor;
    if (d.lifeCheck !== undefined) {
      const leadId = d.leadId;
      return commit({ label: `확인할 것 · ${C.CHECK_STATUSES[d.lifeCheckStatus] || ""}`, targetType: "생활서비스 고객", targetId: leadId, targetLabel: leadName(leadId), success: "확인 상태를 바꿨습니다.",
        mutate: store => C.setCheckStatus(store, leadId, d.lifeCheck, d.lifeCheckStatus, undefined, actor, new Date()) });
    }
    if (d.lifeLink !== undefined) {
      const leadId = d.leadId;
      return commit({ label: d.lifeLink ? "기존 고객 카드 연결" : "기존 고객 카드 연결 해제", targetType: "생활서비스 고객", targetId: leadId, targetLabel: leadName(leadId), success: d.lifeLink ? "기존 고객 카드와 연결했습니다." : "연결을 해제했습니다.",
        mutate: store => C.linkCustomer(store, leadId, d.lifeLink, ctx.customers, actor, new Date()) });
    }
    if (d.lifeReopen !== undefined) {
      const leadId = d.lifeReopen;
      return commit({ label: "다시 상담", targetType: "생활서비스 고객", targetId: leadId, targetLabel: leadName(leadId), success: "다시 상담 중으로 바꿨습니다.",
        mutate: store => C.reopenLead(store, leadId, actor, new Date()) });
    }
    if (d.lifeTrackTo !== undefined) {
      const appId = d.appId;
      const fieldName = d.track;
      if (target.dataset.lifeBusy === "1") return;
      target.dataset.lifeBusy = "1";
      try {
        await commit({ label: `${C.TRACK_LABELS[fieldName] || ""} → ${C.label(fieldName, d.lifeTrackTo)}`, category: "단계변경", targetType: "생활서비스 가입 건", targetId: appId, targetLabel: appLabel(appId),
          success: d.lifeTrackTo === "paid" ? "이체 완료로 기록했습니다." : "상태를 바꿨습니다.",
          mutate: store => C.setTrack(store, appId, fieldName, d.lifeTrackTo, {}, actor, new Date()) });
      } finally { delete target.dataset.lifeBusy; }
    }
  }

  function onInput(event) {
    if (!ctx) return;
    const search = event.target.closest && event.target.closest("[data-life-query]");
    if (!search) return;
    state.leadQuery = search.value;
    const list = ctx.container.querySelector("[data-life-lead-list]");
    if (list) list.innerHTML = renderLeadList(ctx.Core.leadRows(ctx.store, state.leadFilter, state.leadQuery));
  }

  function bind(container) {
    if (!container || container.__bringLifeBound) return;
    container.__bringLifeBound = true;
    container.addEventListener("click", event => { if (event.target.closest && event.target.closest("[data-life-root]")) onClick(event); });
    container.addEventListener("submit", event => { if (event.target.closest && event.target.closest("[data-life-root]")) onSubmit(event); });
    container.addEventListener("input", event => { if (event.target.closest && event.target.closest("[data-life-root]")) onInput(event); });
  }

  function selectLead(leadId) { state.selectedLeadId = String(leadId || ""); }
  function selectApplication(appId) { state.selectedAppId = String(appId || ""); }

  return Object.freeze({ VIEWS, isLifeView, render, selectLead, selectApplication, fromLocalInput, localInput, _state: state });
});
