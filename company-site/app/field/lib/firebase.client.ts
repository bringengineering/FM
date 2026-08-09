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
};
const initializedAppCheckApps = appCheckState.__bringFieldAppCheckApps ??= new Set<string>();

if (
  appCheckSiteKey &&
  typeof window !== "undefined" &&
  !initializedAppCheckApps.has(firebaseApp.name)
) {
  initializeAppCheck(firebaseApp, {
    provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
  initializedAppCheckApps.add(firebaseApp.name);
}

export const auth = getAuth(firebaseApp);
export const database = getDatabase(firebaseApp);
export const storage = getStorage(firebaseApp);
export const functions = getFunctions(firebaseApp, "asia-northeast3");
