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
import { IsUrl } from 'class-validator';

export class WooCommerceConnectionConfigDto {
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] })
  siteUrl!: string;
}
