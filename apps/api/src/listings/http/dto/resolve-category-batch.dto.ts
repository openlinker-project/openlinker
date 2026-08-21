/**
 * Resolve Category Batch DTOs (#795)
 *
 * Request and response DTOs for the batch category-resolution endpoint.
 * Wraps the `EanCategoryMatcher` sub-capability (#735): one call resolves
 * N variant EANs to marketplace categories, replacing the bulk wizard's
 * previous one-call-per-row loop. Mirrors `BatchCategoryByEanInput` /
 * `Map<string, EanMatchResult>` from `@openlinker/core/listings`.
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

import type { EanMatchResult } from '@openlinker/core/listings';

/**
 * Hard cap on items per request, shared by the batch route and its NDJSON
 * sibling (#2209/#2205). It bounds one request, never a batch: a caller with
 * more variants than this splits them across requests, which the streaming
 * client does explicitly (`RESOLVE_CATEGORY_STREAM_CHUNK_SIZE` in
 * `apps/web/src/features/listings/api/listings.api.ts`, kept in step by
 * `scripts/check-resolve-stream-mirror.mjs`).
 *
 * Exported as a named constant rather than inlined in the decorator so the
 * mirror guard has something to read and a test can pin the boundary.
 */
export const RESOLVE_CATEGORY_ITEMS_MAX = 200;

export class ResolveCategoryBatchItemDto {
  @ApiProperty({ description: 'Internal product-variant ID; echoed back as the result key.' })
  @IsString()
  @IsNotEmpty()
  variantId!: string;

  @ApiPropertyOptional({
    description: 'EAN/GTIN for the variant. Null/empty resolves to a no-ean outcome.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  ean?: string | null;

  @ApiPropertyOptional({
    description:
      "Source-platform category ids for this variant's product, ordered deepest-first. " +
      'When the EAN yields no catalogue match, the batch falls back to the configured ' +
      'per-source-category mapping to resolve the destination category (#1522). ' +
      'Omit for EAN-only resolution.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sourceCategoryIds?: string[];
}

export class ResolveCategoryBatchRequestDto {
  @ApiProperty({
    description: `Per-variant EAN items to resolve (max ${RESOLVE_CATEGORY_ITEMS_MAX}). One result entry per item.`,
    type: [ResolveCategoryBatchItemDto],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'items must contain at least one entry' })
  @ArrayMaxSize(RESOLVE_CATEGORY_ITEMS_MAX, {
    message: `items may contain at most ${RESOLVE_CATEGORY_ITEMS_MAX} entries per request`,
  })
  @ValidateNested({ each: true })
  @Type(() => ResolveCategoryBatchItemDto)
  items!: ResolveCategoryBatchItemDto[];
}

export class ResolveCategoryBatchResponseDto {
  /**
   * Per-variant `EanMatchResult`, keyed by `variantId`. The value is the
   * `EanMatchResult` discriminated union (`matched` / `multi-match` /
   * `no-ean` / `no-match`). A record-of-discriminated-union can't be
   * expressed precisely in OpenAPI, so the field is documented loosely while
   * staying strongly typed in TypeScript — the wire JSON is the contract.
   */
  @ApiProperty({
    description: 'Per-variant EanMatchResult, keyed by variantId.',
    type: 'object',
    additionalProperties: true,
  })
  results!: Record<string, EanMatchResult>;
}
