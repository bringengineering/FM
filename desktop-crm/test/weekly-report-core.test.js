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

test("업무지시의 실제 진행률로 완료와 진행을 표시하되 원본 검수 상태는 바꾸지 않는다", () => {
  const actor = { uid: "weekly-owner" };
  const orders = [100, 60, 0].map(progress => ({
    id: `p${progress}`, title: `업무 ${progress}`, assigneeUid: actor.uid, status: "assigned", progress,
    progressUpdates: [{ note: "진행 기록", toProgress: progress, createdBy: actor.uid, createdAt: "2026-09-23T03:00:00.000Z" }],
  }));
  orders.push({ ...orders[0], id: "submitted", title: "검수 전 제출 업무", status: "submitted" });
  const before = structuredClone(orders);
  const result = Weekly.collect({ week: "2026-09-23", actor, orders });
  const byId = Object.fromEntries(result.items.map(row => [row.id, row]));
  assert.equal(byId["order:p100"].status, "completed");
  assert.equal(Weekly.statusLabel(byId["order:p100"]), "완료");
  assert.equal(byId["order:p60"].status, "in_progress");
  assert.equal(Weekly.statusLabel(byId["order:p60"]), "진행 60%");
  assert.equal(Weekly.statusLabel(byId["order:p0"]), "진행 0%");
  assert.equal(Weekly.statusLabel(byId["order:submitted"]), "완료");
  assert.match(Weekly.defaultSummary(result.items, []), /완료 2건, 진행·검토 2건/u);
  assert.deepEqual(orders, before);
});

test("현재 진행률을 우선하고 진행률 필드가 없는 옛 업무는 이번 주 진행 기록에서 보완한다", () => {
  const actor = { uid: "weekly-owner" };
  const order = {
    id: "history", title: "진행 이력 업무", assigneeUid: actor.uid, status: "assigned",
    progressUpdates: [
      { note: "최근 기록", toProgress: 70, createdBy: actor.uid, createdAt: "2026-09-24T03:00:00Z" },
      { note: "이전 기록", toProgress: 20, createdBy: actor.uid, createdAt: "2026-09-22T03:00:00Z" },
      { note: "다른 주 기록", toProgress: 100, createdBy: actor.uid, createdAt: "2026-09-28T03:00:00Z" },
    ],
  };
  const collect = source => Weekly.collect({ week: "2026-09-23", actor, orders: [source] }).items[0];
  assert.equal(Weekly.statusLabel(collect(order)), "진행 70%");
  assert.equal(Weekly.statusLabel(collect({ ...order, progress: "80" })), "진행 80%");
  assert.equal(Weekly.statusLabel(collect({ ...order, progress: 0 })), "진행 0%");
});

test("누락되거나 유효하지 않은 진행률은 완료로 오인하지 않고 기존 상태를 보존한다", () => {
  for (const progress of [undefined, null, "", " ", true, false, [], {}, NaN, Infinity, -1, 101, "100%", "<img>"]) {
    const actor = { uid: "weekly-owner" };
    const row = Weekly.collect({ week: "2026-09-23", actor, orders: [{
      id: "invalid", title: "확인 필요", assigneeUid: actor.uid, status: "assigned", progress,
      updatedBy: actor.uid, updatedAt: "2026-09-23T03:00:00Z",
    }] }).items[0];
    assert.equal(Weekly.statusLabel(row), "지시함", String(progress));
    assert.equal(row.status, "assigned");
    assert.equal(Object.hasOwn(row, "progress"), false);
  }
  assert.equal(Weekly.statusLabel({ status: "completed", progress: 40 }), "완료");
});

test("업무일정은 작성자가 아니라 본인 담당자와 선택한 주의 기준 날짜로 수집한다", () => {
  const actor = { uid: "weekly-owner", name: "담당자", email: "owner@example.test" };
  const rows = [
    { id: "mine", owner: actor.name, createdBy: "other", completedAt: "2026-09-23", status: "completed" },
    { id: "email", owner: actor.email.toUpperCase(), updatedAt: "2026-09-24", status: "in_progress" },
    { id: "scheduled", owner: actor.uid, scheduledDate: "2026-09-25", status: "planned" },
    { id: "created-only", owner: "other", createdBy: actor.uid, completedAt: "2026-09-23" },
    { id: "unassigned", owner: "", createdBy: actor.uid, scheduledDate: "2026-09-23" },
    { id: "previous", owner: actor.uid, completedAt: "2026-09-20", updatedAt: "2026-09-23" },
  ].map(row => ({ ...row, title: row.id }));
  const result = Weekly.collect({ week: "2026-09-23", actor, store: { serviceRecords: rows } });
  assert.deepEqual(result.items.map(row => row.id).sort(), ["schedule:email", "schedule:mine", "schedule:scheduled"]);
});

test("진행률은 저장·재열기와 AI 요약 원문에도 남으며 기존 상태 문자열도 읽는다", () => {
  const automatic = [
    { title: "완료 업무", source: "업무지시", status: "assigned", progress: 100 },
    { title: "부분 업무", source: "업무지시", status: "assigned", progress: 60 },
    { title: "시작 업무", source: "업무지시", status: "doing", progress: 0 },
  ];
  const saved = Weekly.serializeDone({ automatic });
  assert.match(saved, /\(완료\) 완료 업무/u);
  assert.match(saved, /\(진행 60%\) 부분 업무/u);
  const parsed = Weekly.parseDone(saved);
  assert.deepEqual(parsed.automatic.map(Weekly.statusLabel), ["완료", "진행 60%", "진행 0%"]);
  assert.equal(parsed.automatic[1].progress, 60);
  assert.match(Weekly.sourceText(automatic, []), /진행 60% · 부분 업무/u);
  assert.match(Weekly.defaultSummary(parsed.automatic, []), /완료 1건, 진행·검토 2건/u);
  assert.equal(Weekly.serializeDone({ automatic: parsed.automatic }), saved);
  assert.equal(Weekly.parseDone(saved.replace("진행 60%", "진행 999%")).automatic.length, 2);
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
