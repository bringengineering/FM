const crypto = require("node:crypto");
const path = require("node:path");

const MAX_ACCESS_TOKEN_LENGTH = 12000;
const MAX_REFRESH_TOKEN_LENGTH = 12000;
const MAX_CLIENT_ID_LENGTH = 320;
const MAX_EMAIL_LENGTH = 200;
const MAX_UID_LENGTH = 128;
const RESTORE_SAFETY_WINDOW_MS = 30 * 1000;
const MAX_SESSION_LIFETIME_MS = 2 * 60 * 60 * 1000;
const CLIENT_ID_PATTERN = /^[A-Za-z0-9._-]{6,300}\.apps\.googleusercontent\.com$/u;

function cleanText(value, maximum) {
  const text = String(value || "").trim();
  if (!text || text.length > maximum || /[\u0000-\u001f\u007f]/u.test(text)) return "";
  return text;
}

function normalizeDriveSession(input, options = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const accessToken = cleanText(source.accessToken, MAX_ACCESS_TOKEN_LENGTH);
  const refreshToken = cleanText(source.refreshToken, MAX_REFRESH_TOKEN_LENGTH);
  const rawClientId = cleanText(source.clientId, MAX_CLIENT_ID_LENGTH);
  const clientId = CLIENT_ID_PATTERN.test(rawClientId) ? rawClientId : "";
  const ownerUid = cleanText(source.ownerUid, MAX_UID_LENGTH);
  const email = String(source.email || "").trim().slice(0, MAX_EMAIL_LENGTH);
  const expiresAtMs = Date.parse(String(source.expiresAt || ""));
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const refreshCapable = Boolean(refreshToken && clientId);
  if ((!accessToken && !refreshCapable) || !ownerUid || !Number.isFinite(expiresAtMs)) return null;
  if (accessToken && /\s/u.test(accessToken)) return null;
  if (refreshToken && /\s/u.test(refreshToken)) return null;
  if (!refreshCapable && (refreshToken || rawClientId)) return null;
  if (!refreshCapable && expiresAtMs <= now + RESTORE_SAFETY_WINDOW_MS) return null;
  if (expiresAtMs > now + MAX_SESSION_LIFETIME_MS) return null;
  if (/[\u0000-\u001f\u007f]/u.test(email)) return null;
  const session = {
    accessToken,
    expiresAt: new Date(expiresAtMs).toISOString(),
    email,
    ownerUid,
  };
  if (refreshCapable) {
    session.refreshToken = refreshToken;
    session.clientId = clientId;
  }
  return session;
}

function createDriveSessionStore(options = {}) {
  const fs = options.fs;
  const safeStorage = options.safeStorage;
  const target = String(options.target || "");
  const encode = options.encode;
  const decode = options.decode;
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  if (!fs || !target || typeof encode !== "function" || typeof decode !== "function") {
    throw new TypeError("Drive session store configuration is incomplete.");
  }
  let queue = Promise.resolve();
  const enqueue = operation => {
    const pending = queue.then(operation, operation);
    queue = pending.catch(() => {});
    return pending;
  };

  async function clearNow() {
    try {
      await fs.unlink(target);
    } catch (error) {
      if (!error || error.code !== "ENOENT") throw error;
    }
  }

  async function loadNow(expectedOwnerUid) {
    const ownerUid = cleanText(expectedOwnerUid, MAX_UID_LENGTH);
    if (!ownerUid) return null;
    let raw;
    try {
      raw = await fs.readFile(target, "utf8");
    } catch (error) {
      if (error && error.code === "ENOENT") return null;
      throw error;
    }
    let decoded;
    try {
      decoded = decode(safeStorage, raw);
    } catch (error) {
      if (error && error.code === "LOCAL_ENCRYPTION_UNAVAILABLE") throw error;
      await clearNow();
      return null;
    }
    if (!decoded || decoded.encrypted !== true) {
      await clearNow();
      return null;
    }
    const session = normalizeDriveSession(decoded.value, { now: now() });
    if (!session || session.ownerUid !== ownerUid) {
      await clearNow();
      return null;
    }
    return session;
  }

  async function saveNow(input) {
    const session = normalizeDriveSession(input, { now: now() });
    if (!session) {
      throw Object.assign(new Error("Drive 연결 정보를 안전하게 저장할 수 없습니다."), { code: "DRIVE_SESSION_INVALID" });
    }
    const directory = path.dirname(target);
    const temporary = `${target}.tmp.${process.pid}.${crypto.randomBytes(6).toString("hex")}`;
    await fs.mkdir(directory, { recursive: true });
    try {
      await fs.writeFile(temporary, encode(safeStorage, session), { encoding: "utf8", flag: "wx", mode: 0o600 });
      await fs.rename(temporary, target);
    } catch (error) {
      try {
        await fs.unlink(temporary);
      } catch (cleanupError) {
        if (!cleanupError || cleanupError.code !== "ENOENT") {
          // Do not include the path or encrypted payload in logs.
          console.warn("Drive session temporary file cleanup failed");
        }
      }
      throw error;
    }
    return session;
  }

  return Object.freeze({
    load: expectedOwnerUid => enqueue(() => loadNow(expectedOwnerUid)),
    save: session => enqueue(() => saveNow(session)),
    clear: () => enqueue(clearNow),
  });
}

module.exports = {
  MAX_SESSION_LIFETIME_MS,
  RESTORE_SAFETY_WINDOW_MS,
  createDriveSessionStore,
  normalizeDriveSession,
};
