"use strict";

const zlib = require("node:zlib");
const DailyLogCore = require("./daily-log-core");
const TEMPLATE_BASE64 = require("./daily-log-template-base64");

const MAX_ZIP_ENTRIES = 32;
const MAX_ENTRY_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;

function xml(value) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/gu, "")
    .replace(/[&<>"']/gu, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);
}

function text(value, max = 2000) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function safeFileSegment(value) {
  return text(value, 100)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[. ]+$/u, "")
    .slice(0, 80) || "이름미등록";
}

function koreanDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(String(value || ""));
  if (!match) return "";
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][new Date(`${value}T00:00:00Z`).getUTCDay()];
  return `${match[1]}년 ${Number(match[2])}월 ${Number(match[3])}일 (${weekday}요일)`;
}

function hoursLabel(minutes) {
  const hours = Math.round((Math.max(0, Number(minutes) || 0) / 60) * 10) / 10;
  return hours ? `${hours}H` : "";
}

function unzipTemplate(bytes) {
  const entries = new Map();
  let total = 0;
  let offset = 0;
  while (offset + 4 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    if (offset + 30 > bytes.length || entries.size >= MAX_ZIP_ENTRIES) throw new Error("업무일지 원본 양식을 읽을 수 없습니다.");
    const flags = bytes.readUInt16LE(offset + 6);
    const method = bytes.readUInt16LE(offset + 8);
    const compressedSize = bytes.readUInt32LE(offset + 18);
    const uncompressedSize = bytes.readUInt32LE(offset + 22);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if ((flags & 0x0009) !== 0 || (method !== 0 && method !== 8) || dataEnd > bytes.length
      || uncompressedSize > MAX_ENTRY_BYTES) throw new Error("업무일지 원본 양식을 읽을 수 없습니다.");
    const name = bytes.subarray(nameStart, nameStart + nameLength).toString("utf8");
    if (!name || name.includes("\\") || name.startsWith("/") || name.split("/").includes("..") || entries.has(name)) {
      throw new Error("업무일지 원본 양식을 읽을 수 없습니다.");
    }
    const compressed = bytes.subarray(dataStart, dataEnd);
    const data = method === 0 ? Buffer.from(compressed) : zlib.inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES });
    if (data.length !== uncompressedSize) throw new Error("업무일지 원본 양식을 읽을 수 없습니다.");
    total += data.length;
    if (total > MAX_TOTAL_BYTES) throw new Error("업무일지 원본 양식을 읽을 수 없습니다.");
    entries.set(name, data);
    offset = dataEnd;
  }
  if (entries.size === 0 || !entries.has("xl/worksheets/sheet1.xml") || offset + 4 > bytes.length
    || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error("업무일지 원본 양식을 읽을 수 없습니다.");
  return entries;
}

function fillCell(sheet, ref, value, numeric = false) {
  const pattern = new RegExp(`<x:c\\b[^>]*\\br="${ref}"[^>]*?(?:\\/>|>[\\s\\S]*?<\\/x:c>)`, "u");
  const match = pattern.exec(sheet);
  if (!match) throw new Error(`업무일지 원본 양식에서 ${ref} 칸을 찾지 못했습니다.`);
  const start = /^<x:c\b[^>]*/u.exec(match[0])[0].replace(/\s+t="[^"]*"/gu, "").replace(/\/$/u, "");
  const body = numeric
    ? `${start}><x:v>${Number(value)}</x:v></x:c>`
    : `${start} t="inlineStr"><x:is><x:t xml:space="preserve">${xml(value)}</x:t></x:is></x:c>`;
  return `${sheet.slice(0, match.index)}${body}${sheet.slice(match.index + match[0].length)}`;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  entries.forEach((raw, name) => {
    const fileName = Buffer.from(name, "utf8");
    const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, "utf8");
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(33, 12); local.writeUInt32LE(checksum, 14); local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22); local.writeUInt16LE(fileName.length, 26); local.writeUInt16LE(0, 28);
    localParts.push(local, fileName, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(33, 14); central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(fileName.length, 28);
    central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42);
    centralParts.push(central, fileName);
    offset += local.length + fileName.length + data.length;
  });
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.size, 8); end.writeUInt16LE(entries.size, 10);
  end.writeUInt32LE(centralDirectory.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function createDailyLogWorkbook(input, options = {}) {
  const checked = DailyLogCore.validateDay(input);
  if (!checked.ok) throw new Error(checked.error || "업무보고서 내용을 확인해 주세요.");
  const report = checked.day;
  if (report.entries.length > 10 || report.plans.length > 4) {
    throw new Error("기존 업무일지 양식에는 오늘 업무 10줄, 익일 업무계획 4줄까지 넣을 수 있습니다.");
  }
  const profile = options.profile && typeof options.profile === "object" && !Array.isArray(options.profile) ? options.profile : {};
  const entries = unzipTemplate(Buffer.from(TEMPLATE_BASE64, "base64"));
  let sheet = entries.get("xl/worksheets/sheet1.xml").toString("utf8");

  sheet = fillCell(sheet, "G7", report.name);
  sheet = fillCell(sheet, "X7", text(profile.department, 60));
  sheet = fillCell(sheet, "G8", text(profile.title || profile.position, 60));
  sheet = fillCell(sheet, "X8", koreanDate(report.date));
  for (let index = 0; index < 10; index += 1) {
    const row = index + 10;
    const item = report.entries[index];
    const description = item ? `${item.title}${item.note ? ` · ${item.note}` : ""}` : "";
    sheet = fillCell(sheet, `B${row}`, item ? `${item.start} ~ ${item.end}` : "");
    sheet = fillCell(sheet, `G${row}`, description);
    sheet = fillCell(sheet, `V${row}`, item ? DailyLogCore.natureLabel(item.nature) : "");
    sheet = fillCell(sheet, `AB${row}`, item ? hoursLabel(DailyLogCore.entryMinutes(item)) : "");
    sheet = fillCell(sheet, `AF${row}`, item ? item.progress : "", Boolean(item));
  }
  for (let index = 0; index < 4; index += 1) {
    const row = index + 21;
    const item = report.plans[index];
    sheet = fillCell(sheet, `B${row}`, item ? item.title : "");
    sheet = fillCell(sheet, `V${row}`, item ? DailyLogCore.natureLabel(item.nature) : "");
    sheet = fillCell(sheet, `AB${row}`, item && item.hours ? `${item.hours}H` : "");
    sheet = fillCell(sheet, `AF${row}`, item ? item.dueDate : "");
  }
  sheet = fillCell(sheet, "B26", report.blockers);
  sheet = fillCell(sheet, "S26", report.ideas);
  sheet = fillCell(sheet, "B28", report.feedback);
  sheet = fillCell(sheet, "B30", report.requests);
  entries.set("xl/worksheets/sheet1.xml", Buffer.from(sheet, "utf8"));
  return zipStore(entries);
}

function dailyLogWorkbookFileName(input) {
  const report = DailyLogCore.normalizeDay(input);
  const date = report.date ? report.date.replace(/-/gu, "") : "날짜미정";
  return `${safeFileSegment(date)}_${safeFileSegment(report.name)}_일일업무일지.xlsx`;
}

module.exports = { createDailyLogWorkbook, dailyLogWorkbookFileName, safeFileSegment };
