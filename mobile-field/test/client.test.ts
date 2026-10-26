import { describe, it, expect, vi } from 'vitest';
import { FieldApiClient, assertUpload } from '../src/api/client';
const credentials = async () => ({ uid: 'staff-a', idToken: 'test-id-token', appCheckToken: 'test-attestation' });
describe('authenticated transport', () => {
  it('refuses cleartext/embedded credentials and account changes', async () => {
    expect(() => new FieldApiClient('http://example.invalid/v1/field-app', 'staff-a', credentials)).toThrow('API_CONFIGURATION_INVALID');
    const fetcher = vi.fn(); const api = new FieldApiClient('https://example.invalid/v1/field-app', 'staff-b', credentials, fetcher);
    await expect(api.status('upload-a', new AbortController().signal)).rejects.toThrow('AUTH_REQUIRED'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('sends Auth and App Check, rejects redirects, and never reflects server errors', async () => {
    const fetcher = vi.fn(async () => new Response('private provider URL and token', { status: 500 }));
    const api = new FieldApiClient('https://example.invalid/v1/field-app', 'staff-a', credentials, fetcher as typeof fetch);
    await expect(api.status('upload-a', new AbortController().signal)).rejects.toThrow('SERVER_UNAVAILABLE');
    expect(fetcher).toHaveBeenCalledOnce(); const options = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(options.redirect).toBe('error'); expect(options.headers).toMatchObject({ Authorization: 'Bearer test-id-token', 'X-Firebase-AppCheck': 'test-attestation' });
  });
  it('rejects fake-ready without Drive and CRM acknowledgement', () => {
    expect(() => assertUpload({ uploadId: 'u', photoId: 'p', sha256: 'a'.repeat(64), totalBytes: 8, receivedBytes: 8, state: 'ready', driveVerified: true, crmLinked: false })).toThrow('SERVER_RESPONSE_INVALID');
  });
});
