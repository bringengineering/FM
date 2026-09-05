"use strict";

const OfficeCore = require("./office-core");

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function xml(value) {
  return String(value == null ? "" : value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"
  })[character]);
}

function inlineCell(ref, value, style) {
  return `<c r="${ref}" t="inlineStr"${style == null ? "" : ` s="${style}"`}><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

function numberCell(ref, value, style) {
  return `<c r="${ref}"${style == null ? "" : ` s="${style}"`}><v>${Number(value) || 0}</v></c>`;
}

function formulaCell(ref, formula, cachedValue, style) {
  return `<c r="${ref}"${style == null ? "" : ` s="${style}"`}><f>${xml(formula)}</f><v>${Number(cachedValue) || 0}</v></c>`;
}

function excelDateSerial(workDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(workDate || ""));
  if (!match) return 0;
  return Math.floor((Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) - Date.UTC(1899, 11, 30)) / 86400000);
}

function koreanTimeParts(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: OfficeCore.KOREA_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date).reduce((result, part) => {
    if (part.type !== "literal") result[part.type] = Number(part.value);
    return result;
  }, {});
  return { hour: parts.hour % 24, minute: parts.minute, second: parts.second };
}

function excelTimeFraction(value) {
  const parts = koreanTimeParts(value);
  return parts ? (parts.hour * 3600 + parts.minute * 60 + parts.second) / 86400 : 0;
}

function weekdayText(workDate) {
  const date = new Date(`${workDate}T12:00:00+09:00`);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("ko-KR", { timeZone: OfficeCore.KOREA_TIME_ZONE, weekday: "short" }).format(date);
}

function safeFileSegment(value) {
  return String(value || "직원").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "").slice(0, 60) || "직원";
}

function sheetXml({ user, month, rows, now }) {
  const sorted = rows.slice().sort((a, b) => `${a.workDate}${a.checkInAt}`.localeCompare(`${b.workDate}${b.checkInAt}`));
  const today = OfficeCore.workDate(now);
  const summary = OfficeCore.monthlyAttendanceSummary(sorted, user.uid, month, now);
  const firstDataRow = 7;
  const lastDataRow = Math.max(firstDataRow, firstDataRow + sorted.length - 1);
  const department = [user.department, user.title].filter(Boolean).join(" · ") || "BRING 구성원";
  const header = ["순번", "날짜", "요일", "출근시간", "퇴근시간", "근무 상태", "근무시간"];
  const bodyRows = sorted.length ? sorted.map((record, index) => {
    const rowNumber = firstDataRow + index;
    const status = OfficeCore.attendanceReviewStatus(record, today);
    const statusStyle = status === "퇴근 미기록" ? 9 : status === "근무 중" ? 10 : 8;
    const minutes = OfficeCore.workedMinutes(record, now);
    const cells = [
      numberCell(`A${rowNumber}`, index + 1, 3),
      numberCell(`B${rowNumber}`, excelDateSerial(record.workDate), 4),
      inlineCell(`C${rowNumber}`, weekdayText(record.workDate), 3),
      numberCell(`D${rowNumber}`, excelTimeFraction(record.checkInAt), 5),
      record.checkOutAt ? numberCell(`E${rowNumber}`, excelTimeFraction(record.checkOutAt), 5) : inlineCell(`E${rowNumber}`, "—", 3),
      inlineCell(`F${rowNumber}`, status, statusStyle),
      minutes ? numberCell(`G${rowNumber}`, minutes / 1440, 6) : inlineCell(`G${rowNumber}`, "—", 3)
    ];
    return `<row r="${rowNumber}" ht="22" customHeight="1">${cells.join("")}</row>`;
  }).join("") : `<row r="${firstDataRow}" ht="34" customHeight="1">${inlineCell(`A${firstDataRow}`, "선택한 월의 근태 기록이 없습니다.", 11)}</row>`;

  const emptyMerge = sorted.length ? "" : `<mergeCell ref="A${firstDataRow}:G${firstDataRow}"/>`;
  return `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="6" topLeftCell="A7" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="1" width="8" customWidth="1"/><col min="2" max="2" width="15" customWidth="1"/><col min="3" max="3" width="10" customWidth="1"/><col min="4" max="5" width="14" customWidth="1"/><col min="6" max="6" width="17" customWidth="1"/><col min="7" max="7" width="17" customWidth="1"/></cols><sheetData><row r="1" ht="34" customHeight="1">${inlineCell("A1", `${month} ${OfficeCore.displayName(user)} 근태 현황`, 1)}</row><row r="2" ht="24" customHeight="1">${inlineCell("A2", "직원", 2)}${inlineCell("B2", OfficeCore.displayName(user), 3)}${inlineCell("C2", "소속/직책", 2)}${inlineCell("D2", department, 3)}${inlineCell("E2", "대상 월", 2)}${inlineCell("F2", month, 3)}</row><row r="3" ht="28" customHeight="1">${inlineCell("A3", "출근 일수", 2)}${formulaCell("B3", `COUNT(B${firstDataRow}:B${lastDataRow})`, summary.attendedDays, 7)}${inlineCell("C3", "퇴근 완료", 2)}${formulaCell("D3", `COUNT(E${firstDataRow}:E${lastDataRow})`, summary.completedDays, 7)}${inlineCell("E3", "퇴근 미기록", 2)}${formulaCell("F3", `COUNTIF(F${firstDataRow}:F${lastDataRow},"퇴근 미기록")`, summary.missingCheckoutDays, 7)}</row><row r="4" ht="25" customHeight="1">${inlineCell("A4", "안내", 2)}${inlineCell("B4", "퇴근 미기록은 관리자가 확인 후 정정하는 대상입니다.", 12)}</row><row r="6" ht="26" customHeight="1">${header.map((label, index) => inlineCell(`${String.fromCharCode(65 + index)}6`, label, 2)).join("")}</row>${bodyRows}</sheetData><autoFilter ref="A6:G${lastDataRow}"/><mergeCells count="${sorted.length ? 2 : 3}"><mergeCell ref="A1:G1"/><mergeCell ref="B4:G4"/>${emptyMerge}</mergeCells><pageMargins left="0.35" right="0.35" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}

