/**
 * MF Certificate Trust Types
 *
 * Shapes for the chain-of-trust + revocation layer applied to MF public-key
 * certificates before they are trusted to wrap a session secret. Adapter-internal
 * (ADR-026) - no core abstraction; these types never leave the KSeF plugin.
 *
 * @module libs/integrations/ksef/src/infrastructure/crypto
 */
import type { X509Certificate } from 'crypto';

/**
 * Revocation status of a certificate as reported by a {@link CertificateRevocationChecker}.
 *
 * - `good`    - the checker positively confirmed the cert is NOT revoked.
 * - `revoked` - the cert appears on a CRL / OCSP responder as revoked -> reject.
 * - `unknown` - the checker could not determine status (no responder configured,
 *   network unavailable, unparseable response). Treated as non-fatal (fail-open)
 *   so an offline OCSP endpoint does not wedge issuance, but logged. Production
 *   hardening may upgrade `unknown` to a rejection - see the crypto README.
 */
export const RevocationStatusValues = ['good', 'revoked', 'unknown'] as const;
export type RevocationStatus = (typeof RevocationStatusValues)[number];

/**
 * Pluggable seam for certificate revocation checking (OCSP-first / CRL fallback).
 *
 * Kept synchronous and injectable so the validator stays a pure, testable gate:
 * the default production implementation ({@link NullRevocationChecker}) performs
 * NO network I/O - live OCSP/CRL is a documented deferral - while tests inject a
 * checker that reports a known-revoked serial to prove the rejection path.
 */
export interface CertificateRevocationChecker {
  /**
   * Report the revocation status of a parsed certificate. MUST NOT throw for a
   * merely-indeterminate result - return `unknown` instead; reserve throwing for
   * genuine programming errors.
   */
  check(cert: X509Certificate): RevocationStatus;
}

/**
 * Optional trust inputs threaded into {@link validateMfPublicKeyCertificate}.
 * Both are omitted by the legacy window+usage-only call sites (tests, and the
 * pre-hardening path) so those keep passing; the cache service supplies them so
 * the live fetch path enforces chain-of-trust + revocation when configured.
 */
export interface MfCertificateTrustOptions {
  /**
   * Pinned trust anchors the presented cert must chain to. When empty/undefined
   * the chain check is SKIPPED (a warning is logged once at load time) so the
   * connection keeps working over TLS-only trust until an operator supplies the
   * production MF root CA. When non-empty, a cert that does not chain to one of
   * these anchors is rejected.
   */
  trustAnchors?: readonly X509Certificate[];
  /** Revocation seam; when omitted, revocation is not checked. */
  revocationChecker?: CertificateRevocationChecker;
}
