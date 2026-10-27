import { getAppCheck } from 'firebase-admin/app-check';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { defineString, defineSecret } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import { firebaseCustomerSiteReads, firebaseWorkspaceReads } from './firebase-reads.js';
import { handleMobileRead } from './http.js';
import { authorizeMobile, type MobileAuthDependencies } from './access.js';
import { handleRecording } from './recording-http.js';
import { recordingRuntime } from './recording-runtime.js';

// Explicit native app allowlist. Empty config disables all company reads.
const appIds = defineString('FIELD_MOBILE_NATIVE_APP_IDS', { default: '' });
const photosRoot = defineString('FIELD_MOBILE_PHOTOS_ROOT', { default: '' });
const reportsRoot = defineString('FIELD_MOBILE_REPORTS_ROOT', { default: '' });
const driveClientId=defineSecret('DRIVE_CLIENT_ID'),driveClientSecret=defineSecret('DRIVE_CLIENT_SECRET'),driveRefreshToken=defineSecret('DRIVE_REFRESH_TOKEN');
const buckets = new Map<string, { until: number; count: number }>();
function allowRequest(uid: string, limit=60): boolean {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (bucket.until <= now) buckets.delete(key);
  const current = buckets.get(uid);
  if (current) return ++current.count <= limit;
  if (buckets.size >= 4096) return false;
  buckets.set(uid, { until: now + 60_000, count: 1 }); return true;
}
export const fieldMobileApi = onRequest({ region: 'asia-northeast3', cors: false, maxInstances: 2, concurrency: 1, timeoutSeconds: 180, memory: '1GiB', secrets:[driveClientId,driveClientSecret,driveRefreshToken] }, async (req, res) => {
  res.set('Cache-Control', 'no-store'); res.set('X-Content-Type-Options', 'nosniff');
  const projectId = process.env.GCLOUD_PROJECT ?? '';
  const allowedNativeAppIds = projectId === 'bring-fm' ? appIds.value().split(',').map(id => id.trim()).filter(id => /^1:\d+:(android|ios):[a-f0-9]+$/.test(id)) : [];
  const headers={authorization:req.get('authorization')??'',appCheck:req.get('x-firebase-appcheck')??''};
  const auth:MobileAuthDependencies={ projectId, allowedNativeAppIds,
      verifyIdentity: (token, revoked) => getAuth().verifyIdToken(token, revoked),
      verifyAppCheck: async token => ({ app_id: (await getAppCheck().verifyToken(token)).appId }),
      readAccess: async uid => (await getDatabase().ref(`crmCompany/access/${uid}`).get()).val(),
  };
  const recording=/^\/v1\/field-app\/(recording|visits|uploads)(?:\/|$)/.test(req.path);
  const result=recording?await handleRecording({method:req.method,url:req.url,...headers,contentType:req.get('content-type')??'',range:req.get('content-range')??'',idempotencyKey:req.get('idempotency-key')??'',body:req.rawBody??Buffer.alloc(0)},
    {auth,allowRequest:uid=>allowRequest('recording_'+uid,480),recording:()=>recordingRuntime({clientId:driveClientId.value(),clientSecret:driveClientSecret.value(),refreshToken:driveRefreshToken.value(),photosRoot:photosRoot.value(),reportsRoot:reportsRoot.value()},async()=>{await authorizeMobile(headers,auth);})})
    :await handleMobileRead({method:req.method,url:req.url,...headers,bodyBytes:req.rawBody?.length??0},{auth,reads:firebaseWorkspaceReads(getDatabase()),sites:firebaseCustomerSiteReads(getDatabase()),allowRequest});
  if (result.status === 405) res.set('Allow', recording?'GET, PUT, POST':'GET');
  if (result.status === 429) res.set('Retry-After', '60');
  res.status(result.status).json(result.body);
});
