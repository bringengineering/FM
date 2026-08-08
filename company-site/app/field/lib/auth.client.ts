import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { httpsCallable } from "firebase/functions";

import { auth, functions } from "./firebase.client";
import type { UserRole } from "./types";

export interface FieldAuthUser {
  uid: string;
  displayName: string | null;
  getIdTokenResult(forceRefresh?: boolean): Promise<{
    claims: Record<string, unknown>;
  }>;
}

export interface FieldAuthDependencies {
  signInWithGoogle(): Promise<{ user: FieldAuthUser }>;
  provisionFieldUser(): Promise<void>;
  signOut(): Promise<void>;
}

export interface FieldSession {
  uid: string;
  displayName: string;
  role: UserRole;
}

const roles = new Set<UserRole>(["admin", "staff", "reviewer"]);

function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && roles.has(value as UserRole);
}

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

const provisionCallable = httpsCallable<undefined, { enabled: boolean; role: UserRole }>(
  functions,
  "provisionFieldUser",
);

const defaultDependencies: FieldAuthDependencies = {
  async signInWithGoogle() {
    const credential = await signInWithPopup(auth, googleProvider);
    return { user: credential.user as User };
  },
  async provisionFieldUser() {
    await provisionCallable();
  },
  async signOut() {
    await firebaseSignOut(auth);
  },
};

export async function loginFieldUser(
  dependencies: FieldAuthDependencies = defaultDependencies,
): Promise<FieldSession> {
  const credential = await dependencies.signInWithGoogle();
  await dependencies.provisionFieldUser();
  const tokenResult = await credential.user.getIdTokenResult(true);

  if (
    tokenResult.claims.fieldPlatform !== true ||
    !isUserRole(tokenResult.claims.fieldRole)
  ) {
    await dependencies.signOut();
    throw new Error("field_access_denied");
  }

  return {
    uid: credential.user.uid,
    displayName: credential.user.displayName?.trim() || "브링 담당자",
    role: tokenResult.claims.fieldRole,
  };
}

export async function logoutFieldUser(
  dependencies: Pick<FieldAuthDependencies, "signOut"> = defaultDependencies,
): Promise<void> {
  await dependencies.signOut();
}
