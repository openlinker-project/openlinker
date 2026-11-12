import { ContendedWriteError, type SyncLockPort } from '@openlinker/core/sync';
import type { CachePort } from '@openlinker/shared';

import { ShopifyApiError } from '../../../domain/exceptions/shopify-api.error';
import { ShopifyConfigException } from '../../../domain/exceptions/shopify-config.exception';
import type { ShopifyCredentials } from '../../../domain/types/shopify-credentials.types';
import { ShopifyAccessTokenProvider, type ShopifyTokenMemo } from '../shopify-access-token.provider';

const DOMAIN = 'my-shop.myshopify.com';

function tokenReply(body: Record<string, unknown>, status = 200): jest.Mock {
  return jest.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

function memoryCache(): CachePort & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    get: jest.fn((key: string) => Promise.resolve((store.get(key) ?? null) as never)),
    set: jest.fn((key: string, value: unknown) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    delete: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
  } as unknown as CachePort & { store: Map<string, unknown> };
}

function sentCall(fetchImpl: jest.Mock, call = 0): [string, RequestInit] {
  return fetchImpl.mock.calls[call] as [string, RequestInit];
}

function sentForm(fetchImpl: jest.Mock, call = 0): URLSearchParams {
  return new URLSearchParams(String(sentCall(fetchImpl, call)[1].body));
}

