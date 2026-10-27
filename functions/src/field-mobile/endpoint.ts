import { getAppCheck } from 'firebase-admin/app-check';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { defineString } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import { firebaseCustomerSiteReads, firebaseWorkspaceReads } from './firebase-reads.js';
import { handleMobileRead } from './http.js';

// Explicit native app allowlist. Empty config disables all company reads.
const appIds = defineString('FIELD_MOBILE_NATIVE_APP_IDS', { default: '' });
const buckets = new Map<string, { until: number; count: number }>();
function allowRequest(uid: string): boolean {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (bucket.until <= now) buckets.delete(key);
  const current = buckets.get(uid);
  if (current) return ++current.count <= 60;
  if (buckets.size >= 4096) return false;
  buckets.set(uid, { until: now + 60_000, count: 1 }); return true;
}
export const fieldMobileApi = onRequest({ region: 'asia-northeast3', cors: false, maxInstances: 2, concurrency: 20, timeoutSeconds: 30, memory: '256MiB' }, async (req, res) => {
  res.set('Cache-Control', 'no-store'); res.set('X-Content-Type-Options', 'nosniff');
  const projectId = process.env.GCLOUD_PROJECT ?? '';
  const allowedNativeAppIds = projectId === 'bring-fm' ? appIds.value().split(',').map(id => id.trim()).filter(id => /^1:\d+:(android|ios):[a-f0-9]+$/.test(id)) : [];
  const result = await handleMobileRead({ method: req.method, url: req.url, authorization: req.get('authorization') ?? '', appCheck: req.get('x-firebase-appcheck') ?? '', bodyBytes: req.rawBody?.length ?? 0 }, {
    auth: { projectId, allowedNativeAppIds,
      verifyIdentity: (token, revoked) => getAuth().verifyIdToken(token, revoked),
      verifyAppCheck: async token => ({ app_id: (await getAppCheck().verifyToken(token)).appId }),
      readAccess: async uid => (await getDatabase().ref(`crmCompany/access/${uid}`).get()).val(),
    }, reads: firebaseWorkspaceReads(getDatabase()), sites: firebaseCustomerSiteReads(getDatabase()), allowRequest,
  });
  if (result.status === 405) res.set('Allow', 'GET');
  if (result.status === 429) res.set('Retry-After', '60');
  res.status(result.status).json(result.body);
});
