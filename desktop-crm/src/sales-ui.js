(function attachBringSalesUI(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringSalesUI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function makeBringSalesUI() {
  "use strict";

  const SOURCE_LABELS = Object.freeze({
    building_sign: "건물 공개번호",
    broker: "공인중개사",
    storefront: "1층 상가",
    referral: "소개",
    danggeun: "당근",
    naver_blog: "네이버 블로그",
    existing_customer: "기존 고객",
    other: "기타"
  });
  const PRIORITY_LABELS = Object.freeze({ high: "높음", normal: "보통", low: "낮음" });
  const UNIT_STATUS_LABELS = Object.freeze({ vacant: "공실", upcoming: "퇴실 예정", occupied: "입주 중", unknown: "미확인" });
  const CHANNEL_LABELS = Object.freeze({ sms: "문자", call: "전화", visit: "방문", meeting: "미팅", memo: "메모" });
  const RESULT_LABELS = Object.freeze({
    no_response: "무응답",
    replied: "응답",
    callback_requested: "재연락 요청",
    meeting_set: "미팅 확정",
    not_interested: "관심 없음",
    invalid_contact: "연락처 오류",
    do_not_contact: "연락 중단",
    follow_up: "후속 필요"
  });
  const SERVICE_LABELS = Object.freeze({
    common_cleaning: "공용부 청소",
    move_in_cleaning: "입주 청소",
    move_out_cleaning: "퇴실 청소",
    flooring_wallpaper: "장판·도배",
    waterproofing: "방수",
    repair: "수리",
    signage: "사이니지",
    other: "기타"
  });
  const OPPORTUNITY_STAGE_LABELS = Object.freeze({
    discovered: "기회 발견",
    quote_requested: "견적 요청",
    quote_approved: "견적 승인",
    work_completed: "작업 완료",
    revenue_recorded: "매출 기록"
  });
  const BUILDING_TYPE_LABELS = Object.freeze({
    one_room_multi_family: "원룸·다가구",
    multi_family: "다가구",
    multi_unit: "다세대",
    officetel: "오피스텔",
    commercial_residential: "상가주택",
    other: "기타"
  });

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function attr(value) {
    return esc(value).replace(/`/g, "&#96;");
  }

  function active(items) {
    return (Array.isArray(items) ? items : []).filter(item => item && !item.archivedAt);
  }

  function asNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function dateKey(value) {
    const source = String(value || "");
    const direct = source.match(/^\d{4}-\d{2}-\d{2}/);
    if (direct) return direct[0];
    const parsed = new Date(source);
    if (Number.isNaN(parsed.getTime())) return "";
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    const day = String(parsed.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function shortDate(value) {
    const key = dateKey(value);
    if (!key) return "일정 없음";
    const parts = key.split("-");
    return `${Number(parts[1])}월 ${Number(parts[2])}일`;
  }

  function dateTimeLocal(value) {
    const source = String(value || "");
    if (!source) return "";
    const parsed = new Date(source);
    if (Number.isNaN(parsed.getTime())) return "";
    const shifted = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000);
    return shifted.toISOString().slice(0, 16);
  }

  function dueState(value, now) {
    const due = dateKey(value);
    if (!due) return { tone: "none", label: "일정 없음", detail: "후속 일정을 지정해 주세요" };
    const today = dateKey(now || new Date().toISOString());
    if (due < today) return { tone: "overdue", label: "기한 지남", detail: shortDate(value) };
    if (due === today) return { tone: "today", label: "오늘", detail: shortDate(value) };
    return { tone: "scheduled", label: "예정", detail: shortDate(value) };
  }

  function labelOf(map, value, fallback) {
    return map[value] || fallback || value || "미입력";
  }

  function stageLabel(stages, id) {
    const stage = (Array.isArray(stages) ? stages : []).find(item => item && (item.id === id || item.code === id));
    return stage && stage.label || "건물후보";
  }

  function stageEventLabels(stages) {
    const labels = {};
    (Array.isArray(stages) ? stages : []).forEach(stage => {
      (Array.isArray(stage && stage.events) ? stage.events : []).forEach(event => { labels[event] = stage.label; });
    });
    return labels;
  }

  function renderKpi(label, value, note, tone) {
    return `<article class="sales-kpi-card ${attr(tone || "neutral")}">
      <span class="sales-kpi-label">${esc(label)}</span>
      <strong class="sales-kpi-value">${esc(asNumber(value).toLocaleString("ko-KR"))}</strong>
      <small>${esc(note)}</small>
    </article>`;
  }

  function renderStageStepper(stages, prospects, selectedStage) {
    const current = selectedStage || "all";
    const items = [{ id: "all", label: "전체", count: prospects.length }].concat(
      (Array.isArray(stages) ? stages : []).map(stage => ({
        id: stage.id || stage.code,
        label: stage.label,
        count: prospects.filter(item => item.stage === (stage.id || stage.code)).length
      }))
    );
    return `<nav class="sales-stage-nav" aria-label="영업 단계 필터">
      <ol class="sales-stage-stepper">
        ${items.map((item, index) => {
          const selected = current === item.id;
          const number = item.id === "all" ? "전체" : String(index).padStart(2, "0");
          return `<li>
            <button type="button" class="sales-stage-button${selected ? " active" : ""}" data-sales-stage-filter="${attr(item.id)}" aria-pressed="${selected}">
              <span class="sales-stage-number">${esc(number)}</span>
              <span class="sales-stage-name">${esc(item.label)}</span>
              <b aria-label="${esc(item.label)} ${item.count}건">${item.count}</b>
            </button>
          </li>`;
        }).join("")}
      </ol>
    </nav>`;
  }

  function renderProspectCard(prospect, stages, now) {
    const due = dueState(prospect.nextActionAt, now);
    const vacancy = asNumber(prospect.vacancyCount);
    const upcoming = asNumber(prospect.upcomingVacancyCount);
    const priority = prospect.priority || "normal";
    const stage = stageLabel(stages, prospect.stage);
    return `<article class="sales-prospect-card" data-sales-card-stage="${attr(prospect.stage || "candidate")}">
      <button type="button" class="sales-prospect-open" data-sales-prospect-open="${attr(prospect.id)}" aria-label="${attr(prospect.name || prospect.address || "건물")} 상세 보기">
        <header>
          <div class="sales-prospect-title">
            <span class="sales-stage-badge">${esc(stage)}</span>
            <h3>${esc(prospect.name || "이름 없는 건물")}</h3>
            <p>${esc(prospect.address || "주소 미입력")}</p>
          </div>
          <span class="sales-priority ${attr(priority)}">중요도 ${esc(labelOf(PRIORITY_LABELS, priority, "보통"))}</span>
        </header>
        <div class="sales-card-metrics" aria-label="공실 현황">
          <span><small>현재 공실</small><b>${vacancy}실</b></span>
          <span><small>퇴실 예정</small><b>${upcoming}실</b></span>
          <span><small>담당자</small><b>${esc(prospect.owner || "미지정")}</b></span>
        </div>
        <footer>
          <span class="sales-next-action"><small>다음 행동</small><b>${esc(prospect.nextAction || "후속 행동 미등록")}</b></span>
          <span class="sales-due ${attr(due.tone)}"><b>${esc(due.label)}</b><small>${esc(due.detail)}</small></span>
        </footer>
      </button>
    </article>`;
  }

  function renderPipeline(input) {
    const options = input && typeof input === "object" ? input : {};
    const store = options.store && typeof options.store === "object" ? options.store : {};
    const stages = Array.isArray(options.stages) ? options.stages : [];
    const kpis = options.kpis && typeof options.kpis === "object" ? options.kpis : {};
    const selectedStage = options.selectedStage || "all";
    const query = String(options.query || "").trim().toLocaleLowerCase("ko-KR");
    const prospects = active(store.salesProspects);
    const visible = prospects.filter(prospect => {
      if (selectedStage !== "all" && prospect.stage !== selectedStage) return false;
      if (!query) return true;
      return [prospect.name, prospect.address, prospect.region, prospect.owner, prospect.nextAction]
        .some(value => String(value || "").toLocaleLowerCase("ko-KR").includes(query));
    });

    return `<section class="sales-crm sales-pipeline" aria-labelledby="salesPipelineHeading">
      <header class="sales-hero">
        <div class="sales-hero-copy">
          <span class="sales-eyebrow">BUILDING SALES CRM</span>
          <h2 id="salesPipelineHeading">건물을 기준으로 영업 흐름을 관리합니다</h2>
          <p>공실 해결로 첫 관계를 만들고, 임대관리 성과를 보여준 뒤 청소·수리·건물관리로 확장한다.</p>
        </div>
        <div class="sales-hero-actions">
          <button type="button" class="secondary-button sales-button" data-action="open-sales-standards">영업 표준 보기</button>
          <button type="button" class="primary-button sales-button" data-action="new-sales-prospect">새 건물 등록</button>
        </div>
      </header>

      <section class="sales-kpi-grid" aria-label="증거 기준 영업 지표">
        ${renderKpi("관리 대상 건물", kpis.activeProspects, "보류·종료 제외", "primary")}
        ${renderKpi("접촉 완료", kpis.contactedProspects, "접촉 증거가 있는 건물", "info")}
        ${renderKpi("응답 확인", kpis.respondedProspects, "응답 증거가 있는 건물", "success")}
        ${renderKpi("매물접수", kpis.listingUnits, "접수 증거가 있는 호실", "primary")}
        ${renderKpi("오늘 후속", kpis.todayFollowUps, "오늘 처리할 다음 행동", "warning")}
        ${renderKpi("기한 지난 후속", kpis.overdueFollowUps, "날짜와 함께 즉시 확인", "danger")}
      </section>

      <section class="sales-stage-panel" aria-labelledby="salesStageHeading">
        <div class="sales-section-heading">
          <div><span>13단계 표준 흐름</span><h3 id="salesStageHeading">현재 단계별 건물</h3></div>
          <label class="sales-search"><span>건물 검색</span><input type="search" data-sales-query value="${attr(options.query || "")}" placeholder="건물명·주소·담당자" autocomplete="off"></label>
        </div>
        ${renderStageStepper(stages, prospects, selectedStage)}
      </section>

      <div class="sales-results-heading">
        <p><b>${visible.length}개 건물</b>이 현재 조건에 표시됩니다.</p>
        <span>단계는 완료 증거가 저장된 경우에만 올라갑니다.</span>
      </div>
      ${visible.length ? `<div class="sales-prospect-grid">${visible.map(item => renderProspectCard(item, stages, options.now)).join("")}</div>` : `
        <section class="sales-empty" role="status">
          <strong>조건에 맞는 건물이 없습니다</strong>
          <p>검색어나 단계 필터를 바꾸거나 새 건물을 등록해 주세요.</p>
          <button type="button" class="primary-button sales-button" data-action="new-sales-prospect">새 건물 등록</button>
        </section>`}
    </section>`;
  }

  function renderSectionAction(writable, attribute, prospectId, label) {
    if (!writable) return "";
    return `<button type="button" class="sales-section-action" ${attribute}="${attr(prospectId)}">${esc(label)}</button>`;
  }

  function renderRecordEmpty(message) {
    return `<p class="sales-record-empty">${esc(message)}</p>`;
  }

  function renderProspectDetail(input) {
    const options = input && typeof input === "object" ? input : {};
    const prospect = options.prospect && typeof options.prospect === "object" ? options.prospect : {};
    const id = prospect.id || "";
    const writable = options.writable !== false;
    const contacts = active(options.contacts).filter(item => !item.prospectId || item.prospectId === id);
    const units = active(options.units).filter(item => !item.prospectId || item.prospectId === id);
    const activities = active(options.activities).filter(item => !item.prospectId || item.prospectId === id)
      .sort((left, right) => String(right.occurredAt || right.createdAt || "").localeCompare(String(left.occurredAt || left.createdAt || "")));
    const events = active(options.events).filter(item => !item.prospectId || item.prospectId === id)
      .sort((left, right) => String(right.occurredAt || right.createdAt || "").localeCompare(String(left.occurredAt || left.createdAt || "")));
    const opportunities = active(options.opportunities).filter(item => !item.prospectId || item.prospectId === id);
    const eventLabels = stageEventLabels(options.stages);
    const due = dueState(prospect.nextActionAt, options.now);

    return `<section class="sales-crm sales-prospect-detail" aria-labelledby="salesProspectTitle">
      <header class="sales-detail-hero">
        <div>
          <div class="sales-detail-badges">
            <span class="sales-stage-badge">${esc(stageLabel(options.stages, prospect.stage))}</span>
            <span class="sales-priority ${attr(prospect.priority || "normal")}">중요도 ${esc(labelOf(PRIORITY_LABELS, prospect.priority, "보통"))}</span>
          </div>
          <h2 id="salesProspectTitle">${esc(prospect.name || "이름 없는 건물")}</h2>
          <p>${esc(prospect.address || "주소 미입력")}</p>
        </div>
        ${writable ? `<button type="button" class="secondary-button sales-button" data-sales-edit-prospect="${attr(id)}">건물 정보 수정</button>` : `<span class="sales-readonly-label">읽기 전용</span>`}
      </header>

      <aside class="sales-next-panel ${attr(due.tone)}" aria-label="다음 행동">
        <div><span>다음 행동</span><strong>${esc(prospect.nextAction || "후속 행동 미등록")}</strong></div>
        <div class="sales-due ${attr(due.tone)}"><b>${esc(due.label)}</b><small>${esc(due.detail)}</small></div>
      </aside>

      <div class="sales-detail-sections">
        <details class="sales-detail-section" open>
          <summary><span>건물 기본정보</span><b>기준 정보</b></summary>
          <div class="sales-detail-body">
            <dl class="sales-fact-grid">
              <div><dt>지역</dt><dd>${esc(prospect.region || "미입력")}</dd></div>
              <div><dt>건물 유형</dt><dd>${esc(labelOf(BUILDING_TYPE_LABELS, prospect.buildingType))}</dd></div>
              <div><dt>현재 공실</dt><dd>${asNumber(prospect.vacancyCount)}실</dd></div>
              <div><dt>퇴실 예정</dt><dd>${asNumber(prospect.upcomingVacancyCount)}실</dd></div>
              <div><dt>담당자</dt><dd>${esc(prospect.owner || "미지정")}</dd></div>
              <div><dt>발굴 경로</dt><dd>${esc(labelOf(SOURCE_LABELS, prospect.source))}</dd></div>
            </dl>
            ${active(prospect.demandAnchors).length ? `<div class="sales-tag-list" aria-label="수요 거점">${active(prospect.demandAnchors).map(item => `<span>${esc(item)}</span>`).join("")}</div>` : ""}
          </div>
        </details>

        <details class="sales-detail-section" open>
          <summary><span>연락처</span><b>${contacts.length}건</b></summary>
          <div class="sales-detail-body">
            <div class="sales-section-toolbar">${renderSectionAction(writable, "data-sales-add-contact", id, "연락처 추가")}</div>
            ${contacts.length ? `<div class="sales-record-list">${contacts.map(contact => `<article class="sales-record-row">
              <div><strong>${esc(contact.name || "이름 미입력")}</strong><p>${esc(contact.phone || "번호 미입력")} · ${esc(labelOf(SOURCE_LABELS, contact.source))}</p></div>
              <span class="sales-state-label ${contact.doNotContact || contact.optOut ? "danger" : contact.verifiedAt ? "success" : "neutral"}">${contact.doNotContact || contact.optOut ? "연락 중단" : contact.verifiedAt ? "확인 완료" : "확인 필요"}</span>
            </article>`).join("")}</div>` : renderRecordEmpty("등록된 연락처가 없습니다.")}
          </div>
        </details>

        <details class="sales-detail-section" open>
          <summary><span>호실</span><b>${units.length}건</b></summary>
          <div class="sales-detail-body">
            <div class="sales-section-toolbar">${renderSectionAction(writable, "data-sales-add-unit", id, "호실 추가")}</div>
            ${units.length ? `<div class="sales-record-list">${units.map(unit => `<article class="sales-record-row">
              <div><strong>${esc(unit.label || "호실 미입력")}</strong><p>${esc([asNumber(unit.deposit) ? `보증금 ${asNumber(unit.deposit).toLocaleString("ko-KR")}원` : "", asNumber(unit.rent) ? `월세 ${asNumber(unit.rent).toLocaleString("ko-KR")}원` : ""].filter(Boolean).join(" · ") || "임대 조건 미입력")}</p></div>
              <span class="sales-state-label ${attr(unit.status || "unknown")}">${esc(labelOf(UNIT_STATUS_LABELS, unit.status))}</span>
            </article>`).join("")}</div>` : renderRecordEmpty("등록된 호실이 없습니다.")}
          </div>
        </details>

        <details class="sales-detail-section">
          <summary><span>영업 활동</span><b>${activities.length}건</b></summary>
          <div class="sales-detail-body">
            <div class="sales-section-toolbar">${renderSectionAction(writable, "data-sales-add-activity", id, "활동 기록")}</div>
            ${activities.length ? `<ol class="sales-timeline">${activities.map(activity => `<li>
              <time>${esc(shortDate(activity.occurredAt || activity.createdAt))}</time>
              <div><strong>${esc(labelOf(CHANNEL_LABELS, activity.channel || activity.type))} · ${esc(labelOf(RESULT_LABELS, activity.result))}</strong><p>${esc(activity.summary || activity.responseText || "내용 미입력")}</p></div>
            </li>`).join("")}</ol>` : renderRecordEmpty("기록된 영업 활동이 없습니다.")}
          </div>
        </details>

        <details class="sales-detail-section">
          <summary><span>완료 증거</span><b>${events.length}건</b></summary>
          <div class="sales-detail-body">
            <div class="sales-section-toolbar">${renderSectionAction(writable, "data-sales-add-event", id, "단계 완료 기록")}</div>
            ${events.length ? `<ol class="sales-timeline evidence">${events.map(event => `<li>
              <time>${esc(shortDate(event.occurredAt || event.createdAt))}</time>
              <div><strong>${esc(eventLabels[event.type] || event.type || "완료 이벤트")}</strong><p>${esc(event.evidenceNote || event.evidenceType || "증거 메모 없음")}</p></div>
            </li>`).join("")}</ol>` : renderRecordEmpty("완료 증거가 아직 없습니다. 증거 없이 단계는 올라가지 않습니다.")}
          </div>
        </details>

        <details class="sales-detail-section" open>
          <summary><span>추가서비스</span><b>${opportunities.length}건</b></summary>
          <div class="sales-detail-body">
            <div class="sales-section-toolbar">${renderSectionAction(writable, "data-sales-add-opportunity", id, "서비스 기회 추가")}</div>
            ${opportunities.length ? `<div class="sales-opportunity-list">${opportunities.map(item => `<article class="sales-opportunity-card">
              <div><span>${esc(labelOf(SERVICE_LABELS, item.serviceType))}</span><strong>${esc(item.requirements || "요청 내용 미입력")}</strong><p>담당 ${esc(item.owner || "미지정")}</p></div>
              <b>${esc(labelOf(OPPORTUNITY_STAGE_LABELS, item.stage))}</b>
            </article>`).join("")}</div>` : renderRecordEmpty("확인된 추가서비스 기회가 없습니다.")}
          </div>
        </details>
      </div>
    </section>`;
  }

  function matchesQuery(values, query) {
    if (!query) return true;
    const needle = String(query).trim().toLocaleLowerCase("ko-KR");
    return values.some(value => String(value || "").toLocaleLowerCase("ko-KR").includes(needle));
  }

  function renderStandards(input) {
    const options = input && typeof input === "object" ? input : {};
    const standards = options.standards && typeof options.standards === "object" ? options.standards : {};
    const scripts = active(standards.scripts).filter(script => matchesQuery([
      script.id, script.name, script.situation, script.channel, script.status, script.objective, script.text
    ], options.query));
    const checklists = active(standards.checklists).filter(checklist => matchesQuery([
      checklist.id, checklist.title, checklist.purpose, checklist.completionRule,
      ...(Array.isArray(checklist.items) ? checklist.items.map(item => item.label) : [])
    ], options.query));
    const poc = standards.pocBaseline || {};

    return `<section class="sales-crm sales-standards" aria-labelledby="salesStandardsTitle">
      <header class="sales-standards-hero">
        <div><span class="sales-eyebrow">BRING SALES STANDARD</span><h2 id="salesStandardsTitle">영업 표준 센터</h2><p>${esc(standards.doctrine || "")}</p></div>
        <label class="sales-search"><span>표준 검색</span><input type="search" data-sales-standards-search value="${attr(options.query || "")}" placeholder="대본·상황·체크리스트" autocomplete="off"></label>
      </header>

      <div class="sales-warning-panel" role="note">
        <strong>승인 전 대외 사용 금지</strong>
        <p>‘법률검토’ 또는 ‘초안’ 표시는 팀 연습·검토용입니다. 협력 공인중개사와 대표의 승인 상태를 확인한 뒤 사용하세요.</p>
      </div>

      <section class="sales-poc-note" aria-labelledby="salesPocTitle">
        <div><span>PoC 기준</span><h3 id="salesPocTitle">계약률이 아니라 매물접수 관찰치</h3></div>
        <p>${esc(poc.note || "50건 접촉 → 매물접수 5~6건(10~12%). 전체 응답률이나 임대차계약률로 해석하지 않습니다.")}</p>
      </section>

      <section class="sales-standard-group" aria-labelledby="salesScriptsTitle">
        <div class="sales-group-heading"><div><span>S1–S12</span><h3 id="salesScriptsTitle">상황별 영업 대본</h3></div><b>${scripts.length}개</b></div>
        <div class="sales-standard-list">
          ${scripts.length ? scripts.map(script => `<details class="sales-standard-card${script.isApproved ? " approved" : " review"}" data-sales-script="${attr(script.id)}">
            <summary>
              <span class="sales-standard-id">${esc(script.id)}</span>
              <span><strong>${esc(script.name || script.situation)}</strong><small>${esc([script.situation, script.channel].filter(Boolean).join(" · "))}</small></span>
              <span class="sales-approval-state">${esc(script.status || "승인 미확인")}</span>
            </summary>
            <div class="sales-standard-body">
              ${script.usageWarning ? `<p class="sales-inline-warning"><strong>사용 주의</strong>${esc(script.usageWarning)}</p>` : ""}
              <div class="sales-standard-objective"><span>목적</span><p>${esc(script.objective || "")}</p></div>
              <div class="sales-script-copy"><span>대본</span><pre>${esc(script.text || "")}</pre></div>
              <div class="sales-rule-grid">
                <section><h4>지켜야 할 기준</h4><ul>${(script.guardrails || []).map(item => `<li>${esc(item)}</li>`).join("")}</ul></section>
                <section class="forbidden"><h4>금지 문구</h4><ul>${(script.forbiddenPhrases || []).map(item => `<li>${esc(item)}</li>`).join("")}</ul></section>
              </div>
              <div class="sales-next-standard"><span>다음 행동</span><p>${esc(script.nextStep || "")}</p></div>
            </div>
          </details>`).join("") : renderRecordEmpty("검색 조건에 맞는 대본이 없습니다.")}
        </div>
      </section>

      <section class="sales-standard-group" aria-labelledby="salesChecklistsTitle">
        <div class="sales-group-heading"><div><span>CL01–CL08</span><h3 id="salesChecklistsTitle">단계별 완료 체크리스트</h3></div><b>${checklists.length}개</b></div>
        <div class="sales-standard-list checklist">
          ${checklists.length ? checklists.map(checklist => `<details class="sales-standard-card" data-sales-checklist="${attr(checklist.id)}">
            <summary>
              <span class="sales-standard-id">${esc(checklist.id)}</span>
              <span><strong>${esc(checklist.title)}</strong><small>${esc(checklist.purpose || "")}</small></span>
              <span class="sales-approval-state neutral">${(checklist.items || []).filter(item => item.required).length}개 필수</span>
            </summary>
            <div class="sales-standard-body">
              <ol class="sales-check-items">${(checklist.items || []).map(item => `<li><span>${esc(item.label)}</span>${item.required ? `<b>필수</b>` : `<small>선택</small>`}</li>`).join("")}</ol>
              <div class="sales-next-standard"><span>완료 기준</span><p>${esc(checklist.completionRule || "")}</p></div>
            </div>
          </details>`).join("") : renderRecordEmpty("검색 조건에 맞는 체크리스트가 없습니다.")}
        </div>
      </section>
    </section>`;
  }

  function optionsMarkup(items, selected, placeholder) {
    const first = placeholder == null ? "" : `<option value="">${esc(placeholder)}</option>`;
    return first + items.map(item => {
      const value = typeof item === "object" ? item.value : item;
      const label = typeof item === "object" ? item.label : item;
      return `<option value="${attr(value)}"${String(selected || "") === String(value) ? " selected" : ""}>${esc(label)}</option>`;
    }).join("");
  }

  function renderProspectForm(input) {
    const options = input && typeof input === "object" ? input : {};
    const item = options.item && typeof options.item === "object" ? options.item : {};
    const crmBuildings = active(options.crmBuildings);
    const sourceOptions = Object.keys(SOURCE_LABELS).map(value => ({ value, label: SOURCE_LABELS[value] }));
    const typeOptions = Object.keys(BUILDING_TYPE_LABELS).map(value => ({ value, label: BUILDING_TYPE_LABELS[value] }));
    const priorityOptions = Object.keys(PRIORITY_LABELS).map(value => ({ value, label: PRIORITY_LABELS[value] }));
    return `<form class="sales-crm sales-form" id="salesProspectForm" data-sales-form="prospect" novalidate>
      <header class="sales-form-heading"><div><span>영업 대상 건물</span><h2>${item.id ? "건물 정보 수정" : "새 건물 등록"}</h2><p>같은 주소는 한 건물로 관리하고 연락처·호실·활동을 이 기록 아래 연결합니다.</p></div></header>
      <input type="hidden" name="id" value="${attr(item.id || "")}">
      <input type="hidden" name="actor" value="${attr(options.actor || "")}">
      <div class="sales-form-grid">
        <label class="sales-field"><span>건물명</span><input name="name" value="${attr(item.name || "")}" placeholder="예: 대학로 원룸" autocomplete="off"><small>현장에서 바로 알아볼 수 있는 이름</small></label>
        <label class="sales-field wide"><span>주소</span><input name="address" value="${attr(item.address || "")}" placeholder="도로명 또는 지번 주소" autocomplete="street-address"><small>중복 건물 확인의 기준이 됩니다.</small></label>
        <label class="sales-field"><span>지역</span><input name="region" value="${attr(item.region || "")}" placeholder="예: 우산동" autocomplete="address-level3"></label>
        <label class="sales-field"><span>건물 유형</span><select name="buildingType">${optionsMarkup(typeOptions, item.buildingType || "one_room_multi_family")}</select></label>
        <label class="sales-field"><span>발굴 경로</span><select name="source">${optionsMarkup(sourceOptions, item.source || "building_sign")}</select></label>
        <label class="sales-field"><span>담당자</span><input name="owner" value="${attr(item.owner || options.actor || "")}" placeholder="팀원 이름" autocomplete="off"></label>
        <label class="sales-field"><span>중요도</span><select name="priority">${optionsMarkup(priorityOptions, item.priority || "normal")}</select></label>
        <label class="sales-field"><span>현재 공실 수</span><input name="vacancyCount" type="number" min="0" step="1" value="${attr(item.vacancyCount == null ? 0 : item.vacancyCount)}" inputmode="numeric"></label>
        <label class="sales-field"><span>퇴실 예정 수</span><input name="upcomingVacancyCount" type="number" min="0" step="1" value="${attr(item.upcomingVacancyCount == null ? 0 : item.upcomingVacancyCount)}" inputmode="numeric"></label>
        <label class="sales-field wide"><span>수요 거점</span><input name="demandAnchors" value="${attr((item.demandAnchors || []).join(", "))}" placeholder="대학교, 병원, 산업단지 등 쉼표로 구분"><small>대학·병원·직장 등 임차 수요가 생기는 위치를 적습니다.</small></label>
        <label class="sales-field wide"><span>기존 CRM 건물 연결</span><select name="crmBuildingId">${optionsMarkup(crmBuildings.map(building => ({ value: building.id, label: `${building.name || "건물명 미입력"}${building.address ? ` · ${building.address}` : ""}` })), item.crmBuildingId, "연결하지 않음")}</select><small>기존 건물관리 기록이 있을 때만 선택합니다.</small></label>
        <label class="sales-field wide"><span>다음 행동</span><input name="nextAction" value="${attr(item.nextAction || "")}" placeholder="예: 공실 조건 확인 전화" autocomplete="off"></label>
        <label class="sales-field"><span>후속 기한</span><input name="nextActionAt" type="datetime-local" value="${attr(dateTimeLocal(item.nextActionAt))}"></label>
      </div>
      <p class="sales-form-rule">영업 단계는 직접 선택하지 않습니다. 완료 증거를 기록하면 해당 단계로 이동합니다.</p>
      <footer class="sales-form-actions"><button type="button" class="secondary-button sales-button" data-action="close-modal">취소</button><button type="submit" class="primary-button sales-button">${item.id ? "건물 정보 저장" : "건물 등록"}</button></footer>
    </form>`;
  }

  function renderEventForm(input) {
    const options = input && typeof input === "object" ? input : {};
    const prospect = options.prospect && typeof options.prospect === "object" ? options.prospect : {};
    const units = active(options.units).filter(unit => !unit.prospectId || unit.prospectId === prospect.id);
    const eventTypes = (Array.isArray(options.eventTypes) ? options.eventTypes : []).map(item => ({
      value: item.event || item.type || item.id || item.value,
      label: item.label || item.name || item.event || item.type,
      evidence: item.evidence || "완료 사실을 확인할 수 있는 메모 또는 링크"
    })).filter(item => item.value);
    return `<form class="sales-crm sales-form" id="salesEventForm" data-sales-form="event" novalidate>
      <header class="sales-form-heading"><div><span>증거 기반 단계 이동</span><h2>완료 증거 기록</h2><p>${esc(prospect.name || prospect.address || "선택한 건물")}에서 실제로 완료된 단계만 기록합니다.</p></div></header>
      <input type="hidden" name="prospectId" value="${attr(prospect.id || "")}">
      <div class="sales-form-grid">
        <label class="sales-field wide"><span>완료한 단계</span><select name="type" required aria-required="true">${optionsMarkup(eventTypes, "", "단계를 선택하세요")}</select><small>단계를 선택하면 필요한 증거 기준을 확인해 기록하세요.</small></label>
        <label class="sales-field"><span>관련 호실</span><select name="unitId">${optionsMarkup(units.map(unit => ({ value: unit.id, label: `${unit.label || "호실"} · ${labelOf(UNIT_STATUS_LABELS, unit.status)}` })), "", "건물 전체 또는 호실 선택")}</select></label>
        <label class="sales-field"><span>완료 일시</span><input name="occurredAt" type="datetime-local" required aria-required="true"></label>
        <label class="sales-field"><span>증거 유형</span><select name="evidenceType" required aria-required="true">${optionsMarkup([
          { value: "confirmation_note", label: "확인 메모" },
          { value: "broker_handoff", label: "공인중개사 확인" },
          { value: "photo", label: "사진" },
          { value: "document", label: "문서" },
          { value: "link", label: "외부 링크" }
        ], "", "증거 유형 선택")}</select></label>
        <label class="sales-field wide"><span>증거 확인 메모</span><textarea name="evidenceNote" rows="4" placeholder="누가, 언제, 무엇을 확인했는지 사실대로 적어 주세요."></textarea><small>메모 또는 증거 링크 중 하나는 반드시 필요합니다.</small></label>
        <label class="sales-field wide"><span>증거 링크</span><input name="evidenceUrl" type="url" placeholder="https://" inputmode="url"><small>사진·문서·광고 게시물 등 팀이 다시 확인할 수 있는 링크</small></label>
      </div>
      <aside class="sales-form-evidence-guide">
        <strong>완료 기준</strong>
        <ul>${eventTypes.map(item => `<li data-event-guide="${attr(item.value)}"><b>${esc(item.label)}</b><span>${esc(item.evidence)}</span></li>`).join("")}</ul>
      </aside>
      <footer class="sales-form-actions"><button type="button" class="secondary-button sales-button" data-action="close-modal">취소</button><button type="submit" class="primary-button sales-button">단계 완료 기록</button></footer>
    </form>`;
  }

  return Object.freeze({
    renderPipeline,
    renderProspectDetail,
    renderStandards,
    renderProspectForm,
    renderEventForm
  });
});
