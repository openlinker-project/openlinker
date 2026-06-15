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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  CreateOfferOverridesDto,
  CreateOfferPriceDto,
} from './create-offer.dto';

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

export class PerProductOverrideDto {
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

  @ApiPropertyOptional({ type: CreateOfferOverridesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateOfferOverridesDto)
  overrides?: CreateOfferOverridesDto;
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
   * Per-product overrides keyed by `productIds[i]`. Each value is the
   * narrow `PerProductOverrideDto` shape; class-validator does not
   * support nested validation of `Record<>` values, so we accept any
   * object here and the service treats unknown keys as a no-op. The
   * wizard already lints rows on the client.
   */
  @ApiPropertyOptional({
    description:
      'Optional per-product overrides keyed by productId. Unknown keys are ignored.',
    additionalProperties: { $ref: '#/components/schemas/PerProductOverrideDto' },
  })
  @IsOptional()
  @IsObject()
  perProductOverrides?: Record<string, PerProductOverrideDto>;
}
