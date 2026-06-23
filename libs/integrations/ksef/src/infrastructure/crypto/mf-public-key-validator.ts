/**
 * MF Public Key Certificate Validator
 *
 * Pure validation gate applied to every MF public-key certificate before it is
 * trusted to wrap a session secret. A compromised, expired, or wrong-usage cert
 * could trap session secrets behind a key an attacker owns, so we enforce the
 * validity window and the declared `usage` matches the intended operation.
 *
 * NOTE: full chain-of-trust verification against a pinned MF root is DEFERRED —
 * KSeF serves these certs over TLS from the MF backend, and the C3 scope
 * validates the validity window + usage. Root-pinning + OCSP/CRL is a tracked
 * follow-up (see crypto README); this function is the single seam to add it.
 *
 * @module libs/integrations/ksef/src/infrastructure/crypto
 */
import type {
  KsefCertificateUsage,
  PublicKeyCertificate,
} from '../http/ksef-crypto.types';
import { KsefSessionCryptoException } from '../../domain/exceptions/ksef-session-crypto.exception';

/**
 * Validate a cert for a given usage at a given instant. Throws
 * `KsefSessionCryptoException` on any of: not-yet-valid, expired, or usage
 * mismatch. The message carries only the cert hash + usage, never key material.
 */
export function validateMfPublicKeyCertificate(
  cert: PublicKeyCertificate,
  usage: KsefCertificateUsage,
  now: Date = new Date(),
): void {
  if (cert.usage !== usage) {
    throw new KsefSessionCryptoException(
      `MF cert usage mismatch: expected ${usage}, got ${cert.usage} (cert ${cert.certificateHash})`,
      'CERT_USAGE_MISMATCH',
    );
  }
  if (now.getTime() < cert.validFrom.getTime()) {
    throw new KsefSessionCryptoException(
      `MF cert not yet valid (validFrom ${cert.validFrom.toISOString()}, cert ${cert.certificateHash})`,
      'CERT_NOT_YET_VALID',
    );
  }
  if (now.getTime() >= cert.validUntil.getTime()) {
    throw new KsefSessionCryptoException(
      `MF cert expired (validUntil ${cert.validUntil.toISOString()}, cert ${cert.certificateHash})`,
      'CERT_EXPIRED',
    );
  }
}
