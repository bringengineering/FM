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

  it("returns a Google credential without handling a password or custom browser storage", async () => {
    const page = await loadPage();

    expect(page).toContain("GoogleAuthProvider");
    expect(page).toContain("signInWithPopup");
    expect(page).toContain("credential.accessToken");
    expect(page).toContain('provider.setCustomParameters({ prompt: "select_account" })');
    expect(page).not.toContain("login_hint");
    expect(page).not.toContain("dpvld858@gmail.com");
    expect(page).not.toMatch(/localStorage|sessionStorage|type=["']password/i);
  });

  it("keeps the authentication bridge non-cacheable on Firebase Hosting", async () => {
    const firebaseConfig = JSON.parse(
      await readFile(resolve("../firebase.json"), "utf8"),
    ) as {
      hosting?: {
        headers?: Array<{
          source?: string;
          headers?: Array<{ key?: string; value?: string }>;
        }>;
      };
    };
    const rules = firebaseConfig.hosting?.headers ?? [];
    const cacheControl = (source: string) => rules
      .find((rule) => rule.source === source)
      ?.headers?.find((header) => header.key?.toLowerCase() === "cache-control")
      ?.value;

    expect(cacheControl("/crm-auth")).toBe("no-cache, no-store, must-revalidate");
    expect(cacheControl("/crm-auth/**")).toBe("no-cache, no-store, must-revalidate");
  });

  it("posts a bounded safe callback error immediately when the popup closes or fails", async () => {
    const page = await loadPage();

    expect(page).toContain('new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request"])');
    expect(page).toContain('"AUTH_POPUP_CANCELLED"');
    expect(page).toContain('"AUTH_POPUP_FAILED"');
    expect(page).toContain('postSession([["error", errorCode]])');
    expect(page).toContain('for (const [name, value] of [["state", state], ...fields])');
    expect(page).toContain('postSession([["provider_token_type", providerTokenType], ["provider_token", providerToken]])');
    expect(page).not.toMatch(/error\.(?:message|stack|name)/);

    const safeCodes = [...page.matchAll(/"(AUTH_POPUP_[A-Z_]+)"/g)].map((match) => match[1]);
    expect(new Set(safeCodes)).toEqual(new Set(["AUTH_POPUP_CANCELLED", "AUTH_POPUP_FAILED"]));
    expect(safeCodes.every((code) => /^[A-Z_]{1,32}$/.test(code))).toBe(true);
  });
});
