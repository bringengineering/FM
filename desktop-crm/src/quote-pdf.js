"use strict";

const QuoteCore = require("./quote-core");
const { safeFileSegment } = require("./attendance-xlsx");
const { COPY_CONFIG } = require("./quote-xlsx");

function html(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function configFor(copyType) {
  const config = COPY_CONFIG[String(copyType || "")];
  if (!config) throw new Error("견적서 종류를 확인해 주세요.");
  return config;
}

function cssColor(argb) {
  return `#${String(argb || "").slice(-6)}`;
}

function spacedDisplayName(value) {
  return Array.from(String(value || "").replace(/\s+/g, "")).join(" ");
}

function sealDataUrl(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.length || buffer.length > 512 * 1024 || !buffer.subarray(0, 8).equals(signature)) {
    throw new Error("견적서 인감 이미지는 512KB 이하 PNG 파일이어야 합니다.");
  }
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

function partyRow(label, value, className = "") {
  return `<div class="party-row ${className}"><dt>${html(label)}</dt><dd>${html(value || "미입력")}</dd></div>`;
}

function createQuotePdfHtml(input, copyType = "recipient", sealImage) {
  const quote = QuoteCore.normalizeDraft(input);
  const config = configFor(copyType);
  const color = cssColor(config.color);
  const light = cssColor(config.light);
  const seal = sealDataUrl(sealImage);
  const representative = spacedDisplayName(quote.company.representative);
  const recipientRows = [
    partyRow("견적명", quote.projectName),
    partyRow("현장 주소", quote.siteAddress, "address"),
    partyRow("성명", quote.recipient),
    partyRow("전화번호", quote.recipientPhone),
    partyRow("발행일", quote.quoteDate),
    partyRow("유효일", quote.validUntil)
  ].join("");
  const supplierRows = [
    partyRow("사업자등록번호", quote.company.registrationNumber),
    partyRow("상호", quote.company.businessName),
    `<div class="party-row"><dt>대표자</dt><dd><span>${html(representative || "미입력")}</span><img class="seal top-seal" src="${seal}" alt="공급자 인감"></dd></div>`,
    partyRow("소재지", quote.company.address, "address"),
    partyRow("업태", quote.company.businessType),
    partyRow("업종", quote.company.businessCategory)
  ].join("");
  const rows = Array.from({ length: 10 }, (_, index) => {
    const item = quote.items[index];
    if (!item) return "<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>";
    const total = QuoteCore.itemTotal(item);
    const supply = Math.round(total / 1.1);
    return `<tr><td>${index + 1}</td><td>${html(item.name)}</td><td>${html(item.detail)}</td><td>${html(item.quantity)}</td><td>${html(item.unit)}</td><td>${html(QuoteCore.money(item.unitPrice))}</td><td>${html(QuoteCore.money(supply))}</td><td>${html(QuoteCore.money(total - supply))}</td><td>${html(QuoteCore.money(total))}</td></tr>`;
  }).join("");
  const notes = quote.notes.slice(0, 2).map((note, index) => `<span>${index + 1}. ${html(note)}</span>`).join("");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${html(config.label)}</title><style>
@page{size:A4 landscape;margin:7mm}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#252b31;font-family:"Malgun Gothic","맑은 고딕",sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}body{width:283mm;min-height:196mm}.quote{display:flex;flex-direction:column;min-height:196mm;border:1.4px solid ${color}}.title{height:15mm;display:grid;place-items:center;border-bottom:1.4px solid ${color};color:${color};font-size:23pt;font-weight:800;letter-spacing:.45em;text-indent:.45em}.brand{height:8mm;display:grid;place-items:center;border-bottom:1px solid ${color};background:${light};color:${color};font-size:9pt;font-weight:800}.parties{display:grid;grid-template-columns:1fr 1fr;border-bottom:1.2px solid ${color}}.party{display:grid;grid-template-columns:9mm 1fr}.party:first-child{border-right:1.2px solid ${color}}.vertical{display:grid;place-items:center;border-right:1px solid ${color};background:${light};color:${color};font-size:9pt;font-weight:800;writing-mode:vertical-rl;letter-spacing:.14em}.party dl{display:grid;grid-auto-rows:minmax(6.1mm,auto);margin:0}.party-row{display:grid;grid-template-columns:36mm 1fr;min-height:6.1mm;border-bottom:.65px solid ${color}}.party-row:last-child{border-bottom:0}.party-row dt,.party-row dd{display:flex;align-items:center;margin:0;padding:1.15mm 2mm}.party-row dt{justify-content:center;border-right:.65px solid ${color};background:${light};color:${color};font-size:8pt;font-weight:800;text-align:center}.party-row dd{justify-content:center;gap:2mm;font-size:8.2pt;text-align:center;line-height:1.35}.party-row.address dd{font-size:7.4pt}.seal{width:8mm;height:8mm;object-fit:contain}.top-seal{margin:-1mm 0}.total-band{display:grid;grid-template-columns:1fr 46mm;min-height:9mm;border-bottom:1.2px solid ${color};background:${light};color:${color};font-weight:800}.total-band span,.total-band b{display:flex;align-items:center;justify-content:center}.total-band b{border-left:1px solid ${color};font-size:15pt}.items{width:100%;border-collapse:collapse;table-layout:fixed}.items th,.items td{border-right:.65px solid ${color};border-bottom:.65px solid ${color};padding:1mm;text-align:center;vertical-align:middle}.items th:last-child,.items td:last-child{border-right:0}.items thead th{height:7mm;background:${light};color:${color};font-size:7.5pt;font-weight:800}.items tbody td{height:6.3mm;font-size:7pt;line-height:1.25}.items th:nth-child(1){width:9mm}.items th:nth-child(2){width:48mm}.items th:nth-child(3){width:62mm}.items th:nth-child(4){width:14mm}.items th:nth-child(5){width:14mm}.items th:nth-child(6),.items th:nth-child(7),.items th:nth-child(8),.items th:nth-child(9){width:34mm}.items td:nth-child(n+4){white-space:nowrap}.items tfoot th,.items tfoot td{height:8mm;background:${light};color:${color};font-size:8pt;font-weight:800}.items tfoot td:last-child{font-size:12pt}.notes{display:grid;gap:.8mm;padding:2.2mm 3mm;border-bottom:1px solid ${color};background:${light};font-size:6.8pt;line-height:1.35}.notes b{color:${color};font-size:7.5pt}.signatures{display:grid;grid-template-columns:1fr 1.2fr 1.2fr;min-height:11mm;margin-top:auto}.signature{display:flex;align-items:center;justify-content:center;gap:2mm;border-right:.65px solid ${color};color:${color};font-size:8pt;font-weight:800}.signature:last-child{border-right:0}.signature img{width:7mm;height:7mm;object-fit:contain}
</style></head><body><main class="quote"><header class="title">견 적 서</header><div class="brand">BRING ENGINEERING</div><section class="parties"><div class="party"><span class="vertical">공급받는자</span><dl>${recipientRows}</dl></div><div class="party"><span class="vertical">공급자</span><dl>${supplierRows}</dl></div></section><div class="total-band"><span>합계금액 (VAT 포함)</span><b>${html(QuoteCore.money(quote.totalAmount))}</b></div><table class="items"><thead><tr><th>번호</th><th>품목</th><th>규격 및 상세</th><th>수량</th><th>단위</th><th>단가</th><th>공급가액</th><th>세액</th><th>합계</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th colspan="6">합계금액 (VAT 포함)</th><td>${html(QuoteCore.money(quote.supplyAmount))}</td><td>${html(QuoteCore.money(quote.vatAmount))}</td><td>${html(QuoteCore.money(quote.totalAmount))}</td></tr></tfoot></table><section class="notes"><b>안내 사항</b>${notes}</section><footer class="signatures"><div class="signature">작성일&nbsp;&nbsp;${html(quote.quoteDate)}</div><div class="signature">공급자 확인&nbsp;&nbsp;${html(representative)}<img src="${seal}" alt="공급자 확인 인감"></div><div class="signature">공급받는자 확인&nbsp;&nbsp;${html(quote.recipient)}</div></footer></main></body></html>`;
}

function quotePdfFileName(input, copyType = "recipient") {
  const quote = QuoteCore.normalizeDraft(input);
  return `${safeFileSegment(QuoteCore.fileBase(quote))}_${configFor(copyType).sheetName}.pdf`;
}

module.exports = { createQuotePdfHtml, quotePdfFileName };
