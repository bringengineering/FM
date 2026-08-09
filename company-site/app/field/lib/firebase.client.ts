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
  apiKey: "AIzaSyAeAvJIeu5hOHQ-aT6YurHdPh1thO-NYmo",
  authDomain: "bring-fm-hj.firebaseapp.com",
  databaseURL: "https://bring-fm-hj-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "bring-fm-hj",
  storageBucket: "bring-fm-hj.firebasestorage.app",
  messagingSenderId: "975975605634",
  appId: "1:975975605634:web:34ae9d7af84b3ee9ea5b9b",
} as const;

export const firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

const appCheckSiteKey = process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY;
const appCheckState = globalThis as typeof globalThis & {
  __bringFieldAppCheckApps?: Set<string>;
  FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean;
};
const initializedAppCheckApps = appCheckState.__bringFieldAppCheckApps ??= new Set<string>();

export function resolveFieldAppCheckConfigurationError(
  nodeEnv: string | undefined,
  siteKey: string | undefined,
): string | null {
  if (nodeEnv !== "production" || siteKey?.trim()) return null;
  return "보안 설정(App Check)이 완료되지 않아 서비스를 시작할 수 없습니다. 관리자에게 배포 설정 확인을 요청해 주세요.";
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
