// 정기 관리보고서(격주) 화면. app.js 가 너무 커서 이 화면은 따로 둔다.
//
// 사람이 하는 일은 세 가지뿐이다: 건물과 기간을 고르고, 점검 항목의 상태를 누르고,
// 양호가 아닌 항목에 사진과 한 줄을 붙인다. 청소 2회는 그 기간의 작업 결과보고서에서
// 자동으로 모이고, 숫자와 요약 문장은 코드가 만든다.
(function attachPeriodicReportUI(root) {
  "use strict";

  function create(deps) {
    const { api, getMain, getStore, esc, showToast, todayKey, isActive, requestConfirmation } = deps;
    const P = () => root.BringPeriodicReportCore;
    const state = {
      loading: false, loaded: false, error: "", reports: [], works: [], canWork: false, admin: false,
      draft: null, loadedAt: 0, busy: "", suggestions: null, newTarget: "", newPeriod: "",
    };

    const buildings = () => (getStore().buildings || []).filter(item => item && item.id && !item.archivedAt && !item.deletedAt);
    const buildingName = id => (buildings().find(item => item.id === id) || {}).name || "건물 미지정";
    const buildingAddress = id => { const b = buildings().find(item => item.id === id) || {}; return b.roadAddress || b.address || b.jibunAddress || ""; };
    // 건물로 묶이지 않은 고객 단위 청소 보고서도 있다. 그런 고객만 고를 수 있게 둔다 —
    // 고객 전체를 늘어놓으면 청소 기록이 없는 고객을 골라 빈 보고서를 만든다.
    const customers = () => {
      const ids = new Set(state.works.filter(row => P().CLEANING_KINDS.includes(row.kind) && !row.buildingId && row.customerId).map(row => row.customerId));
      return (getStore().customers || []).filter(item => item && ids.has(item.id) && !item.archivedAt && !item.deletedAt && item.deleted !== true);
    };
    const targetName = report => report.buildingId ? buildingName(report.buildingId) : ((customers().find(item => item.id === report.customerId) || {}).name || "고객");
    const targetOf = value => {
      const match = /^(b|c):(.+)$/.exec(String(value || ""));
      if (!match) return null;
      if (match[1] === "b") return { buildingId: match[2], buildingName: buildingName(match[2]), siteAddress: buildingAddress(match[2]) };
      const customer = customers().find(item => item.id === match[2]);
      return customer ? { buildingId: "", customerId: customer.id, buildingName: customer.name || "", siteAddress: customer.address || "" } : null;
    };

    function periodChoices() {
      const core = P();
      const now = core.periodOf(todayKey());
      const list = [];
      let cursor = now;
      for (let i = 0; i < 6 && cursor; i += 1) { list.push(cursor); cursor = core.previousPeriod(cursor.key); }
      return list;
    }

    // 사이드바 숫자: 막 끝난 기간에 아직 건물주에게 안 보낸 보고서 수(초안 없음 포함).
    function updateBadge() {
      const badge = root.document.getElementById("navPeriodicCount");
      if (!badge || !P()) return;
      const due = P().dueReports(state.works, state.reports, todayKey());
      const count = due.items.filter(item => item.state !== "sent").length;
      badge.textContent = String(count);
      badge.hidden = count === 0;
    }

    // 초안을 한 번에 만든다. 이미 있는 것은 건드리지 않는다.
    async function createDrafts() {
      if (state.busy) return;
      const core = P();
      const due = core.dueReports(state.works, state.reports, todayKey());
      const missing = due.items.filter(item => item.state === "missing");
      if (!missing.length) return showToast("새로 만들 초안이 없습니다.", "info");
      state.busy = "drafts";
      render();
      let made = 0;
      try {
        for (const entry of missing) {
          const previousKey = core.previousPeriod(due.period.key);
          const previous = previousKey ? core.findForPeriod(state.reports, entry.target, previousKey.key) : null;
          const target = entry.target.buildingId ? entry.target : entry.target;
          const draft = core.draftFor({ ...entry, period: due.period.key, target,
            buildingName: entry.target.buildingId ? buildingName(entry.target.buildingId) : entry.buildingName,
            siteAddress: entry.target.buildingId ? buildingAddress(entry.target.buildingId) || entry.siteAddress : entry.siteAddress }, newId(), previous);
          const saved = await api.savePeriodicReport(draft);
          state.reports = [saved, ...state.reports.filter(item => item.id !== saved.id)];
          made += 1;
        }
        showToast(`초안 ${made}건을 만들었습니다. 점검 결과를 확인한 뒤 보내 주세요.`, "success");
      } catch (error) {
        showToast(`${made}건을 만든 뒤 멈췄습니다: ${(error && error.message) || "저장하지 못했습니다."}`, "error");
      } finally {
        state.busy = "";
        updateBadge();
        render();
      }
    }

    function dueBanner() {
      const core = P();
      const due = core.dueReports(state.works, state.reports, todayKey());
      if (!due.period || !due.items.length) return "";
      const count = key => due.items.filter(item => item.state === key).length;
      const label = { missing: "초안 없음", draft: "작성 중", ready: "발송 대기", sent: "발송 완료" };
      const cls = { missing: "fix", draft: "watch", ready: "good", sent: "done" };
      return `<section class="office-panel pr-due"><header><div><span>THIS ROUND</span><h3>${esc(core.periodLabel(due.period.key))} 보고 차례 · ${due.items.length}곳</h3><small>${esc(due.period.from)} ~ ${esc(due.period.to)}에 공용부 청소 기록이 있는 건물·고객</small></div>
        ${state.canWork && count("missing") ? `<button type="button" class="primary-button" data-pr-drafts${state.busy ? " disabled" : ""}>${state.busy === "drafts" ? "만드는 중…" : `초안 ${count("missing")}건 한 번에 만들기`}</button>` : ""}</header>
        <div class="tally">${["missing", "draft", "ready", "sent"].filter(count).map(key => `<span class="pr-badge pr-${cls[key]}">${label[key]} ${count(key)}</span>`).join(" ")}</div>
        <ul class="pr-due-list">${due.items.map(item => `<li><span class="pr-badge pr-${cls[item.state]}">${label[item.state]}</span> <b>${esc(item.target.buildingId ? buildingName(item.target.buildingId) : item.buildingName || "고객")}</b> · 청소 ${item.cleanings.length}회 (${item.cleanings.map(row => esc(core.dateLabel(row.workDate, false))).join(", ")})${item.state === "draft" && item.blockers[0] ? ` · <small>${esc(item.blockers[0].text)}</small>` : ""}${item.report && state.canWork ? ` <button type="button" class="mini-button" data-pr-edit="${esc(item.report.id)}">열기</button>` : ""}</li>`).join("")}</ul>
      </section>`;
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
        state.admin = periodic && periodic.admin === true;
        state.loaded = true;
        state.loadedAt = Date.now();
        updateBadge();
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
      const target = targetOf(state.newTarget);
      const period = state.newPeriod || (periodChoices()[0] || {}).key;
      if (!target) return showToast("건물 또는 고객을 먼저 골라 주세요.", "error");
      const existing = core.findForPeriod(state.reports, target, period);
      if (existing) { state.draft = existing; showToast("이 건물·기간 보고서가 이미 있어 그것을 열었습니다.", "info"); return render(); }
      const range = core.parsePeriod(period);
      const cleanings = core.cleaningsFor(state.works, { ...target, period });
      const lastCleaning = cleanings.length ? cleanings[cleanings.length - 1].workDate : "";
      state.draft = core.normalizeReport({
        id: newId(), ...target, period,
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
      // 담당자가 편집 화면에서 저장하면 점검을 확인한 것으로 본다.
      draft.inspection.confirmed = true;
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

    // 건물주에게 알림톡으로 보낸다. 받는 사람과 번호를 보여 주고 확인을 받는다.
    async function sendKakao(reportId) {
      if (state.busy) return;
      let id = reportId;
      if (!id && state.draft) {
        const blockers = P().blockers(readForm(), state.works);
        if (blockers.length) return showToast(blockers[0].text, "error");
        const saved = await save({ quiet: true });
        if (!saved) return;
        id = saved.id;
      }
      const report = state.reports.find(item => item.id === id);
      if (!report) return showToast("저장된 보고서를 찾지 못했습니다.", "error");
      const recipient = P().recipientFor(report, getStore());
      if (!recipient.phone) return showToast(recipient.reason, "error");
      const details = P().kakaoDetails({ ...report, siteAddress: report.siteAddress || buildingAddress(report.buildingId) });
      if (!details) return showToast("건물(또는 고객) 주소가 있어야 알림톡을 보낼 수 있습니다.", "error");
      const resend = Boolean(report.delivery && ["requested", "sent"].includes(report.delivery.status));
      const masked = recipient.phone.replace(/^(\d{3})(\d{3,4})(\d{4})$/u, "$1-****-$3");
      const ok = await requestConfirmation({
        title: resend ? "이미 보낸 보고서입니다. 다시 보낼까요?" : "정기 관리보고서를 알림톡으로 보낼까요?",
        description: `${details.buildingAddress} 건물주님, ${details.workName} 결과 보고서가 발행되었습니다. (7일 열람 링크)`,
        target: `${recipient.name || "건물주"} · ${masked}`,
        warning: resend ? `${(report.delivery.sentAt || "").slice(0, 10)}에 이미 보냈습니다. 다시 보내면 같은 분께 한 번 더 갑니다.` : "건물주에게 실제 알림톡이 발송됩니다.",
        confirmLabel: resend ? "다시 보내기" : "알림톡 발송",
      });
      if (!ok) return;
      state.busy = "kakao";
      render();
      try {
        const result = await api.sendPeriodicReportByKakao({ reportId: id, expectedPhone: recipient.phone, resend, company: getStore().company || {} });
        if (result && result.ok) {
          showToast(`알림톡 발송을 요청했습니다. (끝자리 ${result.phoneTail})${result.recorded === false ? " 발송 기록을 남기지 못했습니다." : ""}`, "success");
          state.loadedAt = 0;
          if (!state.draft) void load();
          else { const fresh = await api.loadPeriodicReports().catch(() => null); if (fresh && Array.isArray(fresh.reports)) { state.reports = fresh.reports; const mine = fresh.reports.find(item => item.id === id); if (mine) state.draft = P().normalizeReport(mine); } }
        } else showToast((result && result.error) || "알림톡을 보내지 못했습니다.", "error");
      } catch (error) {
        showToast((error && error.message) || "알림톡을 보내지 못했습니다.", "error");
      } finally {
        state.busy = "";
        render();
      }
    }

    // AI 점검 제안을 받는다. 저장된 보고서 기준이라 먼저 저장한다. 제안은 '적용' 해야 들어간다.
    async function aiReview(mode) {
      if (state.busy || !state.draft) return;
      const saved = await save({ quiet: true });
      if (!saved) return;
      state.busy = `ai:${mode}`;
      render();
      try {
        const result = await api.reviewPeriodicInspection({ reportId: saved.id, mode });
        if (!result || !result.ok) return showToast((result && result.error) || "AI 점검 제안을 받지 못했습니다.", "error");
        state.suggestions = { mode, list: result.suggestions, reviewed: result.reviewed };
        if (!result.suggestions.length) showToast(mode === "cleaning" ? "점검 근거로 쓸 만한 청소 사진을 찾지 못했습니다." : "제안할 내용이 없습니다.", "info");
      } catch (error) {
        showToast((error && error.message) || "AI 점검 제안을 받지 못했습니다.", "error");
      } finally {
        state.busy = "";
        render();
      }
    }

    function applySuggestion(index) {
      const draft = readForm();
      const suggestion = state.suggestions && state.suggestions.list[index];
      if (!draft || !suggestion) return;
      const item = draft.inspection.items.find(row => row.key === suggestion.itemKey);
      if (!item) return;
      if (state.suggestions.mode === "cleaning" && !item.photos.some(photo => photo.id === suggestion.photo.id)) item.photos = [...item.photos, suggestion.photo];
      if (suggestion.status && (state.suggestions.mode === "inspection" || item.status === "good")) {
        item.status = suggestion.status;
        if (suggestion.note && (!item.note || state.suggestions.mode === "inspection")) item.note = suggestion.status === "good" && suggestion.note === "이상 없음" ? "" : suggestion.note;
      }
      state.suggestions.list = state.suggestions.list.map((row, i) => i === index ? { ...row, applied: true } : row);
      state.draft = P().normalizeReport(draft);
      render();
    }

    function suggestionPanel() {
      if (!state.suggestions || !state.suggestions.list.length) return "";
      const label = { good: "양호", watch: "관찰", fix: "조치 필요" };
      return `<div class="pr-ai"><header><b>AI 제안</b> <small>${state.suggestions.mode === "cleaning" ? "청소 사진 중 점검 근거로 쓸 만한 사진" : "점검 사진을 보고 한 제안"} · 사진 ${state.suggestions.reviewed}장 확인 · 사실과 다르면 적용하지 마세요</small><button type="button" class="mini-button" data-pr-ai-close>닫기</button></header>
        <ul>${state.suggestions.list.map((row, i) => `<li><b>${esc(row.label)}</b>${row.area ? ` <small>(${esc(row.area)} 사진)</small>` : ""} ${row.status ? `<span class="pr-badge pr-${esc(row.status)}">${esc(label[row.status])}</span>` : ""} ${esc(row.note)} ${row.applied ? `<span class="pr-applied">적용함</span>` : `<button type="button" class="mini-button" data-pr-ai-apply="${i}">${state.suggestions.mode === "cleaning" ? "사진 추가" : "적용"}</button>`}</li>`).join("")}</ul></div>`;
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
        <header><div><span>BUILDING CARE REPORT</span><h3>${esc(draft.buildingName || targetName(draft))} · ${esc(core.periodLabel(draft.period))}</h3><small>${esc(period ? `${period.from} ~ ${period.to}` : "")} · 문서번호 ${esc(core.documentNo(draft))}</small></div>
          <div class="pr-actions"><button type="button" class="secondary-button" data-pr-close>목록으로</button><button type="button" class="secondary-button" data-pr-save${busy ? " disabled" : ""}>${state.busy === "save" ? "저장 중…" : "저장"}</button><button type="button" class="${state.admin ? "secondary-button" : "primary-button"}" data-pr-export${busy || blockers.length ? " disabled" : ""}>${state.busy === "export" ? "PDF 만드는 중…" : "건물주용 PDF"}</button>${state.admin ? `<button type="button" class="primary-button" data-pr-kakao${busy || blockers.length ? " disabled" : ""}>${state.busy === "kakao" ? "보내는 중…" : draft.delivery ? "알림톡 다시 보내기" : "알림톡 보내기"}</button>` : ""}</div></header>
        ${draft.delivery ? `<div class="info-box pr-sent">${esc((draft.delivery.sentAt || "").slice(0, 16).replace("T", " "))} 건물주에게 알림톡을 보냈습니다 (끝자리 ${esc(draft.delivery.phoneTail)}).</div>` : ""}
        ${blockers.length ? `<div class="info-box pr-blockers" role="status"><b>PDF 전에 할 일 ${blockers.length}가지</b><ul>${blockers.map(item => `<li>${esc(item.text)}</li>`).join("")}</ul></div>` : `<div class="info-box pr-ready">건물주에게 낼 준비가 됐습니다.</div>`}
        <section><h4>1. 공용부 청소 (자동으로 모음)</h4>
          ${allCleanings.length ? `<ul class="pr-cleanings">${allCleanings.map(row => `<li><label><input type="checkbox" data-pr-cleaning value="${esc(row.id)}"${chosen.has(row.id) ? " checked" : ""}> <b>${esc(core.dateLabel(row.workDate))}</b> · ${esc(core.weekOfMonth(row.workDate))} · 사진 ${root.BringWorkReportCore.photoCount(row)}장 ${row.workerName ? `· ${esc(row.workerName)}` : ""}</label></li>`).join("")}</ul>`
            : `<p class="pr-empty">이 기간(${esc(period ? `${period.from} ~ ${period.to}` : "")})에 저장된 공용부·계단청소 결과보고서가 없습니다. ‘작업 결과보고서’ 에서 청소 보고서를 먼저 저장해 주세요.</p>`}
        </section>
        <section><h4>2. 건물 정기점검</h4>
          <div class="pr-inline"><label>점검일 <input type="date" name="inspectionDate" value="${esc(draft.inspection.date)}"${period ? ` min="${period.from}" max="${period.to}"` : ""}></label><label>점검자 <input name="inspectorName" maxlength="120" value="${esc(draft.inspection.inspectorName)}" placeholder="브링케어 현장팀"></label></div>
          <p class="pr-hint">기본값은 모두 ‘양호’ 입니다. 문제가 있는 항목만 상태를 바꾸고 사진과 한 줄을 붙이세요. 점검하지 않은 항목은 ‘해당 없음’ 으로 두면 보고서에서 빠집니다.</p>
          <div class="pr-ai-actions"><button type="button" class="secondary-button" data-pr-ai="inspection"${busy ? " disabled" : ""}>${state.busy === "ai:inspection" ? "AI 확인 중…" : "AI로 점검 사진 확인"}</button><button type="button" class="secondary-button" data-pr-ai="cleaning"${busy || !allCleanings.length ? " disabled" : ""}>${state.busy === "ai:cleaning" ? "AI 확인 중…" : "청소 사진에서 점검 근거 찾기"}</button></div>
          ${suggestionPanel()}
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
      // 다른 PC·다른 화면에서 고친 보고서와 새로 저장된 청소 기록을 놓치지 않게,
      // 목록을 볼 때 1분이 지났으면 다시 받는다. 작성 중에는 다시 받지 않는다.
      if (!state.loading && !state.error && !state.draft && (!state.loaded || Date.now() - state.loadedAt > 60000)) { void load(); }
      const reports = core.sortReports(state.reports);
      const choices = periodChoices();
      const rows = reports.slice(0, 80).map(item => {
        const counts = core.counts(item);
        const cleanings = core.cleaningsFor(state.works, item).length;
        const ready = !core.blockers(item, state.works).length;
        return `<tr><td><b>${esc(item.buildingName || targetName(item))}</b><small>${esc(item.siteAddress)}</small></td>
          <td><b>${esc(core.periodLabel(item.period))}</b><small>점검 ${esc(item.inspection.date || "미정")}</small></td>
          <td><b>${cleanings}회</b><small>공용부 청소</small></td>
          <td>${item.delivery ? `<span class="pr-badge pr-done">알림톡 발송</span> ` : ""}${counts.fix ? `<span class="pr-badge pr-fix">조치 필요 ${counts.fix}</span>` : ""}${counts.watch ? ` <span class="pr-badge pr-watch">관찰 ${counts.watch}</span>` : ""}${!counts.fix && !counts.watch ? `<span class="pr-badge pr-good">이상 없음</span>` : ""}</td>
          <td class="wr-row-actions">${state.canWork ? `<button type="button" class="mini-button" data-pr-edit="${esc(item.id)}">열기</button>` : ""}<button type="button" class="mini-button" data-pr-export-id="${esc(item.id)}"${state.busy || !ready ? " disabled" : ""} title="${ready ? "" : "작성이 끝나지 않았습니다"}">건물주용 PDF</button>${state.admin ? `<button type="button" class="mini-button" data-pr-kakao-id="${esc(item.id)}"${state.busy || !ready ? " disabled" : ""}>${item.delivery ? "다시 보내기" : "알림톡"}</button>` : ""}</td></tr>`;
      }).join("");
      main.innerHTML = `<section class="ai-assistant-hero ai-work-report-hero">
          <div><span>BRING CARE · BI-WEEKLY REPORT</span><h2>정기 관리보고서</h2><p>격주(1~15일 · 16일~말일)로 건물주에게 드리는 보고서입니다. 그 기간의 공용부 청소 결과보고서 2회를 자동으로 모으고, 건물 정기점검 결과만 입력하면 PDF가 만들어집니다.</p></div>
          <div class="ai-work-report-hero-mark" aria-hidden="true">✓</div>
        </section>
        ${state.loading ? `<div class="info-box">불러오는 중…</div>` : state.error ? `<div class="info-box" style="color:#C6535F">${esc(state.error)}</div>` : ""}
        ${state.draft ? "" : dueBanner()}
        ${state.draft ? editor(core.normalizeReport(state.draft)) : state.canWork ? `<section class="office-panel pr-new"><header><div><span>NEW</span><h3>새 정기 관리보고서</h3></div></header>
          <div class="pr-inline"><label>건물·고객 <select data-pr-new-building><option value="">선택</option><optgroup label="건물">${buildings().map(b => `<option value="b:${esc(b.id)}"${`b:${b.id}` === state.newTarget ? " selected" : ""}>${esc(b.name || b.address || b.id)}</option>`).join("")}</optgroup>${customers().length ? `<optgroup label="건물 없는 고객 (청소 기록 있음)">${customers().map(c => `<option value="c:${esc(c.id)}"${`c:${c.id}` === state.newTarget ? " selected" : ""}>${esc(c.name || c.id)}</option>`).join("")}</optgroup>` : ""}</select></label>
          <label>기간 <select data-pr-new-period>${choices.map(p => `<option value="${p.key}"${p.key === state.newPeriod ? " selected" : ""}>${esc(core.periodLabel(p.key))} (${p.from.slice(5)} ~ ${p.to.slice(5)})</option>`).join("")}</select></label>
          <button type="button" class="primary-button" data-pr-new>작성 시작</button></div></section>` : ""}
        <section class="office-panel wr-history"><header><div><span>REPORTS</span><h3>정기 관리보고서</h3></div><small>최근 기간부터</small></header>
          ${rows ? `<div class="office-table-wrap"><table class="office-table"><thead><tr><th>건물</th><th>기간</th><th>청소</th><th>점검</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
            : `<div class="office-empty"><b>아직 정기 관리보고서가 없습니다</b><span>건물과 기간을 고르고 ‘작성 시작’ 을 누르세요.</span></div>`}
        </section>`;
      const form = main.querySelector("[data-pr-form]");
      if (form) form.inert = ["save", "export", "kakao"].includes(state.busy);
    }

    // 상태를 바꾸면 사진·메모 요구가 바로 보이도록 다시 그린다.
    function onChange(event) {
      if (!isActive()) return;
      const target = event.target;
      if (target.matches("[data-pr-new-building]")) state.newTarget = target.value;
      else if (target.matches("[data-pr-new-period]")) state.newPeriod = target.value;
      else if (target.closest("[data-pr-form]") && (target.type === "radio" || target.type === "checkbox" || target.name === "inspectionDate")) { readForm(); render(); }
    }

    function onClick(event) {
      if (!isActive()) return;
      const el = event.target.closest("[data-pr-ai],[data-pr-ai-apply],[data-pr-ai-close],[data-pr-drafts],[data-pr-new],[data-pr-edit],[data-pr-close],[data-pr-save],[data-pr-export],[data-pr-export-id],[data-pr-kakao],[data-pr-kakao-id],[data-pr-photo-add],[data-pr-photo-drop]");
      if (!el) return;
      event.preventDefault();
      if (el.hasAttribute("data-pr-ai")) return void aiReview(el.getAttribute("data-pr-ai"));
      if (el.hasAttribute("data-pr-ai-apply")) return applySuggestion(Number(el.getAttribute("data-pr-ai-apply")));
      if (el.hasAttribute("data-pr-ai-close")) { state.suggestions = null; return render(); }
      if (el.hasAttribute("data-pr-drafts")) return void createDrafts();
      if (el.hasAttribute("data-pr-new")) return openNew();
      if (el.hasAttribute("data-pr-edit")) { state.suggestions = null; state.draft = state.reports.find(item => item.id === el.getAttribute("data-pr-edit")) || null; return render(); }
      if (el.hasAttribute("data-pr-close")) { state.draft = null; state.suggestions = null; state.loadedAt = 0; return render(); }
      if (el.hasAttribute("data-pr-save")) return void save();
      if (el.hasAttribute("data-pr-export")) return void exportPdf("");
      if (el.hasAttribute("data-pr-export-id")) return void exportPdf(el.getAttribute("data-pr-export-id"));
      if (el.hasAttribute("data-pr-kakao")) return void sendKakao("");
      if (el.hasAttribute("data-pr-kakao-id")) return void sendKakao(el.getAttribute("data-pr-kakao-id"));
      if (el.hasAttribute("data-pr-photo-add")) return void addPhoto(el.getAttribute("data-pr-photo-add"));
      if (el.hasAttribute("data-pr-photo-drop")) return dropPhoto(el.getAttribute("data-pr-key"), el.getAttribute("data-pr-photo-drop"));
    }

    root.document.addEventListener("click", onClick);
    root.document.addEventListener("change", onChange);
    // 다른 화면에 있을 때도 숫자를 맞춘다. 1분 안에 받았으면 다시 받지 않는다.
    function refreshBadge() {
      if (state.loading) return;
      if (state.loaded && Date.now() - state.loadedAt < 60000) return updateBadge();
      void load();
    }

    return Object.freeze({ render, refreshBadge, reload: () => { state.loaded = false; return load(); } });
  }

  root.BringPeriodicReportUI = Object.freeze({ create });
})(typeof globalThis === "object" ? globalThis : this);
