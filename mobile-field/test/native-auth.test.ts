import { beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => {
  const user = { uid: 'staff-a', emailVerified: true };
  return { calls: [] as string[], options: undefined as unknown, project: 'bring-fm', appId: 'native-a',
    auth: { currentUser: user as typeof user | null, authStateReady: async () => {} },
    token: vi.fn(async () => 'synthetic-token'), check: vi.fn(async () => ({ token: 'synthetic-check' })),
  };
});
vi.mock('@react-native-firebase/app', () => ({ getApp: () => ({ options: { projectId: fixture.project, appId: fixture.appId } }) }));
vi.mock('@react-native-firebase/app-check', () => ({
  ReactNativeFirebaseAppCheckProvider: class { configure(options: unknown) { fixture.options = options; } },
  initializeAppCheck: () => { fixture.calls.push('app-check'); return {}; }, getToken: fixture.check,
}));
vi.mock('@react-native-firebase/auth', () => ({
  getAuth: () => { fixture.calls.push('auth'); return fixture.auth; }, getIdToken: fixture.token,
  signInWithEmailAndPassword: async () => ({ user: fixture.auth.currentUser }), signOut: async () => { fixture.auth.currentUser = null; },
  onAuthStateChanged: (_auth: unknown, fn: (user: unknown) => void) => { fn(fixture.auth.currentUser); return () => {}; },
}));
beforeEach(() => { vi.resetModules(); fixture.calls.length = 0; fixture.options = undefined; fixture.project = 'bring-fm'; fixture.appId = 'native-a'; fixture.auth.currentUser = { uid: 'staff-a', emailVerified: true }; fixture.token.mockReset().mockResolvedValue('synthetic-token'); fixture.check.mockReset().mockResolvedValue({ token: 'synthetic-check' }); });
const expected = { projectId: 'bring-fm', nativeAppIds: ['native-a', 'native-b'] };
it('initializes native attestation before Auth, without debug providers, and reuses it across React remounts', async () => {
  const { createEmployeeIdentity } = await import('../src/auth/firebase');
  const [first, second] = await Promise.all([createEmployeeIdentity(expected), createEmployeeIdentity(expected)]);
  expect(first).toBe(second); expect(fixture.calls).toEqual(['app-check', 'auth']);
  expect(fixture.options).toEqual({ android: { provider: 'playIntegrity' }, apple: { provider: 'appAttestWithDeviceCheckFallback' } });
  expect(await first.credentials('staff-a')).toEqual({ uid: 'staff-a', idToken: 'synthetic-token', appCheckToken: 'synthetic-check' });
});
it.each(['project', 'appId'] as const)('blocks mismatched native %s before Auth initialization', async key => {
  fixture[key] = 'wrong'; const { createEmployeeIdentity } = await import('../src/auth/firebase');
  await expect(createEmployeeIdentity(expected)).rejects.toThrow('NATIVE_APP_NOT_CONFIGURED'); expect(fixture.calls).toEqual([]);
});
it('does not return a previous account token after the SDK account changes during token refresh', async () => {
  const { createEmployeeIdentity } = await import('../src/auth/firebase'); const identity = await createEmployeeIdentity(expected);
  fixture.token.mockImplementationOnce(async () => { fixture.auth.currentUser = { uid: 'staff-b', emailVerified: true }; return 'synthetic-old-token'; });
  await expect(identity.credentials('staff-a')).rejects.toThrow('AUTH_REQUIRED');
});
it('refuses unverified employees and suppresses raw SDK failures', async () => {
  const { createEmployeeIdentity } = await import('../src/auth/firebase'); const identity = await createEmployeeIdentity(expected);
  fixture.auth.currentUser!.emailVerified = false; await expect(identity.signIn('synthetic@example.invalid', 'synthetic')).rejects.toThrow('LOGIN_FAILED');
  fixture.auth.currentUser!.emailVerified = true; fixture.check.mockRejectedValueOnce(Error('PRIVATE_PROVIDER_ERROR'));
  await expect(identity.credentials('staff-a')).rejects.toThrow('AUTH_REQUIRED');
});
