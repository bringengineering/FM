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
  const reportBlock = app.slice(app.indexOf("function renderAiReportAssistant"), app.indexOf("function quoteEditorRows"));
  assert.doesNotMatch(reportBlock, /scheduleSave|api\.save|store\.[A-Za-z]+\s*=/);
});

test("AI assistant provides copy and clear actions and explains the privacy boundary", () => {
  const app = read("app.js");
  assert.match(app, /data-ai-result-copy/);
  assert.match(app, /data-ai-result-clear/);
  assert.match(app, /개인정보.*마스킹/);
  assert.match(app, /AI가.*자동.*저장하지/);
});

test("AI assistant separates report and quote creation and exposes reviewed file exports", () => {
  const html = read("index.html");
  const app = read("app.js");
  const preload = read("preload.js");
  const main = read("main.js");
  assert.match(html, /quote-core\.js/);
  assert.match(app, /data-ai-assistant-tab="report"[\s\S]*보고서 작성/);
  assert.match(app, /data-ai-assistant-tab="quote"[\s\S]*견적서 작성/);
  assert.match(app, /task: "quote_draft"/);
  assert.match(app, /data-ai-quote-export="recipient"/);
  assert.match(app, /data-ai-quote-export="supplier"/);
  assert.match(app, /<b>공급받는자용<\/b>/);
  assert.match(app, /<b>공급자 보관용<\/b>/);
  assert.match(app, /ai-quote-export-group supplier-copy/);
  assert.match(app, /data-ai-quote-format="xlsx"/);
  assert.match(app, /data-ai-quote-format="pdf"/);
  assert.match(app, /Excel 저장/);
  assert.match(app, /PDF 저장/);
  assert.match(app, /data-ai-quote-recipient="recipient"/);
  assert.match(app, /data-ai-quote-recipient="recipientPhone"/);
  assert.match(app, /오늘부터 7일/);
  assert.match(app, /AI용 OCR_DATA 시트/);
  assert.match(app, /<dt>견적명<\/dt>/);
  assert.match(app, /<dt>소재지<\/dt>/);
  assert.match(app, /<dt>업태<\/dt>/);
  assert.match(app, /<dt>업종<\/dt>/);
  assert.match(app, /alt="공급자 인감"/);
  assert.match(app, /class="transaction-confirmation"/);
  assert.match(app, /alt="공급자 확인 인감"/);
  assert.match(app, /data-ai-quote-seal-select/);
  assert.match(app, /transaction-quote recipient-copy/);
  assert.match(app, /data-ai-quote-supplier="registrationNumber"/);
  assert.match(app, /data-ai-quote-item="name"/);
  assert.match(app, /data-ai-quote-item="detail"/);
  assert.match(app, /data-ai-quote-item="unitPrice"/);
  assert.match(app, /data-ai-quote-item-add/);
  assert.match(app, /data-ai-quote-item-delete/);
  assert.match(app, /QuoteCore\.addDraftItem/);
  assert.match(app, /QuoteCore\.removeDraftItem/);
  assert.match(app, /AI 전송 안 함/);
  assert.match(app, /회사 공통 고정값/);
  assert.match(app, /ai-quote-supplier-fixed/);
  assert.match(app, /상호·대표자·주소·연락처는 BRING 고정값/);
  assert.match(app, /supplierCanConfigure/);
  assert.match(app, /QuoteCore\.createDraftFromPrompt/);
  assert.match(preload, /crm:quote-export/);
  assert.match(preload, /crm:quote-supplier-load/);
  assert.match(preload, /crm:quote-supplier-save/);
  assert.match(preload, /crm:quote-seal-load/);
  assert.match(preload, /crm:quote-seal-select/);
  assert.match(main, /secureCanonicalHandle\("crm:quote-export"/);
  assert.match(main, /secureCanonicalHandle\("crm:quote-supplier-load"/);
  assert.match(main, /secureCanonicalHandle\("crm:quote-supplier-save"/);
  assert.match(main, /secureCanonicalHandle\("crm:quote-seal-load"/);
  assert.match(main, /secureCanonicalHandle\("crm:quote-seal-select"/);
  assert.match(main, /encodeProtectedJson\(safeStorage, protectedValue\)/);
  assert.match(main, /encodeProtectedJson\(safeStorage, supplier\)/);
  assert.match(main, /remoteClient\.loadQuoteSupplier\(\)/);
  assert.match(main, /remoteClient\.saveQuoteSupplier\(supplier\)/);
  assert.match(main, /new Set\(\["recipient", "supplier"\]\)/);
  assert.match(main, /createQuoteWorkbook\(quote, copyType/);
  assert.match(main, /createQuotePdfBytes\(quote, copyType, seal\)/);
  assert.match(main, /createQuotePdfHtml\(quote, copyType, seal\)/);
  assert.match(main, /webContents\.printToPDF/);
  assert.match(main, /new Set\(\["xlsx", "pdf"\]\)/);
  assert.match(main, /QuoteCore\.normalizeRecipient\(quote, \{ requireComplete: true \}\)/);
  assert.match(main, /showSaveDialog/);
  assert.match(main, /itemRows\.every\(row => row\.querySelector\('\[data-ai-quote-item-delete\]'\)\)/);
  assert.equal(fs.existsSync(path.join(__dirname, "../src/assets/bring-company-seal.png")), false);
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
