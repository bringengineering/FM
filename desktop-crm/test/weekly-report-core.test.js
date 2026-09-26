const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Weekly = require("../src/weekly-report-core");

test("주간 범위는 월요일부터 일요일까지 고정한다", () => {
  assert.deepEqual(Weekly.weekRange("2026-09-23"), { start: "2026-09-21", end: "2026-09-27" });
  assert.equal(Weekly.rangeLabel("2026-09-23"), "9월 21일(월) – 9월 27일(일)");
  assert.equal(Weekly.weekStart("2026-09-27"), "2026-09-21");
});

test("현재 사용자의 의미 있는 CRM 업무만 모으고 다른 사람과 단순 예정 기록은 제외한다", () => {
  const actor = { uid: "uid-kim", name: "김현진", email: "kim@example.com" };
  const result = Weekly.collect({
    week: "2026-09-23",
    actor,
    orders: [
      { id: "o1", title: "제안서 제작", assigneeUid: "uid-kim", status: "doing", progressUpdates: [{ id: "p1", note: "초안 완성", createdBy: "uid-kim", createdAt: "2026-09-22T03:00:00.000Z" }] },
      { id: "o2", title: "다른 사람 업무", assigneeUid: "uid-other", status: "done", updatedBy: "uid-other", updatedAt: "2026-09-22T03:00:00.000Z" },
      { id: "o3", title: "변경 없는 배정", assigneeUid: "uid-kim", status: "assigned", createdAt: "2026-08-01T03:00:00.000Z" },
    ],
    projects: [{ id: "p1", name: "CRM 고도화", assignees: [{ uid: "uid-kim", name: "김현진" }], status: "active", progressNote: "화면 정리", progressUpdatedBy: "uid-kim", progressUpdatedAt: "2026-09-23T02:00:00.000Z" }],
    cases: [{ id: "c1", summary: "누수 민원 조치", assignee: "김현진", status: "completed", completedAt: "2026-09-24T01:00:00.000Z" }],
    store: {
      serviceRecords: [{ id: "s1", title: "현장 점검", owner: "김현진", status: "completed", completedAt: "2026-09-25T05:00:00.000Z" }],
      activities: [{ id: "a1", owner: "김현진", occurredAt: "2026-09-23T06:00:00.000Z", summary: "레이브클라우드 유선미팅", result: "후속 자료 전달" }],
      contracts: [], buildingDocuments: [], partnerQuotes: [],
    },
  });

  assert.deepEqual(result.items.map(item => item.title), ["현장 점검", "누수 민원 조치", "레이브클라우드 유선미팅", "CRM 고도화", "제안서 제작"]);
  assert.equal(result.candidates.some(item => item.title === "다른 사람 업무"), false);
  assert.equal(result.candidates.some(item => item.title === "변경 없는 배정"), false);
  const roadmap = result.candidates.find(item => item.title === "CRM 고도화");
  assert.equal(roadmap.source, "로드맵");
  assert.equal(roadmap.detail, "화면 정리");
});

test("업무지시는 예정으로 뭉개지 않고 실제 업무지시 상태를 표시한다", () => {
  const actor = { uid: "uid-kim", name: "김현진", email: "kim@example.com" };
  const order = (id, title, status) => ({
    id, title, status, assigneeUid: actor.uid,
    progressUpdates: [{ note: `${title} 상태 확인`, createdBy: actor.uid, createdAt: "2026-09-23T03:00:00.000Z" }],
  });
  const result = Weekly.collect({
    week: "2026-09-23",
    actor,
    orders: [
      order("assigned", "배정 업무", "assigned"),
      order("doing", "진행 업무", "doing"),
      order("submitted", "검수 업무", "submitted"),
      order("returned", "보완 업무", "returned"),
      order("done", "완료 업무", "done"),
    ],
  });
  const statuses = Object.fromEntries(result.candidates.map(item => [item.title, item.status]));

  assert.deepEqual(statuses, {
    "배정 업무": "assigned",
    "진행 업무": "in_progress",
    "검수 업무": "submitted",
    "보완 업무": "returned",
    "완료 업무": "completed",
  });
  assert.equal(Weekly.STATUS_LABELS[statuses["배정 업무"]], "지시함");
  assert.equal(Weekly.STATUS_LABELS[statuses["검수 업무"]], "검수 대기");
  assert.equal(Weekly.STATUS_LABELS[statuses["보완 업무"]], "보완 요청");
});

