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
 * `IsSsrfSafeUrlConstraint` wraps the canonical SSRF host-safety predicate
 * `isUrlSsrfSafe` (kept decorator-free in
 * `infrastructure/http/woocommerce-url-safety.ts` so the transport's runtime
 * redirect guard can reuse it without pulling class-validator into the
 * transport import graph). The predicate rejects literal hostnames that
 * resolve to private / loopback / link-local ranges across every encoding an
 * attacker can express an IPv4 literal in (dotted-quad, hex, decimal-integer,
 * octal, IPv4-mapped IPv6). Any change to the bypass-class coverage lives in
 * that util and stays in sync for both the config-time and runtime checks.
 *
 * DOCUMENTED LIMITATION — DNS rebinding: config-time literal-hostname
 * validation CANNOT stop a public DNS name (e.g. `evil.example.com`) that
 * resolves to a private IP at request time. That is a runtime concern handled
 * by the http-client's redirect guard, not by this DTO. This guard only blocks
 * IP-literal SSRF expressed directly in the configured URL.
 *
 * @module libs/integrations/woocommerce/src/application/dto
 */
import type { ValidatorConstraintInterface } from 'class-validator';
import { IsUrl, Validate, ValidatorConstraint } from 'class-validator';
import { isUrlSsrfSafe } from '../../infrastructure/http/woocommerce-url-safety';

// Re-exported so consumers that previously imported the predicate from the DTO
// module keep working, and so the SSRF surface has a single named entry point.
export { isUrlSsrfSafe };

@ValidatorConstraint({ name: 'isSsrfSafeUrl', async: false })
export class IsSsrfSafeUrlConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isUrlSsrfSafe(value);
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
