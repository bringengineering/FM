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
        <button class="office-summary-card attendance" data-office-go="officeAttendance"><span class="office-card-icon">◷</span><div><small>근태관리</small><h3>${Core.attendanceStatus(today)}</h3><p>출근시간 <b>${esc(formatTime(today && today.checkInAt))}</b></p></div>${statusPill(today)}</button>
        <button class="office-summary-card messenger" data-office-go="officeMessenger"><span class="office-card-icon">✉</span><div><small>메신저</small><h3>읽지 않은 메시지</h3><p><b>${unread}</b>개</p></div><span class="office-card-arrow">→</span></button>
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
      }).join("") : `<div class="message-empty"><span>✦</span><b>${esc(Core.displayName(selected))}님과 대화를 시작해 보세요</b><p>메시지와 업무 문서를 안전하게 주고받을 수 있습니다.</p></div>`}</div><form class="message-composer" data-office-message-form><div class="message-composer-content">${state.pendingAttachment ? `<div class="pending-attachment"><span>📎</span><b>${esc(state.pendingAttachment.fileName)}</b><small>${esc(formatFileSize(state.pendingAttachment.size))}</small><button type="button" data-office-attachment-remove aria-label="첨부 제거">×</button></div>` : ""}<div class="message-input-row"><button type="button" class="message-attach-button" data-office-attachment-pick ${state.busy ? "disabled" : ""} aria-label="파일 첨부" title="PDF·XLSX·CSV·DOCX·HWP·HWPX·PPTX·TXT·이미지, 최대 5MB">＋ 파일</button><textarea name="message" maxlength="4000" rows="1" placeholder="메시지를 입력하세요 (Shift+Enter 줄바꿈)">${esc(state.messageDraft)}</textarea></div><small class="message-drop-hint">파일을 대화창에 끌어놓아 첨부할 수 있습니다 · 최대 5MB</small></div><button class="message-send-button" type="submit" ${state.busy ? "disabled" : ""}>전송</button></form>` : `<div class="message-empty full"><span>✉</span><b>대화할 사용자를 선택하세요</b><p>왼쪽 CRM 사용자 목록에서 동료를 선택할 수 있습니다.</p></div>`}</section>
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
    return `<nav class="office-admin-tabs" aria-label="전체 근태관리 탭"><button class="${state.adminTab === "list" ? "active" : ""}" data-office-admin-tab="list"><span>▦</span> 직원 목록</button>${selectedUser ? `<button class="${state.adminTab === "detail" ? "active" : ""}" data-office-admin-tab="detail"><span>◷</span> ${esc(Core.displayName(selectedUser))} 근태 <i aria-hidden="true">×</i></button>` : ""}</nav>`;
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
    const hero = officeHero("전체 근태관리", "직원 이름과 월간 근태 기록을 한 곳에서 관리합니다", `<span class="office-admin-lock">◇ 관리자 전용</span><button class="secondary-button" data-office-refresh>새로고침</button>`);

    if (state.adminTab === "detail" && selectedUser) {
      const summary = Core.monthlyAttendanceSummary(rows, selectedUser.uid, state.adminMonth);
      const correctableRecords = summary.records.filter(record => record.workDate <= today);
      const correctionEditor = adminAttendanceCorrectionEditor(selectedUser);
      return `${hero}${adminTabs(selectedUser)}${attendanceNameEditor}<section class="office-admin-detail office-admin-calendar-tab">
        <header class="office-admin-detail-head"><div class="office-admin-person">${avatar(selectedUser, "large")}<div><span>EMPLOYEE ATTENDANCE</span><h3>${esc(Core.displayName(selectedUser))}</h3><p>${esc(userMeta(selectedUser))}</p></div><div class="office-admin-person-actions"><button type="button" class="office-admin-name-button" aria-label="${esc(Core.displayName(selectedUser))} 이름 수정" data-office-display-name-edit="${esc(selectedUser.uid)}" data-office-display-name-surface="attendance" ${state.busy ? "disabled" : ""}>이름 수정</button><button type="button" class="office-admin-time-edit-button" data-office-attendance-correction-open ${state.busy || !correctableRecords.length ? "disabled" : ""} title="${correctableRecords.length ? "기존 근태 기록의 시간을 수정합니다." : "이 달에는 수정할 기존 기록이 없습니다."}">시간 수정</button></div></div><div class="office-admin-month-actions"><button data-office-admin-month="previous" aria-label="이전 달">‹</button><strong>${esc(state.adminMonth.replace("-", ". "))}</strong><button data-office-admin-month="next" aria-label="다음 달">›</button><button class="attendance-today-button" data-office-admin-month="today">이번 달</button><button class="office-excel-button" data-office-attendance-export ${state.busy ? "disabled" : ""}><span>⇩</span> 엑셀 다운로드</button></div></header>
        ${correctionEditor}
        <div class="office-admin-month-kpis"><article><span>출근 일수</span><b>${summary.attendedDays}<small>일</small></b></article><article><span>퇴근 완료</span><b>${summary.completedDays}<small>일</small></b></article><article class="${summary.missingCheckoutDays ? "warning" : ""}"><span>퇴근 미기록</span><b>${summary.missingCheckoutDays}<small>일</small></b></article><article><span>총 근무시간</span><b>${esc(durationText(summary.totalMinutes))}</b></article></div>
        ${adminCalendar(summary, today)}
        <footer class="office-admin-detail-note"><b>퇴근 미기록 처리 안내</b><span>과거 날짜에 출근 기록만 있고 퇴근 기록이 없으면 자동으로 ‘퇴근 미기록’으로 표시됩니다. 관리자가 실제 퇴근 시간을 확인한 뒤 정정하는 승인 흐름을 권장합니다.</span></footer>
      </section>`;
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
      <section class="office-panel office-admin-users"><header><div><span>TEAM ATTENDANCE</span><h3>직원별 근태 기록</h3></div><small>${esc(state.adminMonth)} 기준 · 근태 보기 버튼으로 전용 탭 열기</small></header><div class="office-table-wrap"><table class="office-table"><thead><tr><th>직원</th><th>월 출근</th><th>최근 출근</th><th>최근 퇴근</th><th>최근 상태</th><th></th></tr></thead><tbody>${employeeRows}</tbody></table></div></section>`;
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
      state.data = { users: [], attendance: [], messages: [], loadedAt: "" };
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
    snapshot() {
      return { loaded: state.loaded, loading: state.loading, error: state.error, selectedUserId: state.selectedUserId, users: state.data.users.length, attendance: state.data.attendance.length, messages: state.data.messages.length };
    }
  };
})();
