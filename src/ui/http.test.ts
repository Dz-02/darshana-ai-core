/**
 * The shared AI HTTP client. The transport and `fetch` are fakes so the real client code
 * runs offline; assertions are about what the client asks of its ports and how it reads
 * the envelope, not about any application's data.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { AiApiError, createAiHttpClient, describeAiError, type AiFetchInit, type FetchLike } from './http';
import type { AiSession, AiTransportPort } from './ports';

const signedIn: AiSession = { token: 't', tenantId: 'tenant-a', userId: 'u1', baseUrlHint: 'hint-a' };

function transport(session: AiSession | null = signedIn) {
  const seen = { apiBase: [] as Array<[string, string | null | undefined]>, headers: 0 };
  const port: AiTransportPort = {
    session: () => session,
    apiBase(kind, hint) {
      seen.apiBase.push([kind, hint]);
      return 'https://app.example/api/ai';
    },
    headers(s, options) {
      seen.headers += 1;
      return { Authorization: `Bearer ${s.token}`, 'X-Tenant': s.tenantId, ...(options?.json ? { 'Content-Type': 'application/json' } : {}) };
    },
  };
  return { port, seen };
}

function fakeFetch(status: number, body: string, calls: Array<{ url: string; init?: AiFetchInit }> = []): FetchLike {
  return async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, text: async () => body };
  };
}

describe('createAiHttpClient', () => {
  it('builds the URL from the port, passes the session hint, and unwraps the envelope', async () => {
    const calls: Array<{ url: string; init?: AiFetchInit }> = [];
    const { port, seen } = transport();
    const client = createAiHttpClient(port, fakeFetch(200, JSON.stringify({ success: true, message: 'ok', data: { n: 1 } }), calls));
    assert.deepEqual(await client.request<{ n: number }>('/modules/x/models'), { n: 1 });
    assert.equal(calls[0]?.url, 'https://app.example/api/ai/modules/x/models');
    assert.deepEqual(seen.apiBase[0], ['ai', 'hint-a']);
    const headers = calls[0]?.init?.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer t');
    assert.equal(headers['X-Tenant'], 'tenant-a');
    assert.equal(headers.Accept, 'application/json');
    assert.equal(headers['Content-Type'], undefined, 'no body means no content type');
  });

  it('sends a JSON body with a content type', async () => {
    const calls: Array<{ url: string; init?: AiFetchInit }> = [];
    const client = createAiHttpClient(transport().port, fakeFetch(200, '{"success":true,"message":"","data":null}', calls));
    await client.request('/x', 'POST', { a: 1 });
    assert.equal(calls[0]?.init?.method, 'POST');
    assert.equal(calls[0]?.init?.body, '{"a":1}');
    assert.equal((calls[0]?.init?.headers as Record<string, string>)['Content-Type'], 'application/json');
  });

  it('fails closed with 401 and makes no request when signed out', async () => {
    const calls: Array<{ url: string; init?: AiFetchInit }> = [];
    const client = createAiHttpClient(transport(null).port, fakeFetch(200, '{}', calls));
    await assert.rejects(() => client.request('/x'), (e: unknown) => e instanceof AiApiError && e.status === 401);
    assert.equal(calls.length, 0);
  });

  it('re-reads the session on every call, so a switched user is never served the old one', async () => {
    let session: AiSession | null = signedIn;
    const calls: Array<{ url: string; init?: AiFetchInit }> = [];
    const client = createAiHttpClient(
      { session: () => session, apiBase: () => 'https://a/api/ai', headers: (s) => ({ 'X-Tenant': s.tenantId }) },
      fakeFetch(200, '{"success":true,"message":"","data":1}', calls),
    );
    await client.request('/x');
    session = { ...signedIn, tenantId: 'tenant-b' };
    await client.request('/x');
    assert.equal((calls[0]?.init?.headers as Record<string, string>)['X-Tenant'], 'tenant-a');
    assert.equal((calls[1]?.init?.headers as Record<string, string>)['X-Tenant'], 'tenant-b');
  });

  it('surfaces a failed envelope with its status and per-field errors', async () => {
    const client = createAiHttpClient(
      transport().port,
      fakeFetch(422, JSON.stringify({ success: false, message: 'Invalid', errors: { name: ['Name is required'] } })),
    );
    await assert.rejects(
      () => client.request('/x', 'POST', {}),
      (e: unknown) => e instanceof AiApiError && e.status === 422 && e.fieldErrors.name?.[0] === 'Name is required',
    );
  });

  it('treats success:false on a 200 as a failure, and a non-JSON body as one too', async () => {
    await assert.rejects(
      () => createAiHttpClient(transport().port, fakeFetch(200, '{"success":false,"message":"nope"}')).request('/x'),
      /nope/,
    );
    await assert.rejects(
      () => createAiHttpClient(transport().port, fakeFetch(502, '<html>')).request('/x'),
      /non-JSON/,
    );
  });
});

describe('describeAiError', () => {
  it('prefers the first field error, then the message, then the fallback', () => {
    assert.equal(describeAiError(new AiApiError('Invalid', 422, { a: ['first'] })), 'first');
    assert.equal(describeAiError(new AiApiError('Invalid', 422)), 'Invalid');
    assert.equal(describeAiError(new Error('boom')), 'boom');
    assert.equal(describeAiError('weird', 'fallback'), 'fallback');
  });
});
