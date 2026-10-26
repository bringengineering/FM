/** Native field access boundary. Not exported as a deployed function yet.
 * Identity/App Check verification must be supplied by Firebase Admin with
 * revocation checks. Operator labels from legacy shared-account field tools
 * must never be accepted as proof of an employee's identity.
 */
export interface MobileIdentity {
  uid: string; aud: string; iss: string; email?: string; email_verified?: boolean;
  firebase?: { sign_in_provider?: string };
}
export interface MobileAuthDependencies {
  projectId: string;
  allowedNativeAppIds: readonly string[];
  verifyIdentity(token: string, checkRevoked: true): Promise<MobileIdentity>;
  verifyAppCheck(token: string): Promise<{ app_id: string }>;
  readAccess(uid: string): Promise<unknown>;
}
export interface MobileActor { uid: string; role: 'admin' | 'member' }
export class MobileAccessError extends Error {
  constructor(readonly code: 'MOBILE_AUTH_REQUIRED' | 'MOBILE_ACCESS_DENIED' | 'MOBILE_APP_NOT_REGISTERED' | 'MOBILE_JOB_NOT_FOUND') { super(code); }
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const pathId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
export async function authorizeMobile(headers: { authorization: string; appCheck: string }, deps: MobileAuthDependencies): Promise<MobileActor> {
  if (!deps.projectId || deps.allowedNativeAppIds.length === 0) throw new MobileAccessError('MOBILE_APP_NOT_REGISTERED');
  const bearer = /^Bearer ([A-Za-z0-9._~-]{1,12000})$/.exec(headers.authorization);
  if (!bearer || !/^[A-Za-z0-9._~-]{1,12000}$/.test(headers.appCheck)) throw new MobileAccessError('MOBILE_AUTH_REQUIRED');
  let identity: MobileIdentity;
  try {
    const attestation = await deps.verifyAppCheck(headers.appCheck);
    if (!deps.allowedNativeAppIds.includes(attestation.app_id)) throw new Error('unregistered');
    identity = await deps.verifyIdentity(bearer[1]!, true);
  } catch { throw new MobileAccessError('MOBILE_AUTH_REQUIRED'); }
  if (!pathId(identity.uid) || identity.aud !== deps.projectId || identity.iss !== `https://securetoken.google.com/${deps.projectId}`
    || identity.email_verified !== true || !identity.email || identity.firebase?.sign_in_provider !== 'password') throw new MobileAccessError('MOBILE_AUTH_REQUIRED');
  let access: unknown;
  try { access = await deps.readAccess(identity.uid); } catch { throw new MobileAccessError('MOBILE_ACCESS_DENIED'); }
  if (!object(access) || access.enabled !== true || access.mustChangePassword === true || access.accountSetupPending === true
    || access.deletionPending === true || !!access.deletedAt || access.marketingRole === 'marketing'
    || typeof access.email !== 'string' || access.email.trim().toLowerCase() !== identity.email.trim().toLowerCase()
    || (access.role !== 'member' && access.role !== 'admin')) throw new MobileAccessError('MOBILE_ACCESS_DENIED');
  return { uid: identity.uid, role: access.role };
}
/** assignedUids must be resolved server-side from canonical work assignments.
 * Until a teamProfile-to-auth-UID mapping has been verified, return no member
 * jobs rather than accepting a client-supplied operatorId or display name.
 */
export function authorizeMobileJob(actor: MobileActor, job: unknown): void {
  if (!object(job) || !pathId(job.id) || !pathId(job.buildingId) || job.active !== true
    || !Array.isArray(job.assignedUids) || !job.assignedUids.every(pathId)
    || (actor.role !== 'admin' && !job.assignedUids.includes(actor.uid))) throw new MobileAccessError('MOBILE_JOB_NOT_FOUND');
}
export function authorizeMobileDelivery(actor: MobileActor): void {
  if (actor.role !== 'admin') throw new MobileAccessError('MOBILE_ACCESS_DENIED');
}
