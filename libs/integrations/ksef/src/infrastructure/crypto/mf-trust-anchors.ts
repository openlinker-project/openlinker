/**
 * MF Trust Anchor Loader
 *
 * Loads the pinned MF root/intermediate certificate(s) the chain-of-trust check
 * verifies presented MF public-key certs against. Anchors are sourced, in order:
 *
 *   1. `OL_KSEF_MF_ROOT_CA_PATH` env var - absolute path to a PEM file that may
 *      concatenate multiple certs (root + any intermediates).
 *   2. `BUNDLED_MF_ROOT_CA_PEMS` - an in-tree fallback bundle.
 *
 * IMPORTANT (operator action for production): the real Ministerstwo Finansow KSeF
 * PKI root CA is NOT bundled here - `BUNDLED_MF_ROOT_CA_PEMS` ships EMPTY. Until an
 * operator supplies the authoritative MF root CA (via the env var, or by vendoring
 * it into the bundle), the chain-of-trust check has NO anchors and is SKIPPED with
 * a loud one-time warning: trust falls back to TLS transport security only. This is
 * a deliberate honest default - we do not ship a guessed/fabricated CA. See the
 * crypto README for the exact operator instructions.
 *
 * Every supplied cert is treated as a trust anchor (pinning model): a presented
 * cert is trusted if it is directly issued by any anchor, so bundling both the root
 * and any intermediates that sign the leaf certs is sufficient.
 *
 * SECURITY: only public certificate material is loaded here - never private keys.
 * The loader is memoized per-process; a config change requires a restart (matches
 * how the rest of the KSeF env config is read).
 *
 * @module libs/integrations/ksef/src/infrastructure/crypto
 */
import { X509Certificate } from 'crypto';
import { readFileSync } from 'fs';
import { Logger } from '@openlinker/shared/logging';

/** Env var pointing at a PEM file of MF trust anchors (root + optional intermediates). */
export const MF_ROOT_CA_PATH_ENV = 'OL_KSEF_MF_ROOT_CA_PATH';

/**
 * In-tree fallback trust anchors. Intentionally EMPTY - the real MF root CA must
 * be supplied by the operator (see module header). Do NOT add a guessed cert here.
 */
export const BUNDLED_MF_ROOT_CA_PEMS: readonly string[] = [];

const logger = new Logger('MfTrustAnchors');

let memoized: readonly X509Certificate[] | undefined;

/** Split a PEM bundle into individual certificate blocks. */
function splitPemBundle(pem: string): string[] {
  const matches = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  return matches ?? [];
}

function parseAnchors(pems: readonly string[], source: string): X509Certificate[] {
  const anchors: X509Certificate[] = [];
  for (const pem of pems) {
    try {
      anchors.push(new X509Certificate(pem));
    } catch (error) {
      logger.warn(
        `Skipping an unparseable MF trust anchor from ${source}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
  return anchors;
}

function readFromEnv(): X509Certificate[] {
  const path = process.env[MF_ROOT_CA_PATH_ENV]?.trim();
  if (!path) {
    return [];
  }
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch (error) {
    logger.error(
      `${MF_ROOT_CA_PATH_ENV} is set to "${path}" but the file could not be read: ${
        error instanceof Error ? error.message : 'unknown error'
      }. MF chain-of-trust will be SKIPPED.`,
    );
    return [];
  }
  const anchors = parseAnchors(splitPemBundle(contents), MF_ROOT_CA_PATH_ENV);
  if (anchors.length > 0) {
    logger.log(`Loaded ${anchors.length} MF trust anchor(s) from ${MF_ROOT_CA_PATH_ENV}`);
  }
  return anchors;
}

/**
 * Resolve the active MF trust anchors, memoized for the process lifetime. When
 * the result is empty the caller SKIPS the chain check (TLS-only trust) - this
 * function logs the security-relevant warning exactly once so it surfaces at boot.
 */
export function loadMfTrustAnchors(): readonly X509Certificate[] {
  if (memoized) {
    return memoized;
  }
  const anchors = [...readFromEnv(), ...parseAnchors(BUNDLED_MF_ROOT_CA_PEMS, 'bundle')];
  if (anchors.length === 0) {
    logger.warn(
      `No MF root CA configured (set ${MF_ROOT_CA_PATH_ENV} or vendor the MF root CA into ` +
        'BUNDLED_MF_ROOT_CA_PEMS). MF public-key chain-of-trust verification is SKIPPED; ' +
        'trust relies on TLS transport security only. Configure the MF root CA before production.',
    );
  }
  memoized = anchors;
  return memoized;
}

/** Test-only: reset the memoized anchors so env overrides take effect per-test. */
export function resetMfTrustAnchorsCacheForTests(): void {
  memoized = undefined;
}
