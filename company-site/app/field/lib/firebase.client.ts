import { getApp, getApps, initializeApp } from "firebase/app";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
} from "firebase/app-check";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyBKOTIuQ8pOKSuaeKFQs_6UDdDnxdjCTZg",
  authDomain: "bring-fm.firebaseapp.com",
  databaseURL: "https://bring-fm-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "bring-fm",
  storageBucket: "bring-fm.firebasestorage.app",
  messagingSenderId: "864976295990",
  appId: "1:864976295990:web:194f145b1b4dad58eb6097",
} as const;

export const firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

const appCheckSiteKey = process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY;
const appCheckState = globalThis as typeof globalThis & {
  __bringFieldAppCheckApps?: Set<string>;
  FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean;
};
const initializedAppCheckApps = appCheckState.__bringFieldAppCheckApps ??= new Set<string>();

export function resolveFieldAppCheckConfigurationError(
  _nodeEnv: string | undefined,
  _siteKey: string | undefined,
): string | null {
  return null;
}

export const fieldAppCheckConfigurationError = resolveFieldAppCheckConfigurationError(
  process.env.NODE_ENV,
  appCheckSiteKey,
);

if (
  process.env.NODE_ENV !== "production"
  && process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN === "true"
  && typeof window !== "undefined"
) {
  appCheckState.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}

if (
  appCheckSiteKey?.trim() &&
  typeof window !== "undefined" &&
  !initializedAppCheckApps.has(firebaseApp.name)
) {
  initializeAppCheck(firebaseApp, {
    provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey.trim()),
    isTokenAutoRefreshEnabled: true,
  });
  initializedAppCheckApps.add(firebaseApp.name);
}

export const auth = getAuth(firebaseApp);
export const database = getDatabase(firebaseApp);
export const storage = getStorage(firebaseApp);
export const functions = getFunctions(firebaseApp, "asia-northeast3");
