"use strict";

const { app, BrowserWindow } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const QuoteCore = require("../src/quote-core");
const { createQuotePdf, pngBufferDataUrl } = require("../src/quote-pdf");

app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});

async function main() {
  const target = path.resolve(process.argv[2] || path.join(__dirname, "../../output/pdf/BRING_AI_quotation_preview.pdf"));
  const registrationNumber = /^\d{3}-\d{2}-\d{5}$/.test(String(process.env.BRING_CRM_QUOTE_PREVIEW_REGISTRATION || ""))
    ? process.env.BRING_CRM_QUOTE_PREVIEW_REGISTRATION
    : "000-00-00000";
  const quote = QuoteCore.createDraftFromPrompt("햇빛빌라 입주청소 12만원", null, {
    now: "2026-09-02",
    supplier: { businessName: "브링엔지니어링", representative: "서창환", registrationNumber }
  });
  const seal = pngBufferDataUrl(await fs.readFile(path.join(__dirname, "../src/assets/bring-company-seal.png")));
  const pdf = await createQuotePdf(BrowserWindow, quote, seal);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, pdf.base64, { encoding: "base64", mode: 0o600 });
  const saved = await fs.stat(target);
  if (saved.size !== pdf.byteLength) throw new Error("PDF 미리보기 파일 저장 결과를 확인하지 못했습니다.");
  process.stdout.write(`${target}\n`);
}

app.whenReady().then(main).then(() => app.quit()).catch(error => {
  process.stderr.write(`${String(error && error.stack || error)}\n`);
  app.exit(1);
});