describe('ShopifyAccessTokenProvider', () => {
  it('should hand back a pre-issued token as is and never renew it', async () => {
    const fetchImpl = jest.fn();
    const provider = new ShopifyAccessTokenProvider(DOMAIN, 'c1', { accessToken: 'shpat_x' }, fetchImpl, undefined, new Map());

    await expect(provider.get()).resolves.toEqual({ token: 'shpat_x', renewable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('should refuse credentials that carry no usable mode', () => {
    expect(
      () => new ShopifyAccessTokenProvider(DOMAIN, 'c1', { clientId: 'id' }, jest.fn(), undefined, new Map()),
    ).toThrow(ShopifyConfigException);
  });

  describe('client credentials', () => {
    const credentials: ShopifyCredentials = { clientId: 'id', clientSecret: 'secret' };

    it('should mint once through the client-credentials grant and serve the cached token after', async () => {
      const fetchImpl = tokenReply({ access_token: 'minted', expires_in: 86399 });
      const cache = memoryCache();
      const provider = new ShopifyAccessTokenProvider(DOMAIN, 'c1', credentials, fetchImpl, cache, new Map());

      await expect(provider.get()).resolves.toEqual({ token: 'minted', renewable: true });
      await expect(provider.get()).resolves.toEqual({ token: 'minted', renewable: true });

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(sentCall(fetchImpl)[0]).toBe(`https://${DOMAIN}/admin/oauth/access_token`);
      expect(sentForm(fetchImpl).get('grant_type')).toBe('client_credentials');
      expect(cache.store.has('shopify:access-token:c1')).toBe(true);
    });

    it('should reuse a token another process cached, across a new memo', async () => {
      const cache = memoryCache();
      await new ShopifyAccessTokenProvider(DOMAIN, 'c1', credentials, tokenReply({ access_token: 'a' }), cache, new Map()).get();
      const fetchImpl = jest.fn();

      const token = await new ShopifyAccessTokenProvider(DOMAIN, 'c1', credentials, fetchImpl, cache, new Map()).get();

      expect(token.token).toBe('a');
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('should not serve a token minted with a secret the operator has since rotated', async () => {
      const cache = memoryCache();
      const memo: ShopifyTokenMemo = new Map();
      await new ShopifyAccessTokenProvider(DOMAIN, 'c1', credentials, tokenReply({ access_token: 'old' }), cache, memo).get();

      const rotated = new ShopifyAccessTokenProvider(
        DOMAIN,
        'c1',
        { clientId: 'id', clientSecret: 'new-secret' },
        tokenReply({ access_token: 'new' }),
        cache,
        memo,
      );

      await expect(rotated.get()).resolves.toMatchObject({ token: 'new' });
    });

    it('should mint again after invalidate', async () => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'first' })))
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'second' })));
      const provider = new ShopifyAccessTokenProvider(DOMAIN, 'c1', credentials, fetchImpl, memoryCache(), new Map());

      await provider.get();
      await provider.invalidate();

      await expect(provider.get()).resolves.toMatchObject({ token: 'second' });
    });

    it('should carry the grant error when Shopify refuses the request (K02/K03)', async () => {
      const provider = new ShopifyAccessTokenProvider(
        DOMAIN,
        'c1',
        credentials,
        tokenReply({ error: 'shop_not_permitted' }, 400),
        undefined,
        new Map(),
      );

      const error = await provider.get().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ShopifyApiError);
      expect(error).toMatchObject({ statusCode: 400, source: 'token-endpoint', grantError: 'shop_not_permitted' });
    });
  });

  describe('OAuth', () => {
    const fresh: ShopifyCredentials = {
      grant: 'oauth',
      accessToken: 'oauth-1',
      refreshToken: 'refresh-1',
      clientId: 'id',
      clientSecret: 'secret',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    };

    function lock(acquired: string | null = 'lock-token'): SyncLockPort {
      return {
        acquire: jest.fn().mockResolvedValue(acquired),
        release: jest.fn().mockResolvedValue(true),
        extend: jest.fn().mockResolvedValue(true),
      };
    }

    it('should use the stored token while it is still valid', async () => {
      const fetchImpl = jest.fn();
      const provider = new ShopifyAccessTokenProvider(DOMAIN, 'c1', fresh, fetchImpl, undefined, new Map(), {
        credentialsRef: 'db:ref',
        reload: jest.fn(),
      });

      await expect(provider.get()).resolves.toEqual({ token: 'oauth-1', renewable: true });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('should refresh an expiring token and write the rotated pair back under the lock', async () => {
      const expiring = { ...fresh, expiresAt: new Date(Date.now() + 1_000).toISOString() };
      const fetchImpl = tokenReply({
        access_token: 'oauth-2',
        refresh_token: 'refresh-2',
        expires_in: 3600,
        refresh_token_expires_in: 7_776_000,
      });
      const writer = { replace: jest.fn().mockResolvedValue(undefined) };
      const syncLock = lock();
      const connectionFetch = jest.fn();
      const provider = new ShopifyAccessTokenProvider(DOMAIN, 'c1', expiring, connectionFetch, undefined, new Map(), {
        credentialsRef: 'db:ref',
        reload: jest.fn().mockResolvedValue(expiring),
        writer,
        lock: syncLock,
        refreshFetch: fetchImpl,
      });

      await expect(provider.get()).resolves.toMatchObject({ token: 'oauth-2' });

      // The refresh stays out of the connection's rate-limit queue (it runs under the lock).
      expect(connectionFetch).not.toHaveBeenCalled();
      const form = sentForm(fetchImpl);
      expect(form.get('grant_type')).toBe('refresh_token');
      expect(form.get('refresh_token')).toBe('refresh-1');
      expect(writer.replace).toHaveBeenCalledWith(
        'db:ref',
        expect.objectContaining({ grant: 'oauth', accessToken: 'oauth-2', refreshToken: 'refresh-2' }),
      );
      expect(syncLock.release).toHaveBeenCalledWith('shopify:token-refresh:c1', 'lock-token');
    });

    it('should take the token another process refreshed instead of spending the refresh token again', async () => {
      const expiring = { ...fresh, expiresAt: new Date(Date.now() + 1_000).toISOString() };
      const fetchImpl = jest.fn();
      const writer = { replace: jest.fn() };
      const provider = new ShopifyAccessTokenProvider(DOMAIN, 'c1', expiring, fetchImpl, undefined, new Map(), {
        credentialsRef: 'db:ref',
        reload: jest.fn().mockResolvedValue({ ...fresh, accessToken: 'refreshed-elsewhere' }),
        writer,
        lock: lock(),
        refreshFetch: fetchImpl,
      });

      await expect(provider.get()).resolves.toMatchObject({ token: 'refreshed-elsewhere' });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(writer.replace).not.toHaveBeenCalled();
    });

    it('should refresh after the API rejected a token it still thought was valid', async () => {
      const fetchImpl = tokenReply({ access_token: 'oauth-2', refresh_token: 'refresh-2', expires_in: 3600 });
      const provider = new ShopifyAccessTokenProvider(DOMAIN, 'c1', fresh, jest.fn(), undefined, new Map(), {
        credentialsRef: 'db:ref',
        reload: jest.fn().mockResolvedValue(fresh),
        writer: { replace: jest.fn().mockResolvedValue(undefined) },
        lock: lock(),
        refreshFetch: fetchImpl,
      });

      await provider.invalidate();

      await expect(provider.get()).resolves.toMatchObject({ token: 'oauth-2' });
    });

    it('should report a contended refresh as a deferrable ContendedWriteError when a peer holds the lock', async () => {
      jest.useFakeTimers();
      try {
        const expiring = { ...fresh, expiresAt: new Date(Date.now() + 1_000).toISOString() };
        const refreshFetch = jest.fn();
        const provider = new ShopifyAccessTokenProvider(DOMAIN, 'c1', expiring, jest.fn(), undefined, new Map(), {
          credentialsRef: 'db:ref',
          reload: jest.fn().mockResolvedValue(expiring),
          writer: { replace: jest.fn() },
          lock: lock(null),
          refreshFetch,
        });

        const outcome = provider.get().catch((e: unknown) => e);
        await jest.advanceTimersByTimeAsync(15_000);

        await expect(outcome).resolves.toBeInstanceOf(ContendedWriteError);
        expect(refreshFetch).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('should take the peer\'s refreshed token when it lands while waiting for the lock', async () => {
      jest.useFakeTimers();
      try {
        const expiring = { ...fresh, expiresAt: new Date(Date.now() + 1_000).toISOString() };
        const reload = jest
          .fn()
          .mockResolvedValueOnce(expiring)
          .mockResolvedValue({ ...fresh, accessToken: 'peer-refreshed' });
        const provider = new ShopifyAccessTokenProvider(DOMAIN, 'c1', expiring, jest.fn(), undefined, new Map(), {
          credentialsRef: 'db:ref',
          reload,
          writer: { replace: jest.fn() },
          lock: lock(null),
          refreshFetch: jest.fn(),
        });

        const outcome = provider.get();
        await jest.advanceTimersByTimeAsync(1_000);

        await expect(outcome).resolves.toMatchObject({ token: 'peer-refreshed' });
      } finally {
        jest.useRealTimers();
      }
    });

    it('should keep the refreshed token and retry the write-back when storing it fails', async () => {
      jest.useFakeTimers();
      try {
        const expiring = { ...fresh, expiresAt: new Date(Date.now() + 1_000).toISOString() };
        const writer = {
          replace: jest.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce(undefined),
        };
        const provider = new ShopifyAccessTokenProvider(DOMAIN, 'c1', expiring, jest.fn(), undefined, new Map(), {
          credentialsRef: 'db:ref',
          reload: jest.fn().mockResolvedValue(expiring),
          writer,
          lock: lock(),
          refreshFetch: tokenReply({ access_token: 'oauth-2', refresh_token: 'refresh-2', expires_in: 3600 }),
        });

        const outcome = provider.get();
        await jest.advanceTimersByTimeAsync(1_000);

        await expect(outcome).resolves.toMatchObject({ token: 'oauth-2' });
        expect(writer.replace).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });

    it('should still answer with the refreshed token when every write-back attempt fails', async () => {
      jest.useFakeTimers();
      try {
        const expiring = { ...fresh, expiresAt: new Date(Date.now() + 1_000).toISOString() };
        const writer = { replace: jest.fn().mockRejectedValue(new Error('db down')) };
        const syncLock = lock();
        const provider = new ShopifyAccessTokenProvider(DOMAIN, 'c1', expiring, jest.fn(), undefined, new Map(), {
          credentialsRef: 'db:ref',
          reload: jest.fn().mockResolvedValue(expiring),
          writer,
          lock: syncLock,
          refreshFetch: tokenReply({ access_token: 'oauth-2', refresh_token: 'refresh-2', expires_in: 3600 }),
        });

        const outcome = provider.get();
        await jest.advanceTimersByTimeAsync(5_000);

        await expect(outcome).resolves.toMatchObject({ token: 'oauth-2' });
        expect(writer.replace).toHaveBeenCalledTimes(3);
        expect(syncLock.release).toHaveBeenCalledWith('shopify:token-refresh:c1', 'lock-token');
      } finally {
        jest.useRealTimers();
      }
    });

    it('should refuse to refresh when no writer can store the rotated refresh token', async () => {
      const expiring = { ...fresh, expiresAt: new Date(Date.now() + 1_000).toISOString() };
      const provider = new ShopifyAccessTokenProvider(DOMAIN, 'c1', expiring, jest.fn(), undefined, new Map(), {
        credentialsRef: 'db:ref',
        reload: jest.fn(),
      });

      await expect(provider.get()).rejects.toBeInstanceOf(ShopifyConfigException);
    });
  });
});
