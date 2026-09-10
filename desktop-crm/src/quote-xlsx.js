"use strict";

const QuoteCore = require("./quote-core");
const { safeFileSegment } = require("./attendance-xlsx");

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const COPY_CONFIG = Object.freeze({
  recipient: Object.freeze({ label: "공급받는자용 견적서", sheetName: "공급받는자용 견적서", color: "FF1454D8", light: "FFEFF4FF" }),
  supplier: Object.freeze({ label: "공급자 보관용 견적서", sheetName: "공급자 보관용 견적서", color: "FFE25A67", light: "FFFFF2F3" })
});

function xml(value) {
  return String(value == null ? "" : value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"
  })[character]);
}

function copyConfig(copyType) {
  const config = COPY_CONFIG[copyType];
  if (!config) throw new Error("견적서 종류를 확인해 주세요.");
  return config;
}

function cellAttributes(ref, style) {
  return ` r="${ref}"${style == null ? "" : ` s="${style}"`}`;
}

function inlineCell(ref, value, style) {
  return `<c${cellAttributes(ref, style)} t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

function numberCell(ref, value, style) {
  return `<c${cellAttributes(ref, style)}><v>${Number(value) || 0}</v></c>`;
}

function booleanCell(ref, value, style) {
  return `<c${cellAttributes(ref, style)} t="b"><v>${value ? 1 : 0}</v></c>`;
}

function dateCell(ref, value, style) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return inlineCell(ref, "", style);
  const [year, month, day] = String(value).split("-").map(Number);
  return numberCell(ref, Math.floor(Date.UTC(year, month - 1, day) / 86400000) + 25569, style);
}

function formulaCell(ref, formula, cachedValue, style) {
  return `<c${cellAttributes(ref, style)}><f>${xml(formula)}</f><v>${Number(cachedValue) || 0}</v></c>`;
}

function mergeXml(ranges) {
  return `<mergeCells count="${ranges.length}">${ranges.map(ref => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>`;
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
  Object.entries(entries).forEach(([name, raw]) => {
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
  end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function quoteStylesXml(copyType) {
  const config = copyConfig(copyType);
  return `${XML_HEADER}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0&quot;원&quot;"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd"/></numFmts><fonts count="7"><font><sz val="10"/><name val="맑은 고딕"/></font><font><b/><sz val="24"/><color rgb="${config.color}"/><name val="맑은 고딕"/></font><font><b/><sz val="10"/><color rgb="${config.color}"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font><font><b/><sz val="10"/><color rgb="FF24364B"/><name val="맑은 고딕"/></font><font><b/><sz val="16"/><color rgb="${config.color}"/><name val="맑은 고딕"/></font><font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font></fonts><fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="${config.color}"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="${config.light}"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF5F7FA"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF24364B"/></patternFill></fill></fills><borders count="5"><border/><border><left style="thin"><color rgb="FFD3DCE6"/></left><right style="thin"><color rgb="FFD3DCE6"/></right><top style="thin"><color rgb="FFD3DCE6"/></top><bottom style="thin"><color rgb="FFD3DCE6"/></bottom></border><border><left style="medium"><color rgb="${config.color}"/></left><right style="medium"><color rgb="${config.color}"/></right><top style="medium"><color rgb="${config.color}"/></top><bottom style="medium"><color rgb="${config.color}"/></bottom></border><border><left style="thin"><color rgb="${config.color}"/></left><right style="thin"><color rgb="${config.color}"/></right><top style="thin"><color rgb="${config.color}"/></top><bottom style="thin"><color rgb="${config.color}"/></bottom></border><border><left style="medium"><color rgb="${config.color}"/></left><right style="medium"><color rgb="${config.color}"/></right><top style="medium"><color rgb="${config.color}"/></top><bottom style="medium"><color rgb="${config.color}"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="21"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="4" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="3" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="3" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="3" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="3" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="3" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="3" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="3" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="3" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="164" fontId="5" fillId="3" borderId="3" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="3" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="164" fontId="5" fillId="3" borderId="3" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="3" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="6" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="4" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="3" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

function centeredQuoteStyles(styles) {
  return styles
    .replace('fontId="0" fillId="0" borderId="3" xfId="0" applyAlignment="1"><alignment horizontal="left"', 'fontId="0" fillId="0" borderId="3" xfId="0" applyAlignment="1"><alignment horizontal="center"')
    .replaceAll('borderId="3" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right"', 'borderId="3" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center"')
    .replace('<b/><sz val="16"/>', '<b/><sz val="14"/>');
}

function spacedDisplayName(value) {
  return Array.from(String(value || "").replace(/\s+/g, "")).join(" ");
}

function adjustedQuoteSheetXml(sheet, representative) {
  const displayName = spacedDisplayName(representative);
  return sheet
    .replace('<row r="23" ht="34"', '<row r="23" ht="32"')
    .replace('<c r="A23" s="11" t="inlineStr"><is><t xml:space="preserve">합계</t>', '<c r="A23" s="11" t="inlineStr"><is><t xml:space="preserve">합계금액 (VAT 포함)</t>')
    .replace('<c r="J23" s="12">', '<c r="J23" s="8">')
    .replace('<c r="K23" s="12">', '<c r="K23" s="8">')
    .replace('<c r="B9" s="4" t="inlineStr"><is><t xml:space="preserve"></t></is></c><c r="D9" s="5" t="inlineStr"><is><t xml:space="preserve"></t></is></c>', '')
    .replace(inlineCell("J6", representative, 5), inlineCell("J6", displayName, 5))
    .replace(inlineCell("E29", `공급자 확인  ${representative || ""}`, 20), inlineCell("E29", `공급자 확인  ${displayName}`, 20));
}

function rawQuoteSheetXml(input, copyType = "recipient", hasSeal = false) {
  const quote = QuoteCore.normalizeDraft(input);
  copyConfig(copyType);
  const itemStart = 13;
  const itemEnd = 22;
  const itemRows = [];
  const itemMerges = [];
  for (let index = 0; index < 10; index += 1) {
    const row = itemStart + index;
    const item = quote.items[index];
    itemMerges.push(`B${row}:D${row}`, `E${row}:F${row}`);
    if (!item) {
      itemRows.push(`<row r="${row}" ht="27" customHeight="1">${inlineCell(`A${row}`, "", 6)}${inlineCell(`B${row}`, "", 5)}${inlineCell(`E${row}`, "", 5)}${inlineCell(`G${row}`, "", 6)}${inlineCell(`H${row}`, "", 6)}${inlineCell(`I${row}`, "", 8)}${inlineCell(`J${row}`, "", 8)}${inlineCell(`K${row}`, "", 8)}${inlineCell(`L${row}`, "", 8)}</row>`);
      continue;
    }
    const total = QuoteCore.itemTotal(item);
    const supply = Math.round(total / 1.1);
    itemRows.push(`<row r="${row}" ht="34" customHeight="1">${numberCell(`A${row}`, index + 1, 6)}${inlineCell(`B${row}`, item.name, 5)}${inlineCell(`E${row}`, item.detail, 5)}${numberCell(`G${row}`, item.quantity, 6)}${inlineCell(`H${row}`, item.unit, 6)}${numberCell(`I${row}`, item.unitPrice, 8)}${formulaCell(`J${row}`, `ROUND(G${row}*I${row}/1.1,0)`, supply, 8)}${formulaCell(`K${row}`, `G${row}*I${row}-J${row}`, total - supply, 8)}${formulaCell(`L${row}`, `G${row}*I${row}`, total, 8)}</row>`);
  }
  const merges = [
    "A1:L1", "A2:L2", "A4:A10", "G4:G10",
    "B4:C4", "D4:F4", "H4:I4", "J4:L4", "B5:C5", "D5:F5", "H5:I5", "J5:L5",
    "B6:C6", "D6:F6", "H6:I6", "J6:K6", "B7:C7", "D7:F7", "H7:I7", "J7:L7",
    "B8:C9", "D8:F9", "H8:I8", "J8:L8", "H9:I9", "J9:L9",
    "B10:C10", "D10:F10", "I10:J10", "B12:D12", "E12:F12", ...itemMerges,
    "A23:I23", "A25:L25", "A26:L26", "A27:L27", "A29:D29", "E29:H29", "I29:L29"
  ];
  const noteOne = quote.siteAddress ? `현장 주소: ${quote.siteAddress}` : (quote.notes[0] || "작업 범위와 현장 상태에 따라 금액이 조정될 수 있습니다.");
  const noteTwo = quote.siteAddress ? (quote.notes[0] || "작업 범위와 현장 상태에 따라 금액이 조정될 수 있습니다.") : (quote.notes[1] || "견적 유효기간은 발행일로부터 7일입니다.");
  const relationshipNamespace = hasSeal ? ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' : "";
  const drawing = hasSeal ? '<drawing r:id="rId1"/>' : "";
  return `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"${relationshipNamespace}><sheetViews><sheetView showGridLines="0" tabSelected="1" workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="22"/><cols><col min="1" max="1" width="5" customWidth="1"/><col min="2" max="3" width="8" customWidth="1"/><col min="4" max="4" width="16" customWidth="1"/><col min="5" max="6" width="14" customWidth="1"/><col min="7" max="8" width="8" customWidth="1"/><col min="9" max="12" width="13" customWidth="1"/></cols><sheetData><row r="1" ht="48" customHeight="1">${inlineCell("A1", "견  적  서", 1)}</row><row r="2" ht="26" customHeight="1">${inlineCell("A2", "BRING ENGINEERING", 2)}</row><row r="4" ht="31" customHeight="1">${inlineCell("A4", "공\n급\n받\n는\n자", 19)}${inlineCell("B4", "성명", 4)}${inlineCell("D4", quote.recipient, 5)}${inlineCell("G4", "공\n급\n자", 19)}${inlineCell("H4", "사업자등록번호", 4)}${inlineCell("J4", quote.company.registrationNumber, 5)}</row><row r="5" ht="31" customHeight="1">${inlineCell("B5", "전화번호", 4)}${inlineCell("D5", quote.recipientPhone, 5)}${inlineCell("H5", "상호", 4)}${inlineCell("J5", quote.company.businessName, 5)}</row><row r="6" ht="31" customHeight="1">${inlineCell("B6", "발행일", 4)}${dateCell("D6", quote.quoteDate, 7)}${inlineCell("H6", "대표자", 4)}${inlineCell("J6", quote.company.representative, 5)}${inlineCell("L6", "", 5)}</row><row r="7" ht="46" customHeight="1">${inlineCell("B7", "유효일", 4)}${dateCell("D7", quote.validUntil, 7)}${inlineCell("H7", "소재지", 4)}${inlineCell("J7", quote.company.address, 5)}</row><row r="8" ht="39" customHeight="1">${inlineCell("B8", "견적명", 4)}${inlineCell("D8", quote.projectName, 5)}${inlineCell("H8", "업태", 4)}${inlineCell("J8", quote.company.businessType, 5)}</row><row r="9" ht="39" customHeight="1">${inlineCell("B9", "", 4)}${inlineCell("D9", "", 5)}${inlineCell("H9", "업종", 4)}${inlineCell("J9", quote.company.businessCategory, 5)}</row><row r="10" ht="37" customHeight="1">${inlineCell("B10", "합계금액 (VAT 포함)", 4)}${formulaCell("D10", `SUM(L${itemStart}:L${itemEnd})`, quote.totalAmount, 10)}${inlineCell("H10", "공급가액", 4)}${formulaCell("I10", `SUM(J${itemStart}:J${itemEnd})`, quote.supplyAmount, 8)}${inlineCell("K10", "세액", 4)}${formulaCell("L10", `SUM(K${itemStart}:K${itemEnd})`, quote.vatAmount, 8)}</row><row r="12" ht="29" customHeight="1">${inlineCell("A12", "번호", 3)}${inlineCell("B12", "품목", 3)}${inlineCell("E12", "규격 및 상세", 3)}${inlineCell("G12", "수량", 3)}${inlineCell("H12", "단위", 3)}${inlineCell("I12", "단가", 3)}${inlineCell("J12", "공급가액", 3)}${inlineCell("K12", "세액", 3)}${inlineCell("L12", "합계", 3)}</row>${itemRows.join("")}<row r="23" ht="34" customHeight="1">${inlineCell("A23", "합계", 11)}${formulaCell("J23", `SUM(J${itemStart}:J${itemEnd})`, quote.supplyAmount, 12)}${formulaCell("K23", `SUM(K${itemStart}:K${itemEnd})`, quote.vatAmount, 12)}${formulaCell("L23", `SUM(L${itemStart}:L${itemEnd})`, quote.totalAmount, 12)}</row><row r="25" ht="28" customHeight="1">${inlineCell("A25", "안내 사항", 11)}</row><row r="26" ht="28" customHeight="1">${inlineCell("A26", `1. ${noteOne}`, 13)}</row><row r="27" ht="28" customHeight="1">${inlineCell("A27", `2. ${noteTwo}`, 13)}</row><row r="29" ht="42" customHeight="1">${inlineCell("A29", `작성일  ${quote.quoteDate}`, 20)}${inlineCell("E29", `공급자 확인  ${quote.company.representative || ""}`, 20)}${inlineCell("I29", `공급받는자 확인  ${quote.recipient || ""}`, 20)}</row></sheetData>${mergeXml(merges)}${drawing}<pageMargins left="0.25" right="0.25" top="0.25" bottom="0.25" header="0.1" footer="0.1"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="1" paperSize="9"/><printOptions horizontalCentered="1"/></worksheet>`;
}

function quoteSheetXml(input, copyType = "recipient", hasSeal = false) {
  const quote = QuoteCore.normalizeDraft(input);
  return adjustedQuoteSheetXml(rawQuoteSheetXml(quote, copyType, hasSeal), quote.company.representative);
}

function rawOcrDataSheetXml(input, copyType = "recipient") {
  const quote = QuoteCore.normalizeDraft(input);
  const config = copyConfig(copyType);
  const quotedSheet = `'${config.sheetName}'`;
  const fields = [
    ["DOCUMENT_TYPE", "문서 종류", "견적서", "TEXT"],
    ["RECIPIENT_NAME", "공급받는자 성명", quote.recipient, "TEXT"],
    ["RECIPIENT_PHONE", "공급받는자 전화번호", quote.recipientPhone, "TEXT"],
    ["SITE_ADDRESS", "현장 주소", quote.siteAddress, "TEXT"],
    ["SUPPLIER_NAME", "공급자 상호", quote.company.businessName, "TEXT"],
    ["SUPPLIER_REPRESENTATIVE", "공급자 대표자", quote.company.representative, "TEXT"],
    ["SUPPLIER_BUSINESS_NUMBER", "공급자 사업자등록번호", quote.company.registrationNumber, "TEXT"],
    ["SUPPLIER_ADDRESS", "공급자 소재지", quote.company.address, "TEXT"],
    ["SUPPLIER_BUSINESS_TYPE", "공급자 업태", quote.company.businessType, "TEXT"],
    ["SUPPLIER_BUSINESS_CATEGORY", "공급자 업종", quote.company.businessCategory, "TEXT"],
    ["PROJECT_NAME", "견적명", quote.projectName, "TEXT"]
  ];
  const fieldRows = fields.map((field, index) => {
    const row = 4 + index;
    return `<row r="${row}">${inlineCell(`A${row}`, field[0], 16)}${inlineCell(`B${row}`, field[1], 16)}${inlineCell(`C${row}`, field[2], 16)}${inlineCell(`D${row}`, field[3], 16)}</row>`;
  }).join("");
  const typedRows = `<row r="15">${inlineCell("A15", "ISSUE_DATE", 16)}${inlineCell("B15", "발행일", 16)}${dateCell("C15", quote.quoteDate, 17)}${inlineCell("D15", "DATE", 16)}</row><row r="16">${inlineCell("A16", "VALID_UNTIL", 16)}${inlineCell("B16", "유효일", 16)}${dateCell("C16", quote.validUntil, 17)}${inlineCell("D16", "DATE", 16)}</row><row r="17">${inlineCell("A17", "CURRENCY", 16)}${inlineCell("B17", "통화", 16)}${inlineCell("C17", "KRW", 16)}${inlineCell("D17", "TEXT", 16)}</row><row r="18">${inlineCell("A18", "SUPPLY_AMOUNT", 16)}${inlineCell("B18", "공급가액", 16)}${formulaCell("C18", `${quotedSheet}!J23`, quote.supplyAmount, 18)}${inlineCell("D18", "NUMBER", 16)}</row><row r="19">${inlineCell("A19", "TAX_AMOUNT", 16)}${inlineCell("B19", "세액", 16)}${formulaCell("C19", `${quotedSheet}!K23`, quote.vatAmount, 18)}${inlineCell("D19", "NUMBER", 16)}</row><row r="20">${inlineCell("A20", "TOTAL_AMOUNT", 16)}${inlineCell("B20", "합계금액", 16)}${formulaCell("C20", `${quotedSheet}!L23`, quote.totalAmount, 18)}${inlineCell("D20", "NUMBER", 16)}</row><row r="21">${inlineCell("A21", "TAX_INCLUDED", 16)}${inlineCell("B21", "VAT 포함", 16)}${inlineCell("C21", "TRUE", 16)}${inlineCell("D21", "BOOLEAN", 16)}</row>`;
  const itemRows = quote.items.map((item, index) => {
    const row = 25 + index;
    const sourceRow = 13 + index;
    const total = QuoteCore.itemTotal(item);
    const supply = Math.round(total / 1.1);
    return `<row r="${row}">${numberCell(`A${row}`, index + 1, 6)}${inlineCell(`B${row}`, item.name, 16)}${inlineCell(`C${row}`, item.detail, 16)}${numberCell(`D${row}`, item.quantity, 6)}${inlineCell(`E${row}`, item.unit, 16)}${numberCell(`F${row}`, item.unitPrice, 18)}${formulaCell(`G${row}`, `${quotedSheet}!J${sourceRow}`, supply, 18)}${formulaCell(`H${row}`, `${quotedSheet}!K${sourceRow}`, total - supply, 18)}${formulaCell(`I${row}`, `${quotedSheet}!L${sourceRow}`, total, 18)}</row>`;
  }).join("");
  return `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="23"/><cols><col min="1" max="1" width="31" customWidth="1"/><col min="2" max="2" width="28" customWidth="1"/><col min="3" max="3" width="45" customWidth="1"/><col min="4" max="5" width="14" customWidth="1"/><col min="6" max="9" width="17" customWidth="1"/></cols><sheetData><row r="1" ht="36" customHeight="1">${inlineCell("A1", "OCR_DATA", 14)}</row><row r="2" ht="25" customHeight="1">${inlineCell("A2", "정규화된 필드와 품목 데이터입니다. AI·OCR·자동화 도구는 이 시트를 우선 읽습니다.", 13)}</row><row r="3" ht="27" customHeight="1">${inlineCell("A3", "FIELD_KEY", 15)}${inlineCell("B3", "한글 라벨", 15)}${inlineCell("C3", "값", 15)}${inlineCell("D3", "데이터 형식", 15)}</row>${fieldRows}${typedRows}<row r="23" ht="27" customHeight="1">${inlineCell("A23", "ITEM_NO", 15)}${inlineCell("B23", "ITEM_NAME", 15)}${inlineCell("C23", "ITEM_DESCRIPTION", 15)}${inlineCell("D23", "QUANTITY", 15)}${inlineCell("E23", "UNIT", 15)}${inlineCell("F23", "UNIT_PRICE", 15)}${inlineCell("G23", "SUPPLY_AMOUNT", 15)}${inlineCell("H23", "TAX_AMOUNT", 15)}${inlineCell("I23", "LINE_TOTAL", 15)}</row><row r="24" ht="25" customHeight="1">${inlineCell("A24", "번호", 4)}${inlineCell("B24", "품목", 4)}${inlineCell("C24", "규격 및 상세", 4)}${inlineCell("D24", "수량", 4)}${inlineCell("E24", "단위", 4)}${inlineCell("F24", "단가", 4)}${inlineCell("G24", "공급가액", 4)}${inlineCell("H24", "세액", 4)}${inlineCell("I24", "합계", 4)}</row>${itemRows}</sheetData>${mergeXml(["A1:I1", "A2:I2"])}<autoFilter ref="A23:I${Math.max(25, 24 + quote.items.length)}"/><pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0" paperSize="9"/></worksheet>`;
}

function ocrDataSheetXml(input, copyType = "recipient") {
  return rawOcrDataSheetXml(input, copyType)
    .replace('<col min="3" max="3" width="45" customWidth="1"/>', '<col min="3" max="3" width="76" customWidth="1"/>');
}

function normalizeSealImage(value) {
  if (value == null) return null;
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.length || buffer.length > 512 * 1024 || !buffer.subarray(0, 8).equals(pngSignature)) {
    throw new Error("견적서 인감 이미지는 512KB 이하 PNG 파일이어야 합니다.");
  }
  return buffer;
}

function baseSealDrawingXml() {
  return `${XML_HEADER}<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:oneCellAnchor><xdr:from><xdr:col>11</xdr:col><xdr:colOff>60000</xdr:colOff><xdr:row>5</xdr:row><xdr:rowOff>25000</xdr:rowOff></xdr:from><xdr:ext cx="330000" cy="330000"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="공급자 인감" descr="견적서 공급자 인감"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="330000" cy="330000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`;
}

function sealDrawingXml() {
  const confirmationSeal = '<xdr:oneCellAnchor><xdr:from><xdr:col>7</xdr:col><xdr:colOff>250000</xdr:colOff><xdr:row>28</xdr:row><xdr:rowOff>75000</xdr:rowOff></xdr:from><xdr:ext cx="300000" cy="300000"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="공급자 확인 인감" descr="견적서 하단 공급자 확인 인감"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="300000" cy="300000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>';
  return baseSealDrawingXml().replace('</xdr:wsDr>', `${confirmationSeal}</xdr:wsDr>`);
}

function createQuoteWorkbook(input, copyType = "recipient", now, sealImage) {
  const quote = QuoteCore.normalizeDraft(input);
  const config = copyConfig(copyType);
  const createdAt = new Date(now || Date.now()).toISOString();
  const seal = normalizeSealImage(sealImage);
  const sealContentTypes = seal ? '<Default Extension="png" ContentType="image/png"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : "";
  const entries = {
    "[Content_Types].xml": `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${sealContentTypes}<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    "_rels/.rels": `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    "docProps/app.xml": `${XML_HEADER}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>BRING CRM</Application></Properties>`,
    "docProps/core.xml": `${XML_HEADER}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(`${quote.projectName} ${config.label}`)}</dc:title><dc:subject>OCR READY QUOTATION</dc:subject><dc:creator>BRING CRM</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created></cp:coreProperties>`,
    "xl/workbook.xml": `${XML_HEADER}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${config.sheetName}" sheetId="1" r:id="rId1"/><sheet name="OCR_DATA" sheetId="2" r:id="rId2"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
    "xl/_rels/workbook.xml.rels": `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": centeredQuoteStyles(quoteStylesXml(copyType)),
    "xl/worksheets/sheet1.xml": quoteSheetXml(quote, copyType, Boolean(seal)),
    "xl/worksheets/sheet2.xml": ocrDataSheetXml(quote, copyType)
  };
  if (seal) {
    entries["xl/worksheets/_rels/sheet1.xml.rels"] = `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`;
    entries["xl/drawings/drawing1.xml"] = sealDrawingXml();
    entries["xl/drawings/_rels/drawing1.xml.rels"] = `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/quote-seal.png"/></Relationships>`;
    entries["xl/media/quote-seal.png"] = seal;
  }
  return zipStore(entries);
}

function quoteFileName(input, copyType = "recipient") {
  const quote = QuoteCore.normalizeDraft(input);
  return `${safeFileSegment(QuoteCore.fileBase(quote))}_${copyConfig(copyType).sheetName}.xlsx`;
}

module.exports = { COPY_CONFIG, createQuoteWorkbook, quoteSheetXml, ocrDataSheetXml, quoteFileName };
