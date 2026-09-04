/**
 * index.html 브라우저 테스트 공용 하네스.
 *
 * 실제 Firebase 에 절대 붙지 않도록 두 겹으로 막는다.
 *   1) databaseURL 을 가짜 값으로 바꾼 사본을 임시 폴더에 만들어 로컬 모드로 띄운다.
 *   2) file:// 이외의 모든 요청을 차단한다(gstatic 의 Firebase SDK 포함).
 * 따라서 `typeof firebase === "undefined"` 가 되어 앱은 로컬 모드로 동작한다.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "../..");

/** 로컬(오프라인) 실행 환경에 놓인 Chromium 을 찾는다. */
function findLocalChromium() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!base || !fs.existsSync(base)) return null;
  for (const dir of fs.readdirSync(base).filter((d) => d.startsWith("chromium"))) {
    for (const rel of ["chrome-linux/chrome", "chrome-linux/headless_shell"]) {
      const candidate = path.join(base, dir, rel);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** databaseURL 만 가짜로 바꾼 사본을 만들어 그 경로를 돌려준다. */
export function buildLocalModeCopy() {
  const source = fs.readFileSync(path.join(REPO_ROOT, "index.html"), "utf8");
  const patched = source.replace(/databaseURL:\s*"[^"]*"/, 'databaseURL: "여기에-TEST"');
  if (!patched.includes("여기에-TEST")) {
    throw new Error("databaseURL 을 찾지 못했습니다. index.html 의 firebaseConfig 구조가 바뀌었는지 확인하세요.");
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fm-browser-test-"));
  fs.writeFileSync(path.join(dir, "index.html"), patched);
  // 앱이 함께 읽는 로컬 데이터 파일
  fs.mkdirSync(path.join(dir, "data"), { recursive: true });
  fs.copyFileSync(
    path.join(REPO_ROOT, "data/building-maintenance-companies.js"),
    path.join(dir, "data/building-maintenance-companies.js"),
  );
  return dir;
}

/**
 * 앱을 띄우고 { browser, page, pageErrors, close } 를 돌려준다.
 * pageErrors 에는 차단된 외부 리소스를 제외한 진짜 오류만 쌓인다.
 */
export async function openApp({ mobile = false } = {}) {
  const executablePath = findLocalChromium();
  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ["--no-sandbox"],
  });
  // mobile:true 는 Chromium 모바일 에뮬레이션을 켜서 `pointer: coarse` 가 되게 한다.
  const page = await browser.newPage(
    mobile
      ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 }
      : { viewport: { width: 1280, height: 900 } },
  );
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error.message || error)));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // 의도적으로 차단한 외부 리소스는 오류로 세지 않는다.
    if (text.includes("ERR_FAILED") || text.includes("Failed to load resource")) return;
    pageErrors.push(text);
  });
  await page.route("**://**", (route) => {
    const url = route.request().url();
    return url.startsWith("file://") ? route.continue() : route.abort();
  });

  const dir = buildLocalModeCopy();
  await page.goto(`file://${path.join(dir, "index.html")}`);
  await page.waitForFunction(() => document.querySelectorAll("g.node").length > 0, null, { timeout: 15000 });

  return {
    browser,
    page,
    pageErrors,
    async close() {
      await browser.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
