/**
 * Create Offer DTOs
 *
 * Request DTOs for `POST /listings/connections/:connectionId/offers`. Shape
 * mirrors `CreateOfferCommand` from `@openlinker/core/integrations`; the
 * controller maps the validated DTO into the job payload
 * (`MarketplaceOfferCreatePayloadV1`).
 *
 * @module apps/api/src/listings/http/dto
 */
import type { ValidatorConstraintInterface, ValidationArguments } from 'class-validator';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  Min,
  Validate,
  ValidateIf,
  ValidateNested,
  ValidatorConstraint,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Reject `platformParams` payloads whose JSON-serialised size exceeds 4 KB.
 *
 * The field is a `Record<string, unknown>` escape hatch (#254) for adapter-
 * specific IDs — a handful of short strings in practice. A soft upper bound
 * keeps a misbehaving client from pushing multi-MB objects into the Redis
 * Streams job payload. Operational hygiene, not a security boundary.
 */
@ValidatorConstraint({ name: 'platformParamsSize', async: false })
class PlatformParamsSizeValidator implements ValidatorConstraintInterface {
  private static readonly MAX_BYTES = 4096;

  validate(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value !== 'object') return false;
    try {
      return (
        Buffer.byteLength(JSON.stringify(value), 'utf8') <= PlatformParamsSizeValidator.MAX_BYTES
      );
    } catch {
      return false;
    }
  }

  defaultMessage(_args: ValidationArguments): string {
    return `platformParams exceeds ${PlatformParamsSizeValidator.MAX_BYTES}-byte size limit`;
  }
}

export class CreateOfferPriceDto {
  @ApiProperty({ example: 99.99 })
  @IsNumber()
  @IsPositive()
  amount!: number;

  @ApiProperty({ example: 'PLN' })
  @IsString()
  @IsNotEmpty()
  currency!: string;
}

/** Numeric-range value for integer/float range parameters (Allegro from–to). */
export class OfferParameterRangeDto {
  @ApiProperty({ example: '1.0' })
  @IsString()
  @MaxLength(64)
  from!: string;

  @ApiProperty({ example: '5.0' })
  @IsString()
  @MaxLength(64)
  to!: string;
}

/**
 * One neutral, section-tagged offer/category parameter (#1071). Replaces the
 * Allegro-shaped `platformParams.parameters`/`productParameters` arrays; the
 * destination adapter splits these by `section` and shapes them to wire.
 */
export class OfferParameterDto {
  @ApiProperty({ description: 'Destination parameter id (or pass-through name).' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  id!: string;

  @ApiPropertyOptional({ isArray: true, type: String })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(256, { each: true })
  values?: string[];

  @ApiPropertyOptional({ isArray: true, type: String })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  valuesIds?: string[];

  @ApiPropertyOptional({ type: OfferParameterRangeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => OfferParameterRangeDto)
  rangeValue?: OfferParameterRangeDto;

  @ApiProperty({ enum: ['offer', 'product'] })
  @IsIn(['offer', 'product'])
  section!: 'offer' | 'product';
}

export class CreateOfferOverridesDto {
  @ApiPropertyOptional({
    description: 'Offer title (overrides variant name). Capped at 75 chars (Allegro limit).',
    maxLength: 75,
  })
  @IsOptional()
  @IsString()
  @MaxLength(75)
  title?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Offer description. `null` means "no override" (same as omitting).',
  })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({ description: 'Platform-specific category id' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({
    description:
      'Platform-specific catalogue product-card id resolved from the variant barcode (#808). When present, smart-linking adapters link the existing card and inherit its required product parameters instead of creating a product inline.',
  })
  @IsOptional()
  @IsString()
  productCardId?: string;

  @ApiPropertyOptional({
    description:
      'Per-offer EAN/GTIN override (#1741). Falls back to the variant barcode. Must be a valid GTIN length (8/12/13/14 digits) at the boundary; GS1 checksum + batch-wide uniqueness are enforced in BulkListingSubmitService.',
  })
  @IsOptional()
  @IsString()
  // Only true GTIN lengths (EAN-8, UPC-A, EAN-13, GTIN-14). 9/10/11-digit
  // values are not valid GTINs and would otherwise skip the BE checksum gate
  // (which only checksums GTIN lengths) and fail at marketplace create-time as
  // an opaque business_failure instead of a clean 400 (#1741 review #4).
  @Matches(/^(\d{8}|\d{12,14})$/, { message: 'ean must be 8, 12, 13, or 14 digits' })
  ean?: string;

  @ApiPropertyOptional({
    nullable: true,
    isArray: true,
    type: String,
    description:
      'Image URLs in display order. `null` means "no override". Each entry must be a valid URL.',
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsArray()
  @IsUrl({}, { each: true, message: 'imageUrls must be an array of valid URLs' })
  imageUrls?: string[] | null;

  @ApiPropertyOptional({
    description:
      'Platform-specific policy / shipping / tax params the adapter reads directly. Escape hatch — keep small (≤4 KB serialised).',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  @Validate(PlatformParamsSizeValidator)
  platformParams?: Record<string, unknown>;

  @ApiPropertyOptional({
    type: [OfferParameterDto],
    description:
      'Operator-picked neutral category parameters (#1071). Section-tagged; the adapter shapes them to platform wire. Replaces the legacy platformParams.parameters/productParameters arrays.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => OfferParameterDto)
  parameters?: OfferParameterDto[];
}

export class CreateOfferDto {
  @ApiProperty({
    description: 'OpenLinker internal variant id (format: ol_variant_{hex})',
    example: 'ol_variant_a1b2c3d4e5f6',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^ol_variant_[a-f0-9]+$/, {
    message: 'internalVariantId must be an OpenLinker internal variant id (ol_variant_{hex})',
  })
  internalVariantId!: string;

  @ApiProperty({ example: 10, minimum: 0 })
  @IsInt()
  @Min(0)
  stock!: number;

  @ApiProperty({
    description: 'Publish immediately after creation (false = create as draft)',
    example: false,
  })
  @IsBoolean()
  publishImmediately!: boolean;

  @ApiPropertyOptional({ type: CreateOfferPriceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateOfferPriceDto)
  price?: CreateOfferPriceDto;

  @ApiPropertyOptional({ type: CreateOfferOverridesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateOfferOverridesDto)
  overrides?: CreateOfferOverridesDto;
}
