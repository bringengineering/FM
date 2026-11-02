// 정기 관리보고서(격주) 화면. app.js 가 너무 커서 이 화면은 따로 둔다.
//
// 사람이 하는 일은 세 가지뿐이다: 건물과 기간을 고르고, 점검 항목의 상태를 누르고,
// 양호가 아닌 항목에 사진과 한 줄을 붙인다. 청소 2회는 그 기간의 작업 결과보고서에서
// 자동으로 모이고, 숫자와 요약 문장은 코드가 만든다.
(function attachPeriodicReportUI(root) {
  "use strict";

  function create(deps) {
    const { api, getMain, getStore, esc, showToast, todayKey, isActive } = deps;
    const P = () => root.BringPeriodicReportCore;
    const state = {
      loading: false, loaded: false, error: "", reports: [], works: [], canWork: false,
      draft: null, busy: "", newBuildingId: "", newPeriod: "",
    };

    const buildings = () => (getStore().buildings || []).filter(item => item && item.id && !item.archivedAt && !item.deletedAt);
    const buildingName = id => (buildings().find(item => item.id === id) || {}).name || "건물 미지정";
    const buildingAddress = id => { const b = buildings().find(item => item.id === id) || {}; return b.roadAddress || b.address || b.jibunAddress || ""; };

    function periodChoices() {
      const core = P();
      const now = core.periodOf(todayKey());
      const list = [];
      let cursor = now;
      for (let i = 0; i < 6 && cursor; i += 1) { list.push(cursor); cursor = core.previousPeriod(cursor.key); }
      return list;
    }

    async function load() {
      if (state.loading) return;
      state.loading = true;
      state.error = "";
      render();
      try {
        const [periodic, works] = await Promise.all([api.loadPeriodicReports(), api.loadWorkReports()]);
        state.reports = Array.isArray(periodic && periodic.reports) ? periodic.reports : [];
        state.works = Array.isArray(works && works.reports) ? works.reports : [];
        state.canWork = periodic && periodic.canWork === true;
        state.loaded = true;
      } catch (error) {
        state.error = (error && error.message) || "정기 관리보고서를 불러오지 못했습니다.";
      } finally {
        state.loading = false;
        render();
      }
    }

    function newId() {
      const bytes = new Uint8Array(8);
      root.crypto.getRandomValues(bytes);
      return `pr_${Date.now().toString(36)}${[...bytes].map(b => b.toString(16).padStart(2, "0")).join("")}`;
    }

    function openNew() {
      const core = P();
      const buildingId = state.newBuildingId;
      const period = state.newPeriod || (periodChoices()[0] || {}).key;
      if (!buildingId) return showToast("건물을 먼저 골라 주세요.", "error");
      const existing = core.findForPeriod(state.reports, { buildingId }, period);
      if (existing) { state.draft = existing; showToast("이 건물·기간 보고서가 이미 있어 그것을 열었습니다.", "info"); return render(); }
      const range = core.parsePeriod(period);
      const cleanings = core.cleaningsFor(state.works, { buildingId, period });
      const lastCleaning = cleanings.length ? cleanings[cleanings.length - 1].workDate : "";
      state.draft = core.normalizeReport({
        id: newId(), buildingId, buildingName: buildingName(buildingId), siteAddress: buildingAddress(buildingId), period,
        // 점검은 보통 마지막 청소 날 같이 한다. 다르면 바꾸면 된다.
        inspection: { date: lastCleaning || (todayKey() <= range.to ? todayKey() : range.to), items: [] },
      });
      render();
    }

    // 화면의 입력값을 draft 에 옮긴다. 다시 그리기 전에 늘 부른다.
    function readForm() {
      const form = getMain().querySelector("[data-pr-form]");
      if (!form || !state.draft) return state.draft;
      const core = P();
      const draft = JSON.parse(JSON.stringify(state.draft));
      draft.inspection.date = form.querySelector("[name=inspectionDate]").value;
      draft.inspection.inspectorName = form.querySelector("[name=inspectorName]").value;
      draft.summary = form.querySelector("[name=summary]").value;
      draft.followUp = form.querySelector("[name=followUp]").value;
      const picked = [...form.querySelectorAll("[data-pr-cleaning]")];
      draft.cleaningReportIds = picked.every(input => input.checked) ? [] : picked.filter(input => input.checked).map(input => input.value);
      draft.inspection.items = draft.inspection.items.map(item => {
        const row = form.querySelector(`[data-pr-item="${CSS.escape(item.key)}"]`);
        if (!row) return item;
        const checked = row.querySelector("input[type=radio]:checked");
        return { ...item, status: checked ? checked.value : item.status, note: row.querySelector("[name=note]").value };
      });
      state.draft = core.normalizeReport(draft);
      return state.draft;
    }

    async function save({ quiet = false } = {}) {
      const draft = readForm();
      if (!draft || state.busy) return null;
      state.busy = "save";
      render();
      try {
        const saved = await api.savePeriodicReport(draft);
        state.reports = [saved, ...state.reports.filter(item => item.id !== saved.id)];
        state.draft = P().normalizeReport(saved);
        if (!quiet) showToast("저장했습니다.", "success");
        return saved;
      } catch (error) {
        showToast((error && error.message) || "저장하지 못했습니다.", "error");
        return null;
      } finally {
        state.busy = "";
        render();
      }
    }

    async function exportPdf(reportId) {
      if (state.busy) return;
      let id = reportId;
      if (!id && state.draft) {
        const blockers = P().blockers(readForm(), state.works);
        if (blockers.length) return showToast(blockers[0].text, "error");
        const saved = await save({ quiet: true });
        if (!saved) return;
        id = saved.id;
      }
      state.busy = "export";
      render();
      try {
        const result = await api.exportPeriodicReport({ reportId: id, company: getStore().company || {} });
        if (result && result.ok) showToast(`PDF를 저장했습니다. 청소 ${result.cleanings}회 · 사진 ${result.photos}장`, "success");
        else if (!(result && result.canceled)) showToast((result && result.error) || "PDF를 만들지 못했습니다.", "error");
      } catch (error) {
        showToast((error && error.message) || "PDF를 만들지 못했습니다.", "error");
      } finally {
        state.busy = "";
        render();
      }
    }

    async function addPhoto(itemKey) {
      const draft = readForm();
      const item = draft && draft.inspection.items.find(row => row.key === itemKey);
      if (!item || state.busy) return;
      const picked = await api.pickBuildingDocuments();
      if (!picked || !picked.ok || !Array.isArray(picked.files) || !picked.files.length) return;
      state.busy = `photo:${itemKey}`;
      render();
      let added = 0;
      try {
        for (const file of picked.files.slice(0, 4)) {
          const uploaded = await api.uploadWorkReportPhoto({
            reportId: draft.id, itemKey, itemLabel: `정기점검 ${item.label}`, phase: "after",
            buildingName: draft.buildingName, kindLabel: "정기점검", workDate: draft.inspection.date || todayKey(),
            filePath: file.path, mimeType: file.mimeType,
          });
          if (!uploaded || !uploaded.ok) throw new Error((uploaded && uploaded.error) || "Drive 에 올리지 못했습니다.");
          item.photos = [...item.photos, { id: uploaded.driveFileId, driveFileId: uploaded.driveFileId, webViewLink: uploaded.webViewLink, caption: "" }];
          added += 1;
        }
        state.draft = P().normalizeReport(draft);
        showToast(`사진 ${added}장을 넣었습니다.`, "success");
      } catch (error) {
        showToast((error && error.message) || "사진을 넣지 못했습니다.", "error");
      } finally {
        state.busy = "";
        render();
      }
    }

    function dropPhoto(itemKey, photoId) {
      const draft = readForm();
      const item = draft && draft.inspection.items.find(row => row.key === itemKey);
      if (!item) return;
      item.photos = item.photos.filter(photo => photo.id !== photoId);
      state.draft = P().normalizeReport(draft);
      render();
    }

    function statusRadios(item) {
      return P().STATUSES.map(status => `<label class="pr-status pr-${status.key}"><input type="radio" name="status_${esc(item.key)}" value="${status.key}"${item.status === status.key ? " checked" : ""}><span>${esc(status.label)}</span></label>`).join("");
    }

    function editor(draft) {
      const core = P();
      const period = core.parsePeriod(draft.period);
      const allCleanings = core.cleaningsFor(state.works, { ...draft, cleaningReportIds: [] });
      const chosen = new Set(core.cleaningsFor(state.works, draft).map(row => row.id));
      const previousKey = core.previousPeriod(draft.period);
      const previous = previousKey ? core.findForPeriod(state.reports, draft, previousKey.key) : null;
      const view = core.buildView(draft, state.works, { previousReport: previous });
      const blockers = core.blockers(draft, state.works);
      const busy = Boolean(state.busy);
      let lastCategory = "";
      const itemRows = draft.inspection.items.map(item => {
        const head = item.category !== lastCategory ? `<tr class="pr-cat"><th colspan="4">${esc(item.category)}</th></tr>` : "";
        lastCategory = item.category;
        const needsEvidence = ["watch", "fix", "done"].includes(item.status);
        return `${head}<tr data-pr-item="${esc(item.key)}" class="${needsEvidence ? "pr-attention" : ""}">
          <td><b>${esc(item.label)}</b></td>
          <td class="pr-statuses">${statusRadios(item)}</td>
          <td><input name="note" maxlength="300" value="${esc(item.note)}" placeholder="${needsEvidence ? "무엇을 확인했는지 한 줄 (필수)" : "이상 없음"}"></td>
          <td class="pr-photos">${item.photos.map(photo => `<span class="pr-photo">사진<button type="button" data-pr-photo-drop="${esc(photo.id)}" data-pr-key="${esc(item.key)}" aria-label="사진 빼기">×</button></span>`).join("")}<button type="button" class="mini-button" data-pr-photo-add="${esc(item.key)}"${busy ? " disabled" : ""}>${state.busy === `photo:${item.key}` ? "올리는 중…" : "＋ 사진"}</button></td>
        </tr>`;
      }).join("");
      return `<form class="office-panel pr-editor" data-pr-form onsubmit="return false">
        <header><div><span>BUILDING CARE REPORT</span><h3>${esc(draft.buildingName || buildingName(draft.buildingId))} · ${esc(core.periodLabel(draft.period))}</h3><small>${esc(period ? `${period.from} ~ ${period.to}` : "")} · 문서번호 ${esc(core.documentNo(draft))}</small></div>
          <div class="pr-actions"><button type="button" class="secondary-button" data-pr-close>목록으로</button><button type="button" class="secondary-button" data-pr-save${busy ? " disabled" : ""}>${state.busy === "save" ? "저장 중…" : "저장"}</button><button type="button" class="primary-button" data-pr-export${busy || blockers.length ? " disabled" : ""}>${state.busy === "export" ? "PDF 만드는 중…" : "건물주용 PDF"}</button></div></header>
        ${blockers.length ? `<div class="info-box pr-blockers" role="status"><b>PDF 전에 할 일 ${blockers.length}가지</b><ul>${blockers.map(item => `<li>${esc(item.text)}</li>`).join("")}</ul></div>` : `<div class="info-box pr-ready">건물주에게 낼 준비가 됐습니다.</div>`}
        <section><h4>1. 공용부 청소 (자동으로 모음)</h4>
          ${allCleanings.length ? `<ul class="pr-cleanings">${allCleanings.map(row => `<li><label><input type="checkbox" data-pr-cleaning value="${esc(row.id)}"${chosen.has(row.id) ? " checked" : ""}> <b>${esc(core.dateLabel(row.workDate))}</b> · ${esc(core.weekOfMonth(row.workDate))} · 사진 ${root.BringWorkReportCore.photoCount(row)}장 ${row.workerName ? `· ${esc(row.workerName)}` : ""}</label></li>`).join("")}</ul>`
            : `<p class="pr-empty">이 기간(${esc(period ? `${period.from} ~ ${period.to}` : "")})에 저장된 공용부·계단청소 결과보고서가 없습니다. ‘작업 결과보고서’ 에서 청소 보고서를 먼저 저장해 주세요.</p>`}
        </section>
        <section><h4>2. 건물 정기점검</h4>
          <div class="pr-inline"><label>점검일 <input type="date" name="inspectionDate" value="${esc(draft.inspection.date)}"${period ? ` min="${period.from}" max="${period.to}"` : ""}></label><label>점검자 <input name="inspectorName" maxlength="120" value="${esc(draft.inspection.inspectorName)}" placeholder="브링케어 현장팀"></label></div>
          <p class="pr-hint">기본값은 모두 ‘양호’ 입니다. 문제가 있는 항목만 상태를 바꾸고 사진과 한 줄을 붙이세요. 점검하지 않은 항목은 ‘해당 없음’ 으로 두면 보고서에서 빠집니다.</p>
          <table class="office-table pr-items"><thead><tr><th>항목</th><th>상태</th><th>점검 내용</th><th>사진</th></tr></thead><tbody>${itemRows}</tbody></table>
        </section>
        <section><h4>3. 조치 및 건의 (자동)</h4>
          ${view.actions.length ? `<ul class="pr-actions-list">${view.actions.map(item => `<li><span class="pr-badge pr-${esc(item.status)}">${esc(core.statusLabel(item.status))}</span> <b>${esc(item.label)}</b> ${esc(item.finding)}${item.since && item.since !== draft.inspection.date ? ` <small>(${esc(core.dateLabel(item.since, false))}부터)</small>` : ""}</li>`).join("")}</ul>` : `<p class="pr-empty">조치할 항목이 없습니다.</p>`}
          ${previous ? `<small class="pr-hint">지난 보고서(${esc(core.periodLabel(previous.period))})의 미해결 항목을 함께 가져왔습니다.</small>` : ""}
        </section>
        <section><h4>4. 요약 · 추가 안내</h4>
          <label class="pr-block">이번 기간 요약 <small>(비워 두면 아래 문장이 들어갑니다)</small><textarea name="summary" rows="3" maxlength="2000" placeholder="${esc(core.autoSummary(draft, core.cleaningsFor(state.works, draft)))}">${esc(draft.summary)}</textarea></label>
          <label class="pr-block">추가 안내 <small>(선택)</small><textarea name="followUp" rows="2" maxlength="2000">${esc(draft.followUp)}</textarea></label>
        </section>
      </form>`;
    }

    function render() {
      if (!isActive()) return;
      const core = P();
      const main = getMain();
      if (!core) { main.innerHTML = `<section class="operations-hero"><div><h2>정기 관리보고서</h2><p>모듈을 불러오지 못했습니다.</p></div></section>`; return; }
      if (!state.loaded && !state.loading && !state.error) { void load(); }
      const reports = core.sortReports(state.reports);
      const choices = periodChoices();
      const rows = reports.slice(0, 80).map(item => {
        const counts = core.counts(item);
        const cleanings = core.cleaningsFor(state.works, item).length;
        const ready = !core.blockers(item, state.works).length;
        return `<tr><td><b>${esc(item.buildingName || buildingName(item.buildingId))}</b><small>${esc(item.siteAddress)}</small></td>
          <td><b>${esc(core.periodLabel(item.period))}</b><small>점검 ${esc(item.inspection.date || "미정")}</small></td>
          <td><b>${cleanings}회</b><small>공용부 청소</small></td>
          <td>${counts.fix ? `<span class="pr-badge pr-fix">조치 필요 ${counts.fix}</span>` : ""}${counts.watch ? ` <span class="pr-badge pr-watch">관찰 ${counts.watch}</span>` : ""}${!counts.fix && !counts.watch ? `<span class="pr-badge pr-good">이상 없음</span>` : ""}</td>
          <td class="wr-row-actions">${state.canWork ? `<button type="button" class="mini-button" data-pr-edit="${esc(item.id)}">열기</button>` : ""}<button type="button" class="mini-button" data-pr-export-id="${esc(item.id)}"${state.busy || !ready ? " disabled" : ""} title="${ready ? "" : "작성이 끝나지 않았습니다"}">건물주용 PDF</button></td></tr>`;
      }).join("");
      main.innerHTML = `<section class="ai-assistant-hero ai-work-report-hero">
          <div><span>BRING CARE · BI-WEEKLY REPORT</span><h2>정기 관리보고서</h2><p>격주(1~15일 · 16일~말일)로 건물주에게 드리는 보고서입니다. 그 기간의 공용부 청소 결과보고서 2회를 자동으로 모으고, 건물 정기점검 결과만 입력하면 PDF가 만들어집니다.</p></div>
          <div class="ai-work-report-hero-mark" aria-hidden="true">✓</div>
        </section>
        ${state.loading ? `<div class="info-box">불러오는 중…</div>` : state.error ? `<div class="info-box" style="color:#C6535F">${esc(state.error)}</div>` : ""}
        ${state.draft ? editor(core.normalizeReport(state.draft)) : state.canWork ? `<section class="office-panel pr-new"><header><div><span>NEW</span><h3>새 정기 관리보고서</h3></div></header>
          <div class="pr-inline"><label>건물 <select data-pr-new-building><option value="">건물 선택</option>${buildings().map(b => `<option value="${esc(b.id)}"${b.id === state.newBuildingId ? " selected" : ""}>${esc(b.name || b.address || b.id)}</option>`).join("")}</select></label>
          <label>기간 <select data-pr-new-period>${choices.map(p => `<option value="${p.key}"${p.key === state.newPeriod ? " selected" : ""}>${esc(core.periodLabel(p.key))} (${p.from.slice(5)} ~ ${p.to.slice(5)})</option>`).join("")}</select></label>
          <button type="button" class="primary-button" data-pr-new>작성 시작</button></div></section>` : ""}
        <section class="office-panel wr-history"><header><div><span>REPORTS</span><h3>정기 관리보고서</h3></div><small>최근 기간부터</small></header>
          ${rows ? `<div class="office-table-wrap"><table class="office-table"><thead><tr><th>건물</th><th>기간</th><th>청소</th><th>점검</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
            : `<div class="office-empty"><b>아직 정기 관리보고서가 없습니다</b><span>건물과 기간을 고르고 ‘작성 시작’ 을 누르세요.</span></div>`}
        </section>`;
      const form = main.querySelector("[data-pr-form]");
      if (form) form.inert = state.busy === "save" || state.busy === "export";
    }

    // 상태를 바꾸면 사진·메모 요구가 바로 보이도록 다시 그린다.
    function onChange(event) {
      if (!isActive()) return;
      const target = event.target;
      if (target.matches("[data-pr-new-building]")) state.newBuildingId = target.value;
      else if (target.matches("[data-pr-new-period]")) state.newPeriod = target.value;
      else if (target.closest("[data-pr-form]") && (target.type === "radio" || target.type === "checkbox" || target.name === "inspectionDate")) { readForm(); render(); }
    }

    function onClick(event) {
      if (!isActive()) return;
      const el = event.target.closest("[data-pr-new],[data-pr-edit],[data-pr-close],[data-pr-save],[data-pr-export],[data-pr-export-id],[data-pr-photo-add],[data-pr-photo-drop]");
      if (!el) return;
      event.preventDefault();
      if (el.hasAttribute("data-pr-new")) return openNew();
      if (el.hasAttribute("data-pr-edit")) { state.draft = state.reports.find(item => item.id === el.getAttribute("data-pr-edit")) || null; return render(); }
      if (el.hasAttribute("data-pr-close")) { state.draft = null; return render(); }
      if (el.hasAttribute("data-pr-save")) return void save();
      if (el.hasAttribute("data-pr-export")) return void exportPdf("");
      if (el.hasAttribute("data-pr-export-id")) return void exportPdf(el.getAttribute("data-pr-export-id"));
      if (el.hasAttribute("data-pr-photo-add")) return void addPhoto(el.getAttribute("data-pr-photo-add"));
      if (el.hasAttribute("data-pr-photo-drop")) return dropPhoto(el.getAttribute("data-pr-key"), el.getAttribute("data-pr-photo-drop"));
    }

    root.document.addEventListener("click", onClick);
    root.document.addEventListener("change", onChange);
    return Object.freeze({ render, reload: () => { state.loaded = false; return load(); } });
  }

  root.BringPeriodicReportUI = Object.freeze({ create });
})(typeof globalThis === "object" ? globalThis : this);
