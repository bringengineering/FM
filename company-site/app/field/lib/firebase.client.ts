import { getApp, getApps, initializeApp } from "firebase/app";
import {
  getToken,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
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
  __bringFieldAppCheckInstances?: Map<string, AppCheck>;
  FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean;
};
const initializedAppCheckApps = appCheckState.__bringFieldAppCheckApps ??= new Set<string>();
const initializedAppCheckInstances = appCheckState.__bringFieldAppCheckInstances ??= new Map<string, AppCheck>();
let fieldAppCheck: AppCheck | null = null;
let fieldAppCheckInitializationFailed = false;

const APP_CHECK_CONFIGURATION_MESSAGE = "현장 업무 보안 연결 설정을 확인해 주세요.";

export function resolveFieldAppCheckConfigurationError(
  nodeEnv: string | undefined,
  siteKey: string | undefined,
  embeddedMode = false,
  explicitDebug = false,
): string | null {
  if (siteKey?.trim()) return null;
  if (embeddedMode || nodeEnv === "production") return APP_CHECK_CONFIGURATION_MESSAGE;
  return explicitDebug && nodeEnv !== "production"
    ? null
    : APP_CHECK_CONFIGURATION_MESSAGE;
}

export const fieldAppCheckConfigurationError = resolveFieldAppCheckConfigurationError(
  process.env.NODE_ENV,
  appCheckSiteKey,
  false,
  process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN === "true",
);

export function fieldAppCheckConfigurationErrorFor(embeddedMode: boolean): string | null {
  if (fieldAppCheckInitializationFailed) return APP_CHECK_CONFIGURATION_MESSAGE;
  return resolveFieldAppCheckConfigurationError(
    process.env.NODE_ENV,
    appCheckSiteKey,
    embeddedMode,
    process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN === "true",
  );
}

if (
  process.env.NODE_ENV !== "production"
  && process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN === "true"
  && typeof window !== "undefined"
) {
  appCheckState.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}

if (
  appCheckSiteKey?.trim() &&
  typeof window !== "undefined"
) {
  try {
    if (initializedAppCheckApps.has(firebaseApp.name)) {
      fieldAppCheck = initializedAppCheckInstances.get(firebaseApp.name) ?? null;
      if (!fieldAppCheck) throw new Error("field_app_check_instance_missing");
    } else {
      fieldAppCheck = initializeAppCheck(firebaseApp, {
        provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey.trim()),
        isTokenAutoRefreshEnabled: true,
      });
      initializedAppCheckApps.add(firebaseApp.name);
      initializedAppCheckInstances.set(firebaseApp.name, fieldAppCheck);
    }
  } catch {
    fieldAppCheckInitializationFailed = true;
  }
}

export async function ensureFieldAppCheckToken(): Promise<void> {
  if (fieldAppCheckInitializationFailed || !fieldAppCheck) {
    throw new Error("field_app_check_unavailable");
  }
  try {
    const result = await getToken(fieldAppCheck, false);
    if (!result?.token) throw new Error("field_app_check_unavailable");
  } catch {
    throw new Error("field_app_check_unavailable");
  }
}

export const auth = getAuth(firebaseApp);
export const database = getDatabase(firebaseApp);
export const storage = getStorage(firebaseApp);
export const functions = getFunctions(firebaseApp, "asia-northeast3");
