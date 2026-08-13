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

function cleanHandoffUrl(url: URL): string {
  const clean = new URL(url.toString());
  clean.searchParams.delete("desktop_handoff");
  return `${clean.pathname}${clean.search}${clean.hash}`;
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
  const embeddedValues = url.searchParams.getAll("embedded");
  const codeValues = url.searchParams.getAll("desktop_handoff");
  if (embeddedValues.length === 0 && codeValues.length === 0) {
    return { mode: "standalone", consumed: false };
  }
  if (
    embeddedValues.length !== 1
    || embeddedValues[0] !== "crm"
    || codeValues.length !== 1
    || !HANDOFF_CODE_PATTERN.test(codeValues[0])
  ) {
    return { mode: "crm", consumed: false, error: "denied" };
  }

  dependencies.replaceUrl(cleanHandoffUrl(url));
  try {
    const result = await dependencies.exchange(codeValues[0]);
    if (!isValidCustomToken(result.customToken)) {
      return { mode: "crm", consumed: false, error: "unavailable" };
    }
    await dependencies.signIn(result.customToken);
    return { mode: "crm", consumed: true };
  } catch (error) {
    return { mode: "crm", consumed: false, error: mappedError(error) };
  }
}
