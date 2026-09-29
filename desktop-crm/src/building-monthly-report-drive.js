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
  const match = /^(\d{6})[_ -]+(.{1,200})$/u.exec(name);
  if (!match || !match[1].startsWith(`${reportMonth.slice(2, 4)}${reportMonth.slice(5, 7)}`)) return null;
  const compact = match[1];
  const date = `20${compact.slice(0, 2)}-${compact.slice(2, 4)}-${compact.slice(4, 6)}`;
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) return null;
  const identityAndActivity = match[2].trim();
  const activityMatch = /^(.*?)\(([^()]*)\)\s*$/u.exec(identityAndActivity);
  const identity = String(activityMatch ? activityMatch[1] : identityAndActivity).trim();
  const activityName = String(activityMatch ? activityMatch[2] : "").trim().slice(0, 100);
  const expected = String(buildingName || buildingAddress || "").trim();
  const expectedWord = normalizeWord(expected);
  if (!expectedWord || !normalizeWord(identity).includes(expectedWord)) return null;
  return Object.freeze({ date, activityName });
}

module.exports = Object.freeze({ parseActivityFolderName, normalizeWord, activityCategory });
