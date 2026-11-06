/**
 * Attribute Projection Preview DTOs
 *
 * Request/response shapes for `POST /listings/connections/:connectionId/
 * attribute-projection/preview` (#3995): what the operator's attribute mappings
 * and rules will fill for each variant of an offer batch, before publishing.
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

import type { AttributeProjectionPreviewEntry } from '@openlinker/core/listings';

/** Mirrors the category resolve batch - one wizard page fits in one call. */
export const ATTRIBUTE_PROJECTION_PREVIEW_ITEMS_MAX = 200;

export class AttributeProjectionPreviewItemDto {
  @ApiProperty({ description: 'Internal product-variant ID; echoed back on its entry.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  variantId!: string;

  @ApiProperty({
    description:
      'Destination category the offer will be created in. Rules can be scoped to a ' +
      'category, so the preview must be requested again when it changes.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  categoryId!: string;

  @ApiPropertyOptional({
    description: "The operator's per-offer EAN override, when set. Feeds `place-value` rules.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  ean?: string;
}

export class AttributeProjectionPreviewRequestDto {
  @ApiProperty({
    description: `Variants to preview (max ${ATTRIBUTE_PROJECTION_PREVIEW_ITEMS_MAX}).`,
    type: [AttributeProjectionPreviewItemDto],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'items must contain at least one entry' })
  @ArrayMaxSize(ATTRIBUTE_PROJECTION_PREVIEW_ITEMS_MAX, {
    message: `items may contain at most ${ATTRIBUTE_PROJECTION_PREVIEW_ITEMS_MAX} entries per request`,
  })
  @ValidateNested({ each: true })
  @Type(() => AttributeProjectionPreviewItemDto)
  items!: AttributeProjectionPreviewItemDto[];
}

export class AttributeProjectionPreviewResponseDto {
  /**
   * One entry per input item, in input order. An entry is the discriminated
   * union `status: 'ok'` (parameters, unresolvedRequired, restrictionIssues,
   * origins) or `status: 'failed'` (reason). OpenAPI cannot express the union
   * precisely, so it is documented loosely; the TypeScript type is the contract.
   */
  @ApiProperty({
    description:
      "Per-variant preview, in input order. `status: 'ok'` carries `parameters` (what " +
      'will be sent), `origins` (which rule or mapping produced each value, including ' +
      "values the destination's dictionary rejects), `unresolvedRequired` and " +
      "`restrictionIssues`; `status: 'failed'` carries `reason`.",
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  entries!: AttributeProjectionPreviewEntryView[];
}

/**
 * Wire shape of one entry: the core entry with the variant id under its API
 * name. Distributive, so each arm of the union keeps its own fields - a plain
 * `Omit` over the union would collapse to the keys both arms share.
 */
type WithVariantId<T> = T extends { internalVariantId: string }
  ? Omit<T, 'internalVariantId'> & { variantId: string }
  : never;
export type AttributeProjectionPreviewEntryView = WithVariantId<AttributeProjectionPreviewEntry>;
