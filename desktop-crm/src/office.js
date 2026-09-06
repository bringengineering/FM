(() => {
  "use strict";

  const Core = window.BringOfficeCore;
  const state = {
    context: null,
    data: { users: [], attendance: [], messages: [], loadedAt: "" },
    loaded: false,
    loading: false,
    error: "",
    selectedUserId: "",
    userQuery: "",
    editingDisplayNameUserId: "",
    displayNameEditSurface: "",
    displayNameDraft: "",
    messageDraft: "",
    pendingAttachment: null,
    openingAttachmentId: "",
    attendanceWeekOffset: 0,
    selectedAttendanceDate: Core.workDate(),
    selectedAdminUserId: "",
    selectedMemberId: "",
    payrollUserId: "",
    payrollMonth: "",
    adminMonth: Core.workDate().slice(0, 7),
    adminTab: "list",
    adminAttendanceCorrection: null,
    busy: false,
    active: false,
    generation: 0,
    dataRevision: 0,
    clockTimer: null,
    syncTimer: null
  };
  let officeFileDragDepth = 0;
  const officeReadReceiptPeerIds = new Set();

  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  const currentUser = () => state.context && state.context.currentAuth && state.context.currentAuth.user || {};
  const currentUserId = () => String(currentUser().uid || "");
  const isAdmin = () => currentUser().officeAdmin === true;
  const userById = uid => state.data.users.find(user => user.uid === uid);
  const myAttendance = () => state.data.attendance.filter(row => row.userId === currentUserId()).sort((a, b) => `${b.workDate}${b.checkInAt}`.localeCompare(`${a.workDate}${a.checkInAt}`));
  const todayRecord = () => myAttendance().find(row => row.workDate === Core.workDate()) || null;
  const statusClass = record => record && record.checkOutAt ? "complete" : record && record.checkInAt ? "working" : "before";
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
  const formatMessageTime = value => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("ko-KR", { timeZone: Core.KOREA_TIME_ZONE, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  };
  const formatFileSize = value => {
    const size = Number(value) || 0;
    if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
    return `${Math.max(1, Math.ceil(size / 1024))} KB`;
  };
  const messagePreview = message => message && message.attachment
    ? `📎 ${message.attachment.fileName}`
    : String(message && message.message || "");
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
    return state.active && contextActive && activeView.startsWith("office") && activeView === state.context?.view;
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
    state.data = Core.normalizeOfficePayload(payload && payload.data || payload, user || currentUser());
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

  function unreadByActiveUser(userId = currentUserId()) {
    const activePeers = new Set(state.data.users
      .filter(user => user.uid && user.uid !== String(userId || ""))
      .map(user => user.uid));
    return new Map([...Core.unreadByUser(state.data.messages, String(userId || ""))]
      .filter(([peerId]) => activePeers.has(peerId)));
  }

  function unreadCountFor(userId = currentUserId()) {
    return [...unreadByActiveUser(userId).values()].reduce((sum, count) => sum + count, 0);
  }

  function updateUnreadBadge(userId = currentUserId()) {
    const unreadBadge = document.getElementById("navOfficeUnread");
    if (unreadBadge) unreadBadge.textContent = String(unreadCountFor(userId));
    updateApprovalBadge(userId);
  }

  // 결재 숫자. 관리자에게는 승인을 기다리는 전체 건수를, 나머지에게는 자기가
  // 올려 두고 답을 기다리는 건수를 낸다. 갱신하지 않으면 늘 0 으로 보이는데,
  // 그건 "대기 없음" 이라고 거짓말하는 것과 같다.
  function updateApprovalBadge(userId = currentUserId()) {
    const badge = document.getElementById("navApprovalCount");
    if (!badge) return;
    const A = Approval();
    const rows = state.data.approvals || [];
    const waiting = A
      ? (state.data.approvalAdmin ? A.pending(rows) : A.forUser(rows, userId).filter(item => item.status === "requested"))
      : [];
    badge.textContent = String(waiting.length);
    badge.hidden = waiting.length === 0;
  }

  function mergeConfirmedReadReceipts(payload, peerId, userId, messageIds) {
    const normalized = Core.normalizeOfficePayload(payload && payload.data || payload, currentUser());
    const messages = Core.mergeConfirmedOfficeReadReceipts(
      state.data.messages,
      normalized.messages,
      peerId,
      userId,
      messageIds,
    );
    if (messages === state.data.messages) return false;
    state.data = Object.assign({}, state.data, { messages });
    state.dataRevision += 1;
    return true;
  }

  function syncMessengerPresence() {
    const peerId = Core.normalizeOfficeUserId(state.selectedUserId);
    const active = Boolean(
      officeIsActive()
      && state.context?.view === "officeMessenger"
      && peerId
      && peerId !== currentUserId()
      && userById(peerId)
    );
    if (typeof state.context?.setMessengerPresence !== "function") return true;
    return state.context.setMessengerPresence(active, active ? peerId : "");
  }

  function selectedConversationCanBeAcknowledged(userId = currentUserId()) {
    const selectedUserId = state.selectedUserId;
    const hasUnread = Boolean(selectedUserId) && state.data.messages.some(message => (
      message.senderId === selectedUserId
      && message.receiverId === String(userId || "")
      && !message.readAt
    ));
    let documentFocused = false;
    try {
      documentFocused = typeof document.hasFocus === "function" && document.hasFocus();
    } catch (_) {}
    return Core.shouldAcknowledgeConversation({
      officeActive: officeIsActive(),
      view: state.context?.view,
      documentHidden: document.hidden,
      documentFocused,
      selectedUserId,
      hasUnread
    });
  }

  function acknowledgeVisibleConversation() {
    if (!selectedConversationCanBeAcknowledged() || officeReadReceiptPeerIds.has(state.selectedUserId)) return;
    void selectUser(state.selectedUserId);
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
      chooseDefaultUser();
    } catch (error) {
      if (contextGuardActive(guard)) state.error = error.message || "BRING OFFICE 자료를 불러오지 못했습니다.";
    } finally {
      if (contextGuardActive(guard)) {
        state.loading = false;
        if (officeIsActive()) {
          renderCurrent();
          acknowledgeVisibleConversation();
        }
      }
    }
  }

  function chooseDefaultUser() {
    const peers = state.data.users.filter(user => user.uid !== currentUserId());
    if (state.selectedUserId && peers.some(user => user.uid === state.selectedUserId)) return;
    const previousUserId = state.selectedUserId;
    const latest = Core.latestByUser(state.data.messages, currentUserId());
    const unread = unreadByActiveUser();
    peers.sort((a, b) => {
      const unreadGap = (unread.get(b.uid) || 0) - (unread.get(a.uid) || 0);
      if (unreadGap) return unreadGap;
      return String(latest.get(b.uid)?.createdAt || "").localeCompare(String(latest.get(a.uid)?.createdAt || ""));
    });
    state.selectedUserId = peers[0] && peers[0].uid || "";
    if (previousUserId && previousUserId !== state.selectedUserId) {
      state.editingDisplayNameUserId = "";
      state.displayNameEditSurface = "";
      state.displayNameDraft = "";
      state.messageDraft = "";
      state.pendingAttachment = null;
    }
  }

  function loadingPanel() {
    return `<section class="office-loading"><span class="office-loader"></span><b>BRING OFFICE를 준비하고 있습니다</b><p>기존 CRM 사용자와 업무 자료를 불러오는 중입니다.</p></section>`;
  }

  function errorPanel() {
    return `<section class="office-loading office-error"><span>!</span><b>자료를 불러오지 못했습니다</b><p>${esc(state.error)}</p><button class="secondary-button" data-office-refresh>다시 시도</button></section>`;
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
    return `<span class="office-status ${statusClass(record)}"><i></i>${Core.attendanceStatus(record)}</span>`;
  }

  function attendanceRows(rows, showUser) {
    if (!rows.length) return `<div class="office-empty"><b>아직 근태 기록이 없습니다</b><span>출근하기 버튼을 누르면 첫 기록이 표시됩니다.</span></div>`;
    return `<div class="office-table-wrap"><table class="office-table"><thead><tr>${showUser ? "<th>직원</th>" : ""}<th>날짜</th><th>출근시간</th><th>퇴근시간</th><th>근무 상태</th></tr></thead><tbody>${rows.map(row => {
      const user = userById(row.userId) || { uid: row.userId, displayName: row.userId };
      return `<tr>${showUser ? `<td><div class="office-user-cell">${avatar(user, "small")}<b>${esc(Core.displayName(user))}</b></div></td>` : ""}<td><b>${esc(formatDate(row.workDate))}</b><small>${esc(row.workDate)}</small></td><td>${esc(formatTime(row.checkInAt))}</td><td>${esc(formatTime(row.checkOutAt))}</td><td>${statusPill(row)}</td></tr>`;
    }).join("")}</tbody></table></div>`;
  }

  function homeView() {
    const today = todayRecord();
    const unread = unreadCountFor();
    return `${officeHero("BRING OFFICE", "브링의 업무를 한 곳에서", `<div class="office-live-time"><span data-office-date></span><b data-office-clock></b></div>`)}
      <section class="office-dashboard-grid">
        <button class="office-summary-card attendance" data-office-go="officeAttendance"><span class="office-card-icon"><svg class="office-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.2"/><path d="M12 7.4V12l3.2 1.9"/></svg></span><div><small>근태관리</small><h3>${Core.attendanceStatus(today)}</h3><p>출근시간 <b>${esc(formatTime(today && today.checkInAt))}</b></p></div>${statusPill(today)}</button>
        <button class="office-summary-card messenger" data-office-go="officeMessenger"><span class="office-card-icon"><svg class="office-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4.5 7.5 7.5 5.5 7.5-5.5"/></svg></span><div><small>메신저</small><h3>읽지 않은 메시지</h3><p><b>${unread}</b>개</p></div><span class="office-card-arrow">→</span></button>
      </section>
      <section class="office-panel"><header><div><span>MY WORK LOG</span><h3>최근 근태 기록</h3></div><button class="text-button" data-office-go="officeAttendance">전체 보기 →</button></header>${attendanceRows(myAttendance().slice(0, 5), false)}</section>`;
  }

  function attendanceView() {
    const today = todayRecord();
    const checkedIn = Boolean(today && today.checkInAt);
    const checkedOut = Boolean(today && today.checkOutAt);
    const baseWeek = startOfWeek(Core.workDate());
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
    const endMinute = selected ? (selected.checkOutAt ? minutesAt(selected.checkOutAt) : selected.workDate === Core.workDate() ? minutesAt(new Date().toISOString()) : startMinute) : startMinute;
    const barLeft = Math.max(0, Math.min(100, startMinute / 1440 * 100));
    const barWidth = Math.max(selected ? 1.8 : 0, Math.min(100 - barLeft, Math.max(0, endMinute - startMinute) / 1440 * 100));
    const dayLabels = ["월", "화", "수", "목", "금", "토", "일"];
    const punchActions = `<div class="attendance-punch"><div><span data-office-date></span><b data-office-clock></b>${statusPill(today)}</div><button class="office-punch-button in" data-office-attendance="check-in" ${checkedIn || state.busy ? "disabled" : ""}>출근하기</button><button class="office-punch-button out" data-office-attendance="check-out" ${!checkedIn || checkedOut || state.busy ? "disabled" : ""}>퇴근하기</button></div>`;
    return `${officeHero("내 근태현황", "주간 근무시간과 일자별 출퇴근 기록을 확인하세요", punchActions)}
      <section class="attendance-week-toolbar"><div><button data-office-week="previous" aria-label="이전 주">‹</button><strong>${esc(weekStart)} ~ ${esc(weekEnd)}</strong><button data-office-week="next" aria-label="다음 주">›</button><button class="attendance-today-button" data-office-week="today">오늘</button></div><span>브링엔지니어링 <b>09:00 ~ 18:00</b></span></section>
      <section class="attendance-week-summary"><div class="attendance-progress"><span>주간 누적 <b>${esc(durationText(totalMinutes))}</b></span><p>이번 주 근무시간을 기준으로 표시합니다.</p><div><i style="width:${Math.min(100, totalMinutes / 2400 * 100)}%"></i></div><small><b>40h</b><b>52h</b></small></div><article><span>근무일</span><b>${workedDays}<small>/5일</small></b></article><article><span>남은 근무일</span><b>${Math.max(0, 5 - workedDays)}<small>일</small></b></article><article><span>총 근로시간</span><b>${esc(durationText(totalMinutes))}</b></article><article><span>오늘 상태</span>${statusPill(today)}</article></section>
      <section class="attendance-week-days">${weekDates.map((workDate, index) => {
        const row = weekRows[index];
        const weekend = index > 4;
        return `<button class="attendance-day ${workDate === selectedDate ? "selected" : ""} ${weekend ? "weekend" : ""}" data-office-date-select="${esc(workDate)}"><span><b>${dayLabels[index]}</b> ${Number(workDate.slice(-2))}</span>${row ? `<strong>${formatTime(row.checkInAt)} 출근</strong><small>${row.checkOutAt ? `${formatTime(row.checkOutAt)} 퇴근` : Core.attendanceStatus(row)}</small>` : `<em>${weekend ? "휴일" : "기록 없음"}</em>`}</button>`;
      }).join("")}</section>
      <section class="attendance-day-detail"><header><div><span>근무시작<b>${esc(formatTime(selected && selected.checkInAt))}</b></span><span>근무종료<b>${esc(formatTime(selected && selected.checkOutAt))}</b></span><span>총 근로시간<b>${esc(durationText(selectedMinutes))}</b></span><span>상세 근로시간<b>소정 ${esc(durationText(selectedMinutes))}</b></span></div>${statusPill(selected)}</header><div class="attendance-timeline-layout"><div class="attendance-timeline"><div class="attendance-hour-labels">${Array.from({ length: 24 }, (_, hour) => `<span>${String(hour).padStart(2, "0")}</span>`).join("")}</div><div class="attendance-hour-grid">${Array.from({ length: 24 }, () => "<i></i>").join("")}${selected ? `<b class="attendance-work-bar" style="left:${barLeft}%;width:${barWidth}%">업무시간</b>` : ""}</div><footer><span><i></i>정상</span><span><i></i>근태이상</span><span><i></i>수정</span></footer></div><aside><h4>근무상태 내역</h4><small>${esc(selectedDate)}</small>${selected ? `<dl><dt>출근</dt><dd>${esc(formatTime(selected.checkInAt))}</dd>${selected.checkOutAt ? `<dt>퇴근</dt><dd>${esc(formatTime(selected.checkOutAt))}</dd>` : ""}<dt>상태</dt><dd>${Core.attendanceStatus(selected)}</dd></dl>` : `<p>이 날짜의 근태 기록이 없습니다.</p>`}</aside></div></section>
      <section class="office-panel attendance-recent-panel"><header><div><span>ATTENDANCE HISTORY</span><h3>최근 근태 기록</h3></div><small>최근 30개 기록</small></header>${attendanceRows(records.slice(0, 30), false)}</section>`;
  }

  function messengerUsers() {
    const latest = Core.latestByUser(state.data.messages, currentUserId());
    const unread = unreadByActiveUser();
    const query = state.userQuery.trim().toLowerCase();
    return state.data.users.filter(user => user.uid !== currentUserId()).filter(user => !query || [user.displayName, user.email, user.department, user.title].join(" ").toLowerCase().includes(query)).sort((a, b) => {
      const unreadGap = (unread.get(b.uid) || 0) - (unread.get(a.uid) || 0);
      if (unreadGap) return unreadGap;
      const recentGap = String(latest.get(b.uid)?.createdAt || "").localeCompare(String(latest.get(a.uid)?.createdAt || ""));
      return recentGap || Core.displayName(a).localeCompare(Core.displayName(b), "ko");
    });
  }

  function displayNameEditor(user, surface) {
    if (!user
      || !isAdmin()
      || state.editingDisplayNameUserId !== user.uid
      || state.displayNameEditSurface !== surface) return "";
    const inputId = `officeDisplayName-${surface}`;
    const label = surface === "attendance" ? "전체 화면에 표시할 직원 이름" : "선택한 구성원의 표시 이름";
    return `<form class="office-display-name-editor ${surface === "attendance" ? "attendance" : "messenger"}" data-office-display-name-form data-office-display-name-surface="${esc(surface)}"><div class="office-display-name-copy"><label for="${esc(inputId)}">${label}</label><strong>수정 대상 · ${esc(Core.displayName(user))}${user.email ? ` · ${esc(user.email)}` : ""}</strong><span>전체 근태관리와 모든 사용자의 메신저에 같은 이름으로 표시됩니다.</span></div><input id="${esc(inputId)}" name="displayName" type="text" maxlength="80" autocomplete="off" value="${esc(state.displayNameDraft)}" required><div><button type="button" data-office-display-name-cancel>취소</button><button type="submit" ${state.busy ? "disabled" : ""}>이름 저장</button></div></form>`;
  }

  function messengerView() {
    const users = messengerUsers();
    const latest = Core.latestByUser(state.data.messages, currentUserId());
    const unread = unreadByActiveUser();
    const selected = userById(state.selectedUserId);
    const conversation = selected ? state.data.messages.filter(message => message.senderId === currentUserId() && message.receiverId === selected.uid || message.receiverId === currentUserId() && message.senderId === selected.uid) : [];
    const nameEditor = displayNameEditor(selected, "messenger");
    return `<section class="office-messenger">
      <aside class="messenger-people"><header><span>BRING OFFICE</span><h2>메신저</h2><label><i class="search-mark" aria-hidden="true"><svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="6.5"/><path d="M15.8 15.8 20.5 20.5"/></svg></i><input type="search" data-office-user-search value="${esc(state.userQuery)}" placeholder="이름, 소속 검색"></label></header><div class="messenger-user-list">${users.length ? users.map(user => {
        const message = latest.get(user.uid);
        const count = unread.get(user.uid) || 0;
        return `<button class="messenger-user ${user.uid === state.selectedUserId ? "selected" : ""}" data-office-user="${esc(user.uid)}">${avatar(user)}<span><b>${esc(Core.displayName(user))}</b><small>${esc(message ? messagePreview(message) : userMeta(user))}</small></span><time>${esc(message ? formatMessageTime(message.createdAt).split(" ").slice(-1)[0] : "")}</time>${count ? `<em>${count}</em>` : ""}</button>`;
      }).join("") : `<div class="messenger-no-users">검색 결과가 없습니다.</div>`}</div></aside>
      <section class="messenger-chat" data-office-attachment-drop-zone>${selected ? `<header>${avatar(selected, "large")}<div><h3>${esc(Core.displayName(selected))}</h3><p>${esc(userMeta(selected))}</p></div><div class="messenger-chat-actions"><span class="messenger-online"><i></i>CRM 사용자</span>${isAdmin() ? `<button type="button" class="messenger-name-edit-button" data-office-display-name-edit="${esc(selected.uid)}" data-office-display-name-surface="messenger" ${state.busy ? "disabled" : ""}>이름 수정</button>` : ""}</div></header>${nameEditor}<div class="message-list" data-office-message-list>${conversation.length ? conversation.map(message => {
        const mine = message.senderId === currentUserId();
        const attachment = message.attachment;
        const attachmentOnlyText = attachment && message.message === `[파일] ${attachment.fileName}`;
        return `<div class="message-row ${mine ? "mine" : "theirs"}">${!mine ? avatar(selected, "small") : ""}<div>${attachmentOnlyText ? "" : `<p>${esc(message.message)}</p>`}${attachment ? `<button type="button" class="message-attachment" data-office-attachment-open="${esc(attachment.fileId)}" ${state.openingAttachmentId === attachment.fileId ? "disabled" : ""}><b>📎 ${esc(attachment.fileName)}</b><small>${esc(attachment.extension.toUpperCase())} · ${esc(formatFileSize(attachment.size))}</small><em>${state.openingAttachmentId === attachment.fileId ? "여는 중" : "열기"}</em></button>` : ""}<span>${esc(formatMessageTime(message.createdAt))}${mine ? ` · ${message.readAt ? "읽음" : "안읽음"}` : ""}</span></div></div>`;
      }).join("") : `<div class="message-empty"><span class="office-empty-icon"><svg class="office-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 14.5a2.5 2.5 0 0 1-2.5 2.5H9l-4 3.5v-14A2.5 2.5 0 0 1 7.5 4h10A2.5 2.5 0 0 1 20 6.5z"/></svg></span><b>${esc(Core.displayName(selected))}님과 대화를 시작해 보세요</b><p>메시지와 업무 문서를 안전하게 주고받을 수 있습니다.</p></div>`}</div><form class="message-composer" data-office-message-form><div class="message-composer-content">${state.pendingAttachment ? `<div class="pending-attachment"><span>📎</span><b>${esc(state.pendingAttachment.fileName)}</b><small>${esc(formatFileSize(state.pendingAttachment.size))}</small><button type="button" data-office-attachment-remove aria-label="첨부 제거">×</button></div>` : ""}<div class="message-input-row"><button type="button" class="message-attach-button" data-office-attachment-pick ${state.busy ? "disabled" : ""} aria-label="파일 첨부" title="PDF·XLSX·CSV·DOCX·HWP·HWPX·PPTX·TXT·이미지, 최대 5MB">＋ 파일</button><textarea name="message" maxlength="4000" rows="1" placeholder="메시지를 입력하세요 (Shift+Enter 줄바꿈)">${esc(state.messageDraft)}</textarea></div><small class="message-drop-hint">파일을 대화창에 끌어놓아 첨부할 수 있습니다 · 최대 5MB</small></div><button class="message-send-button" type="submit" ${state.busy ? "disabled" : ""}>전송</button></form>` : `<div class="message-empty full"><span class="office-empty-icon"><svg class="office-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4.5 7.5 7.5 5.5 7.5-5.5"/></svg></span><b>대화할 사용자를 선택하세요</b><p>왼쪽 CRM 사용자 목록에서 동료를 선택할 수 있습니다.</p></div>`}</section>
    </section>`;
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
      today: Core.workDate()
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
      .filter(record => record.workDate <= Core.workDate());
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
    const today = Core.workDate();
    const users = state.data.users.slice().sort((a, b) => Core.displayName(a).localeCompare(Core.displayName(b), "ko"));
    const selectedUser = users.find(user => user.uid === state.selectedAdminUserId) || null;
    const editingUser = users.find(user => user.uid === state.editingDisplayNameUserId) || null;
    const attendanceNameEditor = displayNameEditor(editingUser, "attendance");
    if (!selectedUser && state.adminTab === "detail") state.adminTab = "list";
    const hero = officeHero("전체 근태관리", "직원 이름과 월간 근태 기록을 한 곳에서 관리합니다", `<span class="office-admin-lock"><svg class="office-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="4.8" y="10.5" width="14.4" height="9.7" rx="2.4"/><path d="M8.2 10.5V7.8a3.8 3.8 0 0 1 7.6 0v2.7"/></svg> 관리자 전용</span><button class="secondary-button" data-office-refresh>새로고침</button>`);

    if (state.adminTab === "detail" && selectedUser) {
      const summary = Core.monthlyAttendanceSummary(rows, selectedUser.uid, state.adminMonth);
      const correctableRecords = summary.records.filter(record => record.workDate <= today);
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
  // 이 화면은 그 자체가 목적이 아니라 **연차·급여의 재료**다. 그래서 비어
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

  // --- 전자결재 ---
  // 단계는 하나다. 상신하고, 관리자가 승인하거나 반려한다. 7동 관리하는
  // 회사에 3단 결재선을 얹으면 아무도 안 쓴다. 그 대신 정해진 뒤에는
  // 아무도 못 고친다 — 그게 결재 기록의 전부다.
  const Approval = () => window.BringApprovalCore;

  const won = value => `${Number(value || 0).toLocaleString("ko-KR")}원`;

  function approvalsView() {
    const A = Approval();
    if (!A) return `<section class="office-loading office-error"><span>!</span><b>결재 모듈을 불러오지 못했습니다</b></section>`;
    const uid = currentUserId();
    const all = state.data.approvals || [];
    const mine = A.forUser(all, uid);
    const waiting = A.pending(all);
    const myWaiting = mine.filter(item => item.status === "requested").length;

    const rowsHtml = mine.length
      ? mine.map(item => approvalRow(A, item, false)).join("")
      : `<div class="office-empty"><b>아직 올린 결재가 없습니다</b><span>아래에서 지출·구매를 올려 보세요.</span></div>`;

    return `${officeHero("결재", "지출·구매를 올리고 승인받습니다", state.data.approvalAdmin ? `<span class="office-admin-lock">승인 권한</span>` : "")}
      <section class="office-admin-kpis">
        <article><span>${state.data.approvalAdmin ? "승인 대기" : "내 대기"}</span><b>${state.data.approvalAdmin ? waiting.length : myWaiting}</b><small>건</small></article>
        <article><span>내가 올린 것</span><b>${mine.length}</b><small>건</small></article>
        <article><span>승인됨</span><b>${mine.filter(item => item.status === "approved").length}</b><small>건</small></article>
        <article><span>반려됨</span><b>${mine.filter(item => item.status === "rejected").length}</b><small>건</small></article>
      </section>
      ${state.data.approvalAdmin ? approvalAdminPanel(A, all) : ""}
      <section class="office-panel">
        <header><div><span>NEW REQUEST</span><h3>결재 올리기</h3></div><small>올린 뒤에는 내용을 고칠 수 없습니다</small></header>
        <form class="office-form-grid" data-office-approval-form>
          <label><span>종류</span><select name="kind">${A.KINDS.map(item => `<option value="${esc(item.key)}">${esc(item.label)}</option>`).join("")}</select></label>
          <label><span>제목</span><input type="text" name="title" maxlength="120" required></label>
          <label><span>금액</span><input type="text" name="amount" inputmode="numeric" placeholder="지출·구매는 필수"></label>
          <label><span>거래처</span><input type="text" name="vendor" maxlength="120" placeholder="선택"></label>
          <label><span>필요일</span><input type="date" name="dueDate"${dateBounds()}></label>
          <label><span>첨부 위치</span><input type="url" name="attachmentUrl" maxlength="500" placeholder="https:// 견적서 등"></label>
          <label class="wide"><span>내용</span><textarea name="content" maxlength="2000" rows="3" placeholder="무엇을 왜 쓰는지"></textarea></label>
          <div class="office-form-actions"><button class="primary-button" type="submit"${state.busy ? " disabled" : ""}>결재 올리기</button></div>
        </form>
      </section>
      <section class="office-panel">
        <header><div><span>MY REQUESTS</span><h3>내가 올린 결재</h3></div><small>${mine.length}건</small></header>
        <div class="office-approval-list">${rowsHtml}</div>
      </section>`;
  }

  function approvalRow(A, item, decidable) {
    const kind = (A.kindOf(item.kind) || {}).label || item.kind;
    const amount = item.amount > 0 ? ` · ${won(item.amount)}` : "";
    const decided = item.decidedBy
      ? `<small>${esc(A.statusLabel(item.status))} · ${esc(item.decidedBy)}</small>`
      : `<small>${esc(A.statusLabel(item.status))}</small>`;
    const note = item.decisionNote ? `<p class="office-approval-note">${esc(item.decisionNote)}</p>` : "";
    const actions = decidable
      ? `<div class="office-approval-actions">
          <button type="button" class="mini-button" data-office-approval-decide="approved" data-office-approval-user="${esc(item.userId)}" data-office-approval-id="${esc(item.id)}">승인</button>
          <button type="button" class="mini-button return" data-office-approval-decide="rejected" data-office-approval-user="${esc(item.userId)}" data-office-approval-id="${esc(item.id)}">반려</button>
        </div>`
      : (item.status === "requested"
        ? `<div class="office-approval-actions"><button type="button" class="mini-button return" data-office-approval-cancel="${esc(item.id)}">취소</button></div>`
        : "");
    const who = decidable ? `${esc(nameOfUser(item.userId))} · ` : "";
    return `<article class="office-approval-row status-${esc(item.status)}">
      <div><b>${who}${esc(item.title)}</b><span>${esc(kind)}${amount}${item.vendor ? ` · ${esc(item.vendor)}` : ""}${item.dueDate ? ` · ${esc(item.dueDate)}까지` : ""}</span>${item.content ? `<p>${esc(item.content)}</p>` : ""}${note}</div>
      <div class="office-approval-status">${decided}${actions}</div>
    </article>`;
  }

  function nameOfUser(uid) {
    const user = state.data.users.find(item => item && item.uid === uid);
    return user ? Core.displayName(user) : uid;
  }

  function approvalAdminPanel(A, all) {
    const pending = A.pending(all);
    const list = pending.length
      ? pending.map(item => approvalRow(A, item, true)).join("")
      : `<div class="office-empty"><b>승인을 기다리는 결재가 없습니다</b><span>새 결재가 올라오면 여기에 뜹니다.</span></div>`;
    return `<section class="office-panel">
      <header><div><span>TO APPROVE</span><h3>승인 대기</h3></div><small>${pending.length}건 · 승인은 "써도 된다" 이지 "나갔다" 가 아닙니다</small></header>
      <div class="office-approval-list">${list}</div>
    </section>`;
  }

  async function submitApproval(form) {
    const A = Approval();
    if (!A || state.busy) return;
    const raw = Object.fromEntries(new FormData(form).entries());
    const checked = A.validateRequest({
      id: `ap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      userId: currentUserId(),
      kind: String(raw.kind || "general"),
      title: String(raw.title || ""),
      amount: raw.amount,
      vendor: String(raw.vendor || ""),
      dueDate: String(raw.dueDate || ""),
      content: String(raw.content || ""),
      attachmentUrl: String(raw.attachmentUrl || ""),
      status: "requested",
      createdAt: new Date().toISOString(),
    });
    // 서버에 보내기 전에 여기서 걸러야 사람이 이유를 알 수 있는 문구를 받는다.
    if (!checked.ok) { notify(checked.error, "error"); return; }
    await runApproval(() => window.bringCRM.saveApprovalRequest(checked.record), "결재를 올렸습니다.");
  }

  async function cancelApproval(id) {
    const A = Approval();
    if (!A || state.busy) return;
    const found = (state.data.approvals || []).find(item => item && item.id === id && item.userId === currentUserId());
    if (!found) { notify("취소할 결재를 찾지 못했습니다.", "error"); return; }
    const record = A.normalizeRequest(found);
    if (record.status !== "requested") { notify("이미 처리된 결재는 취소할 수 없습니다.", "error"); return; }
    await runApproval(
      () => window.bringCRM.saveApprovalRequest(Object.assign({}, record, { status: "cancelled" })),
      "결재를 취소했습니다.",
    );
  }

  async function decideApproval(userId, id, decision) {
    if (state.busy) return;
    // 반려는 이유가 있어야 한다. 이유 없는 반려는 다시 올리라는 말과 같은데
    // 무엇을 고쳐야 하는지 알 수 없다.
    let note = "";
    if (decision === "rejected") {
      note = String(window.prompt("반려 사유를 적어 주세요.") || "").trim();
      if (!note) { notify("반려 사유를 적어야 합니다.", "error"); return; }
    }
    await runApproval(
      () => window.bringCRM.decideApprovalRequest({ userId, id, decision, note }),
      decision === "approved" ? "승인했습니다." : "반려했습니다.",
    );
  }

  async function runApproval(action, message) {
    state.busy = true;
    renderCurrent();
    try {
      await action();
      notify(message, "success");
      await load(true);
    } catch (error) {
      notify(error && error.message || "처리하지 못했습니다.", "error");
    } finally {
      state.busy = false;
      renderCurrent();
    }
  }

  // --- 급여 ---
  // 임금명세서 교부는 법정 의무다(근로기준법 48조 2항). 그래서 본인은 자기
  // 명세서를 반드시 볼 수 있어야 한다 — 볼 수 없으면 교부한 것이 아니다.
  // 회사 전체 인건비 합계는 대표만 본다.
  const Payroll = () => window.BringPayrollCore;

  const wonPay = value => `${Number(value || 0).toLocaleString("ko-KR")}원`;

  function payrollView() {
    const P = Payroll();
    if (!P) return `<section class="office-loading office-error"><span>!</span><b>급여 모듈을 불러오지 못했습니다</b></section>`;
    const mine = P.forUser(state.data.payroll || [], currentUserId());
    const latest = mine[0] || null;
    const slips = mine.length
      ? mine.map(item => paySlip(P, item)).join("")
      : `<div class="office-empty"><b>아직 받은 명세서가 없습니다</b><span>대표가 교부하면 여기에 뜹니다.</span></div>`;
    return `${officeHero("급여", "임금명세서를 받고 보관합니다", state.data.payrollAdmin ? `<span class="office-admin-lock">대표 전용</span>` : "")}
      <section class="office-admin-kpis">
        <article><span>받은 명세서</span><b>${mine.length}</b><small>건</small></article>
        <article><span>최근 귀속</span><b>${esc(latest ? latest.month : "—")}</b><small>${esc(latest ? latest.payDate : "")}</small></article>
        <article><span>최근 실지급</span><b>${esc(latest ? wonPay(latest.netPay) : "—")}</b><small>&nbsp;</small></article>
        <article><span>교부 완료</span><b>${mine.filter(item => item.status === "issued").length}</b><small>건</small></article>
      </section>
      <section class="office-panel">
        <header><div><span>MY PAYSLIPS</span><h3>내 임금명세서</h3></div><small>본인 것만 보입니다</small></header>
        <div class="office-pay-list">${slips}</div>
      </section>
      ${state.data.payrollAdmin ? payrollAdminPanel(P) : ""}`;
  }

  function paySlip(P, item) {
    const parts = P.lines(item);
    // 0 원인 항목은 내지 않는다. 안 준 수당을 줄줄이 늘어놓으면 정작 받은
    // 항목이 안 보인다.
    const row = entry => `<li><span>${esc(entry.label)}</span><b>${esc(wonPay(entry.amount))}</b></li>`;
    return `<article class="office-pay-slip status-${esc(item.status)}">
      <header>
        <div><b>${esc(item.month)}</b><span>지급일 ${esc(item.payDate)}</span></div>
        <div class="office-pay-net"><b>${esc(wonPay(parts.netPay))}</b><small>실지급액</small></div>
      </header>
      <div class="office-pay-cols">
        <div><h4>지급</h4><ul>${parts.earnings.map(row).join("")}</ul><p class="office-pay-sum">합계 <b>${esc(wonPay(parts.grossPay))}</b></p></div>
        <div><h4>공제</h4><ul>${parts.deductions.map(row).join("") || `<li><span>없음</span><b>0원</b></li>`}</ul><p class="office-pay-sum">합계 <b>${esc(wonPay(parts.totalDeduction))}</b></p></div>
      </div>
      ${item.calcNote ? `<p class="office-pay-note"><b>계산방법</b> ${esc(item.calcNote)}</p>` : ""}
      ${item.note ? `<p class="office-pay-note">${esc(item.note)}</p>` : ""}
      <p class="office-pay-status">${esc(P.statusLabel(item.status))}${item.issuedBy ? ` · ${esc(item.issuedBy)}` : ""}</p>
    </article>`;
  }

  function payrollAdminPanel(P) {
    const all = state.data.payroll || [];
    const monthList = P.months(all);
    const month = state.payrollMonth && monthList.includes(state.payrollMonth)
      ? state.payrollMonth
      : (monthList[0] || new Date().toISOString().slice(0, 7));
    const summary = P.summarize(all, month);
    const people = state.data.users.slice().sort((a, b) => Core.displayName(a).localeCompare(Core.displayName(b), "ko"));
    const selected = state.payrollUserId && people.some(user => user.uid === state.payrollUserId)
      ? state.payrollUserId
      : (people[0] ? people[0].uid : "");
    const existing = all.map(P.normalizeRecord)
      .find(item => item.userId === selected && item.month === month) || null;
    const monthOptions = (monthList.includes(month) ? monthList : [month, ...monthList])
      .map(value => `<option value="${esc(value)}"${value === month ? " selected" : ""}>${esc(value)}</option>`).join("");

    const rows = people.map(user => {
      const slip = all.map(P.normalizeRecord).find(item => item.userId === user.uid && item.month === month) || null;
      const status = slip ? slip.status : "";
      return `<tr class="office-admin-user-row${user.uid === selected ? " is-selected" : ""}">
        <td><div class="office-user-cell">${avatar(user, "small")}<span><b>${esc(Core.displayName(user))}</b><small>${esc(userMeta(user))}</small></span></div></td>
        <td>${slip ? `<b>${esc(wonPay(slip.grossPay))}</b>` : `<em class="office-muted">—</em>`}</td>
        <td>${slip ? esc(wonPay(slip.netPay)) : `<span class="office-muted">—</span>`}</td>
        <td>${slip ? `<span class="office-status ${status === "issued" ? "on" : "warn"}"><i></i>${esc(P.statusLabel(status))}</span>` : `<span class="office-muted">미작성</span>`}</td>
        <td><button type="button" class="mini-button" data-office-pay-user="${esc(user.uid)}">명세서 열기</button></td>
      </tr>`;
    }).join("");

    return `<section class="office-panel office-admin-users">
        <header>
          <div><span>PAYROLL</span><h3>급여대장</h3></div>
          <label class="office-inline-select"><span>귀속 월</span><select data-office-pay-month>${monthOptions}</select></label>
        </header>
        <div class="office-admin-kpis office-kpis-inset">
          <article><span>지급 총액</span><b>${esc(wonPay(summary.grossPay))}</b><small>&nbsp;</small></article>
          <article><span>공제 총액</span><b>${esc(wonPay(summary.totalDeduction))}</b><small>&nbsp;</small></article>
          <article><span>실지급 총액</span><b>${esc(wonPay(summary.netPay))}</b><small>&nbsp;</small></article>
          <article><span>교부</span><b>${summary.issuedCount}/${summary.count}</b><small>건</small></article>
        </div>
        <div class="office-table-wrap"><table class="office-table">
          <thead><tr><th>직원</th><th>지급</th><th>실지급</th><th>상태</th><th></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="5" class="office-muted">팀원이 없습니다.</td></tr>`}</tbody>
        </table></div>
      </section>
      ${selected ? payrollForm(P, selected, month, existing) : ""}`;
  }

  function payrollForm(P, userId, month, existing) {
    const record = existing || P.normalizeRecord({ userId, month });
    const locked = existing ? !P.canEdit(existing) : false;
    const user = state.data.users.find(item => item && item.uid === userId) || null;
    const field = (key, label) => `<label><span>${esc(label)}</span><input type="text" inputmode="numeric" name="${esc(key)}" value="${record[key] ? esc(String(record[key])) : ""}"${locked ? " disabled" : ""}></label>`;
    return `<section class="office-panel">
      <header>
        <div><span>PAYSLIP</span><h3>${esc(user ? Core.displayName(user) : userId)} · ${esc(month)}</h3></div>
        <small>4대보험료와 세금은 계산하지 않습니다. 노무사가 낸 숫자를 그대로 적어 주세요</small>
      </header>
      ${locked ? `<p class="office-pay-locked">이미 교부한 명세서입니다. 고치려면 정정 명세서를 따로 내 주세요.</p>` : ""}
      <form class="office-form-grid" data-office-pay-form data-office-pay-target="${esc(userId)}" data-office-pay-month-value="${esc(month)}">
        <label><span>지급일</span><input type="date" name="payDate" value="${esc(record.payDate)}"${dateBounds(month.slice(0, 4))}${locked ? " disabled" : ""} required></label>
        <fieldset class="wide"><legend>지급</legend><div class="office-form-grid office-form-inner">${P.EARNINGS.map(item => field(item.key, item.label)).join("")}</div></fieldset>
        <fieldset class="wide"><legend>공제</legend><div class="office-form-grid office-form-inner">${P.DEDUCTIONS.map(item => field(item.key, item.label)).join("")}</div></fieldset>
        <label class="wide"><span>계산방법</span><input type="text" name="calcNote" maxlength="1000" value="${esc(record.calcNote)}"${locked ? " disabled" : ""} placeholder="연장·야간·휴일 수당이 있으면 필수 (법정 기재사항)"></label>
        <label class="wide"><span>비고</span><input type="text" name="note" maxlength="500" value="${esc(record.note)}"${locked ? " disabled" : ""}></label>
        ${locked ? "" : `<div class="office-form-actions">
          <button class="mini-button" type="submit" name="status" value="draft"${state.busy ? " disabled" : ""}>임시 저장</button>
          <button class="primary-button" type="submit" name="status" value="issued"${state.busy ? " disabled" : ""}>교부</button>
        </div>`}
      </form>
    </section>`;
  }

  async function savePayrollSlip(form, status) {
    const P = Payroll();
    if (!P || state.busy) return;
    const raw = Object.fromEntries(new FormData(form).entries());
    const checked = P.validateRecord(Object.assign({}, raw, {
      userId: form.dataset.officePayTarget,
      month: form.dataset.officePayMonthValue,
      status: status === "issued" ? "issued" : "draft",
      issuedBy: status === "issued" ? (currentUser() && Core.displayName(currentUser())) || "관리자" : "",
    }));
    // 서버에 보내기 전에 여기서 걸러야 사람이 이유를 알 수 있는 문구를 받는다.
    if (!checked.ok) { notify(checked.error, "error"); return; }
    if (status === "issued" && !window.confirm(`${checked.record.month} 명세서를 교부합니다. 교부한 뒤에는 고칠 수 없습니다.`)) return;
    state.busy = true;
    renderCurrent();
    try {
      await window.bringCRM.savePayrollSlip(checked.record);
      notify(status === "issued" ? "명세서를 교부했습니다." : "임시 저장했습니다.", "success");
      await load(true);
    } catch (error) {
      notify(error && error.message || "저장하지 못했습니다.", "error");
    } finally {
      state.busy = false;
      renderCurrent();
    }
  }

  function renderCurrent() {
    if (!state.context || !state.context.container) return;
    syncMessengerPresence();
    if (!officeIsActive()) return;
    updateUnreadBadge();
    if (state.loading && !state.loaded) state.context.container.innerHTML = loadingPanel();
    else if (state.error && !state.loaded) state.context.container.innerHTML = errorPanel();
    else {
      if (state.context.view === "officeHome") state.context.container.innerHTML = homeView();
      else if (state.context.view === "officeAttendance") state.context.container.innerHTML = attendanceView();
      else if (state.context.view === "officeLeave") state.context.container.innerHTML = leaveView();
      else if (state.context.view === "officeMembers") state.context.container.innerHTML = membersView();
      else if (state.context.view === "officePayroll") state.context.container.innerHTML = payrollView();
      else if (state.context.view === "officeApprovals") state.context.container.innerHTML = approvalsView();
      else if (state.context.view === "officeMessenger") state.context.container.innerHTML = messengerView();
      else state.context.container.innerHTML = adminView();
      requestAnimationFrame(() => {
        updateClock();
        const list = document.querySelector("[data-office-message-list]");
        if (list) list.scrollTop = list.scrollHeight;
      });
    }
  }

  async function attendanceAction(action) {
    if (state.busy) return;
    const dataRevision = state.dataRevision;
    state.busy = true;
    renderCurrent();
    try {
      const result = await state.context.api.saveOfficeAttendance({ action, workDate: Core.workDate() });
      if (!result || result.ok === false) throw new Error(result && result.error || "근태 시간을 저장하지 못했습니다.");
      applyOfficeData(result.data || await state.context.api.loadOffice(), currentUser(), dataRevision);
      notify(action === "check-in" ? "출근 시간이 저장되었습니다." : "퇴근 시간이 저장되었습니다.", "success");
    } catch (error) {
      notify(error.message || "근태 시간을 저장하지 못했습니다.", "error");
    } finally {
      state.busy = false;
      renderCurrent();
    }
  }

  async function selectUser(uid) {
    if (state.selectedUserId !== uid) {
      state.editingDisplayNameUserId = "";
      state.displayNameEditSurface = "";
      state.displayNameDraft = "";
      state.messageDraft = "";
      state.pendingAttachment = null;
    }
    state.selectedUserId = uid;
    renderCurrent();
    const messageIds = Core.unreadOfficeMessageIds(state.data.messages, uid, currentUserId());
    if (!messageIds.length || !selectedConversationCanBeAcknowledged() || officeReadReceiptPeerIds.has(uid)) return;
    if (await syncMessengerPresence() === false || !selectedConversationCanBeAcknowledged()) return;
    officeReadReceiptPeerIds.add(uid);
    const dataRevision = state.dataRevision;
    const userId = currentUserId();
    try {
      const result = await state.context.api.markOfficeMessagesRead({ peerId: uid, messageIds });
      if (result && result.ok !== false) {
        const payload = result.data || await state.context.api.loadOffice();
        if (!applyOfficeData(payload, currentUser(), dataRevision)) {
          mergeConfirmedReadReceipts(payload, uid, userId, messageIds);
        }
        updateUnreadBadge(userId);
        renderCurrent();
      }
    } catch (_) {
    } finally {
      officeReadReceiptPeerIds.delete(uid);
    }
  }

  async function sendMessage(text) {
    const message = String(text || "").trim();
    if ((!message && !state.pendingAttachment) || !state.selectedUserId || state.busy) return;
    const dataRevision = state.dataRevision;
    state.busy = true;
    renderCurrent();
    try {
      const result = await state.context.api.sendOfficeMessage({
        receiverId: state.selectedUserId,
        message,
        attachmentToken: state.pendingAttachment && state.pendingAttachment.token || ""
      });
      if (!result || result.ok === false) throw new Error(result && result.error || "메시지를 보내지 못했습니다.");
      applyOfficeData(result.data || await state.context.api.loadOffice(), currentUser(), dataRevision);
      state.messageDraft = "";
      state.pendingAttachment = null;
      notify("메시지를 보냈습니다.", "success");
    } catch (error) {
      notify(error.message || "메시지를 보내지 못했습니다.", "error");
    } finally {
      state.busy = false;
      renderCurrent();
      document.querySelector("[data-office-message-form] textarea")?.focus();
    }
  }

  async function pickMessageAttachment() {
    if (!state.selectedUserId || state.busy) return;
    const receiverId = state.selectedUserId;
    state.busy = true;
    renderCurrent();
    try {
      const result = await state.context.api.pickOfficeAttachment({ receiverId });
      if (result && result.canceled) return;
      if (!result || result.ok === false || !result.attachment) throw new Error(result && result.error || "파일을 첨부하지 못했습니다.");
      if (state.selectedUserId !== receiverId || !officeIsActive() || state.context?.view !== "officeMessenger") {
        notify("대화 상대가 바뀌어 선택한 파일을 첨부하지 않았습니다.", "error");
        return;
      }
      state.pendingAttachment = result.attachment;
      notify("파일을 첨부했습니다. 전송 버튼을 눌러 보내세요.", "success");
    } catch (error) {
      notify(error.message || "파일을 첨부하지 못했습니다.", "error");
    } finally {
      state.busy = false;
      if (officeIsActive()) {
        renderCurrent();
        document.querySelector("[data-office-message-form] textarea")?.focus();
      }
    }
  }

  function fileDragEvent(event) {
    return Array.from(event && event.dataTransfer && event.dataTransfer.types || []).includes("Files");
  }

  function clearOfficeFileDrag() {
    officeFileDragDepth = 0;
    document.querySelector("[data-office-attachment-drop-zone]")?.classList.remove("is-file-dragover");
  }

  async function dropMessageAttachment(file) {
    if (!file || !state.selectedUserId || state.busy) return;
    const receiverId = state.selectedUserId;
    let request;
    try {
      request = state.context.api.dropOfficeAttachment(file, { receiverId });
    } catch (error) {
      notify(error.message || "드래그한 파일을 첨부하지 못했습니다.", "error");
      return;
    }
    state.busy = true;
    renderCurrent();
    try {
      const result = await request;
      if (!result || result.ok === false || !result.attachment) throw new Error(result && result.error || "드래그한 파일을 첨부하지 못했습니다.");
      if (state.selectedUserId !== receiverId || !officeIsActive() || state.context?.view !== "officeMessenger") {
        notify("대화 상대가 바뀌어 드래그한 파일을 첨부하지 않았습니다.", "error");
        return;
      }
      state.pendingAttachment = result.attachment;
      notify("파일을 첨부했습니다. 전송 버튼을 눌러 보내세요.", "success");
    } catch (error) {
      notify(error.message || "드래그한 파일을 첨부하지 못했습니다.", "error");
    } finally {
      state.busy = false;
      if (officeIsActive()) {
        renderCurrent();
        document.querySelector("[data-office-message-form] textarea")?.focus();
      }
    }
  }

  async function openMessageAttachment(messageId) {
    if (!messageId || state.openingAttachmentId) return;
    state.openingAttachmentId = messageId;
    renderCurrent();
    try {
      const result = await state.context.api.openOfficeAttachment({ messageId });
      if (result && result.canceled) return;
      if (!result || result.ok === false) throw new Error(result && result.error || "첨부파일을 열지 못했습니다.");
    } catch (error) {
      notify(error.message || "첨부파일을 열지 못했습니다.", "error");
    } finally {
      state.openingAttachmentId = "";
      renderCurrent();
    }
  }

  function beginDisplayNameEdit(userId, surface) {
    const targetUid = Core.normalizeOfficeUserId(userId);
    const target = userById(targetUid);
    const editSurface = surface === "attendance" ? "attendance" : "messenger";
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
      notify("직원 이름을 저장했습니다. 전체 근태관리와 모든 사용자의 메신저에 반영됩니다.", "success");
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

  document.addEventListener("dragenter", event => {
    if (!fileDragEvent(event) || !officeIsActive() || state.context?.view !== "officeMessenger") return;
    event.preventDefault();
    const zone = event.target && event.target.closest && event.target.closest("[data-office-attachment-drop-zone]");
    if (!zone || !state.selectedUserId || state.busy) return;
    officeFileDragDepth += 1;
    zone.classList.add("is-file-dragover");
  });

  document.addEventListener("dragover", event => {
    if (!fileDragEvent(event) || !officeIsActive() || state.context?.view !== "officeMessenger") return;
    event.preventDefault();
    const zone = event.target && event.target.closest && event.target.closest("[data-office-attachment-drop-zone]");
    const eligible = Boolean(zone && state.selectedUserId && !state.busy);
    if (event.dataTransfer) event.dataTransfer.dropEffect = eligible ? "copy" : "none";
    if (eligible) zone.classList.add("is-file-dragover");
  });

  document.addEventListener("dragleave", event => {
    if (!fileDragEvent(event) || !officeIsActive() || state.context?.view !== "officeMessenger") return;
    const zone = event.target && event.target.closest && event.target.closest("[data-office-attachment-drop-zone]");
    if (!zone) return;
    officeFileDragDepth = Math.max(0, officeFileDragDepth - 1);
    if (!officeFileDragDepth || !zone.contains(event.relatedTarget)) clearOfficeFileDrag();
  });

  document.addEventListener("drop", event => {
    if (!fileDragEvent(event) || !officeIsActive() || state.context?.view !== "officeMessenger") return;
    event.preventDefault();
    const zone = event.target && event.target.closest && event.target.closest("[data-office-attachment-drop-zone]");
    const files = Array.from(event.dataTransfer && event.dataTransfer.files || []);
    clearOfficeFileDrag();
    if (!zone || !state.selectedUserId || state.busy) return;
    if (files.length !== 1) {
      notify("파일은 한 번에 1개만 첨부할 수 있습니다.", "error");
      return;
    }
    void dropMessageAttachment(files[0]);
  });

  document.addEventListener("dragend", clearOfficeFileDrag);
  window.addEventListener("blur", clearOfficeFileDrag);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) acknowledgeVisibleConversation();
  });
  window.addEventListener("focus", acknowledgeVisibleConversation);

  document.addEventListener("click", event => {
    const leaveDecide = event.target.closest("[data-office-leave-decide]");
    if (leaveDecide) {
      void decideLeave(leaveDecide.dataset.officeLeaveUser, leaveDecide.dataset.officeLeaveId, leaveDecide.dataset.officeLeaveDecide);
      return;
    }
    const leaveCancel = event.target.closest("[data-office-leave-cancel]");
    if (leaveCancel) { void cancelLeave(leaveCancel.dataset.officeLeaveCancel); return; }
    const approvalDecide = event.target.closest("[data-office-approval-decide]");
    if (approvalDecide) {
      void decideApproval(approvalDecide.dataset.officeApprovalUser, approvalDecide.dataset.officeApprovalId, approvalDecide.dataset.officeApprovalDecide);
      return;
    }
    const approvalCancel = event.target.closest("[data-office-approval-cancel]");
    if (approvalCancel) { void cancelApproval(approvalCancel.dataset.officeApprovalCancel); return; }
    const paySelect = event.target.closest("[data-office-pay-user]");
    if (paySelect) { state.payrollUserId = paySelect.dataset.officePayUser; renderCurrent(); return; }
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
      const nextStart = addDays(startOfWeek(Core.workDate()), state.attendanceWeekOffset * 7);
      state.selectedAttendanceDate = state.attendanceWeekOffset === 0 ? Core.workDate() : nextStart;
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
    const attendance = event.target.closest("[data-office-attendance]");
    if (attendance) { attendanceAction(attendance.dataset.officeAttendance); return; }
    if (event.target.closest("[data-office-attachment-pick]")) { pickMessageAttachment(); return; }
    if (event.target.closest("[data-office-attachment-remove]")) {
      state.pendingAttachment = null;
      renderCurrent();
      document.querySelector("[data-office-message-form] textarea")?.focus();
      return;
    }
    const attachment = event.target.closest("[data-office-attachment-open]");
    if (attachment) { openMessageAttachment(attachment.dataset.officeAttachmentOpen); return; }
    const user = event.target.closest("[data-office-user]");
    if (user) { selectUser(user.dataset.officeUser); }
  });

  document.addEventListener("input", event => {
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
    if (event.target.matches("[data-office-message-form] textarea")) {
      state.messageDraft = event.target.value;
      return;
    }
    if (!event.target.matches("[data-office-user-search]")) return;
    state.userQuery = event.target.value;
    const position = event.target.selectionStart;
    renderCurrent();
    const input = document.querySelector("[data-office-user-search]");
    input?.focus();
    input?.setSelectionRange(position, position);
  });

  document.addEventListener("change", event => {
    if (event.target.matches("[data-office-pay-month]")) {
      state.payrollMonth = event.target.value;
      renderCurrent();
      return;
    }
    if (!event.target.matches("[data-office-attendance-correction-date]") || state.busy) return;
    selectAdminAttendanceCorrectionRecord(event.target.value);
    renderCurrent();
    document.querySelector("[data-office-attendance-correction-form] input[name=\"checkInTime\"]")?.focus();
  });

  document.addEventListener("keydown", event => {
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
    if (event.target.matches("[data-office-message-form] textarea") && Core.shouldSendMessageKey(event)) {
      event.preventDefault();
      event.target.form?.requestSubmit();
      return;
    }
    if (!event.target.matches("[data-office-admin-user]") || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    event.target.click();
  });

  document.addEventListener("submit", event => {
    const leaveForm = event.target.closest("[data-office-leave-form]");
    if (leaveForm) { event.preventDefault(); void submitLeaveRequest(leaveForm); return; }
    const approvalForm = event.target.closest("[data-office-approval-form]");
    if (approvalForm) { event.preventDefault(); void submitApproval(approvalForm); return; }
    const payForm = event.target.closest("[data-office-pay-form]");
    if (payForm) {
      event.preventDefault();
      // 어느 단추로 냈는지에 따라 임시 저장인지 교부인지 갈린다.
      void savePayrollSlip(payForm, event.submitter && event.submitter.value);
      return;
    }
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
    const form = event.target.closest("[data-office-message-form]");
    if (!form) return;
    event.preventDefault();
    sendMessage(new FormData(form).get("message"));
  });

  window.BringOffice = {
    render(context) {
      const previousView = state.context && state.context.view;
      if (previousView && previousView !== context.view) clearAdminAttendanceCorrection();
      state.context = context;
      state.active = true;
      startClock();
      startSync();
      renderCurrent();
      load(Boolean(state.loaded && previousView && previousView !== context.view));
    },
    deactivate() {
      if (!state.active && !state.clockTimer && !state.syncTimer) {
        syncMessengerPresence();
        return;
      }
      state.active = false;
      syncMessengerPresence();
      state.generation += 1;
      state.loading = false;
      clearAdminAttendanceCorrection();
      clearOfficeFileDrag();
      stopTimers();
    },
    applyData(payload, currentAuth) {
      const user = currentAuth && currentAuth.user || currentUser();
      if (!user || !user.uid) return;
      applyOfficeData(payload, user);
      state.loaded = true;
      state.loading = false;
      state.error = "";
      chooseDefaultUser();
      const unreadBadge = document.getElementById("navOfficeUnread");
      if (unreadBadge) updateUnreadBadge(String(user.uid));
      if (state.context && officeIsActive()) {
        renderCurrent();
        if (selectedConversationCanBeAcknowledged(String(user.uid))) void selectUser(state.selectedUserId);
      }
    },
    async openConversation(peerId) {
      const safePeerId = typeof peerId === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(peerId) ? peerId : "";
      if (safePeerId && safePeerId !== currentUserId()) {
        if (state.selectedUserId !== safePeerId) {
          state.messageDraft = "";
          state.pendingAttachment = null;
        }
        state.selectedUserId = safePeerId;
      }
      renderCurrent();
      await load(true);
      if (state.selectedUserId) await selectUser(state.selectedUserId);
    },
    reset() {
      state.active = false;
      syncMessengerPresence();
      state.generation += 1;
      stopTimers();
      clearOfficeFileDrag();
      state.context = null;
      state.data = { users: [], attendance: [], messages: [], leave: [], leaveGrants: [], leaveAdmin: false, loadedAt: "" };
      state.dataRevision += 1;
      state.loaded = false;
      state.loading = false;
      state.error = "";
      state.selectedUserId = "";
      state.editingDisplayNameUserId = "";
      state.displayNameEditSurface = "";
      state.displayNameDraft = "";
      state.messageDraft = "";
      state.pendingAttachment = null;
      officeReadReceiptPeerIds.clear();
      state.openingAttachmentId = "";
      state.selectedAdminUserId = "";
      state.adminTab = "list";
      clearAdminAttendanceCorrection();
      state.busy = false;
      const unreadBadge = document.getElementById("navOfficeUnread");
      if (unreadBadge) unreadBadge.textContent = "0";
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
      return { loaded: state.loaded, loading: state.loading, error: state.error, selectedUserId: state.selectedUserId, users: state.data.users.length, attendance: state.data.attendance.length, messages: state.data.messages.length };
    }
  };
})();
