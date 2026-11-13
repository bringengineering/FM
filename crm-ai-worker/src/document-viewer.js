// 결과보고서·견적서 링크의 보기 화면.
// 안드로이드 크롬과 카카오톡 인앱 브라우저는 PDF 를 화면에 띄우지 못하고 내려받기로 넘긴다.
// 그래서 링크(/d/{token})는 HTML 보기 화면을 돌려주고, 그 화면이 pdf.js 로 같은 출처의
// /d/{token}/pdf 를 받아 쪽마다 그린다. pdf.js 는 jsDelivr 의 고정 버전을 받아 SHA-256 을
// 확인한 뒤 같은 출처(/d/_viewer/...)로 내보낸다. 해시가 다르면 싣지 않는다.

const PDFJS_VERSION = "4.10.38";
const PDFJS_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/`;
export const VIEWER_ASSETS = Object.freeze({
  "pdf.min.mjs": "44ec6f011027ee77791386b66c14876a5fc29e20bf0433c07c6726fff7212b72",
  "pdf.worker.min.mjs": "bd88805178a26c729db8c0107a5b630cb900ec070f4d8c7529a3e45530afd41d",
});

const escapeHtml = value => String(value == null ? "" : value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const hex = buffer => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, "0")).join("");

const VIEWER_CSP = "default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const pageHeaders = { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store", "content-security-policy": VIEWER_CSP, "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow" };

// 보기 화면 스크립트. 문서마다 바뀌는 값은 data- 속성으로만 넘긴다(인라인 스크립트 없음).
const VIEWER_JS = `import * as pdfjs from "./pdf.min.mjs";
pdfjs.GlobalWorkerOptions.workerSrc = new URL("./pdf.worker.min.mjs", import.meta.url).href;
const root = document.getElementById("pages");
const status = document.getElementById("status");
const source = root.dataset.pdf;
const fail = () => { status.textContent = "이 화면에서 보고서를 열지 못했습니다. 아래 'PDF 내려받기'로 확인해 주세요."; status.hidden = false; };
let pdf;
async function render() {
  const width = Math.max(280, Math.min(root.clientWidth, 1000));
  const ratio = Math.min(window.devicePixelRatio || 1, 3);
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: (width / base.width) * ratio });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
    canvas.style.width = width + "px"; canvas.style.height = Math.floor(viewport.height / ratio) + "px";
    canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", n + "쪽");
    pages.push(canvas);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    if (n === 1) { root.replaceChildren(canvas); status.hidden = true; } else root.append(canvas);
  }
  root.replaceChildren(...pages);
}
try {
  pdf = await pdfjs.getDocument({ url: source, isEvalSupported: false, disableAutoFetch: false }).promise;
  await render();
  let last = root.clientWidth, timer;
  window.addEventListener("resize", () => { clearTimeout(timer); timer = setTimeout(() => { if (Math.abs(root.clientWidth - last) > 40) { last = root.clientWidth; render().catch(fail); } }, 300); });
} catch { fail(); }
`;

export function viewerPage(document, token) {
  const name = escapeHtml(document.documentName || "문서");
  const until = escapeHtml(String(document.expiresAt || "").slice(0, 10));
  const pdf = `/d/${token}/pdf`;
  const body = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${name}</title><style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#E9EDF2;color:#111;font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif}
header{position:sticky;top:0;z-index:1;background:#fff;border-bottom:1px solid #D5DCE4;padding:10px 16px;display:flex;gap:12px;align-items:center;justify-content:space-between}
header div{min-width:0}h1{margin:0;font-size:15px;line-height:1.35;overflow-wrap:anywhere}header p{margin:2px 0 0;font-size:12px;color:#5A6573}
a.button{flex:none;display:inline-block;background:#0C58A0;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:9px 12px;border-radius:8px}
main{max-width:1000px;margin:0 auto;padding:12px 16px 32px}#pages{display:flex;flex-direction:column;gap:12px;align-items:center}
canvas{display:block;max-width:100%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.18)}#status{text-align:center;color:#3B4654;font-size:14px;padding:40px 0;margin:0}
</style><script type="module" src="/d/_viewer/viewer.mjs"></script></head><body>
<header><div><h1>${name}</h1><p>열람기한 ${until}</p></div><a class="button" href="${pdf}?download=1">PDF 내려받기</a></header>
<main><p id="status">보고서를 불러오는 중입니다…</p><div id="pages" data-pdf="${pdf}"></div>
<noscript><p style="text-align:center">이 화면은 스크립트가 필요합니다. 위 'PDF 내려받기'로 확인해 주세요.</p></noscript></main>
</body></html>`;
  return new Response(body, { headers: pageHeaders });
}

export function pdfResponse(bytes, document, download) {
  const name = `${String(document.documentName || "document").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").trim().slice(0, 150) || "document"}.pdf`;
  const disposition = `${download ? "attachment" : "inline"}; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`;
  return new Response(bytes, { headers: { "content-type": "application/pdf", "content-disposition": disposition, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow" } });
}

const scriptHeaders = { "content-type": "text/javascript; charset=utf-8", "x-content-type-options": "nosniff", "cross-origin-resource-policy": "same-origin" };

export async function viewerAsset(name, fetchImpl = globalThis.fetch) {
  if (name === "viewer.mjs") return new Response(VIEWER_JS, { headers: { ...scriptHeaders, "cache-control": "public, max-age=300" } });
  const pinned = Object.hasOwn(VIEWER_ASSETS, name) ? VIEWER_ASSETS[name] : null;
  if (!pinned) return new Response("Not found", { status: 404 });
  let response;
  try { response = await fetchImpl(PDFJS_BASE + name, { cf: { cacheEverything: true, cacheTtl: 86400 } }); } catch { response = null; }
  if (!response?.ok) return new Response("Viewer unavailable", { status: 502, headers: { "cache-control": "no-store" } });
  const bytes = await response.arrayBuffer();
  if (hex(await crypto.subtle.digest("SHA-256", bytes)) !== pinned) return new Response("Viewer integrity check failed", { status: 502, headers: { "cache-control": "no-store" } });
  return new Response(bytes, { headers: { ...scriptHeaders, "cache-control": "public, max-age=31536000, immutable" } });
}
