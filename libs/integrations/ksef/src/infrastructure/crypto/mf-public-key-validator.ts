/**
 * MF Public Key Certificate Validator
 *
 * Validation gate applied to every MF public-key certificate before it is trusted
 * to wrap a session secret. A compromised, expired, wrong-usage, untrusted, or
 * revoked cert could trap session secrets behind a key an attacker owns, so the
 * gate enforces (in order):
 *
 *   1. declared `usage` matches the intended operation (key-confusion guard);
 *   2. the validity window (`validFrom` <= now < `validTo`);
 *   3. chain-of-trust: the cert chains to a pinned MF trust anchor (SKIPPED, with
 *      a boot-time warning, when no anchor is configured - see `mf-trust-anchors.ts`);
 *   4. revocation: an injected {@link CertificateRevocationChecker} does not report
 *      the cert as revoked (the default checker is no-network - live OCSP/CRL is a
 *      documented deferral; see `mf-certificate-revocation.ts`).
 *
 * Steps 3 + 4 run only when `options.trustAnchors` / `options.revocationChecker`
 * are supplied - the legacy window+usage call sites (and unit tests of those two
 * checks) pass none and are unaffected. The `MfPublicKeyCacheService` supplies both
 * on the live fetch path.
 *
 * @module libs/integrations/ksef/src/infrastructure/crypto
 */
import { X509Certificate } from 'crypto';
import { Logger } from '@openlinker/shared/logging';
import type {
  KsefCertificateUsage,
  PublicKeyCertificate,
} from '../http/ksef-crypto.types';
import type { MfCertificateTrustOptions } from './mf-certificate-trust.types';
import { verifyCertificateChainToAnchors } from './mf-certificate-chain';
import { KsefSessionCryptoException } from '../../domain/exceptions/ksef-session-crypto.exception';

const logger = new Logger('MfPublicKeyValidator');

/**
 * Validate a cert for a given usage at a given instant. Throws
 * `KsefSessionCryptoException` on any of: usage mismatch, not-yet-valid, expired,
 * untrusted chain, or revoked. The message carries only the cert hash + usage,
 * never key material.
 */
export function validateMfPublicKeyCertificate(
  cert: PublicKeyCertificate,
  usage: KsefCertificateUsage,
  now: Date = new Date(),
  options: MfCertificateTrustOptions = {},
): void {
  if (!cert.usage.includes(usage)) {
    throw new KsefSessionCryptoException(
      `MF cert usage mismatch: expected ${usage}, got [${cert.usage.join(', ')}] (cert ${cert.certificateHash})`,
      'CERT_USAGE_MISMATCH',
    );
  }
  if (now.getTime() < cert.validFrom.getTime()) {
    throw new KsefSessionCryptoException(
      `MF cert not yet valid (validFrom ${cert.validFrom.toISOString()}, cert ${cert.certificateHash})`,
      'CERT_NOT_YET_VALID',
    );
  }
  if (now.getTime() >= cert.validTo.getTime()) {
    throw new KsefSessionCryptoException(
      `MF cert expired (validTo ${cert.validTo.toISOString()}, cert ${cert.certificateHash})`,
      'CERT_EXPIRED',
    );
  }

  const { trustAnchors, revocationChecker } = options;

  // Chain-of-trust: only enforced when anchors are configured. An empty anchor
  // set means "no MF root CA supplied" - the loader already warned at boot; here
  // we trust TLS transport security and skip (documented posture).
  if (trustAnchors && trustAnchors.length > 0) {
    verifyCertificateChainToAnchors(cert.certificatePem, trustAnchors, cert.certificateHash);
  }

  // Revocation: reject only a positively-`revoked` verdict. `unknown` (e.g. the
  // default no-network checker) is non-fatal and logged.
  if (revocationChecker) {
    let leaf: X509Certificate | undefined;
    try {
      leaf = new X509Certificate(cert.certificatePem);
    } catch {
      leaf = undefined;
    }
    if (leaf) {
      const status = revocationChecker.check(leaf);
      if (status === 'revoked') {
        throw new KsefSessionCryptoException(
          `MF cert is revoked (cert ${cert.certificateHash})`,
          'CERT_REVOKED',
        );
      }
      if (status === 'unknown') {
        logger.debug(`MF cert revocation status unknown (cert ${cert.certificateHash})`);
      }
    }
  }
}
