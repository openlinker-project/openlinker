/**
 * PrestaShop Connection Config DTO
 *
 * Application-layer schema for the PrestaShop `Connection.config` blob.
 * Lives in the application layer (not `http/dto/`) because the schema is
 * the source of truth for `ConnectionService.create()` and `update()`'s
 * server-side re-validation pass — see #437 (update path) and #509 (create
 * path + this DTO). The HTTP controller hooks into the same shape but does
 * not own it. Swagger decorators are kept on the class so the DTO can be
 * referenced from a controller `@Body()` in the future without splitting
 * the schema in two.
 *
 * Mirrors the field list of `PrestashopConnectionConfig`
 * (libs/integrations/prestashop/src/domain/types/prestashop-config.types.ts).
 *
 * @module apps/api/src/integrations/application/dto
 * @see {@link AllegroConnectionConfigDto} for the sibling pattern this mirrors
 * @see {@link validatePrestashopConnectionConfig} for the validator wiring
 */
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ResponseFormat, ResponseFormatValues } from '@openlinker/integrations-prestashop';

/**
 * PrestaShop Connection Config DTO
 *
 * Validates every operator-supplied field on a PrestaShop connection's
 * `config` blob. Numeric fields are bounded both below (positive) and
 * above (sanity max — prevents typo-driven adapter outages).
 */
export class PrestashopConnectionConfigDto {
  @ApiProperty({
    description: 'Base URL of the PrestaShop WebService (required, must include protocol)',
    example: 'https://shop.example.com',
  })
  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_protocol: true, require_tld: false })
  baseUrl!: string;

  @ApiPropertyOptional({
    description:
      'Public storefront base URL used to build product-image URLs. Defaults ' +
      'to `baseUrl` if unset; provide only when the WS host differs from the ' +
      'storefront host.',
    example: 'https://shop.example.com',
  })
  @IsOptional()
  @IsString()
  @IsUrl({ require_protocol: true, require_tld: false })
  storefrontBaseUrl?: string;

  @ApiPropertyOptional({
    description: 'Shop ID for multi-store PrestaShop installations. Defaults to 1.',
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  shopId?: number;

  @ApiPropertyOptional({
    description:
      'Deprecated alias for `preferredLanguageId`. Kept for backward compatibility; ' +
      'prefer `preferredLanguageId` for new connections.',
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  langId?: number;

  @ApiPropertyOptional({
    description:
      'Preferred language ID for localized product fields. Defaults to 1.',
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  preferredLanguageId?: number;

  @ApiPropertyOptional({
    description:
      'Request timeout in milliseconds. Capped at 120000 (2 minutes) — past ' +
      'any plausible production value; a higher value is almost always a typo.',
    example: 30000,
    minimum: 1,
    maximum: 120000,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120000)
  timeoutMs?: number;

  @ApiPropertyOptional({
    description:
      'Page size for paginated WS requests. Capped at 1000 — PS WS itself ' +
      'caps lower in practice; this guards against typo-driven oversized pages.',
    example: 100,
    minimum: 1,
    maximum: 1000,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  pageSize?: number;

  @ApiPropertyOptional({
    description: 'Response format preference for WS reads.',
    enum: ResponseFormatValues as readonly string[],
  })
  @IsOptional()
  @IsIn(ResponseFormatValues as readonly string[])
  responseFormat?: ResponseFormat;

  @ApiPropertyOptional({
    description:
      'Default ISO 4217 currency code for products synced from this connection. ' +
      'Must be uppercase, exactly three letters (e.g. `PLN`, `EUR`).',
    example: 'PLN',
    pattern: '^[A-Z]{3}$',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/, {
    message: 'currency must be a 3-letter uppercase ISO 4217 code (e.g. PLN, EUR)',
  })
  currency?: string;

  @ApiPropertyOptional({
    description:
      'Default PrestaShop carrier ID applied to incoming orders when no per-method ' +
      'carrier mapping resolves. Must be a positive integer.',
    example: 2,
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  defaultCarrierId?: number;

  @ApiPropertyOptional({
    description:
      'Default PrestaShop customer-group ID assigned to OL-provisioned guest ' +
      'customers (#505). Must be a positive integer; defaults to 2 (PS stock ' +
      '"Guest" group) at provisioning time when unset.',
    example: 2,
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  guestCustomerGroupId?: number;

  @ApiPropertyOptional({
    description:
      'Additional PrestaShop payment-module names installed on this shop that ' +
      "aren't in the curated `PRESTASHOP_PAYMENT_MODULES` list. Each entry is a " +
      'module technical name.',
    type: [String],
    example: ['custom_payment_xyz'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  paymentModuleOverrides?: string[];

  @ApiPropertyOptional({
    description:
      'OL base URL from PrestaShop\'s perspective — used by the `openlinker` ' +
      'PS module to POST webhooks back to OL. Per-connection because dev ' +
      '(`host.docker.internal`), multi-network deploys, and reverse-proxy ' +
      'edge cases legitimately differ. The FE pre-fills this from ' +
      '`window.location.origin` on first connection-edit; operator can ' +
      'override. Required at install time (#168) — install endpoint returns ' +
      '400 when unset.',
    example: 'http://host.docker.internal:3000',
  })
  @IsOptional()
  @IsString()
  @IsUrl({ require_protocol: true, require_tld: false })
  openlinkerCallbackBaseUrl?: string;

  @ApiPropertyOptional({
    description:
      'Whether OL has successfully pushed webhook configuration (Base URL, ' +
      'Connection ID, Webhook Secret) to the PS `openlinker` module. Set by ' +
      '`POST /connections/:id/webhooks/install` on success; cleared by ' +
      'rotate-without-push failures. Operators do not set this manually.',
  })
  @IsOptional()
  @IsBoolean()
  webhooksConfigured?: boolean;
}
