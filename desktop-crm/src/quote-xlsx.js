"use strict";

const QuoteCore = require("./quote-core");
const { safeFileSegment } = require("./attendance-xlsx");

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

function quoteSheetXml(input) {
  const quote = QuoteCore.normalizeDraft(input);
  const firstItemRow = 8;
  const rows = quote.items.map((item, index) => {
    const row = firstItemRow + index;
    const total = QuoteCore.itemTotal(item);
    return `<row r="${row}" ht="38" customHeight="1">${numberCell(`A${row}`, index + 1, 5)}${inlineCell(`B${row}`, item.name, 4)}${inlineCell(`C${row}`, item.detail, 4)}${numberCell(`D${row}`, item.quantity, 5)}${inlineCell(`E${row}`, item.unit, 5)}${numberCell(`F${row}`, item.unitPrice, 6)}${formulaCell(`G${row}`, `D${row}*F${row}`, total, 6)}${inlineCell(`H${row}`, item.note, 4)}</row>`;
  }).join("");
  const lastItemRow = firstItemRow + quote.items.length - 1;
  const supplyRow = lastItemRow + 2;
  const vatRow = supplyRow + 1;
  const totalRow = vatRow + 1;
  const noteRow = totalRow + 2;
  const notes = quote.notes.map((note, index) => `${index + 1}. ${note}`).join("\n");
  return `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="21"/><cols><col min="1" max="1" width="11" customWidth="1"/><col min="2" max="2" width="24" customWidth="1"/><col min="3" max="3" width="42" customWidth="1"/><col min="4" max="5" width="12" customWidth="1"/><col min="6" max="6" width="16" customWidth="1"/><col min="7" max="8" width="18" customWidth="1"/></cols><sheetData><row r="1" ht="42" customHeight="1">${inlineCell("A1", "견 적 서", 1)}</row><row r="2" ht="26" customHeight="1">${inlineCell("A2", quote.company.brand, 2)}${inlineCell("F2", "등록번호", 3)}${inlineCell("G2", quote.company.registrationNumber, 4)}</row><row r="3">${inlineCell("A3", "수신", 3)}${inlineCell("B3", `${quote.recipient} 귀중`, 4)}${inlineCell("F3", "상호", 3)}${inlineCell("G3", quote.company.businessName, 4)}</row><row r="4">${inlineCell("A4", "견적명", 3)}${inlineCell("B4", quote.projectName, 4)}${inlineCell("F4", "대표자", 3)}${inlineCell("G4", quote.company.representative, 4)}</row><row r="5">${inlineCell("A5", "발행일", 3)}${inlineCell("B5", quote.quoteDate, 4)}${inlineCell("D5", "유효기간", 3)}${inlineCell("E5", quote.validUntil, 4)}</row><row r="6" ht="34" customHeight="1">${inlineCell("A6", "요약", 3)}${inlineCell("B6", quote.summary, 4)}</row><row r="7" ht="28" customHeight="1">${["No.", "품목", "상세 내용", "수량", "단위", "단가", "금액", "비고"].map((label, index) => inlineCell(`${String.fromCharCode(65 + index)}7`, label, 3)).join("")}</row>${rows}<row r="${supplyRow}">${inlineCell(`F${supplyRow}`, "공급가액", 7)}${numberCell(`G${supplyRow}`, quote.supplyAmount, 6)}</row><row r="${vatRow}">${inlineCell(`F${vatRow}`, "부가세", 7)}${numberCell(`G${vatRow}`, quote.vatAmount, 6)}</row><row r="${totalRow}" ht="30" customHeight="1">${inlineCell(`F${totalRow}`, "합계금액", 8)}${formulaCell(`G${totalRow}`, `SUM(G${firstItemRow}:G${lastItemRow})`, quote.totalAmount, 9)}</row><row r="${noteRow}" ht="64" customHeight="1">${inlineCell(`A${noteRow}`, "안내", 3)}${inlineCell(`B${noteRow}`, notes, 10)}</row><row r="${noteRow + 2}" ht="28" customHeight="1">${inlineCell(`A${noteRow + 2}`, quote.company.businessName || quote.company.name, 11)}</row></sheetData><mergeCells count="11"><mergeCell ref="A1:H1"/><mergeCell ref="A2:E2"/><mergeCell ref="G2:H2"/><mergeCell ref="B3:E3"/><mergeCell ref="G3:H3"/><mergeCell ref="B4:E4"/><mergeCell ref="G4:H4"/><mergeCell ref="B5:C5"/><mergeCell ref="E5:H5"/><mergeCell ref="B6:H6"/><mergeCell ref="B${noteRow}:H${noteRow}"/></mergeCells><pageMargins left="0.3" right="0.3" top="0.45" bottom="0.45" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="1" paperSize="9"/></worksheet>`;
}

const stylesXml = `${XML_HEADER}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0&quot;원&quot;"/></numFmts><fonts count="5"><font><sz val="10"/><name val="맑은 고딕"/></font><font><b/><sz val="22"/><color rgb="FF173F56"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><color rgb="FF173F56"/><name val="맑은 고딕"/></font><font><b/><sz val="14"/><color rgb="FF173F56"/><name val="맑은 고딕"/></font></fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF173F56"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF5FB"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF4F8FA"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFD5E3EA"/></left><right style="thin"><color rgb="FFD5E3EA"/></right><top style="thin"><color rgb="FFD5E3EA"/></top><bottom style="thin"><color rgb="FFD5E3EA"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="12"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="164" fontId="2" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function createQuoteWorkbook(input, now) {
  const quote = QuoteCore.normalizeDraft(input);
  const createdAt = new Date(now || Date.now()).toISOString();
  const entries = {
    "[Content_Types].xml": `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    "_rels/.rels": `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    "docProps/app.xml": `${XML_HEADER}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>BRING CRM</Application></Properties>`,
    "docProps/core.xml": `${XML_HEADER}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(quote.projectName)}</dc:title><dc:creator>BRING CRM</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created></cp:coreProperties>`,
    "xl/workbook.xml": `${XML_HEADER}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="견적서" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
    "xl/_rels/workbook.xml.rels": `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": stylesXml,
    "xl/worksheets/sheet1.xml": quoteSheetXml(quote)
  };
  return zipStore(entries);
}

function quoteFileName(input, extension) {
  const quote = QuoteCore.normalizeDraft(input);
  return `${safeFileSegment(QuoteCore.fileBase(quote))}_견적서.${extension}`;
}

module.exports = { createQuoteWorkbook, quoteSheetXml, quoteFileName };