test("보고서와 직접 작성한 다음 주 계획을 읽을 수 있는 문자열로 왕복 저장한다", () => {
  const done = Weekly.serializeDone({
    summary: "제안서와 API 도입 검토를 진행했습니다.",
    automatic: [{ id: "a", title: "CRM 화면 개선", source: "프로젝트", status: "completed", date: "2026-09-22" }],
    manual: [{ id: "m", title: "Gemini API 사용 도입 제안서 제작", status: "in_progress" }],
  });
  const next = Weekly.serializePlans([{ id: "n", title: "레이브클라우드 후속 미팅", date: "2026-09-29", priority: "높음" }]);
  const parsed = Weekly.parseDone(done);
  const plans = Weekly.parsePlans(next);

  assert.match(done, /\[자동 수집\]/u);
  assert.match(done, /\[직접 추가\]/u);
  assert.equal(parsed.summary, "제안서와 API 도입 검토를 진행했습니다.");
  assert.equal(parsed.manual[0].title, "Gemini API 사용 도입 제안서 제작");
  assert.deepEqual(plans.map(plan => ({ title: plan.title, date: plan.date, priority: plan.priority })), [{ title: "레이브클라우드 후속 미팅", date: "2026-09-29", priority: "높음" }]);
  assert.ok(done.length <= 2000);
  assert.ok(next.length <= 2000);
});

test("업무지시 고유 상태는 주간보고서를 다시 열어도 유지한다", () => {
  const done = Weekly.serializeDone({
    automatic: [
      { id: "a", title: "배정 업무", source: "업무지시", status: "assigned", date: "2026-09-22" },
      { id: "b", title: "검수 업무", source: "업무지시", status: "submitted", date: "2026-09-23" },
      { id: "c", title: "보완 업무", source: "업무지시", status: "returned", date: "2026-09-24" },
    ],
  });
  const parsed = Weekly.parseDone(done);

  assert.match(done, /\(지시함\) 배정 업무/u);
  assert.match(done, /\(검수 대기\) 검수 업무/u);
  assert.match(done, /\(보완 요청\) 보완 업무/u);
  assert.deepEqual(parsed.automatic.map(item => item.status), ["assigned", "submitted", "returned"]);
});

test("실제 CRM 화면에 주간업무보고서 탐색·렌더·저장 연결이 있다", () => {
  const root = path.join(__dirname, "..");
  const index = fs.readFileSync(path.join(root, "src", "index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "src", "app.js"), "utf8");
  const main = fs.readFileSync(path.join(root, "src", "main.js"), "utf8");
  const styles = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");

  assert.match(index, /data-view="weeklyReports"[\s\S]*?>주간업무보고서</u);
  assert.match(index, /weekly-report-core\.js/u);
  assert.match(app, /weeklyReports:\s*\["CRM 활동을 모아 한 주 업무를 정리합니다", "주간업무보고서"\]/u);
  assert.match(app, /currentView === "weeklyReports"\) renderWeeklyReports\(\)/u);
  assert.match(app, /data-weekly-manual-form/u);
  assert.match(app, /data-weekly-plan-form/u);
  assert.match(app, /data-weekly-preview-dialog role="dialog" aria-modal="true"/u);
  assert.match(app, /data-weekly-preview-close/u);
  assert.match(app, /data-weekly-preview-confirm/u);
  assert.match(app, /data-weekly-draft-preview/u);
  assert.match(app, /data-weekly-document-dialog/u);
  assert.match(app, /data-weekly-document-export/u);
  assert.match(app, /api\.exportWeeklyReport\(weeklyReportDocumentPayload\(context\)\)/u);
  assert.match(app, /weeklyReportState\.previewOpen = true;[\s\S]{0,220}renderWeeklyReports\(\)/u);
  assert.match(app, /data-weekly-preview-confirm[\s\S]{0,240}await saveWeeklyReport\(\)/u);
  assert.match(app, /startsWith\("weekly_report_"\)/u);
  assert.match(app, /growthOneOnOneCheckins/u);
  assert.match(app, /api\.saveGrowthCheckin\(checked\.checkin\)/u);
  assert.match(styles, /\.weekly-report-layout/u);
  assert.match(styles, /\.weekly-preview-layer/u);
  assert.match(styles, /\.weekly-preview-card/u);
  assert.match(styles, /\.weekly-document-paper/u);
  assert.match(main, /crm:weekly-report-export/u);
  assert.match(
    main,
    /\["weekly-report-preview", "weekly-report-document-preview"\]\.includes\(process\.env\.BRING_CRM_SCREENSHOT_ACTION\)/u
  );
});
