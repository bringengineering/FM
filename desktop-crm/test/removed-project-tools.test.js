const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const source = name => fs.readFileSync(path.join(root, "src", name), "utf8");

test("프로젝트 관리에서 일일업무보고서·분기 목표·할 일 화면을 제거한다", () => {
  const index = source("index.html");
  const app = source("app.js");
  const preload = source("preload.js");
  const main = source("main.js");
  const remote = source("remote.js");
  const aiClient = source("ai-client.js");
  const workerRoot = path.join(root, "..", "crm-ai-worker");
  const workerIndex = fs.readFileSync(path.join(workerRoot, "src", "index.js"), "utf8");
  const workerTasks = fs.readFileSync(path.join(workerRoot, "src", "tasks.js"), "utf8");

  for (const view of ["dailyLog", "objectives", "tasks"]) {
    assert.doesNotMatch(index, new RegExp(`data-view=["']${view}["']`, "u"));
  }
  for (const label of ["일일업무보고서", "분기 목표", ">할 일<"]) {
    assert.doesNotMatch(index, new RegExp(label, "u"));
  }
  assert.match(index, /data-view="projectRoadmap"/u);
  assert.match(index, /data-view="workOrders"/u);
  assert.match(index, /data-view="cases"/u);
  assert.doesNotMatch(index, /daily-log-core\.js|okr-core\.js/u);

  assert.doesNotMatch(app, /renderDailyLog|renderObjectives|renderTasks|taskEditor|data-task-toggle|data-task-delete/u);
  assert.doesNotMatch(preload, /loadDailyLogs|saveDailyLog|confirmDailyLog|loadObjectives|saveObjective|updateKeyResult/u);
  assert.doesNotMatch(main, /crm:daily-|crm:daily-logs|crm:objectives|crm:objective-|crm:key-result/u);
  assert.doesNotMatch(remote, /async (?:loadDailyLogs|saveDailyLog|confirmDailyLog|loadObjectives|saveObjective|updateKeyResult)\b/u);
  assert.doesNotMatch(aiClient, /daily_report/u);
  assert.doesNotMatch(workerIndex, /daily-report|DailyReport|DAILY_REPORT/u);
  assert.doesNotMatch(workerTasks, /daily_report/u);
  assert.equal(fs.existsSync(path.join(workerRoot, "src", "daily-report-telegram.js")), false);

  for (const file of [
    "daily-log-core.js",
    "daily-log-monthly-xlsx.js",
    "daily-log-telegram-client.js",
    "daily-log-template-base64.js",
    "daily-log-xlsx.js",
    "okr-core.js",
  ]) assert.equal(fs.existsSync(path.join(root, "src", file)), false, `${file} should be removed`);
});
