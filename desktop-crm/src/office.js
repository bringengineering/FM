(() => {
  "use strict";

  const Core = window.BringOfficeCore;
  const Rfid = window.BringOfficeRfidCore;
  const state = {
    context: null,
    data: { users: [], attendance: [], messages: [], rfidCards: [], rfidAdmin: false, loadedAt: "" },
    crmAccountInvites: [],
    crmAccountInvitesLoaded: false,
    crmAccountInvitesLoading: false,
    crmAccountInviteError: "",
    crmAccountInviteEmailDraft: "",
    loaded: false,
    loading: false,
    error: "",
    editingDisplayNameUserId: "",
    displayNameEditSurface: "",
    displayNameDraft: "",
    attendanceWeekOffset: 0,
    selectedAttendanceDate: Core.attendanceWorkDate(),
    attendanceShiftDate: Core.attendanceWorkDate(),
    selectedAdminUserId: "",
    selectedMemberId: "",
    adminMonth: Core.attendanceWorkDate().slice(0, 7),
    adminTab: "list",
    adminAttendanceCorrection: null,
    selectedRfidUserId: "",
    rfidCapture: null,
    rfidCaptureFeedback: null,
    rfidReaderPorts: [],
    rfidReaderPortPath: "",
    rfidReaderPortsLoaded: false,
    rfidReaderPortsLoading: false,
    rfidReaderPortsError: "",
    rfidAttendanceStatus: "stopped",
    rfidAttendanceCode: "",
    rfidAttendanceMessage: "출퇴근 화면이 열려 있는 동안 태그기가 자동으로 연결됩니다.",
    rfidAttendanceRequested: false,
    rfidAttendanceStartPending: false,
    busy: false,
    active: false,
    generation: 0,
    dataRevision: 0,
    clockTimer: null,
    syncTimer: null
  };
  let officeRfidAttendanceUnsubscribe = null;

  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  const currentUser = () => state.context && state.context.currentAuth && state.context.currentAuth.user || {};
  const currentUserId = () => String(currentUser().uid || "");
  const isAdmin = () => currentUser().officeAdmin === true;
  const isCrmAdmin = () => currentUser().role === "admin";
  const userById = uid => state.data.users.find(user => user.uid === uid);
  const myAttendance = () => state.data.attendance.filter(row => row.userId === currentUserId()).sort((a, b) => `${b.workDate}${b.checkInAt}`.localeCompare(`${a.workDate}${a.checkInAt}`));
  const todayRecord = () => myAttendance().find(row => row.workDate === Core.attendanceWorkDate()) || null;
  const statusClass = record => {
    const status = Core.attendanceReviewStatus(record, Core.attendanceWorkDate());
    return status === "퇴근 미기록" ? "missing" : status === "퇴근 완료" ? "complete" : status === "근무 중" ? "working" : "before";
  };
  const formatTime = value => {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value).slice(11, 16) || "—" : new Intl.DateTimeFormat("ko-KR", { timeZone: Core.KOREA_TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  };
  const formatDate = value => {
    const date = new Date(`${value}T12:00:00+09:00`);
    if (Number.isNaN(date.getTime())) return value || "—";
    return new Intl.DateTimeFormat("ko-KR", { timeZone: Core.KOREA_TIME_ZONE, month: "long", day: "numeric", weekday: "short" }).format(date);
  };
  const dateFromKey = value => new Date(`${value}T12:00:00+09:00`);
  const dateKey = value => Core.workDate(value);
  const addDays = (value, amount) => {
    const date = value instanceof Date ? new Date(value.getTime()) : dateFromKey(value);
    date.setUTCDate(date.getUTCDate() + amount);
    return dateKey(date);
  };
  const startOfWeek = value => {
    const date = value instanceof Date ? value : dateFromKey(value);
    const day = date.getUTCDay();
    return addDays(date, -(day === 0 ? 6 : day - 1));
  };
  const minutesAt = value => {
    if (!value) return 0;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 0;
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: Core.KOREA_TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
    const hour = Number(parts.find(part => part.type === "hour")?.value || 0) % 24;
    const minute = Number(parts.find(part => part.type === "minute")?.value || 0);
    return hour * 60 + minute;
  };
  const workedMinutes = record => Core.workedMinutes(record);
  const durationText = minutes => `${Math.floor(Math.max(0, minutes) / 60)}h ${String(Math.max(0, minutes) % 60).padStart(2, "0")}m`;
  const shiftMonth = (month, amount) => {
    const match = /^(\d{4})-(\d{2})$/.exec(String(month || ""));
    const date = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + amount, 1)) : new Date();
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const avatar = (user, size) => user && user.photoUrl
    ? `<img class="office-avatar ${size || ""}" src="${esc(user.photoUrl)}" alt="${esc(Core.displayName(user))} 프로필">`
    : `<span class="office-avatar ${size || ""}">${esc(Core.displayName(user).replace(/\s/g, "").slice(0, 1).toUpperCase() || "B")}</span>`;
  const userMeta = user => [user && user.department, user && user.title].filter(Boolean).join(" · ") || (user && user.role === "admin" ? "관리자" : "BRING 구성원");

  function notify(message, kind) {
    if (state.context && typeof state.context.showToast === "function") state.context.showToast(message, kind || "success");
  }

  function updateClock() {
    const now = new Date();
    const attendanceDate = Core.attendanceWorkDate(now);
    if (attendanceDate !== state.attendanceShiftDate) {
      const previousAttendanceDate = state.attendanceShiftDate;
      state.attendanceShiftDate = attendanceDate;
      if (state.attendanceWeekOffset === 0 && state.selectedAttendanceDate === previousAttendanceDate) {
        state.selectedAttendanceDate = attendanceDate;
      }
      if (state.adminMonth === previousAttendanceDate.slice(0, 7)) {
        state.adminMonth = attendanceDate.slice(0, 7);
      }
      if (state.loaded && officeIsActive()) renderCurrent();
    }
    document.querySelectorAll("[data-office-clock]").forEach(element => {
      element.textContent = new Intl.DateTimeFormat("ko-KR", { timeZone: Core.KOREA_TIME_ZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(now);
    });
    document.querySelectorAll("[data-office-date]").forEach(element => {
      element.textContent = new Intl.DateTimeFormat("ko-KR", { timeZone: Core.KOREA_TIME_ZONE, year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(now);
    });
  }

  function startClock() {
    clearInterval(state.clockTimer);
    updateClock();
    state.clockTimer = setInterval(updateClock, 1000);
  }

  function officeIsActive() {
    const contextActive = state.context && typeof state.context.isActive === "function" && state.context.isActive();
    const activeView = document.querySelector("#nav .nav-item.active")?.dataset.view || "";
    const officeSurface = activeView.startsWith("office") || activeView === "dashboard";
    return state.active && contextActive && officeSurface && activeView === state.context?.view;
  }

  function officeRfidAttendanceShouldRun() {
    return Boolean(state.active && state.context && state.context.view === "officeAttendance"
      && typeof state.context.isActive === "function" && state.context.isActive()
      && state.loaded && isAdmin() && state.data.rfidAdmin
      && state.context.api && typeof state.context.api.startOfficeRfidAttendance === "function");
  }

  function officeRfidAttendanceCodeMessage(code) {
    const messages = {
      RFID_SERIAL_PORT_NOT_FOUND: "출퇴근 태그기(CP210x)를 찾지 못했습니다. USB 연결을 확인하면 자동으로 다시 연결합니다.",
      RFID_SERIAL_PORT_BUSY: "태그기가 다른 프로그램에서 사용 중입니다. 연결을 확인하면 자동으로 다시 시도합니다.",
      RFID_SERIAL_PORT_SELECT_REQUIRED: "CP210x 태그기가 여러 대 연결되어 있어 자동 연결할 수 없습니다.",
      RFID_SERIAL_UNAVAILABLE: "이 PC에서는 RFID 태그 연결을 사용할 수 없습니다.",
      RFID_SERIAL_OPEN_FAILED: "태그기 연결에 실패했습니다. USB 연결을 확인하면 자동으로 다시 시도합니다.",
      RFID_SERIAL_INVALID_DATA: "태그기에서 올바르지 않은 데이터가 들어왔습니다. 연결을 다시 확인합니다.",
      RFID_CARD_NOT_REGISTERED: "등록되지 않은 카드입니다. 직원 카드 등록 탭에서 먼저 등록해 주세요.",
      RFID_CARD_LOOKUP_FAILED: "등록된 카드 정보를 확인하지 못했습니다. 네트워크 연결을 확인해 주세요.",
      RFID_ATTENDANCE_RESET_WINDOW: "07:00부터 새 근무일로 출퇴근을 기록합니다.",
      RFID_ATTENDANCE_NO_OPEN_SHIFT: "출근 기록이 없어 퇴근으로 처리하지 않았습니다. 다시 태그하면 출근으로 기록됩니다.",
      RFID_ATTENDANCE_ALREADY_COMPLETE: "이 근무일의 출퇴근이 이미 완료되었습니다. 다음날 07:00부터 새 근무일이 시작됩니다.",
      RFID_ATTENDANCE_DUPLICATE_SCAN: "같은 태그가 연속으로 읽혀 중복 기록을 막았습니다.",
      RFID_ATTENDANCE_CONFLICT: "동시에 다른 태그가 기록되어 저장하지 못했습니다. 다시 태그해 주세요.",
      RFID_ATTENDANCE_WRITE_FAILED: "출퇴근 기록 저장에 실패했습니다. 연결 상태를 확인해 주세요.",
      RFID_ATTENDANCE_DATA_INVALID: "기존 근태 자료를 안전하게 확인하지 못해 기록을 보류했습니다.",
      RFID_ATTENDANCE_ALREADY_SAVED: "이미 반영된 태그 기록입니다.",
      NETWORK: "서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.",
    };
    return messages[String(code || "")] || "태그 처리 중 문제가 발생했습니다. 근태 관리자에게 문의해 주세요.";
  }

  function handleOfficeRfidAttendanceEvent(event) {
    if (!event || typeof event !== "object") return;
    state.rfidAttendanceCode = String(event.code || "");
    if (event.status === "tag" || event.status === "tag-error") {
      state.rfidAttendanceStatus = event.code && event.code !== "RFID_ATTENDANCE_ALREADY_SAVED" ? "error" : "connected";
    } else state.rfidAttendanceStatus = String(event.status || "error");
    if (event.status === "starting") state.rfidAttendanceMessage = "출퇴근 태그기에 연결하고 있습니다…";
    else if (event.status === "connected") state.rfidAttendanceMessage = "태그기 연결됨 · 카드를 태그하면 출퇴근이 자동 기록됩니다.";
    else if (event.status === "disconnected" || event.status === "error") state.rfidAttendanceMessage = officeRfidAttendanceCodeMessage(event.code);
    else if (event.status === "stopped") state.rfidAttendanceMessage = "출퇴근 화면이 열려 있는 동안 태그기가 자동으로 연결됩니다.";
    else if (event.status === "tag" || event.status === "tag-error") {
      if (!event.code || event.code === "RFID_ATTENDANCE_ALREADY_SAVED") {
        const employee = userById(event.userId);
        const name = employee ? Core.displayName(employee) : "직원";
        state.rfidAttendanceMessage = event.action === "check-out"
          ? `${name}님의 퇴근이 기록되었습니다.`
          : event.action === "check-in" ? `${name}님의 출근이 기록되었습니다.` : "이미 반영된 태그 기록입니다.";
        if (event.status === "tag") {
          notify(state.rfidAttendanceMessage, "success");
          void load(true);
        }
      } else {
        state.rfidAttendanceMessage = officeRfidAttendanceCodeMessage(event.code);
        notify(state.rfidAttendanceMessage, "error");
      }
    }
    if (state.context && state.context.view === "officeAttendance" && officeIsActive()) renderCurrent();
  }

  function syncOfficeRfidAttendance() {
    const api = state.context && state.context.api;
    if (!officeRfidAttendanceUnsubscribe && api && typeof api.onOfficeRfidAttendanceEvent === "function") {
      officeRfidAttendanceUnsubscribe = api.onOfficeRfidAttendanceEvent(handleOfficeRfidAttendanceEvent);
    }
    if (officeRfidAttendanceShouldRun()) {
      if (state.rfidAttendanceRequested || state.rfidAttendanceStartPending) return;
      state.rfidAttendanceRequested = true;
      state.rfidAttendanceStartPending = true;
      state.rfidAttendanceStatus = "starting";
      state.rfidAttendanceCode = "";
      state.rfidAttendanceMessage = "출퇴근 태그기에 연결하고 있습니다…";
      Promise.resolve(api.startOfficeRfidAttendance()).then(result => {
        if (!officeRfidAttendanceShouldRun()) {
          state.rfidAttendanceRequested = false;
          return api.stopOfficeRfidAttendance && api.stopOfficeRfidAttendance();
        }
        if (result && result.ok === false && !state.rfidAttendanceCode) {
          state.rfidAttendanceStatus = "error";
          state.rfidAttendanceCode = String(result.code || "");
          state.rfidAttendanceMessage = officeRfidAttendanceCodeMessage(result.code);
        }
        return undefined;
      }).catch(error => {
        state.rfidAttendanceStatus = "error";
        state.rfidAttendanceCode = String(error && error.code || "");
        state.rfidAttendanceMessage = officeRfidAttendanceCodeMessage(error && error.code);
      }).finally(() => {
        state.rfidAttendanceStartPending = false;
        if (state.context && state.context.view === "officeAttendance" && officeIsActive()) renderCurrent();
      });
      return;
    }
    if (state.rfidAttendanceRequested || state.rfidAttendanceStartPending) {
      state.rfidAttendanceRequested = false;
      state.rfidAttendanceStartPending = false;
      if (api && typeof api.stopOfficeRfidAttendance === "function") void api.stopOfficeRfidAttendance().catch(() => {});
      state.rfidAttendanceStatus = "stopped";
      state.rfidAttendanceCode = "";
      state.rfidAttendanceMessage = "출퇴근 화면이 열려 있는 동안 태그기가 자동으로 연결됩니다.";
    }
  }

  function stopTimers() {
    clearInterval(state.clockTimer);
    clearInterval(state.syncTimer);
    state.clockTimer = null;
    state.syncTimer = null;
  }

  function captureContextGuard() {
    return { generation: state.generation, dataRevision: state.dataRevision, uid: currentUserId(), context: state.context };
  }

  function contextGuardActive(guard) {
    return Boolean(guard && guard.generation === state.generation && guard.uid === currentUserId() && guard.context === state.context);
  }

  function applyOfficeData(payload, user, expectedRevision) {
    if (expectedRevision !== undefined && expectedRevision !== state.dataRevision) return false;
    const source = payload && payload.data || payload;
    state.data = Object.assign(Core.normalizeOfficePayload(source, user || currentUser()), {
      rfidCards: Rfid ? Rfid.summaries(source && source.rfidCards) : [],
      rfidAdmin: source && source.rfidAdmin === true,
    });
    const correction = state.adminAttendanceCorrection;
    if (correction) {
      const currentRecord = state.data.attendance.find(record => record.userId === correction.userId
        && record.workDate === correction.workDate) || null;
      if (!currentRecord || currentRecord.updatedAt !== correction.expectedUpdatedAt) {
        clearAdminAttendanceCorrection();
      }
    }
    state.dataRevision += 1;
    return true;
  }

  function startSync() {
    if (state.syncTimer) return;
    state.syncTimer = setInterval(() => {
      if (officeIsActive() && !document.hidden && !state.busy) load(true);
    }, 20000);
  }

  async function load(force) {
    if (state.loading || state.loaded && !force) return;
    const guard = captureContextGuard();
    state.loading = true;
    state.error = "";
    try {
      const payload = await state.context.api.loadOffice();
      if (!contextGuardActive(guard) || guard.dataRevision !== state.dataRevision) return;
      if (payload && payload.ok === false) throw new Error(payload.error || "BRING OFFICE 자료를 불러오지 못했습니다.");
      applyOfficeData(payload, currentUser(), guard.dataRevision);
      state.loaded = true;
    } catch (error) {
      if (contextGuardActive(guard)) state.error = error.message || "BRING OFFICE 자료를 불러오지 못했습니다.";
    } finally {
      if (contextGuardActive(guard)) {
        state.loading = false;
        if (officeIsActive()) {
          renderCurrent();
        }
      }
    }
  }

  async function refreshCrmAccountInvites() {
    if (!isCrmAdmin() || state.crmAccountInvitesLoading) return;
    const guard = captureContextGuard();
    state.crmAccountInvitesLoading = true;
    state.crmAccountInviteError = "";
    renderCurrent();
    try {
      const result = await state.context.api.loadCrmAccounts();
      if (!contextGuardActive(guard) || !isCrmAdmin()) return;
      state.crmAccountInvites = Array.isArray(result) ? result : [];
      state.crmAccountInvitesLoaded = true;
    } catch (error) {
      state.crmAccountInviteError = error && error.message || "전체 계정을 불러오지 못했습니다.";
    } finally {
      state.crmAccountInvitesLoading = false;
      if (officeIsActive() && state.context?.view === "officeAccountSetup") renderCurrent();
    }
  }

  async function registerCrmAccount(form) {
    if (!isCrmAdmin() || state.busy) return;
    const email = String(new FormData(form).get("email") || "").trim();
    state.crmAccountInviteEmailDraft = email;
    state.busy = true;
    renderCurrent();
    try {
      const result = await state.context.api.registerCrmAccount({ email });
      if (!result || result.emailSent !== true) {
        const emailMessage = result && result.emailErrorCode === "crm_account_email_link_not_enabled"
          ? "계정은 등록됐지만 Firebase 이메일 링크 로그인이 꺼져 있어 메일을 보내지 못했습니다. 관리자 설정 확인이 필요합니다."
          : result && result.emailErrorCode === "crm_account_email_action_domain_invalid"
            ? "계정은 등록됐지만 Firebase 인증 도메인 설정을 확인해야 메일을 보낼 수 있습니다."
            : result && result.emailErrorCode === "crm_account_setup_rate_limited"
              ? "계정은 등록됐지만 이메일 발송 한도에 걸렸습니다. 잠시 후 다시 보내 주세요."
              : "계정은 비밀번호 없이 등록했지만 인증 메일 발송이 확인되지 않았습니다. 아래 목록에서 다시 보내 주세요.";
        notify(emailMessage, "error");
      } else {
        state.crmAccountInviteEmailDraft = "";
        notify("계정을 등록했고 이메일 인증 링크를 보냈습니다.", "success");
      }
      await refreshCrmAccountInvites();
    } catch (error) {
      notify(error && error.message || "계정을 등록하지 못했습니다.", "error");
    } finally {
      state.busy = false;
      renderCurrent();
    }
  }

  async function resendCrmAccountInvite(uid) {
    if (!isCrmAdmin() || state.busy || !/^[A-Za-z0-9_-]{1,128}$/u.test(String(uid || ""))) return;
    state.busy = true;
    renderCurrent();
    try {
      const result = await state.context.api.resendCrmAccountInvite({ uid });
      if (result && result.emailSent === true) notify("인증 및 비밀번호 설정 링크를 다시 보냈습니다.", "success");
      await refreshCrmAccountInvites();
    } catch (error) {
      notify(error && error.message || "인증 메일을 다시 보내지 못했습니다.", "error");
    } finally {
      state.busy = false;
      renderCurrent();
    }
  }

  function confirmCrmAccountInviteArchive(account) {
    return new Promise(resolve => {
      const dialog = document.createElement("dialog");
      dialog.className = "work-outcome-dialog crm-account-archive-dialog";
      dialog.setAttribute("aria-labelledby", "crm-account-archive-title");
      dialog.setAttribute("aria-describedby", "crm-account-archive-description");
      dialog.innerHTML = `<h2 id="crm-account-archive-title">설정 완료 이력을 삭제할까요?</h2><p data-archive-member></p><p id="crm-account-archive-description">이 항목이 계정 설정 현황에서 사라집니다.<br>로그인 계정과 기존 업무 기록은 유지됩니다.</p><form method="dialog"><footer><button type="submit" value="cancel" autofocus>취소</button><button type="submit" value="archive" class="crm-account-archive-confirm">목록에서 삭제</button></footer></form>`;
      dialog.querySelector("[data-archive-member]").textContent = account.displayName || account.email;
      dialog.addEventListener("close", () => {
        const confirmed = dialog.returnValue === "archive";
        dialog.remove();
        resolve(confirmed);
      }, { once: true });
      document.body.append(dialog);
      dialog.showModal();
    });
  }

  async function archiveCrmAccountInvite(uid) {
    if (!isCrmAdmin() || state.busy || state.crmAccountInvitesLoading) return;
    const account = state.crmAccountInvites.find(row => row.uid === uid && row.status === "complete");
    if (!account) return;
    const guard = captureContextGuard();
    if (!await confirmCrmAccountInviteArchive(account)) return;
    if (!contextGuardActive(guard) || !isCrmAdmin() || state.busy || state.crmAccountInvitesLoading) return;
    const sessionActive = () => guard.generation === state.generation && guard.uid === currentUserId();
    state.busy = true;
    renderCurrent();
    try {
      const result = await state.context.api.archiveCrmAccountInvite({ uid });
      if (!sessionActive()) return;
      if (!result || result.uid !== uid || result.archived !== true) throw new Error("삭제 결과를 확인하지 못했습니다. 새로고침해 주세요.");
      state.crmAccountInvites = state.crmAccountInvites.filter(row => row.uid !== uid);
      notify("설정 완료 이력을 목록에서 삭제했습니다. 로그인 계정은 유지됩니다.", "success");
    } catch (error) {
      if (sessionActive()) notify(error && error.message || "설정 이력을 삭제하지 못했습니다.", "error");
    } finally {
      if (sessionActive()) {
        state.busy = false;
        renderCurrent();
      }
    }
  }

  function confirmCrmAccountManagement(account, kind, nextRole) {
    return new Promise(resolve => {
      const dialog = document.createElement("dialog");
      dialog.className = "work-outcome-dialog crm-account-archive-dialog";
      dialog.setAttribute("aria-labelledby", "crm-account-manage-title");
      dialog.innerHTML = `<h2 id="crm-account-manage-title"></h2><p data-account-label></p><p data-account-description></p>${kind === "delete" ? `<label class="crm-account-delete-label">확인을 위해 ‘삭제’를 입력하세요<input data-account-confirm-text type="text" autocomplete="off" maxlength="10"></label>` : ""}<footer><button type="button" data-account-cancel autofocus>취소</button><button type="button" data-account-confirm ${kind === "delete" ? `disabled class="crm-account-archive-confirm"` : ""}>${kind === "delete" ? "계정 삭제" : "변경 내용 저장"}</button></footer>`;
      dialog.querySelector("h2").textContent = kind === "delete" ? "계정을 삭제할까요?" : "관리자 권한을 변경할까요?";
      dialog.querySelector("[data-account-label]").textContent = `${account.displayName || account.email} · ${account.email}`;
      dialog.querySelector("[data-account-description]").textContent = kind === "delete"
        ? "로그인 계정과 CRM 접근 권한을 삭제합니다. 기존 업무·보고서·근태 기록은 유지됩니다."
        : nextRole === "admin" ? "관리자로 변경하면 전체 계정 관리와 관리자 메뉴를 사용할 수 있습니다." : "일반 사원으로 변경하면 관리자 메뉴와 계정 관리 권한이 해제됩니다.";
      const input = dialog.querySelector("[data-account-confirm-text]");
      input?.addEventListener("input", () => { dialog.querySelector("[data-account-confirm]").disabled = input.value.trim() !== "삭제"; });
      dialog.querySelector("[data-account-cancel]").addEventListener("click", () => dialog.close("cancel"));
      dialog.querySelector("[data-account-confirm]").addEventListener("click", () => {
        if (kind !== "delete" || input?.value.trim() === "삭제") dialog.close("confirm");
      });
      dialog.addEventListener("close", () => {
        const confirmed = dialog.returnValue === "confirm" && (kind !== "delete" || input?.value.trim() === "삭제");
        dialog.remove(); resolve(confirmed);
      }, { once: true });
      document.body.append(dialog); dialog.showModal();
    });
  }

  async function manageCrmAccount(uid, kind, nextRole) {
    if (!isCrmAdmin() || state.busy || state.crmAccountInvitesLoading) return;
    const account = state.crmAccountInvites.find(row => row.uid === uid);
    if (!account || uid === currentUserId() || (kind === "role" ? !account.canChangeRole || !["admin", "member"].includes(nextRole) : !account.canDelete)) return;
    const guard = captureContextGuard();
    if (!await confirmCrmAccountManagement(account, kind, nextRole)) return;
    if (!contextGuardActive(guard) || !isCrmAdmin() || state.busy || state.crmAccountInvitesLoading) return;
    const sessionActive = () => guard.generation === state.generation && guard.uid === currentUserId();
    state.busy = true; renderCurrent();
    try {
      const input = { uid, expectedRole: account.role };
      const result = kind === "role" ? await state.context.api.setCrmAccountRole({ ...input, role: nextRole })
        : await state.context.api.deleteCrmAccount({ ...input, confirmDelete: true });
      if (!sessionActive()) return;
      if (!result || result.uid !== uid || (kind === "role" ? result.updated !== true || result.role !== nextRole : result.deleted !== true)) {
        throw new Error("처리 결과를 확인하지 못했습니다. 새로고침해 주세요.");
      }
      if (kind === "delete") state.crmAccountInvites = state.crmAccountInvites.filter(row => row.uid !== uid);
      else account.role = nextRole;
      notify(kind === "delete" ? "로그인 계정을 삭제했습니다. 기존 업무·근태 기록은 유지됩니다." : "관리자 권한을 변경했습니다.", "success");
      await refreshCrmAccountInvites();
    } catch (error) {
      if (sessionActive()) { notify(error && error.message || "계정 변경에 실패했습니다. 새로고침해 주세요.", "error"); await refreshCrmAccountInvites(); }
    } finally { if (sessionActive()) { state.busy = false; renderCurrent(); } }
  }

  function loadingPanel() {
    return `<section class="office-loading"><span class="office-loader"></span><b>BRING OFFICE를 준비하고 있습니다</b><p>기존 CRM 사용자와 업무 자료를 불러오는 중입니다.</p></section>`;
  }

  function errorPanel() {
    return `<section class="office-loading office-error"><span>!</span><b>자료를 불러오지 못했습니다</b><p>${esc(state.error)}</p><button class="secondary-button" data-office-refresh>다시 시도</button></section>`;
  }

  function crmAccountSetupView() {
    if (!isCrmAdmin()) {
      return `<section class="office-loading office-error"><span>!</span><b>관리자 전용 메뉴입니다</b><p>CRM 관리자 계정으로 로그인해 주세요.</p></section>`;
    }
    const rows = state.crmAccountInvites.map(account => {
      const pending = account.status === "pending";
      const own = account.uid === currentUserId();
      const statusText = ({ active: "활성", pending: "인증 대기", disabled: "사용 중지", missing: "로그인 계정 없음", deletionPending: "삭제 재시도 필요" })[account.status] || "확인 필요";
      const busy = state.busy || state.crmAccountInvitesLoading;
      const createdAt = account.createdAt ? new Date(account.createdAt).toLocaleString("ko-KR", { timeZone: Core.KOREA_TIME_ZONE }) : "—";
      return `<tr><td><b>${esc(account.displayName || account.email)}</b> ${account.role === "admin" ? `<span class="crm-account-role-badge">관리자</span>` : ""}${own ? `<span class="crm-account-self-badge">본인</span>` : ""}<small>${esc(account.email)}</small></td><td><span class="crm-account-status ${account.status === "active" ? "complete" : "pending"}">${esc(statusText)}</span></td><td><select data-crm-account-role="${esc(account.uid)}" aria-label="${esc(account.displayName || account.email)} 권한" ${busy || own || !account.canChangeRole ? "disabled" : ""}><option value="member" ${account.role === "member" ? "selected" : ""}>일반 사원</option><option value="admin" ${account.role === "admin" ? "selected" : ""}>관리자</option>${account.role === "viewer" ? `<option value="viewer" selected>조회 전용</option>` : ""}</select></td><td>${esc(createdAt)}</td><td><div class="crm-account-row-actions">${account.canResend && pending ? `<button type="button" class="secondary-button" data-crm-account-resend="${esc(account.uid)}" ${busy ? "disabled" : ""}>메일 재발송</button>` : ""}<button type="button" class="secondary-button crm-account-archive-button" data-crm-account-delete="${esc(account.uid)}" ${busy || own || !account.canDelete ? "disabled" : ""}>${account.status === "deletionPending" ? "삭제 재시도" : "삭제"}</button></div></td></tr>`;
    }).join("");
    const accountRows = state.crmAccountInvitesLoading && !state.crmAccountInvitesLoaded
      ? `<div class="office-loading"><span class="office-loader"></span><b>계정 현황을 불러오는 중입니다</b></div>`
      : `<div class="crm-account-table-wrap"><table class="crm-account-table"><thead><tr><th>구성원</th><th>상태</th><th>권한 설정</th><th>등록일</th><th>작업</th></tr></thead><tbody>${rows || `<tr><td colspan="5" class="crm-account-empty">등록된 CRM 계정이 없습니다.</td></tr>`}</tbody></table></div>`;
    return `<section class="office-hero crm-account-hero"><div><span>ACCOUNT SETUP</span><h2>계정 등록</h2><p>이메일만 등록하면 임시 비밀번호 없이 초대 링크에서 이메일 인증과 새 비밀번호 설정을 한 번에 진행합니다.</p></div></section>
      <section class="office-panel crm-account-panel"><header><div><span>NEW MEMBER</span><h3>이메일 인증 링크 보내기</h3><p>등록된 이메일 주소로 일회용 링크를 보냅니다. 새 구성원은 링크에서 직접 비밀번호를 정합니다.</p></div></header>
        <form class="crm-account-invite-form" data-crm-account-invite-form><label><span>회사 이메일</span><input data-crm-account-invite-email name="email" type="email" maxlength="254" autocomplete="email" placeholder="name@company.com" value="${esc(state.crmAccountInviteEmailDraft)}" required ${state.busy ? "disabled" : ""}></label><button type="submit" class="primary-button" ${state.busy ? "disabled" : ""}>${state.busy ? "처리 중…" : "이메일 인증하기"}</button></form>
        <p class="crm-account-security-note"><b>초기 비밀번호를 만들거나 저장하지 않습니다.</b> 계정 설정 요청은 7일간 대기하며, 메일 링크가 만료되면 목록에서 새 링크를 보낼 수 있습니다. 이메일 인증이 끝나야 구성원 계정으로 활성화됩니다.</p>
      </section>
      <section class="office-panel crm-account-panel"><header><div><span>ALL ACCOUNTS</span><h3>전체 등록 계정 ${state.crmAccountInvitesLoaded ? `${state.crmAccountInvites.length}명` : ""}</h3><p>초대 이력과 관계없이 기존 CRM 등록 계정과 인증 대기 계정을 함께 표시합니다.</p></div><button type="button" class="secondary-button" data-crm-account-refresh ${state.crmAccountInvitesLoading || state.busy ? "disabled" : ""}>${state.crmAccountInvitesLoading ? "불러오는 중…" : "새로고침"}</button></header>
        ${state.crmAccountInviteError ? `<div class="crm-account-error" role="alert">${esc(state.crmAccountInviteError)}</div>` : ""}${accountRows}<p class="crm-account-security-note">관리자만 조회·변경할 수 있습니다. 본인 계정과 마지막 관리자는 보호되며, 계정을 삭제해도 기존 업무·보고서·근태 기록은 유지됩니다.</p>
      </section>`;
  }

  // 날짜 칸이 빈 채로 열리면 사람은 연도부터 네 자리를 친다. 그 해 안으로
  // 범위를 잡아 두면 달력이 올해로 열리고, 화살표만 눌러도 연도가 안 튄다.
  // 지난해·내년까지는 열어 둔다 — 계약 종료일과 입사 예정일이 넘나든다.
  function dateBounds(centerYear) {
    const year = Number(centerYear) || Number(Core.workDate().slice(0, 4));
    return ` min="${year - 1}-01-01" max="${year + 1}-12-31"`;
  }

  function officeHero(title, description, actions) {
    return `<section class="office-hero"><div><span>BRING OFFICE</span><h2>${esc(title)}</h2><p>${esc(description)}</p></div>${actions ? `<div class="office-hero-actions">${actions}</div>` : ""}</section>`;
  }

  function statusPill(record) {
    return `<span class="office-status ${statusClass(record)}"><i></i>${Core.attendanceReviewStatus(record, Core.attendanceWorkDate())}</span>`;
  }

  function attendanceLiveStatus() {
    const today = todayRecord();
    const unavailable = !state.loaded;
    const status = unavailable
      ? `<span class="office-status before"><i></i>${state.error ? "확인 필요" : "불러오는 중"}</span>`
      : statusPill(today);
    return `<div class="attendance-live-status"><span data-office-date></span><b data-office-clock></b>${status}</div>`;
  }

  function dashboardAttendanceView() {
    return `<section class="office-hero dashboard-attendance-hero" data-dashboard-attendance><div><span>BRING OFFICE</span><h2>내 근태현황</h2><p>태그기로 기록된 주간 출퇴근 현황을 확인하세요</p></div><div class="office-hero-actions">${attendanceLiveStatus()}</div></section>`;
  }

  function attendanceRows(rows, showUser) {
    if (!rows.length) return `<div class="office-empty"><b>아직 근태 기록이 없습니다</b><span>태그기에 출퇴근을 기록하면 이곳에 자동으로 표시됩니다.</span></div>`;
    return `<div class="office-table-wrap"><table class="office-table"><thead><tr>${showUser ? "<th>직원</th>" : ""}<th>날짜</th><th>출근시간</th><th>퇴근시간</th><th>근무 상태</th></tr></thead><tbody>${rows.map(row => {
      const user = userById(row.userId) || { uid: row.userId, displayName: row.userId };
      return `<tr>${showUser ? `<td><div class="office-user-cell">${avatar(user, "small")}<b>${esc(Core.displayName(user))}</b></div></td>` : ""}<td><b>${esc(formatDate(row.workDate))}</b><small>${esc(row.workDate)}</small></td><td>${esc(formatTime(row.checkInAt))}</td><td>${esc(formatTime(row.checkOutAt))}</td><td>${statusPill(row)}</td></tr>`;
    }).join("")}</tbody></table></div>`;
  }

  function homeView() {
    const today = todayRecord();
    return `${officeHero("BRING OFFICE", "브링의 업무를 한 곳에서", `<div class="office-live-time"><span data-office-date></span><b data-office-clock></b></div>`)}
      <section class="office-dashboard-grid">
        <button class="office-summary-card attendance" data-office-go="officeAttendance"><span class="office-card-icon"><svg class="office-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.2"/><path d="M12 7.4V12l3.2 1.9"/></svg></span><div><small>근태관리</small><h3>${Core.attendanceStatus(today)}</h3><p>출근시간 <b>${esc(formatTime(today && today.checkInAt))}</b></p></div>${statusPill(today)}</button>
      </section>
      <section class="office-panel"><header><div><span>MY WORK LOG</span><h3>최근 근태 기록</h3></div><button class="text-button" data-office-go="officeAttendance">전체 보기 →</button></header>${attendanceRows(myAttendance().slice(0, 5), false)}</section>`;
  }

  function attendanceView() {
    const today = todayRecord();
    const baseWeek = startOfWeek(Core.attendanceWorkDate());
    const weekStart = addDays(baseWeek, state.attendanceWeekOffset * 7);
    const weekDates = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
    const weekEnd = weekDates[6];
    const records = myAttendance();
    const weekRows = weekDates.map(workDate => records.find(row => row.workDate === workDate) || null);
    const workedDays = weekRows.filter(row => row && row.checkInAt).length;
    const totalMinutes = weekRows.reduce((sum, row) => sum + workedMinutes(row), 0);
    const selectedDate = weekDates.includes(state.selectedAttendanceDate) ? state.selectedAttendanceDate : weekDates[0];
    const selected = records.find(row => row.workDate === selectedDate) || null;
    const selectedMinutes = workedMinutes(selected);
    const startMinute = selected ? minutesAt(selected.checkInAt) : 0;
    const endMinute = selected ? (selected.checkOutAt ? minutesAt(selected.checkOutAt) : selected.workDate === Core.attendanceWorkDate() ? minutesAt(new Date().toISOString()) : startMinute) : startMinute;
    const barLeft = Math.max(0, Math.min(100, startMinute / 1440 * 100));
    const barWidth = Math.max(selected ? 1.8 : 0, Math.min(100 - barLeft, Math.max(0, endMinute - startMinute) / 1440 * 100));
    const dayLabels = ["월", "화", "수", "목", "금", "토", "일"];
    return `${officeHero("내 근태현황", "태그기로 기록된 주간 출퇴근 현황을 확인하세요", attendanceLiveStatus())}
      <section class="attendance-tag-note ${esc(state.rfidAttendanceStatus)}" role="status" aria-live="polite"><span aria-hidden="true">${state.rfidAttendanceStatus === "connected" ? "✓" : "•"}</span><div><b>${state.rfidAttendanceStatus === "connected" ? "태그기 연결됨" : state.rfidAttendanceStatus === "starting" ? "태그기 연결 중" : state.rfidAttendanceStatus === "error" || state.rfidAttendanceStatus === "disconnected" ? "태그기 연결 확인 필요" : "자동 출퇴근"}</b><small>${esc(state.rfidAttendanceMessage)}</small></div></section>
      <section class="attendance-week-toolbar"><div><button data-office-week="previous" aria-label="이전 주">‹</button><strong>${esc(weekStart)} ~ ${esc(weekEnd)}</strong><button data-office-week="next" aria-label="다음 주">›</button><button class="attendance-today-button" data-office-week="today">오늘</button></div><span>브링엔지니어링 <b>09:00 ~ 18:00</b></span></section>
      <section class="attendance-week-summary"><div class="attendance-progress"><span>주간 누적 <b>${esc(durationText(totalMinutes))}</b></span><p>이번 주 근무시간을 기준으로 표시합니다.</p><div><i style="width:${Math.min(100, totalMinutes / 2400 * 100)}%"></i></div><small><b>40h</b><b>52h</b></small></div><article><span>근무일</span><b>${workedDays}<small>/5일</small></b></article><article><span>남은 근무일</span><b>${Math.max(0, 5 - workedDays)}<small>일</small></b></article><article><span>총 근로시간</span><b>${esc(durationText(totalMinutes))}</b></article><article><span>오늘 상태</span>${statusPill(today)}</article></section>
      <section class="attendance-week-days">${weekDates.map((workDate, index) => {
        const row = weekRows[index];
        const weekend = index > 4;
        return `<button class="attendance-day ${workDate === selectedDate ? "selected" : ""} ${weekend ? "weekend" : ""}" data-office-date-select="${esc(workDate)}"><span><b>${dayLabels[index]}</b> ${Number(workDate.slice(-2))}</span>${row ? `<strong>${formatTime(row.checkInAt)} 출근</strong><small>${row.checkOutAt ? `${formatTime(row.checkOutAt)} 퇴근` : Core.attendanceReviewStatus(row, Core.attendanceWorkDate())}</small>` : `<em>${weekend ? "휴일" : "기록 없음"}</em>`}</button>`;
      }).join("")}</section>
      <section class="attendance-day-detail"><header><div><span>근무시작<b>${esc(formatTime(selected && selected.checkInAt))}</b></span><span>근무종료<b>${esc(formatTime(selected && selected.checkOutAt))}</b></span><span>총 근로시간<b>${esc(durationText(selectedMinutes))}</b></span><span>상세 근로시간<b>소정 ${esc(durationText(selectedMinutes))}</b></span></div>${statusPill(selected)}</header><div class="attendance-timeline-layout"><div class="attendance-timeline"><div class="attendance-hour-labels">${Array.from({ length: 24 }, (_, hour) => `<span>${String(hour).padStart(2, "0")}</span>`).join("")}</div><div class="attendance-hour-grid">${Array.from({ length: 24 }, () => "<i></i>").join("")}${selected ? `<b class="attendance-work-bar" style="left:${barLeft}%;width:${barWidth}%">업무시간</b>` : ""}</div><footer><span><i></i>정상</span><span><i></i>근태이상</span><span><i></i>수정</span></footer></div><aside><h4>근무상태 내역</h4><small>${esc(selectedDate)}</small>${selected ? `<dl><dt>출근</dt><dd>${esc(formatTime(selected.checkInAt))}</dd>${selected.checkOutAt ? `<dt>퇴근</dt><dd>${esc(formatTime(selected.checkOutAt))}</dd>` : ""}<dt>상태</dt><dd>${Core.attendanceReviewStatus(selected, Core.attendanceWorkDate())}</dd></dl>` : `<p>이 날짜의 근태 기록이 없습니다.</p>`}</aside></div></section>
      <section class="office-panel attendance-recent-panel"><header><div><span>ATTENDANCE HISTORY</span><h3>최근 근태 기록</h3></div><small>최근 30개 기록</small></header>${attendanceRows(records.slice(0, 30), false)}</section>`;
  }

  function displayNameEditor(user, surface) {
    if (!user
      || !isAdmin()
      || state.editingDisplayNameUserId !== user.uid
      || state.displayNameEditSurface !== surface) return "";
    const inputId = `officeDisplayName-${surface}`;
    const label = surface === "attendance" ? "전체 화면에 표시할 직원 이름" : "선택한 구성원의 표시 이름";
    return `<form class="office-display-name-editor ${"attendance"}" data-office-display-name-form data-office-display-name-surface="${esc(surface)}"><div class="office-display-name-copy"><label for="${esc(inputId)}">${label}</label><strong>수정 대상 · ${esc(Core.displayName(user))}${user.email ? ` · ${esc(user.email)}` : ""}</strong><span>전체 근태관리와 구성원 정보에 같은 이름으로 표시됩니다.</span></div><input id="${esc(inputId)}" name="displayName" type="text" maxlength="80" autocomplete="off" value="${esc(state.displayNameDraft)}" required><div><button type="button" data-office-display-name-cancel>취소</button><button type="submit" ${state.busy ? "disabled" : ""}>이름 저장</button></div></form>`;
  }

  function adminCalendar(summary, today) {
    const [year, month] = state.adminMonth.split("-").map(Number);
    const firstDay = new Date(Date.UTC(year, month - 1, 1));
    const leading = (firstDay.getUTCDay() + 6) % 7;
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const cellCount = Math.ceil((leading + daysInMonth) / 7) * 7;
    const records = new Map(summary.records.map(record => [record.workDate, record]));
    const labels = ["월", "화", "수", "목", "금", "토", "일"];
    const headers = labels.map((label, index) => `<span class="${index > 4 ? "weekend" : ""}">${label}</span>`).join("");
    const cells = Array.from({ length: cellCount }, (_, index) => {
      const day = index - leading + 1;
      if (day < 1 || day > daysInMonth) return `<article class="office-calendar-day outside" aria-hidden="true"></article>`;
      const workDate = `${state.adminMonth}-${String(day).padStart(2, "0")}`;
      const record = records.get(workDate) || null;
      const weekday = index % 7;
      const weekend = weekday > 4;
      const future = workDate > today;
      const reviewStatus = record ? Core.attendanceReviewStatus(record, today) : "";
      const statusKind = reviewStatus === "퇴근 미기록" ? "missing" : reviewStatus === "근무 중" ? "working" : reviewStatus === "퇴근 완료" ? "complete" : "";
      return `<article class="office-calendar-day ${weekend ? "weekend" : ""} ${workDate === today ? "today" : ""} ${statusKind}" data-office-calendar-date="${esc(workDate)}"><header><b>${day}</b>${reviewStatus ? `<span>${esc(reviewStatus)}</span>` : ""}</header>${record ? `<div class="office-calendar-times"><span>출근 <b>${esc(formatTime(record.checkInAt))}</b></span><span>퇴근 <b>${esc(formatTime(record.checkOutAt))}</b></span></div><footer>${record.checkOutAt ? esc(durationText(workedMinutes(record))) : reviewStatus === "퇴근 미기록" ? "확인 필요" : "근무 중"}</footer>` : `<div class="office-calendar-empty">${future ? "" : weekend ? "휴일" : "기록 없음"}</div>`}</article>`;
    }).join("");
    return `<div class="office-admin-calendar"><div class="office-calendar-weekdays">${headers}</div><div class="office-calendar-grid">${cells}</div></div>`;
  }

  // 근태 기록에서 사람이 한 번 봐야 할 날을 골라 보여준다. 판정이 아니라
  // 확인 요청이다. 지각·결근은 이 데이터로 알 수 없어서 다루지 않는다.
  // (attendance-anomaly-core.js 의 머리말에 이유를 적어 뒀다.)
  function attendanceAnomalyPanel(userId) {
    const Anomaly = window.BringAttendanceAnomalyCore;
    if (!Anomaly) return "";
    const result = Anomaly.detect(state.data.attendance, {
      userId: userId || "",
      month: state.adminMonth,
      today: Core.attendanceWorkDate()
    });
    const scope = userId ? "이 직원" : "전체 직원";
    if (!result.sampleSize) {
      // 기록이 0건인 것과 이상이 0건인 것은 다르다. 문구로 구분한다.
      return `<section class="office-panel attendance-anomaly-panel"><header><div><span>ATTENDANCE REVIEW</span><h3>확인이 필요한 근태</h3></div><small>${esc(state.adminMonth)}</small></header><div class="attendance-anomaly-empty">${esc(scope)}의 이 달 근태 기록이 아직 없습니다.</div></section>`;
    }
    if (!result.findings.length) {
      return `<section class="office-panel attendance-anomaly-panel"><header><div><span>ATTENDANCE REVIEW</span><h3>확인이 필요한 근태</h3></div><small>${esc(state.adminMonth)} · 기록 ${result.sampleSize}건</small></header><div class="attendance-anomaly-empty">확인이 필요한 날이 없습니다.</div></section>`;
    }
    const nameOf = uid => {
      const user = state.data.users.find(item => item && item.uid === uid);
      return user ? Core.displayName(user) : "";
    };
    const items = result.findings.map(item => {
      const who = userId ? "" : nameOf(item.userId);
      return `<li class="attendance-anomaly-item ${esc(item.severity)}"><div><b>${esc(item.message)}</b>${who ? `<em>${esc(who)}</em>` : ""}</div><p>${esc(item.detail)}</p></li>`;
    }).join("");
    return `<section class="office-panel attendance-anomaly-panel"><header><div><span>ATTENDANCE REVIEW</span><h3>확인이 필요한 근태</h3><p>기록만 보고 고른 것이며, 위반 여부는 근로계약과 함께 사람이 판단합니다.</p></div><small>${esc(state.adminMonth)} · 기록 ${result.sampleSize}건 · 확인 ${result.findings.length}건</small></header><ul class="attendance-anomaly-list">${items}</ul></section>`;
  }

  function clearAdminAttendanceCorrection() {
    state.adminAttendanceCorrection = null;
  }

  function adminAttendanceCorrectionRecords(userId) {
    return Core.monthlyAttendance(state.data.attendance, userId, state.adminMonth)
      .filter(record => record.workDate <= Core.workDate() && record.attendanceSource !== "rfid");
  }

  function selectAdminAttendanceCorrectionRecord(workDate) {
    const records = adminAttendanceCorrectionRecords(state.selectedAdminUserId);
    const record = records.find(row => row.workDate === workDate) || null;
    if (!record) {
      clearAdminAttendanceCorrection();
      return null;
    }
    state.adminAttendanceCorrection = {
      userId: record.userId,
      workDate: record.workDate,
      checkInTime: Core.attendanceTimeInput(record.checkInAt),
      checkOutTime: Core.attendanceTimeInput(record.checkOutAt),
      reason: "",
      expectedUpdatedAt: record.updatedAt
    };
    return record;
  }

  function beginAdminAttendanceCorrection() {
    if (!isAdmin() || !state.selectedAdminUserId || state.busy) return;
    const record = adminAttendanceCorrectionRecords(state.selectedAdminUserId)[0] || null;
    if (!record) {
      notify("이 달에는 수정할 수 있는 기존 근태 기록이 없습니다.", "error");
      return;
    }
    state.editingDisplayNameUserId = "";
    state.displayNameEditSurface = "";
    state.displayNameDraft = "";
    selectAdminAttendanceCorrectionRecord(record.workDate);
    renderCurrent();
    document.querySelector("[data-office-attendance-correction-date]")?.focus();
  }

  function adminAttendanceCorrectionEditor(selectedUser) {
    const draft = state.adminAttendanceCorrection;
    if (!draft || draft.userId !== selectedUser.uid) return "";
    const records = adminAttendanceCorrectionRecords(selectedUser.uid);
    const record = records.find(row => row.workDate === draft.workDate) || null;
    if (!record) return "";
    const disabled = state.busy ? "disabled" : "";
    const options = records.map(row => `<option value="${esc(row.workDate)}" ${row.workDate === record.workDate ? "selected" : ""}>${esc(formatDate(row.workDate))} · 출근 ${esc(formatTime(row.checkInAt))} / 퇴근 ${esc(formatTime(row.checkOutAt))}</option>`).join("");
    return `<form class="office-attendance-correction" data-office-attendance-correction-form>
      <header><div><span>ATTENDANCE CORRECTION</span><h4>출근·퇴근 시간 수정</h4><p>기존 기록만 수정할 수 있으며, 변경 사유는 관리자 정정 이력에 남습니다.</p></div><button type="button" data-office-attendance-correction-cancel ${disabled} aria-label="시간 수정 취소">×</button></header>
      <div class="office-attendance-correction-fields">
        <label><span>근태 날짜</span><select name="workDate" data-office-attendance-correction-date ${disabled} required>${options}</select></label>
        <label><span>출근 시간</span><input name="checkInTime" type="time" step="60" value="${esc(draft.checkInTime)}" ${disabled} required></label>
        <label><span>퇴근 시간</span><input name="checkOutTime" type="time" step="60" value="${esc(draft.checkOutTime)}" ${record.checkOutAt ? "required" : ""} ${disabled}><small>${record.checkOutAt ? "퇴근 완료 기록은 비울 수 없습니다." : "퇴근 전이면 비워둘 수 있습니다."}</small></label>
        <label class="office-attendance-correction-reason"><span>수정 사유</span><textarea name="reason" rows="2" minlength="2" maxlength="300" placeholder="실제 확인한 사유를 2~300자로 입력하세요" ${disabled} required>${esc(draft.reason)}</textarea></label>
      </div>
      <footer><span>${esc(Core.displayName(selectedUser))} · ${esc(record.workDate)} 기록을 수정합니다.</span><div><button type="button" data-office-attendance-correction-cancel ${disabled}>취소</button><button type="submit" ${disabled}>${state.busy ? "저장 중…" : "시간 저장"}</button></div></footer>
    </form>`;
  }

  function adminTabs(selectedUser) {
    return `<nav class="office-admin-tabs" aria-label="전체 근태관리 탭"><button class="${state.adminTab === "list" ? "active" : ""}" data-office-admin-tab="list"><span class="office-tab-icon"><svg class="office-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 6.5h16M4 12h16M4 17.5h16"/></svg></span> 직원 목록</button>${selectedUser ? `<button class="${state.adminTab === "detail" ? "active" : ""}" data-office-admin-tab="detail"><span class="office-tab-icon"><svg class="office-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.2"/><path d="M12 7.4V12l3.2 1.9"/></svg></span> ${esc(Core.displayName(selectedUser))} 근태 <i aria-hidden="true">×</i></button>` : ""}</nav>`;
  }

  function adminView() {
    if (!isAdmin()) return `<section class="office-loading office-error"><span>!</span><b>관리자 전용 메뉴입니다</b><p>전체 근태관리 화면과 데이터는 지정된 근태 관리자만 볼 수 있습니다.</p></section>`;
    const rows = state.data.attendance.slice().sort((a, b) => `${b.workDate}${b.checkInAt}`.localeCompare(`${a.workDate}${a.checkInAt}`));
    const today = Core.attendanceWorkDate();
    const users = state.data.users.slice().sort((a, b) => Core.displayName(a).localeCompare(Core.displayName(b), "ko"));
    const selectedUser = users.find(user => user.uid === state.selectedAdminUserId) || null;
    const editingUser = users.find(user => user.uid === state.editingDisplayNameUserId) || null;
    const attendanceNameEditor = displayNameEditor(editingUser, "attendance");
    if (!selectedUser && state.adminTab === "detail") state.adminTab = "list";
    const hero = officeHero("전체 근태관리", "직원 이름과 월간 근태 기록을 한 곳에서 관리합니다", `<span class="office-admin-lock"><svg class="office-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="4.8" y="10.5" width="14.4" height="9.7" rx="2.4"/><path d="M8.2 10.5V7.8a3.8 3.8 0 0 1 7.6 0v2.7"/></svg> 관리자 전용</span><button class="secondary-button" data-office-refresh>새로고침</button>`);

    if (state.adminTab === "detail" && selectedUser) {
      const summary = Core.monthlyAttendanceSummary(rows, selectedUser.uid, state.adminMonth);
      const correctableRecords = summary.records.filter(record => record.workDate <= today && record.attendanceSource !== "rfid");
      const correctionEditor = adminAttendanceCorrectionEditor(selectedUser);
      return `${hero}${adminTabs(selectedUser)}${attendanceNameEditor}<section class="office-admin-detail office-admin-calendar-tab">
        <header class="office-admin-detail-head"><div class="office-admin-person">${avatar(selectedUser, "large")}<div><span>EMPLOYEE ATTENDANCE</span><h3>${esc(Core.displayName(selectedUser))}</h3><p>${esc(userMeta(selectedUser))}</p></div><div class="office-admin-person-actions"><button type="button" class="office-admin-name-button" aria-label="${esc(Core.displayName(selectedUser))} 이름 수정" data-office-display-name-edit="${esc(selectedUser.uid)}" data-office-display-name-surface="attendance" ${state.busy ? "disabled" : ""}>이름 수정</button><button type="button" class="office-admin-time-edit-button" data-office-attendance-correction-open ${state.busy || !correctableRecords.length ? "disabled" : ""} title="${correctableRecords.length ? "기존 근태 기록의 시간을 수정합니다." : "이 달에는 수정할 기존 기록이 없습니다."}">시간 수정</button></div></div><div class="office-admin-month-actions"><button data-office-admin-month="previous" aria-label="이전 달">‹</button><strong>${esc(state.adminMonth.replace("-", ". "))}</strong><button data-office-admin-month="next" aria-label="다음 달">›</button><button class="attendance-today-button" data-office-admin-month="today">이번 달</button><button class="office-excel-button" data-office-attendance-export ${state.busy ? "disabled" : ""}><span class="office-btn-icon"><svg class="office-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3.5v11"/><path d="m7.6 10.4 4.4 4.4 4.4-4.4"/><path d="M4.5 19.5h15"/></svg></span> 엑셀 다운로드</button></div></header>
        ${correctionEditor}
        <div class="office-admin-month-kpis"><article><span>출근 일수</span><b>${summary.attendedDays}<small>일</small></b></article><article><span>퇴근 완료</span><b>${summary.completedDays}<small>일</small></b></article><article class="${summary.missingCheckoutDays ? "warning" : ""}"><span>퇴근 미기록</span><b>${summary.missingCheckoutDays}<small>일</small></b></article><article><span>총 근무시간</span><b>${esc(durationText(summary.totalMinutes))}</b></article></div>
        ${adminCalendar(summary, today)}
        <footer class="office-admin-detail-note"><b>퇴근 미기록 처리 안내</b><span>과거 날짜에 출근 기록만 있고 퇴근 기록이 없으면 자동으로 ‘퇴근 미기록’으로 표시됩니다. 관리자가 실제 퇴근 시간을 확인한 뒤 정정하는 승인 흐름을 권장합니다.</span></footer>
      </section>
      ${attendanceAnomalyPanel(selectedUser.uid)}`;
    }

    const todayRows = rows.filter(row => row.workDate === today);
    const working = todayRows.filter(row => row.checkInAt && !row.checkOutAt).length;
    const completed = todayRows.filter(row => row.checkOutAt).length;
    const latestFor = uid => rows.find(row => row.userId === uid) || null;
    const employeeRows = users.map(user => {
      const summary = Core.monthlyAttendanceSummary(rows, user.uid, state.adminMonth);
      const latest = latestFor(user.uid);
      return `<tr class="office-admin-user-row"><td><div class="office-user-cell">${avatar(user, "small")}<span><b>${esc(Core.displayName(user))}</b><small>${esc(userMeta(user))}</small></span></div></td><td><b>${summary.attendedDays}일</b></td><td>${esc(formatTime(latest && latest.checkInAt))}</td><td>${esc(formatTime(latest && latest.checkOutAt))}</td><td>${latest ? `<span class="office-status ${Core.attendanceReviewStatus(latest, today) === "퇴근 미기록" ? "missing" : statusClass(latest)}"><i></i>${esc(Core.attendanceReviewStatus(latest, today))}</span>` : statusPill(null)}</td><td><div class="office-admin-row-actions"><button type="button" class="office-admin-name-button" aria-label="${esc(Core.displayName(user))} 이름 수정" data-office-display-name-edit="${esc(user.uid)}" data-office-display-name-surface="attendance" ${state.busy ? "disabled" : ""}>이름 수정</button><button type="button" class="office-admin-open-button" aria-label="${esc(Core.displayName(user))} 근태 보기" data-office-admin-user="${esc(user.uid)}">근태 보기 →</button></div></td></tr>`;
    }).join("");
    return `${hero}${adminTabs(selectedUser)}${attendanceNameEditor}<section class="office-admin-kpis"><article><span>오늘 출근</span><b>${todayRows.length}</b><small>명</small></article><article><span>현재 근무 중</span><b>${working}</b><small>명</small></article><article><span>퇴근 완료</span><b>${completed}</b><small>명</small></article><article><span>등록 직원</span><b>${state.data.users.length}</b><small>명</small></article></section>
      <section class="office-panel office-admin-users"><header><div><span>TEAM ATTENDANCE</span><h3>직원별 근태 기록</h3></div><small>${esc(state.adminMonth)} 기준 · 근태 보기 버튼으로 전용 탭 열기</small></header><div class="office-table-wrap"><table class="office-table"><thead><tr><th>직원</th><th>월 출근</th><th>최근 출근</th><th>최근 퇴근</th><th>최근 상태</th><th></th></tr></thead><tbody>${employeeRows}</tbody></table></div></section>
      ${attendanceAnomalyPanel("")}`;
  }

  // --- 연차 ---
  // 잔여를 확정 전에 말하지 않는 것이 이 화면의 핵심이다. leave-core 가
  // remainingDays 를 null 로 주면 숫자 대신 "관리자 확정 전" 이라고 쓴다.
  const Leave = () => window.BringLeaveCore;

  function leaveView() {
    const L = Leave();
    if (!L) return `<section class="office-loading office-error"><span>!</span><b>연차 모듈을 불러오지 못했습니다</b></section>`;
    const uid = currentUserId();
    const year = String(new Date().getFullYear());
    const all = state.data.leave || [];
    const grants = state.data.leaveGrants || [];
    // 연도를 안 맞추면 새해가 지난 뒤 작년 확정을 올해 잔여로 쓰게 된다.
    const myGrant = grants.find(item => item && item.userId === uid && String(item.year) === year) || null;
    const balance = L.summarizeBalance({ userId: uid, year, grant: myGrant, requests: all });
    const mine = all
      .map(L.normalizeRequest)
      .filter(item => item.userId === uid)
      .sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)));

    // 확정 전에는 숫자를 지어내지 않는다. 0 으로 두면 "다 썼다"로 읽힌다.
    const remaining = balance.confirmed ? String(balance.remainingDays) : "—";
    const grantNote = balance.confirmed
      ? "확정한 발생일수에서 사용·신청 중인 날을 뺀 값입니다"
      : "올해 발생일수를 관리자가 아직 확정하지 않았습니다. 신청은 지금도 할 수 있습니다.";

    const rowsHtml = mine.map(item => {
      const type = (L.LEAVE_TYPES.find(entry => entry.key === item.type) || {}).label || item.type;
      const status = (L.STATUSES.find(entry => entry.key === item.status) || {}).label || item.status;
      const range = item.startDate === item.endDate ? item.startDate : `${item.startDate} ~ ${item.endDate}`;
      return `<tr>
        <td><b>${esc(range)}</b><small>${esc(type)}</small></td>
        <td><b>${item.days}일</b><small>${item.reason ? esc(item.reason) : "사유 없음"}</small></td>
        <td><span class="office-status ${leaveStatusClass(item.status)}"><i></i>${esc(status)}</span></td>
        <td>${item.decidedBy ? `<span class="office-muted">${esc(item.decidedBy)}</span>` : `<span class="office-muted">—</span>`}</td>
        <td>${item.status === "requested" ? `<button type="button" class="mini-button return" data-office-leave-cancel="${esc(item.id)}">취소</button>` : ""}</td>
      </tr>`;
    }).join("");

    return `${officeHero("연차", "신청·승인과 남은 일수를 한 곳에서 봅니다", state.data.leaveAdmin ? `<span class="office-admin-lock">대표 전용</span>` : "")}
      <section class="office-admin-kpis">
        <article><span>${esc(year)}년 발생</span><b>${balance.confirmed ? balance.grantedDays : "—"}</b><small>${balance.confirmed ? "일" : "확정 전"}</small></article>
        <article><span>사용</span><b>${balance.usedDays}</b><small>일</small></article>
        <article><span>신청 중</span><b>${balance.pendingDays}</b><small>일</small></article>
        <article><span>남음</span><b>${esc(remaining)}</b><small>일</small></article>
      </section>
      <section class="office-panel">
        <header><div><span>REQUEST LEAVE</span><h3>휴가 신청</h3></div><small>${esc(grantNote)}</small></header>
        <form class="office-form-grid" data-office-leave-form>
          <label><span>종류</span><select name="type">${L.LEAVE_TYPES.map(item => `<option value="${esc(item.key)}">${esc(item.label)}</option>`).join("")}</select></label>
          <label><span>시작일</span><input type="date" name="startDate" required${dateBounds()}></label>
          <label><span>종료일</span><input type="date" name="endDate" required${dateBounds()}></label>
          <label><span>일수</span><input type="number" name="days" min="0.5" step="0.5" placeholder="비우면 기간대로"></label>
          <label class="wide"><span>사유</span><input type="text" name="reason" maxlength="200" placeholder="선택"></label>
          <div class="office-form-actions"><button class="primary-button" type="submit"${state.busy ? " disabled" : ""}>휴가 신청</button></div>
        </form>
      </section>
      <section class="office-panel">
        <header><div><span>MY LEAVE</span><h3>내 신청 내역</h3></div><small>${mine.length}건</small></header>
        ${rowsHtml
          ? `<div class="office-table-wrap"><table class="office-table">
              <thead><tr><th>기간</th><th>일수·사유</th><th>상태</th><th>정한 사람</th><th></th></tr></thead>
              <tbody>${rowsHtml}</tbody>
            </table></div>`
          : `<div class="office-empty"><b>아직 신청한 휴가가 없습니다</b><span>위에서 기간을 골라 신청하면 여기에 쌓입니다.</span></div>`}
      </section>
      ${state.data.leaveAdmin ? leaveAdminPanel(L, all, grants) : ""}`;
  }

  // 승인 대기는 노랑, 승인은 초록, 반려·취소는 회색. 근태의 색과 같게 둔다 —
  // 화면마다 같은 뜻에 다른 색을 쓰면 사람이 색을 안 믿는다.
  function leaveStatusClass(status) {
    if (status === "approved") return "working";
    if (status === "requested") return "warn";
    return "off";
  }

  function leaveAdminPanel(L, all, grants) {
    const pending = all
      .map(L.normalizeRequest)
      .filter(item => item.status === "requested")
      .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
    const userOf = uid => state.data.users.find(item => item && item.uid === uid) || { uid, displayName: uid };

    const pendingRows = pending.map(item => {
      const user = userOf(item.userId);
      const type = (L.LEAVE_TYPES.find(entry => entry.key === item.type) || {}).label || item.type;
      const range = item.startDate === item.endDate ? item.startDate : `${item.startDate} ~ ${item.endDate}`;
      return `<tr>
        <td><div class="office-user-cell">${avatar(user, "small")}<span><b>${esc(Core.displayName(user))}</b><small>${esc(userMeta(user))}</small></span></div></td>
        <td><b>${esc(range)}</b><small>${esc(type)}</small></td>
        <td><b>${item.days}일</b><small>${item.reason ? esc(item.reason) : "사유 없음"}</small></td>
        <td class="office-leave-actions">
          <button type="button" class="mini-button" data-office-leave-decide="approved" data-office-leave-user="${esc(item.userId)}" data-office-leave-id="${esc(item.id)}">승인</button>
          <button type="button" class="mini-button return" data-office-leave-decide="rejected" data-office-leave-user="${esc(item.userId)}" data-office-leave-id="${esc(item.id)}">반려</button>
        </td>
      </tr>`;
    }).join("");

    // 발생일수 확정. 입사일을 모르면 제안도 못 한다 — 그때는 그렇게 적는다.
    const year = String(new Date().getFullYear());
    const grantRows = state.data.users.map(user => {
      const confirmed = grants.find(item => item && item.userId === user.uid && String(item.year) === year) || null;
      // 입사일은 인사기록에서 온다. normalizeUser 는 hireDate 를 들고
      // 오지 않아서 여기 제안 칸이 그동안 늘 비어 있었다.
      const record = memberRecordOf(user.uid);
      const hireDate = String((record && record.hireDate) || user.hireDate || "");
      const suggestion = hireDate ? L.suggestGrant(hireDate, Core.workDate()) : null;
      const hint = suggestion
        ? `제안 ${suggestion.days}일 · ${esc(suggestion.basis)}${suggestion.caveat ? " ⚠" : ""}`
        : "입사일이 없어 제안할 수 없습니다";
      return `<tr>
        <td><div class="office-user-cell">${avatar(user, "small")}<span><b>${esc(Core.displayName(user))}</b><small>${esc(userMeta(user))}</small></span></div></td>
        <td>${confirmed
          ? `<span class="office-status on"><i></i>${confirmed.days}일</span>`
          : `<span class="office-status off"><i></i>미확정</span>`}</td>
        <td><span class="office-muted">${hint}</span></td>
        <td><form class="office-leave-grant" data-office-leave-grant="${esc(user.uid)}"><input type="number" name="days" min="0" max="40" step="0.5" value="${confirmed ? esc(String(confirmed.days)) : (suggestion ? esc(String(suggestion.days)) : "")}" required><button class="mini-button" type="submit">확정</button></form></td>
      </tr>`;
    }).join("");

    return `<section class="office-panel">
        <header><div><span>APPROVALS</span><h3>승인 대기</h3></div><small>${pending.length}건</small></header>
        ${pendingRows
          ? `<div class="office-table-wrap"><table class="office-table">
              <thead><tr><th>직원</th><th>기간</th><th>일수·사유</th><th></th></tr></thead>
              <tbody>${pendingRows}</tbody>
            </table></div>`
          : `<div class="office-empty"><b>승인을 기다리는 신청이 없습니다</b><span>신청이 올라오면 여기에서 승인하거나 반려합니다.</span></div>`}
      </section>
      <section class="office-panel">
        <header><div><span>ANNUAL GRANT</span><h3>${esc(year)}년 발생일수 확정</h3></div><small>확정한 값이 잔여의 기준이 됩니다</small></header>
        <div class="office-table-wrap"><table class="office-table">
          <thead><tr><th>직원</th><th>확정</th><th>법정 제안</th><th></th></tr></thead>
          <tbody>${grantRows || `<tr><td colspan="4" class="office-muted">팀원이 없습니다.</td></tr>`}</tbody>
        </table></div>
        <p class="office-leave-note">법정 제안은 입사일만 보고 계산한 값입니다. 개근 여부와 회사 규정은 반영되지 않습니다.</p>
      </section>`;
  }

  async function submitLeaveRequest(form) {
    const L = Leave();
    if (!L || state.busy) return;
    const raw = Object.fromEntries(new FormData(form).entries());
    const request = {
      id: `lv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      userId: currentUserId(),
      type: String(raw.type || "annual"),
      startDate: String(raw.startDate || ""),
      endDate: String(raw.endDate || raw.startDate || ""),
      days: raw.days ? Number(raw.days) : 0,
      reason: String(raw.reason || ""),
      status: "requested",
      createdAt: new Date().toISOString(),
    };
    const year = request.startDate.slice(0, 4);
    const grant = (state.data.leaveGrants || []).find(item => item && item.userId === request.userId && String(item.year) === year) || null;
    // 서버에 보내기 전에 여기서 걸러야 사람이 이유를 알 수 있는 문구를 받는다.
    const checked = L.validateRequest({ request, requests: state.data.leave || [], grant, year });
    if (!checked.ok) { notify(checked.error, "error"); return; }
    state.busy = true;
    renderCurrent();
    try {
      await window.bringCRM.saveLeaveRequest(checked.record);
      notify("휴가를 신청했습니다.", "success");
      await load(true);
    } catch (error) {
      notify(error && error.message || "휴가를 신청하지 못했습니다.", "error");
    } finally {
      state.busy = false;
      renderCurrent();
    }
  }

  async function decideLeave(userId, requestId, decision) {
    const L = Leave();
    if (!L || state.busy) return;
    const request = (state.data.leave || [])
      .map(L.normalizeRequest)
      .find(item => item.userId === userId && item.id === requestId);
    if (!request) { notify("신청을 찾지 못했습니다.", "error"); return; }
    state.busy = true;
    renderCurrent();
    try {
      await window.bringCRM.decideLeaveRequest({ request, decision });
      notify(decision === "approved" ? "휴가를 승인했습니다." : "휴가를 반려했습니다.", "success");
      await load(true);
    } catch (error) {
      notify(error && error.message || "처리하지 못했습니다.", "error");
    } finally {
      state.busy = false;
      renderCurrent();
    }
  }

  async function cancelLeave(requestId) {
    const L = Leave();
    if (!L || state.busy) return;
    const request = (state.data.leave || [])
      .map(L.normalizeRequest)
      .find(item => item.userId === currentUserId() && item.id === requestId);
    if (!request) return;
    state.busy = true;
    renderCurrent();
    try {
      await window.bringCRM.saveLeaveRequest(Object.assign({}, request, { status: "cancelled" }));
      notify("휴가 신청을 취소했습니다.", "success");
      await load(true);
    } catch (error) {
      notify(error && error.message || "취소하지 못했습니다.", "error");
    } finally {
      state.busy = false;
      renderCurrent();
    }
  }

  async function saveLeaveGrant(form, userId) {
    if (state.busy) return;
    const raw = Object.fromEntries(new FormData(form).entries());
    state.busy = true;
    renderCurrent();
    try {
      await window.bringCRM.saveLeaveGrant({
        userId,
        year: String(new Date().getFullYear()),
        days: Number(raw.days),
      });
      notify("발생일수를 확정했습니다.", "success");
      await load(true);
    } catch (error) {
      notify(error && error.message || "확정하지 못했습니다.", "error");
    } finally {
      state.busy = false;
      renderCurrent();
    }
  }

  // --- 인사기록 ---
  // 구성원 기본 정보를 관리한다. 그래서 비어
  // 있는 칸을 조용히 넘기지 않고, 법으로 걸리는 것과 그냥 안 채운 것을
  // 갈라서 보여 준다. 다 똑같이 빨갛게 칠하면 무엇부터 채울지 알 수 없다.
  const Hr = () => window.BringHrCore;

  function memberRecordOf(uid) {
    const H = Hr();
    if (!H) return null;
    return H.findRecord(state.data.members || [], uid);
  }

  function membersView() {
    const H = Hr();
    if (!H) return `<section class="office-loading office-error"><span>!</span><b>인사기록 모듈을 불러오지 못했습니다</b></section>`;
    const today = Core.workDate();
    if (!state.data.memberAdmin) return myRecordView(H, today);

    const people = state.data.users.slice().sort((a, b) => Core.displayName(a).localeCompare(Core.displayName(b), "ko"));
    const selected = state.selectedMemberId && people.some(user => user.uid === state.selectedMemberId)
      ? state.selectedMemberId
      : (people[0] ? people[0].uid : "");
    const todo = H.alerts(state.data.members || [], today);
    const hired = people.filter(user => (memberRecordOf(user.uid) || {}).hireDate).length;
    const filled = people.filter(user => {
      const record = memberRecordOf(user.uid);
      return record && !H.checklist(record, today).some(item => item.level === "required");
    }).length;

    const rows = people.map(user => {
      const record = memberRecordOf(user.uid);
      const status = H.statusOf(record || { userId: user.uid }, today);
      const missing = H.checklist(record || { userId: user.uid }, today).filter(item => item.level === "required").length;
      const label = { active: "재직", resigned: "퇴사", scheduled: "입사 예정", unknown: "미등록" }[status] || status;
      return `<tr class="office-admin-user-row${user.uid === selected ? " is-selected" : ""}">
        <td><div class="office-user-cell">${avatar(user, "small")}<span><b>${esc(Core.displayName(user))}</b><small>${esc(userMeta(user))}</small></span></div></td>
        <td>${record && record.hireDate ? `<b>${esc(record.hireDate)}</b>` : `<em class="office-muted">없음</em>`}</td>
        <td>${esc((H.typeOf(record && record.employmentType) || {}).label || "—")}</td>
        <td><span class="office-status ${status === "resigned" ? "off" : (missing ? "warn" : "on")}"><i></i>${esc(label)}</span></td>
        <td>${missing ? `<span class="office-need">${missing}건</span>` : `<span class="office-muted">—</span>`}</td>
        <td><button type="button" class="mini-button" data-office-hr-select="${esc(user.uid)}">기록 열기</button></td>
      </tr>`;
    }).join("");

    const selectedUser = people.find(user => user.uid === selected) || null;
    return `${officeHero("인사기록", "입사일·계약형태·근로계약서를 한 곳에서 관리합니다", `<span class="office-admin-lock">대표 전용</span>`)}
      <section class="office-admin-kpis">
        <article><span>등록 직원</span><b>${people.length}</b><small>명</small></article>
        <article><span>입사일 있음</span><b>${hired}</b><small>명</small></article>
        <article><span>기록 완비</span><b>${filled}</b><small>명</small></article>
        <article><span>채워야 할 것</span><b>${todo.length}</b><small>건</small></article>
      </section>
      <section class="office-panel office-admin-users">
        <header><div><span>TEAM RECORDS</span><h3>직원별 인사기록</h3></div><small>주민등록번호·계좌번호는 적지 마세요. 저장되지 않습니다.</small></header>
        <div class="office-table-wrap"><table class="office-table">
          <thead><tr><th>직원</th><th>입사일</th><th>계약형태</th><th>상태</th><th>채워야 할 것</th><th></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="6" class="office-muted">팀원이 없습니다.</td></tr>`}</tbody>
        </table></div>
      </section>
      ${selectedUser ? memberForm(H, selectedUser, today) : ""}`;
  }

  // 본인 화면. 고칠 수는 없고, 회사가 무엇을 들고 있는지 보여 준다.
  // 무엇이 비어 있는지도 본인이 알아야 채워 달라고 말할 수 있다.
  function myRecordView(H, today) {
    const record = memberRecordOf(currentUserId());
    const hero = officeHero("내 인사기록", "회사가 들고 있는 내 기록입니다. 고치려면 대표에게 말씀해 주세요", "");
    if (!record) {
      return `${hero}<div class="office-empty"><b>아직 등록된 인사기록이 없습니다</b><span>대표에게 등록을 요청해 주세요.</span></div>`;
    }
    const type = (H.typeOf(record.employmentType) || {}).label || "미정";
    const missing = H.checklist(record, today);
    const rows = [
      ["입사일", record.hireDate || "—"],
      ["계약형태", type],
      ["계약 종료일", record.contractEndDate || "—"],
      ["부서·직책", [record.department, record.position].filter(Boolean).join(" · ") || "—"],
      ["근로계약서", record.contractFileUrl ? "보관됨" : "미보관"],
      ["4대보험 취득일", record.insuranceStartDate || "—"],
    ].map(([label, value]) => `<tr><th>${esc(label)}</th><td>${esc(String(value))}</td></tr>`).join("");
    return `${hero}
      <section class="office-panel">
        <header><div><span>MY RECORD</span><h3>${esc(today)} 기준</h3></div></header>
        <div class="office-table-wrap"><table class="office-table office-hr-mine"><tbody>${rows}</tbody></table></div>
      </section>
      ${missing.length ? `<section class="office-panel"><header><div><span>TO FILL</span><h3>비어 있는 항목</h3></div><small>대표가 채웁니다</small></header>
        <ul class="office-hr-checklist">${missing.map(item => `<li class="level-${esc(item.level)}"><b>${esc(item.label)}</b>${item.why ? `<small>${esc(item.why)}</small>` : ""}</li>`).join("")}</ul></section>` : ""}`;
  }

  function memberForm(H, user, today) {
    const record = memberRecordOf(user.uid) || H.normalizeRecord({ userId: user.uid });
    const checklist = H.checklist(record, today);
    const field = (name, label, type, extra) => `<label><span>${esc(label)}</span><input type="${type}" name="${esc(name)}" value="${esc(String(record[name] || ""))}"${type === "date" ? dateBounds() : ""}${extra || ""}></label>`;
    const types = H.EMPLOYMENT_TYPES.map(item => `<option value="${esc(item.key)}"${record.employmentType === item.key ? " selected" : ""}>${esc(item.label)}</option>`).join("");
    const suggestion = record.hireDate && window.BringLeaveCore
      ? window.BringLeaveCore.suggestGrant(record.hireDate, today)
      : null;
    return `<section class="office-panel">
      <header>
        <div><span>RECORD</span><h3>${esc(Core.displayName(user))}</h3></div>
        <small>${suggestion ? `올해 연차 제안 ${suggestion.days}일 · ${esc(suggestion.basis)}` : "입사일을 넣으면 연차 발생일수를 제안합니다"}</small>
      </header>
      ${checklist.length ? `<ul class="office-hr-checklist">${checklist.map(item => `<li class="level-${esc(item.level)}"><b>${esc(item.label)}</b>${item.why ? `<small>${esc(item.why)}</small>` : ""}</li>`).join("")}</ul>` : `<p class="office-hr-ok">비어 있는 항목이 없습니다.</p>`}
      <form class="office-form-grid" data-office-hr-form="${esc(user.uid)}">
        ${field("hireDate", "입사일", "date")}
        <label><span>계약형태</span><select name="employmentType"><option value="">선택</option>${types}</select></label>
        ${field("contractEndDate", "계약 종료일", "date")}
        ${field("department", "부서", "text", ' maxlength="60"')}
        ${field("position", "직책", "text", ' maxlength="60"')}
        ${field("phone", "연락처", "text", ' maxlength="40"')}
        ${field("emergencyContact", "비상연락처", "text", ' maxlength="120"')}
        ${field("contractSignedDate", "근로계약서 체결일", "date")}
        ${field("insuranceStartDate", "4대보험 취득일", "date")}
        ${field("resignedDate", "퇴사일", "date")}
        <label class="wide"><span>근로계약서 보관 위치</span><input type="url" name="contractFileUrl" value="${esc(record.contractFileUrl)}" maxlength="500" placeholder="https://drive.google.com/..."></label>
        <label class="wide"><span>비고</span><input type="text" name="note" value="${esc(record.note)}" maxlength="500"></label>
        <div class="office-form-actions"><button class="primary-button" type="submit"${state.busy ? " disabled" : ""}>저장</button></div>
      </form>
    </section>`;
  }

  async function saveMemberRecord(form, userId) {
    const H = Hr();
    if (!H || state.busy) return;
    const raw = Object.fromEntries(new FormData(form).entries());
    const checked = H.validateRecord(Object.assign({}, raw, { userId }));
    // 서버에 보내기 전에 여기서 걸러야 사람이 이유를 알 수 있는 문구를 받는다.
    if (!checked.ok) { notify(checked.error, "error"); return; }
    state.busy = true;
    renderCurrent();
    try {
      await window.bringCRM.saveMemberRecord(checked.record);
      notify("인사기록을 저장했습니다.", "success");
      await load(true);
    } catch (error) {
      notify(error && error.message || "저장하지 못했습니다.", "error");
    } finally {
      state.busy = false;
      renderCurrent();
    }
  }

  // --- 직원 카드 등록 ---
  function rfidRegistrationFor(userId) {
    return Rfid ? Rfid.registeredForUser(state.data.rfidCards, userId) : null;
  }

  function rfidRegisteredDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("ko-KR", {
      timeZone: Core.KOREA_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }

  function rfidView() {
    if (!isAdmin() || !state.data.rfidAdmin) {
      return `${officeHero("직원 카드 등록", "직원별 RFID 카드를 등록·교체·해제합니다", "")}
        <section class="rfid-access-denied"><b>근태 관리자만 사용할 수 있습니다.</b><span>권한이 필요한 경우 CRM 관리자에게 문의해 주세요.</span></section>`;
    }
    const people = state.data.users.filter(user => user && user.uid);
    if (!people.some(user => user.uid === state.selectedRfidUserId)) state.selectedRfidUserId = people[0]?.uid || "";
    const selected = userById(state.selectedRfidUserId) || null;
    const selectedCard = selected ? rfidRegistrationFor(selected.uid) : null;
    const capture = state.rfidCapture;
    const feedback = !capture ? state.rfidCaptureFeedback : null;
    const options = people.map(user => `<option value="${esc(user.uid)}"${user.uid === state.selectedRfidUserId ? " selected" : ""}>${esc(Core.displayName(user))} · ${esc(userMeta(user))}</option>`).join("");
    const readerOptions = state.rfidReaderPorts.map(port => {
      const deviceName = port.cp210x ? "Silicon Labs CP210x" : port.manufacturer || "시리얼 리더기";
      return `<option value="${esc(port.path)}"${port.path === state.rfidReaderPortPath ? " selected" : ""}>${esc(port.path)} · ${esc(deviceName)}</option>`;
    }).join("");
    const readerStatus = state.rfidReaderPortsLoading
      ? "COM 포트를 검색하고 있습니다."
      : state.rfidReaderPortsError
        ? state.rfidReaderPortsError
        : state.rfidReaderPorts.length
          ? `리더기 포트 ${state.rfidReaderPorts.length}개 감지 · 선택한 포트를 등록에 사용합니다.`
          : "COM 리더기가 없습니다. USB 연결을 확인한 뒤 다시 검색해 주세요.";
    const rows = state.data.rfidCards.map(card => {
      const user = userById(card.userId);
      if (!user) return "";
      return `<tr>
        <td><div class="rfid-user-cell">${avatar(user, "small")}<span><b>${esc(Core.displayName(user))}</b><small>${esc(userMeta(user))}</small></span></div></td>
        <td><span class="rfid-mask">•••• ${esc(card.last4)}</span></td>
        <td>${esc(rfidRegisteredDate(card.registeredAt))}</td>
        <td><button type="button" class="mini-button danger" data-rfid-remove="${esc(user.uid)}"${state.busy || capture ? " disabled" : ""}>카드 해제</button></td>
      </tr>`;
    }).join("");
    const status = selectedCard
      ? `<span class="rfid-current is-registered"><i></i><b>등록됨</b><em>카드 •••• ${esc(selectedCard.last4)}</em></span>`
      : `<span class="rfid-current"><i></i><b>등록 없음</b><em>새 카드를 태그해 주세요</em></span>`;
    const feedbackPanel = feedback
      ? `<div class="rfid-capture-feedback is-${["success", "pending"].includes(feedback.tone) ? feedback.tone : "error"}" role="status" aria-live="polite"><b>${esc(feedback.title)}</b><small>${esc(feedback.detail)}</small></div>`
      : "";
    const registrationPanel = capture
      ? `<div class="rfid-capture" role="status" aria-live="polite">
          <span class="rfid-waves" aria-hidden="true">)))</span>
          <div><b data-rfid-capture-status>리더기 입력 대기 중 · ${esc(capture.portPath)}</b><small data-rfid-capture-detail>15초 안에 카드를 태그하세요. 카드번호는 화면이나 로그에 표시되지 않습니다.</small></div>
          <button type="button" class="secondary-button" data-rfid-cancel>취소</button>
        </div>`
      : `${feedbackPanel}<div class="rfid-register-actions">
          <div>${status}</div>
          <button type="button" class="primary-button" data-rfid-capture${!selected || state.busy || !state.rfidReaderPortPath || state.rfidReaderPortsLoading ? " disabled" : ""}>${selectedCard ? "카드 교체 시작" : "카드 등록 시작"}</button>
        </div>`;
    return `${officeHero("직원 카드 등록", "직원별 RFID 카드를 등록·교체·해제합니다", `<span class="office-admin-lock">관리자 전용</span><button class="secondary-button" data-office-refresh${state.busy || capture ? " disabled" : ""}>새로고침</button>`)}
      <section class="rfid-layout">
        <article class="rfid-registration-panel">
          <header><span>01</span><div><h3>직원과 카드 연결</h3><p>직원을 선택한 뒤 리더기에 새 카드를 태그하세요.</p></div></header>
          <label class="rfid-employee-select"><span>직원 선택</span><select data-rfid-user${state.busy || capture ? " disabled" : ""}>${options}</select></label>
          <div class="rfid-serial-picker"><label><span>시리얼 리더기 포트</span><select data-rfid-port${state.busy || capture || state.rfidReaderPortsLoading || !state.rfidReaderPorts.length ? " disabled" : ""}>${readerOptions || `<option value="">${state.rfidReaderPortsLoading ? "검색 중…" : "감지된 COM 포트 없음"}</option>`}</select></label><button type="button" class="secondary-button" data-rfid-reader-refresh${state.busy || capture || state.rfidReaderPortsLoading ? " disabled" : ""}>다시 검색</button></div>
          <small class="rfid-serial-status" role="status" aria-live="polite">${esc(readerStatus)} <span>9600bps · 8-N-1 · 하드웨어 흐름제어</span></small>
          ${registrationPanel}
          <aside class="rfid-security-note"><b>카드번호 보호</b><span>CRM에는 카드번호 원문을 저장하지 않습니다. 중복 확인용 단방향 지문과 끝 4자리만 보관합니다.</span></aside>
        </article>
        <article class="rfid-reader-guide">
          <span>USB</span><h3>CR100 리더기 준비</h3><ol><li>USB 리더기를 PC에 연결합니다.</li><li>직원을 선택하고 등록 시작을 누릅니다.</li><li>리더기에 카드를 한 번 태그합니다.</li></ol>
          <p class="rfid-reader-detected">${state.rfidReaderPortPath ? `${esc(state.rfidReaderPortPath)} 포트로 연결합니다.` : "드라이버가 설치된 COM 포트를 검색해 주세요."}</p>
        </article>
      </section>
      <section class="rfid-list-panel">
        <header><div><span>REGISTERED CARDS</span><h3>등록된 직원 카드</h3></div><b>${state.data.rfidCards.length}장</b></header>
        <div class="office-table-wrap"><table class="office-table"><thead><tr><th>직원</th><th>카드</th><th>등록일</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="4" class="office-muted">아직 등록된 카드가 없습니다.</td></tr>`}</tbody></table></div>
      </section>
      <p class="rfid-phase-note">현재는 직원 카드 등록·교체·해제만 사용할 수 있습니다. 카드 태그 출퇴근 저장은 다음 단계에서 연결합니다.</p>`;
  }

  function clearRfidCapture(shouldRender) {
    const capture = state.rfidCapture;
    state.rfidCapture = null;
    if (capture && state.context?.api?.cancelOfficeRfidSerialCapture) {
      void state.context.api.cancelOfficeRfidSerialCapture().catch(() => {});
    }
    if (capture) state.busy = false;
    if (shouldRender && officeIsActive() && state.context?.view === "officeRfid") renderCurrent();
  }

  async function refreshRfidPorts() {
    if (!isAdmin() || !state.data.rfidAdmin || state.rfidReaderPortsLoading || state.rfidCapture) return;
    const context = state.context;
    state.rfidReaderPortsLoading = true;
    state.rfidReaderPortsError = "";
    renderCurrent();
    try {
      const result = await context.api.listOfficeRfidPorts();
      if (!result || result.ok === false || !Array.isArray(result.ports)) throw new Error("reader list unavailable");
      const ports = result.ports.filter(port => port && typeof port.path === "string" && /^COM[1-9]\d{0,2}$/.test(port.path));
      state.rfidReaderPorts = ports;
      if (!ports.some(port => port.path === state.rfidReaderPortPath)) {
        state.rfidReaderPortPath = (ports.find(port => port.cp210x) || ports[0] || {}).path || "";
      }
    } catch {
      state.rfidReaderPorts = [];
      state.rfidReaderPortPath = "";
      state.rfidReaderPortsError = "리더기 포트를 확인하지 못했습니다. USB 연결을 확인하고 다시 검색해 주세요.";
    } finally {
      state.rfidReaderPortsLoading = false;
      if (state.context === context && state.context?.view === "officeRfid") {
        state.rfidReaderPortsLoaded = true;
        renderCurrent();
      }
    }
  }

  async function beginRfidCapture() {
    if (!Rfid || !isAdmin() || !state.data.rfidAdmin || state.busy || state.rfidCapture || !state.selectedRfidUserId) return;
    if (!state.rfidReaderPortPath || !state.rfidReaderPorts.some(port => port.path === state.rfidReaderPortPath)) {
      state.rfidCaptureFeedback = {
        tone: "error",
        title: "시리얼 리더기를 찾지 못했어요",
        detail: "USB 연결과 장치 관리자에 표시되는 COM 포트를 확인한 뒤 다시 검색해 주세요.",
      };
      renderCurrent();
      return;
    }
    state.rfidCaptureFeedback = null;
    const capture = { userId: state.selectedRfidUserId, portPath: state.rfidReaderPortPath };
    state.rfidCapture = capture;
    state.busy = true;
    if (document.activeElement && typeof document.activeElement.blur === "function") document.activeElement.blur();
    renderCurrent();
    const dataRevision = state.dataRevision;
    try {
      const result = await state.context.api.captureOfficeRfidSerial({ userId: capture.userId, portPath: capture.portPath });
      if (state.rfidCapture !== capture) return;
      if (!result || result.ok === false) {
        const code = String(result && result.code || "");
        const detail = code === "RFID_SERIAL_PORT_BUSY"
          ? "다른 프로그램이 포트를 사용 중입니다. 하이퍼터미널 등 시리얼 프로그램을 닫고 다시 시도해 주세요."
          : code === "RFID_SERIAL_TIMEOUT"
            ? "15초 동안 카드 신호가 오지 않았습니다. 리더기 중앙에 카드를 다시 대 주세요."
            : code === "RFID_SERIAL_PORT_NOT_FOUND"
              ? "선택한 포트가 사라졌습니다. 리더기를 다시 연결하고 포트를 검색해 주세요."
              : code === "RFID_SERIAL_CANCELLED"
                ? "카드 등록을 취소했습니다."
                : "리더기 연결과 카드 형식을 확인한 뒤 다시 시도해 주세요.";
        state.rfidCaptureFeedback = { tone: "error", title: "카드 신호를 처리하지 못했어요", detail };
        notify(state.rfidCaptureFeedback.title, "error");
        return;
      }
      if (result.data) applyOfficeData(result.data, currentUser(), dataRevision);
      const registeredCard = rfidRegistrationFor(capture.userId);
      state.rfidCaptureFeedback = {
        tone: "success",
        title: "직원 카드 등록 완료",
        detail: registeredCard ? `카드 •••• ${registeredCard.last4}가 직원 계정에 연결됐습니다.` : "태그한 카드가 직원 계정에 연결됐습니다.",
      };
      notify("직원 카드를 등록했습니다.", "success");
    } catch {
      state.rfidCaptureFeedback = {
        tone: "error",
        title: "직원 카드 등록에 실패했어요",
        detail: "연결 또는 권한을 확인한 뒤 다시 태그해 주세요. 문제가 계속되면 관리자에게 문의해 주세요.",
      };
      notify("직원 카드 등록에 실패했습니다. 연결 상태와 권한을 확인해 주세요.", "error");
    } finally {
      if (state.rfidCapture === capture) {
        state.rfidCapture = null;
        state.busy = false;
        renderCurrent();
      }
    }
  }

  async function removeRfidCard(userId) {
    if (!Rfid || state.busy || state.rfidCapture) return;
    const user = userById(userId);
    const card = rfidRegistrationFor(userId);
    if (!user || !card || !window.confirm(`${Core.displayName(user)}님의 카드(•••• ${card.last4}) 연결을 해제할까요?`)) return;
    const dataRevision = state.dataRevision;
    state.busy = true;
    renderCurrent();
    try {
      const result = await state.context.api.removeOfficeRfidCard({ userId });
      if (!result || result.ok === false) throw new Error(result && result.error || "RFID 카드 연결을 해제하지 못했습니다.");
      applyOfficeData(result.data || await state.context.api.loadOffice(), currentUser(), dataRevision);
      notify("직원 카드 연결을 해제했습니다.", "success");
    } catch (error) {
      notify(error && error.message || "RFID 카드 연결을 해제하지 못했습니다.", "error");
    } finally {
      state.busy = false;
      renderCurrent();
    }
  }

  function renderCurrent() {
    if (!state.context || !state.context.container) return;
    syncOfficeRfidAttendance();
    if (!officeIsActive()) return;
    if (state.context.view === "officeRfid" && state.loaded && isAdmin() && state.data.rfidAdmin
      && !state.rfidReaderPortsLoaded && !state.rfidReaderPortsLoading) void refreshRfidPorts();
    if (state.context.view === "dashboard") {
      const widget = state.context.container.querySelector("[data-dashboard-attendance]");
      if (widget) widget.outerHTML = dashboardAttendanceView();
      requestAnimationFrame(updateClock);
      return;
    }
    if (state.loading && !state.loaded) state.context.container.innerHTML = loadingPanel();
    else if (state.error && !state.loaded) state.context.container.innerHTML = errorPanel();
    else {
      if (state.context.view === "officeHome") state.context.container.innerHTML = homeView();
      else if (state.context.view === "officeAttendance") state.context.container.innerHTML = attendanceView();
      else if (state.context.view === "officeRfid") state.context.container.innerHTML = rfidView();
      else if (state.context.view === "officeLeave") state.context.container.innerHTML = leaveView();
      else if (state.context.view === "officeMembers") state.context.container.innerHTML = membersView();
      else if (state.context.view === "officeAccountSetup") {
        const previousEmailInput = state.context.container.querySelector("[data-crm-account-invite-email]");
        const restoreEmailFocus = previousEmailInput && document.activeElement === previousEmailInput && !state.busy;
        state.context.container.innerHTML = crmAccountSetupView();
        const nextEmailInput = state.context.container.querySelector("[data-crm-account-invite-email]");
        if (previousEmailInput && nextEmailInput) {
          if (previousEmailInput.value !== state.crmAccountInviteEmailDraft) previousEmailInput.value = state.crmAccountInviteEmailDraft;
          previousEmailInput.disabled = nextEmailInput.disabled;
          nextEmailInput.replaceWith(previousEmailInput);
          if (restoreEmailFocus && !previousEmailInput.disabled) previousEmailInput.focus({ preventScroll: true });
        }
      }
      else state.context.container.innerHTML = adminView();
      requestAnimationFrame(() => {
        updateClock();
      });
    }
  }

  function beginDisplayNameEdit(userId, surface) {
    const targetUid = Core.normalizeOfficeUserId(userId);
    const target = userById(targetUid);
    const editSurface = "attendance";
    if (!isAdmin() || !target || state.busy) return;
    clearAdminAttendanceCorrection();
    state.editingDisplayNameUserId = target.uid;
    state.displayNameEditSurface = editSurface;
    state.displayNameDraft = Core.displayName(target);
    renderCurrent();
    const input = document.querySelector("[data-office-display-name-form] input");
    input?.focus();
    input?.select();
  }

  function cancelDisplayNameEdit() {
    state.editingDisplayNameUserId = "";
    state.displayNameEditSurface = "";
    state.displayNameDraft = "";
    renderCurrent();
  }

  async function saveDisplayName(value) {
    const targetUid = Core.normalizeOfficeUserId(state.editingDisplayNameUserId);
    const displayName = Core.normalizeOfficeDisplayName(value);
    const target = userById(targetUid);
    if (!isAdmin() || !targetUid || !target || state.busy) return;
    if (!displayName) {
      notify("직원 이름은 제어문자 없이 80자 이내로 입력해 주세요.", "error");
      return;
    }
    const dataRevision = state.dataRevision;
    state.busy = true;
    renderCurrent();
    try {
      const result = await state.context.api.saveOfficeDisplayName({ userId: targetUid, displayName });
      if (!result || result.ok === false) throw new Error(result && result.error || "직원 이름을 저장하지 못했습니다.");
      applyOfficeData(result.data || await state.context.api.loadOffice(), currentUser(), dataRevision);
      if (state.editingDisplayNameUserId === targetUid) {
        state.editingDisplayNameUserId = "";
        state.displayNameEditSurface = "";
        state.displayNameDraft = "";
      }
      notify("직원 이름을 저장했습니다. 전체 근태관리와 구성원 정보에 반영됩니다.", "success");
    } catch (error) {
      notify(error.message || "직원 이름을 저장하지 못했습니다.", "error");
    } finally {
      state.busy = false;
      renderCurrent();
      document.querySelector("[data-office-display-name-form] input")?.focus();
    }
  }

  async function saveAdminAttendanceCorrection(form) {
    if (!isAdmin() || !state.selectedAdminUserId || !state.adminAttendanceCorrection || state.busy) return;
    const values = new FormData(form);
    const workDate = String(values.get("workDate") || "");
    const checkInTime = String(values.get("checkInTime") || "");
    const checkOutTime = String(values.get("checkOutTime") || "");
    const reason = String(values.get("reason") || "");
    const record = adminAttendanceCorrectionRecords(state.selectedAdminUserId).find(row => row.workDate === workDate) || null;
    const requestId = window.crypto && typeof window.crypto.randomUUID === "function" ? window.crypto.randomUUID() : "";
    const validation = Core.validateAttendanceCorrectionRequest({
      userId: state.selectedAdminUserId,
      workDate,
      checkInTime,
      checkOutTime,
      reason,
      expectedUpdatedAt: state.adminAttendanceCorrection.expectedUpdatedAt || "",
      requestId
    }, record, Core.workDate());
    state.adminAttendanceCorrection = {
      userId: state.selectedAdminUserId,
      workDate,
      checkInTime,
      checkOutTime,
      reason,
      expectedUpdatedAt: state.adminAttendanceCorrection.expectedUpdatedAt || ""
    };
    if (!validation.ok) {
      notify(validation.error, "error");
      return;
    }
    const targetUserId = state.selectedAdminUserId;
    const targetMonth = state.adminMonth;
    const dataRevision = state.dataRevision;
    state.busy = true;
    renderCurrent();
    try {
      const result = await state.context.api.saveOfficeAttendanceCorrection(validation.value);
      if (!result || result.ok === false) throw new Error(result && result.error || "근태 시간을 수정하지 못했습니다.");
      applyOfficeData(result.data || await state.context.api.loadOffice(), currentUser(), dataRevision);
      if (state.selectedAdminUserId === targetUserId && state.adminMonth === targetMonth) clearAdminAttendanceCorrection();
      notify("근태 시간이 수정되고 정정 사유가 기록되었습니다.", "success");
    } catch (error) {
      notify(error.message || "근태 시간을 수정하지 못했습니다.", "error");
    } finally {
      state.busy = false;
      renderCurrent();
      document.querySelector("[data-office-attendance-correction-form] textarea")?.focus();
    }
  }

  async function exportAdminAttendance() {
    if (!isAdmin() || !state.selectedAdminUserId || state.busy) return;
    state.busy = true;
    renderCurrent();
    try {
      const result = await state.context.api.exportOfficeAttendance({ userId: state.selectedAdminUserId, month: state.adminMonth });
      if (result && result.canceled) return;
      if (!result || result.ok === false) throw new Error(result && result.error || "근태 엑셀을 저장하지 못했습니다.");
      notify("월별 근태 엑셀 파일을 저장했습니다.", "success");
    } catch (error) {
      notify(error.message || "근태 엑셀을 저장하지 못했습니다.", "error");
    } finally {
      state.busy = false;
      renderCurrent();
    }
  }

  document.addEventListener("click", event => {
    if (event.target.closest("[data-rfid-capture]")) { beginRfidCapture(); return; }
    if (event.target.closest("[data-rfid-cancel]")) { clearRfidCapture(true); return; }
    if (event.target.closest("[data-rfid-reader-refresh]")) {
      state.rfidReaderPortsLoaded = false;
      void refreshRfidPorts();
      return;
    }
    const rfidRemove = event.target.closest("[data-rfid-remove]");
    if (rfidRemove) { void removeRfidCard(rfidRemove.dataset.rfidRemove); return; }
    const leaveDecide = event.target.closest("[data-office-leave-decide]");
    if (leaveDecide) {
      void decideLeave(leaveDecide.dataset.officeLeaveUser, leaveDecide.dataset.officeLeaveId, leaveDecide.dataset.officeLeaveDecide);
      return;
    }
    const leaveCancel = event.target.closest("[data-office-leave-cancel]");
    if (leaveCancel) { void cancelLeave(leaveCancel.dataset.officeLeaveCancel); return; }
    const hrSelect = event.target.closest("[data-office-hr-select]");
    if (hrSelect) { state.selectedMemberId = hrSelect.dataset.officeHrSelect; renderCurrent(); return; }
    const go = event.target.closest("[data-office-go]");
    if (go) {
      document.querySelector(`[data-view="${go.dataset.officeGo}"]`)?.click();
      return;
    }
    const week = event.target.closest("[data-office-week]");
    if (week) {
      if (week.dataset.officeWeek === "today") state.attendanceWeekOffset = 0;
      else state.attendanceWeekOffset += week.dataset.officeWeek === "previous" ? -1 : 1;
      const nextStart = addDays(startOfWeek(Core.attendanceWorkDate()), state.attendanceWeekOffset * 7);
      state.selectedAttendanceDate = state.attendanceWeekOffset === 0 ? Core.attendanceWorkDate() : nextStart;
      renderCurrent();
      return;
    }
    const attendanceDate = event.target.closest("[data-office-date-select]");
    if (attendanceDate) {
      state.selectedAttendanceDate = attendanceDate.dataset.officeDateSelect;
      renderCurrent();
      return;
    }
    const refresh = event.target.closest("[data-office-refresh]");
    if (refresh) { load(true); return; }
    if (event.target.closest("[data-crm-account-refresh]")) { void refreshCrmAccountInvites(); return; }
    const resendAccount = event.target.closest("[data-crm-account-resend]");
    if (resendAccount) { void resendCrmAccountInvite(resendAccount.dataset.crmAccountResend); return; }
    const archiveAccount = event.target.closest("[data-crm-account-archive]");
    if (archiveAccount) { void archiveCrmAccountInvite(archiveAccount.dataset.crmAccountArchive); return; }
    const deleteAccount = event.target.closest("[data-crm-account-delete]");
    if (deleteAccount) { void manageCrmAccount(deleteAccount.dataset.crmAccountDelete, "delete"); return; }
    const displayNameEdit = event.target.closest("[data-office-display-name-edit]");
    if (displayNameEdit) {
      beginDisplayNameEdit(displayNameEdit.dataset.officeDisplayNameEdit, displayNameEdit.dataset.officeDisplayNameSurface);
      return;
    }
    if (event.target.closest("[data-office-display-name-cancel]")) { cancelDisplayNameEdit(); return; }
    const adminTab = event.target.closest("[data-office-admin-tab]");
    if (adminTab) {
      if (state.busy) return;
      clearAdminAttendanceCorrection();
      if (adminTab.dataset.officeAdminTab === "detail" && event.target.closest("i")) {
        state.adminTab = "list";
        state.selectedAdminUserId = "";
      } else state.adminTab = adminTab.dataset.officeAdminTab === "detail" && state.selectedAdminUserId ? "detail" : "list";
      renderCurrent();
      return;
    }
    const adminUser = event.target.closest("[data-office-admin-user]");
    if (adminUser) {
      if (state.busy) return;
      cancelDisplayNameEdit();
      clearAdminAttendanceCorrection();
      state.selectedAdminUserId = adminUser.dataset.officeAdminUser;
      state.adminTab = "detail";
      renderCurrent();
      return;
    }
    const adminMonth = event.target.closest("[data-office-admin-month]");
    if (adminMonth) {
      if (state.busy) return;
      clearAdminAttendanceCorrection();
      state.adminMonth = adminMonth.dataset.officeAdminMonth === "today" ? Core.workDate().slice(0, 7) : shiftMonth(state.adminMonth, adminMonth.dataset.officeAdminMonth === "previous" ? -1 : 1);
      renderCurrent();
      return;
    }
    if (event.target.closest("[data-office-attendance-correction-open]")) { beginAdminAttendanceCorrection(); return; }
    if (event.target.closest("[data-office-attendance-correction-cancel]")) {
      if (!state.busy) {
        clearAdminAttendanceCorrection();
        renderCurrent();
      }
      return;
    }
    if (event.target.closest("[data-office-attendance-export]")) { exportAdminAttendance(); return; }
  });

  document.addEventListener("input", event => {
    if (event.target.matches("[data-crm-account-invite-email]")) {
      state.crmAccountInviteEmailDraft = event.target.value;
      return;
    }
    if (event.target.matches("[data-office-attendance-correction-form] input, [data-office-attendance-correction-form] textarea")) {
      if (!state.adminAttendanceCorrection || state.busy) return;
      if (event.target.name === "checkInTime") state.adminAttendanceCorrection.checkInTime = event.target.value;
      else if (event.target.name === "checkOutTime") state.adminAttendanceCorrection.checkOutTime = event.target.value;
      else if (event.target.name === "reason") state.adminAttendanceCorrection.reason = event.target.value;
      return;
    }
    if (event.target.matches("[data-office-display-name-form] input")) {
      state.displayNameDraft = event.target.value;
      return;
    }
  });

  document.addEventListener("change", event => {
    const accountRole = event.target.closest("[data-crm-account-role]");
    if (accountRole) {
      const account = state.crmAccountInvites.find(row => row.uid === accountRole.dataset.crmAccountRole);
      const nextRole = accountRole.value;
      if (account) accountRole.value = account.role;
      void manageCrmAccount(accountRole.dataset.crmAccountRole, "role", nextRole); return;
    }
    if (event.target.matches("[data-rfid-user]")) {
      if (!state.busy && !state.rfidCapture) {
        state.selectedRfidUserId = Rfid ? Rfid.normalizeUserId(event.target.value) : "";
        renderCurrent();
      }
      return;
    }
    if (event.target.matches("[data-rfid-port]")) {
      if (!state.busy && !state.rfidCapture) {
        state.rfidReaderPortPath = /^[A-Z0-9]+$/.test(event.target.value) ? event.target.value : "";
        state.rfidCaptureFeedback = null;
        renderCurrent();
      }
      return;
    }
    if (!event.target.matches("[data-office-attendance-correction-date]") || state.busy) return;
    selectAdminAttendanceCorrectionRecord(event.target.value);
    renderCurrent();
    document.querySelector("[data-office-attendance-correction-form] input[name=\"checkInTime\"]")?.focus();
  });

  document.addEventListener("keydown", event => {
    if (state.rfidCapture && officeIsActive() && state.context?.view === "officeRfid") {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        clearRfidCapture(true);
      }
      return;
    }
    if (event.target.closest("[data-office-attendance-correction-form]") && event.key === "Escape") {
      event.preventDefault();
      if (!state.busy) {
        clearAdminAttendanceCorrection();
        renderCurrent();
      }
      return;
    }
    if (event.target.matches("[data-office-display-name-form] input") && event.key === "Escape") {
      event.preventDefault();
      cancelDisplayNameEdit();
      return;
    }
    if (!event.target.matches("[data-office-admin-user]") || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    event.target.click();
  });

  document.addEventListener("submit", event => {
    const crmAccountForm = event.target.closest("[data-crm-account-invite-form]");
    if (crmAccountForm) { event.preventDefault(); void registerCrmAccount(crmAccountForm); return; }
    const leaveForm = event.target.closest("[data-office-leave-form]");
    if (leaveForm) { event.preventDefault(); void submitLeaveRequest(leaveForm); return; }
    const hrForm = event.target.closest("[data-office-hr-form]");
    if (hrForm) { event.preventDefault(); void saveMemberRecord(hrForm, hrForm.dataset.officeHrForm); return; }
    const grantForm = event.target.closest("[data-office-leave-grant]");
    if (grantForm) { event.preventDefault(); void saveLeaveGrant(grantForm, grantForm.dataset.officeLeaveGrant); return; }
    const correctionForm = event.target.closest("[data-office-attendance-correction-form]");
    if (correctionForm) {
      event.preventDefault();
      saveAdminAttendanceCorrection(correctionForm);
      return;
    }
    const nameForm = event.target.closest("[data-office-display-name-form]");
    if (nameForm) {
      event.preventDefault();
      saveDisplayName(new FormData(nameForm).get("displayName"));
      return;
    }
  });

  window.BringOffice = {
    dashboardAttendance() {
      return dashboardAttendanceView();
    },
    render(context) {
      if (!window.BringOfficeFeaturePolicy.officeViews.includes(context.view) && context.view !== "dashboard") {
        this.deactivate();
        return;
      }
      const previousView = state.context && state.context.view;
      if (previousView && previousView !== context.view) {
        clearAdminAttendanceCorrection();
        clearRfidCapture(false);
        if (previousView === "officeAccountSetup") {
          state.crmAccountInvites = [];
          state.crmAccountInvitesLoaded = false;
          state.crmAccountInviteError = "";
          state.crmAccountInviteEmailDraft = "";
        }
      }
      state.context = context;
      state.active = true;
      syncOfficeRfidAttendance();
      startClock();
      startSync();
      renderCurrent();
      load(Boolean(state.loaded && previousView && previousView !== context.view));
      if (context.view === "officeAccountSetup" && !state.crmAccountInvitesLoaded) void refreshCrmAccountInvites();
    },
    deactivate() {
      state.crmAccountInvites = [];
      state.crmAccountInvitesLoaded = false;
      state.crmAccountInviteError = "";
      state.crmAccountInviteEmailDraft = "";
      if (!state.active && !state.clockTimer && !state.syncTimer) {
        return;
      }
      state.active = false;
      syncOfficeRfidAttendance();
      state.generation += 1;
      state.loading = false;
      clearAdminAttendanceCorrection();
      clearRfidCapture(false);
      stopTimers();
    },
    applyData(payload, currentAuth) {
      const user = currentAuth && currentAuth.user || currentUser();
      if (!user || !user.uid) return;
      applyOfficeData(payload, user);
      state.loaded = true;
      state.loading = false;
      state.error = "";
      if (state.context && officeIsActive()) {
        renderCurrent();
      }
    },
    reset() {
      state.active = false;
      syncOfficeRfidAttendance();
      state.generation += 1;
      stopTimers();
      clearRfidCapture(false);
      state.context = null;
      state.data = { users: [], attendance: [], messages: [], rfidCards: [], rfidAdmin: false, leave: [], leaveGrants: [], leaveAdmin: false, loadedAt: "" };
      state.dataRevision += 1;
      state.loaded = false;
      state.loading = false;
      state.error = "";
      state.editingDisplayNameUserId = "";
      state.displayNameEditSurface = "";
      state.displayNameDraft = "";
      state.selectedAdminUserId = "";
      state.selectedRfidUserId = "";
      state.rfidReaderPorts = [];
      state.rfidReaderPortPath = "";
      state.rfidReaderPortsLoaded = false;
      state.rfidReaderPortsLoading = false;
      state.rfidReaderPortsError = "";
      state.rfidAttendanceStatus = "stopped";
      state.rfidAttendanceCode = "";
      state.rfidAttendanceMessage = "출퇴근 화면이 열려 있는 동안 태그기가 자동으로 연결됩니다.";
      state.rfidAttendanceRequested = false;
      state.rfidAttendanceStartPending = false;
      state.rfidCaptureFeedback = null;
      state.adminTab = "list";
      clearAdminAttendanceCorrection();
      state.busy = false;
    },
    // 할 일 담당자를 고르는 데 쓴다. 이름만 자유 입력으로 두면 오타 하나에
    // "내 할 일" 이 비어 버린다. uid 로 붙여야 이름을 바꿔도 따라간다.
    members() {
      return state.data.users
        .filter(user => user && user.uid)
        .map(user => ({
          uid: String(user.uid),
          displayName: Core.displayName(user),
          department: String(user.department || ""),
          title: String(user.title || ""),
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName, "ko"));
    },
    snapshot() {
      return { loaded: state.loaded, loading: state.loading, error: state.error, users: state.data.users.length, attendance: state.data.attendance.length, messages: state.data.messages.length };
    }
  };
})();
