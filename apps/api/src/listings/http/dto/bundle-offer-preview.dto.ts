/**
 * Bundle Offer Preview DTOs
 *
 * Request/response shapes for `POST /listings/connections/:connectionId/
 * bundle-offer-preview` (#3520): how each bundle variant would be published as a
 * product-set offer, before the operator submits the bulk wizard.
 *
 * @module apps/api/src/listings/http/dto
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import type { BundleOfferPreviewEntry } from '@openlinker/core/listings';

export const BUNDLE_OFFER_PREVIEW_ITEMS_MAX = 100;

export class BundleOfferPreviewItemDto {
  @ApiProperty({ description: 'Internal product-variant ID of the bundle; echoed back on its entry.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  variantId!: string;

  @ApiPropertyOptional({
    description:
      'Category currently chosen for the offer. Lets the destination look up component cards ' +
      'by barcode within it; omit when none is set.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  categoryId?: string;
}

export class BundleOfferPreviewRequestDto {
  @ApiProperty({
    description: `Bundle variants to preview (max ${BUNDLE_OFFER_PREVIEW_ITEMS_MAX}).`,
    type: [BundleOfferPreviewItemDto],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'items must contain at least one entry' })
  @ArrayMaxSize(BUNDLE_OFFER_PREVIEW_ITEMS_MAX, {
    message: `items may contain at most ${BUNDLE_OFFER_PREVIEW_ITEMS_MAX} entries per request`,
  })
  @ValidateNested({ each: true })
  @Type(() => BundleOfferPreviewItemDto)
  items!: BundleOfferPreviewItemDto[];
}

export class BundleOfferPreviewResponseDto {
  @ApiProperty({
    description:
      "Per-variant preview, in input order. `status: 'ok'` carries `components` (each with its " +
      '`mode` own-offer | catalog-card | new-product | missing, `problems`, optional ' +
      '`externalOfferId` and `cardCategoryId`), `suggestedCategoryId` (category of the first ' +
      "component's card), `availableSets` and `limitingComponentVariantId`; `status: " +
      "'not-a-bundle'` for an ordinary variant; `status: 'failed'` carries `reason`.",
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  entries!: BundleOfferPreviewEntryView[];
}

type WithVariantId<T> = T extends { internalVariantId: string }
  ? Omit<T, 'internalVariantId'> & { variantId: string }
  : never;
export type BundleOfferPreviewEntryView = WithVariantId<BundleOfferPreviewEntry>;
