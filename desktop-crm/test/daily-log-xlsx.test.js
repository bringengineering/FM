const assert = require("node:assert/strict");
const test = require("node:test");
const zlib = require("node:zlib");

const TEMPLATE_BASE64 = require("../src/daily-log-template-base64");
const { createDailyLogWorkbook, dailyLogWorkbookFileName } = require("../src/daily-log-xlsx");

function report(overrides = {}) {
  return {
    uid: "uid-member",
    name: "김현진",
    date: "2026-09-07",
    entries: [
      { id: "e1", start: "09:00", end: "10:00", title: "햇빛빌라 점검", nature: "routine", progress: 80, note: "옥상 확인" },
      { id: "e2", start: "10:00", end: "12:00", title: "견적서 작성", nature: "innovation", progress: 100 },
    ],
    plans: [{ id: "p1", title: "견적 전달", nature: "urgent", hours: 1, dueDate: "2026-09-08" }],
    blockers: "건물주 회신 대기",
    ideas: "점검표 개선",
    feedback: "오늘 계획을 지켰습니다.",
    requests: "오후 일정 조정 요청",
    submittedAt: "2026-09-07T09:01:02.000Z",
    updatedAt: "2026-09-07T09:01:02.000Z",
    ...overrides,
  };
}

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

const targetRefs = ["G7", "X7", "G8", "X8", "B26", "S26", "B28", "B30"];
for (let row = 10; row <= 19; row += 1) for (const col of ["B", "G", "V", "AB", "AF"]) targetRefs.push(`${col}${row}`);
for (let row = 21; row <= 24; row += 1) for (const col of ["B", "V", "AB", "AF"]) targetRefs.push(`${col}${row}`);

function eraseTargetValues(sheet) {
  let normalized = sheet;
  for (const ref of targetRefs) {
    const pattern = new RegExp(`<x:c\\b[^>]*\\br="${ref}"[^>]*?(?:\\/>|>[\\s\\S]*?<\\/x:c>)`, "u");
    normalized = normalized.replace(pattern, match => {
      const start = /^<x:c\b[^>]*/u.exec(match)[0].replace(/\s+t="[^"]*"/gu, "").replace(/\/$/u, "");
      return `${start}>__VALUE__</x:c>`;
    });
  }
  return normalized;
}

test("daily log workbook changes only the original template's designated blank cells", () => {
  const output = unzip(createDailyLogWorkbook(report(), { profile: { department: "R&D", title: "사원" } }));
  const template = unzip(Buffer.from(TEMPLATE_BASE64, "base64"));
  assert.deepEqual([...output.keys()], [...template.keys()]);
  for (const [name, value] of template) {
    if (name !== "xl/worksheets/sheet1.xml") assert.deepEqual(output.get(name), value, `${name} must remain byte-identical`);
  }
  const before = template.get("xl/worksheets/sheet1.xml").toString("utf8");
  const after = output.get("xl/worksheets/sheet1.xml").toString("utf8");
  assert.equal(eraseTargetValues(after), eraseTargetValues(before));
  for (const value of ["김현진", "R&amp;D", "사원", "2026년 9월 7일 (월요일)", "햇빛빌라 점검 · 옥상 확인", "혁신", "견적 전달", "점검표 개선"]) {
    assert.ok(after.includes(value), `missing filled value: ${value}`);
  }
  assert.match(after, /<x:row r="10"[^>]*ht="55\.5"/u);
  assert.match(after, /<x:mergeCell ref="B2:W5"\/>/u);
  assert.match(after, /<x:mergeCell ref="B30:AI30"\/>/u);
  assert.match(after, /<x:pageSetup[^>]*fitToWidth="1"/u);
  assert.match(after, /<x:pageSetup[^>]*orientation="portrait"/u);
  assert.doesNotMatch(Buffer.concat([...output.values()]).toString("utf8"), /uid-member/u);
});

test("daily log workbook escapes cell values and names the file safely", () => {
  const output = unzip(createDailyLogWorkbook(report({ name: "김<현>/진", blockers: "<script>alert(1)</script>" })));
  const sheet = output.get("xl/worksheets/sheet1.xml").toString("utf8");
  assert.doesNotMatch(sheet, /<script>/u);
  assert.match(sheet, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.equal(dailyLogWorkbookFileName(report()), "20260907_김현진_일일업무일지.xlsx");
  assert.equal(dailyLogWorkbookFileName(report({ name: "김/현:진" })), "20260907_김 현 진_일일업무일지.xlsx");
});

test("daily log workbook refuses to resize the fixed original form", () => {
  const manyEntries = Array.from({ length: 11 }, (_, index) => ({ id: `e${index}`, start: "09:00", end: "10:00", title: `업무 ${index}`, nature: "routine", progress: 50 }));
  assert.throws(() => createDailyLogWorkbook(report({ entries: manyEntries })), /오늘 업무 10줄/u);
  const manyPlans = Array.from({ length: 5 }, (_, index) => ({ id: `p${index}`, title: `계획 ${index}`, nature: "routine", hours: 1 }));
  assert.throws(() => createDailyLogWorkbook(report({ plans: manyPlans })), /익일 업무계획 4줄/u);
});
