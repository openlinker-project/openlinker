/**
 * MF Public Key Cache Service
 *
 * Fetches MF public-key certificates from `GET /security/public-key-certificates`
 * and caches the selected cert per `(connectionId, usage)` via the host cache.
 * The endpoint returns a flat ARRAY of `PublicKeyCertificate` entries — each
 * carries `certificate` (DER, base64), `certificateId`, `publicKeyId` (the
 * 44-char encryption-key selector), `validFrom`/`validTo`, and `usage` as an
 * ARRAY of operations. The cache TTL is derived from the cert's validity window
 * (`validTo - now`, minus a safety margin) — never a hardcoded constant — so a
 * rotated cert can't be served past its lifetime. When no host cache is wired
 * the service degrades to a per-call fetch.
 *
 * Used by both `KsefTokenEncryptor` (usage `KsefTokenEncryption`) and
 * `KsefSessionCryptoService` (usage `SymmetricKeyEncryption`); the usage is a
 * required selector (matched against the cert's `usage` array) to avoid
 * key-confusion between the two cert kinds.
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
import { loadMfTrustAnchors } from './mf-trust-anchors';
import { NullRevocationChecker } from './mf-certificate-revocation';
import type {
  CertificateRevocationChecker,
  MfCertificateTrustOptions,
} from './mf-certificate-trust.types';
import { KsefSessionCryptoException } from '../../domain/exceptions/ksef-session-crypto.exception';

/** Refetch this many ms before a cert's `validTo`, so an in-flight wrap never races expiry. */
const CERT_REFRESH_MARGIN_MS = 5 * 60_000;

const MF_CERTIFICATES_PATH = '/security/public-key-certificates';

/**
 * Wire shape of one `PublicKeyCertificate` entry. `certificate` is DER bytes
 * base64-encoded; `usage` is an array of operations the cert may be used for.
 */
interface MfCertificateResponseEntry {
  certificate: string;
  certificateId?: string;
  publicKeyId?: string;
  usage: string[];
  validFrom: string;
  validTo: string;
}

/** The endpoint returns a bare array of certificate entries. */
type MfCertificatesResponse = MfCertificateResponseEntry[];

/** Cached shape (PEM + ISO dates) — dates are re-hydrated to `Date` on read. */
interface CachedCertificate {
  certificatePem: string;
  usage: KsefCertificateUsage[];
  validFrom: string;
  validTo: string;
  publicKeyId?: string;
  certificateId?: string;
  certificateHash: string;
}

export class MfPublicKeyCacheService {
  private readonly logger = new Logger(MfPublicKeyCacheService.name);
  private readonly revocationChecker: CertificateRevocationChecker = new NullRevocationChecker();

  constructor(
    private readonly connectionId: string,
    private readonly httpClient: IKsefHttpClient,
    private readonly cache?: CachePort,
  ) {}

  /**
   * Resolve the active MF public-key cert for a usage, cache-first. On miss /
   * expiry, fetches, selects the latest valid cert whose `usage` array includes
   * the requested usage, validates it, and caches it with a validity-derived TTL.
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

  /**
   * Resolve the chain-of-trust + revocation inputs applied on every validate call.
   * Trust anchors are loaded (and memoized) from the operator-configured MF root
   * CA; the revocation checker is the no-network default (documented deferral).
   */
  private trustOptions(): MfCertificateTrustOptions {
    return { trustAnchors: loadMfTrustAnchors(), revocationChecker: this.revocationChecker };
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
      validTo: new Date(entry.validTo),
      publicKeyId: entry.publicKeyId,
      certificateId: entry.certificateId,
      certificateHash: entry.certificateHash,
    };
    try {
      validateMfPublicKeyCertificate(cert, usage, now, this.trustOptions());
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
    const ttlMs = cert.validTo.getTime() - CERT_REFRESH_MARGIN_MS - now.getTime();
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
      validTo: cert.validTo.toISOString(),
      publicKeyId: cert.publicKeyId,
      certificateId: cert.certificateId,
      certificateHash: cert.certificateHash,
    };
    await this.cache.set(cacheKey, entry, ttlSec);
    this.logger.debug(`Cached MF public key (${cacheKey}) ttl=${ttlSec}s cert=${cert.certificateHash}`);
  }

  private async fetchActiveCertificate(
    usage: KsefCertificateUsage,
    now: Date,
  ): Promise<PublicKeyCertificate> {
    // The MF public-key certificate endpoint is unauthenticated — it bootstraps
    // the handshake before any token exists, so skip bearer injection.
    const response = await this.httpClient.get<MfCertificatesResponse>(MF_CERTIFICATES_PATH, {
      skipAuth: true,
    });
    const entries = Array.isArray(response.data) ? response.data : [];
    const matching = entries
      .filter((entry) => (entry.usage ?? []).includes(usage))
      .map((entry) => this.toCertificate(entry))
      // Latest-issued first.
      .sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime());

    const active = matching.find((cert) => {
      try {
        validateMfPublicKeyCertificate(cert, usage, now, this.trustOptions());
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
    const certificatePem = this.toPem(entry.certificate);
    return {
      certificatePem,
      usage: (entry.usage ?? []) as KsefCertificateUsage[],
      validFrom: new Date(entry.validFrom),
      validTo: new Date(entry.validTo),
      publicKeyId: entry.publicKeyId,
      certificateId: entry.certificateId,
      certificateHash: createHash('sha256').update(certificatePem).digest('hex'),
    };
  }

  /**
   * Wrap a base64-DER X.509 certificate into a PEM block. `createPublicKey`
   * (in the RSA wrapper) accepts a certificate PEM and extracts the SPKI. A
   * payload that is already PEM (legacy/test fixtures) is passed through.
   */
  private toPem(certificate: string): string {
    if (certificate.includes('-----BEGIN')) {
      return certificate;
    }
    const compact = certificate.replace(/\s+/g, '');
    if (!this.isValidBase64(compact)) {
      throw new KsefSessionCryptoException(
        'MF certificate payload is not valid base64-DER',
        'CERT_BAD_ENCODING',
      );
    }
    const lines = compact.match(/.{1,64}/g) ?? [compact];
    return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
  }

  /** A non-empty, length-aligned base64 string (standard alphabet, padded). */
  private isValidBase64(value: string): boolean {
    if (value.length === 0 || value.length % 4 !== 0) {
      return false;
    }
    return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
  }
}
