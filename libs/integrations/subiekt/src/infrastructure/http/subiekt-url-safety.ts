/**
 * Subiekt URL Safety (SSRF predicate) (#753) — OWNS the predicate
 *
 * Decorator-free home of `isBridgeUrlSafe`. It lives in infrastructure/http so
 * the transport (`SubiektBridgeHttpClient`) can reuse it for the runtime
 * per-redirect guard WITHOUT pulling `class-validator` into the transport's
 * import graph. The config-time DTO constraint (`IsBridgeUrlSafeConstraint`)
 * wraps THIS same predicate — the DTO imports from here, never the reverse, and
 * the transport must never import from `application/dto`.
 *
 * POLICY (Subiekt-specific, differs from siblings):
 *   - REJECT the cloud-metadata (IMDS) surface only: `169.254.0.0/16` after
 *     numeric-encoding canonicalisation, plus the metadata hostnames
 *     (`metadata.google.internal`, `metadata.internal`, `metadata.azure.com`,
 *     case-insensitive).
 *   - REJECT non-string input, unparseable URLs, and non-`http(s)` protocols.
 *   - ALLOW loopback (`127.x`, `::1`, `localhost`) AND the private LAN ranges
 *     `10/8`, `172.16/12`, `192.168/16` — the canonical Subiekt bridge runs on
 *     a LAN box, so blocking these (as WooCommerce does) would reject the real
 *     deployment.
 *
 * This is STRICTER than PrestaShop (which does zero SSRF work) but NARROWER
 * than WooCommerce (which blocks all-private). The numeric-IPv4 canonicalisation
 * technique (hex / decimal-integer / octal / dotted-mixed / IPv4-mapped IPv6) is
 * PORTED from WooCommerce's internal `isUrlSsrfSafe` (`woocommerce-url-safety.ts`)
 * — copied, NOT imported, because that symbol is not barrel-exported and a
 * cross-package import would be a layering violation. Canonicalisation runs
 * BEFORE the range check so numeric IMDS encodings cannot bypass the block.
 *
 * DOCUMENTED LIMITATION — DNS rebinding: literal-hostname validation cannot stop
 * a public DNS name that resolves to an IMDS IP at request time. The transport's
 * per-redirect guard re-checks each 3xx `Location` host with this predicate,
 * closing the redirect-to-IMDS vector but not pure DNS rebinding.
 *
 * @module libs/integrations/subiekt/src/infrastructure/http
 */

import { isIP } from 'net';

/**
 * Canonicalise an IPv4 literal expressed in a non-dotted-quad encoding (hex
 * `0x...`, decimal integer, octal, mixed dotted octal/hex) to dotted-quad.
 * Returns `null` when the input is a real DNS hostname (not a numeric IPv4
 * literal) so the caller treats it as a hostname. PORTED from WooCommerce.
 */
function canonicalizeNumericIpv4(hostname: string): string | null {
  const h = hostname.toLowerCase();

  // Pure hex (0x...) or pure decimal integer — a 32-bit IPv4 packed into one part.
  if (/^(0x[0-9a-f]+|\d+)$/.test(h)) {
    const value = h.startsWith('0x') ? parseInt(h, 16) : parseInt(h, 10);
    if (!Number.isFinite(value) || value < 0 || value > 0xffffffff) return null;
    return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].join(
      '.',
    );
  }

  // Dotted form where one or more parts use octal (leading 0) or hex (0x) —
  // e.g. 0177.0.0.1 or 0x7f.0.0.1. Plain decimal dotted-quad is left to isIP().
  const segments = h.split('.');
  if (segments.length === 4 && segments.some((s) => /^0[0-9a-fx]/.test(s))) {
    const octets = segments.map((s) => {
      if (/^0x[0-9a-f]+$/.test(s)) return parseInt(s, 16);
      if (/^0[0-7]+$/.test(s)) return parseInt(s, 8);
      if (/^\d+$/.test(s)) return parseInt(s, 10);
      return Number.NaN;
    });
    if (octets.every((o) => Number.isInteger(o) && o >= 0 && o <= 255)) {
      return octets.join('.');
    }
  }

  return null;
}

/**
 * Subiekt-specific cloud-metadata hostnames to block (case-insensitive).
 */
const BLOCKED_METADATA_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.internal',
  'metadata.azure.com',
]);

/**
 * Is `canonicalHost` (a dotted-quad IPv4 or bracket-stripped IPv6) in the
 * link-local cloud-metadata (IMDS) range `169.254.0.0/16`? Private LAN and
 * loopback ranges are intentionally NOT blocked — the bridge runs on a LAN box.
 */
function isMetadataIp(canonicalHost: string): boolean {
  const h = canonicalHost.toLowerCase();
  if (h.includes(':')) {
    // IPv4-mapped IPv6 (::ffff:169.254.x) — strip the mapped suffix and re-check.
    if (h.startsWith('::ffff:')) {
      const mapped = h.slice('::ffff:'.length);
      // Node's URL parser normalises the dotted mapped form
      // (::ffff:169.254.169.254) to two hex hextets (::ffff:a9fe:a9fe), which
      // neither isIP nor canonicalizeNumericIpv4 can decode — so decode the
      // hextets to dotted-quad here, else the mapped IMDS form bypasses the guard.
      const hextets = mapped.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
      if (hextets) {
        const hi = parseInt(hextets[1], 16);
        const lo = parseInt(hextets[2], 16);
        const dotted = [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff].join('.');
        return isMetadataIp(dotted);
      }
      // Dotted mapped form (::ffff:169.254.169.254) in case the parser ever
      // emits it un-normalised.
      const canonical = canonicalizeNumericIpv4(mapped) ?? mapped;
      return isIP(canonical) !== 0 ? isMetadataIp(canonical) : false;
    }
    // IPv6 link-local fe80::/10 carries no IMDS surface for the bridge; allow.
    return false;
  }
  const [a, b] = h.split('.').map(Number);
  return a === 169 && b === 254;
}

/**
 * SSRF host-safety predicate for the Subiekt bridge URL. Returns `true` when the
 * host is safe to reach under the policy above, `false` for the IMDS surface,
 * non-`http(s)` protocols, and unparseable / non-string input.
 */
export function isBridgeUrlSafe(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  const hostname = parsed.hostname;
  const rawHost =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;

  // Canonicalise any numeric / octal / hex IPv4 literal to dotted-quad BEFORE
  // the IMDS range check so bypass encodings cannot dodge it.
  const canonical = canonicalizeNumericIpv4(rawHost) ?? rawHost;

  if (isIP(canonical) !== 0) {
    return !isMetadataIp(canonical);
  }

  // DNS hostname — block known cloud-metadata names.
  return !BLOCKED_METADATA_HOSTNAMES.has(canonical.toLowerCase());
}
