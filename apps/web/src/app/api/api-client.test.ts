/**
 * ApiClient 401-retry behaviour (#710).
 *
 * The other public-facing surface of the API client is the resource
 * namespaces, exercised in feature tests via `createMockApiClient`.
 * This file pins the *transport* layer: when the underlying fetch
 * returns 401, the client should ask the session adapter to refresh
 * and retry the original request once with the new token.
 */
import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './api-client';
import type { SessionAdapter } from '../../shared/auth/session-adapter';
import { ApiError } from '../../shared/api/api-error';

const BASE_URL = 'http://localhost:3000';

interface MockFetchResponse {
  ok: boolean;
  status: number;
  headers: Headers;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

function makeResponse(status: number, body: unknown): MockFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

function makeAdapter(overrides: Partial<SessionAdapter> = {}): SessionAdapter {
  return {
    getAccessToken: vi.fn().mockResolvedValue('stale-token'),
    getSession: vi.fn(),
    persistSession: vi.fn(),
    clearSession: vi.fn(),
    ...overrides,
  };
}

describe('createApiClient — 401 retry (#710)', () => {
  it('retries once with the refreshed token when the first request returns 401', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(makeResponse(401, { message: 'expired' }) as unknown as Response)
      .mockResolvedValueOnce(makeResponse(200, { ok: true }) as unknown as Response);

    const refresh = vi.fn().mockResolvedValue('fresh-token');
    const adapter = makeAdapter({ refresh });

    const client = createApiClient({
      baseUrl: BASE_URL,
      fetchFn: fetchFn as unknown as typeof fetch,
      sessionAdapter: adapter,
    });

    const result = await client.request<{ ok: boolean }>('/anything');

    expect(result).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);

    // Second call used the refreshed token.
    const [, retryInit] = fetchFn.mock.calls[1] as [string, RequestInit];
    const retryHeaders = retryInit.headers as Headers;
    expect(retryHeaders.get('Authorization')).toBe('Bearer fresh-token');
  });

  it('propagates the 401 ApiError when refresh fails', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(makeResponse(401, { message: 'expired' }) as unknown as Response);

    const refresh = vi.fn().mockResolvedValue(null);
    const adapter = makeAdapter({ refresh });

    const client = createApiClient({
      baseUrl: BASE_URL,
      fetchFn: fetchFn as unknown as typeof fetch,
      sessionAdapter: adapter,
    });

    await expect(client.request<unknown>('/anything')).rejects.toBeInstanceOf(ApiError);
    expect(fetchFn).toHaveBeenCalledTimes(1); // no retry
  });

  it('does not retry when the adapter has no refresh hook (e.g. NoopSessionAdapter)', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(makeResponse(401, { message: 'expired' }) as unknown as Response);

    const adapter = makeAdapter({ refresh: undefined });
    const client = createApiClient({
      baseUrl: BASE_URL,
      fetchFn: fetchFn as unknown as typeof fetch,
      sessionAdapter: adapter,
    });

    await expect(client.request<unknown>('/anything')).rejects.toBeInstanceOf(ApiError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('does not retry on non-401 errors', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(makeResponse(500, { message: 'oops' }) as unknown as Response);

    const refresh = vi.fn();
    const adapter = makeAdapter({ refresh });

    const client = createApiClient({
      baseUrl: BASE_URL,
      fetchFn: fetchFn as unknown as typeof fetch,
      sessionAdapter: adapter,
    });

    await expect(client.request<unknown>('/anything')).rejects.toBeInstanceOf(ApiError);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('always sends credentials: include for cookie round-trip', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(makeResponse(200, { ok: true }) as unknown as Response);
    const adapter = makeAdapter();

    const client = createApiClient({
      baseUrl: BASE_URL,
      fetchFn: fetchFn as unknown as typeof fetch,
      sessionAdapter: adapter,
    });

    await client.request('/health');

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe('include');
  });
});
