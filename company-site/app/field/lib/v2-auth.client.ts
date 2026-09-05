import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { get, ref } from "firebase/database";

import { auth, database } from "./firebase.client";
import type { FieldCrmRole } from "./v2/contracts";

export interface FieldV2AuthUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
}

export interface FieldV2Session {
  readonly uid: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: FieldCrmRole;
}

export type FieldV2AuthState = "checking" | "missing" | "authenticated" | "unavailable";

export interface FieldV2SessionDependencies {
  readAccess(uid: string): Promise<unknown>;
}

export type FieldV2SessionObserver = (
  listener: (session: FieldV2Session | null, state?: FieldV2AuthState) => void,
  errorListener?: (error: Error) => void,
) => () => void;

export interface FieldV2SessionObserverDependencies extends FieldV2SessionDependencies {
  subscribe(listener: (user: FieldV2AuthUser | null) => void): () => void;
}

const CRM_ROLES = new Set<FieldCrmRole>(["admin", "member", "viewer"]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

async function readAccess(uid: string): Promise<unknown> {
  return (await get(ref(database, `crmCompany/access/${uid}`))).val() as unknown;
}

export async function resolveFieldV2Session(
  user: FieldV2AuthUser,
  dependencies: FieldV2SessionDependencies = { readAccess },
): Promise<FieldV2Session> {
  const email = normalizedEmail(user.email);
  if (!user.uid || !email || user.emailVerified !== true) throw new Error("field_access_denied");
  let access: unknown;
  try {
    access = await dependencies.readAccess(user.uid);
  } catch {
    throw new Error("field_access_unavailable");
  }
  if (
    !record(access)
    || access.enabled !== true
    || typeof access.role !== "string"
    || !CRM_ROLES.has(access.role as FieldCrmRole)
    || normalizedEmail(access.email) !== email
  ) throw new Error("field_access_denied");
  return Object.freeze({
    uid: user.uid,
    email,
    displayName: user.displayName?.trim() || "브링 담당자",
    role: access.role as FieldCrmRole,
  });
}

function asV2User(user: User): FieldV2AuthUser {
  return {
    uid: user.uid,
    email: user.email,
    emailVerified: user.emailVerified,
    displayName: user.displayName,
  };
}

export async function loginFieldV2User(): Promise<FieldV2Session> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const credential = await signInWithPopup(auth, provider);
  try {
    return await resolveFieldV2Session(asV2User(credential.user));
  } catch (error) {
    await firebaseSignOut(auth).catch(() => undefined);
    throw error;
  }
}

export function observeFieldV2Session(
  listener: (session: FieldV2Session | null, state?: FieldV2AuthState) => void,
  errorListener?: (error: Error) => void,
  dependencies: FieldV2SessionObserverDependencies = {
    readAccess,
    subscribe(next) {
      return onAuthStateChanged(auth, (user) => next(user ? asV2User(user) : null));
    },
  },
): () => void {
  let active = true;
  let revision = 0;
  const unsubscribe = dependencies.subscribe((user) => {
    const current = ++revision;
    // Every Firebase auth epoch invalidates the previous workspace before any
    // access lookup. This prevents a slow/denied next account from seeing it.
    listener(null, user ? "checking" : "missing");
    if (!user) {
      return;
    }
    void resolveFieldV2Session(user, dependencies)
      .then((session) => {
        if (active && revision === current) listener(session, "authenticated");
      })
      .catch((error: unknown) => {
        if (!active || revision !== current) return;
        const safeError = error instanceof Error ? error : new Error("field_access_unavailable");
        // The Firebase user is still signed in. Keep transport authentication
        // separate from access/profile readiness so desktop does not start a
        // handoff loop for a permission or data outage.
        listener(null, "authenticated");
        errorListener?.(safeError);
      });
  });
  return () => {
    active = false;
    revision += 1;
    unsubscribe();
  };
}

export async function logoutFieldV2User(): Promise<void> {
  await firebaseSignOut(auth);
}
