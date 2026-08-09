import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithRedirect,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { get, ref } from "firebase/database";
import { httpsCallable } from "firebase/functions";

import { auth, database, functions } from "./firebase.client";
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
  getFieldUser(uid: string): Promise<unknown>;
  signOut(): Promise<void>;
}

export interface FieldSession {
  uid: string;
  displayName: string;
  role: UserRole;
}

export type FieldSessionListener = (session: FieldSession | null) => void;
export type FieldSessionErrorListener = (error: Error) => void;
export type FieldSessionObserver = (
  listener: FieldSessionListener,
  errorListener?: FieldSessionErrorListener,
) => () => void;

const roles = new Set<UserRole>(["admin", "staff", "reviewer"]);

function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && roles.has(value as UserRole);
}

function isEnabledFieldUser(value: unknown, role: UserRole): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "enabled" in value &&
    value.enabled === true &&
    "role" in value &&
    value.role === role
  );
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
  signInWithGoogle() {
    return signInWithRedirect(auth, googleProvider);
  },
  async provisionFieldUser() {
    await provisionCallable();
  },
  async getFieldUser(uid) {
    const snapshot = await get(ref(database, `fieldPlatform/users/${uid}`));
    return snapshot.val() as unknown;
  },
  async signOut() {
    await firebaseSignOut(auth);
  },
};

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
}

function loginStartError(error: unknown): Error {
  const code = errorCode(error);
  if (code === "auth/unauthorized-domain") {
    return new Error("field_login_domain_not_authorized");
  }
  if (
    code === "auth/operation-not-supported-in-this-environment" ||
    code === "auth/web-storage-unsupported"
  ) {
    return new Error("field_login_browser_unsupported");
  }
  return new Error("field_login_start_failed");
}

function provisioningError(error: unknown): Error {
  return new Error(
    errorCode(error) === "functions/permission-denied"
      ? "field_access_denied"
      : "field_provision_failed",
  );
}

async function restoreFieldSession(
  user: FieldAuthUser,
  dependencies: Pick<FieldAuthDependencies, "getFieldUser" | "provisionFieldUser">,
): Promise<FieldSession> {
  const restored = await sessionFromUser(user, false);
  if (restored) return verifyEnabledFieldSession(restored, dependencies);

  try {
    await dependencies.provisionFieldUser();
  } catch (error) {
    throw provisioningError(error);
  }

  const provisioned = await sessionFromUser(user, true);
  if (!provisioned) {
    throw new Error("field_access_denied");
  }

  return verifyEnabledFieldSession(provisioned, dependencies);
}

async function verifyEnabledFieldSession(
  session: FieldSession,
  dependencies: Pick<FieldAuthDependencies, "getFieldUser">,
): Promise<FieldSession> {
  const fieldUser = await dependencies.getFieldUser(session.uid);
  if (!isEnabledFieldUser(fieldUser, session.role)) {
    throw new Error("field_access_denied");
  }
  return session;
}

export async function loginFieldUser(
  dependencies: FieldAuthDependencies = defaultDependencies,
): Promise<FieldSession> {
  let credential: { user: FieldAuthUser };
  try {
    credential = await dependencies.signInWithGoogle();
  } catch (error) {
    throw loginStartError(error);
  }

  try {
    return await restoreFieldSession(credential.user, dependencies);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "field_access_denied" ||
        error.message === "field_provision_failed")
    ) {
      await dependencies.signOut().catch(() => undefined);
    }
    throw error;
  }
}

export async function logoutFieldUser(
  dependencies: Pick<FieldAuthDependencies, "signOut"> = defaultDependencies,
): Promise<void> {
  await dependencies.signOut();
}

export function observeFieldSession(
  listener: FieldSessionListener,
  errorListener?: FieldSessionErrorListener,
  dependencies: Pick<
    FieldAuthDependencies,
    "getFieldUser" | "provisionFieldUser" | "signOut"
  > = defaultDependencies,
): ReturnType<FieldSessionObserver> {
  let active = true;
  let currentUser: FieldAuthUser | null = null;
  let revision = 0;
  let suppressSignedOut = false;

  const unsubscribe = onAuthStateChanged(auth, (user) => {
    currentUser = user;
    const currentRevision = ++revision;
    if (!user) {
      if (!suppressSignedOut) {
        listener(null);
      }
      return;
    }

    void restoreFieldSession(user, dependencies)
      .then((session) => {
        if (active && revision === currentRevision) {
          listener(session);
        }
      })
      .catch(async (error: unknown) => {
        if (!active || revision !== currentRevision) return;

        const failure = error instanceof Error
          ? error
          : new Error("field_session_restore_failed");
        if (
          failure.message === "field_access_denied" ||
          failure.message === "field_provision_failed"
        ) {
          suppressSignedOut = true;
          try {
            await dependencies.signOut().catch(() => undefined);
          } finally {
            suppressSignedOut = false;
          }
        }

        if (!active || (currentUser !== null && currentUser !== user)) return;
        if (errorListener) {
          errorListener(failure);
        } else {
          listener(null);
        }
      });
  });

  return () => {
    active = false;
    revision += 1;
    unsubscribe();
  };
}
