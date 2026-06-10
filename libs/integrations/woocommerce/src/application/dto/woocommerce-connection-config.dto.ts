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
 * HTTPS-only (`protocols: ['https']`) is the agreed stance: WooCommerce REST
 * uses Basic Auth (consumer key/secret), which is cleartext over http — so an
 * http store URL would leak credentials on the wire.
 *
 * `IsSsrfSafeUrlConstraint` is the CANONICAL SSRF guard for the OpenLinker
 * plugin fleet — other platform connection-config DTOs copy it verbatim. It is
 * the strongest config-time guard available: it rejects literal hostnames that
 * resolve to private / loopback / link-local ranges across every encoding an
 * attacker can express an IPv4 literal in (dotted-quad, hex, decimal-integer,
 * octal, IPv4-mapped IPv6). Any change here must keep the bypass-class coverage
 * intact and stay in sync with the copies.
 *
 * DOCUMENTED LIMITATION — DNS rebinding: config-time literal-hostname
 * validation CANNOT stop a public DNS name (e.g. `evil.example.com`) that
 * resolves to a private IP at request time. That is fundamentally a runtime
 * concern handled by the http-client's redirect/connect guard (#969), not by
 * this DTO. This guard only blocks IP-literal SSRF expressed directly in the
 * configured URL.
 *
 * @module libs/integrations/woocommerce/src/application/dto
 */
import { isIP } from 'net';
import type { ValidatorConstraintInterface } from 'class-validator';
import { IsUrl, IsOptional, ValidateNested, Validate, ValidatorConstraint } from 'class-validator';
import { Type } from 'class-transformer';
import { WooCommerceOrdersConfigDto } from './woocommerce-orders-config.dto';

/**
 * Returns true when a canonical dotted-quad IPv4 / bracket-stripped IPv6
 * hostname falls in a private, loopback-adjacent, or link-local range that
 * must not be reached by outbound OL requests.
 *
 * Loopback is intentionally ALLOWED for local development:
 *   - 127.x  (IPv4 loopback)
 *   - localhost  (hostname — may resolve to 127.0.0.1 or ::1)
 *   - ::1  (IPv6 loopback)
 * All three forms let operators point OL at a WooCommerce container on
 * the same machine without a reverse proxy. In production these addresses
 * cannot be routed to from the public internet.
 */
function isPrivateOrLinkLocalIp(canonicalHost: string): boolean {
  const h = canonicalHost.toLowerCase();

  if (h.includes(':')) {
    // IPv4-mapped IPv6 (::ffff:x.x.x.x) — block the whole ::ffff:/96 range;
    // no legitimate WC store URL uses this form.
    if (h.startsWith('::ffff:')) return true;
    // IPv6 unique-local (fc00::/7 → fc/fd) and link-local (fe80::/10).
    // ::1 (loopback) intentionally allowed for local dev.
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

/**
 * Canonicalises an IPv4 literal expressed in any non-dotted-quad encoding
 * (hex `0x7f000001`, decimal-integer `2130706433`, octal `0177.0.0.1`, or
 * mixed octal/hex parts) to its dotted-quad form. Returns `null` when the
 * input is not an all-numeric / octal / hex IPv4 literal — i.e. it is a real
 * DNS hostname and the caller should treat it as such.
 *
 * These encodings are the SSRF bypass classes (#959): `@IsUrl` accepts them
 * and modern WHATWG `URL` happens to normalise them, but we MUST NOT rely on
 * runtime/Node-version URL behaviour for a security check — so we canonicalise
 * (or reject) them deterministically here, before the private-range test.
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
      // WHATWG URL wraps IPv6 addresses in brackets (e.g. "[::1]") — strip them.
      const rawHost =
        hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;

      // Canonicalise any numeric / octal / hex IPv4 literal to dotted-quad
      // BEFORE the range check, so bypass encodings can't dodge it regardless
      // of how the URL parser happened to normalise (or not normalise) them.
      const canonical = canonicalizeNumericIpv4(rawHost) ?? rawHost;

      // Recognised IP literal (after canonicalisation) — range-check it.
      if (isIP(canonical) !== 0) {
        return !isPrivateOrLinkLocalIp(canonical);
      }

      // Not an IP literal — a DNS hostname. Block known cloud-metadata names.
      // (DNS rebinding to a private IP is a runtime concern — see file header.)
      return !BLOCKED_HOSTNAMES.has(canonical.toLowerCase());
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
