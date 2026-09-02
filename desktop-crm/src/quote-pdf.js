"use strict";

const QuoteCore = require("./quote-core");

function html(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function sealDataUrl(value) {
  const source = String(value || "");
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(source) || source.length > 1_000_000) {
    throw new Error("견적서 인감 이미지를 확인해 주세요.");
  }
  return source;
}

function pngBufferDataUrl(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (bytes.length < 8 || bytes.length > 750_000 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("견적서 인감 파일이 올바른 PNG가 아닙니다.");
  }
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

function quotePrintHtml(input, sealInput) {
  const quote = QuoteCore.normalizeDraft(input);
  const supplier = quote.company;
  const seal = sealDataUrl(sealInput);
  const itemRows = quote.items.map((item, index) => `<tr><td>${index + 1}</td><td><b>${html(item.name)}</b></td><td>${html(item.detail)}</td><td>${item.quantity}${html(item.unit)}</td><td>${html(QuoteCore.money(QuoteCore.itemTotal(item)))}</td></tr>`).join("");
  const notes = quote.notes.map(note => `<p>• ${html(note)}</p>`).join("");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${html(quote.projectName)} 견적서</title><style>
    @page{size:A4 portrait;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#294b5d;font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}body{font-size:10px}.quote-page{position:relative;width:210mm;min-height:297mm;padding:13mm 15mm 12mm;background:#fff}.quote-header{display:flex;align-items:center;justify-content:space-between;padding-bottom:6mm;border-bottom:1.1mm solid #173f56}.brand{display:grid}.brand span{color:#173f56;font-size:28px;font-weight:950;letter-spacing:-1px}.brand small{color:#3d9dc5;font-size:8px;font-weight:900;letter-spacing:2px}.title{display:grid;text-align:right}.title b{color:#173f56;font-size:25px;letter-spacing:6px}.title small{margin-top:2px;color:#77a0b3;font-size:8px;letter-spacing:2px}.meta{display:grid;grid-template-columns:minmax(0,1fr) 86mm;gap:7mm;padding:6mm 0}.recipient>small{display:block;color:#7b929e;font-size:9px;font-weight:800}.recipient>strong{display:block;margin-top:2mm;color:#173f56;font-size:19px}.recipient>p{margin:2mm 0 0;color:#557585;font-size:11px}.issued{display:grid;gap:1.5mm;margin:4mm 0 0}.issued div{display:grid;grid-template-columns:18mm 1fr;gap:2mm}.issued dt,.issued dd{margin:0;font-size:9px}.issued dt{color:#8499a3}.issued dd{color:#506f7f;font-weight:700}.supplier{display:grid;grid-template-columns:9mm 1fr;border:.3mm solid #91adba;background:#fff}.supplier>strong{display:grid;place-items:center;padding:2mm;border-right:.3mm solid #91adba;background:#edf5f8;color:#315e72;font-size:9px;letter-spacing:1px;writing-mode:vertical-rl}.supplier dl{display:grid;margin:0}.supplier dl>div{display:grid;grid-template-columns:22mm 1fr;min-height:9mm;border-bottom:.25mm solid #cddce3}.supplier dl>div:last-child{border-bottom:0}.supplier dt,.supplier dd{display:flex;align-items:center;margin:0;padding:1.5mm 2.2mm;font-size:8.5px}.supplier dt{border-right:.25mm solid #cddce3;background:#f7fafb;color:#698391;font-weight:700}.supplier dd{position:relative;color:#173f56;font-weight:800;line-height:1.35}.representative{min-height:11mm;padding-right:17mm!important}.seal{position:absolute;right:2mm;top:50%;width:16mm;height:16mm;object-fit:contain;transform:translateY(-50%) rotate(-7deg);opacity:.88}.total-banner{display:flex;align-items:center;justify-content:space-between;padding:4mm 5mm;border-radius:3mm;background:#e8f7fc}.total-banner div{display:grid;gap:1mm}.total-banner small{color:#3f7e99;font-size:9px}.total-banner b{color:#173f56;font-size:25px}.total-banner>span{padding:1.5mm 2.5mm;border-radius:20mm;background:#173f56;color:#fff;font-size:8px;font-weight:900}.summary{margin:4mm 0;color:#597887;font-size:10px;line-height:1.55}.items{overflow:hidden;border:.3mm solid #d8e5eb;border-radius:2.5mm}.items table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:9px}.items th{padding:2.5mm 2mm;background:#173f56;color:#fff;text-align:left}.items th:nth-child(1){width:12mm}.items th:nth-child(2){width:38mm}.items th:nth-child(4){width:15mm}.items th:nth-child(5){width:29mm;text-align:right}.items td{padding:3mm 2mm;border-bottom:.25mm solid #e2ebef;color:#4f6d7c;line-height:1.4;vertical-align:top}.items tbody tr:last-child td{border-bottom:0}.items td:first-child,.items td:nth-child(4){text-align:center}.items td:last-child{text-align:right;color:#173f56;font-weight:800}.items td b{color:#264e62}.amounts{width:84mm;margin:4mm 0 0 auto}.amounts>div{display:flex;justify-content:space-between;padding:1.5mm 0;color:#617e8d;font-size:10px}.amounts .grand-total{margin-top:1mm;padding:3mm 4mm;border-radius:2mm;background:#173f56;color:#fff;font-size:12px}.notes{break-inside:avoid;margin-top:5mm;padding:4mm;border-radius:2.5mm;background:#f4f8fa}.notes b{color:#173f56;font-size:10px}.notes p{margin:1.5mm 0 0;color:#688391;font-size:8px;line-height:1.45}.quote-footer{display:flex;align-items:end;justify-content:space-between;margin-top:7mm;padding-top:4mm;border-top:.25mm solid #dbe6eb}.quote-footer div{display:grid}.quote-footer b{color:#173f56;font-size:13px}.quote-footer span{color:#8298a3;font-size:7px;letter-spacing:1px}.quote-footer>strong{color:#3e9fc8;font-size:13px}
  </style></head><body><article class="quote-page"><header class="quote-header"><div class="brand"><span>BRING</span><small>ENGINEERING</small></div><div class="title"><b>견 적 서</b><small>QUOTATION</small></div></header><section class="meta"><div class="recipient"><small>수신</small><strong>${html(quote.recipient)} 귀중</strong><p>${html(quote.projectName)}</p><dl class="issued"><div><dt>발행일</dt><dd>${html(quote.quoteDate)}</dd></div><div><dt>유효기간</dt><dd>${html(quote.validUntil)}</dd></div></dl></div><section class="supplier"><strong>공급자</strong><dl><div><dt>등록번호</dt><dd>${html(supplier.registrationNumber)}</dd></div><div><dt>상호</dt><dd>${html(supplier.businessName)}</dd></div><div><dt>대표자</dt><dd class="representative">${html(supplier.representative)}<img class="seal" src="${seal}" alt=""></dd></div><div><dt>사업장 주소</dt><dd>${html(supplier.address)}</dd></div><div><dt>전화 / 팩스</dt><dd>${html(supplier.phone)} / ${html(supplier.fax)}</dd></div></dl></section></section><section class="total-banner"><div><small>아래와 같이 견적합니다</small><b>${html(QuoteCore.money(quote.totalAmount))}</b></div><span>VAT 포함</span></section><p class="summary">${html(quote.summary)}</p><section class="items"><table><thead><tr><th>No.</th><th>품목</th><th>상세 내용</th><th>수량</th><th>금액</th></tr></thead><tbody>${itemRows}</tbody></table></section><section class="amounts"><div><span>공급가액</span><b>${html(QuoteCore.money(quote.supplyAmount))}</b></div><div><span>세액 (부가세 10%)</span><b>${html(QuoteCore.money(quote.vatAmount))}</b></div><div class="grand-total"><span>합계금액</span><b>${html(QuoteCore.money(quote.totalAmount))}</b></div></section><section class="notes"><b>안내 사항</b>${notes}</section><footer class="quote-footer"><div><b>${html(supplier.businessName)}</b><span>${html(supplier.brand)}</span></div><strong>BRING CARE</strong></footer></article></body></html>`;
}

async function createQuotePdf(BrowserWindowClass, input, sealInput) {
  if (typeof BrowserWindowClass !== "function") throw new TypeError("PDF 창 생성기를 확인해 주세요.");
  const documentHtml = quotePrintHtml(input, sealInput);
  const printWindow = new BrowserWindowClass({
    width: 900,
    height: 1273,
    show: false,
    skipTaskbar: true,
    backgroundColor: "#ffffff",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      javascript: false,
      webSecurity: true
    }
  });
  let outputBase64 = "";
  try {
    printWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    await printWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(documentHtml)}`);
    const pdf = await printWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      landscape: false,
      preferCSSPageSize: true,
      generateTaggedPDF: true
    });
    if (!Buffer.isBuffer(pdf) || pdf.length < 1000 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new Error("견적서 PDF 생성 결과를 확인하지 못했습니다.");
    }
    outputBase64 = pdf.toString("base64");
  } finally {
    if (!printWindow.isDestroyed()) printWindow.destroy();
  }
  return { base64: outputBase64, byteLength: Buffer.byteLength(outputBase64, "base64") };
}

module.exports = { createQuotePdf, pngBufferDataUrl, quotePrintHtml, sealDataUrl };
