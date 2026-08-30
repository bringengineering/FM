const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = file => fs.readFileSync(path.join(__dirname, "../src", file), "utf8");

test("AI assistant is a first-class CRM view with four approved general tasks", () => {
  const html = read("index.html");
  const app = read("app.js");
  assert.match(html, /data-view="aiAssistant"[^>]*>[\s\S]*?<b>AI 비서<\/b>/);
  assert.match(app, /aiAssistant:\s*\[[^\]]*"AI 비서"\]/);
  assert.match(app, /currentView === "aiAssistant"\) renderAiAssistant\(\)/);
  assert.match(app, /"aiAssistant"[^\]]*\]\.includes\(query\.get\("view"\)\)/);
  for (const task of ["assistant_summary", "next_action", "sales_message", "work_report"]) {
    assert.match(app, new RegExp(`\\["${task}",`));
  }
});

test("AI assistant keeps prompts and escaped drafts outside the persisted CRM store", () => {
  const app = read("app.js");
  assert.match(app, /let aiAssistantState = \{[^}]*content: ""[^}]*result: null[^}]*\}/);
  assert.match(app, /api\.assist\(\{ task: aiAssistantState\.task, content: aiAssistantState\.content, context \}\)/);
  assert.match(app, /esc\(aiAssistantState\.result\.text\)/);
  assert.match(app, /aiAssistantState\.loading = true/);
  assert.match(app, /data-ai-assist-submit[^>]*disabled/);
  const assistantBlock = app.slice(app.indexOf("function renderAiAssistant"), app.indexOf("function renderOperationsIntelligence"));
  assert.doesNotMatch(assistantBlock, /scheduleSave|api\.save|store\.[A-Za-z]+\s*=/);
});

test("AI assistant provides copy and clear actions and explains the privacy boundary", () => {
  const app = read("app.js");
  assert.match(app, /data-ai-result-copy/);
  assert.match(app, /data-ai-result-clear/);
  assert.match(app, /개인정보.*마스킹/);
  assert.match(app, /AI가.*자동.*저장하지/);
});

test("consultation AI creates a reviewable draft without changing or saving the form", () => {
  const app = read("app.js");
  assert.match(app, /data-consultation-ai-organize[^>]*disabled/);
  assert.match(app, /task: "consultation_structure"/);
  assert.match(app, /content: originalSummary/);
  assert.match(app, /data-consultation-ai-draft/);
  assert.match(app, /data-consultation-ai-apply/);
  assert.match(app, /data-consultation-ai-discard/);
  assert.match(app, /form\.elements\.summary\.value = draft\.summary/);
  assert.match(app, /form\.elements\.result\.value = draft\.outcome/);
  assert.match(app, /form\.elements\.nextAction\.value = draft\.nextAction/);
  assert.match(app, /현재 요청.*currentRequest/);
  const requestBlock = app.slice(app.indexOf("async function requestConsultationAiDraft"), app.indexOf("function renderConsultationAiDraft"));
  assert.doesNotMatch(requestBlock, /form\.elements\.summary\.value\s*=|scheduleSave|requestSubmit/);
});

test("consultation AI keeps the entered original on errors and clears drafts with the modal", () => {
  const app = read("app.js");
  assert.match(app, /const originalSummary = form\.elements\.summary\.value/);
  assert.match(app, /form\.dataset\.aiLoading = "false"/);
  assert.match(app, /delete form\.dataset\.aiDraft/);
  assert.match(app, /AI를 일시적으로 사용할 수 없습니다/);
});
