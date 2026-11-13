"use strict";

const crypto = require("node:crypto");
const path = require("node:path");

function normalizeFolder(value) {
  if (!value || !/^[A-Za-z0-9_-]{10,200}$/u.test(String(value.id || ""))) return null;
  const name = String(value.name || "").replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, 180);
  if (!name) return null;
  return { id: value.id, name, driveId: /^[A-Za-z0-9_-]{10,200}$/u.test(String(value.driveId || "")) ? value.driveId : "", kind: "folder", parentId: "" };
}

// Only the main process supplies identity and a folder previously listed in the picker.
// A separate encrypted file per CRM/Google account prevents cross-account reuse.
function createMonthlyPhotoSourceStore({ fs, directory, safeStorage, encode, decode }) {
  function target(uid, account) {
    if (!uid || !account) throw new Error("회사 Drive 연결을 확인해 주세요.");
    const key = crypto.createHash("sha256").update(JSON.stringify([uid, account.toLowerCase()])).digest("hex");
    return path.join(directory, `monthly-photo-source-${key}.json`);
  }
  return {
    async load(uid, account) {
      const file = target(uid, account);
      try {
        if ((await fs.stat(file)).size > 16000) return null;
        const decoded = decode(safeStorage, await fs.readFile(file, "utf8"));
        return decoded.encrypted === true ? normalizeFolder(decoded.value) : null;
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw new Error("활동사진 폴더 설정을 읽지 못했습니다. 폴더를 다시 지정해 주세요.");
      }
    },
    async save(uid, account, folder) {
      const normalized = normalizeFolder(folder);
      if (!normalized) throw new Error("활동사진 폴더를 다시 선택해 주세요.");
      const file = target(uid, account);
      const encoded = encode(safeStorage, normalized);
      if (!decode(safeStorage, encoded).encrypted) throw new Error("안전한 로컬 저장소를 사용할 수 없습니다.");
      await fs.mkdir(directory, { recursive: true });
      const temporary = `${file}.${crypto.randomBytes(8).toString("hex")}.tmp`;
      try {
        await fs.writeFile(temporary, encoded, { mode: 0o600, flag: "wx" });
        await fs.rename(temporary, file);
      } finally { await fs.unlink(temporary).catch(() => {}); }
      return normalized;
    },
  };
}

module.exports = { normalizeFolder, createMonthlyPhotoSourceStore };
