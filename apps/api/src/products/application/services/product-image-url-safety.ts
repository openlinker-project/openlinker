/**
 * Which hosts the product-image proxy may reach (#3415 review)
 *
 * This is deliberately NOT `isUrlSsrfSafe`
 * (`libs/integrations/woocommerce/.../woocommerce-url-safety.ts`), and the
 * difference is the whole point of the file rather than an oversight.
 *
 * That predicate refuses `10.0.0.0/8`, `172.16.0.0/12` and `192.168.0.0/16`,
 * which is right for a url an operator TYPES INTO A CONFIG FORM: a public
 * WooCommerce store has no business living on a private address, so refusing
 * one costs nothing and closes the whole class.
 *
 * The image proxy exists for the opposite case. Its own module docblock
 * records what it was built for - `http://prestashop/img/...` and
 * `http://host.docker.internal:5056/...`, measured on 71 of 71 products with
 * images on the demo database - so a private-range deny here would not harden
 * the feature, it would switch it off on every Docker-compose install
 * including the bundled demo. "Reaching an internal host" is not the threat.
 * It is the requirement.
 *
 * ## What the threat actually is
 *
 * The urls are NOT uniformly operator-authored. The WooCommerce product
 * mapper takes `i.src` verbatim from the shop's own response and the Allegro
 * one does the same, so a hostile or compromised shop can write anything it
 * likes into OpenLinker's catalogue and this proxy will fetch it from inside
 * the backend's network. The concrete target is the cloud instance-metadata
 * service - `169.254.169.254` on AWS, GCP and Azure alike - which answers
 * credentials to anything that can reach it and is reachable from inside
 * exactly the networks this proxy runs in.
 *
 * So the rule is narrow and it names its own target: link-local and the
 * metadata hostnames are refused, every other private range is allowed -
 * including loopback (`127.0.0.0/8`, `::1`), which a real
 * `network_mode: host` deployment can legitimately have as the shop's own
 * address - and the containment that does the heavy lifting remains the one
 * the service already had - the caller names an INDEX and never a url, so the
 * reachable set is bounded by what the operator's own catalogue sync wrote.
 * What bounds loopback specifically is the content-type gate one layer up
 * (`product-image-proxy.service.ts`): every failure answers a uniform 404, so
 * probing an internal port through this route costs an attacker nothing but
 * response timing.
 *
 * ## Numeric encodings are canonicalised BEFORE the range test
 *
 * `http://0xa9fea9fe/` and `http://2852039166/` are both the metadata
 * address. Node's WHATWG `URL` happens to normalise some of these today, and
 * a security check must not depend on that - so they are canonicalised here,
 * deterministically, the same reasoning #959 recorded for its own predicate.
 *
 * ## What this CANNOT stop
 *
 * DNS rebinding. A public name that resolves to the metadata address at fetch
 * time passes a hostname test by construction, because the name is not the
 * address. Closing that needs resolution-time pinning, which Node's `fetch`
 * does not expose. It is stated rather than implied closed.
 *
 * @module apps/api/src/products/application/services
 */
import { isIP } from 'net';

/**
 * Hostnames that ARE the metadata service, by name rather than by address.
 *
 * GCP answers on `metadata.google.internal` and Azure documents
 * `metadata.azure.com`; both resolve to the link-local address the range test
 * below refuses, but a shop can name either directly and a hostname never
 * reaches that test.
 */
const BLOCKED_HOSTNAMES: ReadonlySet<string> = new Set([
  'metadata.google.internal',
  'metadata.internal',
  'metadata.azure.com',
]);

/**
 * Turn an IPv4 literal written in any of the numeric forms into dotted-quad,
 * or `null` when the input is an ordinary DNS name.
 *
 * Covers the four encodings that are the documented bypass class: packed
 * decimal (`2852039166`), packed hex (`0xa9fea9fe`), and dotted forms with
 * octal (`0251.0376.0251.0376`) or hex (`0xa9.0xfe.0xa9.0xfe`) parts.
 */
