/**
 * PrestaShop Connection Config DTO
 *
 * Application-layer schema for the PrestaShop `Connection.config` blob.
 * Owned by the PrestaShop plugin package post-#587 — the shape is
 * plugin-private and only `PrestashopConnectionConfigShapeValidatorAdapter`
 * (registered with the host at boot via `host.connectionConfigShapeValidatorRegistry`)
 * reaches into it. The API-layer `ConnectionService` invokes the adapter
 * via the registry; it never touches this DTO directly.
 *
 * Mirrors the field list of `PrestashopConnectionConfig`
 * (sibling `domain/types/prestashop-config.types.ts`).
 *
 * @module libs/integrations/prestashop/src/application/dto
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
// Sibling type in same package — relative path. The barrel re-exports
// these, but reaching for the self-package alias from inside the package
// itself creates a cycle through the compiled `dist/`.
import { ResponseFormat, ResponseFormatValues } from '../../domain/types/prestashop-config.types';

/**
 * PrestaShop Connection Config DTO
 *
 * Validates every operator-supplied field on a PrestaShop connection's
 * `config` blob. Numeric fields are bounded both below (positive) and
 * above (sanity max — prevents typo-driven adapter outages).
 */
export class PrestashopConnectionConfigDto {
  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_protocol: true, require_tld: false })
  baseUrl!: string;
  @IsOptional()
  @IsString()
  @IsUrl({ require_protocol: true, require_tld: false })
  storefrontBaseUrl?: string;
  @IsOptional()
  @IsInt()
  @Min(1)
  shopId?: number;
  @IsOptional()
  @IsInt()
  @Min(1)
  langId?: number;
  @IsOptional()
  @IsInt()
  @Min(1)
  preferredLanguageId?: number;
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120000)
  timeoutMs?: number;
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  pageSize?: number;
  @IsOptional()
  @IsIn(ResponseFormatValues as readonly string[])
  responseFormat?: ResponseFormat;
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/, {
    message: 'currency must be a 3-letter uppercase ISO 4217 code (e.g. PLN, EUR)',
  })
  currency?: string;
  @IsOptional()
  @IsInt()
  @Min(1)
  defaultCarrierId?: number;
  @IsOptional()
  @IsInt()
  @Min(1)
  guestCustomerGroupId?: number;
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  paymentModuleOverrides?: string[];
  @IsOptional()
  @IsString()
  @IsUrl({ require_protocol: true, require_tld: false })
  openlinkerCallbackBaseUrl?: string;
  @IsOptional()
  @IsBoolean()
  webhooksConfigured?: boolean;
}
