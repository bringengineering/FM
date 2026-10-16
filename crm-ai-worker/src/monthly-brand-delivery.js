import Policy from '../../desktop-crm/src/message-policy.js';
import { boundedJson } from './weekly-report-delivery.js';

const DB = 'https://bring-fm-default-rtdb.asia-southeast1.firebasedatabase.app';
const fail = code => { throw Object.assign(new Error(code), {code}); };
const id = value => { if (!/^[A-Za-z0-9_-]{1,120}$/.test(value || '')) fail('INVALID_INPUT'); return value; };
const digits = value => String(value || '').replace(/\D/g, '');

export function monthlyBrandReady(env) {
  return env.KAKAO_MONTHLY_BRAND_ENABLED === 'true' && /^[a-f0-9]{40}$/.test(env.KAKAO_MONTHLY_BRAND_TEMPLATE_CODE || '');
}

// Read current consent with the caller's Firebase identity. No client-supplied
// consent flags, provider credentials, recipient overrides, or redirects.
export async function monthlyBrandRecipient(request, identity, document, input, fetchImpl = fetch) {
  const token = /^Bearer\s+([^\s]+)$/i.exec(request.headers.get('authorization') || '')?.[1];
  if (!token) fail('AUTH_REQUIRED');
  if (!identity.emailVerified) fail('FORBIDDEN');
  const read = async path => {
    const url = new URL(`${DB}/crmCompany/${path}.json`);
    url.searchParams.set('auth', token);
    let response;
    try { response = await fetchImpl(url, {method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10000)}); }
    catch { fail('DELIVERY_UNAVAILABLE'); }
    if (!response.ok) { await response.body?.cancel(); fail([401, 403].includes(response.status) ? 'FORBIDDEN' : 'DELIVERY_UNAVAILABLE'); }
    return boundedJson(response, 65536);
  };
  const [access, customer] = await Promise.all([read(`access/${id(identity.uid)}`), read(`data/customers/${id(document.crmCustomerId)}`)]);
  if (access?.enabled !== true || access.role !== 'admin' || access.mustChangePassword === true || String(access.email || '').trim().toLowerCase() !== identity.email.toLowerCase()) fail('FORBIDDEN');
  const operatorId = access.operatorId || access.profileId;
  if (operatorId && (await read(`teamProfiles/${id(operatorId)}`))?.active !== true) fail('FORBIDDEN');
  if (!customer || customer.archivedAt || customer.deletedAt || customer.deleted === true || digits(customer.phone) !== digits(input.phone)) fail('RECIPIENT_MISMATCH');
  const decision = Policy.evaluateKakaoMarketingConsent(customer);
  if (!decision.allowed) fail(decision.code);
  return {customerName: String(customer.reportRecipientName || customer.name || customer.company || '').trim().slice(0, 80)};
}

export function assertMonthlyBrandTime(now) {
  const seoul = new Date(now + 9 * 3600000);
  const minute = seoul.getUTCHours() * 60 + seoul.getUTCMinutes();
  if (minute < 480 || minute >= 1250) fail('DELIVERY_QUIET_HOURS');
}
