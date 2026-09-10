const assert = require("node:assert/strict");
const test = require("node:test");
const zlib = require("node:zlib");

const {
  createMonthlyDailyLogWorkbook,
  monthlyDailyLogWorkbookFileName,
  monthlyOrderRows,
} = require("../src/daily-log-monthly-xlsx");

function unzip(bytes) {
  const entries = new Map();
  let offset = 0;
  while (offset + 4 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    const method = bytes.readUInt16LE(offset + 8);
    const compressedSize = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    const name = bytes.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const compressed = bytes.subarray(dataStart, dataEnd);
    entries.set(name, method === 8 ? zlib.inflateRawSync(compressed) : Buffer.from(compressed));
    offset = dataEnd;
  }
  return entries;
}

const logs = [
  {
    id: "u-kim_2026-09-01", uid: "u-kim", name: "김현진", date: "2026-09-01",
    submittedAt: "2026-09-01T09:00:00Z",
    entries: [
      { id: "e1", start: "09:00", end: "11:00", title: "CRM 오류 <확인>", nature: "urgent", orderId: "wo1", progress: 20, note: "저장 경로" },
      { id: "e2", start: "11:00", end: "14:00", title: "고객건물 자료 정리", nature: "routine", orderId: "", progress: 60 },
    ],
  },
  {
    id: "u-kim_2026-09-02", uid: "u-kim", name: "김현진", date: "2026-09-02",
    entries: [
      { id: "e3", start: "09:00", end: "12:00", title: "Excel 양식 작성", nature: "innovation", orderId: "wo1", progress: 70 },
    ],
  },
];

const request = {
  month: "2026-09",
  user: { uid: "u-kim", name: "김현진", department: "개발", title: "담당" },
  logs,
  orders: [{ id: "wo1", title: "10. 일일업무일지 엑셀 내보내기", assigneeUid: "u-kim", assigneeName: "김현진" }],
  now: "2026-09-09T09:00:00.000Z",
};

test("monthly daily log workbook contains the three approved sheets and typed values", () => {
  const bytes = createMonthlyDailyLogWorkbook(request);
  assert.equal(bytes.readUInt32LE(0), 0x04034b50);
  const parts = unzip(bytes);
  for (const name of ["xl/workbook.xml", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml", "xl/worksheets/sheet3.xml"]) {
    assert.ok(parts.has(name), name);
  }
  const workbook = parts.get("xl/workbook.xml").toString("utf8");
  assert.match(workbook, /sheet name="월간 요약"/u);
  assert.match(workbook, /sheet name="일별 상세"/u);
  assert.match(workbook, /sheet name="업무지시 현황"/u);
  const summary = parts.get("xl/worksheets/sheet1.xml").toString("utf8");
  const detail = parts.get("xl/worksheets/sheet2.xml").toString("utf8");
  const orders = parts.get("xl/worksheets/sheet3.xml").toString("utf8");
  assert.match(summary, /업무 성격별 현황/u);
  assert.match(summary, /주차별 현황/u);
  assert.match(detail, /CRM 오류 &lt;확인&gt;/u);
  assert.match(detail, /<c r="A6" s="6"><v>46266<\/v><\/c>/u, "날짜는 Excel 날짜값이어야 한다");
  assert.match(detail, /<c r="I6" s="7"><v>0\.2<\/v><\/c>/u, "진행률은 숫자 백분율이어야 한다");
  assert.match(orders, /10\. 일일업무일지 엑셀 내보내기/u);
  assert.match(orders, /업무지시 미연결/u);
  assert.doesNotMatch(Buffer.concat([...parts.values()]).toString("utf8"), /<script>/u);
});

test("monthly order status uses the first and last saved progress", () => {
  const rows = monthlyOrderRows(request);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].firstProgress, 20);
  assert.equal(rows[0].currentProgress, 70);
  assert.equal(rows[0].delta, 50);
  assert.equal(rows[0].hours, 5);
});

test("monthly workbook rejects another month with no saved reports and names files safely", () => {
  assert.throws(() => createMonthlyDailyLogWorkbook({ ...request, month: "2026-08" }), /저장된 업무보고서가 없습니다/u);
  assert.equal(monthlyDailyLogWorkbookFileName(request), "20260909_2026년09월_일일업무보고서_김현진.xlsx");
  assert.equal(monthlyDailyLogWorkbookFileName({ ...request, user: { uid: "u-kim", name: "김/현:진" } }), "20260909_2026년09월_일일업무보고서_김 현 진.xlsx");
});
