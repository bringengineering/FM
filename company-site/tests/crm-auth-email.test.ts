import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("CRM shared email authentication page", () => {
  it("signs email-password into Firebase and returns the Firebase session without storing the password", async () => {
    const html = await readFile(path.join(process.cwd(), "public", "crm-auth", "index.html"), "utf8");

    expect(html).toContain("window.bringEmailLogin = async (email, password) =>");
    expect(html).toContain("signInWithEmailAndPassword(email, password)");
    expect(html).toContain('["firebase_id_token", idToken]');
    expect(html).toContain('["firebase_refresh_token", refreshToken]');
    expect(html).not.toContain("123456");
    expect(html).not.toContain("localStorage.setItem");
  });
});
