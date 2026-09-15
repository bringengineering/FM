const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "../src/index.html"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "../src/styles.css"), "utf8");

test("customer management exposes transcript and recording based AI intake", () => {
  assert.match(app, /data-action="ai-consultation-intake"/);
  assert.match(app, /function aiConsultationIntakeEditor/);
  assert.match(app, /id="aiConsultationIntakeForm"/);
  assert.match(app, /data-ai-consultation-audio-pick/);
  assert.match(app, /api\.chooseConsultationAudio/);
  assert.match(app, /api\.transcribeConsultationAudio/);
  assert.match(app, /task: "consultation_intake"/);
  assert.match(html, /ai-consultation-core\.js/);
});

test("AI intake review keeps every CRM section editable and requires confirmation", () => {
  assert.match(app, /function aiConsultationReviewEditor/);
  for (const field of ["customerName", "customerPhone", "customerType", "currentRequest", "privateMemo", "buildingName", "buildingAddress", "consultationSummary", "consultationResult", "nextAction", "nextContactAt", "contractType", "expectedAmount"]) {
    assert.match(app, new RegExp(`(?:field|areaField)\\([^\\n]*"${field}"`));
  }
  assert.match(app, /확인 필요/);
  assert.match(app, /검토 후 CRM에 저장/);
  assert.match(css, /\.ai-consultation-input/);
  assert.match(css, /@media\(max-width:720px\)[\s\S]*\.ai-consultation-review-grid/);
});