function canonicaliseNumericIpv4(hostname: string): string | null {
  const host = hostname.toLowerCase();

  // One packed 32-bit value, decimal or hex.
  if (/^(0x[0-9a-f]+|\d+)$/.test(host)) {
    const value = host.startsWith('0x') ? Number.parseInt(host, 16) : Number.parseInt(host, 10);
    if (!Number.isFinite(value) || value < 0 || value > 0xffffffff) return null;
    return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].join(
      '.'
    );
  }

  // Dotted, with at least one octal or hex part. A plain dotted-quad falls
  // through to `isIP`, which already understands it.
  const segments = host.split('.');
  if (segments.length === 4 && segments.some((s) => /^0[0-9a-fx]/.test(s))) {
    const octets = segments.map((s) => {
      if (/^0x[0-9a-f]+$/.test(s)) return Number.parseInt(s, 16);
      if (/^0[0-7]+$/.test(s)) return Number.parseInt(s, 8);
      if (/^\d+$/.test(s)) return Number.parseInt(s, 10);
      return Number.NaN;
    });
    if (octets.every((o) => Number.isInteger(o) && o >= 0 && o <= 255)) return octets.join('.');
  }

  return null;
}

/**
 * Turn the two 16-bit hex pieces of an IPv4-mapped IPv6 tail into dotted-quad.
 *
 * `a9fe:a9fe` is `169.254.169.254`. Separate from `canonicaliseNumericIpv4`
 * because that one answers "is this hostname secretly an IPv4 literal" over a
 * whole host, while this decodes a tail already known to be the mapped half of
 * an IPv6 address.
 */
function hexPiecesToDottedQuad(tail: string): string {
  const [high, low] = tail.split(':').map((piece) => Number.parseInt(piece, 16));
  if (!Number.isInteger(high) || !Number.isInteger(low)) return tail;
  return [(high >>> 8) & 0xff, high & 0xff, (low >>> 8) & 0xff, low & 0xff].join('.');
}

/**
 * Whether a canonical address is one this proxy must never reach.
 *
 * Link-local ONLY, in both families, plus the unspecified address. Every
 * other private range is deliberately absent - see the module docblock.
 */
function isBlockedAddress(canonicalHost: string): boolean {
  const host = canonicalHost.toLowerCase();

  if (host.includes(':')) {
    // An IPv4-mapped IPv6 address re-expresses an IPv4 one, so it is
    // unwrapped and re-tested rather than waved through: `::ffff:169.254.169.254`
    // is the metadata address wearing a different spelling.
    //
    // BOTH tails are handled, and the second one is the one that matters:
    // WHATWG `URL` re-serialises the mapped part as hex pieces, so
    // `http://[::ffff:169.254.169.254]/` reaches this function as
    // `::ffff:a9fe:a9fe` and the dotted form is what a hand-written test
    // passes rather than what the code ever sees. Verified against Node
    // rather than assumed.
    if (host.startsWith('::ffff:')) {
      const tail = host.slice('::ffff:'.length);
      const dotted = /^[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(tail)
        ? hexPiecesToDottedQuad(tail)
        : tail;
      return isBlockedAddress(dotted);
    }
    // IPv6 link-local. Unique-local (fc00::/7) is NOT blocked, for the same
    // reason RFC1918 is not: that is where a container network lives.
    return host.startsWith('fe80') || host === '::';
  }

  const [a, b] = host.split('.').map(Number);
  return (
    // 169.254.0.0/16 - link-local, and the cloud metadata service with it.
    (a === 169 && b === 254) ||
    // 0.0.0.0/8 - "this network"; on Linux 0.0.0.0 reaches localhost.
    a === 0
  );
}

/**
 * Whether the proxy may fetch this url.
 *
 * Takes a `URL` rather than a string because every caller has already parsed
 * one, and re-parsing is where a check and the request it guards drift apart:
 * the value tested must be the value fetched.
 */
export function isProductImageUrlAllowed(target: URL): boolean {
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;

  // WHATWG `URL` brackets an IPv6 host; strip them before any address test.
  const raw = target.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (raw === '') return false;
  if (BLOCKED_HOSTNAMES.has(raw)) return false;

  const canonical = canonicaliseNumericIpv4(raw) ?? raw;

  // An ordinary DNS name reaches no address test, which is the stated
  // limitation: a name that resolves to a blocked address at fetch time
  // passes here by construction.
  if (isIP(canonical) === 0) return true;

  return !isBlockedAddress(canonical);
}
