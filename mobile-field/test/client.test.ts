import { describe, it, expect, vi } from 'vitest';
import { FieldApiClient, assertUpload } from '../src/api/client';
import { photo } from './helpers';
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
  it.each([undefined, null, 123])('rejects missing/non-string upload identifiers %j', uploadId => {
    expect(() => assertUpload({ uploadId, photoId: 'p', sha256: 'a'.repeat(64), totalBytes: 8, receivedBytes: 0, state: 'uploading', driveVerified: false, crmLinked: false })).toThrow('SERVER_RESPONSE_INVALID');
  });
  it('requires server revision and matching owner before a photo reservation is sent', async () => {
    const fetcher = vi.fn(); const api = new FieldApiClient('https://example.invalid/v1/field-app', 'staff-a', credentials, fetcher);
    await expect(api.reserve(await photo(), 'photo-key', new AbortController().signal)).rejects.toThrow('VISIT_NOT_LINKED');
    await expect(api.reserve({ ...await photo('staff-b'), reservationRevision: 1 }, 'photo-key', new AbortController().signal)).rejects.toThrow('OWNER_MISMATCH'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('bounds streamed UTF-8 bytes even without Content-Length and cancels oversized responses', async () => {
    const cancelled = vi.fn(); let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { pulls++; controller.enqueue(new TextEncoder().encode('가'.repeat(24_000))); }, cancel: cancelled });
    const fetcher = vi.fn(async () => new Response(stream, { headers: { 'content-type': 'application/json' } }));
    const api = new FieldApiClient('https://example.invalid/v1/field-app', 'staff-a', credentials, fetcher);
    await expect(api.status('upload-a', new AbortController().signal)).rejects.toThrow('SERVER_RESPONSE_INVALID'); expect(cancelled).toHaveBeenCalledOnce(); expect(pulls).toBeLessThanOrEqual(3);
  });
  it('accepts a bounded valid status and rejects incorrect content type', async () => {
    const body = { uploadId: 'u', photoId: 'p', sha256: 'a'.repeat(64), totalBytes: 8, receivedBytes: 0, state: 'uploading', driveVerified: false, crmLinked: false };
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(body)).mockResolvedValueOnce(new Response(JSON.stringify(body), { headers: { 'content-type': 'text/html' } }));
    const api = new FieldApiClient('https://example.invalid/v1/field-app', 'staff-a', credentials, fetcher);
    expect(await api.status('upload-a', new AbortController().signal)).toEqual(body);
    await expect(api.status('upload-a', new AbortController().signal)).rejects.toThrow('SERVER_RESPONSE_INVALID');
  });
});