const stylesXml = `${XML_HEADER}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="hh:mm"/><numFmt numFmtId="166" formatCode="[h]&quot;시간 &quot;mm&quot;분&quot;"/></numFmts><fonts count="7"><font><sz val="10"/><name val="맑은 고딕"/></font><font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font><font><b/><sz val="13"/><color rgb="FF1D4963"/><name val="맑은 고딕"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font><font><b/><sz val="10"/><color rgb="FFC94F58"/><name val="맑은 고딕"/></font><font><b/><sz val="10"/><color rgb="FF327EAD"/><name val="맑은 고딕"/></font></fonts><fills count="8"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF287FAE"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF5FB"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8F8F2"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFECEC"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8F2FF"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF7FAFC"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><bottom style="thin"><color rgb="FFD7E5EC"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="13"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="3" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="5" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="6" fillId="6" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="7" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

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
  Object.entries(entries).forEach(([name, raw]) => {
    const fileName = Buffer.from(name, "utf8");
    const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, "utf8");
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, fileName, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, fileName);
    offset += local.length + fileName.length + data.length;
  });
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function createAttendanceWorkbook({ user, month, rows, now }) {
  if (!user || !user.uid || !/^\d{4}-\d{2}$/.test(String(month || "")) || !Array.isArray(rows)) throw new Error("근태 엑셀 요청이 올바르지 않습니다.");
  const safeRows = OfficeCore.monthlyAttendance(rows, user.uid, month);
  const createdAt = new Date(now || Date.now()).toISOString();
  const entries = {
    "[Content_Types].xml": `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    "_rels/.rels": `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    "docProps/app.xml": `${XML_HEADER}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>BRING CRM</Application></Properties>`,
    "docProps/core.xml": `${XML_HEADER}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(`${month} 근태 현황`)}</dc:title><dc:creator>BRING CRM</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created></cp:coreProperties>`,
    "xl/workbook.xml": `${XML_HEADER}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="월별 근태현황" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
    "xl/_rels/workbook.xml.rels": `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": stylesXml,
    "xl/worksheets/sheet1.xml": sheetXml({ user, month, rows: safeRows, now })
  };
  return zipStore(entries);
}

module.exports = { createAttendanceWorkbook, excelDateSerial, excelTimeFraction, safeFileSegment };
