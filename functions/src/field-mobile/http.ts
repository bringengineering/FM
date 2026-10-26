import { authorizeMobile, MobileAccessError, type MobileAuthDependencies } from './access.js';
import { getMobileJob, listMobileJobs, WorkspaceError, type WorkspaceReads } from './workspace.js';

export interface MobileReadRequest { method: string; url: string; authorization: string; appCheck: string; bodyBytes: number }
export interface MobileReadDependencies { auth: MobileAuthDependencies; reads: WorkspaceReads; allowRequest(uid: string): boolean }
export interface MobileReadResponse { status: number; body: unknown }
const failure = (status: number, code: string): MobileReadResponse => ({ status, body: { error: { code } } });
export async function handleMobileRead(request: MobileReadRequest, deps: MobileReadDependencies): Promise<MobileReadResponse> {
  if (request.method !== 'GET') return failure(405, 'METHOD_NOT_ALLOWED');
  if (request.bodyBytes !== 0 || request.url.length > 512) return failure(400, 'REQUEST_INVALID');
  try {
    const url = new URL(request.url, 'https://field.invalid');
    if (url.origin !== 'https://field.invalid' || url.hash) return failure(400, 'REQUEST_INVALID');
    const route = url.pathname;
    if (route !== '/v1/field-app/context' && route !== '/v1/field-app/jobs' && !/^\/v1\/field-app\/jobs\/[A-Za-z0-9_-]{1,120}$/.test(route)) return failure(404, 'NOT_FOUND');
    if ([...url.searchParams.keys()].some(key => route !== '/v1/field-app/jobs' || key !== 'cursor') || url.searchParams.getAll('cursor').length > 1) return failure(400, 'REQUEST_INVALID');
    const actor = await authorizeMobile({ authorization: request.authorization, appCheck: request.appCheck }, deps.auth);
    if (!deps.allowRequest(actor.uid)) return failure(429, 'RATE_LIMITED');
    if (route.endsWith('/context')) return { status: 200, body: {
      schemaVersion: 1, actor, capabilities: { readJobs: true, capture: false, archiveReport: false, sendCustomerReport: false },
    } };
    if (route.endsWith('/jobs')) return { status: 200, body: await listMobileJobs(actor, url.searchParams.get('cursor'), deps.reads) };
    return { status: 200, body: { job: await getMobileJob(actor, route.split('/').pop()!, deps.reads) } };
  } catch (error) {
    if (error instanceof MobileAccessError) {
      return failure(error.code === 'MOBILE_APP_NOT_REGISTERED' ? 503 : error.code === 'MOBILE_AUTH_REQUIRED' ? 401 : 403, error.code);
    }
    if (error instanceof WorkspaceError) return failure(error.code === 'REQUEST_INVALID' ? 400 : error.code === 'JOB_NOT_FOUND' ? 404 : 503, error.code);
    return failure(503, 'SERVICE_UNAVAILABLE');
  }
}
