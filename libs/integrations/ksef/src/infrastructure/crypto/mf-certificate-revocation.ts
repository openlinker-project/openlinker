/**
 * MF Certificate Revocation Checker (default)
 *
 * Default production {@link CertificateRevocationChecker} implementation.
 *
 * DOCUMENTED LIMITATION: live OCSP-first / CRL-fallback revocation over the
 * network is DEFERRED for this MVP. Implementing a correct OCSP client (ASN.1
 * request signing, nonce handling, responder-cert validation) or CRL fetch +
 * signature-verify + delta-CRL handling is disproportionate to the current risk:
 * MF public-key certs are short-lived (validity-window enforced) and served over
 * TLS from the MF backend. Rather than ship a fake "always good" check dressed up
 * as real revocation, this returns `unknown` (non-fatal) and the validator treats
 * that as pass-with-log. The seam ({@link CertificateRevocationChecker}) is the
 * single, tested extension point: a future issue can drop in a real OCSP/CRL
 * checker with no change to the validator or its call sites, and tests already
 * prove that a checker returning `revoked` causes the cert to be rejected.
 *
 * @module libs/integrations/ksef/src/infrastructure/crypto
 */
import type { X509Certificate } from 'crypto';
import type {
  CertificateRevocationChecker,
  RevocationStatus,
} from './mf-certificate-trust.types';

/**
 * No-network revocation checker. Always reports `unknown` (never blocks issuance)
 * and does no I/O. See module header for why real OCSP/CRL is deferred.
 */
export class NullRevocationChecker implements CertificateRevocationChecker {
  check(_cert: X509Certificate): RevocationStatus {
    return 'unknown';
  }
}
