import { describe, expect, it, vi } from "vitest";

import {
  consumeDesktopHandoffFromUrl,
  isDesktopHandoffBootstrapUrl,
  isExactCrmEmbeddedUrl,
  type DesktopHandoffClientDependencies,
} from "../../app/field/lib/desktop-handoff.client";

const CODE = "A".repeat(43);

function dependencies(overrides: Partial<DesktopHandoffClientDependencies> = {}) {
  return {
    exchange: vi.fn(async () => ({ customToken: "firebase-custom-token" })),
    signIn: vi.fn(async () => undefined),
    replaceUrl: vi.fn(),
    ...overrides,
  } satisfies DesktopHandoffClientDependencies;
}

describe("desktop FIELD handoff client", () => {
  it("classifies only the exact CRM route and strict two-key bootstrap exception as embedded", () => {
    expect(isExactCrmEmbeddedUrl(new URL("https://bring-fm.web.app/field?embedded=crm"))).toBe(true);
    expect(isDesktopHandoffBootstrapUrl(new URL(
      `https://bring-fm.web.app/field?embedded=crm&desktop_handoff=${CODE}`,
    ))).toBe(true);
    expect(isDesktopHandoffBootstrapUrl(new URL(
      `https://bring-fm.web.app/field?desktop_handoff=${CODE}&embedded=crm`,
    ))).toBe(true);
    for (const rawUrl of [
      "https://bring-fm.web.app/field/child?embedded=crm",
      "https://bring-fm.web.app/field?embedded=crm#jobs",
      "https://bring-fm.web.app/field?embedded=crm&tab=jobs",
      `https://bring-fm.web.app/field?embedded=crm&desktop_handoff=${CODE}&extra=1`,
    ]) {
      const url = new URL(rawUrl);
      expect(isExactCrmEmbeddedUrl(url), rawUrl).toBe(false);
      expect(isDesktopHandoffBootstrapUrl(url), rawUrl).toBe(false);
    }
  });

  it("leaves standalone FIELD authentication unchanged", async () => {
    const deps = dependencies();

    await expect(consumeDesktopHandoffFromUrl(
      new URL("https://bring-fm.web.app/field"),
      deps,
    )).resolves.toEqual({ mode: "standalone", consumed: false });

    expect(deps.exchange).not.toHaveBeenCalled();
    expect(deps.signIn).not.toHaveBeenCalled();
    expect(deps.replaceUrl).not.toHaveBeenCalled();
  });

  it("exchanges one valid code, signs in, and removes it from the URL", async () => {
    const deps = dependencies();

    await expect(consumeDesktopHandoffFromUrl(
      new URL(`https://bring-fm.web.app/field?embedded=crm&desktop_handoff=${CODE}`),
      deps,
    )).resolves.toEqual({ mode: "crm", consumed: true });

    expect(deps.exchange).toHaveBeenCalledWith(CODE);
    expect(deps.signIn).toHaveBeenCalledWith("firebase-custom-token");
    expect(deps.replaceUrl).toHaveBeenCalledWith("/field?embedded=crm");
  });

  it("accepts the already-normalized CRM entry without replaying a handoff", async () => {
    const deps = dependencies();

    await expect(consumeDesktopHandoffFromUrl(
      new URL("https://bring-fm.web.app/field?embedded=crm"),
      deps,
    )).resolves.toEqual({ mode: "crm", consumed: false });

    expect(deps.exchange).not.toHaveBeenCalled();
    expect(deps.signIn).not.toHaveBeenCalled();
    expect(deps.replaceUrl).not.toHaveBeenCalled();
  });

  it("treats the two bootstrap query keys as an order-independent exact set", async () => {
    const deps = dependencies();

    await expect(consumeDesktopHandoffFromUrl(
      new URL(`https://bring-fm.web.app/field?desktop_handoff=${CODE}&embedded=crm`),
      deps,
    )).resolves.toEqual({ mode: "crm", consumed: true });
    expect(deps.replaceUrl).toHaveBeenCalledWith("/field?embedded=crm");
  });

  it.each([
    ["short code", "https://bring-fm.web.app/field?embedded=crm&desktop_handoff=abc"],
    ["duplicate code", `https://bring-fm.web.app/field?embedded=crm&desktop_handoff=${CODE}&desktop_handoff=${CODE}`],
    ["unknown embedded mode", `https://bring-fm.web.app/field?embedded=other&desktop_handoff=${CODE}`],
    ["wrong path", `https://bring-fm.web.app/field/jobs?embedded=crm&desktop_handoff=${CODE}`],
    ["extra query", `https://bring-fm.web.app/field?embedded=crm&desktop_handoff=${CODE}&tab=jobs`],
    ["hash", `https://bring-fm.web.app/field?embedded=crm&desktop_handoff=${CODE}#jobs`],
  ])("rejects %s before a network call", async (_label, rawUrl) => {
    const deps = dependencies();

    await expect(consumeDesktopHandoffFromUrl(new URL(rawUrl), deps))
      .resolves.toEqual({ mode: "crm", consumed: false, error: "denied" });
    expect(deps.exchange).not.toHaveBeenCalled();
    expect(deps.signIn).not.toHaveBeenCalled();
    expect(deps.replaceUrl).not.toHaveBeenCalled();
  });

  it.each([
    ["functions/deadline-exceeded", "expired"],
    ["functions/permission-denied", "denied"],
    ["functions/failed-precondition", "denied"],
    ["functions/unavailable", "unavailable"],
  ] as const)("maps %s without exposing the server message", async (code, expected) => {
    const error = Object.assign(new Error("raw-sensitive-server-message"), { code });
    const deps = dependencies({ exchange: vi.fn(async () => { throw error; }) });

    await expect(consumeDesktopHandoffFromUrl(
      new URL(`https://bring-fm.web.app/field?embedded=crm&desktop_handoff=${CODE}`),
      deps,
    )).resolves.toEqual({ mode: "crm", consumed: false, error: expected });
    expect(deps.replaceUrl).toHaveBeenCalledWith("/field?embedded=crm");
    expect(deps.signIn).not.toHaveBeenCalled();
  });

  it("does not clean the URL until a malformed custom-token response is rejected", async () => {
    const deps = dependencies({ exchange: vi.fn(async () => ({ customToken: "" })) });

    await expect(consumeDesktopHandoffFromUrl(
      new URL(`https://bring-fm.web.app/field?embedded=crm&desktop_handoff=${CODE}`),
      deps,
    )).resolves.toEqual({ mode: "crm", consumed: false, error: "unavailable" });
    expect(deps.signIn).not.toHaveBeenCalled();
    expect(deps.replaceUrl).toHaveBeenCalledWith("/field?embedded=crm");
  });
});
