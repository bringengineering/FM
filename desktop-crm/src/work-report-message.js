"use strict";
const Reports = require("./work-report-core");
const line = value => String(value || "").replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();

function shortAddress(value) {
  const raw = line(value);
  if (!raw || raw.length > 300) throw new Error("보고서의 현장 주소를 확인해 주세요.");
  const base = raw.replace(/\([^)]*\)/gu, " ").split(",")[0].trim();
  const words = base.split(/\s+/u);
  const road = words.findIndex((word, index) => /(?:대로|로|길)$/u.test(word) && /^\d+(?:-\d+)?$/u.test(words[index + 1] || ""));
  const lot = road < 0 ? words.findIndex((word, index) => /[^\d](?:동|읍|면|리)$/u.test(word)
    && (/^(?:산)?\d+(?:-\d+)?(?:번지)?$/u.test(words[index + 1] || "") || words[index + 1] === "산" && /^\d+(?:-\d+)?$/u.test(words[index + 2] || ""))) : -1;
  const index = road >= 0 ? road : lot;
  let result = base;
  if (index >= 0) {
    const admin = words.slice(0, index).filter(word => /(?:시|군|구|읍|면)$/u.test(word) && !/^\d/u.test(word)
      || /^(?:서울|부산|대구|인천|광주|대전|울산|세종)$/u.test(word))
      .map(word => word.replace(/특별자치시$/u, "시").replace(/(?:특별시|광역시)$/u, ""));
    const end = index + (words[index + 1] === "산" ? 3 : 2);
    result = [...admin, ...words.slice(index, end)].join(" ");
  }
  result = line(result);
  if (!result || result.length > 80) throw new Error("알림톡에 표시할 현장 주소를 도로명·건물번호 중심으로 확인해 주세요.");
  return result;
}

function details(report, building) {
  building ||= {};
  const buildingAddress = shortAddress(report?.siteAddress || building.roadAddress || building.jibunAddress || building.address);
  const title = line(report?.title).replace(/\s*결과\s*보고서$/u, "").trim();
  const workName = title && title !== "작업" ? title : Reports.kindLabel(report?.kind);
  if (!workName || workName.length > 200) throw new Error("알림톡에 표시할 작업명을 200자 이내로 확인해 주세요.");
  return {buildingAddress, workName};
}

function documentName(value) { return `${value.buildingAddress} ${value.workName} 결과보고서`; }

module.exports = {shortAddress, details, documentName};
