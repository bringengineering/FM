import { it, expect, vi } from 'vitest';
import { authorizeMobile, authorizeMobileDelivery, authorizeMobileJob, type MobileAuthDependencies, type MobileIdentity } from '../../functions/src/field-mobile/access';
const identity: MobileIdentity = { uid: 'staff-a', aud: 'test-company', iss: 'https://securetoken.google.com/test-company', email: 'test@example.invalid', email_verified: true, firebase: { sign_in_provider: 'password' } };
const headers = { authorization: 'Bearer test-token', appCheck: 'test-attestation' };
function deps(access: Record<string, unknown> = {}): MobileAuthDependencies { return {
  projectId: 'test-company', allowedNativeAppIds: ['native-test'], verifyIdentity: vi.fn(async () => identity),
  verifyAppCheck: vi.fn(async () => ({ app_id: 'native-test' })),
  readAccess: vi.fn(async () => ({ enabled: true, email: identity.email, role: 'member', ...access })),
}; }
it('verifies revocation and native app identity before resolving the current CRM access record', async () => {
  const d = deps(); expect(await authorizeMobile(headers, d)).toEqual({ uid: 'staff-a', role: 'member' });
  expect(d.verifyIdentity).toHaveBeenCalledWith('test-token', true); expect(d.readAccess).toHaveBeenCalledWith('staff-a');
});
it.each([{ enabled: false }, { role: 'viewer' }, { marketingRole: 'marketing' }, { mustChangePassword: true }, { accountSetupPending: true }, { deletionPending: true }, { email: 'different@example.invalid' }])('refuses inactive or ineligible CRM access %j', async access => {
  await expect(authorizeMobile(headers, deps(access))).rejects.toThrow('MOBILE_ACCESS_DENIED');
});
it.each([{ aud: 'other-project' }, { iss: 'https://securetoken.google.com/other-project' }, { email_verified: false }, { firebase: { sign_in_provider: 'custom' } }])('refuses mismatched identity %j', async override => {
  const d = deps(); d.verifyIdentity = async () => ({ ...identity, ...override }); await expect(authorizeMobile(headers, d)).rejects.toThrow('MOBILE_AUTH_REQUIRED');
});
it('rejects a web App Check token and leaves CRM unread', async () => {
  const d = deps(); d.verifyAppCheck = async () => ({ app_id: 'existing-web-app' });
  await expect(authorizeMobile(headers, d)).rejects.toThrow('MOBILE_AUTH_REQUIRED'); expect(d.readAccess).not.toHaveBeenCalled();
});
it('does not guess employee identity from a shared operator label or allow member delivery', () => {
  const actor = { uid: 'staff-a', role: 'member' as const }; const job = { id: 'job-a', buildingId: 'building-a', active: true, assignedUids: ['staff-b'], operatorId: 'staff-a' };
  expect(() => authorizeMobileJob(actor, job)).toThrow('MOBILE_JOB_NOT_FOUND');
  expect(() => authorizeMobileJob(actor, { ...job, assignedUids: ['staff-a'] })).not.toThrow();
  expect(() => authorizeMobileDelivery(actor)).toThrow('MOBILE_ACCESS_DENIED');
});
