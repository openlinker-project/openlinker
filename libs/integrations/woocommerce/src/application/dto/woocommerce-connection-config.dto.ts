/**
 * WooCommerce Connection Config DTO
 *
 * Application-layer class-validator schema for the WooCommerce
 * `Connection.config` blob. Plugin-private — only
 * `WooCommerceConnectionConfigShapeValidatorAdapter` (registered with the host
 * at boot) reaches into it; the API-layer `ConnectionService` invokes the
 * validator via the registry and never touches this DTO directly.
 *
 * `require_protocol: true` is intentional: without it, class-validator's
 * `@IsUrl` accepts protocol-less input like "myshop.com" that
 * `WooCommerceHttpClient` cannot fetch. `require_tld: false` allows
 * localhost and .internal hostnames for local development.
 *
 * @module libs/integrations/woocommerce/src/application/dto
 */
import { isIP } from 'net';
import type { ValidatorConstraintInterface } from 'class-validator';
import { IsUrl, IsOptional, ValidateNested, Validate, ValidatorConstraint } from 'class-validator';
import { Type } from 'class-transformer';
import { WooCommerceOrdersConfigDto } from './woocommerce-orders-config.dto';

/**
 * Returns true when the hostname resolves to a private, link-local, or
 * RFC-1918 address that must not be reached by outbound OL requests.
 *
 * Loopback is intentionally ALLOWED for local development:
 *   - 127.x  (IPv4 loopback)
 *   - localhost  (hostname — may resolve to 127.0.0.1 or ::1)
 *   - ::1  (IPv6 loopback)
 * All three forms let operators point OL at a WooCommerce container on
 * the same machine without a reverse proxy. In production these addresses
 * cannot be routed to from the public internet.
 *
 * Bypass patterns caught explicitly (verified via validator.js):
 *   - Hex notation  0xc0a80001  → @IsUrl accepts, isIP() returns 0 → caught here
 *   - IPv4-mapped   ::ffff:10.0.0.1 → @IsUrl accepts, simple IPv6 check misses → caught here
 */
function isPrivateOrLinkLocalIp(hostname: string): boolean {
  const h = hostname.toLowerCase();

  // Hex-encoded IPv4 (e.g. 0xc0a80001 = 192.168.0.1) — passes @IsUrl, bypasses isIP()
  if (/^0x[0-9a-f]+$/i.test(h)) return true;

  // IPv4-mapped IPv6 (::ffff:x.x.x.x or ::ffff:aaaa:bbbb after URL normalisation) —
  // block the entire ::ffff::/96 range; no legitimate WC store URL uses this form.
  if (h.startsWith('::ffff:')) return true;

  if (h.includes(':')) {
    // IPv6 unique-local (fc::/7) and link-local (fe80::/10) — ::1 allowed for local dev
    return h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80');
  }

  const parts = h.split('.').map(Number);
  const [a, b] = parts;
  return (
    a === 10 || // 10.0.0.0/8 private
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 private
    (a === 192 && b === 168) || // 192.168.0.0/16 private
    (a === 169 && b === 254) // 169.254.0.0/16 link-local (cloud metadata)
    // 127.x loopback intentionally omitted — allowed for local dev
  );
}

const BLOCKED_HOSTNAMES = new Set([
  'metadata.google.internal', // GCP IMDS
  'metadata.internal',        // GCP (alternate)
  'metadata.azure.com',       // Azure IMDS hostname
]);

@ValidatorConstraint({ name: 'isSsrfSafeUrl', async: false })
export class IsSsrfSafeUrlConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    try {
      const { hostname } = new URL(value);
      // WHATWG URL wraps IPv6 addresses in brackets (e.g. "[::1]") — strip them
      const rawHost =
        hostname.startsWith('[') && hostname.endsWith(']')
          ? hostname.slice(1, -1)
          : hostname;

      // Standard IP — check range directly
      if (isIP(rawHost) !== 0) {
        return !isPrivateOrLinkLocalIp(rawHost);
      }
      // Hex IP or IPv4-mapped IPv6 that isIP() returns 0 for
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

  @IsOptional()
  @ValidateNested()
  @Type(() => WooCommerceOrdersConfigDto)
  orders?: WooCommerceOrdersConfigDto;
}
