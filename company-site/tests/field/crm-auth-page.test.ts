import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const loadPage = () => readFile(resolve("public/crm-auth/index.html"), "utf8");

describe("company CRM Google auth bridge", () => {
  it("uses only the bring-fm Firebase project", async () => {
    const page = await loadPage();

    expect(page).toContain('apiKey: "AIzaSyBKOTIuQ8pOKSuaeKFQs_6UDdDnxdjCTZg"');
    expect(page).toContain('authDomain: "bring-fm.firebaseapp.com"');
    expect(page).toContain('projectId: "bring-fm"');
    expect(page).not.toContain("bring-fm-hj");
  });

  it("accepts only a validated localhost callback and state", async () => {
    const page = await loadPage();

    expect(page).toMatch(/Number\.isInteger\(port\)/);
    expect(page).toMatch(/port\s*>=\s*1024/);
    expect(page).toMatch(/port\s*<=\s*65535/);
    expect(page).toMatch(/\^\[A-Za-z0-9_-\]\{32,128\}\$/);
    expect(page).toContain("http://127.0.0.1:${port}/callback");
  });

  it("returns a Google credential without password or browser persistence", async () => {
    const page = await loadPage();

    expect(page).toContain("GoogleAuthProvider");
    expect(page).toContain("signInWithPopup");
    expect(page).toContain("credential.accessToken");
    expect(page).toContain('login_hint: "dpvld858@gmail.com"');
    expect(page).not.toMatch(/localStorage|sessionStorage|type=["']password/i);
  });
});
