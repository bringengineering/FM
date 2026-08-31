(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BringOfficeCore = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const KOREA_TIME_ZONE = "Asia/Seoul";
  const SAFE_USER_ID = /^[A-Za-z0-9._-]{1,128}$/;
  const SAFE_OPERATOR_ID = /^[A-Za-z0-9_-]{1,120}$/;
  const RESERVED_KEYS = new Set(["__proto__", "prototype", "constructor"]);
  const OFFICE_ROLES = new Set(["admin", "member", "viewer"]);
  const OFFICE_ATTACHMENT_MIME_BY_EXTENSION = Object.freeze({
    pdf: "application/pdf",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    csv: "text/csv",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    hwp: "application/x-hwp",
    hwpx: "application/vnd.hancom.hwpx",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    txt: "text/plain",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp"
  });
  const OFFICE_ATTACHMENT_EXTENSIONS = new Set(Object.keys(OFFICE_ATTACHMENT_MIME_BY_EXTENSION));
  const WINDOWS_RESERVED_NAME = /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i;
  const safeText = (value, fallback) => String(value == null ? "" : value).trim() || fallback || "";

  function isPlainRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function utf8ByteLength(value) {
    let bytes = 0;
    for (const character of value) {
      const point = character.codePointAt(0);
      bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    }
    return bytes;
  }

  function normalizeOfficeDisplayName(value) {
    if (typeof value !== "string") return "";
    const name = value.trim();
    if (!name
      || [...name].length > 80
      || utf8ByteLength(name) > 240
      || /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(name)) return "";
    return name;
  }

  function normalizeOfficeUserId(value) {
    const uid = typeof value === "string" ? value.trim() : "";
    return SAFE_USER_ID.test(uid) && !RESERVED_KEYS.has(uid) ? uid : "";
  }

  function activeProfileName(profile) {
    if (!isPlainRecord(profile) || profile.active !== true) return "";
    return normalizeOfficeDisplayName(profile.displayName);
  }

  function mergeOfficeUsers(accessValue, teamProfilesValue) {
    const access = isPlainRecord(accessValue) ? accessValue : {};
    const teamProfiles = isPlainRecord(teamProfilesValue) ? teamProfilesValue : {};
    const merged = Object.create(null);
    Object.entries(access).forEach(([uid, value]) => {
      if (!normalizeOfficeUserId(uid)
        || !isPlainRecord(value)
        || value.enabled !== true
        || value.mustChangePassword === true
        || !OFFICE_ROLES.has(value.role)) return;
      const user = Object.assign(Object.create(null), value);
      const directName = normalizeOfficeDisplayName(value.displayName);
      const profileIds = [value.officeProfileId, value.operatorId, value.profileId]
        .filter(profileId => typeof profileId === "string")
        .map(profileId => profileId.trim())
        .filter((profileId, index, all) => SAFE_OPERATOR_ID.test(profileId)
          && !RESERVED_KEYS.has(profileId)
          && all.indexOf(profileId) === index);
      const linkedName = profileIds
        .map(profileId => Object.prototype.hasOwnProperty.call(teamProfiles, profileId)
          ? activeProfileName(teamProfiles[profileId])
          : "")
        .find(Boolean) || "";
      delete user.displayName;
      delete user.name;
      if (directName) {
        user.displayName = directName;
      } else if (linkedName) {
        user.displayName = linkedName;
      }
      merged[uid] = user;
    });
    return merged;
  }

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
    const assigned = normalizeOfficeDisplayName(source.displayName)
      || normalizeOfficeDisplayName(source.name);
    if (assigned) return assigned;
    return normalizeOfficeDisplayName(safeText(source.email).split("@")[0]) || "사용자";
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
      attachment: normalizeAttachment(source.attachment),
      readAt: safeText(source.readAt || source.read_at),
      createdAt: safeText(source.createdAt || source.created_at)
    };
  }

  function normalizeAttachment(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const fileId = safeText(source.fileId);
    const fileName = typeof source.fileName === "string" ? source.fileName : "";
    const extension = safeText(source.extension).toLowerCase();
    const mimeType = safeText(source.mimeType);
    const size = Number(source.size);
    const sha256 = safeText(source.sha256).toLowerCase();
    const dot = fileName.lastIndexOf(".");
    const fileExtension = dot > 0 && dot < fileName.length - 1 ? fileName.slice(dot + 1).toLowerCase() : "";
    if (!/^msg_[A-Za-z0-9_]{8,80}$/.test(fileId)
      || !fileName || fileName !== fileName.trim() || fileName !== fileName.normalize("NFC")
      || fileName.length > 180 || [...fileName].length > 180
      || /[<>:"/\\|?*\p{Cc}\p{Cf}]/u.test(fileName) || /[ .]$/u.test(fileName)
      || WINDOWS_RESERVED_NAME.test(fileName) || fileExtension !== extension
      || !OFFICE_ATTACHMENT_EXTENSIONS.has(extension)
      || mimeType !== OFFICE_ATTACHMENT_MIME_BY_EXTENSION[extension]
      || !Number.isSafeInteger(size) || size < 1 || size > 5 * 1024 * 1024
      || !/^[a-f0-9]{64}$/.test(sha256)) return null;
    return { fileId, fileName, extension, mimeType, size, sha256 };
  }

  function shouldSendMessageKey(event) {
    const source = event && typeof event === "object" ? event : {};
    return source.key === "Enter"
      && source.shiftKey !== true
      && source.ctrlKey !== true
      && source.altKey !== true
      && source.metaKey !== true
      && source.isComposing !== true
      && Number(source.keyCode || 0) !== 229;
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
    normalizeOfficeDisplayName,
    normalizeOfficeUserId,
    mergeOfficeUsers,
    normalizeUser,
    normalizeAttendance,
    attendanceStatus,
    attendanceReviewStatus,
    workedMinutes,
    monthlyAttendance,
    monthlyAttendanceSummary,
    normalizeAttachment,
    normalizeMessage,
    flattenAttendance,
    flattenMailbox,
    normalizeOfficePayload,
    latestByUser,
    unreadByUser,
    shouldSendMessageKey
  };
});
