import { signInWithCustomToken } from "firebase/auth";
import { httpsCallable } from "firebase/functions";

import { auth, functions } from "./firebase.client";

export type DesktopHandoffState =
  | { mode: "standalone"; consumed: false }
  | {
      mode: "crm";
      consumed: boolean;
      error?: "expired" | "denied" | "unavailable";
    };

export interface DesktopHandoffClientDependencies {
  exchange(code: string): Promise<{ customToken: string }>;
  signIn(customToken: string): Promise<void>;
  replaceUrl(url: string): void;
}

const HANDOFF_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const exchangeCallable = httpsCallable<
  { code: string },
  { customToken: string }
>(functions, "exchangeDesktopFieldHandoff");

const defaultDependencies: DesktopHandoffClientDependencies = {
  async exchange(code) {
    const result = await exchangeCallable({ code });
    return result.data;
  },
  async signIn(customToken) {
    await signInWithCustomToken(auth, customToken);
  },
  replaceUrl(url) {
    window.history.replaceState(null, "", url);
  },
};

function errorCode(error: unknown): string {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && typeof error.code === "string"
    ? error.code
    : "";
}

const EXACT_CRM_URL = "/field?embedded=crm";

function hasExactQueryKeys(url: URL, expected: readonly string[]): boolean {
  const entries = [...url.searchParams.entries()];
  return entries.length === expected.length
    && expected.every((key) => entries.filter(([candidate]) => candidate === key).length === 1);
}

export function isExactCrmEmbeddedUrl(url: URL): boolean {
  return url.pathname === "/field"
    && url.hash === ""
    && hasExactQueryKeys(url, ["embedded"])
    && url.searchParams.get("embedded") === "crm";
}

export function isDesktopHandoffBootstrapUrl(url: URL): boolean {
  const code = url.searchParams.get("desktop_handoff");
  return url.pathname === "/field"
    && url.hash === ""
    && hasExactQueryKeys(url, ["embedded", "desktop_handoff"])
    && url.searchParams.get("embedded") === "crm"
    && typeof code === "string"
    && HANDOFF_CODE_PATTERN.test(code);
}

function isValidCustomToken(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 8192
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function mappedError(error: unknown): "expired" | "denied" | "unavailable" {
  const code = errorCode(error);
  if (code === "functions/deadline-exceeded") return "expired";
  if (
    code === "functions/permission-denied"
    || code === "functions/failed-precondition"
    || code === "functions/unauthenticated"
  ) return "denied";
  return "unavailable";
}

export async function consumeDesktopHandoffFromUrl(
  url: URL,
  dependencies: DesktopHandoffClientDependencies = defaultDependencies,
): Promise<DesktopHandoffState> {
  if (isExactCrmEmbeddedUrl(url)) {
    return { mode: "crm", consumed: false };
  }
  if (url.pathname === "/field" && url.search === "" && url.hash === "") {
    return { mode: "standalone", consumed: false };
  }
  const hasEmbedded = url.searchParams.has("embedded");
  const hasHandoff = url.searchParams.has("desktop_handoff");
  if (!hasEmbedded && !hasHandoff) {
    return { mode: "standalone", consumed: false };
  }
  if (!isDesktopHandoffBootstrapUrl(url)) {
    return { mode: "crm", consumed: false, error: "denied" };
  }

  const code = url.searchParams.get("desktop_handoff") as string;
  dependencies.replaceUrl(EXACT_CRM_URL);
  try {
    const result = await dependencies.exchange(code);
    if (!isValidCustomToken(result.customToken)) {
      return { mode: "crm", consumed: false, error: "unavailable" };
    }
    await dependencies.signIn(result.customToken);
    return { mode: "crm", consumed: true };
  } catch (error) {
    return { mode: "crm", consumed: false, error: mappedError(error) };
  }
}
