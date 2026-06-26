/**
 * MF public-key cache service specs — fetch/filter/select/validate + caching.
 *
 * Wire shape reconciled to the spec `PublicKeyCertificate`: the endpoint returns
 * a flat ARRAY; each entry has `certificate` (DER base64), `certificateId`,
 * `publicKeyId`, `validFrom`/`validTo`, and `usage` as an ARRAY of operations.
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

interface WireCert {
  certificate: string;
  certificateId?: string;
  publicKeyId?: string;
  usage: string[];
  validFrom: string;
  validTo: string;
}

/** A flat ARRAY of certificate entries (the spec response shape). */
function certResponse(): {
  data: WireCert[];
  status: number;
  headers: Record<string, string>;
} {
  return {
    data: [
      {
        certificate: 'REVMLVNZTS1PTEQ=',
        certificateId: 'CID-SYM-OLD',
        publicKeyId: 'PKID-SYM-OLD' + 'a'.repeat(32),
        usage: ['SymmetricKeyEncryption'],
        validFrom: '2026-01-01T00:00:00Z',
        validTo: '2026-02-01T00:00:00Z',
      },
      {
        certificate: 'REVMLVNZTS1ORVc=',
        certificateId: 'CID-SYM-NEW',
        publicKeyId: 'PKID-SYM-NEW' + 'b'.repeat(32),
        usage: ['SymmetricKeyEncryption'],
        validFrom: '2026-05-01T00:00:00Z',
        validTo: '2027-05-01T00:00:00Z',
      },
      {
        certificate: 'REVMLVRPS0VO',
        certificateId: 'CID-TOKEN',
        publicKeyId: 'PKID-TOKEN' + 'c'.repeat(34),
        // A cert valid for both operations — usage membership, not equality.
        usage: ['KsefTokenEncryption', 'SymmetricKeyEncryption'],
        validFrom: '2025-01-01T00:00:00Z',
        validTo: '2027-05-01T00:00:00Z',
      },
    ],
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

  it('should select the latest valid cert whose usage array includes the requested usage', async () => {
    const service = new MfPublicKeyCacheService('conn-1', http);
    const cert = await service.fetchAndCachePublicKey('SymmetricKeyEncryption');
    // PKID-SYM-NEW has the latest validFrom among the symmetric-capable certs.
    expect(cert.publicKeyId).toBe('PKID-SYM-NEW' + 'b'.repeat(32));
    expect(cert.usage).toContain('SymmetricKeyEncryption');
    expect(cert.certificatePem).toContain('BEGIN CERTIFICATE');
    expect(cert.certificateHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should match a cert that lists the usage among several operations', async () => {
    const service = new MfPublicKeyCacheService('conn-1', http);
    const cert = await service.fetchAndCachePublicKey('KsefTokenEncryption');
    expect(cert.publicKeyId).toBe('PKID-TOKEN' + 'c'.repeat(34));
    expect(cert.usage).toContain('KsefTokenEncryption');
  });

  it('should throw when no valid cert exists for the usage', async () => {
    const onlyExpired = {
      data: [
        {
          certificate: 'RVhQSVJFRA==',
          usage: ['SymmetricKeyEncryption'],
          validFrom: '2000-01-01T00:00:00Z',
          validTo: '2000-02-01T00:00:00Z',
        },
      ] as WireCert[],
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

  it('should throw CERT_BAD_ENCODING when the certificate payload is not valid base64', async () => {
    const badEncoding = {
      data: [
        {
          certificate: 'not valid base64 !!!',
          usage: ['SymmetricKeyEncryption'],
          validFrom: new Date(Date.now() - 60_000).toISOString(),
          validTo: new Date(Date.now() + 3_600_000).toISOString(),
        },
      ] as WireCert[],
      status: 200,
      headers: {},
    };
    http.clear();
    http.seed('GET', PATH, badEncoding);
    const service = new MfPublicKeyCacheService('conn-1', http);
    await expect(service.fetchAndCachePublicKey('SymmetricKeyEncryption')).rejects.toMatchObject({
      name: 'KsefSessionCryptoException',
      errorCode: 'CERT_BAD_ENCODING',
    });
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
      // Pre-seed the cache with a cert whose window has already closed.
      cache.store.set(key, {
        certificatePem: 'PEM-ROTATED-OUT',
        usage: ['SymmetricKeyEncryption'],
        validFrom: '2000-01-01T00:00:00Z',
        validTo: '2000-02-01T00:00:00Z',
        certificateHash: 'stale-hash',
      });

      const service = new MfPublicKeyCacheService('conn-1', http, cache);
      const cert = await service.fetchAndCachePublicKey('SymmetricKeyEncryption');

      // The stale entry was validated, found expired, dropped, and the live
      // (currently-valid) cert fetched + re-cached in its place.
      expect(cert.publicKeyId).toBe('PKID-SYM-NEW' + 'b'.repeat(32));
      expect(http.calls.filter((c) => c.path === PATH)).toHaveLength(1);
      expect(cache.store.get(key)).toMatchObject({ publicKeyId: 'PKID-SYM-NEW' + 'b'.repeat(32) });
    });

    it('should not cache a freshly-fetched cert already inside its refresh margin', async () => {
      // A cert valid only 1 minute from now sits inside the 5-minute refresh
      // margin: usable for this call but not worth caching (next call refetches).
      const nearExpiry = {
        data: [
          {
            certificate: 'TkVBUi1FWFBJUlk=',
            publicKeyId: 'PKID-NEAR' + 'd'.repeat(35),
            usage: ['SymmetricKeyEncryption'],
            validFrom: new Date(Date.now() - 60_000).toISOString(),
            validTo: new Date(Date.now() + 60_000).toISOString(),
          },
        ] as WireCert[],
        status: 200,
        headers: {},
      };
      http.clear();
      http.seed('GET', PATH, nearExpiry);
      const cache = inMemoryCache();
      const service = new MfPublicKeyCacheService('conn-1', http, cache);

      const cert = await service.fetchAndCachePublicKey('SymmetricKeyEncryption');

      expect(cert.publicKeyId).toBe('PKID-NEAR' + 'd'.repeat(35));
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
