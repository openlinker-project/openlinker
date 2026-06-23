/**
 * MF public-key cache service specs — fetch/filter/select/validate + caching.
 *
 * @module libs/integrations/ksef/src/infrastructure/crypto
 */
import { MfPublicKeyCacheService } from '../mf-public-key-cache.service';
import { KsefSessionCryptoException } from '../../../domain/exceptions/ksef-session-crypto.exception';
import { FakeKsefHttpClient } from '../../../testing/fake-ksef-http-client';
import type { CachePort } from '@openlinker/shared/cache';

const PATH = '/security/public-key-certificates';

function inMemoryCache(): CachePort & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    get: <T>(key: string): Promise<T | null> => Promise.resolve((store.get(key) as T) ?? null),
    set: <T>(key: string, value: T): Promise<void> => {
      store.set(key, value);
      return Promise.resolve();
    },
    delete: (key: string): Promise<void> => {
      store.delete(key);
      return Promise.resolve();
    },
  };
}

function certResponse(): {
  data: {
    certificates: Array<{ certificate: string; usage: string; validFrom: string; validUntil: string }>;
  };
  status: number;
  headers: Record<string, string>;
} {
  return {
    data: {
      certificates: [
        {
          certificate: 'PEM-SYM-OLD',
          usage: 'SymmetricKeyEncryption',
          validFrom: '2026-01-01T00:00:00Z',
          validUntil: '2026-02-01T00:00:00Z',
        },
        {
          certificate: 'PEM-SYM-NEW',
          usage: 'SymmetricKeyEncryption',
          validFrom: '2026-05-01T00:00:00Z',
          validUntil: '2027-05-01T00:00:00Z',
        },
        {
          certificate: 'PEM-TOKEN',
          usage: 'KsefTokenEncryption',
          validFrom: '2026-05-01T00:00:00Z',
          validUntil: '2027-05-01T00:00:00Z',
        },
      ],
    },
    status: 200,
    headers: {},
  };
}

describe('MfPublicKeyCacheService', () => {
  let http: FakeKsefHttpClient;

  beforeEach(() => {
    http = new FakeKsefHttpClient();
    http.seed('GET', PATH, certResponse());
  });

  it('should select the latest valid cert matching the requested usage', async () => {
    const service = new MfPublicKeyCacheService('conn-1', http);
    const cert = await service.fetchAndCachePublicKey('SymmetricKeyEncryption');
    expect(cert.certificatePem).toBe('PEM-SYM-NEW');
    expect(cert.usage).toBe('SymmetricKeyEncryption');
    expect(cert.certificateHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should return the token-encryption cert for the token usage', async () => {
    const service = new MfPublicKeyCacheService('conn-1', http);
    const cert = await service.fetchAndCachePublicKey('KsefTokenEncryption');
    expect(cert.certificatePem).toBe('PEM-TOKEN');
  });

  it('should throw when no valid cert exists for the usage', async () => {
    const onlyExpired = {
      data: {
        certificates: [
          {
            certificate: 'PEM-EXPIRED',
            usage: 'SymmetricKeyEncryption',
            validFrom: '2000-01-01T00:00:00Z',
            validUntil: '2000-02-01T00:00:00Z',
          },
        ],
      },
      status: 200,
      headers: {},
    };
    http.clear();
    http.seed('GET', PATH, onlyExpired);
    const service = new MfPublicKeyCacheService('conn-1', http);
    await expect(service.fetchAndCachePublicKey('SymmetricKeyEncryption')).rejects.toBeInstanceOf(
      KsefSessionCryptoException,
    );
  });

  it('should serve a cached cert on the second call without refetching', async () => {
    const cache = inMemoryCache();
    const service = new MfPublicKeyCacheService('conn-1', http, cache);
    await service.fetchAndCachePublicKey('SymmetricKeyEncryption');
    await service.fetchAndCachePublicKey('SymmetricKeyEncryption');
    const fetches = http.calls.filter((c) => c.path === PATH).length;
    expect(fetches).toBe(1);
  });

  it('should scope the cache key by connection and usage', async () => {
    const cache = inMemoryCache();
    const service = new MfPublicKeyCacheService('conn-1', http, cache);
    await service.fetchAndCachePublicKey('SymmetricKeyEncryption');
    const keys = Array.from(cache.store.keys());
    expect(keys).toContain('ksef:mf-public-key:conn-1:SymmetricKeyEncryption');
  });

  describe('rotation', () => {
    it('should drop a cached-but-now-stale cert and refetch (rotation)', async () => {
      const cache = inMemoryCache();
      const key = 'ksef:mf-public-key:conn-1:SymmetricKeyEncryption';
      // Pre-seed the cache with a cert whose window has already closed: a rotated
      // cert the previous run cached before the MF rotated it early.
      cache.store.set(key, {
        certificatePem: 'PEM-ROTATED-OUT',
        usage: 'SymmetricKeyEncryption',
        validFrom: '2000-01-01T00:00:00Z',
        validUntil: '2000-02-01T00:00:00Z',
        certificateHash: 'stale-hash',
      });

      const service = new MfPublicKeyCacheService('conn-1', http, cache);
      const cert = await service.fetchAndCachePublicKey('SymmetricKeyEncryption');

      // The stale entry was validated, found expired, dropped, and the live
      // (currently-valid) cert fetched + re-cached in its place.
      expect(cert.certificatePem).toBe('PEM-SYM-NEW');
      expect(http.calls.filter((c) => c.path === PATH)).toHaveLength(1);
      expect(cache.store.get(key)).toMatchObject({ certificatePem: 'PEM-SYM-NEW' });
    });

    it('should not cache a freshly-fetched cert already inside its refresh margin', async () => {
      // A cert valid only 1 minute from now sits inside the 5-minute refresh
      // margin: usable for this call but not worth caching (next call refetches).
      const nearExpiry = {
        data: {
          certificates: [
            {
              certificate: 'PEM-NEAR-EXPIRY',
              usage: 'SymmetricKeyEncryption',
              validFrom: new Date(Date.now() - 60_000).toISOString(),
              validUntil: new Date(Date.now() + 60_000).toISOString(),
            },
          ],
        },
        status: 200,
        headers: {},
      };
      http.clear();
      http.seed('GET', PATH, nearExpiry);
      const cache = inMemoryCache();
      const service = new MfPublicKeyCacheService('conn-1', http, cache);

      const cert = await service.fetchAndCachePublicKey('SymmetricKeyEncryption');

      expect(cert.certificatePem).toBe('PEM-NEAR-EXPIRY');
      expect(cache.store.size).toBe(0);
    });

    it('should degrade to a per-call fetch when no host cache is wired', async () => {
      const service = new MfPublicKeyCacheService('conn-1', http);
      await service.fetchAndCachePublicKey('SymmetricKeyEncryption');
      await service.fetchAndCachePublicKey('SymmetricKeyEncryption');
      expect(http.calls.filter((c) => c.path === PATH)).toHaveLength(2);
    });
  });
});
