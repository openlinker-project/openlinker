/**
 * MF Certificate Chain Verification
 *
 * Pure, network-free chain-of-trust check: verify a presented MF public-key
 * certificate chains to one of the pinned trust anchors. Uses Node's built-in
 * `crypto.X509Certificate` (no `node-forge` / `pkijs` dependency) - each supplied
 * anchor is treated as a pinned issuer, and the leaf is trusted if it is directly
 * issued by, and signature-verifies against, any anchor (or IS an anchor itself,
 * covering a pinned self-signed cert).
 *
 * Bundling both the root and any intermediates that sign the leaf certs is
 * therefore sufficient - see `mf-trust-anchors.ts`.
 *
 * @module libs/integrations/ksef/src/infrastructure/crypto
 */
import { X509Certificate } from 'crypto';
import { KsefSessionCryptoException } from '../../domain/exceptions/ksef-session-crypto.exception';

/**
 * Verify `leafPem` chains to one of `anchors`. Throws `KsefSessionCryptoException`
 * (`CERT_PARSE_FAILED` / `CERT_UNTRUSTED_ROOT`) on failure. `anchors` MUST be
 * non-empty - the caller decides whether to skip when no anchors are configured.
 */
export function verifyCertificateChainToAnchors(
  leafPem: string,
  anchors: readonly X509Certificate[],
  certHash: string,
): void {
  let leaf: X509Certificate;
  try {
    leaf = new X509Certificate(leafPem);
  } catch (error) {
    throw new KsefSessionCryptoException(
      `MF cert is not a parseable X.509 certificate (cert ${certHash})`,
      'CERT_PARSE_FAILED',
      error instanceof Error ? error : undefined,
    );
  }

  for (const anchor of anchors) {
    // Direct pin: the presented cert IS a trust anchor.
    if (leaf.fingerprint256 === anchor.fingerprint256) {
      return;
    }
    // Issued-by pin: signed by, and verifiable against, this anchor.
    try {
      if (leaf.checkIssued(anchor) && leaf.verify(anchor.publicKey)) {
        return;
      }
    } catch {
      // A malformed anchor / key just fails this candidate - try the next.
      continue;
    }
  }

  throw new KsefSessionCryptoException(
    `MF cert does not chain to any pinned trust anchor (cert ${certHash})`,
    'CERT_UNTRUSTED_ROOT',
  );
}
