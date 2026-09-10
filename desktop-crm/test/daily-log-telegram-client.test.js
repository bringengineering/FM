const assert = require("node:assert/strict");
const test = require("node:test");

const { sendDailyLogToTelegram, validateInput } = require("../src/daily-log-telegram-client");
const { createDailyLogWorkbook } = require("../src/daily-log-xlsx");

function report(overrides = {}) {
  return {
    uid: "uid-member",
    name: "김현진",
    date: "2026-09-07",
    entries: [{ id: "e1", start: "09:00", end: "10:00", title: "현장 점검", nature: "routine", progress: 70 }],
    plans: [{ id: "p1", title: "견적 전달", nature: "routine", hours: 1, dueDate: "2026-09-08" }],
    blockers: "회신 대기",
    aiSummary: "오늘 현장 점검을 진행했습니다.",
    submittedAt: "2026-09-07T09:01:02.000Z",
    updatedAt: "2026-09-07T09:01:02.000Z",
    ignored: "전송 금지",
    ...overrides,
  };
}

test("daily report Telegram client sends only a normalized saved report and Firebase bearer token", async () => {
  let captured;
  const xlsxBytes = createDailyLogWorkbook(report());
  const result = await sendDailyLogToTelegram({
    endpoint: "https://gateway.example/v1/telegram/daily-report",
    idToken: "firebase-token",
    input: report(),
    xlsxBytes,
    fileName: "20260907_김현진_일일업무보고서.xlsx",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response(JSON.stringify({ ok: true, requestId: "tg-1", sent: true, duplicate: false }), { status: 200 });
    },
  });
  assert.deepEqual(result, { ok: true, requestId: "tg-1", sent: true, duplicate: false });
  assert.equal(captured.options.headers.authorization, "Bearer firebase-token");
  assert.equal(captured.options.headers["content-type"], undefined, "multipart boundary는 fetch가 안전하게 만든다");
  const body = JSON.parse(captured.options.body.get("report"));
  assert.equal(body.uid, "uid-member");
  assert.deepEqual(body.entries, [{ start: "09:00", end: "10:00", title: "현장 점검", progress: 70 }]);
  assert.equal(body.ignored, undefined);
  const document = captured.options.body.get("document");
  assert.equal(document.type, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(document.name, "20260907_김현진_일일업무보고서.xlsx");
  assert.equal(Buffer.from(await document.arrayBuffer()).readUInt32LE(0), 0x04034b50);
});

test("daily report Telegram client rejects drafts, malformed endpoints, and unsafe responses", async () => {
  assert.throws(() => validateInput(report({ submittedAt: "" })), error => error?.code === "INVALID_INPUT");
  await assert.rejects(() => sendDailyLogToTelegram({
    endpoint: "http://gateway.example/v1/telegram/daily-report",
    idToken: "token",
    input: report(),
    xlsxBytes: createDailyLogWorkbook(report()),
    fileName: "report.xlsx",
  }), error => error?.code === "TELEGRAM_CONFIGURATION_ERROR");
  await assert.rejects(() => sendDailyLogToTelegram({
    endpoint: "https://gateway.example/v1/telegram/daily-report",
    idToken: "token",
    input: report(),
    xlsxBytes: Buffer.from("not a workbook"),
    fileName: "report.xlsx",
  }), error => error?.code === "XLSX_REQUIRED");
  await assert.rejects(() => sendDailyLogToTelegram({
    endpoint: "https://gateway.example/v1/telegram/daily-report",
    idToken: "token",
    input: report(),
    xlsxBytes: createDailyLogWorkbook(report()),
    fileName: "report.xlsx",
    fetchImpl: async () => new Response(JSON.stringify({ ok: false, code: "TELEGRAM_NOT_CONFIGURED", detail: "secret" }), { status: 503 }),
  }), error => error?.code === "TELEGRAM_NOT_CONFIGURED" && !error.message.includes("secret"));
});
