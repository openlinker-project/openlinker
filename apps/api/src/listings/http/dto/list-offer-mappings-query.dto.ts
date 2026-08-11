/**
 * List Offer Mappings Query DTO
 *
 * Query parameters for GET /listings. All fields are optional.
 *
 * @module apps/api/src/listings/http/dto
 */
import { IsOptional, IsString, IsInt, IsIn, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

// Inline `type` modifier in ONE statement, deliberately: `eslint --fix` merges
// a separate `import type` line from this module back into the value import
// (see the same note in `offer-mapping-response.dto.ts`).
import { OfferLifecycleValues, type OfferLifecycle } from '@openlinker/core/listings';

export class ListOfferMappingsQueryDto {
  @ApiPropertyOptional({ description: 'Filter by connection ID' })
  @IsOptional()
  @IsString()
  connectionId?: string;

  // The raw free-text `platformType` filter was dropped in #2025: the
  // redesigned toolbar scopes by connection (a select over the operator's own
  // connections), and a connection already implies its channel. Two Allegro
  // accounts are the common case, so filtering by platform string answered a
  // question nobody was asking while inviting typo'd, empty result sets.

  @ApiPropertyOptional({ description: 'Filter by linked internal ID (variant ID)' })
  @IsOptional()
  @IsString()
  internalId?: string;

  @ApiPropertyOptional({
    description:
      'Case-insensitive search across product name, variant label, product SKU, variant SKU, EAN, ' +
      'GTIN and the external offer ID. Leading/trailing whitespace is trimmed.',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: OfferLifecycleValues,
    description:
      'Restrict the page to one lifecycle bucket (#2026). Server-side, so selecting a tab pages ' +
      'through that bucket across the whole catalog - filtering the returned page client-side ' +
      'would report an empty tab to a seller whose matching offers all sit past page 1. Does NOT ' +
      'affect `lifecycleCounts`, which always describes every bucket under the other filters.',
  })
  @IsOptional()
  @IsIn(OfferLifecycleValues)
  lifecycle?: OfferLifecycle;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100, description: 'Page size' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ default: 0, minimum: 0, description: 'Number of items to skip' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
