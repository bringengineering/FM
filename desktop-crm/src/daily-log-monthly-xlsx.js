"use strict";

const DailyLogCore = require("./daily-log-core");
const WorkOrderCore = require("./work-order-core");
const { safeFileSegment } = require("./daily-log-xlsx");

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAX_LOGS = 370;

function xml(value) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/gu, "")
    .replace(/[&<>"']/gu, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);
}

function cellAttributes(ref, style) {
  return ` r="${ref}"${style == null ? "" : ` s="${style}"`}`;
}

function inlineCell(ref, value, style = 3) {
  return `<c${cellAttributes(ref, style)} t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

function numberCell(ref, value, style = 5) {
  const number = Number(value);
  return `<c${cellAttributes(ref, style)}><v>${Number.isFinite(number) ? number : 0}</v></c>`;
}

function dateSerial(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(String(value || ""));
  if (!match) return 0;
  return Math.floor((Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) - Date.UTC(1899, 11, 30)) / 86400000);
}

function dateCell(ref, value) {
  return dateSerial(value) ? numberCell(ref, dateSerial(value), 6) : inlineCell(ref, "", 3);
}

function percentCell(ref, value, style = 7) {
  return numberCell(ref, Math.min(100, Math.max(0, Number(value) || 0)) / 100, style);
}

function row(number, cells, height = 23) {
  return `<row r="${number}" ht="${height}" customHeight="1">${cells.join("")}</row>`;
}

function mergeXml(ranges) {
  return ranges.length ? `<mergeCells count="${ranges.length}">${ranges.map(ref => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>` : "";
}

function worksheetXml({ columns, rows, merges = [], frozenRows = 0, autoFilter = "", landscape = true }) {
  const pane = frozenRows
    ? `<pane ySplit="${frozenRows}" topLeftCell="A${frozenRows + 1}" activePane="bottomLeft" state="frozen"/>`
    : "";
  return `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView showGridLines="0" workbookViewId="0">${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="20"/><cols>${columns.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols><sheetData>${rows.join("")}</sheetData>${autoFilter ? `<autoFilter ref="${autoFilter}"/>` : ""}${mergeXml(merges)}<pageMargins left="0.3" right="0.3" top="0.45" bottom="0.45" header="0.2" footer="0.2"/><pageSetup orientation="${landscape ? "landscape" : "portrait"}" fitToWidth="1" fitToHeight="0" paperSize="9"/></worksheet>`;
}

function monthRange(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}` };
}

function weekday(value) {
  return ["일", "월", "화", "수", "목", "금", "토"][new Date(`${value}T00:00:00Z`).getUTCDay()] || "";
}

function normalizeInput(input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const month = String(source.month || "").trim();
  const userSource = source.user && typeof source.user === "object" && !Array.isArray(source.user) ? source.user : {};
  const uid = String(userSource.uid || "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(month) || !/^[A-Za-z0-9._-]{1,128}$/u.test(uid)) {
    throw new Error("월간 업무보고서 요청을 확인해 주세요.");
  }
  if (!Array.isArray(source.logs) || source.logs.length > MAX_LOGS || !Array.isArray(source.orders)) {
    throw new Error("월간 업무보고서 자료를 확인해 주세요.");
  }
  const logs = source.logs.map(DailyLogCore.normalizeDay)
    .filter(day => day.uid === uid && day.date.startsWith(`${month}-`) && day.entries.some(DailyLogCore.entryOk));
  if (!logs.length) throw new Error("선택한 달에 저장된 업무보고서가 없습니다.");
  return {
    month,
    logs,
    orders: source.orders.map(WorkOrderCore.normalizeOrder).filter(order => order.id),
    user: {
      uid,
      name: String(userSource.name || userSource.displayName || userSource.email || uid).trim().slice(0, 80),
      department: String(userSource.department || "").trim().slice(0, 60),
      title: String(userSource.title || userSource.position || "").trim().slice(0, 60),
    },
    now: new Date(source.now || Date.now()),
  };
}

function orderTitleMap(orders) {
  return new Map(orders.map(order => [order.id, order.title || order.id]));
}

function summarySheet(input, summary) {
  const range = monthRange(input.month);
  const created = input.now.toISOString().slice(0, 10);
  const rows = [];
  rows.push(row(1, [inlineCell("A1", `BRING ENGINEERING · ${input.month.slice(0, 4)}년 ${input.month.slice(5, 7)}월 일일업무보고서`, 1)], 36));
  rows.push(row(2, [inlineCell("A2", "작성자", 2), inlineCell("B2", input.user.name), inlineCell("C2", "출력일", 2), dateCell("D2", created), inlineCell("E2", "", 3)]));
  rows.push(row(3, [inlineCell("A3", "대상 기간", 2), inlineCell("B3", `${range.from} ~ ${range.to}`), inlineCell("C3", "소속·직책", 2), inlineCell("D3", [input.user.department, input.user.title].filter(Boolean).join(" · ") || "미입력"), inlineCell("E3", "", 3)]));
  rows.push(row(5, [inlineCell("A5", "작성된 날짜", 4), inlineCell("B5", "총 업무시간", 4), inlineCell("C5", "연결 지시", 4), inlineCell("D5", "평균 달성률", 4), inlineCell("E5", "미작성 평일", 4)], 25));
  rows.push(row(6, [numberCell("A6", summary.written, 15), numberCell("B6", summary.hours, 10), numberCell("C6", summary.linkedOrders, 15), percentCell("D6", summary.weightedProgress), numberCell("E6", summary.missing.length, 9)], 30));
  rows.push(row(8, [inlineCell("A8", "업무 성격별 현황", 13)], 27));
  rows.push(row(9, ["업무 성격", "투입시간", "시간 비율", "평균 달성률", "업무 건수"].map((label, index) => inlineCell(`${String.fromCharCode(65 + index)}9`, label, 4)), 25));
  summary.byNature.forEach((item, index) => {
    const at = 10 + index;
    rows.push(row(at, [inlineCell(`A${at}`, item.label), numberCell(`B${at}`, item.hours, 10), percentCell(`C${at}`, item.percent), percentCell(`D${at}`, item.weightedProgress), numberCell(`E${at}`, item.entries)]));
  });
  rows.push(row(13, [inlineCell("A13", "합계", 8), numberCell("B13", summary.hours, 10), percentCell("C13", 100), percentCell("D13", summary.weightedProgress), numberCell("E13", summary.entries, 8)]));
  rows.push(row(15, [inlineCell("A15", "주차별 현황", 13)], 27));
  rows.push(row(16, ["주차", "작성일", "업무시간", "평균 달성률", "연결 지시"].map((label, index) => inlineCell(`${String.fromCharCode(65 + index)}16`, label, 4)), 25));
  summary.weeks.forEach((item, index) => {
    const at = 17 + index;
    rows.push(row(at, [inlineCell(`A${at}`, item.label), numberCell(`B${at}`, item.written), numberCell(`C${at}`, item.hours, 10), percentCell(`D${at}`, item.weightedProgress), numberCell(`E${at}`, item.linkedOrders)]));
  });
  const noteRow = 18 + summary.weeks.length;
  rows.push(row(noteRow, [inlineCell(`A${noteRow}`, `※ 저장된 보고서만 집계합니다. 하루 안에서 겹친 ${summary.overlapMinutes}분은 총 업무시간에서 한 번만 계산했습니다.`, 11)], 28));
  return worksheetXml({
    columns: [20, 20, 20, 20, 20],
    rows: rows.filter(Boolean),
    merges: ["A1:E1", "D2:E2", "D3:E3", "A8:E8", "A15:E15", `A${noteRow}:E${noteRow}`],
    frozenRows: 3,
  });
}

function detailSheet(input, summary) {
  const range = monthRange(input.month);
  const titleById = orderTitleMap(input.orders);
  const details = input.logs.flatMap(day => day.entries.filter(DailyLogCore.entryOk).map(entry => ({ day, entry })))
    .sort((a, b) => `${a.day.date}${a.entry.start}${a.entry.id}`.localeCompare(`${b.day.date}${b.entry.start}${b.entry.id}`));
  const rows = [
    row(1, [inlineCell("A1", `일별 상세 · ${input.month.slice(0, 4)}년 ${input.month.slice(5, 7)}월`, 1)], 36),
    row(2, [inlineCell("A2", "작성자", 2), inlineCell("B2", input.user.name), inlineCell("D2", "총 기록", 2), numberCell("E2", details.length), inlineCell("G2", "총 업무시간", 2), numberCell("H2", summary.hours, 10)]),
    row(3, [inlineCell("A3", "대상 기간", 2), inlineCell("B3", `${range.from} ~ ${range.to}`), inlineCell("D3", "제출된 일지", 2), numberCell("E3", summary.submitted), inlineCell("G3", "연결 지시", 2), numberCell("H3", summary.linkedOrders)]),
    row(5, ["날짜", "요일", "시작", "종료", "시간", "업무 내용", "성격", "연결 업무지시", "달성률", "특이사항"].map((label, index) => inlineCell(`${String.fromCharCode(65 + index)}5`, label, 4)), 27),
  ];
  details.forEach((item, index) => {
    const at = 6 + index;
    rows.push(row(at, [
      dateCell(`A${at}`, item.day.date),
      inlineCell(`B${at}`, weekday(item.day.date)),
      inlineCell(`C${at}`, item.entry.start),
      inlineCell(`D${at}`, item.entry.end),
      numberCell(`E${at}`, DailyLogCore.entryMinutes(item.entry) / 60, 10),
      inlineCell(`F${at}`, item.entry.title, 12),
      inlineCell(`G${at}`, DailyLogCore.natureLabel(item.entry.nature)),
      inlineCell(`H${at}`, item.entry.orderId ? (titleById.get(item.entry.orderId) || item.entry.orderId) : ""),
      percentCell(`I${at}`, item.entry.progress),
      inlineCell(`J${at}`, item.entry.note, 12),
    ], 25));
  });
  const totalRow = 6 + details.length;
  rows.push(row(totalRow, [inlineCell(`A${totalRow}`, "표시된 기록 합계", 8), inlineCell(`B${totalRow}`, "", 8), inlineCell(`C${totalRow}`, "", 8), inlineCell(`D${totalRow}`, "", 8), numberCell(`E${totalRow}`, summary.hours, 10), numberCell(`F${totalRow}`, details.length, 8), inlineCell(`G${totalRow}`, "", 8), inlineCell(`H${totalRow}`, "", 8), percentCell(`I${totalRow}`, summary.weightedProgress), inlineCell(`J${totalRow}`, "", 8)]));
  const noteRow = totalRow + 2;
  rows.push(row(noteRow, [inlineCell(`A${noteRow}`, "※ 실제 파일에는 선택한 달의 저장된 기록이 날짜·시간 순서로 표시됩니다.", 11)], 28));
  return worksheetXml({
    columns: [14, 8, 10, 10, 9, 35, 11, 34, 11, 30],
    rows,
    merges: ["A1:J1", "B2:C2", "E2:F2", "H2:J2", "B3:C3", "E3:F3", "H3:J3", `A${noteRow}:J${noteRow}`],
    frozenRows: 5,
    autoFilter: `A5:J${Math.max(6, totalRow - 1)}`,
  });
}

function monthlyOrderRows(input) {
  const titleById = orderTitleMap(input.orders);
  const buckets = new Map();
  input.logs.forEach(day => {
    day.entries.filter(DailyLogCore.entryOk).filter(entry => entry.orderId).forEach(entry => {
      if (!buckets.has(entry.orderId)) buckets.set(entry.orderId, []);
      buckets.get(entry.orderId).push({ date: day.date, entry });
    });
  });
  return [...buckets.entries()].map(([orderId, records]) => {
    records.sort((a, b) => `${a.date}${a.entry.start}${a.entry.end}`.localeCompare(`${b.date}${b.entry.start}${b.entry.end}`));
    const first = records[0];
    const last = records[records.length - 1];
    return {
      orderId,
      title: titleById.get(orderId) || orderId,
      firstProgress: first.entry.progress,
      currentProgress: last.entry.progress,
      delta: last.entry.progress - first.entry.progress,
      hours: DailyLogCore.toHours(records.reduce((total, item) => total + DailyLogCore.entryMinutes(item.entry), 0)),
      lastDate: last.date,
    };
  }).sort((a, b) => b.hours - a.hours || a.title.localeCompare(b.title, "ko"));
}

function ordersSheet(input, summary) {
  const range = monthRange(input.month);
  const orders = monthlyOrderRows(input);
  const rows = [
    row(1, [inlineCell("A1", `업무지시 현황 · ${input.month.slice(0, 4)}년 ${input.month.slice(5, 7)}월`, 1)], 36),
    row(2, [inlineCell("A2", "작성자", 2), inlineCell("B2", input.user.name), inlineCell("D2", "연결 지시", 2), numberCell("E2", orders.length), inlineCell("F2", "총 투입시간", 2), numberCell("G2", orders.reduce((total, item) => total + item.hours, 0), 10)]),
    row(3, [inlineCell("A3", "대상 기간", 2), inlineCell("B3", `${range.from} ~ ${range.to}`), inlineCell("D3", "기준", 2), inlineCell("E3", "대상 월 첫 기록 → 마지막 기록"), inlineCell("F3", "", 3), inlineCell("G3", "", 3)]),
    row(5, ["업무지시명", "담당자", "월 첫 진행률", "현재 진행률", "변화", "투입시간", "마지막 기록"].map((label, index) => inlineCell(`${String.fromCharCode(65 + index)}5`, label, 4)), 27),
  ];
  if (orders.length) {
    orders.forEach((item, index) => {
      const at = 6 + index;
      rows.push(row(at, [inlineCell(`A${at}`, item.title, 12), inlineCell(`B${at}`, input.user.name), percentCell(`C${at}`, item.firstProgress), percentCell(`D${at}`, item.currentProgress), numberCell(`E${at}`, item.delta / 100, 14), numberCell(`F${at}`, item.hours, 10), dateCell(`G${at}`, item.lastDate)], 25));
    });
  } else {
    rows.push(row(6, [inlineCell("A6", "연결된 업무지시가 없습니다.", 11)], 30));
  }
  const totalRow = 6 + Math.max(orders.length, 1);
  const averageDelta = orders.length ? orders.reduce((total, item) => total + item.delta, 0) / orders.length : 0;
  rows.push(row(totalRow, [inlineCell(`A${totalRow}`, "표시된 업무지시 합계", 8), inlineCell(`B${totalRow}`, "", 8), inlineCell(`C${totalRow}`, "", 8), inlineCell(`D${totalRow}`, "", 8), numberCell(`E${totalRow}`, averageDelta / 100, 14), numberCell(`F${totalRow}`, orders.reduce((total, item) => total + item.hours, 0), 10), inlineCell(`G${totalRow}`, "", 8)]));
  const sectionRow = totalRow + 2;
  rows.push(row(sectionRow, [inlineCell(`A${sectionRow}`, "업무지시에 연결하지 않은 시간", 13)], 27));
  rows.push(row(sectionRow + 1, [inlineCell(`A${sectionRow + 1}`, "구분", 4), inlineCell(`B${sectionRow + 1}`, "업무시간", 4), inlineCell(`C${sectionRow + 1}`, "전체 시간 비율", 4), inlineCell(`D${sectionRow + 1}`, "확인 내용", 4)]));
  rows.push(row(sectionRow + 2, [inlineCell(`A${sectionRow + 2}`, "업무지시 미연결"), numberCell(`B${sectionRow + 2}`, DailyLogCore.toHours(summary.looseMinutes), 10), percentCell(`C${sectionRow + 2}`, summary.sumMinutes ? (summary.looseMinutes / summary.sumMinutes) * 100 : 0), inlineCell(`D${sectionRow + 2}`, "일별 상세 시트에서 빈 업무지시 칸으로 확인", 12)]));
  const noteRow = sectionRow + 4;
  rows.push(row(noteRow, [inlineCell(`A${noteRow}`, "※ 시작 진행률은 대상 월의 첫 기록, 현재 진행률은 마지막 저장 기록을 사용합니다.", 11)], 28));
  const merges = ["A1:G1", "B2:C2", "B3:C3", "E3:G3", `A${sectionRow}:G${sectionRow}`, `D${sectionRow + 1}:G${sectionRow + 1}`, `D${sectionRow + 2}:G${sectionRow + 2}`, `A${noteRow}:G${noteRow}`];
  if (!orders.length) merges.push("A6:G6");
  return worksheetXml({
    columns: [43, 15, 16, 16, 13, 14, 16],
    rows,
    merges,
    frozenRows: 5,
    autoFilter: orders.length ? `A5:G${5 + orders.length}` : "",
  });
}

const stylesXml = `${XML_HEADER}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="4"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="0.0&quot;시간&quot;"/><numFmt numFmtId="166" formatCode="0%"/><numFmt numFmtId="167" formatCode="+0%;-0%;0%"/></numFmts><fonts count="5"><font><sz val="10"/><name val="맑은 고딕"/></font><font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font><font><b/><sz val="10"/><color rgb="FF17324D"/><name val="맑은 고딕"/></font><font><sz val="9"/><color rgb="FF748392"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font></fonts><fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9EAF7"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE4EBF0"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF0CF"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE6F4EC"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFC7D3DD"/></left><right style="thin"><color rgb="FFC7D3DD"/></right><top style="thin"><color rgb="FFC7D3DD"/></top><bottom style="thin"><color rgb="FFC7D3DD"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="16"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="4" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="167" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="6" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

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

function createMonthlyDailyLogWorkbook(raw) {
  const input = normalizeInput(raw);
  const asOf = input.now.toISOString().slice(0, 10);
  const summary = DailyLogCore.monthRollup({ days: input.logs, uid: input.user.uid, month: input.month, asOf });
  const createdAt = input.now.toISOString();
  const entries = {
    "[Content_Types].xml": `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    "_rels/.rels": `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    "docProps/app.xml": `${XML_HEADER}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>BRING CRM</Application></Properties>`,
    "docProps/core.xml": `${XML_HEADER}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(`${input.month} ${input.user.name} 일일업무보고서`)}</dc:title><dc:creator>BRING CRM</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created></cp:coreProperties>`,
    "xl/workbook.xml": `${XML_HEADER}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="월간 요약" sheetId="1" r:id="rId1"/><sheet name="일별 상세" sheetId="2" r:id="rId2"/><sheet name="업무지시 현황" sheetId="3" r:id="rId3"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
    "xl/_rels/workbook.xml.rels": `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": stylesXml,
    "xl/worksheets/sheet1.xml": summarySheet(input, summary),
    "xl/worksheets/sheet2.xml": detailSheet(input, summary),
    "xl/worksheets/sheet3.xml": ordersSheet(input, summary),
  };
  return zipStore(entries);
}

function monthlyDailyLogWorkbookFileName(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const month = /^\d{4}-(0[1-9]|1[0-2])$/u.test(String(source.month || "")) ? String(source.month) : "월미정";
  const now = new Date(source.now || Date.now());
  const issued = Number.isNaN(now.getTime()) ? "날짜미정" : now.toISOString().slice(0, 10).replace(/-/gu, "");
  const user = source.user && typeof source.user === "object" ? source.user : {};
  const name = user.name || user.displayName || user.email || user.uid;
  return `${safeFileSegment(issued)}_${safeFileSegment(month.replace("-", "년") + (month.includes("-") ? "월" : ""))}_일일업무보고서_${safeFileSegment(name)}.xlsx`;
}

module.exports = {
  createMonthlyDailyLogWorkbook,
  monthlyDailyLogWorkbookFileName,
  monthlyOrderRows,
  dateSerial,
};
