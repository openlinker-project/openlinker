/**
 * MF Public Key Cache Service
 *
 * Fetches MF public-key certificates from `GET /security/public-key-certificates`
 * and caches the selected cert per `(connectionId, usage)` via the host cache.
 * The cache TTL is derived from the cert's validity window (`validUntil - now`,
 * minus a safety margin) — never a hardcoded constant — so a rotated cert can't
 * be served past its lifetime. When no host cache is wired the service degrades
 * to a per-call fetch.
 *
 * Used by both `KsefTokenEncryptor` (usage `KsefTokenEncryption`) and
 * `KsefSessionCryptoService` (usage `SymmetricKeyEncryption`); the usage is a
 * required selector to avoid key-confusion between the two cert kinds.
 *
 * SECURITY: logs only the cache key (connectionId + usage), the selected cert
 * hash, and the derived TTL — never the PEM / key material.
 *
 * @module libs/integrations/ksef/src/infrastructure/crypto
 */
import { createHash } from 'crypto';
import type { CachePort } from '@openlinker/shared/cache';
import { Logger } from '@openlinker/shared/logging';
import type { IKsefHttpClient } from '../http/ksef-http-client.interface';
import type { KsefCertificateUsage, PublicKeyCertificate } from '../http/ksef-crypto.types';
import { validateMfPublicKeyCertificate } from './mf-public-key-validator';
import { KsefSessionCryptoException } from '../../domain/exceptions/ksef-session-crypto.exception';

/** Refetch this many ms before a cert's `validUntil`, so an in-flight wrap never races expiry. */
const CERT_REFRESH_MARGIN_MS = 5 * 60_000;

const MF_CERTIFICATES_PATH = '/security/public-key-certificates';

/** Wire shape of one entry in the MF public-key-certificates response. */
interface MfCertificateResponseEntry {
  certificate: string;
  usage: KsefCertificateUsage;
  validFrom: string;
  validUntil: string;
}

interface MfCertificatesResponse {
  certificates: MfCertificateResponseEntry[];
}

/** Cached shape (PEM + ISO dates) — dates are re-hydrated to `Date` on read. */
interface CachedCertificate {
  certificatePem: string;
  usage: KsefCertificateUsage;
  validFrom: string;
  validUntil: string;
  certificateHash: string;
}

export class MfPublicKeyCacheService {
  private readonly logger = new Logger(MfPublicKeyCacheService.name);

  constructor(
    private readonly connectionId: string,
    private readonly httpClient: IKsefHttpClient,
    private readonly cache?: CachePort,
  ) {}

  /**
   * Resolve the active MF public-key cert for a usage, cache-first. On miss /
   * expiry, fetches, selects the latest valid cert, validates it, and caches it
   * with a validity-derived TTL.
   */
  async fetchAndCachePublicKey(usage: KsefCertificateUsage): Promise<PublicKeyCertificate> {
    const cacheKey = this.cacheKeyFor(usage);
    const now = new Date();

    const cached = await this.readFromCache(cacheKey, usage, now);
    if (cached) {
      this.logger.debug(`MF public-key cache hit (${cacheKey})`);
      return cached;
    }

    this.logger.debug(`MF public-key cache miss (${cacheKey}); fetching`);
    const cert = await this.fetchActiveCertificate(usage, now);

    await this.writeToCache(cacheKey, cert, now);
    return cert;
  }

  private cacheKeyFor(usage: KsefCertificateUsage): string {
    return `ksef:mf-public-key:${this.connectionId}:${usage}`;
  }

  private async readFromCache(
    cacheKey: string,
    usage: KsefCertificateUsage,
    now: Date,
  ): Promise<PublicKeyCertificate | null> {
    if (!this.cache) {
      return null;
    }
    const entry = await this.cache.get<CachedCertificate>(cacheKey);
    if (!entry) {
      return null;
    }
    const cert: PublicKeyCertificate = {
      certificatePem: entry.certificatePem,
      usage: entry.usage,
      validFrom: new Date(entry.validFrom),
      validUntil: new Date(entry.validUntil),
      certificateHash: entry.certificateHash,
    };
    try {
      validateMfPublicKeyCertificate(cert, usage, now);
    } catch {
      // A cached-but-now-stale cert (rotated early) → drop and refetch.
      await this.cache.delete(cacheKey);
      return null;
    }
    return cert;
  }

  private async writeToCache(
    cacheKey: string,
    cert: PublicKeyCertificate,
    now: Date,
  ): Promise<void> {
    if (!this.cache) {
      return;
    }
    const ttlMs = cert.validUntil.getTime() - CERT_REFRESH_MARGIN_MS - now.getTime();
    if (ttlMs <= 0) {
      // Cert is within the refresh margin of expiry — usable now but not worth
      // caching; the next call refetches.
      return;
    }
    const ttlSec = Math.floor(ttlMs / 1000);
    const entry: CachedCertificate = {
      certificatePem: cert.certificatePem,
      usage: cert.usage,
      validFrom: cert.validFrom.toISOString(),
      validUntil: cert.validUntil.toISOString(),
      certificateHash: cert.certificateHash,
    };
    await this.cache.set(cacheKey, entry, ttlSec);
    this.logger.debug(`Cached MF public key (${cacheKey}) ttl=${ttlSec}s cert=${cert.certificateHash}`);
  }

  private async fetchActiveCertificate(
    usage: KsefCertificateUsage,
    now: Date,
  ): Promise<PublicKeyCertificate> {
    const response = await this.httpClient.get<MfCertificatesResponse>(MF_CERTIFICATES_PATH);
    const matching = (response.data.certificates ?? [])
      .filter((entry) => entry.usage === usage)
      .map((entry) => this.toCertificate(entry))
      // Latest-issued first.
      .sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime());

    const active = matching.find((cert) => {
      try {
        validateMfPublicKeyCertificate(cert, usage, now);
        return true;
      } catch {
        return false;
      }
    });

    if (!active) {
      throw new KsefSessionCryptoException(
        `No valid MF public-key certificate for usage ${usage}`,
        'CERT_NOT_FOUND',
      );
    }
    return active;
  }

  private toCertificate(entry: MfCertificateResponseEntry): PublicKeyCertificate {
    return {
      certificatePem: entry.certificate,
      usage: entry.usage,
      validFrom: new Date(entry.validFrom),
      validUntil: new Date(entry.validUntil),
      certificateHash: createHash('sha256').update(entry.certificate).digest('hex'),
    };
  }
}
