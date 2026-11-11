import { authorizeMobileDelivery, authorizeMobileSender, MobileAccessError, type MobileAuthDependencies } from './access.js';
import { listOwnerNoticeUnits, OwnerNoticeError, ownerNoticeStatus, sendOwnerNotice, type OwnerNoticeReads, type WorkflowBridge } from './owner-notice.js';

export interface OwnerNoticeRequest { method: string; url: string; authorization: string; appCheck: string; contentType: string; body: Buffer }
export interface OwnerNoticeDependencies { auth: MobileAuthDependencies; reads: OwnerNoticeReads; bridge: WorkflowBridge; allowRequest(uid: string): boolean }
const failure = (status: number, code: string) => ({ status, body: { error: { code } } });

/** GET  /v1/field-app/owner-notices/units
 *  POST /v1/field-app/owner-notices/send
 *  GET  /v1/field-app/owner-notices/deliveries/{requestId}
 * 고객에게 실제 알림톡이 나가므로 관리자 계정만 쓸 수 있다(작업 결과보고서 발송과 같은 기준).
 */
export async function handleOwnerNotice(request: OwnerNoticeRequest, deps: OwnerNoticeDependencies): Promise<{ status: number; body: unknown }> {
  try {
    if (request.url.length > 512) return failure(400, 'REQUEST_INVALID');
    const url = new URL(request.url, 'https://field.invalid');
    if (url.origin !== 'https://field.invalid' || url.search || url.hash) return failure(400, 'REQUEST_INVALID');
    const route = url.pathname.replace(/^\/v1\/field-app\/owner-notices/, '');
    const status = /^\/deliveries\/([0-9a-fA-F-]{36})$/.exec(route);
    const expected = route === '/units' || status ? 'GET' : route === '/send' ? 'POST' : '';
    if (!expected) return failure(404, 'NOT_FOUND');
    if (request.method !== expected) return failure(405, 'METHOD_NOT_ALLOWED');
    if (expected === 'GET' ? request.body.length !== 0 : request.body.length > 16 * 1024 || !/^application\/json(?:;|$)/i.test(request.contentType)) return failure(400, 'REQUEST_INVALID');
    const sender = await authorizeMobileSender(request, deps.auth);
    if (!deps.allowRequest(sender.uid)) return failure(429, 'RATE_LIMITED');
    authorizeMobileDelivery(sender);
    if (route === '/units') return { status: 200, body: await listOwnerNoticeUnits(deps.reads) };
    if (status) return { status: 200, body: await ownerNoticeStatus(status[1]!, sender, deps.bridge) };
    let input: unknown;
    try { input = JSON.parse(request.body.toString('utf8')); } catch { return failure(400, 'REQUEST_INVALID'); }
    return { status: 200, body: await sendOwnerNotice(input, sender, deps.reads, deps.bridge) };
  } catch (error) {
    if (error instanceof MobileAccessError) return failure(error.code === 'MOBILE_AUTH_REQUIRED' ? 401 : error.code === 'MOBILE_APP_NOT_REGISTERED' ? 503 : 403, error.code);
    if (error instanceof OwnerNoticeError) return failure(error.status, error.code);
    console.error(JSON.stringify({ event: 'field_owner_notice_failed', name: error instanceof Error ? error.name : 'unknown' }));
    return failure(503, 'SERVICE_UNAVAILABLE');
  }
}
