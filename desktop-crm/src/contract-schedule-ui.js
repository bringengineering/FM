(function (root, factory) {
  const schedule = typeof module === "object" && module.exports ? require("./contract-schedule-core") : root.BringContractSchedule;
  const api = factory(schedule);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BringContractScheduleUI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Schedule) {
  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

  function renderFields(contract, options) {
    const item = contract || {}, settings = options || {};
    const schedule = Schedule.normalizeCleaningSchedule(item.cleaningSchedule)
      || { mode: settings.isNew ? settings.oneOff ? "once" : "weekly" : "manual", weekday: 1 };
    return `<div class="form-grid contract-cleaning-schedule" data-contract-cleaning-schedule>
      <label class="field"><span>청소 주기·작업 시점</span><select name="cleaningScheduleMode"><option value="manual"${schedule.mode === "manual" ? " selected" : ""}>직접 입력 · 일정 자동 생성 안 함</option><option value="once"${schedule.mode === "once" ? " selected" : ""}>한 번 작업</option><option value="weekly"${schedule.mode === "weekly" ? " selected" : ""}>주 1회 · 첫 4회</option></select></label>
      <label class="field" data-cleaning-weekday-field><span>작업 요일</span><select name="cleaningWeekday">${Schedule.WEEKDAYS.map((day, index) => `<option value="${index}"${index === (schedule.weekday ?? 1) ? " selected" : ""}>${esc(day)}</option>`).join("")}</select></label>
      <label class="field wide"><span>기존 주기·추가 조건 (선택)</span><input name="serviceFrequency" value="${esc(item.serviceFrequency || "")}" maxlength="500" placeholder="예: 공실 발생 시, 현장 추가 조건"></label>
      <div class="contract-cleaning-schedule-preview wide" data-cleaning-schedule-preview role="status" aria-live="polite"></div>
    </div>`;
  }

  function fromValues(values, types) {
    if (!types.includes("청소")) return null;
    if (!["manual", "once", "weekly"].includes(values.cleaningScheduleMode)) throw new Error("청소 주기를 다시 선택해 주세요.");
    if (values.cleaningScheduleMode !== "weekly") return { mode: values.cleaningScheduleMode };
    if (!/^[0-6]$/.test(String(values.cleaningWeekday || ""))) throw new Error("청소 작업 요일을 다시 선택해 주세요.");
    return { mode: "weekly", weekday: Number(values.cleaningWeekday), count: 4 };
  }

  function refresh(form) {
    if (!form || !form.elements.cleaningScheduleMode) return;
    const values = Object.fromEntries(new FormData(form).entries());
    const types = [...form.querySelectorAll('input[name="types"]:checked')].map(input => input.value);
    const preview = form.querySelector("[data-cleaning-schedule-preview]");
    const weekday = form.querySelector("[data-cleaning-weekday-field]");
    if (weekday) weekday.hidden = values.cleaningScheduleMode !== "weekly";
    if (!preview) return;
    preview.replaceChildren();
    if (!types.includes("청소")) return;
    let schedule;
    try { schedule = fromValues(values, types); } catch (error) { preview.textContent = error.message; return; }
    if (schedule.mode === "manual") { preview.textContent = "기존 청소 주기를 유지하며 반복 일정을 자동으로 만들지 않습니다."; return; }
    if (values.status !== "진행 중") { preview.textContent = "계약 상태를 ‘진행 중’으로 저장하면 청소 일정이 연결됩니다."; return; }
    const dates = Schedule.contractDates({ ...values, types, cleaningSchedule: schedule });
    if (!dates.length) { preview.textContent = "계약 기간과 작업 날짜를 확인해 주세요. 계약 종료일 이후에는 일정을 만들지 않습니다."; return; }
    const heading = form.ownerDocument.createElement("strong");
    heading.textContent = `업무일정에 자동 연결 · ${dates.length}회`;
    const list = form.ownerDocument.createElement("div");
    list.className = "contract-cleaning-schedule-dates";
    dates.forEach((date, index) => {
      const item = form.ownerDocument.createElement("span");
      item.textContent = `${index + 1}회 · ${date.replaceAll("-", ".")} (${Schedule.WEEKDAYS[new Date(date + "T00:00:00Z").getUTCDay()]})`;
      list.append(item);
    });
    const note = form.ownerDocument.createElement("small");
    note.textContent = schedule.mode === "weekly" ? "계약 시작일 기준 첫 4회만 생성합니다. 월이 바뀌어도 총 4회이며 이후 자동 추가하지 않습니다." : "건별 계약은 작업일, 그 외 계약은 시작일 기준으로 1회 연결합니다.";
    preview.append(heading, list, note);
  }

  return { renderFields, fromValues, refresh };
});
