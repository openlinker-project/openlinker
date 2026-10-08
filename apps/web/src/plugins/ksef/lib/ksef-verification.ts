/**
 * KSeF verification-code (kod weryfikacyjny) URL assembly
 *
 * Since 1 Feb 2026 any structured invoice handed to a buyer OUTSIDE the KSeF
 * system (PDF / email / on-screen preview) must carry a QR verification code so
 * the recipient can confirm the document against the authority. OpenLinker is
 * always online, so it only ever needs KOD I - the online-cleared verification
 * code, which is purely deterministic from PUBLIC data and needs NO signing key
 * or certificate (that is KOD II, the offline certificate-signed code, which is
 * explicitly out of scope - OL never issues offline).
 *
 * KOD I encodes this verification URL:
 *
 *   https://{host}/invoice/{NIP}/{DD-MM-RRRR}/{Base64URL(SHA256(rawXmlBytes))}
 *
 *   - `host`       : the environment's KSeF verification host (prod vs test).
 *   - `NIP`        : seller NIP (digits only).
 *   - `DD-MM-RRRR` : the invoice issue date, day-month-year hyphen-separated
 *                    (OL stores it ISO `YYYY-MM-DD`, so it is reformatted here).
 *   - hash         : SHA-256 over the EXACT raw, unencrypted FA(3) XML bytes as
 *                    submitted to KSeF, Base64URL-encoded (URL-safe alphabet,
 *                    padding stripped) - NOT standard Base64, NOT re-serialized.
 *
 * The hash input MUST be the byte-exact submitted document. In OpenLinker that
 * is the persisted `sourceDocument` snapshot (the FA(3) `xml` string the adapter
 * submitted verbatim; see `KsefInvoicingAdapter.toSourceDocument`), which the FE
 * loads via `?kind=source` and passes as `xmlText`. Encoding that string back to
 * UTF-8 bytes round-trips the original bytes exactly.
 *
 * @module plugins/ksef/lib
 */
import type { KsefEnvironment } from '../components/ksef-setup.schema';

/**
 * KSeF verification (QR) hosts per environment. Production resolves to the live
 * verification portal; every non-prod tier (test / demo) resolves to the test
 * verification host. Never defaults to prod for an unknown environment.
 */
const KSEF_VERIFICATION_HOSTS: Readonly<Record<KsefEnvironment, string>> = {
  prod: 'ksef.mf.gov.pl',
  test: 'qr-test.ksef.mf.gov.pl',
  demo: 'qr-test.ksef.mf.gov.pl',
};

const TEST_VERIFICATION_HOST = KSEF_VERIFICATION_HOSTS.test;

/**
 * Resolve the KSeF verification host for a connection environment. Only the
 * explicit `prod` value maps to the production host; any other (or unknown)
 * value falls back to the test host so a mis-set environment can never leak a
 * production verification URL onto a sandbox document.
 */
export function resolveKsefVerificationHost(environment: string | null | undefined): string {
  return environment === 'prod' ? KSEF_VERIFICATION_HOSTS.prod : TEST_VERIFICATION_HOST;
}

/**
 * Reformat an ISO `YYYY-MM-DD` issue date to the `DD-MM-RRRR` form the KSeF
 * verification URL requires. Returns null for anything that is not a plain
 * ISO date (the caller then omits the QR rather than emit a malformed URL).
 */
export function formatIssueDateForVerification(isoDate: string | null | undefined): string | null {
  if (!isoDate) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  return `${day}-${month}-${year}`;
}

/** Base64URL-encode raw bytes: standard Base64 with `+`->`-`, `/`->`_`, padding stripped. */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * SHA-256 over UTF-8 bytes of `xmlText`, Base64URL-encoded. Uses Web Crypto
 * (`crypto.subtle`) - available in every supported browser and in the test
 * runtime - so no hashing dependency is pulled in.
 */
export async function sha256Base64Url(xmlText: string): Promise<string> {
  const bytes = new TextEncoder().encode(xmlText);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return bytesToBase64Url(new Uint8Array(digest));
}

export interface KsefVerificationUrlInput {
  environment: string | null | undefined;
  sellerNip: string | null | undefined;
  /** Issue date in ISO `YYYY-MM-DD` (FA(3) `P_1`). */
  issueDateIso: string | null | undefined;
  /** The exact raw FA(3) XML submitted to KSeF (the persisted source document). */
  xmlText: string;
}

/**
 * Assemble the full KSeF KOD I verification URL. Returns null when any required
 * input is missing/malformed (no NIP, unparseable issue date, empty XML) so the
 * caller can skip the QR rather than render a broken code.
 */
export async function buildKsefVerificationUrl(
  input: KsefVerificationUrlInput,
): Promise<string | null> {
  const nip = input.sellerNip?.replace(/[\s-]/g, '') ?? '';
  const issueDate = formatIssueDateForVerification(input.issueDateIso);
  if (nip.length === 0 || issueDate === null || input.xmlText.length === 0) {
    return null;
  }
  const host = resolveKsefVerificationHost(input.environment);
  const hash = await sha256Base64Url(input.xmlText);
  return `https://${host}/invoice/${nip}/${issueDate}/${hash}`;
}
