import type { EmployeeIdentity } from './session';
import { FieldError } from '../domain/model';

let initialized: { key: string; promise: Promise<EmployeeIdentity> } | undefined;
export function createEmployeeIdentity(expected: { projectId: string; nativeAppIds: string[] }): Promise<EmployeeIdentity> {
  const key = expected.projectId + ':' + [...expected.nativeAppIds].sort().join(',');
  if (initialized) {
    if (initialized.key !== key) return Promise.reject(new FieldError('NATIVE_APP_NOT_CONFIGURED'));
    return initialized.promise;
  }
  const promise = initializeIdentity(expected).catch(error => { initialized = undefined; throw error; });
  initialized = { key, promise }; return promise;
}
async function initializeIdentity(expected: { projectId: string; nativeAppIds: string[] }): Promise<EmployeeIdentity> {
  // Imported only in an enrolled native build; web/sample mode never loads RNFB.
  const appSdk = await import('@react-native-firebase/app');
  const appCheckSdk = await import('@react-native-firebase/app-check');
  const app = appSdk.getApp();
  if (app.options.projectId !== expected.projectId || !expected.nativeAppIds.includes(app.options.appId)) throw new FieldError('NATIVE_APP_NOT_CONFIGURED');
  const provider = new appCheckSdk.ReactNativeFirebaseAppCheckProvider();
  provider.configure({ android: { provider: 'playIntegrity' }, apple: { provider: 'appAttestWithDeviceCheckFallback' } });
  const check = appCheckSdk.initializeAppCheck(app, {
    provider,
    isTokenAutoRefreshEnabled: true,
  });
  const authSdk = await import('@react-native-firebase/auth'); const auth = authSdk.getAuth(app);
  return {
    ready: () => auth.authStateReady(), currentUid: () => auth.currentUser?.uid ?? null,
    async signIn(email, password) {
      try {
        const result = await authSdk.signInWithEmailAndPassword(auth, email, password);
        if (!result.user.emailVerified) throw new FieldError('AUTH_REQUIRED');
        return result.user.uid;
      } catch { throw new FieldError('LOGIN_FAILED'); }
    },
    signOut: () => authSdk.signOut(auth),
    observe: listener => authSdk.onAuthStateChanged(auth, user => listener(user?.uid ?? null)),
    async credentials(uid) {
      const user = auth.currentUser;
      if (!user || user.uid !== uid || !user.emailVerified) throw new FieldError('AUTH_REQUIRED');
      try {
        const [idToken, checked] = await Promise.all([authSdk.getIdToken(user), appCheckSdk.getToken(check)]);
        if (auth.currentUser?.uid !== uid) throw new FieldError('AUTH_REQUIRED');
        return { uid, idToken, appCheckToken: checked.token };
      } catch { throw new FieldError('AUTH_REQUIRED'); }
    },
  };
}
