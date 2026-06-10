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
 * `IsSsrfSafeUrlConstraint` wraps the canonical SSRF host-safety predicate
 * `isUrlSsrfSafe` (kept decorator-free in
 * `infrastructure/http/woocommerce-url-safety.ts` so the transport's runtime
 * redirect guard, #969, can reuse it without pulling class-validator into the
 * transport import graph). The predicate rejects literal hostnames that
 * resolve to private / loopback / link-local ranges across every encoding an
 * attacker can express an IPv4 literal in (dotted-quad, hex, decimal-integer,
 * octal, IPv4-mapped IPv6). Any change to the bypass-class coverage lives in
 * that util and stays in sync for both the config-time and runtime checks.
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
import type { ValidatorConstraintInterface } from 'class-validator';
import { IsUrl, IsOptional, ValidateNested, Validate, ValidatorConstraint } from 'class-validator';
import { Type } from 'class-transformer';
import { isUrlSsrfSafe } from '../../infrastructure/http/woocommerce-url-safety';
import { WooCommerceOrdersConfigDto } from './woocommerce-orders-config.dto';

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

  @IsOptional()
  @ValidateNested()
  @Type(() => WooCommerceOrdersConfigDto)
  orders?: WooCommerceOrdersConfigDto;
}
