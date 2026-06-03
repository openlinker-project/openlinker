/**
 * WooCommerce Connection Config DTO
 *
 * Application-layer class-validator schema for the WooCommerce
 * `Connection.config` blob. Plugin-private — only
 * `WooCommerceConnectionConfigShapeValidatorAdapter` (registered with the host
 * at boot) reaches into it; the API-layer `ConnectionService` invokes the
 * validator via the registry and never touches this DTO directly.
 *
 * HTTPS is required — WC REST transmits consumerKey:consumerSecret as
 * Basic Auth on every request; http:// would send credentials in cleartext.
 * HTTPS is required even on loopback; a self-signed certificate is fine for
 * local development. Loopback addresses (127.x, ::1, localhost) are exempt
 * from the SSRF block but must still use https://.
 *
 * @module libs/integrations/woocommerce/src/application/dto
 */
import { isIP } from 'net';
import type { ValidatorConstraintInterface } from 'class-validator';
import { IsUrl, Validate, ValidatorConstraint } from 'class-validator';

/**
 * Returns true when the hostname resolves to a private, link-local, or
 * RFC-1918 address that must not be reached by outbound OL requests.
 *
 * Loopback is intentionally ALLOWED for local development:
 *   - 127.x  (IPv4 loopback)
 *   - localhost  (hostname)
 *   - ::1  (IPv6 loopback)
 *
 * Bypass patterns caught explicitly (verified via validator.js):
 *   - Hex notation  0xc0a80001  → @IsUrl accepts, isIP() returns 0 → caught here
 *   - IPv4-mapped   ::ffff:10.0.0.1 → @IsUrl accepts, simple IPv6 check misses → caught here
 */
function isPrivateOrLinkLocalIp(hostname: string): boolean {
  const h = hostname.toLowerCase();

  if (/^0x[0-9a-f]+$/i.test(h)) return true;

  // IPv4-mapped IPv6 — block entire ::ffff::/96 range
  if (h.startsWith('::ffff:')) return true;

  if (h.includes(':')) {
    return h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80');
  }

  const parts = h.split('.').map(Number);
  const [a, b] = parts;
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
    // 127.x intentionally omitted — allowed for local dev
  );
}

const BLOCKED_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.internal',
  'metadata.azure.com',
]);

@ValidatorConstraint({ name: 'isSsrfSafeUrl', async: false })
export class IsSsrfSafeUrlConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    try {
      const { hostname } = new URL(value);
      const rawHost =
        hostname.startsWith('[') && hostname.endsWith(']')
          ? hostname.slice(1, -1)
          : hostname;

      if (isIP(rawHost) !== 0) {
        return !isPrivateOrLinkLocalIp(rawHost);
      }
      if (/^0x[0-9a-f]+$/i.test(rawHost) || rawHost.toLowerCase().startsWith('::ffff:')) {
        return !isPrivateOrLinkLocalIp(rawHost);
      }
      return !BLOCKED_HOSTNAMES.has(rawHost.toLowerCase());
    } catch {
      return false;
    }
  }

  defaultMessage(): string {
    return 'siteUrl must not point to a private or internal network address';
  }
}

export class WooCommerceConnectionConfigDto {
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['https'] })
  @Validate(IsSsrfSafeUrlConstraint)
  siteUrl!: string;
}
