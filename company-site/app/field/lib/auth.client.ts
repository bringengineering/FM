import {
  GoogleAuthProvider,
  onAuthStateChanged,
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
  email?: string | null;
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

export type FieldSessionListener = (session: FieldSession | null) => void;
export type FieldSessionObserver = (listener: FieldSessionListener) => () => void;

const roles = new Set<UserRole>(["admin", "staff", "reviewer"]);

function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && roles.has(value as UserRole);
}

async function sessionFromUser(
  user: FieldAuthUser,
  forceRefresh: boolean,
): Promise<FieldSession | null> {
  const tokenResult = await user.getIdTokenResult(forceRefresh);
  if (
    tokenResult.claims.fieldPlatform !== true ||
    !isUserRole(tokenResult.claims.fieldRole)
  ) {
    return null;
  }

  return {
    uid: user.uid,
    displayName: user.displayName?.trim() || "브링 담당자",
    role: tokenResult.claims.fieldRole,
  };
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
  try {
    await dependencies.provisionFieldUser();
  } catch (error) {
    await dependencies.signOut();
    const code = typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
    throw new Error(
      code === "functions/permission-denied"
        ? "field_access_denied"
        : "field_provision_failed",
    );
  }
  const session = await sessionFromUser(credential.user, true);

  if (!session) {
    await dependencies.signOut();
    throw new Error("field_access_denied");
  }

  return session;
}

export async function logoutFieldUser(
  dependencies: Pick<FieldAuthDependencies, "signOut"> = defaultDependencies,
): Promise<void> {
  await dependencies.signOut();
}

export const observeFieldSession: FieldSessionObserver = (listener) => {
  let active = true;

  const unsubscribe = onAuthStateChanged(auth, (user) => {
    if (!user) {
      listener(null);
      return;
    }

    void sessionFromUser(user, false)
      .then((session) => {
        if (active) {
          listener(session);
        }
      })
      .catch(() => {
        if (active) {
          listener(null);
        }
      });
  });

  return () => {
    active = false;
    unsubscribe();
  };
};
