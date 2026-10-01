"use strict";

function normalizeWord(value) {
  return String(value || "").normalize("NFKC").replace(/[\s·・.,_()[\]{}-]/gu, "").toLowerCase();
}

function activityCategory(value) {
  const text = String(value || "").normalize("NFKC").slice(0, 120);
  const categories = [
    [/에어컨|냉난방|필터/iu, "냉난방·필터 점검"],
    [/냉장고|냉동고/iu, "냉장고 상태 확인"],
    [/후드|환풍|환기/iu, "후드·환기 점검"],
    [/누수|배관|수도|배수/iu, "배관·누수 점검"],
    [/전기|조명|콘센트/iu, "전기·조명 점검"],
    [/소방|화재|감지기/iu, "소방 설비 점검"],
    [/승강기|엘리베이터/iu, "승강기 점검"],
    [/방수|옥상|외벽/iu, "외부·방수 점검"],
    [/보일러|난방/iu, "난방 설비 점검"],
    [/해충|방역/iu, "방역"],
    [/청소|미화|정리/iu, "청소·정리"],
    [/창호|도어|출입|잠금/iu, "출입·창호 점검"],
  ];
  return categories.find(([pattern]) => pattern.test(text))?.[1] || "건물 시설 관리";
}

function parseActivityFolderName(value, month, buildingName, buildingAddress) {
  const reportMonth = String(month || "");
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(reportMonth)) return null;
  const name = String(value || "").trim().slice(0, 220);
  const match = /^(\d{8}|\d{6})[_ -]+(.{1,200})$/u.exec(name);
  if (!match) return null;
  const compact = match[1].length === 8 && match[1].startsWith("20") ? match[1].slice(2) : match[1];
  if (compact.length !== 6 || !compact.startsWith(`${reportMonth.slice(2, 4)}${reportMonth.slice(5, 7)}`)) return null;
  const date = `20${compact.slice(0, 2)}-${compact.slice(2, 4)}-${compact.slice(4, 6)}`;
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) return null;
  const identityAndActivity = match[2].trim();
  const activityMatch = /^(.*?)\(([^()]*)\)\s*$/u.exec(identityAndActivity);
  const identity = String(activityMatch ? activityMatch[1] : identityAndActivity).trim();
  const activityName = String(activityMatch ? activityMatch[2] : "").trim().slice(0, 100);
  const expected = String(buildingName || buildingAddress || "").trim();
  const expectedWord = normalizeWord(expected);
  // Substring matching could silently mix e.g. 햇빛빌라 and 햇빛빌라2.
  if (!expectedWord || normalizeWord(identity) !== expectedWord) return null;
  return Object.freeze({ date, activityName });
}

async function findActivityFolders({ root, month, buildingName, buildingAddress, list, assertCurrent = () => {} }) {
  const queue = [{ folder: root, depth: 0 }];
  const visited = new Set();
  const matches = [];
  let truncated = false;
  while (queue.length && visited.size < 60 && matches.length < 40) {
    assertCurrent();
    const { folder, depth } = queue.shift();
    if (visited.has(folder.id)) continue;
    visited.add(folder.id);
    const parsed = parseActivityFolderName(folder.name, month, buildingName, buildingAddress);
    if (parsed) { matches.push({ item: folder, parsed }); continue; }
    // Never descend into a dated folder for a different month/building.
    if (/^\d{6,8}[_ -]/u.test(folder.name || "")) continue;
    const children = await list(folder);
    assertCurrent();
    truncated ||= children.truncated === true;
    for (const child of children.folders || []) {
      if (!/^[A-Za-z0-9_-]{10,200}$/u.test(String(child.id || ""))) continue;
      if (/^\d{6,8}[_ -]/u.test(child.name || "") && !parseActivityFolderName(child.name, month, buildingName, buildingAddress)) continue;
      const grouping = String(child.name || "").trim();
      if (/^20\d{2}년?$/u.test(grouping) && grouping.slice(0, 4) !== month.slice(0, 4)) continue;
      const yearMonth = /^(20\d{2})[.\-_년 ]+(\d{1,2})월?$/u.exec(grouping);
      if (yearMonth && `${yearMonth[1]}-${yearMonth[2].padStart(2, "0")}` !== month) continue;
      const item = { ...child, parentId: folder.id, driveId: root.driveId || "" };
      if (depth < 3 && queue.length < 160) queue.push({ folder: item, depth: depth + 1 });
      else truncated = true;
    }
  }
  return { folders: matches.sort((a, b) => a.parsed.date.localeCompare(b.parsed.date) || a.item.id.localeCompare(b.item.id)), truncated: truncated || queue.length > 0 };
}

module.exports = Object.freeze({ parseActivityFolderName, normalizeWord, activityCategory, findActivityFolders });
