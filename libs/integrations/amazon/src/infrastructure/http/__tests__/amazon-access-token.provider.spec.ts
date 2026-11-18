/**
 * AmazonAccessTokenProvider tests (#3741 foundation)
 *
 * @module libs/integrations/amazon/src/infrastructure/http/__tests__
 */
import type { CachePort } from '@openlinker/shared';

import { AmazonApiError } from '../../../domain/exceptions/amazon-api.error';
import { AmazonAuthenticationError } from '../../../domain/exceptions/amazon-authentication.error';
import { AmazonNetworkError } from '../../../domain/exceptions/amazon-network.error';
import type { AmazonCredentials } from '../../../domain/types/amazon-credentials.types';
import { AmazonAccessTokenProvider, fingerprintAmazonCredentials } from '../amazon-access-token.provider';

const CREDENTIALS: AmazonCredentials = { clientId: 'cid', clientSecret: 'csecret', refreshToken: 'Atzr|rt' };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function memoryCache(): CachePort & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    get: <T>(key: string) => Promise.resolve((store.get(key) as T) ?? null),
    set: (key: string, value: unknown) => {
      store.set(key, value);
      return Promise.resolve();
    },
    delete: (key: string) => {
      store.delete(key);
      return Promise.resolve();
    },
  } as unknown as CachePort & { store: Map<string, unknown> };
}

describe('AmazonAccessTokenProvider', () => {
  it('should exchange the refresh token at the LWA endpoint', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, { access_token: 'Atza|1', expires_in: 3600 }));
    const provider = new AmazonAccessTokenProvider(CREDENTIALS, fetchImpl, undefined, () => 0, new Map());

    await expect(provider.getAccessToken()).resolves.toBe('Atza|1');

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.amazon.com/auth/o2/token');
    expect(init.method).toBe('POST');
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'Atzr|rt',
      client_id: 'cid',
      client_secret: 'csecret',
    });
  });

  it('should reuse the token until shortly before it expires', async () => {
    let now = 0;
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'first', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'second', expires_in: 3600 }));
    const provider = new AmazonAccessTokenProvider(CREDENTIALS, fetchImpl, undefined, () => now, new Map());

    await provider.getAccessToken();
    now = 3000 * 1000;
    await expect(provider.getAccessToken()).resolves.toBe('first');
    now = 3500 * 1000;
    await expect(provider.getAccessToken()).resolves.toBe('second');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('should share a cached token through the host cache, keyed without secrets', async () => {
    const cache = memoryCache();
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, { access_token: 'shared', expires_in: 3600 }));
    await new AmazonAccessTokenProvider(CREDENTIALS, fetchImpl, cache, () => 0, new Map()).getAccessToken();

    const other = new AmazonAccessTokenProvider(CREDENTIALS, fetchImpl, cache, () => 0, new Map());
    await expect(other.getAccessToken()).resolves.toBe('shared');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [key] = [...cache.store.keys()];
    expect(key).toBe(`amazon:lwa-token:${fingerprintAmazonCredentials(CREDENTIALS)}`);
    expect(key).not.toContain('csecret');
    expect(key).not.toContain('Atzr');
  });

  it('should mint a new token when the credentials change', () => {
    expect(fingerprintAmazonCredentials(CREDENTIALS)).not.toBe(
      fingerprintAmazonCredentials({ ...CREDENTIALS, clientSecret: 'rotated' }),
    );
  });

  it('should still mint when the cache fails', async () => {
    const cache = {
      get: jest.fn().mockRejectedValue(new Error('redis down')),
      set: jest.fn().mockRejectedValue(new Error('redis down')),
      delete: jest.fn(),
    } as unknown as CachePort;
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, { access_token: 'ok', expires_in: 3600 }));
    const provider = new AmazonAccessTokenProvider(CREDENTIALS, fetchImpl, cache, () => 0, new Map());
    await expect(provider.getAccessToken()).resolves.toBe('ok');
  });

  it.each(['invalid_grant', 'invalid_client', 'unauthorized_client'])(
    'should report %s as rejected credentials',
    async (grantError) => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValue(jsonResponse(400, { error: grantError, error_description: 'nope' }));
      const provider = new AmazonAccessTokenProvider(CREDENTIALS, fetchImpl, undefined, () => 0, new Map());
      await expect(provider.getAccessToken()).rejects.toBeInstanceOf(AmazonAuthenticationError);
    },
  );

  it('should report an LWA outage as an ordinary API error', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(503, { error: 'server_error' }));
    const provider = new AmazonAccessTokenProvider(CREDENTIALS, fetchImpl, undefined, () => 0, new Map());
    const error = await provider.getAccessToken().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AmazonApiError);
    expect((error as AmazonApiError).statusCode).toBe(503);
  });

  it('should refuse a 2xx with no access token', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, { token_type: 'bearer' }));
    const provider = new AmazonAccessTokenProvider(CREDENTIALS, fetchImpl, undefined, () => 0, new Map());
    await expect(provider.getAccessToken()).rejects.toBeInstanceOf(AmazonNetworkError);
  });
  it('should share one LWA call between concurrent callers when no token is cached', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, { access_token: 'Atza|shared', expires_in: 3600 }));
    const memo = new Map();
    const inFlight = new Map();
    const providers = [1, 2, 3].map(
      () => new AmazonAccessTokenProvider(CREDENTIALS, fetchImpl, undefined, () => 0, memo, inFlight),
    );

    const tokens = await Promise.all(providers.map((provider) => provider.getAccessToken()));

    expect(tokens).toEqual(['Atza|shared', 'Atza|shared', 'Atza|shared']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(inFlight.size).toBe(0);
  });

  it('should let the next caller mint again when a shared mint fails', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, { error: 'server_error' }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'Atza|retry', expires_in: 3600 }));
    const inFlight = new Map();
    const provider = new AmazonAccessTokenProvider(CREDENTIALS, fetchImpl, undefined, () => 0, new Map(), inFlight);

    await expect(provider.getAccessToken()).rejects.toBeInstanceOf(AmazonApiError);
    await expect(provider.getAccessToken()).resolves.toBe('Atza|retry');
    expect(inFlight.size).toBe(0);
  });

  it('should drop an expired memo entry instead of keeping it', async () => {
    let nowMs = 0;
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'Atza|old', expires_in: 3600 }))
      .mockRejectedValueOnce(new TypeError('network down'));
    const memo = new Map();
    const provider = new AmazonAccessTokenProvider(CREDENTIALS, fetchImpl, undefined, () => nowMs, memo, new Map());

    await provider.getAccessToken();
    expect(memo.size).toBe(1);

    nowMs = 3600 * 1000;
    await expect(provider.getAccessToken()).rejects.toBeInstanceOf(AmazonNetworkError);
    expect(memo.size).toBe(0);
  });
});
