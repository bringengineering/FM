'use strict';

const SAFE_MESSAGE_ID = /^msg_[A-Za-z0-9_]{8,80}$/;
const SAFE_USER_ID = /^[A-Za-z0-9._-]{1,128}$/;
const MAX_TRACKED_SNAPSHOT_MESSAGES = 10000;
const MAX_SEEN_MESSAGE_IDS = 12000;

function normalizedRow(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const id = typeof source.id === 'string' ? source.id.trim() : '';
  const senderId = typeof source.senderId === 'string' ? source.senderId.trim() : '';
  const receiverId = typeof source.receiverId === 'string' ? source.receiverId.trim() : '';
  const createdAt = typeof source.createdAt === 'string' ? source.createdAt.trim() : '';
  const createdAtMs = Date.parse(createdAt);
  if (!SAFE_MESSAGE_ID.test(id)
    || !SAFE_USER_ID.test(senderId)
    || !SAFE_USER_ID.test(receiverId)
    || !Number.isFinite(createdAtMs)) return null;
  return { id, senderId, receiverId, readAt: String(source.readAt || ''), createdAt, createdAtMs };
}

function createOfficeNotificationTracker(options = {}) {
  const onIncoming = typeof options.onIncoming === 'function' ? options.onIncoming : () => {};
  let sessionUid = '';
  let primed = false;
  let seenIds = new Set();

  function clearBaseline() {
    primed = false;
    seenIds = new Set();
  }

  function setSession(value) {
    const nextUid = typeof value === 'string' && SAFE_USER_ID.test(value.trim()) ? value.trim() : '';
    if (nextUid === sessionUid) return false;
    sessionUid = nextUid;
    clearBaseline();
    return true;
  }

  function remember(rows) {
    for (const row of rows.slice().reverse()) {
      if (seenIds.has(row.id)) seenIds.delete(row.id);
      seenIds.add(row.id);
    }
    while (seenIds.size > MAX_SEEN_MESSAGE_IDS) {
      const oldest = seenIds.values().next().value;
      if (!oldest) break;
      seenIds.delete(oldest);
    }
  }

  function ingest(payload) {
    if (!sessionUid) return [];
    const rows = (payload && Array.isArray(payload.messages) ? payload.messages : [])
      .map(normalizedRow)
      .filter(Boolean)
      .sort((left, right) => right.createdAtMs - left.createdAtMs || right.id.localeCompare(left.id))
      .slice(0, MAX_TRACKED_SNAPSHOT_MESSAGES);
    if (!primed) {
      primed = true;
      remember(rows);
      return [];
    }
    const fresh = rows.filter(row => !seenIds.has(row.id));
    remember(rows);
    const incoming = fresh
      .filter(row => row.receiverId === sessionUid && row.senderId !== sessionUid && !row.readAt)
      .map(row => Object.freeze({ id: row.id, senderId: row.senderId, createdAt: row.createdAt }));
    if (incoming.length) onIncoming(Object.freeze(incoming.slice()));
    return incoming;
  }

  return Object.freeze({
    setSession,
    ingest,
    reset() {
      sessionUid = '';
      clearBaseline();
    },
    snapshot() {
      return Object.freeze({ sessionUid, primed, seenIds: seenIds.size });
    },
  });
}

module.exports = Object.freeze({
  SAFE_MESSAGE_ID,
  SAFE_USER_ID,
  MAX_TRACKED_SNAPSHOT_MESSAGES,
  MAX_SEEN_MESSAGE_IDS,
  createOfficeNotificationTracker,
});
