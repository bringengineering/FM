import Policy from '../../desktop-crm/src/message-policy.js';
import ReportMessage from '../../desktop-crm/src/work-report-message.js';
import { boundedJson } from './weekly-report-delivery.js';

const DB = 'https://bring-fm-default-rtdb.asia-southeast1.firebasedatabase.app';
const fail = code => { throw Object.assign(new Error(code), {code}); };
const id = value => { if (!/^[A-Za-z0-9_-]{1,120}$/.test(value || '')) fail('INVALID_INPUT'); return value; };
const digits = value => String(value || '').replace(/\D/g, '');

// Re-read the request, owner link and phone with the caller's identity. Client
// flags and advertising consent cannot substitute for a monthly report request.
export async function monthlyReportRecipient(request, identity, document, input, fetchImpl = fetch, now = Date.now()) {
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
  const [access, customer, building] = await Promise.all([
    read(`access/${id(identity.uid)}`), read(`data/customers/${id(document.crmCustomerId)}`), read(`data/buildings/${id(document.crmBuildingId)}`)
  ]);
  if (access?.enabled !== true || access.role !== 'admin' || access.mustChangePassword === true || String(access.email || '').trim().toLowerCase() !== identity.email.toLowerCase()) fail('FORBIDDEN');
  const operatorId = access.operatorId || access.profileId;
  if (operatorId && (await read(`teamProfiles/${id(operatorId)}`))?.active !== true) fail('FORBIDDEN');
  if (!customer || customer.archivedAt || customer.deletedAt || customer.deleted === true || digits(customer.phone) !== digits(input.phone)
    || !building || building.archivedAt || building.deletedAt || building.deleted === true || String(building.ownerCustomerId) !== document.crmCustomerId) fail('RECIPIENT_MISMATCH');
  const decision = Policy.evaluateMonthlyReportRequest(customer, now);
  if (!decision.allowed) fail(decision.code);
  let buildingAddress;
  try { buildingAddress = ReportMessage.shortAddress(building.roadAddress || building.jibunAddress || building.address); }
  catch { fail('MONTHLY_REPORT_ADDRESS_REQUIRED'); }
  return {buildingAddress};
}
