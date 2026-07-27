/**
 * Bulk Offer Create DTOs (#736)
 *
 * Request DTO for `POST /listings/bulk-create`. The controller maps this
 * validated shape into `BulkListingSubmitInput` and stamps
 * `initiatedBy` from the authenticated session before handing off to the
 * core service.
 *
 * The shared / per-product config is split into two narrow types so the
 * wizard's review-table edit modal (#740) can emit one row at a time and
 * the validator rejects malformed overrides at the boundary.
 *
 * @module apps/api/src/listings/http/dto
 */
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';

import {
  CreateOfferOverridesDto,
  CreateOfferPriceDto,
} from './create-offer.dto';
import { ValidateRecordValues } from './validate-record-values.decorator';

import { OfferDescriptionToneValues } from '@openlinker/core/sync';

export class BulkSharedConfigDto {
  @ApiProperty({
    description: 'Offered stock quantity applied to every product in the batch.',
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  stock!: number;

  @ApiProperty({
    description: 'Publish-immediately flag applied to every product (false = create as draft).',
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

  @ApiPropertyOptional({
    description: 'Generate offer descriptions with AI for every product in the batch.',
  })
  @IsOptional()
  @IsBoolean()
  generateDescription?: boolean;

  @ApiPropertyOptional({
    description: 'AI description tone hint forwarded to the worker handler (#737).',
    enum: OfferDescriptionToneValues,
  })
  @IsOptional()
  @IsIn(OfferDescriptionToneValues as readonly string[])
  descriptionTone?: (typeof OfferDescriptionToneValues)[number];
}

/**
 * Category-omitted offer-overrides shape (#1741). `categoryId` is
 * grouping-determining and product-level (base-only via `sharedConfig`), so it
 * is not overridable per-product / per-variant - `OmitType` drops it while
 * carrying every other nested validation rule (title MaxLength, imageUrls
 * IsUrl, price positivity, ean digit-shape, platformParams size cap, parameters
 * bounds).
 */
export class OverridesNoCategoryDto extends OmitType(CreateOfferOverridesDto, [
  'categoryId',
] as const) {}

/**
 * Per-product / per-variant override value (#1741). Same shape as the batch
 * shared config's overrides minus `categoryId`. Used as the nested value type
 * validated by `@ValidateRecordValues` on BOTH override maps below.
 */
export class PerVariantOverrideDto {
  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  publishImmediately?: boolean;

  @ApiPropertyOptional({ type: CreateOfferPriceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateOfferPriceDto)
  price?: CreateOfferPriceDto;

  @ApiPropertyOptional({ type: OverridesNoCategoryDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => OverridesNoCategoryDto)
  overrides?: OverridesNoCategoryDto;
}

export class BulkOfferCreateRequestDto {
  @ApiProperty({
    description: 'Target marketplace connection id.',
    format: 'uuid',
  })
  @IsUUID()
  connectionId!: string;

  @ApiProperty({
    description: 'OL internal variant ids to bulk-list (1..100).',
    type: [String],
    minItems: 1,
    maxItems: 100,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  productIds!: string[];

  @ApiProperty({ type: BulkSharedConfigDto })
  @ValidateNested()
  @Type(() => BulkSharedConfigDto)
  sharedConfig!: BulkSharedConfigDto;

  /**
   * Per-product (family) overrides keyed by `productIds[i]`. Each value is the
   * narrow `PerVariantOverrideDto` shape; class-validator does not recurse into
   * `Record<>` values, so `@ValidateRecordValues` validates each one (title
   * MaxLength, imageUrls IsUrl, price positivity, ean digit-shape, …). Key-shape
   * (`ol_variant_{hex}`), currency divergence, and effective-identifier
   * enforcement are applied in `BulkListingSubmitService` at submit (#1741).
   */
  @ApiPropertyOptional({
    description:
      'Optional per-product overrides keyed by productId. Unknown keys are ignored.',
    additionalProperties: { $ref: '#/components/schemas/PerVariantOverrideDto' },
  })
  @IsOptional()
  @IsObject()
  @ValidateRecordValues(() => PerVariantOverrideDto)
  perProductOverrides?: Record<string, PerVariantOverrideDto>;

  /**
   * Per-variant overrides keyed by the actual variant id (#1741). Same narrow
   * `PerVariantOverrideDto` shape; wins over `perProductOverrides` per field in
   * the service. Value-level validation via `@ValidateRecordValues`; key-shape /
   * currency / GS1 / uniqueness enforcement is in `BulkListingSubmitService`.
   */
  @ApiPropertyOptional({
    description: 'Optional per-variant overrides keyed by variant id. Unknown keys ignored.',
    additionalProperties: { $ref: '#/components/schemas/PerVariantOverrideDto' },
  })
  @IsOptional()
  @IsObject()
  @ValidateRecordValues(() => PerVariantOverrideDto)
  perVariantOverrides?: Record<string, PerVariantOverrideDto>;

  /**
   * Variant ids to exclude from the fan-out (#1741). Capped generously above
   * the expanded-offer ceiling; the service enforces the hard ceiling.
   */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  excludedVariantIds?: string[];
}
