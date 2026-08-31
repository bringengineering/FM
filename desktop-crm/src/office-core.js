(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BringOfficeCore = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const KOREA_TIME_ZONE = "Asia/Seoul";
  const safeText = (value, fallback) => String(value == null ? "" : value).trim() || fallback || "";

  function workDate(value) {
    const date = value instanceof Date ? value : new Date(value || Date.now());
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: KOREA_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date).reduce((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function displayName(user) {
    const source = user && typeof user === "object" ? user : {};
    return safeText(source.displayName || source.name, safeText(source.email, "사용자").split("@")[0]);
  }

  function normalizeUser(uid, value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      uid: safeText(uid || source.uid),
      email: safeText(source.email).toLowerCase(),
      displayName: displayName(source),
      photoUrl: safeText(source.photoUrl || source.profileImage),
      department: safeText(source.department || source.organization || source.team),
      title: safeText(source.title || source.position),
      role: ["admin", "member", "viewer"].includes(source.role) ? source.role : "viewer",
      enabled: source.enabled !== false,
      mustChangePassword: source.mustChangePassword === true
    };
  }

  function normalizeAttendance(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      id: safeText(source.id),
      userId: safeText(source.userId || source.user_id),
      workDate: safeText(source.workDate || source.work_date),
      checkInAt: safeText(source.checkInAt || source.check_in_at),
      checkOutAt: safeText(source.checkOutAt || source.check_out_at),
      createdAt: safeText(source.createdAt || source.created_at),
      updatedAt: safeText(source.updatedAt || source.updated_at)
    };
  }

  function attendanceStatus(record) {
    if (!record || !record.checkInAt) return "출근 전";
    return record.checkOutAt ? "퇴근 완료" : "근무 중";
  }

  function attendanceReviewStatus(record, today) {
    if (!record || !record.checkInAt) return "출근 전";
    if (record.checkOutAt) return "퇴근 완료";
    return record.workDate && record.workDate < safeText(today, workDate()) ? "퇴근 미기록" : "근무 중";
  }

  function workedMinutes(record, now) {
    if (!record || !record.checkInAt) return 0;
    const start = new Date(record.checkInAt).getTime();
    const end = record.checkOutAt
      ? new Date(record.checkOutAt).getTime()
      : record.workDate === workDate(now) ? new Date(now || Date.now()).getTime() : start;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
    return Math.round((end - start) / 60000);
  }

  function monthlyAttendance(rows, userId, month) {
    const safeMonth = /^\d{4}-\d{2}$/.test(safeText(month)) ? month : workDate().slice(0, 7);
    return (Array.isArray(rows) ? rows : [])
      .map(normalizeAttendance)
      .filter(row => row.userId === safeText(userId) && row.workDate.startsWith(`${safeMonth}-`) && row.checkInAt)
      .sort((a, b) => `${b.workDate}${b.checkInAt}`.localeCompare(`${a.workDate}${a.checkInAt}`));
  }

  function monthlyAttendanceSummary(rows, userId, month, now) {
    const today = workDate(now);
    const records = monthlyAttendance(rows, userId, month);
    return {
      records,
      attendedDays: records.length,
      completedDays: records.filter(row => row.checkOutAt).length,
      missingCheckoutDays: records.filter(row => attendanceReviewStatus(row, today) === "퇴근 미기록").length,
      workingDays: records.filter(row => attendanceReviewStatus(row, today) === "근무 중").length,
      totalMinutes: records.reduce((sum, row) => sum + workedMinutes(row, now), 0)
    };
  }

  function normalizeMessage(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      id: safeText(source.id),
      senderId: safeText(source.senderId || source.sender_id),
      receiverId: safeText(source.receiverId || source.receiver_id),
      message: safeText(source.message),
      readAt: safeText(source.readAt || source.read_at),
      createdAt: safeText(source.createdAt || source.created_at)
    };
  }

  function flattenAttendance(value) {
    if (!value || typeof value !== "object") return [];
    const rows = [];
    Object.entries(value).forEach(([firstKey, firstValue]) => {
      if (!firstValue || typeof firstValue !== "object") return;
      if (firstValue.workDate || firstValue.work_date) {
        rows.push(normalizeAttendance(Object.assign({ id: firstKey }, firstValue)));
        return;
      }
      Object.entries(firstValue).forEach(([dateKey, record]) => {
        if (!record || typeof record !== "object") return;
        rows.push(normalizeAttendance(Object.assign({ id: record.id || `${firstKey}_${dateKey}`, userId: record.userId || firstKey, workDate: record.workDate || dateKey }, record)));
      });
    });
    return rows.filter(row => row.userId && row.workDate).sort((a, b) => `${b.workDate}${b.checkInAt}`.localeCompare(`${a.workDate}${a.checkInAt}`));
  }

  function flattenMailbox(value) {
    if (!value || typeof value !== "object") return [];
    const byId = new Map();
    Object.values(value).forEach(conversation => {
      if (!conversation || typeof conversation !== "object") return;
      Object.entries(conversation).forEach(([id, message]) => {
        const row = normalizeMessage(Object.assign({ id }, message || {}));
        if (row.id && row.senderId && row.receiverId) byId.set(row.id, row);
      });
    });
    return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  function normalizeOfficePayload(payload, currentUser) {
    const source = payload && typeof payload === "object" ? payload : {};
    const current = normalizeUser(currentUser && currentUser.uid, currentUser || {});
    const userMap = source.users && typeof source.users === "object" && !Array.isArray(source.users)
      ? Object.entries(source.users).map(([uid, user]) => normalizeUser(uid, user))
      : (Array.isArray(source.users) ? source.users.map(user => normalizeUser(user && user.uid, user)) : []);
    if (current.uid && !userMap.some(user => user.uid === current.uid)) userMap.push(current);
    return {
      users: userMap.filter(user => user.uid && user.enabled && !user.mustChangePassword),
      attendance: Array.isArray(source.attendance) ? source.attendance.map(normalizeAttendance) : flattenAttendance(source.attendance),
      messages: Array.isArray(source.messages) ? source.messages.map(normalizeMessage) : flattenMailbox(source.messages),
      loadedAt: safeText(source.loadedAt)
    };
  }

  function latestByUser(messages, currentUserId) {
    const result = new Map();
    (messages || []).forEach(message => {
      const peerId = message.senderId === currentUserId ? message.receiverId : message.senderId;
      if (!peerId) return;
      const current = result.get(peerId);
      if (!current || current.createdAt < message.createdAt) result.set(peerId, message);
    });
    return result;
  }

  function unreadByUser(messages, currentUserId) {
    const result = new Map();
    (messages || []).forEach(message => {
      if (message.receiverId !== currentUserId || message.readAt) return;
      result.set(message.senderId, (result.get(message.senderId) || 0) + 1);
    });
    return result;
  }

  return {
    KOREA_TIME_ZONE,
    workDate,
    displayName,
    normalizeUser,
    normalizeAttendance,
    attendanceStatus,
    attendanceReviewStatus,
    workedMinutes,
    monthlyAttendance,
    monthlyAttendanceSummary,
    normalizeMessage,
    flattenAttendance,
    flattenMailbox,
    normalizeOfficePayload,
    latestByUser,
    unreadByUser
  };
});
