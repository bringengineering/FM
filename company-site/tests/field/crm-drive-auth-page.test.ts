import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const loadPage = () =>
  readFile(resolve("public/crm-drive-auth/index.html"), "utf8");
const loadLoginPage = () => readFile(resolve("public/crm-auth/index.html"), "utf8");

describe("CRM Drive 연결 페이지", () => {
  it("로그인 페이지와 따로 있다", async () => {
    // 로그인은 회사에서 가장 자주 쓰는 길이다. Drive 권한을 붙이려다
    // 그 길이 막히면 아무도 CRM 에 들어오지 못한다.
    const login = await loadLoginPage();
    expect(login).not.toContain("auth/drive");
    expect(login).not.toContain("drive_access_token");
    expect(login).toContain('provider.setCustomParameters({ prompt: "select_account" })');
  });

  it("Drive 권한을 요청한다", async () => {
    const page = await loadPage();
    expect(page).toContain("https://www.googleapis.com/auth/drive");
    expect(page).toContain("provider.addScope(DRIVE_SCOPE)");
    // 전에 Drive 없이 동의한 계정이면 select_account 로는 권한이 안 붙는다.
    expect(page).toContain('prompt: "consent"');
  });

  it("로그인과 같은 Firebase 프로젝트를 쓴다", async () => {
    // 같은 프로젝트여야 동의 화면이 하나로 유지된다.
    const page = await loadPage();
    expect(page).toContain('projectId: "bring-fm"');
    expect(page).toContain('appId: "1:864976295990:web:194f145b1b4dad58eb6097"');
    expect(page).not.toMatch(/bring-fm-hj/);
  });

  it("로그인 토큰을 돌려주지 않는다", async () => {
    // CRM 이 이 응답을 로그인으로 잘못 받아들이는 길을 만들지 않는다.
    const page = await loadPage();
    expect(page).toContain("drive_access_token");
    expect(page).not.toContain("provider_token");
    expect(page).not.toContain("firebase_id_token");
    expect(page).not.toContain("firebase_refresh_token");
  });

  it("검증된 localhost 콜백과 state 만 받는다", async () => {
    const page = await loadPage();
    expect(page).toContain("http://127.0.0.1:${port}/callback");
    expect(page).toContain(
      "Number.isInteger(port) && port >= 1024 && port <= 65535 && /^[A-Za-z0-9_-]{32,128}$/.test(state)",
    );
  });

  it("권한만 빼고 동의한 경우를 잡는다", async () => {
    // 동의 화면에서 Drive 항목만 체크 해제할 수 있다. 그대로 두면
    // 파일을 올릴 때 가서야 실패한다.
    const page = await loadPage();
    expect(page).toContain("grantedScopes");
    expect(page).toContain("DRIVE_SCOPE_DECLINED");
  });

  it("비밀번호나 브라우저 저장소를 쓰지 않는다", async () => {
    const page = await loadPage();
    expect(page).not.toMatch(/localStorage|sessionStorage|type=["']password/i);
    expect(page).not.toContain("login_hint");
    expect(page).not.toContain("dpvld858@gmail.com");
  });

  it("오류 코드를 짧고 안전한 형태로만 돌려준다", async () => {
    const page = await loadPage();
    const codes = [...page.matchAll(/"(DRIVE_[A-Z_]+)"/g)].map((match) => match[1]);
    expect(codes.length).toBeGreaterThan(0);
    expect(codes.every((code) => /^[A-Z_]{1,32}$/.test(code))).toBe(true);
  });

  it("Firebase Hosting 에서 캐시되지 않는다", async () => {
    // 캐시되면 예전 페이지가 남아 콜백 주소가 어긋난다.
    const firebaseConfig = JSON.parse(
      await readFile(resolve("../firebase.json"), "utf8"),
    ) as { hosting: { headers: { source: string; headers: { key: string; value: string }[] }[] } };
    const rules = firebaseConfig.hosting.headers.filter((entry) =>
      entry.source.startsWith("/crm-drive-auth"),
    );
    expect(rules.length).toBeGreaterThanOrEqual(2);
    for (const rule of rules) {
      const cacheControl = rule.headers.find((header) => header.key === "Cache-Control");
      expect(cacheControl?.value).toContain("no-store");
    }
  });
});
