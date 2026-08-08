import { getApp, getApps, initializeApp } from "firebase/app";
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
export const auth = getAuth(firebaseApp);
export const database = getDatabase(firebaseApp);
export const storage = getStorage(firebaseApp);
export const functions = getFunctions(firebaseApp, "asia-northeast3");
